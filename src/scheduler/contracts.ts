import type { SourceRepository } from "../configuration/source-repository.js";
import type { RuntimeTask } from "../runtime/contracts.js";

export interface CronSchedulerOptions {
  readonly timezone?: string;
  readonly sources: Pick<SourceRepository, "listEnabled">;
  readonly submit: (task: RuntimeTask) => Promise<void>;
}

export interface CronScheduler {
  start(): void;
  stop(): void;
  trigger(sourceId: string): Promise<void>;
}

export type CronSchedulerErrorCode = "invalid_cron";

const CRON_SCHEDULER_ERROR_MESSAGE = "Invalid cron configuration";

export class CronSchedulerError extends Error {
  readonly code: CronSchedulerErrorCode = "invalid_cron";

  constructor() {
    super(CRON_SCHEDULER_ERROR_MESSAGE);
    this.name = "CronSchedulerError";
  }
}

export interface CronScheduleOptions {
  readonly timezone: string;
  readonly name?: string;
}

export interface CronScheduledTask {
  stop(): void;
  destroy(): void;
}

export interface CronBackend {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    callback: () => void,
    options: CronScheduleOptions,
  ): CronScheduledTask;
}
