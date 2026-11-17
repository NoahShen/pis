import { AdapterError } from "../adapters/errors.js";
import {
  sourceContentSchema,
  type AdapterReason,
  type SourceAdapter,
  type SourceContent,
  type SourceEntry,
} from "../adapters/contracts.js";
import type { Source } from "../configuration/contracts.js";
import type { SourceRepository } from "../configuration/source-repository.js";
import type { Clock } from "../time/clock.js";
import { formatTimestamp } from "../time/format-time.js";
import {
  CollectionError,
  isCollectionAbort,
  toStableCollectionError,
  type CollectionErrorCode,
} from "./collection-errors.js";
import type { SourceAdapterRegistry } from "./adapter-registry.js";
import {
  createNoneSourceContent,
  createRawDataSourceItemV1,
  serializeRawDataSourceItemV1,
} from "./raw-data.js";
import { InProcessSingleFlight, type SingleFlight } from "./single-flight.js";
import {
  deduplicateSourceEntries,
  filterValidSourceEntries,
  getSourceItemIdentity,
} from "./source-item-identity.js";
import type { SourceItemRepository } from "./source-item-repository.js";

export type CollectionLogStage =
  | "source_lookup"
  | "select_adapter"
  | "fetch_entries"
  | "filter_entries"
  | "prefilter"
  | "fetch_content"
  | "complete";

export type CollectionLogReason =
  CollectionErrorCode | AdapterReason | "invalid_entry";

export interface CollectionLogMetadata {
  readonly sourceId: string;
  readonly stage: CollectionLogStage;
  readonly reason?: CollectionLogReason;
  readonly count?: number;
}

export interface CollectionLogger {
  log(metadata: CollectionLogMetadata): void;
}

export interface AcquisitionOptions {
  readonly signal?: AbortSignal;
}

export interface AcquisitionDraft {
  readonly entry: SourceEntry;
  readonly content: SourceContent;
  readonly raw_data: string;
}

export interface AcquisitionResult {
  readonly startedAt: string | null;
  readonly drafts: AcquisitionDraft[];
}

export interface SourceAcquirerDependencies {
  readonly sourceRepository: Pick<SourceRepository, "getById">;
  readonly sourceItemRepository: Pick<
    SourceItemRepository,
    "existsByExternalId" | "existsByUrlAndPublishedAt"
  >;
  readonly adapters: SourceAdapterRegistry;
  readonly clock: Clock;
  readonly logger: CollectionLogger;
  readonly singleFlight?: SingleFlight;
}

export type SourceAcquirer = (
  sourceId: string,
  options?: AcquisitionOptions,
) => Promise<AcquisitionResult>;

