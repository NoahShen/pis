import { describe, expect, it } from "vitest";

import { ChatCompletionsError } from "../../src/llm/chat-completions-client.js";
import { LlmOutputValidationError } from "../../src/llm/response-validators.js";
import { classifyTaskError } from "../../src/runtime/index.js";

describe("LLM failure summary runtime classification", () => {
  it("uses a valid summary after cancellation and preserves its safe log fields", () => {
    expect(
      classifyTaskError({
        code: "llm_failed",
        llmFailure: {
          operation: "event-search",
          category: "http",
          reason: "LLM_HTTP_ERROR",
          retryable: false,
          httpStatus: 400,
        },
      }),
    ).toEqual({
      category: "non_retryable",
      reason: "LLM_HTTP_ERROR",
      llmFailure: {
        operation: "event-search",
        category: "http",
        reason: "LLM_HTTP_ERROR",
        retryable: false,
        httpStatus: 400,
      },
    });
  });

  it("summarizes typed failures without reading sensitive message fields", () => {
    const error = new ChatCompletionsError("LLM_TIMEOUT");
    expect(classifyTaskError(error)).toMatchObject({
      category: "retryable",
      reason: "LLM_TIMEOUT",
      llmFailure: { operation: null, category: "timeout" },
    });
    expect(
      classifyTaskError(
        new LlmOutputValidationError("LLM_OUTPUT_CONFLICT", "event-analysis"),
      ),
    ).toMatchObject({ category: "retryable", reason: "LLM_OUTPUT_CONFLICT" });
  });

  it("ignores malformed, hostile, or unwhitelisted summaries", () => {
    const malformed = [
      {
        operation: "invalid",
        category: "http",
        reason: "LLM_HTTP_ERROR",
        retryable: false,
      },
      {
        operation: null,
        category: "http",
        reason: "private",
        retryable: false,
      },
      {
        operation: null,
        category: "http",
        reason: "LLM_HTTP_ERROR",
        retryable: "false",
      },
      {
        operation: null,
        category: "http",
        reason: "LLM_HTTP_ERROR",
        retryable: false,
        httpStatus: 42,
      },
    ];
    for (const llmFailure of malformed) {
      expect(classifyTaskError({ code: "llm_failed", llmFailure })).toEqual({
        category: "retryable",
        reason: "llm_failed",
      });
    }
    expect(
      classifyTaskError({
        code: "llm_failed",
        get llmFailure(): never {
          throw new Error("private getter");
        },
      }),
    ).toEqual({ category: "retryable", reason: "llm_failed" });
  });
});

describe("RUN-15_CLASSIFY stable runtime task error classification", () => {
  it("RUN-15_CLASSIFY maps every business failure code to retryable", () => {
    const retryableCodes = [
      "llm_failed",
      "collection_failed",
      "processing_failed",
      "event_analysis_failed",
      "knowledge_failed",
      "topic_matching_failed",
    ];

    for (const code of retryableCodes) {
      expect(classifyTaskError({ code })).toEqual({
        category: "retryable",
        reason: code,
      });
    }
  });

  it("RUN-15_CLASSIFY maps invalid references and unsupported sources to non_retryable", () => {
    for (const code of [
      "invalid_input",
      "target_not_found",
      "unsupported_source",
    ]) {
      expect(classifyTaskError({ code })).toEqual({
        category: "non_retryable",
        reason: code,
      });
    }
  });

  it("RUN-15_CLASSIFY gives cancellation priority over every other code", () => {
    expect(
      classifyTaskError({ name: "AbortError", code: "invalid_input" }),
    ).toEqual({
      category: "cancelled",
      reason: "AbortError",
    });
    expect(classifyTaskError({ code: "ABORT_ERR" })).toEqual({
      category: "cancelled",
      reason: "ABORT_ERR",
    });
    expect(classifyTaskError({ code: "LLM_CANCELLED" })).toEqual({
      category: "cancelled",
      reason: "LLM_CANCELLED",
    });
    expect(classifyTaskError({ code: "aborted" })).toEqual({
      category: "cancelled",
      reason: "aborted",
    });
  });
});

describe("SQLITE_BUSY runtime classification", () => {
  it("SQLITE_BUSY retries BUSY and LOCKED variants but not constraint failures", () => {
    for (const code of [
      "SQLITE_BUSY",
      "SQLITE_BUSY_SNAPSHOT",
      "SQLITE_LOCKED",
      "SQLITE_LOCKED_SHAREDCACHE",
    ]) {
      expect(classifyTaskError({ code })).toEqual({
        category: "retryable",
        reason: code,
      });
    }

    expect(classifyTaskError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toEqual({
      category: "non_retryable",
      reason: "SQLITE_CONSTRAINT_UNIQUE",
    });
  });
});

describe("UNKNOWN_TECH task error classification", () => {
  it("UNKNOWN_TECH defaults to retryable without retaining message, cause, SQL, or URL", () => {
    const privateMessage = "private body at https://private.example.test SQL";
    const result = classifyTaskError(new Error(privateMessage));

    expect(result).toEqual({
      category: "retryable",
      reason: "unknown_error",
    });
    expect(result).not.toHaveProperty("cause");
    expect(JSON.stringify(result)).not.toContain(privateMessage);
    expect(JSON.stringify(result)).not.toContain("private.example.test");
  });

  it("UNKNOWN_TECH handles hostile field accessors without leaking their failures", () => {
    const hostileInput = new Proxy(
      {},
      {
        get: () => {
          throw new Error("getter failure with private details");
        },
      },
    );

    expect(classifyTaskError(hostileInput)).toEqual({
      category: "retryable",
      reason: "unknown_error",
    });
  });
});
