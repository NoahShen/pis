import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";
import { resolveLlmOperationPolicies } from "../src/llm/operation-policy.js";
import {
  TEST_LLM_API_KEY,
  TEST_LLM_ENDPOINT,
  TEST_LLM_MODEL,
  TEST_PROMPTS_DIR,
} from "./fixtures/app-config.js";

const REQUIRED_ENV = {
  API_TOKEN: "secret",
  PIS_LLM_ENDPOINT: TEST_LLM_ENDPOINT,
  PIS_LLM_API_KEY: TEST_LLM_API_KEY,
  PIS_LLM_MODEL: TEST_LLM_MODEL,
} as const;

const DEFAULT_OPERATION_POLICIES = resolveLlmOperationPolicies({
  endpoint: TEST_LLM_ENDPOINT,
  apiKey: TEST_LLM_API_KEY,
  model: TEST_LLM_MODEL,
});

function expectConfigError(
  env: NodeJS.ProcessEnv,
  path: ConfigError["path"],
  reason: string,
): ConfigError {
  let error: unknown;

  try {
    loadConfig(env);
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(ConfigError);
  expect(error).toMatchObject({ path, reason });
  return error as ConfigError;
}

describe("loadConfig", () => {
  it("loadConfig resolves required LLM fields and applies only unset defaults", () => {
    expect(loadConfig(REQUIRED_ENV)).toEqual({
      llmOperationPolicies: DEFAULT_OPERATION_POLICIES,
      host: "127.0.0.1",
      port: 3000,
      apiToken: "secret",
      logLevel: "info",
      databasePath: resolve("data/pis.sqlite"),
      llmEndpoint: TEST_LLM_ENDPOINT,
      llmApiKey: TEST_LLM_API_KEY,
      llmModel: TEST_LLM_MODEL,
      promptsDirectory: resolve("config/prompts"),
      rssSsrfProtection: true,
      cronTimezone: "Asia/Shanghai",
    });
  });

  it("loadConfig accepts legal overrides, PORT=0, and leaves scheduler-owned timezone validation unapplied", () => {
    expect(
      loadConfig({
        HOST: "0.0.0.0",
        PORT: "0",
        API_TOKEN: "token",
        LOG_LEVEL: "silent",
        DATABASE_PATH: "tmp/configured.sqlite",
        PIS_LLM_ENDPOINT: "http://llm.example.test:8080/v1/chat/completions",
        PIS_LLM_API_KEY: "configured-key",
        PIS_LLM_MODEL: "configured-model",
        PROMPTS_DIR: "custom/prompts",
        RSS_SSRF_PROTECTION: "false",
        CRON_TIMEZONE: "Not/A/RealZone",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 0,
      apiToken: "token",
      logLevel: "silent",
      databasePath: resolve("tmp/configured.sqlite"),
      llmEndpoint: "http://llm.example.test:8080/v1/chat/completions",
      llmApiKey: "configured-key",
      llmModel: "configured-model",
      llmOperationPolicies: resolveLlmOperationPolicies({
        endpoint: "http://llm.example.test:8080/v1/chat/completions",
        apiKey: "configured-key",
        model: "configured-model",
      }),
      promptsDirectory: resolve("custom/prompts"),
      rssSsrfProtection: false,
      cronTimezone: "Not/A/RealZone",
    });

    expect(loadConfig({ ...REQUIRED_ENV, PORT: "65535" }).port).toBe(65535);
  });

  it("loadConfig accepts a non-blank DATABASE_PATH with surrounding spaces without trimming it", () => {
    const databasePath = "  tmp/configured.sqlite  ";

    expect(
      loadConfig({ ...REQUIRED_ENV, DATABASE_PATH: databasePath }).databasePath,
    ).toBe(resolve(databasePath));
  });

  it("loadConfig ignores unknown environment variables", () => {
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        UNRELATED_VALUE: "ignored",
        NODE_ENV: "test",
      }),
    ).toEqual({
      llmOperationPolicies: DEFAULT_OPERATION_POLICIES,
      host: "127.0.0.1",
      port: 3000,
      apiToken: "secret",
      logLevel: "info",
      databasePath: resolve("data/pis.sqlite"),
      llmEndpoint: TEST_LLM_ENDPOINT,
      llmApiKey: TEST_LLM_API_KEY,
      llmModel: TEST_LLM_MODEL,
      promptsDirectory: resolve("config/prompts"),
      rssSsrfProtection: true,
      cronTimezone: "Asia/Shanghai",
    });
  });

  it("loadConfig resolves operation-specific streaming and retry policies", () => {
    const config = loadConfig({
      ...REQUIRED_ENV,
      PIS_LLM_PROCESSING_ROUTE_ENDPOINT:
        "https://route.example.test/v1/chat/completions",
      PIS_LLM_PROCESSING_ROUTE_API_KEY: "route-key",
      PIS_LLM_PROCESSING_ROUTE_MODEL: "route-model",
      PIS_LLM_PROCESSING_ROUTE_FIRST_BYTE_TIMEOUT_MS: "1000",
      PIS_LLM_PROCESSING_ROUTE_IDLE_TIMEOUT_MS: "2000",
      PIS_LLM_PROCESSING_ROUTE_TOTAL_TIMEOUT_MS: "3000",
      PIS_LLM_PROCESSING_ROUTE_MAX_RESPONSE_BYTES: "4096",
      PIS_LLM_PROCESSING_ROUTE_MAX_ATTEMPTS: "1",
      PIS_LLM_PROCESSING_ROUTE_RETRY_DELAY_MS: "10",
      PIS_LLM_PROCESSING_ROUTE_RETRY_TOTAL_BUDGET_MS: "5000",
    });

    expect(config.llmOperationPolicies["processing-route"]).toEqual({
      endpoint: "https://route.example.test/v1/chat/completions",
      apiKey: "route-key",
      model: "route-model",
      stream: true,
      firstByteTimeoutMs: 1000,
      idleTimeoutMs: 2000,
      totalTimeoutMs: 3000,
      maxResponseBytes: 4096,
      maxAttempts: 1,
      retryDelayMs: 10,
      retryTotalBudgetMs: 5000,
    });
    expect(config.llmOperationPolicies["event-search"]).toEqual(
      DEFAULT_OPERATION_POLICIES["event-search"],
    );
    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_EVENT_SEARCH_TOTAL_TIMEOUT_MS: "0" },
      "PIS_LLM_EVENT_SEARCH_TOTAL_TIMEOUT_MS",
      "must be a decimal integer from 1 to 600000",
    );
    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_TOPIC_MATCHING_MAX_ATTEMPTS: "3" },
      "PIS_LLM_TOPIC_MATCHING_MAX_ATTEMPTS",
      "must be 1 or 2",
    );
  });

  it("loadConfig rejects missing required LLM fields with stable paths and reasons", () => {
    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_ENDPOINT: undefined },
      "PIS_LLM_ENDPOINT",
      "is required",
    );
    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_API_KEY: undefined },
      "PIS_LLM_API_KEY",
      "is required",
    );
    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_MODEL: undefined },
      "PIS_LLM_MODEL",
      "is required",
    );
  });

  it("loadConfig rejects unsafe LLM endpoints, empty key, and blank model without echoing inputs", () => {
    const endpointReason =
      "must be an absolute HTTP(S) URL without credentials, query, or fragment";
    for (const endpoint of [
      "",
      "llm.example.test/v1/chat",
      "ftp://llm.example.test/v1/chat",
      "https://user:password@llm.example.test/v1/chat",
      "https://llm.example.test/v1/chat?token=query-secret",
      "https://llm.example.test/v1/chat?",
      "https://llm.example.test/v1/chat#fragment-secret",
      "https://llm.example.test/v1/chat#",
    ]) {
      expectConfigError(
        { ...REQUIRED_ENV, PIS_LLM_ENDPOINT: endpoint },
        "PIS_LLM_ENDPOINT",
        endpointReason,
      );
    }

    expectConfigError(
      { ...REQUIRED_ENV, PIS_LLM_API_KEY: "" },
      "PIS_LLM_API_KEY",
      "must not be empty",
    );
    for (const model of ["", " ", " model", "model "]) {
      expectConfigError(
        { ...REQUIRED_ENV, PIS_LLM_MODEL: model },
        "PIS_LLM_MODEL",
        "must be non-empty without surrounding whitespace",
      );
    }
  });

  it("loadConfig rejects empty Prompt directory, non-exact SSRF booleans, and empty timezone", () => {
    for (const promptsDirectory of ["", "   "]) {
      expectConfigError(
        { ...REQUIRED_ENV, PROMPTS_DIR: promptsDirectory },
        "PROMPTS_DIR",
        "must not be empty or whitespace-only",
      );
    }

    for (const protection of ["TRUE", "false ", "1", "yes", ""]) {
      expectConfigError(
        { ...REQUIRED_ENV, RSS_SSRF_PROTECTION: protection },
        "RSS_SSRF_PROTECTION",
        'must be "true" or "false"',
      );
    }

    for (const timezone of ["", "   "]) {
      expectConfigError(
        { ...REQUIRED_ENV, CRON_TIMEZONE: timezone },
        "CRON_TIMEZONE",
        "must not be empty or whitespace-only",
      );
    }
  });

  it("ConfigError messages never echo endpoint, key, model, or Prompt directory inputs", () => {
    const endpointSecret = "endpoint-query-secret";
    const keySecret = "candidate-api-key-secret";
    const modelSecret = "candidate-model-secret";
    const promptsSecret = "/candidate/prompts-secret";
    const error = expectConfigError(
      {
        API_TOKEN: "api-token-secret",
        PIS_LLM_ENDPOINT: `https://llm.example.test/v1/chat?token=${endpointSecret}`,
        PIS_LLM_API_KEY: keySecret,
        PIS_LLM_MODEL: modelSecret,
        PROMPTS_DIR: promptsSecret,
      },
      "PIS_LLM_ENDPOINT",
      "must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
    const message = String(error);

    for (const secret of [
      endpointSecret,
      keySecret,
      modelSecret,
      promptsSecret,
    ]) {
      expect(message).not.toContain(secret);
    }
  });

  it("loadConfig rejects missing, empty, or whitespace-containing API_TOKEN without echoing its value", () => {
    for (const apiToken of [undefined, "", "token with space", "line\nbreak"]) {
      let error: unknown;

      try {
        loadConfig(
          apiToken === undefined
            ? { ...REQUIRED_ENV, API_TOKEN: undefined }
            : { ...REQUIRED_ENV, API_TOKEN: apiToken },
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ path: "API_TOKEN" });
      expect(String(error)).not.toContain("token with space");
      expect(String(error)).not.toContain("line");
    }
  });

  it("loadConfig rejects invalid existing path values without echoing inputs", () => {
    const invalidValues = [
      ["HOST", ["", " host", "host "]],
      ["PORT", ["", "-1", "65536", "1.5", " 3000", "3000 ", "1e3", "abc"]],
      ["LOG_LEVEL", ["", " info", "verbose", "INFO"]],
      ["DATABASE_PATH", ["", "   ", "\t \n"]],
    ] as const;
    const safeReasons = {
      HOST: "must be non-empty without surrounding whitespace",
      PORT: "must be a decimal integer from 0 to 65535",
      LOG_LEVEL:
        "must be one of fatal, error, warn, info, debug, trace, silent",
      DATABASE_PATH: "must not be empty or whitespace-only",
    } as const;

    for (const [path, values] of invalidValues) {
      for (const value of values) {
        expectConfigError(
          { ...REQUIRED_ENV, [path]: value },
          path,
          safeReasons[path],
        );
      }
    }
  });

  it("loadConfig resolves the test Prompt fixture as an absolute existing directory", () => {
    expect(TEST_PROMPTS_DIR).toBe(resolve("config/prompts"));
    expect(loadConfig(REQUIRED_ENV).promptsDirectory).toBe(TEST_PROMPTS_DIR);
  });
});
