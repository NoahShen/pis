import type { RuntimeLogEntry, RuntimeLogger } from "./contracts.js";

function whitelistedEntry(entry: RuntimeLogEntry): RuntimeLogEntry {
  return {
    ...(entry.taskType === undefined ? {} : { taskType: entry.taskType }),
    ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
    ...(entry.stage === undefined ? {} : { stage: entry.stage }),
    ...(entry.attempt === undefined ? {} : { attempt: entry.attempt }),
    ...(entry.maxAttempts === undefined
      ? {}
      : { maxAttempts: entry.maxAttempts }),
    ...(entry.queueSize === undefined ? {} : { queueSize: entry.queueSize }),
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
  };
}

export function logRuntime(
  logger: RuntimeLogger | undefined,
  entry: RuntimeLogEntry,
): void {
  if (logger === undefined) {
    return;
  }

  try {
    const result = logger.log(whitelistedEntry(entry));
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Runtime logging is observational and must never change task outcomes.
  }
}
