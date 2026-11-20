import type Database from "better-sqlite3";

import type { SourceAdapter } from "../../src/adapters/contracts.js";
import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import type { ProductionAssemblyDependencies } from "../../src/production/application.js";
import type {
  Runtime,
  RuntimeShutdownOptions,
  RuntimeTask,
} from "../../src/runtime/contracts.js";
import type { CronScheduler } from "../../src/scheduler/contracts.js";
import { FakeClock } from "./fake-clock.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";

export class ProductionDatabaseProbe {
  open = true;
  closeCalls = 0;
  closeError: Error | undefined;

  close(): void {
    this.closeCalls += 1;
    if (this.closeError !== undefined) {
      throw this.closeError;
    }
    this.open = false;
  }

  asDatabase(): Database.Database {
    return this as unknown as Database.Database;
  }
}

export class ProductionRuntimeProbe implements Runtime {
  readonly submitted: RuntimeTask[] = [];
  startCalls = 0;
  shutdownCalls = 0;
  stopAcceptingCalls = 0;
  drainCalls = 0;
  startError: Error | undefined;
  shutdownError: Error | undefined;

  async submit(task: RuntimeTask): Promise<void> {
    this.submitted.push(task);
  }

  async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startError !== undefined) {
      throw this.startError;
    }
  }

  stopAccepting(): void {
    this.stopAcceptingCalls += 1;
  }

  async drain(): Promise<void> {
    this.drainCalls += 1;
  }

  async shutdown(_options?: RuntimeShutdownOptions): Promise<void> {
    this.shutdownCalls += 1;
    if (this.shutdownError !== undefined) {
      throw this.shutdownError;
    }
  }
}

export class ProductionSchedulerProbe implements CronScheduler {
  startCalls = 0;
  stopCalls = 0;
  startError: Error | undefined;
  stopError: Error | undefined;
  submittedSourceIds: string[] = [];

  start(): void {
    this.startCalls += 1;
    if (this.startError !== undefined) {
      throw this.startError;
    }
  }

  stop(): void {
    this.stopCalls += 1;
    if (this.stopError !== undefined) {
      throw this.stopError;
    }
  }

  async trigger(sourceId: string): Promise<void> {
    this.submittedSourceIds.push(sourceId);
  }
}

export class ProductionTextCompletionClientProbe implements TextCompletionClient {
  readonly requests: TextCompletionRequest[] = [];

  async complete(request: TextCompletionRequest): Promise<string> {
    this.requests.push(request);
    throw new Error("unexpected completion");
  }
}

export class ProductionSourceAdapterProbe implements SourceAdapter {
  readonly entryCalls: string[] = [];
  readonly contentCalls: string[] = [];

  async fetchEntries(source: { readonly id: string }): Promise<never> {
    this.entryCalls.push(source.id);
    throw new Error("unexpected RSS request");
  }

  async fetchContent(entry: { readonly source_id: string }): Promise<never> {
    this.contentCalls.push(entry.source_id);
    throw new Error("unexpected article request");
  }
}

export interface ProductionDependencyProbes {
  readonly database: ProductionDatabaseProbe;
  readonly runtime: ProductionRuntimeProbe;
  readonly scheduler: ProductionSchedulerProbe;
}

export function createProductionDependencyProbes(
  overrides: Partial<ProductionDependencyProbes> = {},
): ProductionDependencyProbes {
  return {
    database: overrides.database ?? new ProductionDatabaseProbe(),
    runtime: overrides.runtime ?? new ProductionRuntimeProbe(),
    scheduler: overrides.scheduler ?? new ProductionSchedulerProbe(),
  };
}

export function productionTestDependencies(
  probes: ProductionDependencyProbes,
): Required<ProductionAssemblyDependencies> {
  return {
    database: probes.database.asDatabase(),
    clock: new FakeClock(new Date("2026-11-20T00:00:00.000Z")),
    idGenerator: new SequenceIdGenerator(["test-id"]),
    textCompletionClient: new ProductionTextCompletionClientProbe(),
    sourceAdapter: new ProductionSourceAdapterProbe(),
    runtime: probes.runtime,
    scheduler: probes.scheduler,
  };
}