function log(
  logger: CollectionLogger,
  sourceId: string,
  stage: CollectionLogStage,
  reason?: CollectionLogReason,
  count?: number,
): void {
  logger.log({
    sourceId,
    stage,
    ...(reason === undefined ? {} : { reason }),
    ...(count === undefined ? {} : { count }),
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new CollectionError("aborted");
  }
}

function safeFailureReason(error: unknown): CollectionLogReason {
  if (error instanceof AdapterError) {
    return error.reason;
  }
  if (error instanceof CollectionError) {
    return error.code;
  }
  return "collection_failed";
}

function isCollected(
  sourceId: string,
  entry: SourceEntry,
  repository: Pick<
    SourceItemRepository,
    "existsByExternalId" | "existsByUrlAndPublishedAt"
  >,
): boolean {
  const identity = getSourceItemIdentity(entry);
  if (identity === null) {
    return false;
  }

  if (identity.kind === "external_id") {
    return repository.existsByExternalId(sourceId, identity.external_id);
  }

  return repository.existsByUrlAndPublishedAt(
    sourceId,
    identity.url,
    identity.published_at,
  );
}

function adapterSource(source: Source): {
  id: string;
  type: string;
  url: string;
} {
  return { id: source.id, type: source.type, url: source.url };
}

async function acquireEnabledSource(
  source: Source,
  signal: AbortSignal | undefined,
  dependencies: SourceAcquirerDependencies,
): Promise<AcquisitionResult> {
  assertNotAborted(signal);

  let adapter: SourceAdapter;
  try {
    adapter = dependencies.adapters.get(source.type);
  } catch (error) {
    const stableError =
      error instanceof CollectionError && error.code === "unsupported_source"
        ? error
        : toStableCollectionError(error);
    log(dependencies.logger, source.id, "select_adapter", stableError.code);
    throw stableError;
  }

  const startedAt = formatTimestamp(dependencies.clock.now());
  assertNotAborted(signal);

  let entries: SourceEntry[];
  try {
    entries = await adapter.fetchEntries(source, source.last_collected_at, {
      signal,
    });
  } catch (error) {
    const stableError = toStableCollectionError(error);
    log(
      dependencies.logger,
      source.id,
      "fetch_entries",
      safeFailureReason(error),
    );
    throw stableError;
  }
  assertNotAborted(signal);

  const validEntries = filterValidSourceEntries(entries);
  const invalidCount = entries.length - validEntries.length;
  if (invalidCount > 0) {
    log(
      dependencies.logger,
      source.id,
      "filter_entries",
      "invalid_entry",
      invalidCount,
    );
  }

  const uniqueEntries = deduplicateSourceEntries(validEntries);
  let candidates: SourceEntry[];
  try {
    candidates = uniqueEntries.filter(
      (entry) =>
        !isCollected(source.id, entry, dependencies.sourceItemRepository),
    );
  } catch (error) {
    const stableError = toStableCollectionError(error);
    log(
      dependencies.logger,
      source.id,
      "prefilter",
      safeFailureReason(stableError),
    );
    throw stableError;
  }

  const drafts: AcquisitionDraft[] = [];
  for (const entry of candidates) {
    assertNotAborted(signal);

    let content: SourceContent;
    try {
      content = await adapter.fetchContent(entry, { signal });
    } catch (error) {
      if (isCollectionAbort(error) || signal?.aborted === true) {
        log(dependencies.logger, source.id, "fetch_content", "aborted");
        throw new CollectionError("aborted");
      }

      if (error instanceof AdapterError) {
        if (error.reason === "aborted") {
          log(dependencies.logger, source.id, "fetch_content", "aborted");
          throw new CollectionError("aborted");
        }

        content = createNoneSourceContent(entry, error.reason);
        log(dependencies.logger, source.id, "fetch_content", error.reason, 1);
      } else {
        log(
          dependencies.logger,
          source.id,
          "fetch_content",
          "collection_failed",
        );
        throw error;
      }
    }
    assertNotAborted(signal);

    const normalizedContent = sourceContentSchema.parse(content);
    const rawData = createRawDataSourceItemV1(normalizedContent);
    drafts.push({
      entry: normalizedContent.entry,
      content: normalizedContent,
      raw_data: serializeRawDataSourceItemV1(rawData),
    });
  }

  log(dependencies.logger, source.id, "complete", undefined, drafts.length);
  return { startedAt, drafts };
}

function sourceIsEnabled(source: Source | null): source is Source {
  return source !== null && source.enabled;
}

export function createSourceAcquirer(
  dependencies: SourceAcquirerDependencies,
): SourceAcquirer {
  const singleFlight = dependencies.singleFlight ?? new InProcessSingleFlight();

  return async (sourceId, options = {}) => {
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      throw new CollectionError("invalid_input");
    }

    const signal = options.signal;
    assertNotAborted(signal);

    let source: Source | null;
    try {
      source = dependencies.sourceRepository.getById(sourceId);
    } catch (error) {
      const stableError = toStableCollectionError(error);
      log(
        dependencies.logger,
        sourceId,
        "source_lookup",
        safeFailureReason(stableError),
      );
      throw stableError;
    }

    if (!sourceIsEnabled(source)) {
      log(dependencies.logger, sourceId, "source_lookup", undefined, 0);
      return { startedAt: null, drafts: [] };
    }

    return singleFlight.run(sourceId, signal, (sharedSignal) =>
      acquireEnabledSource(source, sharedSignal, dependencies),
    );
  };
}
