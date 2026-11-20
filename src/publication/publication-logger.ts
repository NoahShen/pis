import type {
  PublicationLogEntry,
  PublicationLogger,
  PublicationLogReason,
  PublicationLogStage,
} from "./contracts.js";

const PUBLICATION_LOG_STAGES: ReadonlySet<PublicationLogStage> = new Set([
  "check",
  "render",
  "persist",
  "notify",
]);
const PUBLICATION_LOG_REASONS: ReadonlySet<PublicationLogReason> = new Set([
  "invalid_input",
  "aborted",
  "publication_failed",
  "notify_failed",
]);

function whitelistLogEntry(entry: PublicationLogEntry): PublicationLogEntry {
  const safeEntry: {
    targetType?: PublicationLogEntry["targetType"];
    targetId?: string;
    stage: PublicationLogEntry["stage"];
    reason?: PublicationLogEntry["reason"];
    sourceLinkCount?: number;
    publishedItemId?: string;
    durationMs?: number;
  } = {
    stage: PUBLICATION_LOG_STAGES.has(entry.stage) ? entry.stage : "check",
  };

  if (entry.targetType !== undefined) {
    safeEntry.targetType = entry.targetType;
  }
  if (entry.targetId !== undefined) {
    safeEntry.targetId = entry.targetId;
  }
  if (entry.reason !== undefined && PUBLICATION_LOG_REASONS.has(entry.reason)) {
    safeEntry.reason = entry.reason;
  }
  if (entry.sourceLinkCount !== undefined) {
    safeEntry.sourceLinkCount = entry.sourceLinkCount;
  }
  if (entry.publishedItemId !== undefined) {
    safeEntry.publishedItemId = entry.publishedItemId;
  }
  if (entry.durationMs !== undefined) {
    safeEntry.durationMs = entry.durationMs;
  }

  return safeEntry;
}

export function logPublication(
  logger: PublicationLogger | undefined,
  entry: PublicationLogEntry,
): void {
  if (logger === undefined) {
    return;
  }

  try {
    const result = logger(whitelistLogEntry(entry));
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Publication logging is best effort and must never affect publication.
  }
}
