export type EventSearchErrorCode =
  "invalid_input" | "aborted" | "event_search_failed" | "llm_failed";

export const EVENT_SEARCH_ERROR_MESSAGES = {
  invalid_input: "Invalid event search input",
  aborted: "Event search was aborted",
  event_search_failed: "Event search operation failed",
  llm_failed: "Event search LLM call failed",
} as const satisfies Record<EventSearchErrorCode, string>;

export class EventSearchError extends Error {
  readonly code: EventSearchErrorCode;

  constructor(code: EventSearchErrorCode) {
    super(EVENT_SEARCH_ERROR_MESSAGES[code]);
    this.name = "EventSearchError";
    this.code = code;
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

export function isEventSearchAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR" ||
    readErrorField(error, "code") === "LLM_CANCELLED"
  );
}

export function normalizeEventSearchError(
  error: unknown,
  fallback: "event_search_failed" | "llm_failed",
): EventSearchError {
  if (isEventSearchAbort(error)) {
    return new EventSearchError("aborted");
  }

  return new EventSearchError(fallback);
}
