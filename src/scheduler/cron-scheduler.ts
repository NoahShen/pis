import { schedule as scheduleCron, validate as validateCron } from "node-cron";

import type { RuntimeTask } from "../runtime/contracts.js";
import type {
  CronBackend,
  CronScheduledTask,
  CronScheduleOptions,
  CronScheduler,
  CronSchedulerOptions,
} from "./contracts.js";
import { CronSchedulerError } from "./contracts.js";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface CronSchedulerDependencies {
  readonly backend?: CronBackend;
}

interface RegisteredSchedule {
  readonly task: CronScheduledTask;
}

function createNodeCronBackend(): CronBackend {
  return {
    validate(expression: string): boolean {
      return validateCron(expression);
    },
    schedule(
      expression: string,
      callback: () => void,
      options: CronScheduleOptions,
    ): CronScheduledTask {
      const task = scheduleCron(expression, callback, {
        timezone: options.timezone,
        name: options.name,
      });

      return {
        stop(): void {
          void task.stop();
        },
        destroy(): void {
          void task.destroy();
        },
      };
    },
  };
}

function validateTimezone(timezone: string): void {
  try {
    // Constructing the formatter throws a RangeError for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CronSchedulerError();
    }
    throw error;
  }
}

function collectTask(sourceId: string): RuntimeTask {
  return { type: "COLLECT", source_id: sourceId };
}

export function createCronScheduler(
  options: CronSchedulerOptions,
  dependencies: CronSchedulerDependencies = {},
): CronScheduler {
  const backend = dependencies.backend ?? createNodeCronBackend();
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const registered = new Map<string, RegisteredSchedule>();
  let started = false;

  function stopSchedule(schedule: RegisteredSchedule): void {
    try {
      schedule.task.stop();
    } catch {
      // Best-effort: a failing stop must not block destroy or cleanup.
    }
    try {
      schedule.task.destroy();
    } catch {
      // Best-effort: a failing destroy must not block other tasks.
    }
  }

  function rollback(): void {
    // Snapshot and clear first so cleanup failures can never leave stale
    // registrations behind or prevent a retry from registering again.
    const scheduled = [...registered.values()];
    registered.clear();
    for (const schedule of scheduled) {
      stopSchedule(schedule);
    }
  }

  function start(): void {
    if (started) {
      return;
    }

    // A single snapshot drives both validation and every registration below.
    const enabledSources = options.sources.listEnabled();
    validateTimezone(timezone);

    // Validate every expression before registering anything so a single bad
    // Source cannot leave a partially scheduled set behind.
    for (const source of enabledSources) {
      if (!backend.validate(source.cron)) {
        throw new CronSchedulerError();
      }
    }

    try {
      for (const source of enabledSources) {
        const sourceId = source.id;
        const task = backend.schedule(
          source.cron,
          () => {
            void options.submit(collectTask(sourceId)).catch(() => {});
          },
          { timezone, name: sourceId },
        );
        registered.set(sourceId, { task });
      }
    } catch {
      rollback();
      throw new CronSchedulerError();
    }

    started = true;
  }

  function stop(): void {
    rollback();
    started = false;
  }

  async function trigger(sourceId: string): Promise<void> {
    if (sourceId.trim().length === 0) {
      return;
    }

    const enabledSources = options.sources.listEnabled();
    const isEnabled = enabledSources.some((source) => source.id === sourceId);
    if (!isEnabled) {
      return;
    }

    await options.submit(collectTask(sourceId));
  }

  return { start, stop, trigger };
}
