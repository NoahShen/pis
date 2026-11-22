import { describe, expect, it, vi } from "vitest";

import type {
  RuntimeOperationRetryPolicies,
  RuntimeTask,
} from "../../src/runtime/contracts.js";
import { createRuntime } from "../../src/runtime/runtime.js";
import {
  createDeferred,
  createEmptyStageServices,
  createEventAnalysisResult,
  createKnowledgeResult,
  createProcessResult,
  createRuntimeError,
  createTopicMatchingResult,
} from "../fixtures/runtime.js";

const operations = [
  "processing-route",
  "event-analysis",
  "knowledge-analysis",
  "topic-matching",
] as const;

function policies(
  maxAttempts: 1 | 2 = 2,
  retryDelayMs = 20,
  retryTotalBudgetMs = 1_000,
  totalTimeoutMs = 1_000,
): RuntimeOperationRetryPolicies {
  return Object.fromEntries(
    operations.map((operation) => [
      operation,
      { maxAttempts, retryDelayMs, retryTotalBudgetMs, totalTimeoutMs },
    ]),
  );
}

const llmCases = [
  {
    operation: "processing-route",
    task: { type: "PROCESS", source_item_id: "source-item-retry" } as const,
    install(
      services: ReturnType<typeof createEmptyStageServices>,
      call: () => Promise<unknown>,
    ) {
      services.process = call as typeof services.process;
    },
  },
  {
    operation: "event-analysis",
    task: {
      type: "EVENT_ANALYSIS",
      content_id: "content-event-retry",
    } as const,
    install(
      services: ReturnType<typeof createEmptyStageServices>,
      call: () => Promise<unknown>,
    ) {
      services.analyzeEvent = call as typeof services.analyzeEvent;
    },
  },
  {
    operation: "knowledge-analysis",
    task: {
      type: "KNOWLEDGE_ANALYSIS",
      content_id: "content-knowledge-retry",
    } as const,
    install(
      services: ReturnType<typeof createEmptyStageServices>,
      call: () => Promise<unknown>,
    ) {
      services.analyzeKnowledge = call as typeof services.analyzeKnowledge;
    },
  },
  {
    operation: "topic-matching",
    task: {
      type: "TOPIC_MATCHING",
      target_type: "EVENT",
      target_id: "target-retry",
    } as const,
    install(
      services: ReturnType<typeof createEmptyStageServices>,
      call: () => Promise<unknown>,
    ) {
      services.matchTopics = call as typeof services.matchTopics;
    },
  },
] satisfies ReadonlyArray<{
  operation: (typeof operations)[number];
  task: RuntimeTask;
  install(
    services: ReturnType<typeof createEmptyStageServices>,
    call: () => Promise<unknown>,
  ): void;
}>;

