import type { LlmOperation } from "../prompt/prompt-repository.js";
import { LLM_OPERATIONS } from "../prompt/prompt-repository.js";

import type { StreamingChatCompletionsConfig } from "./streaming-chat-completions-client.js";
import {
  DEFAULT_STREAM_MAX_EVENTS,
  DEFAULT_STREAM_MAX_RESPONSE_BYTES,
} from "./streaming-chat-completions-client.js";

export interface LlmOperationPolicy {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly stream: true;
  readonly firstByteTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxAttempts: 1 | 2;
  readonly retryDelayMs: number;
  readonly retryTotalBudgetMs: number;
}

export type LlmOperationPolicies = Readonly<
  Record<LlmOperation, LlmOperationPolicy>
>;

export type LlmOperationRetryPolicy = Pick<
  LlmOperationPolicy,
  "maxAttempts" | "retryDelayMs" | "retryTotalBudgetMs" | "totalTimeoutMs"
>;

export function retryPolicyForOperation(
  policy: LlmOperationPolicy,
): LlmOperationRetryPolicy {
  return {
    maxAttempts: policy.maxAttempts,
    retryDelayMs: policy.retryDelayMs,
    retryTotalBudgetMs: policy.retryTotalBudgetMs,
    totalTimeoutMs: policy.totalTimeoutMs,
  };
}

export interface LlmOperationPolicyDefaults {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
}

export const LLM_OPERATION_ENV_PREFIXES = {
  "processing-route": "PIS_LLM_PROCESSING_ROUTE",
  "event-search": "PIS_LLM_EVENT_SEARCH",
  "event-analysis": "PIS_LLM_EVENT_ANALYSIS",
  "knowledge-analysis": "PIS_LLM_KNOWLEDGE_ANALYSIS",
  "topic-matching": "PIS_LLM_TOPIC_MATCHING",
} as const satisfies Record<LlmOperation, string>;

export const LLM_OPERATION_POLICY_DEFAULTS = Object.freeze({
  firstByteTimeoutMs: 60_000,
  idleTimeoutMs: 60_000,
  totalTimeoutMs: 60_000,
  maxResponseBytes: DEFAULT_STREAM_MAX_RESPONSE_BYTES,
  maxAttempts: 2 as const,
  retryDelayMs: 0,
  retryTotalBudgetMs: 60_000,
});

export const LLM_OPERATION_POLICY_LIMITS = Object.freeze({
  timeoutMs: 600_000,
  retryTotalBudgetMs: 1_200_000,
  retryDelayMs: 60_000,
  maxResponseBytes: 16 * 1024 * 1024,
});

const ENVIRONMENT_FIELDS = {
  endpoint: "ENDPOINT",
  apiKey: "API_KEY",
  model: "MODEL",
  firstByteTimeoutMs: "FIRST_BYTE_TIMEOUT_MS",
  idleTimeoutMs: "IDLE_TIMEOUT_MS",
  totalTimeoutMs: "TOTAL_TIMEOUT_MS",
  maxResponseBytes: "MAX_RESPONSE_BYTES",
  maxAttempts: "MAX_ATTEMPTS",
  retryDelayMs: "RETRY_DELAY_MS",
  retryTotalBudgetMs: "RETRY_TOTAL_BUDGET_MS",
} as const;

export type LlmOperationEnvironmentKey =
  `${(typeof LLM_OPERATION_ENV_PREFIXES)[LlmOperation]}_${(typeof ENVIRONMENT_FIELDS)[keyof typeof ENVIRONMENT_FIELDS]}`;

const DECIMAL_INTEGER = /^[0-9]+$/u;
const INVALID_ENDPOINT =
  "must be an absolute HTTP(S) URL without credentials, query, or fragment";

export class LlmOperationPolicyConfigError extends Error {
  readonly path: LlmOperationEnvironmentKey;
  readonly reason: string;

  constructor(path: LlmOperationEnvironmentKey, reason: string) {
    super(`Invalid configuration at ${path}: ${reason}`);
    this.name = "LlmOperationPolicyConfigError";
    this.path = path;
    this.reason = reason;
  }
}

function environmentKey(
  operation: LlmOperation,
  field: keyof typeof ENVIRONMENT_FIELDS,
): LlmOperationEnvironmentKey {
  return `${LLM_OPERATION_ENV_PREFIXES[operation]}_${ENVIRONMENT_FIELDS[field]}` as LlmOperationEnvironmentKey;
}

