import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { SourceAdapter } from "../../src/adapters/contracts.js";
import {
  createSourceAdapterRegistry,
  type SourceAdapterRegistry,
} from "../../src/collection/adapter-registry.js";
import {
  CollectionError,
  createCollection,
  createRssAdapterRegistry,
} from "../../src/collection/index.js";
import { parseRawDataSourceItemV1 } from "../../src/collection/raw-data.js";
import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
  type SourceItemRecord,
  type SourceItemRepository,
} from "../../src/collection/source-item-repository.js";
import { SqliteSourceRepository } from "../../src/configuration/source-repository.js";
import * as collectionPublic from "../../src/collection/index.js";
import {
  CapturedCollectionLogger,
  countFixtureRows,
  createFixtureContent,
  createFixtureEntry,
  createFixtureSource,
  Deferred,
  FIXTURE_OLD_CHECKPOINT,
  FIXTURE_SOURCE_ID,
  FIXTURE_STARTED_AT,
  FixtureClock,
  FixtureCollectionAdapter,
  FixtureSequenceIdGenerator,
  insertFixtureSource,
  readFixtureCheckpoint,
  readFixtureSourceItems,
  trackFixtureTransactions,
  withFixtureCollectionDatabase,
} from "../fixtures/collection.js";

interface ServiceHarness {
  readonly collection: ReturnType<typeof createCollection>;
  readonly logger: CapturedCollectionLogger;
  readonly clock: FixtureClock;
  readonly transactionCount: () => number;
}

function createServiceHarness(
  db: Database.Database,
  {
    adapter = new FixtureCollectionAdapter(),
    adapters,
    sourceItemRepository,
  }: {
    adapter?: SourceAdapter;
    adapters?: SourceAdapterRegistry;
    sourceItemRepository?: SourceItemRepository;
  } = {},
): ServiceHarness {
  const transactions = trackFixtureTransactions(db);
  const logger = new CapturedCollectionLogger();
  const clock = new FixtureClock(new Date(FIXTURE_STARTED_AT).getTime());
  const repository =
    sourceItemRepository ??
    new SqliteSourceItemRepository(
      db,
      new FixtureSequenceIdGenerator("fixture-source-item"),
    );
  const registry =
    adapters ??
    createSourceAdapterRegistry(
      new Map<string, SourceAdapter>([["RSS", adapter]]),
    );

  const collection = createCollection({
    database: transactions.database,
    sourceRepository: new SqliteSourceRepository(
      db,
      new FixtureSequenceIdGenerator("unused-source"),
    ),
    sourceItemRepository: repository,
    adapters: registry,
    clock,
    logger,
  });

  return {
    collection,
    logger,
    clock,
    transactionCount: transactions.count,
  };
}

class FailSecondInsertRepository implements SourceItemRepository {
  private inserts = 0;

  constructor(private readonly repository: SourceItemRepository) {}

  existsByExternalId(sourceId: string, externalId: string): boolean {
    return this.repository.existsByExternalId(sourceId, externalId);
  }

  existsByUrlAndPublishedAt(
    sourceId: string,
    url: string,
    publishedAt: string | null,
  ): boolean {
    return this.repository.existsByUrlAndPublishedAt(
      sourceId,
      url,
      publishedAt,
    );
  }

  insert(draft: SourceItemDraft): SourceItemRecord {
    this.inserts += 1;
    if (this.inserts === 2) {
      throw new Error("private SQLite insert detail");
    }

    return this.repository.insert(draft);
  }
}

