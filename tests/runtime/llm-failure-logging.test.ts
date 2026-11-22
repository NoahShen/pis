import { describe, expect, it } from "vitest";

import { ProcessingError } from "../../src/processing/processing-errors.js";
import { EventSearchError } from "../../src/event-search/event-search-errors.js";
import { EventAnalysisError } from "../../src/event-analysis/event-analysis-errors.js";
import { KnowledgeError } from "../../src/knowledge/knowledge-errors.js";
import { TopicMatchingError } from "../../src/topic-matching/topic-matching-errors.js";
import type { LlmFailureSummary } from "../../src/llm/failure-summary.js";
import type { RuntimeLogEntry } from "../../src/runtime/contracts.js";
import { createRuntime } from "../../src/runtime/runtime.js";
import { logRuntime } from "../../src/runtime/runtime-logger.js";
import {
  createCollectResult,
  createCollectTask,
  createEmptyStageServices,
  createProcessResult,
} from "../fixtures/runtime.js";

function llmFailure(
  overrides: Partial<LlmFailureSummary> = {},
): LlmFailureSummary {
  return {
    operation: "processing-route",
    category: "network",
    reason: "LLM_NETWORK_ERROR",
    retryable: true,
    ...overrides,
  };
}

function failingService(
  summary: LlmFailureSummary,
  calls: { count: number },
  succeedOnSecond = false,
) {
  return async () => {
    calls.count += 1;
    if (succeedOnSecond && calls.count === 2) {
      return createCollectResult(["source-item-llm-success"]);
    }
    throw Object.assign(new Error("PRIVATE_PROVIDER_TOKEN_AND_PROMPT"), {
      code: "llm_failed",
      llmFailure: summary,
      cause: "PRIVATE_CAUSE",
    });
  };
}