function isValidEndpoint(value: string): boolean {
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

function integerValue(
  operation: LlmOperation,
  field:
    | "firstByteTimeoutMs"
    | "idleTimeoutMs"
    | "totalTimeoutMs"
    | "maxResponseBytes"
    | "retryTotalBudgetMs",
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const path = environmentKey(operation, field);
  const reason = `must be a decimal integer from 1 to ${maximum}`;
  if (!DECIMAL_INTEGER.test(value)) {
    throw new LlmOperationPolicyConfigError(path, reason);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new LlmOperationPolicyConfigError(path, reason);
  }
  return parsed;
}

function retryDelayValue(
  operation: LlmOperation,
  value: string | undefined,
): number {
  if (value === undefined) {
    return LLM_OPERATION_POLICY_DEFAULTS.retryDelayMs;
  }
  const path = environmentKey(operation, "retryDelayMs");
  const reason = `must be a decimal integer from 0 to ${LLM_OPERATION_POLICY_LIMITS.retryDelayMs}`;
  if (!DECIMAL_INTEGER.test(value)) {
    throw new LlmOperationPolicyConfigError(path, reason);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > LLM_OPERATION_POLICY_LIMITS.retryDelayMs
  ) {
    throw new LlmOperationPolicyConfigError(path, reason);
  }
  return parsed;
}

function maxAttemptsValue(
  operation: LlmOperation,
  value: string | undefined,
): 1 | 2 {
  if (value === undefined) {
    return LLM_OPERATION_POLICY_DEFAULTS.maxAttempts;
  }
  if (value === "1" || value === "2") {
    return Number(value) as 1 | 2;
  }
  throw new LlmOperationPolicyConfigError(
    environmentKey(operation, "maxAttempts"),
    "must be 1 or 2",
  );
}

export function resolveLlmOperationPolicies(
  defaults: LlmOperationPolicyDefaults,
  env: NodeJS.ProcessEnv = {},
): LlmOperationPolicies {
  const policies = {} as Record<LlmOperation, LlmOperationPolicy>;

  for (const operation of LLM_OPERATIONS) {
    const endpoint = env[environmentKey(operation, "endpoint")];
    const apiKey = env[environmentKey(operation, "apiKey")];
    const model = env[environmentKey(operation, "model")];
    if (endpoint !== undefined && !isValidEndpoint(endpoint)) {
      throw new LlmOperationPolicyConfigError(
        environmentKey(operation, "endpoint"),
        INVALID_ENDPOINT,
      );
    }
    if (apiKey !== undefined && apiKey.length === 0) {
      throw new LlmOperationPolicyConfigError(
        environmentKey(operation, "apiKey"),
        "must not be empty",
      );
    }
    if (model !== undefined && (model.length === 0 || model.trim() !== model)) {
      throw new LlmOperationPolicyConfigError(
        environmentKey(operation, "model"),
        "must be non-empty without surrounding whitespace",
      );
    }

    policies[operation] = {
      endpoint: endpoint ?? defaults.endpoint,
      apiKey: apiKey ?? defaults.apiKey,
      model: model ?? defaults.model,
      stream: true,
      firstByteTimeoutMs: integerValue(
        operation,
        "firstByteTimeoutMs",
        env[environmentKey(operation, "firstByteTimeoutMs")],
        LLM_OPERATION_POLICY_DEFAULTS.firstByteTimeoutMs,
        LLM_OPERATION_POLICY_LIMITS.timeoutMs,
      ),
      idleTimeoutMs: integerValue(
        operation,
        "idleTimeoutMs",
        env[environmentKey(operation, "idleTimeoutMs")],
        LLM_OPERATION_POLICY_DEFAULTS.idleTimeoutMs,
        LLM_OPERATION_POLICY_LIMITS.timeoutMs,
      ),
      totalTimeoutMs: integerValue(
        operation,
        "totalTimeoutMs",
        env[environmentKey(operation, "totalTimeoutMs")],
        LLM_OPERATION_POLICY_DEFAULTS.totalTimeoutMs,
        LLM_OPERATION_POLICY_LIMITS.timeoutMs,
      ),
      maxResponseBytes: integerValue(
        operation,
        "maxResponseBytes",
        env[environmentKey(operation, "maxResponseBytes")],
        LLM_OPERATION_POLICY_DEFAULTS.maxResponseBytes,
        LLM_OPERATION_POLICY_LIMITS.maxResponseBytes,
      ),
      maxAttempts: maxAttemptsValue(
        operation,
        env[environmentKey(operation, "maxAttempts")],
      ),
      retryDelayMs: retryDelayValue(
        operation,
        env[environmentKey(operation, "retryDelayMs")],
      ),
      retryTotalBudgetMs: integerValue(
        operation,
        "retryTotalBudgetMs",
        env[environmentKey(operation, "retryTotalBudgetMs")],
        LLM_OPERATION_POLICY_DEFAULTS.retryTotalBudgetMs,
        LLM_OPERATION_POLICY_LIMITS.retryTotalBudgetMs,
      ),
    };
  }

  return policies;
}

/** Resolves false when cancellation interrupts the bounded retry delay. */
export function waitForRetryDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }
  if (delayMs === 0) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    const onAbort = (): void => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function streamingConfigForOperation(
  policy: LlmOperationPolicy,
): StreamingChatCompletionsConfig {
  return {
    endpoint: policy.endpoint,
    apiKey: policy.apiKey,
    model: policy.model,
    firstByteTimeoutMs: policy.firstByteTimeoutMs,
    idleTimeoutMs: policy.idleTimeoutMs,
    totalTimeoutMs: policy.totalTimeoutMs,
    maxResponseBytes: policy.maxResponseBytes,
    maxEvents: DEFAULT_STREAM_MAX_EVENTS,
    maxContentLength: policy.maxResponseBytes,
  };
}

export { DEFAULT_STREAM_MAX_RESPONSE_BYTES };
