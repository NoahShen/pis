import { resolve } from "node:path";

import { z } from "zod";

import {
  LLM_OPERATION_ENV_PREFIXES,
  LlmOperationPolicyConfigError,
  resolveLlmOperationPolicies,
  type LlmOperationEnvironmentKey,
  type LlmOperationPolicies,
} from "./llm/operation-policy.js";

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  host: string;
  port: number;
  apiToken: string;
  logLevel: LogLevel;
  databasePath?: string;
  llmEndpoint: string;
  llmApiKey: string;
  llmModel: string;
  llmOperationPolicies: LlmOperationPolicies;
  promptsDirectory: string;
  rssSsrfProtection: boolean;
  cronTimezone: string;
  rssPages?: RssPagesConfig;
}

export interface RssPagesConfig {
  repository: string;
  branch: string;
  workDirectory: string;
  publicOrigin: string;
  publicDirectory: string;
  publishTimeoutMs: number;
  pollIntervalMs: number;
}

export type ConfigPath =
  | LlmOperationEnvironmentKey
  | "HOST"
  | "PORT"
  | "API_TOKEN"
  | "LOG_LEVEL"
  | "DATABASE_PATH"
  | "PIS_LLM_ENDPOINT"
  | "PIS_LLM_API_KEY"
  | "PIS_LLM_MODEL"
  | "PROMPTS_DIR"
  | "RSS_SSRF_PROTECTION"
  | "CRON_TIMEZONE"
  | "RSS_PAGES_REPOSITORY"
  | "RSS_PAGES_BRANCH"
  | "RSS_PAGES_WORK_DIRECTORY"
  | "RSS_PAGES_PUBLIC_ORIGIN"
  | "RSS_PAGES_PUBLIC_DIRECTORY"
  | "RSS_PAGES_PUBLISH_TIMEOUT_MS"
  | "RSS_PAGES_POLL_INTERVAL_MS";

export class ConfigError extends Error {
  readonly path: ConfigPath;
  readonly reason: string;

  constructor(path: ConfigPath, reason: string) {
    super(`Invalid configuration at ${path}: ${reason}`);
    this.name = "ConfigError";
    this.path = path;
    this.reason = reason;
  }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const DEFAULT_DATABASE_PATH = "data/pis.sqlite";
const DEFAULT_PROMPTS_DIRECTORY = "config/prompts";
const DEFAULT_CRON_TIMEZONE = "Asia/Shanghai";
const DECIMAL_PORT = /^[0-9]+$/;
const WHITESPACE = /\s/u;
const INVALID_LLM_ENDPOINT =
  "must be an absolute HTTP(S) URL without credentials, query, or fragment";
const DEFAULT_PAGES_ORIGIN = "https://noahshen.github.io/pis_publish";
const SAFE_REF = /^(?!.*(?:\.\.|\/\/|@\{|\\))refs\/heads\/[A-Za-z0-9._/-]+$/u;
const SAFE_PUBLIC_DIRECTORY = /^[A-Za-z0-9_-]{0,128}$/u;

function isRepository(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ssh:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return (
      /^(?:[^@\s/:]+@)?[^@\s/:]+:[^\s?#]+$/u.test(value) &&
      !value.includes("\\")
    );
  }
}

function isPublicOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      url.pathname.length > 0
    );
  } catch {
    return false;
  }
}

function pageTimeout(minimum: number, maximum: number) {
  return z
    .string()
    .regex(DECIMAL_PORT)
    .refine((value) => Number(value) >= minimum && Number(value) <= maximum, {
      message: `must be a decimal integer from ${minimum} to ${maximum}`,
    })
    .optional();
}

function isLlmEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return (
      (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
      endpoint.username.length === 0 &&
      endpoint.password.length === 0 &&
      endpoint.search.length === 0 &&
      endpoint.hash.length === 0 &&
      !value.includes("?") &&
      !value.includes("#")
    );
  } catch {
    return false;
  }
}

