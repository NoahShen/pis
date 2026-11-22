import { describe, expect, it } from "vitest";

import {
  LLM_OPERATION_ENV_PREFIXES,
  LLM_OPERATION_POLICY_DEFAULTS,
  LLM_OPERATION_POLICY_LIMITS,
  LlmOperationPolicyConfigError,
  resolveLlmOperationPolicies,
  streamingConfigForOperation,
} from "../../src/llm/operation-policy.js";
import { LLM_OPERATIONS } from "../../src/prompt/prompt-repository.js";
import {
  TEST_LLM_API_KEY,
  TEST_LLM_ENDPOINT,
  TEST_LLM_MODEL,
} from "../fixtures/app-config.js";

const DEFAULTS = {
  endpoint: TEST_LLM_ENDPOINT,
  apiKey: TEST_LLM_API_KEY,
  model: TEST_LLM_MODEL,
} as const;

function expectPolicyError(
  env: NodeJS.ProcessEnv,
  path: string,
  reason: string,
): LlmOperationPolicyConfigError {
  let error: unknown;
  try {
    resolveLlmOperationPolicies(DEFAULTS, env);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(LlmOperationPolicyConfigError);
  expect(error).toMatchObject({ path, reason });
  expect(String(error)).not.toContain("private-sentinel");
  return error as LlmOperationPolicyConfigError;
}

describe("LLM operation policies", () => {
  it("resolves all five operations independently with compatible defaults", () => {
    const policies = resolveLlmOperationPolicies(DEFAULTS);

    expect(Object.keys(policies)).toEqual(LLM_OPERATIONS);
    for (const operation of LLM_OPERATIONS) {
      expect(policies[operation]).toEqual({
        ...DEFAULTS,
        stream: true,
        firstByteTimeoutMs: 60_000,
        idleTimeoutMs: 60_000,
        totalTimeoutMs: 60_000,
        maxResponseBytes: 2 * 1024 * 1024,
        maxAttempts: 2,
        retryDelayMs: 0,
        retryTotalBudgetMs: 60_000,
      });
    }
    expect(LLM_OPERATION_ENV_PREFIXES).toEqual({
      "processing-route": "PIS_LLM_PROCESSING_ROUTE",
      "event-search": "PIS_LLM_EVENT_SEARCH",
      "event-analysis": "PIS_LLM_EVENT_ANALYSIS",
      "knowledge-analysis": "PIS_LLM_KNOWLEDGE_ANALYSIS",
      "topic-matching": "PIS_LLM_TOPIC_MATCHING",
    });
    expect(LLM_OPERATION_POLICY_DEFAULTS.totalTimeoutMs).toBe(60_000);
  });

  it("applies every dedicated override only to its own operation", () => {
    const policies = resolveLlmOperationPolicies(DEFAULTS, {
      PIS_LLM_EVENT_ANALYSIS_ENDPOINT:
        "https://event-only.example.test/v1/chat/completions",
      PIS_LLM_EVENT_ANALYSIS_API_KEY: "event-only-key",
      PIS_LLM_EVENT_ANALYSIS_MODEL: "event-only-model",
      PIS_LLM_EVENT_ANALYSIS_FIRST_BYTE_TIMEOUT_MS: "1001",
      PIS_LLM_EVENT_ANALYSIS_IDLE_TIMEOUT_MS: "1002",
      PIS_LLM_EVENT_ANALYSIS_TOTAL_TIMEOUT_MS: "1003",
      PIS_LLM_EVENT_ANALYSIS_MAX_RESPONSE_BYTES: "1048576",
      PIS_LLM_EVENT_ANALYSIS_MAX_ATTEMPTS: "1",
      PIS_LLM_EVENT_ANALYSIS_RETRY_DELAY_MS: "25",
      PIS_LLM_EVENT_ANALYSIS_RETRY_TOTAL_BUDGET_MS: "5000",
    });

    expect(policies["event-analysis"]).toEqual({
      endpoint: "https://event-only.example.test/v1/chat/completions",
      apiKey: "event-only-key",
      model: "event-only-model",
      stream: true,
      firstByteTimeoutMs: 1001,
      idleTimeoutMs: 1002,
      totalTimeoutMs: 1003,
      maxResponseBytes: 1_048_576,
      maxAttempts: 1,
      retryDelayMs: 25,
      retryTotalBudgetMs: 5000,
    });
    expect(policies["processing-route"]).toMatchObject({
      ...DEFAULTS,
      ...LLM_OPERATION_POLICY_DEFAULTS,
    });
    expect(policies["event-search"]).toMatchObject({
      ...DEFAULTS,
      ...LLM_OPERATION_POLICY_DEFAULTS,
    });
  });

  it("accepts legal safety boundaries and a zero retry delay", () => {
    const policies = resolveLlmOperationPolicies(DEFAULTS, {
      PIS_LLM_PROCESSING_ROUTE_FIRST_BYTE_TIMEOUT_MS:
        LLM_OPERATION_POLICY_LIMITS.timeoutMs.toString(),
      PIS_LLM_EVENT_SEARCH_RETRY_TOTAL_BUDGET_MS:
        LLM_OPERATION_POLICY_LIMITS.retryTotalBudgetMs.toString(),
      PIS_LLM_KNOWLEDGE_ANALYSIS_MAX_RESPONSE_BYTES:
        LLM_OPERATION_POLICY_LIMITS.maxResponseBytes.toString(),
      PIS_LLM_TOPIC_MATCHING_RETRY_DELAY_MS: "0",
    });

    expect(policies["processing-route"].firstByteTimeoutMs).toBe(
      LLM_OPERATION_POLICY_LIMITS.timeoutMs,
    );
    expect(policies["event-search"].retryTotalBudgetMs).toBe(
      LLM_OPERATION_POLICY_LIMITS.retryTotalBudgetMs,
    );
    expect(policies["knowledge-analysis"].maxResponseBytes).toBe(
      LLM_OPERATION_POLICY_LIMITS.maxResponseBytes,
    );
    expect(policies["topic-matching"].retryDelayMs).toBe(0);
  });

  it.each([
    "FIRST_BYTE_TIMEOUT_MS",
    "IDLE_TIMEOUT_MS",
    "TOTAL_TIMEOUT_MS",
    "MAX_RESPONSE_BYTES",
    "RETRY_TOTAL_BUDGET_MS",
  ])(
    "rejects invalid positive integer field %s without echoing input",
    (field) => {
      for (const value of [
        "0",
        "-1",
        "1.5",
        "1e3",
        " 1",
        "1 ",
        "",
        "Infinity",
      ]) {
        expectPolicyError(
          { [`PIS_LLM_PROCESSING_ROUTE_${field}`]: value },
          `PIS_LLM_PROCESSING_ROUTE_${field}`,
          expect.stringMatching(/^must be a decimal integer from 1 to /),
        );
      }
    },
  );

  it("rejects values above safety limits", () => {
    expectPolicyError(
      { PIS_LLM_EVENT_SEARCH_TOTAL_TIMEOUT_MS: "600001" },
      "PIS_LLM_EVENT_SEARCH_TOTAL_TIMEOUT_MS",
      "must be a decimal integer from 1 to 600000",
    );
    expectPolicyError(
      { PIS_LLM_EVENT_SEARCH_RETRY_DELAY_MS: "60001" },
      "PIS_LLM_EVENT_SEARCH_RETRY_DELAY_MS",
      "must be a decimal integer from 0 to 60000",
    );
    expectPolicyError(
      { PIS_LLM_EVENT_SEARCH_MAX_ATTEMPTS: "3" },
      "PIS_LLM_EVENT_SEARCH_MAX_ATTEMPTS",
      "must be 1 or 2",
    );
    for (const value of ["0", "-1", "01", "1.0", "private-sentinel"]) {
      expectPolicyError(
        { PIS_LLM_EVENT_SEARCH_MAX_ATTEMPTS: value },
        "PIS_LLM_EVENT_SEARCH_MAX_ATTEMPTS",
        "must be 1 or 2",
      );
    }
  });

  it("validates dedicated endpoints, keys, and models", () => {
    expectPolicyError(
      {
        PIS_LLM_KNOWLEDGE_ANALYSIS_ENDPOINT:
          "https://user:private-sentinel@example.test/v1",
      },
      "PIS_LLM_KNOWLEDGE_ANALYSIS_ENDPOINT",
      "must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
    expectPolicyError(
      { PIS_LLM_KNOWLEDGE_ANALYSIS_API_KEY: "" },
      "PIS_LLM_KNOWLEDGE_ANALYSIS_API_KEY",
      "must not be empty",
    );
    expectPolicyError(
      { PIS_LLM_KNOWLEDGE_ANALYSIS_MODEL: " private-sentinel" },
      "PIS_LLM_KNOWLEDGE_ANALYSIS_MODEL",
      "must be non-empty without surrounding whitespace",
    );
  });

  it("maps the exact policy to bounded streaming client configuration", () => {
    const policy = resolveLlmOperationPolicies(DEFAULTS, {
      PIS_LLM_TOPIC_MATCHING_TOTAL_TIMEOUT_MS: "12000",
      PIS_LLM_TOPIC_MATCHING_MAX_RESPONSE_BYTES: "4096",
    })["topic-matching"];

    expect(streamingConfigForOperation(policy)).toEqual({
      ...DEFAULTS,
      firstByteTimeoutMs: 60_000,
      idleTimeoutMs: 60_000,
      totalTimeoutMs: 12_000,
      maxResponseBytes: 4096,
      maxEvents: 32_768,
      maxContentLength: 4096,
    });
    expect(streamingConfigForOperation(policy)).not.toHaveProperty(
      "maxAttempts",
    );
    expect(streamingConfigForOperation(policy)).not.toHaveProperty(
      "retryDelayMs",
    );
    expect(streamingConfigForOperation(policy)).not.toHaveProperty(
      "retryTotalBudgetMs",
    );
  });
});
