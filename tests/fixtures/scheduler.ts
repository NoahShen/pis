import type Database from "better-sqlite3";
import { validate as validateCron } from "node-cron";

import type { Source } from "../../src/configuration/contracts.js";
import {
  SqliteSourceRepository,
  type SourceRepository,
} from "../../src/configuration/source-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type { RuntimeTask } from "../../src/runtime/contracts.js";
import type {
  CronBackend,
  CronScheduleOptions,
  CronScheduledTask,
} from "../../src/scheduler/contracts.js";
import { closeDatabase, withDatabasePath } from "./database.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";

export interface FakeScheduleCall {
  readonly expression: string;
  readonly options: CronScheduleOptions;
}

export interface FakeScheduledTask {
  readonly expression: string;
  readonly callback: () => void;
  readonly options: CronScheduleOptions;
  stopCalls: number;
  destroyCalls: number;
}

export interface FakeCronBackendOptions {
  readonly invalidExpressions?: readonly string[];
  readonly throwOnScheduleExpressions?: readonly string[];
  readonly throwOnStopExpressions?: readonly string[];
  readonly throwOnDestroyExpressions?: readonly string[];
}

export class FakeCronBackend implements CronBackend {
  readonly validateCalls: string[] = [];
  readonly scheduleCalls: FakeScheduleCall[] = [];
  readonly tasks: FakeScheduledTask[] = [];
  private readonly invalidExpressions: ReadonlySet<string>;
  private readonly throwOnScheduleExpressions: Set<string>;
  private readonly throwOnStopExpressions: Set<string>;
  private readonly throwOnDestroyExpressions: Set<string>;

  constructor(options: FakeCronBackendOptions = {}) {
    this.invalidExpressions = new Set(options.invalidExpressions ?? []);
    this.throwOnScheduleExpressions = new Set(
      options.throwOnScheduleExpressions ?? [],
    );
    this.throwOnStopExpressions = new Set(options.throwOnStopExpressions ?? []);
    this.throwOnDestroyExpressions = new Set(
      options.throwOnDestroyExpressions ?? [],
    );
  }

  validate(expression: string): boolean {
    this.validateCalls.push(expression);
    if (this.invalidExpressions.has(expression)) {
      return false;
    }

    return validateCron(expression);
  }

  schedule(
    expression: string,
    callback: () => void,
    options: CronScheduleOptions,
  ): CronScheduledTask {
    this.scheduleCalls.push({ expression, options });
    if (this.throwOnScheduleExpressions.has(expression)) {
      throw new Error("simulated cron backend scheduling failure");
    }

    const task: FakeScheduledTask = {
      expression,
      callback,
      options,
      stopCalls: 0,
      destroyCalls: 0,
    };
    this.tasks.push(task);

    const throwOnStop = this.throwOnStopExpressions;
    const throwOnDestroy = this.throwOnDestroyExpressions;

    return {
      stop(): void {
        task.stopCalls += 1;
        if (throwOnStop.has(expression)) {
          throw new Error("stop boom");
        }
      },
      destroy(): void {
        task.destroyCalls += 1;
        if (throwOnDestroy.has(expression)) {
          throw new Error("destroy boom");
        }
      },
    };
  }

  clearThrowOnSchedule(expression: string): void {
    this.throwOnScheduleExpressions.delete(expression);
  }

  taskFor(name: string): FakeScheduledTask | undefined {
    return this.tasks.find((task) => task.options.name === name);
  }

  fire(name: string): void {
    this.taskFor(name)?.callback();
  }
}

export class FakeSourceRepository implements Pick<
  SourceRepository,
  "listEnabled"
> {
  listEnabledCalls = 0;
  private readonly sources: readonly Source[];

  constructor(sources: readonly Source[] = []) {
    this.sources = sources;
  }

  listEnabled(): Source[] {
    this.listEnabledCalls += 1;
    return this.sources.filter((source) => source.enabled);
  }
}

export function createSchedulerSource(overrides: Partial<Source> = {}): Source {
  const id = overrides.id ?? "source-1";

  return {
    id,
    name: overrides.name ?? `Source ${id}`,
    type: overrides.type ?? "RSS",
    url: overrides.url ?? `https://sources.example.test/${id}.xml`,
    cron: overrides.cron ?? "0 * * * *",
    enabled: overrides.enabled ?? true,
    description: overrides.description ?? null,
    last_collected_at: overrides.last_collected_at ?? null,
  };
}

export interface SubmitRecorder {
  readonly submitted: RuntimeTask[];
  readonly submit: (task: RuntimeTask) => Promise<void>;
}

export function createSubmitRecorder(): SubmitRecorder {
  const submitted: RuntimeTask[] = [];

  return {
    submitted,
    async submit(task: RuntimeTask): Promise<void> {
      submitted.push(task);
    },
  };
}

export function createRejectingSubmit(
  message = "submit rejected",
): (task: RuntimeTask) => Promise<void> {
  return async () => {
    throw new Error(message);
  };
}

export interface SchedulerSourceRow {
  readonly id: string;
  readonly name?: string;
  readonly url?: string;
  readonly cron?: string;
  readonly enabled?: boolean;
}

export function insertSchedulerSource(
  database: Database.Database,
  row: SchedulerSourceRow,
): void {
  database
    .prepare(
      `
        INSERT INTO sources (
          id, name, type, url, cron, enabled, description, last_collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    )
    .run(
      row.id,
      row.name ?? `Source ${row.id}`,
      "RSS",
      row.url ?? `https://sources.example.test/${row.id}.xml`,
      row.cron ?? "0 * * * *",
      (row.enabled ?? true) ? 1 : 0,
    );
}

export async function withSchedulerSourceRepository<T>(
  callback: (
    repository: SqliteSourceRepository,
    database: Database.Database,
  ) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const database = openDatabase(databasePath);
    initializeDatabase(database);

    try {
      const repository = new SqliteSourceRepository(
        database,
        new SequenceIdGenerator([]),
      );
      return await callback(repository, database);
    } finally {
      closeDatabase(database);
    }
  });
}
