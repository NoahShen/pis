export { createRssAdapterRegistry } from "./adapter-registry.js";
export { CollectionError } from "./collection-errors.js";
export { createCollection } from "./collector.js";

export type {
  CollectOptions,
  CollectResult,
  CollectionFactoryDependencies,
  CollectionService,
} from "./contracts.js";
export type {
  CollectionLogMetadata,
  CollectionLogReason,
  CollectionLogStage,
  CollectionLogger,
} from "./collector.js";
export type { SourceAdapterRegistry } from "./adapter-registry.js";
export type {
  AdapterCallOptions,
  AdapterSource,
  SourceAdapter,
  SourceContent,
  SourceEntry,
} from "../adapters/contracts.js";
export type { RawDataSourceItemV1 } from "./raw-data.js";