const environmentSchema = z.object({
  HOST: z
    .string()
    .refine((value) => value.length > 0 && value.trim() === value, {
      message: "must be non-empty without surrounding whitespace",
    })
    .optional(),
  PORT: z
    .string()
    .regex(DECIMAL_PORT, {
      message: "must be a decimal integer from 0 to 65535",
    })
    .refine((value) => Number(value) >= 0 && Number(value) <= 65_535, {
      message: "must be a decimal integer from 0 to 65535",
    })
    .optional(),
  API_TOKEN: z
    .string()
    .refine((value) => value.length > 0, {
      message: "must not be empty",
    })
    .refine((value) => !WHITESPACE.test(value), {
      message: "must not contain whitespace",
    }),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, {
      message: "must be one of fatal, error, warn, info, debug, trace, silent",
    })
    .optional(),
  DATABASE_PATH: z
    .string()
    .refine((value) => value.length > 0 && value.trim().length > 0, {
      message: "must not be empty or whitespace-only",
    })
    .optional(),
  PIS_LLM_ENDPOINT: z
    .string()
    .refine(isLlmEndpoint, { message: INVALID_LLM_ENDPOINT })
    .optional(),
  PIS_LLM_API_KEY: z
    .string()
    .refine((value) => value.length > 0, {
      message: "must not be empty",
    })
    .optional(),
  PIS_LLM_MODEL: z
    .string()
    .refine((value) => value.length > 0 && value.trim() === value, {
      message: "must be non-empty without surrounding whitespace",
    })
    .optional(),
  PROMPTS_DIR: z
    .string()
    .refine((value) => value.length > 0 && value.trim().length > 0, {
      message: "must not be empty or whitespace-only",
    })
    .optional(),
  RSS_SSRF_PROTECTION: z
    .enum(["true", "false"], {
      message: 'must be "true" or "false"',
    })
    .optional(),
  CRON_TIMEZONE: z
    .string()
    .refine((value) => value.length > 0 && value.trim().length > 0, {
      message: "must not be empty or whitespace-only",
    })
    .optional(),
  RSS_PAGES_REPOSITORY: z
    .string()
    .refine(isRepository, {
      message: "must be an SSH URL without credentials, query, or fragment",
    })
    .optional(),
  RSS_PAGES_BRANCH: z
    .string()
    .refine(
      (value) =>
        SAFE_REF.test(`refs/heads/${value}`) &&
        !/[\s~^:?*\[]/u.test(value) &&
        !value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.endsWith("."),
      { message: "must be a safe branch name" },
    )
    .optional(),
  RSS_PAGES_WORK_DIRECTORY: z
    .string()
    .refine((value) => value.trim().length > 0, {
      message: "must not be empty or whitespace-only",
    })
    .optional(),
  RSS_PAGES_PUBLIC_ORIGIN: z
    .string()
    .refine(isPublicOrigin, {
      message:
        "must be an absolute HTTPS origin without credentials, path, query, or fragment",
    })
    .optional(),
  RSS_PAGES_PUBLIC_DIRECTORY: z
    .string()
    .regex(SAFE_PUBLIC_DIRECTORY, {
      message:
        "must be empty or one directory of 1 to 128 letters, digits, underscores, or hyphens",
    })
    .optional(),
  RSS_PAGES_PUBLISH_TIMEOUT_MS: pageTimeout(1_000, 600_000),
  RSS_PAGES_POLL_INTERVAL_MS: pageTimeout(100, 60_000),
});

const CONFIG_PATHS = new Set<ConfigPath>([
  ...Object.values(LLM_OPERATION_ENV_PREFIXES).flatMap(
    (prefix) =>
      [
        `${prefix}_ENDPOINT`,
        `${prefix}_API_KEY`,
        `${prefix}_MODEL`,
        `${prefix}_FIRST_BYTE_TIMEOUT_MS`,
        `${prefix}_IDLE_TIMEOUT_MS`,
        `${prefix}_TOTAL_TIMEOUT_MS`,
        `${prefix}_MAX_RESPONSE_BYTES`,
        `${prefix}_MAX_ATTEMPTS`,
        `${prefix}_RETRY_DELAY_MS`,
        `${prefix}_RETRY_TOTAL_BUDGET_MS`,
      ] as const,
  ),
  "HOST",
  "PORT",
  "API_TOKEN",
  "LOG_LEVEL",
  "DATABASE_PATH",
  "PIS_LLM_ENDPOINT",
  "PIS_LLM_API_KEY",
  "PIS_LLM_MODEL",
  "PROMPTS_DIR",
  "RSS_SSRF_PROTECTION",
  "CRON_TIMEZONE",
  "RSS_PAGES_REPOSITORY",
  "RSS_PAGES_BRANCH",
  "RSS_PAGES_WORK_DIRECTORY",
  "RSS_PAGES_PUBLIC_ORIGIN",
  "RSS_PAGES_PUBLIC_DIRECTORY",
  "RSS_PAGES_PUBLISH_TIMEOUT_MS",
  "RSS_PAGES_POLL_INTERVAL_MS",
]);

