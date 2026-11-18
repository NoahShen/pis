import type { KnowledgeErrorCode } from "./knowledge-errors.js";

export type KnowledgeLogStage = "check" | "analyze" | "persist" | "reuse";

export interface KnowledgeLogEntry {
  readonly contentId?: string;
  readonly knowledgeId?: string;
  readonly stage: KnowledgeLogStage;
  readonly reason?: KnowledgeErrorCode;
  readonly valuable?: boolean;
}

export type KnowledgeLogger = (
  entry: KnowledgeLogEntry,
) => void | Promise<void>;

function whitelistKnowledgeLogEntry(
  entry: KnowledgeLogEntry,
): KnowledgeLogEntry {
  const safeEntry: {
    contentId?: string;
    knowledgeId?: string;
    stage: KnowledgeLogStage;
    reason?: KnowledgeErrorCode;
    valuable?: boolean;
  } = { stage: entry.stage };

  if (entry.contentId !== undefined) {
    safeEntry.contentId = entry.contentId;
  }
  if (entry.knowledgeId !== undefined) {
    safeEntry.knowledgeId = entry.knowledgeId;
  }
  if (entry.reason !== undefined) {
    safeEntry.reason = entry.reason;
  }
  if (entry.valuable !== undefined) {
    safeEntry.valuable = entry.valuable;
  }

  return safeEntry;
}

export function logKnowledge(
  logger: KnowledgeLogger | undefined,
  entry: KnowledgeLogEntry,
): void {
  if (logger === undefined) {
    return;
  }

  try {
    const result = logger(whitelistKnowledgeLogEntry(entry));
    if (result !== undefined) {
      void result.catch(() => undefined);
    }
  } catch {
    // Logging is best effort and must not affect the knowledge operation.
  }
}
