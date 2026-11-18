import type { EventSearchErrorCode } from "./event-search-errors.js";

export type EventSearchLogStage = "check" | "extract" | "search" | "context";

export type EventSearchLogReason = EventSearchErrorCode;

export interface EventSearchLogMetadata {
  readonly contentId?: string;
  readonly candidateCount?: number;
  readonly clueCount?: number;
  readonly stage: EventSearchLogStage;
  readonly reason?: EventSearchLogReason;
}

export interface EventSearchLogger {
  log(metadata: EventSearchLogMetadata): void | PromiseLike<void>;
}

function isStage(value: unknown): value is EventSearchLogStage {
  switch (value) {
    case "check":
    case "extract":
    case "search":
    case "context":
      return true;
    default:
      return false;
  }
}

function isReason(value: unknown): value is EventSearchLogReason {
  switch (value) {
    case "invalid_input":
    case "aborted":
    case "event_search_failed":
    case "llm_failed":
      return true;
    default:
      return false;
  }
}

function safeRead(
  metadata: EventSearchLogMetadata,
  field: keyof EventSearchLogMetadata,
): unknown {
  try {
    return metadata[field];
  } catch {
    return undefined;
  }
}

function whitelistMetadata(
  metadata: EventSearchLogMetadata,
): EventSearchLogMetadata {
  const contentId = safeRead(metadata, "contentId");
  const candidateCount = safeRead(metadata, "candidateCount");
  const clueCount = safeRead(metadata, "clueCount");
  const stage = safeRead(metadata, "stage");
  const reason = safeRead(metadata, "reason");
  const sanitized: {
    contentId?: string;
    candidateCount?: number;
    clueCount?: number;
    stage?: EventSearchLogStage;
    reason?: EventSearchLogReason;
  } = {};

  if (typeof contentId === "string") {
    sanitized.contentId = contentId;
  }
  if (Number.isInteger(candidateCount) && Number(candidateCount) >= 0) {
    sanitized.candidateCount = candidateCount as number;
  }
  if (Number.isInteger(clueCount) && Number(clueCount) >= 0) {
    sanitized.clueCount = clueCount as number;
  }
  if (isStage(stage)) {
    sanitized.stage = stage;
  }
  if (isReason(reason)) {
    sanitized.reason = reason;
  }

  return sanitized as EventSearchLogMetadata;
}

export function logEventSearchSafely(
  logger: EventSearchLogger,
  metadata: EventSearchLogMetadata,
): void {
  try {
    const outcome = logger.log(whitelistMetadata(metadata));
    if (
      (typeof outcome === "object" && outcome !== null) ||
      typeof outcome === "function"
    ) {
      void Promise.resolve(outcome).catch(() => undefined);
    }
  } catch {
    // Logging is best-effort and must never alter the search outcome.
  }
}
