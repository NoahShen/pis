import { BoundedTaskQueue, QueueClosedError } from "./bounded-task-queue.js";
import type {
  CollectResult,
  EventAnalysisResult,
  KnowledgeResult,
  ProcessResult,
  PublishResult,
  Runtime,
  RuntimeDependencies,
  RuntimeLogEntry,
  RuntimeShutdownOptions,
  RuntimeTask,
  RuntimeTaskType,
  StageServices,
  TargetType,
  TopicMatchingResult,
} from "./contracts.js";
import { RuntimeClosedError, RuntimeInputError } from "./runtime-errors.js";
import { logRuntime } from "./runtime-logger.js";
import { StageWorker } from "./stage-worker.js";
import {
  dispatchDownstreamTasks,
  type DispatchDownstreamTaskOptions,
} from "./task-dispatch.js";
import { classifyTaskError } from "./task-errors.js";
import { mapResultToDownstreamTasks, runtimeTaskId } from "./task-mapping.js";

export const RUNTIME_DEFAULTS = Object.freeze({
  queueCapacity: 8,
  maxAttempts: 2,
  dispatchAttempts: 2,
  shutdownTimeoutMs: 5_000,
});

const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;

type StageResult =
  | CollectResult
  | ProcessResult
  | EventAnalysisResult
  | KnowledgeResult
  | TopicMatchingResult
  | PublishResult;

interface RuntimeConfiguration {
  readonly queueCapacity: number;
  readonly maxAttempts: number;
  readonly dispatchAttempts: number;
  readonly shutdownTimeoutMs: number;
  readonly shutdownGraceMs: number;
}

interface QueuedRuntimeTask {
  readonly task: RuntimeTask;
  readonly accepted?: Promise<void>;
}

interface RuntimeChannel {
  readonly queue: BoundedTaskQueue<QueuedRuntimeTask>;
  readonly worker: StageWorker<QueuedRuntimeTask>;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const runtimeTaskTypes = [
  "COLLECT",
  "PROCESS",
  "EVENT_ANALYSIS",
  "KNOWLEDGE_ANALYSIS",
  "TOPIC_MATCHING",
  "PUBLISH",
] as const satisfies readonly RuntimeTaskType[];

const targetTypes = ["EVENT", "EVENT_UPDATE", "KNOWLEDGE"] as const;

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function validateConfiguration(
  dependencies: RuntimeDependencies,
): RuntimeConfiguration {
  return {
    queueCapacity: positiveInteger(
      dependencies.queueCapacity ?? RUNTIME_DEFAULTS.queueCapacity,
      "queueCapacity",
    ),
    maxAttempts: positiveInteger(
      dependencies.maxAttempts ?? RUNTIME_DEFAULTS.maxAttempts,
      "maxAttempts",
    ),
    dispatchAttempts: positiveInteger(
      dependencies.dispatchAttempts ?? RUNTIME_DEFAULTS.dispatchAttempts,
      "dispatchAttempts",
    ),
    shutdownTimeoutMs: nonNegativeInteger(
      dependencies.shutdownTimeoutMs ?? RUNTIME_DEFAULTS.shutdownTimeoutMs,
      "shutdownTimeoutMs",
    ),
    shutdownGraceMs: nonNegativeInteger(
      dependencies.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
      "shutdownGraceMs",
    ),
  };
}

async function settlesWithin(
  promise: Promise<void>,
  durationMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), durationMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    return false;
  }

  const sortedKeys = (keys as string[]).sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedKeys.length === sortedExpected.length &&
    sortedKeys.every((key, index) => key === sortedExpected[index])
  );
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTargetType(value: unknown): boolean {
  return targetTypes.some((targetType) => targetType === value);
}

function normalizeRuntimeTask(input: unknown): RuntimeTask {
  if (!isPlainRecord(input)) {
    throw new RuntimeInputError();
  }

  const type = input.type;
  switch (type) {
    case "COLLECT":
      if (
        hasExactFields(input, ["type", "source_id"]) &&
        nonBlankString(input.source_id)
      ) {
        return { type, source_id: input.source_id };
      }
      break;
    case "PROCESS":
      if (
        hasExactFields(input, ["type", "source_item_id"]) &&
        nonBlankString(input.source_item_id)
      ) {
        return { type, source_item_id: input.source_item_id };
      }
      break;
    case "EVENT_ANALYSIS":
    case "KNOWLEDGE_ANALYSIS":
      if (
        hasExactFields(input, ["type", "content_id"]) &&
        nonBlankString(input.content_id)
      ) {
        return { type, content_id: input.content_id };
      }
      break;
    case "TOPIC_MATCHING":
    case "PUBLISH":
      if (
        hasExactFields(input, ["type", "target_type", "target_id"]) &&
        isTargetType(input.target_type) &&
        nonBlankString(input.target_id)
      ) {
        return {
          type,
          target_type: input.target_type as TargetType,
          target_id: input.target_id,
        };
      }
      break;
  }

  throw new RuntimeInputError();
}

