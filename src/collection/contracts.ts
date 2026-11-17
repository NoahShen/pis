import type Database from "better-sqlite3";

import type { SourceRepository } from "../configuration/source-repository.js";
import type { Clock } from "../time/clock.js";
import type { SourceAdapterRegistry } from "./adapter-registry.js";
import type { CollectionLogger } from "./collector.js";
import type { SingleFlight } from "./single-flight.js";
import type { SourceItemRepository } from "./source-item-repository.js";

export interface CollectOptions {
  signal?: AbortSignal;
}

export interface CollectResult {
  new_source_item_ids: string[];
}

export interface CollectionService {
  collect(sourceId: string, options?: CollectOptions): Promise<CollectResult>;
}

export interface CollectionFactoryDependencies {
  database: Database.Database;
  sourceRepository: SourceRepository;
  sourceItemRepository: SourceItemRepository;
  adapters: SourceAdapterRegistry;
  clock: Clock;
  logger: CollectionLogger;
  singleFlight?: SingleFlight;
}
