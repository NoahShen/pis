import { classifySqliteError } from "../database/error-classification.js";
import { ChatCompletionsError } from "../llm/chat-completions-client.js";
import { summarizeLlmFailure } from "../llm/failure-summary.js";
import type { LlmFailureSummary } from "../llm/failure-summary.js";
import { LlmOutputValidationError } from "../llm/response-validators.js";
import type { LlmOperation } from "../prompt/prompt-repository.js";
import { LLM_OPERATIONS } from "../prompt/prompt-repository.js";

const LLM_OPERATIONS_SET: ReadonlySet<string> = new Set(LLM_OPERATIONS);
const FAILURE_CATEGORIES = new Set([
  "configuration",
  "cancellation",
  "timeout",
  "network",
  "http",
  "response_protocol",
  "response_size",
  "output_validation",
  "unknown",
]);
const FAILURE_REASONS = new Set([
  "unknown_error",
  "LLM_CONFIG_INVALID",
  "LLM_CANCELLED",
  "LLM_TIMEOUT",
  "LLM_NETWORK_ERROR",
  "LLM_HTTP_ERROR",
  "LLM_RESPONSE_TOO_LARGE",
  "LLM_RESPONSE_MALFORMED",
  "LLM_CONTENT_EMPTY",
  "LLM_FINISH_REASON_INVALID",
  "LLM_OUTPUT_TRUNCATED",
  "LLM_REFUSAL",
  "LLM_TOOL_CALL_UNEXPECTED",
  "LLM_OUTPUT_JSON_INVALID",
  "LLM_OUTPUT_SCHEMA_INVALID",
  "LLM_OUTPUT_REFERENCE_INVALID",
  "LLM_OUTPUT_CONFLICT",
]);

function safeLlmFailure(error: unknown): LlmFailureSummary | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  try {
    const summary = (error as { readonly llmFailure?: unknown }).llmFailure;
    if (typeof summary !== "object" || summary === null) {
      return undefined;
    }

    const candidate = summary as {
      readonly operation?: unknown;
      readonly category?: unknown;
      readonly reason?: unknown;
      readonly retryable?: unknown;
      readonly httpStatus?: unknown;
    };
    if (
      !(
        candidate.operation === null ||
        (typeof candidate.operation === "string" &&
          LLM_OPERATIONS_SET.has(candidate.operation))
      ) ||
      typeof candidate.category !== "string" ||
      !FAILURE_CATEGORIES.has(candidate.category) ||
      typeof candidate.reason !== "string" ||
      !FAILURE_REASONS.has(candidate.reason) ||
      typeof candidate.retryable !== "boolean" ||
      (candidate.httpStatus !== undefined &&
        (typeof candidate.httpStatus !== "number" ||
          !Number.isSafeInteger(candidate.httpStatus) ||
          candidate.httpStatus < 100 ||
          candidate.httpStatus > 599))
    ) {
      return undefined;
    }

    return {
      operation: candidate.operation as LlmOperation | null,
      category: candidate.category as LlmFailureSummary["category"],
      reason: candidate.reason,
      retryable: candidate.retryable,
      ...(candidate.httpStatus === undefined
        ? {}
        : { httpStatus: candidate.httpStatus }),
    };
  } catch {
    return undefined;
  }
}

export type TaskErrorCategory = "retryable" | "non_retryable" | "cancelled";

function stableStringField(
  error: unknown,
  field: "name" | "code",
): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const value = (
      error as { readonly name?: unknown; readonly code?: unknown }
    )[field];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function classifyTaskError(error: unknown): {
  readonly category: TaskErrorCategory;
  readonly reason: string;
  readonly llmFailure?: LlmFailureSummary;
} {
  const name = stableStringField(error, "name");
  const code = stableStringField(error, "code");

  if (name === "AbortError") {
    return { category: "cancelled", reason: "AbortError" };
  }

  if (code === "ABORT_ERR" || code === "LLM_CANCELLED" || code === "aborted") {
    return { category: "cancelled", reason: code };
  }

  const llmFailure =
    error instanceof ChatCompletionsError ||
    error instanceof LlmOutputValidationError
      ? summarizeLlmFailure(error)
      : safeLlmFailure(error);
  if (llmFailure !== undefined) {
    return {
      category:
        llmFailure.category === "cancellation"
          ? "cancelled"
          : llmFailure.retryable
            ? "retryable"
            : "non_retryable",
      reason: llmFailure.reason,
      llmFailure,
    };
  }

  if (code !== undefined && code.endsWith("_failed")) {
    return { category: "retryable", reason: code };
  }

  if (
    code === "invalid_input" ||
    code === "target_not_found" ||
    code === "unsupported_source"
  ) {
    return { category: "non_retryable", reason: code };
  }

  const sqliteCategory = classifySqliteError(error);

  if (sqliteCategory === "busy_locked") {
    return { category: "retryable", reason: code ?? "busy_locked" };
  }

  if (sqliteCategory === "constraint") {
    return { category: "non_retryable", reason: code ?? "constraint" };
  }

  if (sqliteCategory === "sqlite" && code !== undefined) {
    return { category: "retryable", reason: code };
  }

  return { category: "retryable", reason: "unknown_error" };
}
