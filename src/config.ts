import { resolve } from "node:path";

import { z } from "zod";

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
  promptsDirectory: string;
  rssSsrfProtection: boolean;
  cronTimezone: string;
}

export type ConfigPath =
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
  | "CRON_TIMEZONE";

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
});

const CONFIG_PATHS = new Set<ConfigPath>([
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
    promptsDirectory: resolve(
      result.data.PROMPTS_DIR ?? DEFAULT_PROMPTS_DIRECTORY,
    ),
    rssSsrfProtection: result.data.RSS_SSRF_PROTECTION !== "false",
    cronTimezone: result.data.CRON_TIMEZONE ?? DEFAULT_CRON_TIMEZONE,
  };
}
