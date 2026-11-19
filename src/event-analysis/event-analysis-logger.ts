import type {
  EventAnalysisLogMetadata,
  EventAnalysisLogReason,
  EventAnalysisLogStage,
  EventAnalysisLogger,
} from "./contracts.js";

function isStage(value: unknown): value is EventAnalysisLogStage {
  switch (value) {
    case "check":
    case "search":
    case "analyze":
    case "persist":
      return true;
    default:
      return false;
  }
}

function isReason(value: unknown): value is EventAnalysisLogReason {
  switch (value) {
    case "invalid_input":
    case "aborted":
    case "event_analysis_failed":
    case "llm_failed":
    case "missing_content":
    case "empty_clues":
    case "no_candidates":
    case "candidates":
      return true;
    default:
      return false;
  }
}

function safeRead(
  metadata: EventAnalysisLogMetadata,
  field: keyof EventAnalysisLogMetadata,
): unknown {
  try {
    return metadata[field];
  } catch {
    return undefined;
  }
}

function whitelistMetadata(
  metadata: EventAnalysisLogMetadata,
): EventAnalysisLogMetadata | null {
  const contentId = safeRead(metadata, "contentId");
  const candidateCount = safeRead(metadata, "candidateCount");
  const resultCount = safeRead(metadata, "resultCount");
  const newTargetCount = safeRead(metadata, "newTargetCount");
  const stage = safeRead(metadata, "stage");
  const reason = safeRead(metadata, "reason");
  const sanitized: {
    contentId?: string;
    candidateCount?: number;
    resultCount?: number;
    newTargetCount?: number;
    stage?: EventAnalysisLogStage;
    reason?: EventAnalysisLogReason;
  } = {};

  if (typeof contentId === "string") {
    sanitized.contentId = contentId;
  }
  for (const [field, value] of [
    ["candidateCount", candidateCount],
    ["resultCount", resultCount],
    ["newTargetCount", newTargetCount],
  ] as const) {
    if (Number.isInteger(value) && Number(value) >= 0) {
      sanitized[field] = Number(value);
    }
  }
  if (isStage(stage)) {
    sanitized.stage = stage;
  }
  if (isReason(reason)) {
    sanitized.reason = reason;
  }

  return sanitized.stage === undefined
    ? null
    : (sanitized as EventAnalysisLogMetadata);
}

export function logEventAnalysisSafely(
  logger: EventAnalysisLogger,
  metadata: EventAnalysisLogMetadata,
): void {
  try {
    const sanitized = whitelistMetadata(metadata);
    if (sanitized === null) {
      return;
    }

    const outcome = logger.log(sanitized);
    if (
      (typeof outcome === "object" && outcome !== null) ||
      typeof outcome === "function"
    ) {
      void Promise.resolve(outcome).catch(() => undefined);
    }
  } catch {
    // Logging is best-effort and must never alter the analysis outcome.
  }
}