describe("Runtime LLM failure retry matrix and logs", () => {
  it.each([
    ["processing-route", "PROCESS", new ProcessingError("llm_failed")],
    ["event-analysis", "EVENT_ANALYSIS", new EventAnalysisError("llm_failed")],
    [
      "knowledge-analysis",
      "KNOWLEDGE_ANALYSIS",
      new KnowledgeError("llm_failed"),
    ],
    ["topic-matching", "TOPIC_MATCHING", new TopicMatchingError("llm_failed")],
  ] as const)(
    "logs the fixed %s operation from a business error",
    async (operation, stage, error) => {
      const entries: RuntimeLogEntry[] = [];
      const services = createEmptyStageServices();
      const businessError = Object.assign(error, {
        llmFailure: llmFailure({ operation, retryable: false }),
      });
      if (stage === "PROCESS")
        services.process = async () => {
          throw businessError;
        };
      if (stage === "EVENT_ANALYSIS")
        services.analyzeEvent = async () => {
          throw businessError;
        };
      if (stage === "KNOWLEDGE_ANALYSIS")
        services.analyzeKnowledge = async () => {
          throw businessError;
        };
      if (stage === "TOPIC_MATCHING")
        services.matchTopics = async () => {
          throw businessError;
        };
      const task =
        stage === "PROCESS"
          ? ({ type: stage, source_item_id: "source-item-operation" } as const)
          : stage === "EVENT_ANALYSIS" || stage === "KNOWLEDGE_ANALYSIS"
            ? ({ type: stage, content_id: "content-operation" } as const)
            : ({
                type: stage,
                target_type: "EVENT",
                target_id: "target-operation",
              } as const);
      const runtime = createRuntime({
        services,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
      });

      await runtime.submit(task);
      await runtime.start();
      await runtime.drain();

      expect(entries).toEqual([
        expect.objectContaining({
          operation,
          stage,
          retryable: false,
          final: true,
        }),
      ]);
      await runtime.shutdown();
    },
  );

  it("logs the fixed event-search operation from an upstream business error", async () => {
    const entries: RuntimeLogEntry[] = [];
    const services = createEmptyStageServices();
    services.analyzeEvent = async () => {
      throw new EventSearchError(
        "llm_failed",
        llmFailure({
          operation: "event-search",
          retryable: false,
        }),
      );
    };
    const runtime = createRuntime({
      services,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });

    await runtime.submit({
      type: "EVENT_ANALYSIS",
      content_id: "content-search-operation",
    });
    await runtime.start();
    await runtime.drain();

    expect(entries).toEqual([
      expect.objectContaining({
        operation: "event-search",
        retryable: false,
        final: true,
      }),
    ]);
    await runtime.shutdown();
  });

  it.each([
    ["network", "LLM_NETWORK_ERROR", undefined],
    ["timeout", "LLM_TIMEOUT", undefined],
    ["http", "LLM_HTTP_ERROR", 429],
    ["http", "LLM_HTTP_ERROR", 503],
    ["response_protocol", "LLM_RESPONSE_MALFORMED", undefined],
    ["response_protocol", "LLM_CONTENT_EMPTY", undefined],
    ["response_protocol", "LLM_FINISH_REASON_INVALID", undefined],
    ["response_protocol", "LLM_OUTPUT_TRUNCATED", undefined],
    ["output_validation", "LLM_OUTPUT_JSON_INVALID", undefined],
    ["output_validation", "LLM_OUTPUT_SCHEMA_INVALID", undefined],
    ["output_validation", "LLM_OUTPUT_REFERENCE_INVALID", undefined],
    ["output_validation", "LLM_OUTPUT_CONFLICT", undefined],
  ] as const)(
    "retries %s / %s twice and marks only the last log final",
    async (category, reason, httpStatus) => {
      const calls = { count: 0 };
      const entries: RuntimeLogEntry[] = [];
      const services = createEmptyStageServices();
      services.collect = failingService(
        llmFailure({
          category,
          reason,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        }),
        calls,
      );
      const runtime = createRuntime({
        services,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
      });

      await runtime.submit(createCollectTask());
      await runtime.start();
      await runtime.drain();

      expect(calls.count).toBe(2);
      expect(entries).toHaveLength(2);
      expect(
        entries.map(({ attempt, final, retryable }) => ({
          attempt,
          final,
          retryable,
        })),
      ).toEqual([
        { attempt: 1, final: false, retryable: true },
        { attempt: 2, final: true, retryable: true },
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          operation: "processing-route",
          category,
          reason,
        });
        if (httpStatus !== undefined) expect(entry.httpStatus).toBe(httpStatus);
      }
      await runtime.shutdown();
    },
  );

  it.each([
    ["configuration", "LLM_CONFIG_INVALID", undefined],
    ["http", "LLM_HTTP_ERROR", 400],
    ["http", "LLM_HTTP_ERROR", 401],
    ["response_size", "LLM_RESPONSE_TOO_LARGE", undefined],
    ["response_protocol", "LLM_REFUSAL", undefined],
    ["response_protocol", "LLM_TOOL_CALL_UNEXPECTED", undefined],
  ] as const)(
    "does not retry %s / %s and emits one final log",
    async (category, reason, httpStatus) => {
      const calls = { count: 0 };
      const entries: RuntimeLogEntry[] = [];
      const services = createEmptyStageServices();
      services.collect = failingService(
        llmFailure({
          category,
          reason,
          retryable: false,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        }),
        calls,
      );
      const runtime = createRuntime({
        services,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
      });

      await runtime.submit(createCollectTask());
      await runtime.start();
      await runtime.drain();

      expect(calls.count).toBe(1);
      expect(entries).toEqual([
        expect.objectContaining({
          operation: "processing-route",
          category,
          reason,
          attempt: 1,
          retryable: false,
          final: true,
        }),
      ]);
      await runtime.shutdown();
    },
  );

  it("cancels once even when a summary claims to be retryable", async () => {
    const calls = { count: 0 };
    const entries: RuntimeLogEntry[] = [];
    const services = createEmptyStageServices();
    services.collect = failingService(
      llmFailure({ category: "cancellation", reason: "LLM_CANCELLED" }),
      calls,
    );
    const runtime = createRuntime({
      services,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });

    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(calls.count).toBe(1);
    expect(entries).toEqual([
      expect.objectContaining({
        category: "cancellation",
        reason: "LLM_CANCELLED",
        retryable: false,
        final: true,
      }),
    ]);
    await runtime.shutdown();
  });

  it("retries once, succeeds, and dispatches exactly one downstream", async () => {
    const calls = { count: 0 };
    let downstreamCalls = 0;
    const entries: RuntimeLogEntry[] = [];
    const services = createEmptyStageServices();
    services.collect = failingService(llmFailure(), calls, true);
    services.process = async () => {
      downstreamCalls += 1;
      return createProcessResult(null);
    };
    const runtime = createRuntime({
      services,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });

    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(calls.count).toBe(2);
    expect(downstreamCalls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ final: false, retryable: true });
    await runtime.shutdown();
  });

  it("falls back safely for malformed summaries and never logs their private fields", async () => {
    const calls = { count: 0 };
    const entries: RuntimeLogEntry[] = [];
    const services = createEmptyStageServices();
    services.collect = async () => {
      calls.count += 1;
      throw {
        code: "llm_failed",
        llmFailure: {
          operation: "processing-route",
          category: "http",
          reason: "PRIVATE_REASON",
          retryable: false,
          prompt: "PRIVATE_PROMPT",
        },
      };
    };
    const runtime = createRuntime({
      services,
      logger: {
        log: (entry) => {
          entries.push(entry);
        },
      },
    });

    await runtime.submit(createCollectTask());
    await runtime.start();
    await runtime.drain();

    expect(calls.count).toBe(2);
    expect(entries.map((entry) => entry.reason)).toEqual([
      "llm_failed",
      "llm_failed",
    ]);
    expect(JSON.stringify(entries)).not.toContain("PRIVATE");
    await runtime.shutdown();
  });

  it("keeps the logger whitelist strict for summaries and best-effort behavior", () => {
    const entries: RuntimeLogEntry[] = [];
    logRuntime(
      {
        log: (entry) => {
          entries.push(entry);
          throw new Error("PRIVATE_LOGGER_FAILURE");
        },
      },
      {
        stage: "PROCESS",
        operation: "processing-route",
        category: "http",
        reason: "LLM_HTTP_ERROR",
        httpStatus: 429,
        retryable: true,
        final: false,
        prompt: "PRIVATE_PROMPT",
        token: "PRIVATE_TOKEN",
      } as unknown as RuntimeLogEntry,
    );

    expect(entries).toEqual([
      {
        stage: "PROCESS",
        operation: "processing-route",
        category: "http",
        reason: "LLM_HTTP_ERROR",
        httpStatus: 429,
        retryable: true,
        final: false,
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("PRIVATE");
  });
});