describe("Collection public service", () => {
  it("exports only the public API and returns only committed Source Item IDs", async () => {
    expect(Object.keys(collectionPublic).sort()).toEqual([
      "CollectionError",
      "createCollection",
      "createRssAdapterRegistry",
    ]);

    const firstRegistry = createRssAdapterRegistry();
    const secondRegistry = createRssAdapterRegistry();
    expect(firstRegistry.get("RSS")).not.toBe(secondRegistry.get("RSS"));
    expect(() => firstRegistry.get("ATOM")).toThrowError(CollectionError);

    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const entry = createFixtureEntry({ external_id: "public-result-guid" });
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => [entry]);
      adapter.enqueueContent(async (contentEntry) =>
        createFixtureContent(contentEntry),
      );
      const harness = createServiceHarness(db, { adapter });

      const result = await harness.collection.collect(FIXTURE_SOURCE_ID);

      expect(result).toEqual({
        new_source_item_ids: ["fixture-source-item-1"],
      });
      expect(Object.keys(result)).toEqual(["new_source_item_ids"]);
      expect(readFixtureSourceItems(db)).toEqual([
        expect.objectContaining({
          id: "fixture-source-item-1",
          source_id: FIXTURE_SOURCE_ID,
          external_id: "public-result-guid",
          content_id: null,
        }),
      ]);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_STARTED_AT);
      expect(harness.transactionCount()).toBe(1);
    });
  });

  it("rejects invalid Source IDs before repository, adapter, clock or transaction work", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const adapter = new FixtureCollectionAdapter();
      const harness = createServiceHarness(db, { adapter });

      await expect(harness.collection.collect("   ")).rejects.toMatchObject({
        name: "CollectionError",
        code: "invalid_input",
        message: "Invalid collection input",
      });
      await expect(
        harness.collection.collect(42 as unknown as string),
      ).rejects.toMatchObject({ code: "invalid_input" });

      expect(adapter.entryCalls).toHaveLength(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.transactionCount()).toBe(0);
      expect(readFixtureSourceItems(db)).toEqual([]);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_OLD_CHECKPOINT);
    });
  });

  it("returns empty results for missing and disabled Sources without adapter or checkpoint work", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(
        db,
        createFixtureSource({
          id: "disabled-fixture-source",
          enabled: false,
        }),
      );
      const adapter = new FixtureCollectionAdapter();
      const harness = createServiceHarness(db, { adapter });

      await expect(
        harness.collection.collect("missing-source"),
      ).resolves.toEqual({ new_source_item_ids: [] });
      await expect(
        harness.collection.collect("disabled-fixture-source"),
      ).resolves.toEqual({ new_source_item_ids: [] });

      expect(adapter.entryCalls).toHaveLength(0);
      expect(adapter.contentCalls).toHaveLength(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.transactionCount()).toBe(0);
      expect(readFixtureCheckpoint(db, "disabled-fixture-source")).toBe(
        FIXTURE_OLD_CHECKPOINT,
      );
    });
  });

  it("maps an unavailable adapter to unsupported_source without writes", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const adapters: SourceAdapterRegistry = {
        get(): SourceAdapter {
          throw new CollectionError("unsupported_source");
        },
      };
      const harness = createServiceHarness(db, { adapters });

      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID),
      ).rejects.toMatchObject({
        code: "unsupported_source",
        message: "The source adapter is not registered",
      });

      expect(harness.clock.calls).toBe(0);
      expect(harness.transactionCount()).toBe(0);
      expect(readFixtureSourceItems(db)).toEqual([]);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_OLD_CHECKPOINT);
    });
  });

  it("COL-13 skips obvious invalid entries, saves title-only identities, and logs no body", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const invalid = createFixtureEntry({
        external_id: null,
        url: null,
        title: null,
      });
      const titleOnlyFirst = createFixtureEntry({
        external_id: null,
        url: null,
        title: "Title-only fixture",
      });
      const titleOnlySecond = createFixtureEntry({
        external_id: null,
        url: null,
        title: "Title-only fixture",
      });
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => [
        invalid,
        titleOnlyFirst,
        titleOnlySecond,
      ]);
      adapter.enqueueContent(async (entry) => createFixtureContent(entry));
      adapter.enqueueContent(async (entry) => createFixtureContent(entry));
      const harness = createServiceHarness(db, { adapter });

      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID),
      ).resolves.toEqual({
        new_source_item_ids: ["fixture-source-item-1", "fixture-source-item-2"],
      });

      const rows = readFixtureSourceItems(db);
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.external_id === null)).toBe(true);
      expect(rows.every((row) => row.url === null)).toBe(true);
      expect(rows.map((row) => row.title)).toEqual([
        "Title-only fixture",
        "Title-only fixture",
      ]);
      expect(harness.logger.entries).toContainEqual({
        sourceId: FIXTURE_SOURCE_ID,
        stage: "filter_entries",
        reason: "invalid_entry",
        count: 1,
      });
      expect(JSON.stringify(harness.logger.entries)).not.toContain(
        "Synthetic collection body.",
      );
    });
  });

  it("COL-16 persists NONE content evidence and advances the checkpoint", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const entry = createFixtureEntry({ external_id: "none-guid" });
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => [entry]);
      adapter.enqueueContent(async (contentEntry) =>
        createFixtureContent(contentEntry, {
          body: null,
          summary: null,
          content_kind: "NONE",
          acquired_via: "NONE",
          completeness_basis: "NO_CONTENT",
          article: {
            status: "FAILED",
            reason: "network_error",
            final_url: null,
          },
        }),
      );
      const harness = createServiceHarness(db, { adapter });

      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID),
      ).resolves.toEqual({
        new_source_item_ids: ["fixture-source-item-1"],
      });

      const [row] = readFixtureSourceItems(db);
      expect(row?.content_id).toBeNull();
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_STARTED_AT);
      expect(countFixtureRows(db, "contents")).toBe(0);
      expect(parseRawDataSourceItemV1(row?.raw_data ?? "")).toMatchObject({
        schema_version: 1,
        entry: { external_id: "none-guid" },
        content: {
          body: null,
          summary: null,
          content_kind: "NONE",
          acquired_via: "NONE",
          completeness_basis: "NO_CONTENT",
          article: {
            status: "FAILED",
            reason: "network_error",
            final_url: null,
          },
        },
      });
    });
  });

  it("aborts after list acquisition without content, transaction or checkpoint side effects", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const controller = new AbortController();
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => {
        controller.abort();
        return [createFixtureEntry()];
      });
      const harness = createServiceHarness(db, { adapter });

      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "aborted" });

      expect(adapter.entryCalls).toHaveLength(1);
      expect(adapter.contentCalls).toHaveLength(0);
      expect(harness.transactionCount()).toBe(0);
      expect(readFixtureSourceItems(db)).toEqual([]);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_OLD_CHECKPOINT);
    });
  });

  it("maps a database failure to a safe error and rolls back all writes", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => [
        createFixtureEntry({ external_id: "first-failure-guid" }),
        createFixtureEntry({ external_id: "second-failure-guid" }),
      ]);
      adapter.enqueueContent(async (entry) => createFixtureContent(entry));
      adapter.enqueueContent(async (entry) => createFixtureContent(entry));
      const repository = new FailSecondInsertRepository(
        new SqliteSourceItemRepository(
          db,
          new FixtureSequenceIdGenerator("rolled-back"),
        ),
      );
      const harness = createServiceHarness(db, {
        adapter,
        sourceItemRepository: repository,
      });

      const error = await harness.collection
        .collect(FIXTURE_SOURCE_ID)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        name: "CollectionError",
        code: "collection_failed",
        message: "The collection operation failed",
      });
      expect(String(error)).not.toContain("private SQLite insert detail");
      expect(JSON.stringify(harness.logger.entries)).not.toContain(
        "private SQLite insert detail",
      );
      expect(harness.transactionCount()).toBe(1);
      expect(readFixtureSourceItems(db)).toEqual([]);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_OLD_CHECKPOINT);
    });
  });

  it("shares concurrent same-Source work and clears in-flight state for later calls", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const entries = new Deferred<ReturnType<typeof createFixtureEntry>[]>();
      const adapter = new FixtureCollectionAdapter();
      adapter.enqueueEntries(async () => entries.promise);
      adapter.enqueueEntries(async () => []);
      adapter.enqueueContent(async (entry) => createFixtureContent(entry));
      const harness = createServiceHarness(db, { adapter });

      const first = harness.collection.collect(FIXTURE_SOURCE_ID);
      const second = harness.collection.collect(FIXTURE_SOURCE_ID);
      expect(adapter.entryCalls).toHaveLength(1);

      entries.resolve([createFixtureEntry({ external_id: "shared-guid" })]);
      await expect(Promise.all([first, second])).resolves.toEqual([
        { new_source_item_ids: ["fixture-source-item-1"] },
        { new_source_item_ids: ["fixture-source-item-1"] },
      ]);

      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID),
      ).resolves.toEqual({ new_source_item_ids: [] });

      expect(adapter.entryCalls).toHaveLength(2);
      expect(adapter.contentCalls).toHaveLength(1);
      expect(harness.transactionCount()).toBe(2);
      expect(readFixtureSourceItems(db)).toHaveLength(1);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_STARTED_AT);
    });
  });
});