function validateSubmittedTask(input: unknown): RuntimeTask {
  try {
    return normalizeRuntimeTask(input);
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      throw error;
    }
    throw new RuntimeInputError();
  }
}

function executeStage(
  services: StageServices,
  task: RuntimeTask,
  signal: AbortSignal,
): Promise<StageResult> {
  switch (task.type) {
    case "COLLECT":
      return services.collect(task.source_id, { signal });
    case "PROCESS":
      return services.process(task.source_item_id, { signal });
    case "EVENT_ANALYSIS":
      return services.analyzeEvent(task.content_id, { signal });
    case "KNOWLEDGE_ANALYSIS":
      return services.analyzeKnowledge(task.content_id, { signal });
    case "TOPIC_MATCHING":
      return services.matchTopics(task.target_type, task.target_id, { signal });
    case "PUBLISH":
      return services.publish(task.target_type, task.target_id, { signal });
  }
}

function failureLogEntry(
  task: RuntimeTask,
  attempt: number,
  maxAttempts: number,
  reason: string,
  durationMs: number,
): RuntimeLogEntry {
  return {
    taskType: task.type,
    taskId: runtimeTaskId(task),
    stage: task.type,
    attempt,
    maxAttempts,
    reason,
    durationMs,
  };
}

function shutdownTimeout(
  configuration: RuntimeConfiguration,
  options: RuntimeShutdownOptions | undefined,
): number {
  return nonNegativeInteger(
    options?.timeoutMs ?? configuration.shutdownTimeoutMs,
    "timeoutMs",
  );
}

