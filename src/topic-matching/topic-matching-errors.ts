import { summarizeLlmFailure } from "../llm/failure-summary.js";
import type { LlmFailureSummary } from "../llm/failure-summary.js";

export type TopicMatchingErrorCode =
  | "invalid_input"
  | "aborted"
  | "target_not_found"
  | "topic_matching_failed"
  | "llm_failed";

export const TOPIC_MATCHING_ERROR_MESSAGES = {
  invalid_input: "Invalid topic matching input",
  aborted: "Topic matching was aborted",
  target_not_found: "Topic matching target not found",
  topic_matching_failed: "Topic matching operation failed",
  llm_failed: "Topic matching LLM call failed",
} as const satisfies Record<TopicMatchingErrorCode, string>;

export class TopicMatchingError extends Error {
  readonly code: TopicMatchingErrorCode;
  declare readonly llmFailure?: LlmFailureSummary;

  constructor(code: TopicMatchingErrorCode, llmFailure?: LlmFailureSummary) {
    super(TOPIC_MATCHING_ERROR_MESSAGES[code]);
    this.name = "TopicMatchingError";
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

export function isTopicMatchingAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR" ||
    readErrorField(error, "code") === "LLM_CANCELLED" ||
    (error instanceof TopicMatchingError && error.code === "aborted")
  );
}

export function normalizeTopicMatchingError(
  error: unknown,
  fallback: Exclude<TopicMatchingErrorCode, "invalid_input" | "aborted">,
): TopicMatchingError {
  if (isTopicMatchingAbort(error)) {
    return new TopicMatchingError("aborted");
  }

  return new TopicMatchingError(
    fallback,
    fallback === "llm_failed"
      ? summarizeLlmFailure(error, "topic-matching")
      : undefined,
  );
}
