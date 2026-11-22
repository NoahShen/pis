import { describe, expect, it, vi } from "vitest";

import { RUNTIME_DEFAULTS, createRuntime } from "../../src/runtime/runtime.js";
import {
  RuntimeClosedError,
  RuntimeInputError,
} from "../../src/runtime/index.js";
import type {
  RuntimeLogEntry,
  RuntimeTask,
  RuntimeTaskType,
  StageServices,
} from "../../src/runtime/contracts.js";
import { logRuntime } from "../../src/runtime/runtime-logger.js";
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
} from "../fixtures/runtime.js";

describe("createRuntime options and submission boundary", () => {
  it("DEFAULTS exposes 8/2/2/5000 and uses two attempts by default", async () => {
    expect(RUNTIME_DEFAULTS).toEqual({
      queueCapacity: 8,
      maxAttempts: 2,
      dispatchAttempts: 2,
      shutdownTimeoutMs: 5_000,
    });

    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;
    services.collect = async () => {
      collectCalls += 1;
      if (collectCalls === 1) {
        throw createRuntimeError("llm_failed");
      }
      return createCollectResult(["default-process"]);
    };
    services.process = async () => {
      processCalls += 1;
      return createProcessResult(null);
    };

    const runtime = createRuntime({ services });
    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(collectCalls).toBe(2);
    expect(processCalls).toBe(1);
    await runtime.shutdown();

    const capacityGate = createDeferred<void>();
    const capacityServices = createEmptyStageServices();
    let capacityCalls = 0;
    capacityServices.collect = async () => {
      capacityCalls += 1;
      if (capacityCalls === 1) {
        await capacityGate.promise;
      }
      return createCollectResult();
    };
    const capacityRuntime = createRuntime({ services: capacityServices });
    await capacityRuntime.submit(createCollectTask("default-capacity-1"));
    await capacityRuntime.start();
    await vi.waitFor(() => expect(capacityCalls).toBe(1));
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        capacityRuntime.submit(
          createCollectTask(`default-capacity-${index + 2}`),
        ),
      ),
    );

    let tenthSettled = false;
    const tenth = capacityRuntime
      .submit(createCollectTask("default-capacity-10"))
      .then(() => {
        tenthSettled = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(tenthSettled).toBe(false);

    capacityGate.resolve(undefined);
    await tenth;
    await capacityRuntime.drain();
    expect(capacityCalls).toBe(10);
    await capacityRuntime.shutdown();
  });

  it("INVALID_OPTIONS rejects invalid ranges with zero business service invocations", () => {
    const services: StageServices = {
      collect: vi.fn(async () => createCollectResult()),
      process: vi.fn(async () => createProcessResult(null)),
      analyzeEvent: vi.fn(async () => createEventAnalysisResult()),
      analyzeKnowledge: vi.fn(async () => createKnowledgeResult()),
      matchTopics: vi.fn(async () => createTopicMatchingResult(false)),
      publish: vi.fn(async () => createPublishResult()),
    };
    const invalidPositive = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const value of invalidPositive) {
      expect(() => createRuntime({ services, queueCapacity: value })).toThrow(
        RangeError,
      );
      expect(() => createRuntime({ services, maxAttempts: value })).toThrow(
        RangeError,
      );
      expect(() =>
        createRuntime({ services, dispatchAttempts: value }),
      ).toThrow(RangeError);
    }

    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createRuntime({ services, shutdownTimeoutMs: value }),
      ).toThrow(RangeError);
    }

    expect(() =>
      createRuntime({ services, shutdownTimeoutMs: 0 }),
    ).not.toThrow();
    for (const service of Object.values(services)) {
      expect(service).not.toHaveBeenCalled();
    }
  });

  it("SUBMIT_INVALID rejects unknown, blank, missing, and extra fields with zero stage calls", async () => {
    const services: StageServices = {
      collect: vi.fn(async () => createCollectResult()),
      process: vi.fn(async () => createProcessResult(null)),
      analyzeEvent: vi.fn(async () => createEventAnalysisResult()),
      analyzeKnowledge: vi.fn(async () => createKnowledgeResult()),
      matchTopics: vi.fn(async () => createTopicMatchingResult(false)),
      publish: vi.fn(async () => createPublishResult()),
    };
    const runtime = createRuntime({ services });
    const invalidTasks: unknown[] = [
      { type: "UNKNOWN", source_id: "source-1" },
      { type: "COLLECT", source_id: "   " },
      { type: "COLLECT" },
      { type: "COLLECT", source_id: "source-1", body: "private body" },
      { type: "PROCESS", source_item_id: null },
      { type: "TOPIC_MATCHING", target_type: "UNKNOWN", target_id: "target" },
      { type: "PUBLISH", target_type: "EVENT", target_id: "" },
    ];

    for (const invalidTask of invalidTasks) {
      await expect(
        runtime.submit(invalidTask as RuntimeTask),
      ).rejects.toMatchObject({
        code: "invalid_input",
      });
      await expect(
        runtime.submit(invalidTask as RuntimeTask),
      ).rejects.toBeInstanceOf(RuntimeInputError);
    }

    for (const service of Object.values(services)) {
      expect(service).not.toHaveBeenCalled();
    }
    await runtime.shutdown();
  });
});

