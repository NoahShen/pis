import { describe, expect, it } from "vitest";

import { classifyTaskError } from "../../src/runtime/index.js";

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
