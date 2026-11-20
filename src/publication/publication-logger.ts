import type { PublicationLogEntry, PublicationLogger } from "./contracts.js";

function whitelistLogEntry(entry: PublicationLogEntry): PublicationLogEntry {
  const safeEntry: {
    targetType?: PublicationLogEntry["targetType"];
    targetId?: string;
    stage: PublicationLogEntry["stage"];
    reason?: PublicationLogEntry["reason"];
    sourceLinkCount?: number;
    publishedItemId?: string;
    durationMs?: number;
  } = { stage: entry.stage };

  if (entry.targetType !== undefined) {
    safeEntry.targetType = entry.targetType;
  }
  if (entry.targetId !== undefined) {
    safeEntry.targetId = entry.targetId;
  }
  if (entry.reason !== undefined) {
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
