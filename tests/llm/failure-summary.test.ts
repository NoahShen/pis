import { describe, expect, it } from "vitest";

import { ChatCompletionsError } from "../../src/llm/chat-completions-client.js";
import { summarizeLlmFailure } from "../../src/llm/failure-summary.js";
import { LlmOutputValidationError } from "../../src/llm/response-validators.js";

const SENSITIVE_SENTINELS = [
  "provider-secret-message",
  "https://secret.example.test/private",
  "Bearer secret-token",
  "private prompt and response body",
  "SELECT * FROM private_table",
  "/private/stack/path",
] as const;

function expectNoSecrets(summary: unknown): void {
  const serialized = JSON.stringify(summary);
  for (const sentinel of SENSITIVE_SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe("summarizeLlmFailure", () => {
  it("summarizes client lifecycle configuration HTTP and size failures", () => {
    const cases = [
      ["LLM_CONFIG_INVALID", undefined, "configuration", false],
      ["LLM_CANCELLED", undefined, "cancellation", false],
      ["LLM_TIMEOUT", undefined, "timeout", true],
      ["LLM_NETWORK_ERROR", undefined, "network", true],
      ["LLM_RESPONSE_TOO_LARGE", undefined, "response_size", false],
      ["LLM_HTTP_ERROR", 400, "http", false],
      ["LLM_HTTP_ERROR", 401, "http", false],
      ["LLM_HTTP_ERROR", 403, "http", false],
      ["LLM_HTTP_ERROR", 404, "http", false],
      ["LLM_HTTP_ERROR", 429, "http", true],
      ["LLM_HTTP_ERROR", 500, "http", true],
      ["LLM_HTTP_ERROR", 503, "http", true],
    ] as const;

    for (const [code, status, category, retryable] of cases) {
      const error = new ChatCompletionsError(code, status);
      const summary = summarizeLlmFailure(error, "event-search");
      expect(summary).toEqual({
        operation: "event-search",
        category,
        reason: code,
        retryable,
        ...(status === undefined ? {} : { httpStatus: status }),
      });
      expectNoSecrets(summary);
    }
  });

  it("summarizes protocol subreasons with the approved retry matrix", () => {
    const cases = [
      ["LLM_RESPONSE_MALFORMED", true],
      ["LLM_CONTENT_EMPTY", true],
      ["LLM_FINISH_REASON_INVALID", true],
      ["LLM_OUTPUT_TRUNCATED", true],
      ["LLM_REFUSAL", false],
      ["LLM_TOOL_CALL_UNEXPECTED", false],
    ] as const;

    for (const [reason, retryable] of cases) {
      const error = new ChatCompletionsError(
        "LLM_RESPONSE_PROTOCOL_ERROR",
        undefined,
        reason,
      );
      expect(error).toMatchObject({
        code: "LLM_RESPONSE_PROTOCOL_ERROR",
        category: "response_protocol",
        retryable,
        status: undefined,
        reason,
      });
      expect(summarizeLlmFailure(error)).toEqual({
        operation: null,
        category: "response_protocol",
        reason,
        retryable,
      });
    }
  });

  it("summarizes output errors using an explicit or validated embedded operation", () => {
    const codes = [
      "LLM_OUTPUT_JSON_INVALID",
      "LLM_OUTPUT_SCHEMA_INVALID",
      "LLM_OUTPUT_REFERENCE_INVALID",
      "LLM_OUTPUT_CONFLICT",
    ] as const;

    for (const code of codes) {
      expect(
        summarizeLlmFailure(
          new LlmOutputValidationError(code, "knowledge-analysis"),
        ),
      ).toEqual({
        operation: "knowledge-analysis",
        category: "output_validation",
        reason: code,
        retryable: true,
      });
    }

    expect(
      summarizeLlmFailure(
        new LlmOutputValidationError("LLM_OUTPUT_SCHEMA_INVALID", null),
        "topic-matching",
      ),
    ).toMatchObject({ operation: "topic-matching" });
  });

  it("returns a safe unknown summary without reading arbitrary properties", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      "provider-secret-message",
      new Error("provider-secret-message"),
      42,
      {},
      new Proxy(
        {},
        {
          get() {
            throw new Error("getter provider-secret-message");
          },
          getPrototypeOf() {
            throw new Error("prototype provider-secret-message");
          },
        },
      ),
    ];

    for (const input of inputs) {
      const summary = summarizeLlmFailure(input, "processing-route");
      expect(summary).toEqual({
        operation: "processing-route",
        category: "unknown",
        reason: "unknown_error",
        retryable: true,
      });
      expectNoSecrets(summary);
    }
  });

  it("survives malicious getters on recognized errors and validates status", () => {
    const errors = [
      new ChatCompletionsError("LLM_NETWORK_ERROR"),
      new LlmOutputValidationError("LLM_OUTPUT_JSON_INVALID", null),
    ];
    for (const error of errors) {
      Object.defineProperty(error, "code", {
        get() {
          throw new Error("provider-secret-message");
        },
      });
      expect(summarizeLlmFailure(error)).toEqual({
        operation: null,
        category: "unknown",
        reason: "unknown_error",
        retryable: true,
      });
    }

    const invalidStatus = new ChatCompletionsError("LLM_HTTP_ERROR", 503);
    Object.defineProperty(invalidStatus, "status", {
      get() {
        throw new Error("provider-secret-message");
      },
    });
    expect(summarizeLlmFailure(invalidStatus)).toMatchObject({
      reason: "unknown_error",
    });
  });
});
