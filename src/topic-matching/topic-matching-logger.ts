import type { TopicMatchingErrorCode } from "./topic-matching-errors.js";
import type { TopicTargetType } from "./contracts.js";

export type TopicMatchingLogStage = "check" | "match" | "persist";

export interface TopicMatchingLogEntry {
  readonly targetType?: TopicTargetType;
  readonly targetId?: string;
  readonly enabledTopicCount?: number;
  readonly matchedTopicCount?: number;
  readonly stage: TopicMatchingLogStage;
  readonly reason?: TopicMatchingErrorCode;
}

export type TopicMatchingLogger = (
  entry: TopicMatchingLogEntry,
) => void | Promise<void>;

function whitelistTopicMatchingLogEntry(
  entry: TopicMatchingLogEntry,
): TopicMatchingLogEntry {
  const safeEntry: {
    targetType?: TopicTargetType;
    targetId?: string;
    enabledTopicCount?: number;
    matchedTopicCount?: number;
    stage: TopicMatchingLogStage;
    reason?: TopicMatchingErrorCode;
  } = { stage: entry.stage };

  if (entry.targetType !== undefined) {
    safeEntry.targetType = entry.targetType;
  }
  if (entry.targetId !== undefined) {
    safeEntry.targetId = entry.targetId;
  }
  if (entry.enabledTopicCount !== undefined) {
    safeEntry.enabledTopicCount = entry.enabledTopicCount;
  }
  if (entry.matchedTopicCount !== undefined) {
    safeEntry.matchedTopicCount = entry.matchedTopicCount;
  }
  if (entry.reason !== undefined) {
    safeEntry.reason = entry.reason;
  }

  return safeEntry;
}

export function logTopicMatching(
  logger: TopicMatchingLogger | undefined,
  entry: TopicMatchingLogEntry,
): void {
  if (logger === undefined) {
    return;
  }

  try {
    const result = logger(whitelistTopicMatchingLogEntry(entry));
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Logging is best effort and must not affect topic matching.
  }
}