function isConfigPath(value: unknown): value is ConfigPath {
  return typeof value === "string" && CONFIG_PATHS.has(value as ConfigPath);
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path[0];

    if (!isConfigPath(path)) {
      throw new ConfigError("API_TOKEN", "invalid configuration");
    }

    throw new ConfigError(path, issue.message);
  }

  if (result.data.PIS_LLM_ENDPOINT === undefined) {
    throw new ConfigError("PIS_LLM_ENDPOINT", "is required");
  }
  if (result.data.PIS_LLM_API_KEY === undefined) {
    throw new ConfigError("PIS_LLM_API_KEY", "is required");
  }
  if (result.data.PIS_LLM_MODEL === undefined) {
    throw new ConfigError("PIS_LLM_MODEL", "is required");
  }

  let llmOperationPolicies: LlmOperationPolicies;
  try {
    llmOperationPolicies = resolveLlmOperationPolicies(
      {
        endpoint: result.data.PIS_LLM_ENDPOINT,
        apiKey: result.data.PIS_LLM_API_KEY,
        model: result.data.PIS_LLM_MODEL,
      },
      env,
    );
  } catch (error) {
    if (error instanceof LlmOperationPolicyConfigError) {
      throw new ConfigError(error.path, error.reason);
    }
    throw error;
  }

  const pagesKeys = [
    "RSS_PAGES_REPOSITORY",
    "RSS_PAGES_BRANCH",
    "RSS_PAGES_WORK_DIRECTORY",
    "RSS_PAGES_PUBLIC_ORIGIN",
    "RSS_PAGES_PUBLIC_DIRECTORY",
    "RSS_PAGES_PUBLISH_TIMEOUT_MS",
    "RSS_PAGES_POLL_INTERVAL_MS",
  ] as const;
  const pagesEnabled = pagesKeys.some((key) => result.data[key] !== undefined);
  const rssPages = pagesEnabled
    ? {
        repository: result.data.RSS_PAGES_REPOSITORY!,
        branch: result.data.RSS_PAGES_BRANCH ?? "main",
        workDirectory: resolve(
          result.data.RSS_PAGES_WORK_DIRECTORY ?? "data/rss-pages",
        ),
        publicOrigin: (
          result.data.RSS_PAGES_PUBLIC_ORIGIN ?? DEFAULT_PAGES_ORIGIN
        ).replace(/\/+$/u, ""),
        publicDirectory: result.data.RSS_PAGES_PUBLIC_DIRECTORY ?? "",
        publishTimeoutMs: Number(
          result.data.RSS_PAGES_PUBLISH_TIMEOUT_MS ?? 120_000,
        ),
        pollIntervalMs: Number(result.data.RSS_PAGES_POLL_INTERVAL_MS ?? 5_000),
      }
    : undefined;
  if (pagesEnabled && rssPages?.repository === undefined) {
    throw new ConfigError(
      "RSS_PAGES_REPOSITORY",
      "is required when Pages publishing is enabled",
    );
  }

  return {
    host: result.data.HOST ?? DEFAULT_HOST,
    port:
      result.data.PORT === undefined ? DEFAULT_PORT : Number(result.data.PORT),
    apiToken: result.data.API_TOKEN,
    logLevel: result.data.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    databasePath: resolve(result.data.DATABASE_PATH ?? DEFAULT_DATABASE_PATH),
    llmEndpoint: result.data.PIS_LLM_ENDPOINT,
    llmApiKey: result.data.PIS_LLM_API_KEY,
    llmModel: result.data.PIS_LLM_MODEL,
    llmOperationPolicies,
    promptsDirectory: resolve(
      result.data.PROMPTS_DIR ?? DEFAULT_PROMPTS_DIRECTORY,
    ),
    rssSsrfProtection: result.data.RSS_SSRF_PROTECTION !== "false",
    cronTimezone: result.data.CRON_TIMEZONE ?? DEFAULT_CRON_TIMEZONE,
    rssPages,
  };
}
