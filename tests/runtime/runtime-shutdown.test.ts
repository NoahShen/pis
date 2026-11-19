import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  BoundedTaskQueue,
  RuntimeClosedError,
  createRuntime,
} from "../../src/runtime/index.js";
import type { RuntimeLogEntry } from "../../src/runtime/contracts.js";
import { logRuntime } from "../../src/runtime/runtime-logger.js";
import { dispatchDownstreamTasks } from "../../src/runtime/task-dispatch.js";
import {
  createCollectResult,
  createCollectTask,
  createDeferred,
  createEmptyStageServices,
  createEventAnalysisResult,
  createKnowledgeResult,
  createProcessResult,
  createProcessTask,
  createPublishResult,
  createRuntimeError,
  createTopicMatchingResult,
  waitForCondition,
  withRuntimeSqliteProbe,
} from "../fixtures/runtime.js";

const allowedLogFields = new Set([
  "taskType",
  "taskId",
  "stage",
  "attempt",
  "maxAttempts",
  "queueSize",
  "reason",
  "durationMs",
]);

const runtimeSourceFileNames = [
  "bounded-task-queue.ts",
  "contracts.ts",
  "index.ts",
  "runtime-errors.ts",
  "runtime-logger.ts",
  "runtime.ts",
  "stage-worker.ts",
  "task-dispatch.ts",
  "task-errors.ts",
  "task-mapping.ts",
] as const;