describe("Runtime operation retry policy", () => {
  it.each(llmCases)(
    "applies maxAttempts and delay to $operation without a third attempt",
    async ({ operation, task, install }) => {
      vi.useFakeTimers();
      try {
        const services = createEmptyStageServices();
        const calls = vi.fn(async () => {
          throw createRuntimeError("llm_failed");
        });
        install(services, calls);
        const runtime = createRuntime({
          services,
          operationRetryPolicies: {
            [operation]: {
              maxAttempts: 2,
              retryDelayMs: 25,
              retryTotalBudgetMs: 1_000,
              totalTimeoutMs: 1_000,
            },
          },
        });
        await runtime.submit(task);
        await runtime.start();
        await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(24);
        expect(calls).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await runtime.drain();
        expect(calls).toHaveBeenCalledTimes(2);
        await runtime.shutdown();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(llmCases)(
    "honors maxAttempts=1 for $operation",
    async ({ operation, task, install }) => {
      const services = createEmptyStageServices();
      const calls = vi.fn(async () => {
        throw createRuntimeError("llm_failed");
      });
      install(services, calls);
      const runtime = createRuntime({
        services,
        operationRetryPolicies: policies(1),
      });
      await runtime.submit(task);
      await runtime.start();
      await runtime.drain();
      expect(calls).toHaveBeenCalledTimes(1);
      await runtime.shutdown();
    },
  );

  it("does not begin a second attempt when first attempt plus delay exhausts budget", async () => {
    vi.useFakeTimers();
    try {
      const services = createEmptyStageServices();
      const calls = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
        throw createRuntimeError("llm_failed");
      });
      services.process = calls;
      const runtime = createRuntime({
        services,
        operationRetryPolicies: policies(2, 30, 100),
      });
      await runtime.submit({
        type: "PROCESS",
        source_item_id: "source-item-budget",
      });
      await runtime.start();
      await vi.advanceTimersByTimeAsync(100);
      await runtime.drain();
      expect(calls).toHaveBeenCalledTimes(1);
      await runtime.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses distinct signals, does not let a late first result dispatch, and dispatches second success once", async () => {
    const first = createDeferred<ReturnType<typeof createProcessResult>>();
    const signals: AbortSignal[] = [];
    const downstream: string[] = [];
    const services = createEmptyStageServices();
    let calls = 0;
    services.process = async (_id, options) => {
      calls += 1;
      if (options?.signal !== undefined) signals.push(options.signal);
      if (calls === 1) return first.promise;
      return createProcessResult("content-second", ["KNOWLEDGE"]);
    };
    services.analyzeKnowledge = async (id) => {
      downstream.push(id);
      return createKnowledgeResult();
    };
    const runtime = createRuntime({
      services,
      operationRetryPolicies: policies(2, 0, 1_000, 20),
    });
    await runtime.submit({
      type: "PROCESS",
      source_item_id: "source-item-stale",
    });
    await runtime.start();
    await vi.waitFor(() => expect(calls).toBe(2));
    await runtime.drain();
    first.resolve(createProcessResult("content-late", ["KNOWLEDGE"]));
    await first.promise;
    await Promise.resolve();

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(downstream).toEqual(["content-second"]);
    await runtime.shutdown();
  });

  it("cancels an in-progress delay on shutdown without a second attempt", async () => {
    const services = createEmptyStageServices();
    let calls = 0;
    services.process = async () => {
      calls += 1;
      throw createRuntimeError("llm_failed");
    };
    const runtime = createRuntime({
      services,
      operationRetryPolicies: policies(2, 60_000),
    });
    await runtime.submit({
      type: "PROCESS",
      source_item_id: "source-item-delay-shutdown",
    });
    await runtime.start();
    await vi.waitFor(() => expect(calls).toBe(1));
    const startedAt = Date.now();
    await runtime.shutdown({ timeoutMs: 10 });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(calls).toBe(1);
  });

  it("keeps existing two immediate attempts for non-LLM stages", async () => {
    const services = createEmptyStageServices();
    let calls = 0;
    services.collect = async () => {
      calls += 1;
      throw createRuntimeError("collection_failed");
    };
    const runtime = createRuntime({
      services,
      operationRetryPolicies: policies(1),
    });
    await runtime.submit({ type: "COLLECT", source_id: "source-collect" });
    await runtime.start();
    await runtime.drain();
    expect(calls).toBe(2);
    await runtime.shutdown();
  });

  it("does not dispatch an empty late event result", async () => {
    const first =
      createDeferred<ReturnType<typeof createEventAnalysisResult>>();
    const second =
      createDeferred<ReturnType<typeof createEventAnalysisResult>>();
    let calls = 0;
    let topicCalls = 0;
    const services = createEmptyStageServices();
    services.analyzeEvent = async () => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    };
    services.matchTopics = async () => {
      topicCalls += 1;
      return createTopicMatchingResult(false);
    };
    const runtime = createRuntime({
      services,
      operationRetryPolicies: policies(2, 0, 1_000, 20),
    });
    await runtime.submit({
      type: "EVENT_ANALYSIS",
      content_id: "content-late",
    });
    await runtime.start();
    await vi.waitFor(() => expect(calls).toBe(2));
    second.resolve(createEventAnalysisResult());
    await runtime.drain();
    first.resolve(
      createEventAnalysisResult([{ target_type: "EVENT", target_id: "late" }]),
    );
    await Promise.resolve();
    expect(topicCalls).toBe(0);
    await runtime.shutdown();
  });
});