export function createRuntime(dependencies: RuntimeDependencies): Runtime {
  const configuration = validateConfiguration(dependencies);
  const abortController = new AbortController();
  const drainWaiters: Array<() => void> = [];
  let accepting = true;
  let pendingTasks = 0;
  let pendingEnqueues = 0;
  let shutdownFinished = false;
  let shutdownPromise: Promise<void> | undefined;

  const channels = {} as Record<RuntimeTaskType, RuntimeChannel>;
  for (const taskType of runtimeTaskTypes) {
    const queue = new BoundedTaskQueue<QueuedRuntimeTask>({
      capacity: configuration.queueCapacity,
      signal: abortController.signal,
    });
    channels[taskType] = {
      queue,
      worker: new StageWorker<QueuedRuntimeTask>({
        queue,
        handle: async (queuedTask) => {
          if (queuedTask.accepted !== undefined) {
            await queuedTask.accepted;
          }
          await processTask(queuedTask.task);
        },
        onError: () => {
          logRuntime(dependencies.logger, {
            stage: taskType,
            reason: "worker_error",
          });
        },
      }),
    };
  }

  function settleDrain(): void {
    if (!shutdownFinished && (pendingTasks !== 0 || pendingEnqueues !== 0)) {
      return;
    }

    for (const resolve of drainWaiters.splice(0)) {
      resolve();
    }
  }

  function beginPendingTask(): void {
    pendingTasks += 1;
  }

  function completePendingTask(): void {
    pendingTasks -= 1;
    settleDrain();
  }

  function channelFor(task: RuntimeTask): RuntimeChannel {
    return channels[task.type];
  }

  async function processTask(task: RuntimeTask): Promise<void> {
    try {
      let result: StageResult | undefined;
      const signal = abortController.signal;

      if (signal.aborted) {
        logRuntime(
          dependencies.logger,
          failureLogEntry(task, 1, configuration.maxAttempts, "cancelled", 0),
        );
        return;
      }

      for (
        let attempt = 1;
        attempt <= configuration.maxAttempts;
        attempt += 1
      ) {
        const startedAt = Date.now();
        try {
          result = await executeStage(dependencies.services, task, signal);
          if (signal.aborted) {
            result = undefined;
            logRuntime(
              dependencies.logger,
              failureLogEntry(
                task,
                attempt,
                configuration.maxAttempts,
                "cancelled",
                Math.max(0, Date.now() - startedAt),
              ),
            );
          }
          break;
        } catch (error) {
          const classification = classifyTaskError(error);
          const cancelled =
            signal.aborted || classification.category === "cancelled";
          const durationMs = Math.max(0, Date.now() - startedAt);
          const terminal =
            cancelled ||
            classification.category !== "retryable" ||
            attempt >= configuration.maxAttempts;

          logRuntime(
            dependencies.logger,
            failureLogEntry(
              task,
              attempt,
              configuration.maxAttempts,
              signal.aborted ? "cancelled" : classification.reason,
              durationMs,
            ),
          );

          if (terminal) {
            return;
          }
        }
      }

      if (result === undefined) {
        return;
      }

      if (signal.aborted) {
        logRuntime(
          dependencies.logger,
          failureLogEntry(task, 1, configuration.maxAttempts, "cancelled", 0),
        );
        return;
      }

      let downstreamTasks: RuntimeTask[];
      try {
        downstreamTasks = mapResultToDownstreamTasks(task, result);
      } catch {
        logRuntime(dependencies.logger, {
          taskType: task.type,
          taskId: runtimeTaskId(task),
          stage: task.type,
          reason: "mapping_failed",
        });
        return;
      }

      const dispatchOptions: DispatchDownstreamTaskOptions = {
        dispatchAttempts: configuration.dispatchAttempts,
        logger: dependencies.logger,
        signal,
      };

      await dispatchDownstreamTasks(
        downstreamTasks,
        enqueueDownstreamTask,
        dispatchOptions,
      );
    } finally {
      completePendingTask();
    }
  }

  async function enqueueDownstreamTask(task: RuntimeTask): Promise<void> {
    const accepted = createDeferred();
    pendingEnqueues += 1;

    try {
      await channelFor(task).queue.enqueue({
        task,
        accepted: accepted.promise,
      });
      beginPendingTask();
      accepted.resolve();
    } catch (error) {
      accepted.resolve();
      throw error;
    } finally {
      pendingEnqueues -= 1;
      settleDrain();
    }
  }

  function startRuntime(): void {
    for (const taskType of runtimeTaskTypes) {
      channels[taskType].worker.start();
    }
  }

  function drainRuntime(): Promise<void> {
    if (shutdownFinished || (pendingTasks === 0 && pendingEnqueues === 0)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      drainWaiters.push(resolve);
    });
  }

  return {
    async submit(task: RuntimeTask): Promise<void> {
      if (!accepting) {
        throw new RuntimeClosedError();
      }

      const normalizedTask = validateSubmittedTask(task);
      beginPendingTask();
      try {
        await channelFor(normalizedTask).queue.enqueue({
          task: normalizedTask,
        });
      } catch (error) {
        if (error instanceof QueueClosedError || !accepting) {
          completePendingTask();
          throw new RuntimeClosedError();
        }
        completePendingTask();
        throw error;
      }
    },

    async start(): Promise<void> {
      startRuntime();
    },

    stopAccepting(): void {
      accepting = false;
    },

    drain: drainRuntime,

    shutdown(options?: RuntimeShutdownOptions): Promise<void> {
      if (shutdownPromise === undefined) {
        accepting = false;
        const timeoutMs = shutdownTimeout(configuration, options);
        shutdownPromise = (async () => {
          try {
            startRuntime();
            const drained = await settlesWithin(drainRuntime(), timeoutMs);

            if (!drained) {
              abortController.abort();
              logRuntime(dependencies.logger, {
                stage: "shutdown",
                reason: "shutdown_timeout",
                durationMs: timeoutMs,
              });
            }

            for (const taskType of runtimeTaskTypes) {
              channels[taskType].queue.close();
            }

            const workersDone = Promise.all(
              runtimeTaskTypes.map((taskType) =>
                channels[taskType].worker.done(),
              ),
            ).then(() => undefined);

            if (drained) {
              await workersDone;
            } else {
              const workersExited = await settlesWithin(
                workersDone.then(
                  () => undefined,
                  () => undefined,
                ),
                configuration.shutdownGraceMs,
              );
              if (!workersExited) {
                logRuntime(dependencies.logger, {
                  stage: "shutdown",
                  reason: "shutdown_grace",
                  durationMs: configuration.shutdownGraceMs,
                });
              }
            }
          } finally {
            shutdownFinished = true;
            settleDrain();
          }
        })();
      }

      return shutdownPromise;
    },
  };
}
