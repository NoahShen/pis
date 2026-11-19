import type { RuntimeTask } from "./contracts.js";
import type { RuntimeLogger } from "./contracts.js";
import { QueueClosedError } from "./bounded-task-queue.js";
import { logRuntime } from "./runtime-logger.js";
import { runtimeTaskId } from "./task-mapping.js";

export interface DispatchDownstreamTaskOptions {
  readonly dispatchAttempts?: number;
  readonly logger?: RuntimeLogger;
  readonly signal?: AbortSignal;
}

function stableErrorField(
  error: unknown,
  field: "name" | "code",
): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const value = (
      error as { readonly name?: unknown; readonly code?: unknown }
    )[field];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted === true || error instanceof QueueClosedError) {
    return true;
  }

  const name = stableErrorField(error, "name");
  const code = stableErrorField(error, "code");
  return (
    name === "AbortError" ||
    code === "ABORT_ERR" ||
    code === "LLM_CANCELLED" ||
    code === "aborted" ||
    code === "queue_closed"
  );
}

function validateDispatchAttempts(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError("dispatchAttempts must be a positive integer");
  }

  return value;
}

export async function dispatchDownstreamTasks(
  tasks: readonly RuntimeTask[],
  enqueue: (task: RuntimeTask) => Promise<void>,
  options: DispatchDownstreamTaskOptions = {},
): Promise<void> {
  const dispatchAttempts = validateDispatchAttempts(
    options.dispatchAttempts ?? 2,
  );

  for (const task of tasks) {
    for (let attempt = 1; attempt <= dispatchAttempts; attempt += 1) {
      if (options.signal?.aborted === true) {
        logRuntime(options.logger, {
          taskType: task.type,
          taskId: runtimeTaskId(task),
          stage: "dispatch",
          attempt,
          maxAttempts: dispatchAttempts,
          reason: "dispatch_cancelled",
        });
        break;
      }

      const startedAt = Date.now();
      try {
        await enqueue(task);
        break;
      } catch (error) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        if (isCancellation(error, options.signal)) {
          logRuntime(options.logger, {
            taskType: task.type,
            taskId: runtimeTaskId(task),
            stage: "dispatch",
            attempt,
            maxAttempts: dispatchAttempts,
            reason: "dispatch_cancelled",
            durationMs,
          });
          break;
        }

        if (attempt >= dispatchAttempts) {
          logRuntime(options.logger, {
            taskType: task.type,
            taskId: runtimeTaskId(task),
            stage: "dispatch",
            attempt,
            maxAttempts: dispatchAttempts,
            reason: "dispatch_failed",
            durationMs,
          });
        }
      }
    }
  }
}
