import { summarizeLlmFailure } from "../llm/failure-summary.js";
import type { LlmFailureSummary } from "../llm/failure-summary.js";

export type EventAnalysisErrorCode =
  "invalid_input" | "aborted" | "event_analysis_failed" | "llm_failed";

export const EVENT_ANALYSIS_ERROR_MESSAGES = {
  invalid_input: "Invalid event analysis input",
  aborted: "Event analysis was aborted",
  event_analysis_failed: "Event analysis operation failed",
  llm_failed: "Event analysis LLM call failed",
} as const satisfies Record<EventAnalysisErrorCode, string>;

export class EventAnalysisError extends Error {
  readonly code: EventAnalysisErrorCode;
  declare readonly llmFailure?: LlmFailureSummary;

  constructor(code: EventAnalysisErrorCode, llmFailure?: LlmFailureSummary) {
    super(EVENT_ANALYSIS_ERROR_MESSAGES[code]);
    this.name = "EventAnalysisError";
    this.code = code;
    if (llmFailure !== undefined) {
      this.llmFailure = llmFailure;
    }
  }
}

function readErrorField(error: unknown, field: "name" | "code"): unknown {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    return (error as { readonly name?: unknown; readonly code?: unknown })[
      field
    ];
  } catch {
    return undefined;
  }
}

export function isEventAnalysisAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR" ||
    readErrorField(error, "code") === "LLM_CANCELLED" ||
    (error instanceof EventAnalysisError && error.code === "aborted")
  );
}

export function normalizeEventAnalysisError(
  error: unknown,
  fallback: "event_analysis_failed" | "llm_failed",
): EventAnalysisError {
  if (isEventAnalysisAbort(error)) {
    return new EventAnalysisError("aborted");
  }

  return new EventAnalysisError(
    fallback,
    fallback === "llm_failed"
      ? summarizeLlmFailure(error, "event-analysis")
      : undefined,
  );
}
