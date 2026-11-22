import type { LlmOperation } from "../prompt/prompt-repository.js";
import { LLM_OPERATIONS } from "../prompt/prompt-repository.js";

import { ChatCompletionsError } from "./chat-completions-client.js";
import { LlmOutputValidationError } from "./response-validators.js";

export type LlmFailureCategory =
  | "configuration"
  | "cancellation"
  | "timeout"
  | "network"
  | "http"
  | "response_protocol"
  | "response_size"
  | "output_validation"
  | "unknown";

export interface LlmFailureSummary {
  readonly operation: LlmOperation | null;
  readonly category: LlmFailureCategory;
  readonly reason: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
}

const LLM_OPERATIONS_SET: ReadonlySet<string> = new Set(LLM_OPERATIONS);

function isLlmOperation(value: unknown): value is LlmOperation {
  return typeof value === "string" && LLM_OPERATIONS_SET.has(value);
}

function isSafeHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function unknownFailure(operation: LlmOperation | null): LlmFailureSummary {
  return {
    operation,
    category: "unknown",
    reason: "unknown_error",
    retryable: true,
  };
}

export function summarizeLlmFailure(
  error: unknown,
  operation?: LlmOperation,
): LlmFailureSummary {
  const requestedOperation = isLlmOperation(operation) ? operation : null;

  try {
    if (error instanceof ChatCompletionsError) {
      const code = error.code;
      if (
        code === "LLM_CONFIG_INVALID" ||
        code === "LLM_CANCELLED" ||
        code === "LLM_TIMEOUT" ||
        code === "LLM_NETWORK_ERROR" ||
        code === "LLM_RESPONSE_TOO_LARGE"
      ) {
        return {
          operation: requestedOperation,
          category:
            code === "LLM_CONFIG_INVALID"
              ? "configuration"
              : code === "LLM_CANCELLED"
                ? "cancellation"
                : code === "LLM_TIMEOUT"
                  ? "timeout"
                  : code === "LLM_NETWORK_ERROR"
                    ? "network"
                    : "response_size",
          reason: code,
          retryable: code === "LLM_TIMEOUT" || code === "LLM_NETWORK_ERROR",
        };
      }

      if (code === "LLM_HTTP_ERROR") {
        const status = error.status;
        return {
          operation: requestedOperation,
          category: "http",
          reason: code,
          retryable:
            status === 429 ||
            (isSafeHttpStatus(status) && status >= 500 && status <= 599),
          ...(isSafeHttpStatus(status) ? { httpStatus: status } : {}),
        };
      }

      if (code === "LLM_RESPONSE_PROTOCOL_ERROR") {
        const reason = error.reason;
        if (
          reason === "LLM_RESPONSE_MALFORMED" ||
          reason === "LLM_CONTENT_EMPTY" ||
          reason === "LLM_FINISH_REASON_INVALID" ||
          reason === "LLM_OUTPUT_TRUNCATED" ||
          reason === "LLM_REFUSAL" ||
          reason === "LLM_TOOL_CALL_UNEXPECTED"
        ) {
          return {
            operation: requestedOperation,
            category: "response_protocol",
            reason,
            retryable:
              reason !== "LLM_REFUSAL" && reason !== "LLM_TOOL_CALL_UNEXPECTED",
          };
        }
      }

      return unknownFailure(requestedOperation);
    }

    if (error instanceof LlmOutputValidationError) {
      const code = error.code;
      if (
        code === "LLM_OUTPUT_JSON_INVALID" ||
        code === "LLM_OUTPUT_SCHEMA_INVALID" ||
        code === "LLM_OUTPUT_REFERENCE_INVALID" ||
        code === "LLM_OUTPUT_CONFLICT"
      ) {
        const errorOperation = error.operation;
        return {
          operation:
            requestedOperation ??
            (isLlmOperation(errorOperation) ? errorOperation : null),
          category: "output_validation",
          reason: code,
          retryable: true,
        };
      }
    }
  } catch {
    return unknownFailure(requestedOperation);
  }

  return unknownFailure(requestedOperation);
}
