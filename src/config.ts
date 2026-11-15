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
}

export type ConfigPath = "HOST" | "PORT" | "API_TOKEN" | "LOG_LEVEL";

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
const DECIMAL_PORT = /^[0-9]+$/;
const WHITESPACE = /\s/u;

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
  LOG_LEVEL: z.enum(LOG_LEVELS, {
    message: "must be one of fatal, error, warn, info, debug, trace, silent",
  }).optional(),
});

const CONFIG_PATHS = new Set<ConfigPath>([
  "HOST",
  "PORT",
  "API_TOKEN",
  "LOG_LEVEL",
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

  return {
    host: result.data.HOST ?? DEFAULT_HOST,
    port: result.data.PORT === undefined ? DEFAULT_PORT : Number(result.data.PORT),
    apiToken: result.data.API_TOKEN,
    logLevel: result.data.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
  };
}
