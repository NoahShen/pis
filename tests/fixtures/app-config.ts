import { resolve } from "node:path";

import type { AppConfig } from "../../src/config.js";

export const TEST_API_TOKEN = "test-api-token";
export const TEST_LLM_ENDPOINT =
  "https://test-llm.example.test/v1/chat/completions";
export const TEST_LLM_API_KEY = "test-llm-api-key";
export const TEST_LLM_MODEL = "test-llm-model";
export const TEST_PROMPTS_DIR = resolve("config/prompts");

export function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    apiToken: TEST_API_TOKEN,
    logLevel: "silent",
    databasePath: resolve("data/pis.sqlite"),
    llmEndpoint: TEST_LLM_ENDPOINT,
    llmApiKey: TEST_LLM_API_KEY,
    llmModel: TEST_LLM_MODEL,
    promptsDirectory: TEST_PROMPTS_DIR,
    rssSsrfProtection: true,
    cronTimezone: "Asia/Shanghai",
    ...overrides,
  };
}

export function testEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    API_TOKEN: TEST_API_TOKEN,
    PIS_LLM_ENDPOINT: TEST_LLM_ENDPOINT,
    PIS_LLM_API_KEY: TEST_LLM_API_KEY,
    PIS_LLM_MODEL: TEST_LLM_MODEL,
    PROMPTS_DIR: TEST_PROMPTS_DIR,
    RSS_SSRF_PROTECTION: "true",
    CRON_TIMEZONE: "Asia/Shanghai",
    ...overrides,
  };
}