function readRuntimeSource(): string {
  return runtimeSourceFileNames
    .map((fileName) =>
      readFileSync(
        new URL(`../../src/runtime/${fileName}`, import.meta.url),
        "utf8",
      ),
    )
    .join("\n");
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

describe("Runtime shutdown boundaries", () => {
  it("STOP_ACCEPTING rejects new external work while an accepted chain dispatches internally", async () => {
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

  it("DRAIN_EMPTY/SHUTDOWN_IDEMPOTENT resolves immediately and never reopens submission", async () => {
    const runtime = createRuntime({ services: createEmptyStageServices() });

    await expect(runtime.drain()).resolves.toBeUndefined();
    const firstShutdown = runtime.shutdown({ timeoutMs: 0 });
    const secondShutdown = runtime.shutdown({ timeoutMs: 0 });
    expect(secondShutdown).toBe(firstShutdown);
    await expect(firstShutdown).resolves.toBeUndefined();
    await expect(runtime.drain()).resolves.toBeUndefined();
    await expect(runtime.submit(createCollectTask())).rejects.toMatchObject({
      code: "runtime_closed",
    });
  });

  it("CLOSE_WAKES_ALL abort-closes queues and settles every blocked enqueue and dequeue", async () => {
    const controller = new AbortController();
    const enqueueQueue = new BoundedTaskQueue<string>({
      capacity: 1,
      signal: controller.signal,
    });
    await enqueueQueue.enqueue("accepted");
    const blockedEnqueueA = enqueueQueue.enqueue("blocked-a");
    const blockedEnqueueB = enqueueQueue.enqueue("blocked-b");

    const dequeueQueue = new BoundedTaskQueue<string>({
      signal: controller.signal,
    });
    const blockedDequeueA = dequeueQueue.dequeue();
    const blockedDequeueB = dequeueQueue.dequeue();
    controller.abort();

    const [enqueueA, enqueueB, dequeueA, dequeueB] = await Promise.allSettled([
      blockedEnqueueA,
      blockedEnqueueB,
      blockedDequeueA,
      blockedDequeueB,
    ]);

    expect(enqueueA).toMatchObject({
      status: "rejected",
      reason: { code: "queue_closed" },
    });
    expect(enqueueB).toMatchObject({
      status: "rejected",
      reason: { code: "queue_closed" },
    });
    expect(dequeueA).toEqual({ status: "fulfilled", value: null });
    expect(dequeueB).toEqual({ status: "fulfilled", value: null });
    expect(enqueueQueue.isClosed).toBe(true);
    expect(dequeueQueue.isClosed).toBe(true);
    await expect(enqueueQueue.dequeue()).resolves.toBe("accepted");
  });

  it("RUN-10_DRAIN covers running, queued, backpressure, and retrying work before shutdown", async () => {
    const runningCollectGate = createDeferred<void>();
    const retryingProcessGate = createDeferred<void>();
    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;
    let knowledgeCalls = 0;

    services.collect = async (sourceId) => {
      collectCalls += 1;
      if (sourceId === "collect-running") {
        await runningCollectGate.promise;
        return createCollectResult(["process-after-running"]);
      }
      return createCollectResult();
    };
    services.process = async (sourceItemId) => {
      if (sourceItemId !== "process-retrying") {
        processCalls += 1;
        return createProcessResult(null);
      }

      processCalls += 1;
      if (processCalls === 1) {
        throw createRuntimeError("processing_failed");
      }
      await retryingProcessGate.promise;
      return createProcessResult("content-after-retry", ["KNOWLEDGE"]);
    };
    services.analyzeKnowledge = async () => {
      knowledgeCalls += 1;
      return createKnowledgeResult("knowledge-after-retry");
    };
    services.matchTopics = async () => createTopicMatchingResult(false);

    const runtime = createRuntime({
      services,
      queueCapacity: 1,
      dispatchAttempts: 2,
    });

    await runtime.submit(createCollectTask("collect-running"));
    await runtime.submit(createProcessTask("process-retrying"));
    await runtime.start();
    await vi.waitFor(() => {
      expect(collectCalls).toBe(1);
      expect(processCalls).toBe(2);
    });

    await runtime.submit(createCollectTask("collect-queued"));
    let backpressureAccepted = false;
    const backpressureSubmit = runtime
      .submit(createCollectTask("collect-backpressure"))
      .then(() => {
        backpressureAccepted = true;
      });
    await Promise.resolve();
    expect(backpressureAccepted).toBe(false);

    runtime.stopAccepting();
    await expect(
      runtime.submit(createCollectTask("rejected")),
    ).rejects.toBeInstanceOf(RuntimeClosedError);

    let drained = false;
    const drain = runtime.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    retryingProcessGate.resolve(undefined);
    await vi.waitFor(() => expect(knowledgeCalls).toBe(1));
    runningCollectGate.resolve(undefined);
    await backpressureSubmit;
    await drain;

    expect(collectCalls).toBe(3);
    expect(processCalls).toBe(3);
    expect(knowledgeCalls).toBe(1);
    await runtime.shutdown();
  });

  it("RUN-11_TIMEOUT aborts, wakes waiters, logs timeout and grace, and resolves within the bound", async () => {
    const timeoutMs = 15;
    const graceMs = 20;
    const entries: RuntimeLogEntry[] = [];
    const ignoredProcess = createDeferred<void>();
    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;
    let collectSignal: AbortSignal | undefined;
    let processSignal: AbortSignal | undefined;

    services.collect = async (_sourceId, options) => {
      collectCalls += 1;
      collectSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(createRuntimeError("aborted")),
          { once: true },
        );
      });
    };
    services.process = async (_sourceItemId, options) => {
      processCalls += 1;
      processSignal = options?.signal;
      await ignoredProcess.promise;
      return createProcessResult(null);
    };

    const runtime = createRuntime({
      services,
      queueCapacity: 1,
      shutdownGraceMs: graceMs,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });
    await runtime.submit(createCollectTask("collect-timeout"));
    await runtime.submit(createProcessTask("process-ignores-abort"));
    await runtime.start();
    await vi.waitFor(() => {
      expect(collectCalls).toBe(1);
      expect(processCalls).toBe(1);
    });

    await runtime.submit(createCollectTask("collect-queued"));
    const backpressure = runtime
      .submit(createCollectTask("collect-backpressure"))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const startedAt = Date.now();
    const shutdown = runtime.shutdown({ timeoutMs });
    expect(await settlesWithin(shutdown, 500)).toBe(true);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
    expect(elapsedMs).toBeLessThan(timeoutMs + graceMs + 400);
    expect(await backpressure).toBeInstanceOf(RuntimeClosedError);
    await expect(runtime.drain()).resolves.toBeUndefined();
    expect(collectSignal).toBeInstanceOf(AbortSignal);
    expect(processSignal).toBe(collectSignal);
    expect(collectSignal?.aborted).toBe(true);
    expect(collectCalls).toBe(1);
    expect(processCalls).toBe(1);
    expect(entries).toContainEqual({
      stage: "shutdown",
      reason: "shutdown_timeout",
      durationMs: timeoutMs,
    });
    expect(entries).toContainEqual({
      stage: "shutdown",
      reason: "shutdown_grace",
      durationMs: graceMs,
    });
    expect(entries).toContainEqual(
      expect.objectContaining({
        stage: "COLLECT",
        taskId: "collect-timeout",
        reason: "cancelled",
      }),
    );
  });

  it("ABORT_NO_RETRY never retries cancellation or dispatches downstream after abort", async () => {
    const entries: RuntimeLogEntry[] = [];
    const services = createEmptyStageServices();
    let collectCalls = 0;
    let processCalls = 0;

    services.collect = async (_sourceId, options) => {
      collectCalls += 1;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(createRuntimeError("ABORT_ERR")),
          { once: true },
        );
      });
    };
    services.process = async () => {
      processCalls += 1;
      return createProcessResult(null);
    };

    const runtime = createRuntime({
      services,
      shutdownGraceMs: 20,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });
    await runtime.submit(createCollectTask("cancel-without-retry"));
    await runtime.start();
    await vi.waitFor(() => expect(collectCalls).toBe(1));
    await runtime.shutdown({ timeoutMs: 5 });

    expect(collectCalls).toBe(1);
    expect(processCalls).toBe(0);
    expect(entries).toContainEqual(
      expect.objectContaining({
        stage: "COLLECT",
        reason: "cancelled",
        attempt: 1,
      }),
    );
    expect(entries.some((entry) => entry.reason === "shutdown_grace")).toBe(
      false,
    );
  });

  it("NO_PROCESS_EXIT leaves process lifecycle to the caller", () => {
    expect(readRuntimeSource()).not.toMatch(/process\s*\.\s*exit/u);
    expect(readRuntimeSource()).not.toMatch(/\bwithTransaction\b/u);
    expect(readRuntimeSource()).not.toMatch(/\bnew\s+Database\b/u);
    expect(readRuntimeSource()).not.toMatch(/\bfetch\s*\(/u);
  });

  it("RUN-13_BOUNDARY records no task table or recovery scan (P1 accepted crash window)", async () => {
    await withRuntimeSqliteProbe(async (probe) => {
      const before = probe.readUserTableNames();
      probe.insertSource("boundary-source");
      const afterSetup = probe.readUserTableNames();
      const runtime = createRuntime({
        services: {
          ...createEmptyStageServices(),
          async publish() {
            return createPublishResult("ephemeral-published-id");
          },
        },
      });

      await runtime.submit({
        type: "PUBLISH",
        target_type: "EVENT",
        target_id: "boundary-target",
      });
      await runtime.start();
      await runtime.drain();
      await runtime.shutdown();

      expect(afterSetup).toEqual(before);
      expect(probe.readUserTableNames()).toEqual(before);
      expect(probe.readPublishedItemCount()).toBe(0);
      expect(before.some((name) => /task|outbox/u.test(name))).toBe(false);
      expect(readRuntimeSource()).not.toMatch(/\b(?:recover|recovery)\w*\b/iu);
    });
  });

  it("RUN-14_LOGGER keeps the eight-field whitelist and distinguishes dispatch failures from cancellation", async () => {
    const entries: RuntimeLogEntry[] = [];
    const throwingLogger = {
      log(entry: RuntimeLogEntry): void {
        entries.push({ ...entry });
        throw new Error("logger failure with private logger sentinel");
      },
    };
    const services = createEmptyStageServices();
    let collectCalls = 0;
    services.collect = async () => {
      collectCalls += 1;
      if (collectCalls === 1) {
        throw createRuntimeError("collection_failed");
      }
      return createCollectResult();
    };
    const runtime = createRuntime({ services, logger: throwingLogger });
    await runtime.submit(createCollectTask("logger-boundary"));
    await runtime.start();
    await runtime.drain();
    await runtime.shutdown();

    await dispatchDownstreamTasks(
      [createProcessTask("dispatch-failed")],
      async () => {
        throw new Error("private dispatch body sentinel");
      },
      { dispatchAttempts: 2, logger: throwingLogger },
    );

    const cancellationController = new AbortController();
    cancellationController.abort();
    await dispatchDownstreamTasks(
      [createProcessTask("dispatch-cancelled")],
      async () => undefined,
      {
        dispatchAttempts: 2,
        logger: throwingLogger,
        signal: cancellationController.signal,
      },
    );

    logRuntime(
      {
        log: async () => {
          throw new Error("async logger failure");
        },
      },
      { stage: "shutdown", reason: "logger_probe" },
    );

    expect(entries).toContainEqual(
      expect.objectContaining({ reason: "dispatch_failed" }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ reason: "dispatch_cancelled" }),
    );
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(Object.keys(entry).every((key) => allowedLogFields.has(key))).toBe(
        true,
      );
    }
    expect(JSON.stringify(entries)).not.toMatch(
      /private|prompt|token|https?:\/\//u,
    );
  });
});
