import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";
import type { StageServices } from "../../src/runtime/contracts.js";
import { BoundedTaskQueue, createRuntime } from "../../src/runtime/index.js";
import { createCronScheduler } from "../../src/scheduler/index.js";
import {
  createCollectResult,
  createCollectTask,
  createDeferred,
  createEmptyStageServices,
  createEventAnalysisResult,
  createEventAnalysisTask,
  createKnowledgeAnalysisTask,
  createKnowledgeResult,
  createProcessResult,
  createProcessTask,
  createPublishResult,
  createPublishTask,
  createRuntimeError,
  createTopicMatchingResult,
  createTopicMatchingTask,
  expectedRuntimeTaskTypes,
  waitForCondition,
} from "../fixtures/runtime.js";
import {
  FakeCronBackend,
  insertSchedulerSource,
  withSchedulerSourceRepository,
} from "../fixtures/scheduler.js";

interface CountValueRow {
  readonly count: number;
}

interface NameRow {
  readonly name: string;
}

function publishedItemCount(database: Database.Database): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM published_items")
    .get() as CountValueRow;
  return row.count;
}

function userTableNames(database: Database.Database): string[] {
  const rows = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as NameRow[];
  return rows.map((row) => row.name);
}

function queuedTaskType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const task = (value as { readonly task?: unknown }).task;
  if (typeof task !== "object" || task === null) {
    return undefined;
  }

  const type = (task as { readonly type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

describe("Runtime with real SQLite and stub stage services", () => {
  it("RUN-01_CHAIN/PUBLISH_STUB/NO_PERSISTENCE runs enabled Source through six stages without writing Published Item", async () => {
    await withSchedulerSourceRepository(async (repository, database) => {
      insertSchedulerSource(database, {
        id: "S-ENABLED",
        cron: "0 * * * *",
        enabled: true,
      });
      insertSchedulerSource(database, {
        id: "S-DISABLED",
        cron: "15 * * * *",
        enabled: false,
      });
      const tablesBefore = userTableNames(database);
      const calls = {
        collect: 0,
        process: 0,
        event: 0,
        knowledge: 0,
        topic: 0,
        publish: 0,
      };
      const submittedTypes: string[] = [];
      const services: StageServices = {
        async collect(sourceId) {
          calls.collect += 1;
          expect(sourceId).toBe("S-ENABLED");
          return createCollectResult(["source-item-chain"]);
        },
        async process(sourceItemId) {
          calls.process += 1;
          expect(sourceItemId).toBe("source-item-chain");
          return createProcessResult("content-chain", ["EVENT", "KNOWLEDGE"]);
        },
        async analyzeEvent(contentId) {
          calls.event += 1;
          expect(contentId).toBe("content-chain");
          return createEventAnalysisResult([
            { target_type: "EVENT", target_id: "event-chain" },
          ]);
        },
        async analyzeKnowledge(contentId) {
          calls.knowledge += 1;
          expect(contentId).toBe("content-chain");
          return createKnowledgeResult("knowledge-chain");
        },
        async matchTopics(targetType, targetId) {
          calls.topic += 1;
          return createTopicMatchingResult(
            targetType === "EVENT",
            targetType,
            targetId,
          );
        },
        async publish(targetType, targetId) {
          calls.publish += 1;
          expect(targetType).toBe("EVENT");
          expect(targetId).toBe("event-chain");
          return createPublishResult("stub-published-id");
        },
      };
      const backend = new FakeCronBackend();
      const runtime = createRuntime({ services, queueCapacity: 2 });
      const scheduler = createCronScheduler(
        {
          sources: repository,
          async submit(task) {
            submittedTypes.push(task.type);
            await runtime.submit(task);
          },
        },
        { backend },
      );

      await runtime.start();
      scheduler.start();
      expect(backend.scheduleCalls.map((call) => call.options.name)).toEqual([
        "S-ENABLED",
      ]);
      expect(backend.taskFor("S-DISABLED")).toBeUndefined();

      backend.fire("S-ENABLED");
      await runtime.drain();

      expect(calls).toEqual({
        collect: 1,
        process: 1,
        event: 1,
        knowledge: 1,
        topic: 2,
        publish: 1,
      });
      expect(submittedTypes).toEqual(["COLLECT"]);
      expect(publishedItemCount(database)).toBe(0);
      expect(userTableNames(database)).toEqual(tablesBefore);
      expect(tablesBefore.some((name) => /task|outbox/u.test(name))).toBe(
        false,
      );

      scheduler.stop();
      await runtime.shutdown();
    });
  });

  it("RUN-02_CHAIN treats empty results at all six stages as successful terminal work", async () => {
    await withSchedulerSourceRepository(async (_repository, database) => {
      const calls = {
        collect: 0,
        process: 0,
        event: 0,
        knowledge: 0,
        topic: 0,
        publish: 0,
      };
      const services: StageServices = {
        async collect() {
          calls.collect += 1;
          return createCollectResult();
        },
        async process() {
          calls.process += 1;
          return createProcessResult(null, []);
        },
        async analyzeEvent() {
          calls.event += 1;
          return createEventAnalysisResult();
        },
        async analyzeKnowledge() {
          calls.knowledge += 1;
          return createKnowledgeResult(null);
        },
        async matchTopics(targetType, targetId) {
          calls.topic += 1;
          return createTopicMatchingResult(false, targetType, targetId);
        },
        async publish() {
          calls.publish += 1;
          return createPublishResult("unused-stub-id");
        },
      };
      const runtime = createRuntime({ services });
      const tasks = [
        createCollectTask("empty-collect"),
        createProcessTask("empty-process"),
        createEventAnalysisTask("empty-event"),
        createKnowledgeAnalysisTask("empty-knowledge"),
        createTopicMatchingTask("EVENT", "empty-topic"),
        createPublishTask("EVENT", "empty-publish"),
      ];

      await Promise.all(tasks.map((task) => runtime.submit(task)));
      await runtime.start();
      await runtime.drain();

      expect(calls).toEqual({
        collect: 1,
        process: 1,
        event: 1,
        knowledge: 1,
        topic: 1,
        publish: 1,
      });
      expect(publishedItemCount(database)).toBe(0);
      await runtime.shutdown();
    });
  });

  it("SIX_QUEUES gives every stage one serial worker and independent backpressure", async () => {
    await withSchedulerSourceRepository(async () => {
      const gates = Object.fromEntries(
        expectedRuntimeTaskTypes.map((taskType) => [
          taskType,
          createDeferred<void>(),
        ]),
      ) as Record<
        (typeof expectedRuntimeTaskTypes)[number],
        ReturnType<typeof createDeferred<void>>
      >;
      const calls = {
        COLLECT: 0,
        PROCESS: 0,
        EVENT_ANALYSIS: 0,
        KNOWLEDGE_ANALYSIS: 0,
        TOPIC_MATCHING: 0,
        PUBLISH: 0,
      };
      const active = { ...calls };
      const maxActive = { ...calls };
      const observedSignals: AbortSignal[] = [];

      async function enterStage(
        taskType: keyof typeof calls,
        signal: AbortSignal | undefined,
      ): Promise<void> {
        if (signal !== undefined) {
          observedSignals.push(signal);
        }
        calls[taskType] += 1;
        active[taskType] += 1;
        maxActive[taskType] = Math.max(maxActive[taskType], active[taskType]);
        try {
          if (calls[taskType] === 1) {
            await gates[taskType].promise;
          }
        } finally {
          active[taskType] -= 1;
        }
      }

      const services: StageServices = {
        async collect(_sourceId, options) {
          await enterStage("COLLECT", options?.signal);
          return createCollectResult();
        },
        async process(_sourceItemId, options) {
          await enterStage("PROCESS", options?.signal);
          return createProcessResult(null);
        },
        async analyzeEvent(_contentId, options) {
          await enterStage("EVENT_ANALYSIS", options?.signal);
          return createEventAnalysisResult();
        },
        async analyzeKnowledge(_contentId, options) {
          await enterStage("KNOWLEDGE_ANALYSIS", options?.signal);
          return createKnowledgeResult(null);
        },
        async matchTopics(targetType, targetId, options) {
          await enterStage("TOPIC_MATCHING", options?.signal);
          return createTopicMatchingResult(false, targetType, targetId);
        },
        async publish(_targetType, _targetId, options) {
          await enterStage("PUBLISH", options?.signal);
          return createPublishResult("six-queue-stub");
        },
      };
      const makeTasks = (suffix: string) => [
        createCollectTask(`collect-${suffix}`),
        createProcessTask(`process-${suffix}`),
        createEventAnalysisTask(`event-${suffix}`),
        createKnowledgeAnalysisTask(`knowledge-${suffix}`),
        createTopicMatchingTask("EVENT", `topic-${suffix}`),
        createPublishTask("EVENT", `publish-${suffix}`),
      ];
      const runtime = createRuntime({ services, queueCapacity: 1 });
      await Promise.all(makeTasks("one").map((task) => runtime.submit(task)));
      await runtime.start();
      await vi.waitFor(() => {
        for (const taskType of expectedRuntimeTaskTypes) {
          expect(calls[taskType], taskType).toBe(1);
        }
      });

      await Promise.all(makeTasks("two").map((task) => runtime.submit(task)));
      let thirdSettled = 0;
      const thirdSubmissions = makeTasks("three").map((task) =>
        runtime.submit(task).then(() => {
          thirdSettled += 1;
        }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(thirdSettled).toBe(0);

      for (const taskType of expectedRuntimeTaskTypes) {
        gates[taskType].resolve(undefined);
      }
      await Promise.all(thirdSubmissions);
      await runtime.drain();

      for (const taskType of expectedRuntimeTaskTypes) {
        expect(calls[taskType], taskType).toBe(3);
        expect(maxActive[taskType], taskType).toBe(1);
      }
      expect(observedSignals).toHaveLength(18);
      expect(new Set(observedSignals).size).toBe(1);
      await runtime.shutdown();
    });
  });

  it("RUN-12_DUAL keeps the Knowledge chain alive while Event analysis fails twice", async () => {
    await withSchedulerSourceRepository(async (_repository, database) => {
      const calls = {
        process: 0,
        event: 0,
        knowledge: 0,
        topic: 0,
        publish: 0,
      };
      const services: StageServices = {
        async collect() {
          return createCollectResult();
        },
        async process() {
          calls.process += 1;
          return createProcessResult("content-dual", ["EVENT", "KNOWLEDGE"]);
        },
        async analyzeEvent() {
          calls.event += 1;
          throw createRuntimeError("event_analysis_failed");
        },
        async analyzeKnowledge() {
          calls.knowledge += 1;
          return createKnowledgeResult("knowledge-dual");
        },
        async matchTopics() {
          calls.topic += 1;
          return createTopicMatchingResult(true, "KNOWLEDGE", "knowledge-dual");
        },
        async publish() {
          calls.publish += 1;
          return createPublishResult("stub-dual-id");
        },
      };
      const runtime = createRuntime({ services });
      await runtime.submit(createProcessTask("source-item-dual"));
      await runtime.start();
      await runtime.drain();

      expect(calls).toEqual({
        process: 1,
        event: 2,
        knowledge: 1,
        topic: 1,
        publish: 1,
      });
      expect(publishedItemCount(database)).toBe(0);
      await runtime.shutdown();
    });
  });

  it("RUN-15_CHAIN retries invalid model references twice but never retries a missing target", async () => {
    await withSchedulerSourceRepository(async (_repository, database) => {
      let eventCalls = 0;
      let topicCallsAfterEvent = 0;
      const eventServices = createEmptyStageServices();
      eventServices.analyzeEvent = async () => {
        eventCalls += 1;
        throw createRuntimeError("llm_failed");
      };
      eventServices.matchTopics = async () => {
        topicCallsAfterEvent += 1;
        return createTopicMatchingResult(false);
      };
      const eventRuntime = createRuntime({ services: eventServices });
      await eventRuntime.submit(
        createEventAnalysisTask("invalid-reference-content"),
      );
      await eventRuntime.start();
      await eventRuntime.drain();
      await eventRuntime.shutdown();

      expect(eventCalls).toBe(2);
      expect(topicCallsAfterEvent).toBe(0);

      let missingTargetCalls = 0;
      let publishCalls = 0;
      const targetServices = createEmptyStageServices();
      targetServices.matchTopics = async () => {
        missingTargetCalls += 1;
        throw createRuntimeError("target_not_found");
      };
      targetServices.publish = async () => {
        publishCalls += 1;
        return createPublishResult();
      };
      const targetRuntime = createRuntime({ services: targetServices });
      await targetRuntime.submit(
        createTopicMatchingTask("EVENT", "missing-event"),
      );
      await targetRuntime.start();
      await targetRuntime.drain();
      await targetRuntime.shutdown();

      expect(missingTargetCalls).toBe(1);
      expect(publishCalls).toBe(0);
      expect(publishedItemCount(database)).toBe(0);
    });
  });

  it("RUN-05/06_CHAIN retries only the failed downstream enqueue and executes upstream once", async () => {
    await withSchedulerSourceRepository(async () => {
      const originalEnqueue = (
        BoundedTaskQueue.prototype as unknown as {
          enqueue(
            this: BoundedTaskQueue<unknown>,
            task: unknown,
          ): Promise<void>;
        }
      ).enqueue;
      let knowledgeEnqueueAttempts = 0;
      const enqueueSpy = vi
        .spyOn(
          BoundedTaskQueue.prototype as unknown as {
            enqueue(task: unknown): Promise<void>;
          },
          "enqueue",
        )
        .mockImplementation(function (
          this: BoundedTaskQueue<unknown>,
          task: unknown,
        ): Promise<void> {
          if (queuedTaskType(task) === "KNOWLEDGE_ANALYSIS") {
            knowledgeEnqueueAttempts += 1;
            if (knowledgeEnqueueAttempts === 1) {
              return Promise.reject(new Error("transient queue handoff"));
            }
          }
          return originalEnqueue.call(this, task);
        });
      const calls = {
        process: 0,
        event: 0,
        knowledge: 0,
        topic: 0,
      };
      const services: StageServices = {
        async collect() {
          return createCollectResult();
        },
        async process() {
          calls.process += 1;
          return createProcessResult("content-dispatched", [
            "EVENT",
            "KNOWLEDGE",
          ]);
        },
        async analyzeEvent() {
          calls.event += 1;
          return createEventAnalysisResult([
            { target_type: "EVENT", target_id: "event-dispatched" },
          ]);
        },
        async analyzeKnowledge() {
          calls.knowledge += 1;
          return createKnowledgeResult("knowledge-dispatched");
        },
        async matchTopics() {
          calls.topic += 1;
          return createTopicMatchingResult(false);
        },
        async publish() {
          return createPublishResult();
        },
      };
      const runtime = createRuntime({ services, dispatchAttempts: 2 });

      try {
        await runtime.submit(createProcessTask("source-item-dispatched"));
        await runtime.start();
        await runtime.drain();
      } finally {
        enqueueSpy.mockRestore();
      }

      expect(calls).toEqual({
        process: 1,
        event: 1,
        knowledge: 1,
        topic: 2,
      });
      expect(knowledgeEnqueueAttempts).toBe(2);
      await runtime.shutdown();
    });
  });

  it("RUN-07_CHAIN commits downstream only after a retryable stage succeeds", async () => {
    await withSchedulerSourceRepository(async () => {
      let processCalls = 0;
      let eventCalls = 0;
      const services = createEmptyStageServices();
      services.process = async () => {
        processCalls += 1;
        throw createRuntimeError("processing_failed");
      };
      services.analyzeEvent = async () => {
        eventCalls += 1;
        return createEventAnalysisResult();
      };
      const runtime = createRuntime({ services });
      await runtime.submit(createProcessTask("source-item-failed"));
      await runtime.start();
      await runtime.drain();
      expect(processCalls).toBe(2);
      expect(eventCalls).toBe(0);
      await runtime.shutdown();
    });
  });

  it("RUN-16_CHAIN observes no transaction during every stage and permits a concurrent short write", async () => {
    await withSchedulerSourceRepository(async (_repository, database) => {
      const collectGate = createDeferred<void>();
      const transactionSamples: boolean[] = [];
      const services: StageServices = {
        async collect() {
          transactionSamples.push(database.inTransaction);
          await collectGate.promise;
          transactionSamples.push(database.inTransaction);
          return createCollectResult(["source-item-boundary"]);
        },
        async process() {
          transactionSamples.push(database.inTransaction);
          return createProcessResult("content-boundary", ["KNOWLEDGE"]);
        },
        async analyzeEvent() {
          transactionSamples.push(database.inTransaction);
          return createEventAnalysisResult();
        },
        async analyzeKnowledge() {
          transactionSamples.push(database.inTransaction);
          return createKnowledgeResult("knowledge-boundary");
        },
        async matchTopics() {
          transactionSamples.push(database.inTransaction);
          return createTopicMatchingResult(
            true,
            "KNOWLEDGE",
            "knowledge-boundary",
          );
        },
        async publish() {
          transactionSamples.push(database.inTransaction);
          return createPublishResult();
        },
      };
      const runtime = createRuntime({ services });
      await runtime.submit(createCollectTask("boundary-source"));
      await runtime.start();
      await waitForCondition(() => transactionSamples.length === 1);

      expect(database.inTransaction).toBe(false);
      withTransaction(database, () => {
        insertSchedulerSource(database, { id: "concurrent-short-write" });
      });
      expect(database.inTransaction).toBe(false);
      collectGate.resolve(undefined);
      await runtime.drain();

      expect(transactionSamples.length).toBeGreaterThanOrEqual(6);
      expect(transactionSamples.every((sample) => sample === false)).toBe(true);
      expect(
        database
          .prepare("SELECT id FROM sources WHERE id = ?")
          .get("concurrent-short-write"),
      ).toEqual({ id: "concurrent-short-write" });
      await runtime.shutdown();
    });
  });
});