describe("Runtime retries and error boundaries", () => {
  it("RUN-03_RETRY retries a retryable failure once and continues downstream", async () => {
    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;
    services.collect = async () => {
      collectCalls += 1;
      if (collectCalls === 1) {
        throw createRuntimeError("llm_failed");
      }
      return createCollectResult(["source-item-after-retry"]);
    };
    services.process = async () => {
      processCalls += 1;
      return createProcessResult(null);
    };

    const runtime = createRuntime({ services });
    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(collectCalls).toBe(2);
    expect(processCalls).toBe(1);
    await runtime.shutdown();
  });

  it("RUN-03_RETRY/RUN-07_COMMIT stops after two failures with zero downstream", async () => {
    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;
    services.collect = async () => {
      collectCalls += 1;
      throw createRuntimeError("llm_failed");
    };
    services.process = async () => {
      processCalls += 1;
      return createProcessResult(null);
    };

    const runtime = createRuntime({ services });
    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(collectCalls).toBe(2);
    expect(processCalls).toBe(0);
    await runtime.shutdown();
  });

  it("SQLITE_BUSY_RETRY retries SQLite locks and LLM failures exactly twice", async () => {
    for (const code of ["SQLITE_BUSY", "SQLITE_LOCKED", "llm_failed"]) {
      const services = createEmptyStageServices();
      let collectCalls = 0;
      services.collect = async () => {
        collectCalls += 1;
        throw createRuntimeError(code);
      };

      const runtime = createRuntime({ services });
      await runtime.submit(createCollectTask());
      await runtime.start();
      await runtime.drain();

      expect(collectCalls, code).toBe(2);
      await runtime.shutdown();
    }
  });

  it("RUN-04_NON_RETRY does not retry invalid input, missing targets, or cancellation", async () => {
    const cases = [
      { code: "invalid_input", stage: "TOPIC_MATCHING" },
      { code: "target_not_found", stage: "TOPIC_MATCHING" },
      { code: "aborted", stage: "COLLECT" },
      { code: "AbortError", stage: "COLLECT", cancellationName: "AbortError" },
      { code: "ABORT_ERR", stage: "COLLECT" },
      { code: "LLM_CANCELLED", stage: "COLLECT" },
    ] as const;

    for (const testCase of cases) {
      const services = createEmptyStageServices();
      const entries: RuntimeLogEntry[] = [];
      let stageCalls = 0;
      let publishCalls = 0;
      const error = createRuntimeError(
        testCase.code,
        "cancellationName" in testCase
          ? testCase.cancellationName
          : "RuntimeFixtureError",
      );

      if (testCase.stage === "TOPIC_MATCHING") {
        services.matchTopics = async () => {
          stageCalls += 1;
          throw error;
        };
        services.publish = async () => {
          publishCalls += 1;
          return createPublishResult();
        };
      } else {
        services.collect = async () => {
          stageCalls += 1;
          throw error;
        };
      }

      const runtime = createRuntime({
        services,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
      });
      await runtime.submit(
        testCase.stage === "TOPIC_MATCHING"
          ? createTopicMatchingTask("EVENT", "missing-target")
          : createCollectTask(),
      );
      await runtime.start();
      await runtime.drain();

      expect(stageCalls, testCase.code).toBe(1);
      expect(publishCalls, testCase.code).toBe(0);
      expect(entries, testCase.code).toEqual([
        expect.objectContaining({
          stage: testCase.stage,
          attempt: 1,
          maxAttempts: 2,
          reason: testCase.code,
        }),
      ]);
      await runtime.shutdown();
    }
  });

  it("RUN-15 retries invalid model references but not a missing task target", async () => {
    const services = createEmptyStageServices();
    let eventCalls = 0;
    let topicCallsFromEvent = 0;
    services.analyzeEvent = async () => {
      eventCalls += 1;
      throw createRuntimeError("llm_failed");
    };
    services.matchTopics = async () => {
      topicCallsFromEvent += 1;
      return createTopicMatchingResult(false);
    };

    const eventRuntime = createRuntime({ services });
    await eventRuntime.submit(
      createEventAnalysisTask("content-invalid-reference"),
    );
    await eventRuntime.start();
    await eventRuntime.drain();
    expect(eventCalls).toBe(2);
    expect(topicCallsFromEvent).toBe(0);
    await eventRuntime.shutdown();

    let missingTargetCalls = 0;
    services.matchTopics = async () => {
      missingTargetCalls += 1;
      throw createRuntimeError("target_not_found");
    };
    const targetRuntime = createRuntime({ services });
    await targetRuntime.submit(
      createTopicMatchingTask("EVENT", "missing-event"),
    );
    await targetRuntime.start();
    await targetRuntime.drain();
    expect(missingTargetCalls).toBe(1);
    await targetRuntime.shutdown();
  });

  it("RUN-02_RUNTIME treats all six empty results as one successful call", async () => {
    const calls: Record<RuntimeTaskType, number> = {
      COLLECT: 0,
      PROCESS: 0,
      EVENT_ANALYSIS: 0,
      KNOWLEDGE_ANALYSIS: 0,
      TOPIC_MATCHING: 0,
      PUBLISH: 0,
    };
    const services: StageServices = {
      async collect() {
        calls.COLLECT += 1;
        return createCollectResult();
      },
      async process() {
        calls.PROCESS += 1;
        return createProcessResult(null);
      },
      async analyzeEvent() {
        calls.EVENT_ANALYSIS += 1;
        return createEventAnalysisResult();
      },
      async analyzeKnowledge() {
        calls.KNOWLEDGE_ANALYSIS += 1;
        return createKnowledgeResult();
      },
      async matchTopics() {
        calls.TOPIC_MATCHING += 1;
        return createTopicMatchingResult(false);
      },
      async publish() {
        calls.PUBLISH += 1;
        return createPublishResult();
      },
    };
    const tasks = [
      createCollectTask("empty-collect"),
      createProcessTask("empty-process"),
      createEventAnalysisTask("empty-event"),
      createKnowledgeAnalysisTask("empty-knowledge"),
      createTopicMatchingTask("EVENT", "empty-topic"),
      createPublishTask("EVENT", "empty-publish"),
    ];
    const runtime = createRuntime({ services });

    await Promise.all(tasks.map((task) => runtime.submit(task)));
    await runtime.start();
    await runtime.drain();

    expect(calls).toEqual({
      COLLECT: 1,
      PROCESS: 1,
      EVENT_ANALYSIS: 1,
      KNOWLEDGE_ANALYSIS: 1,
      TOPIC_MATCHING: 1,
      PUBLISH: 1,
    });
    await runtime.shutdown();
  });

  it("RUN-12_DUAL keeps the Knowledge chain alive when Event analysis fails twice", async () => {
    const calls = {
      process: 0,
      event: 0,
      knowledge: 0,
      topic: 0,
      publish: 0,
    };
    const services = createEmptyStageServices();
    services.process = async () => {
      calls.process += 1;
      return createProcessResult("content-dual", ["EVENT", "KNOWLEDGE"]);
    };
    services.analyzeEvent = async () => {
      calls.event += 1;
      throw createRuntimeError("event_analysis_failed");
    };
    services.analyzeKnowledge = async () => {
      calls.knowledge += 1;
      return createKnowledgeResult("knowledge-dual");
    };
    services.matchTopics = async () => {
      calls.topic += 1;
      return createTopicMatchingResult(true, "KNOWLEDGE", "knowledge-dual");
    };
    services.publish = async () => {
      calls.publish += 1;
      return createPublishResult("published-dual");
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
    await runtime.shutdown();
  });
});

describe("Runtime lifecycle and observability", () => {
  it("STOP_ACCEPTING rejects external work but allows an accepted chain to dispatch internally", async () => {
    const processGate = createDeferred<void>();
    const services = createEmptyStageServices();
    let processCalls = 0;
    let eventCalls = 0;
    services.process = async () => {
      processCalls += 1;
      await processGate.promise;
      return createProcessResult("content-accepted", ["EVENT"]);
    };
    services.analyzeEvent = async () => {
      eventCalls += 1;
      return createEventAnalysisResult();
    };

    const runtime = createRuntime({ services });
    await runtime.submit(createProcessTask("source-item-accepted"));
    await runtime.start();
    await vi.waitFor(() => expect(processCalls).toBe(1));

    runtime.stopAccepting();
    runtime.stopAccepting();
    await expect(runtime.submit(createCollectTask())).rejects.toBeInstanceOf(
      RuntimeClosedError,
    );

    processGate.resolve(undefined);
    await runtime.drain();
    expect(eventCalls).toBe(1);
    await runtime.shutdown();
  });

  it("DRAIN resolves immediately when empty and only after the accepted chain finishes", async () => {
    const emptyRuntime = createRuntime({
      services: createEmptyStageServices(),
    });
    await expect(emptyRuntime.drain()).resolves.toBeUndefined();
    await emptyRuntime.shutdown();

    const gate = createDeferred<void>();
    const services = createEmptyStageServices();
    let collectCalls = 0;
    services.collect = async () => {
      collectCalls += 1;
      await gate.promise;
      return createCollectResult();
    };
    const runtime = createRuntime({ services });
    await runtime.submit(createCollectTask());
    await runtime.start();

    let drained = false;
    const drain = runtime.drain().then(() => {
      drained = true;
    });
    await vi.waitFor(() => expect(collectCalls).toBe(1));
    await Promise.resolve();
    expect(drained).toBe(false);

    gate.resolve(undefined);
    await drain;
    expect(drained).toBe(true);
    await runtime.shutdown();
  });

  it("LOGGER keeps the eight-field whitelist and survives throwing/rejecting loggers", async () => {
    const entries: RuntimeLogEntry[] = [];
    const throwingLogger = {
      log(entry: RuntimeLogEntry): void {
        entries.push({ ...entry });
        throw new Error("sync logger failure");
      },
    };
    const throwingServices = createEmptyStageServices();
    let throwingCalls = 0;
    throwingServices.collect = async () => {
      throwingCalls += 1;
      throw createRuntimeError("llm_failed");
    };
    const throwingRuntime = createRuntime({
      services: throwingServices,
      logger: throwingLogger,
    });
    await throwingRuntime.submit(createCollectTask("logger-collect"));
    await throwingRuntime.start();
    await throwingRuntime.drain();
    expect(throwingCalls).toBe(2);
    await throwingRuntime.shutdown();

    const allowedFields = new Set([
      "taskType",
      "taskId",
      "stage",
      "attempt",
      "maxAttempts",
      "queueSize",
      "reason",
      "durationMs",
      "operation",
      "category",
      "httpStatus",
      "retryable",
      "final",
    ]);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(Object.keys(entry).every((key) => allowedFields.has(key))).toBe(
        true,
      );
      expect(entry).toMatchObject({
        taskType: "COLLECT",
        taskId: "logger-collect",
        stage: "COLLECT",
        maxAttempts: 2,
        reason: "llm_failed",
      });
    }
    expect(entries.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(JSON.stringify(entries)).not.toContain(
      "private runtime failure detail",
    );

    const filteredEntries: RuntimeLogEntry[] = [];
    logRuntime(
      {
        log: (entry) => {
          filteredEntries.push(entry);
        },
      },
      {
        stage: "shutdown",
        reason: "runtime_probe",
        prompt: "private prompt",
        url: "https://private.example.test",
      } as unknown as RuntimeLogEntry,
    );
    expect(filteredEntries).toEqual([
      { stage: "shutdown", reason: "runtime_probe" },
    ]);

    const rejectingServices = createEmptyStageServices();
    let rejectingCollectCalls = 0;
    let rejectingProcessCalls = 0;
    rejectingServices.collect = async () => {
      rejectingCollectCalls += 1;
      if (rejectingCollectCalls === 1) {
        throw createRuntimeError("collection_failed");
      }
      return createCollectResult(["logger-process"]);
    };
    rejectingServices.process = async () => {
      rejectingProcessCalls += 1;
      return createProcessResult(null);
    };
    const rejectingRuntime = createRuntime({
      services: rejectingServices,
      logger: {
        log: async () => Promise.reject(new Error("async logger failure")),
      },
    });
    await rejectingRuntime.submit(createCollectTask("logger-reject"));
    await rejectingRuntime.start();
    await rejectingRuntime.drain();

    expect(rejectingCollectCalls).toBe(2);
    expect(rejectingProcessCalls).toBe(1);
    await rejectingRuntime.shutdown();
  });

  it("SIX_QUEUES runs six stages concurrently with one serial worker and independent capacity", async () => {
    const gate = createDeferred<void>();
    const calls: Record<RuntimeTaskType, number> = {
      COLLECT: 0,
      PROCESS: 0,
      EVENT_ANALYSIS: 0,
      KNOWLEDGE_ANALYSIS: 0,
      TOPIC_MATCHING: 0,
      PUBLISH: 0,
    };
    const active: Record<RuntimeTaskType, number> = { ...calls };
    const maxActive: Record<RuntimeTaskType, number> = { ...calls };

    async function enterStage(taskType: RuntimeTaskType): Promise<void> {
      calls[taskType] += 1;
      active[taskType] += 1;
      maxActive[taskType] = Math.max(maxActive[taskType], active[taskType]);
      try {
        if (calls[taskType] === 1) {
          await gate.promise;
        }
      } finally {
        active[taskType] -= 1;
      }
    }

    const services: StageServices = {
      async collect() {
        await enterStage("COLLECT");
        return createCollectResult();
      },
      async process() {
        await enterStage("PROCESS");
        return createProcessResult(null);
      },
      async analyzeEvent() {
        await enterStage("EVENT_ANALYSIS");
        return createEventAnalysisResult();
      },
      async analyzeKnowledge() {
        await enterStage("KNOWLEDGE_ANALYSIS");
        return createKnowledgeResult();
      },
      async matchTopics() {
        await enterStage("TOPIC_MATCHING");
        return createTopicMatchingResult(false);
      },
      async publish() {
        await enterStage("PUBLISH");
        return createPublishResult();
      },
    };
    const firstTasks = [
      createCollectTask("six-collect-1"),
      createProcessTask("six-process-1"),
      createEventAnalysisTask("six-event-1"),
      createKnowledgeAnalysisTask("six-knowledge-1"),
      createTopicMatchingTask("EVENT", "six-topic-1"),
      createPublishTask("EVENT", "six-publish-1"),
    ];
    const secondTasks = [
      createCollectTask("six-collect-2"),
      createProcessTask("six-process-2"),
      createEventAnalysisTask("six-event-2"),
      createKnowledgeAnalysisTask("six-knowledge-2"),
      createTopicMatchingTask("EVENT", "six-topic-2"),
      createPublishTask("EVENT", "six-publish-2"),
    ];
    const thirdTasks = [
      createCollectTask("six-collect-3"),
      createProcessTask("six-process-3"),
      createEventAnalysisTask("six-event-3"),
      createKnowledgeAnalysisTask("six-knowledge-3"),
      createTopicMatchingTask("EVENT", "six-topic-3"),
      createPublishTask("EVENT", "six-publish-3"),
    ];
    const runtime = createRuntime({ services, queueCapacity: 1 });

    await Promise.all(firstTasks.map((task) => runtime.submit(task)));
    await runtime.start();
    await vi.waitFor(() => {
      for (const taskType of expectedRuntimeTaskTypes) {
        expect(calls[taskType], taskType).toBe(1);
      }
    });
    await Promise.all(secondTasks.map((task) => runtime.submit(task)));

    let settledThirdSubmissions = 0;
    const thirdSubmissions = thirdTasks.map((task) =>
      runtime.submit(task).then(() => {
        settledThirdSubmissions += 1;
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settledThirdSubmissions).toBe(0);

    gate.resolve(undefined);
    await Promise.all(thirdSubmissions);
    await runtime.drain();

    for (const taskType of expectedRuntimeTaskTypes) {
      expect(calls[taskType], taskType).toBe(3);
      expect(maxActive[taskType], taskType).toBe(1);
    }
    await runtime.shutdown();
  });
});
