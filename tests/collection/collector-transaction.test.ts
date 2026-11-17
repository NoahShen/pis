import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type {
  AdapterCallOptions,
  SourceAdapter,
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import { AdapterError } from "../../src/adapters/errors.js";
import { createSourceAdapterRegistry } from "../../src/collection/adapter-registry.js";
import { createCollectionPersistence } from "../../src/collection/collection-persistence.js";
import {
  createSourceCollector,
  type CollectionLogMetadata,
  type CollectionLogger,
} from "../../src/collection/collector.js";
import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
  type SourceItemRepository,
} from "../../src/collection/source-item-repository.js";
import type { Source } from "../../src/configuration/contracts.js";
import { SqliteSourceRepository } from "../../src/configuration/source-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_ID = "source-collector-transaction";
const OLD_CHECKPOINT = "2026-11-17T09:00:00.000+08:00";
const STARTED_AT = "2026-11-17T10:00:00.000+08:00";

interface CheckpointRow {
  last_collected_at: string | null;
}

interface SourceItemRow {
  id: string;
  external_id: string | null;
  content_id: string | null;
}

interface EntryCall {
  readonly sourceId: string;
  readonly lastCollectedAt: string | null;
  readonly options: AdapterCallOptions | undefined;
}

interface ContentCall {
  readonly externalId: string | null;
  readonly options: AdapterCallOptions | undefined;
}

interface RecordingAdapter extends SourceAdapter {
  readonly entryCalls: EntryCall[];
  readonly contentCalls: ContentCall[];
}

class CapturedLogger implements CollectionLogger {
  readonly entries: CollectionLogMetadata[] = [];

  log(metadata: CollectionLogMetadata): void {
    this.entries.push(metadata);
  }
}

function createSource(): Source {
  return {
    id: SOURCE_ID,
    name: "Collection transaction source",
    type: "RSS",
    url: "https://fixture.example/feed.xml",
    cron: "0 * * * *",
    enabled: true,
    description: null,
    last_collected_at: OLD_CHECKPOINT,
  };
}

function insertSource(db: Database.Database): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
    `,
  ).run(
    SOURCE_ID,
    "Collection transaction source",
    "RSS",
    "https://fixture.example/feed.xml",
    "0 * * * *",
    OLD_CHECKPOINT,
  );
}

function createEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: SOURCE_ID,
    external_id: "fixture-guid",
    url: "https://fixture.example/item",
    title: "Fixture item",
    author: null,
    published_at: "2026-11-17T09:30:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

function createContent(entry: SourceEntry): SourceContent {
  return {
    schema_version: 1,
    entry,
    body: "Fixture body",
    summary: null,
    content_kind: "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
  };
}

function createAdapter(
  fetchEntries: SourceAdapter["fetchEntries"],
  fetchContent: SourceAdapter["fetchContent"],
): RecordingAdapter {
  const entryCalls: EntryCall[] = [];
  const contentCalls: ContentCall[] = [];

  return {
    entryCalls,
    contentCalls,
    async fetchEntries(source, lastCollectedAt, options) {
      entryCalls.push({
        sourceId: source.id,
        lastCollectedAt,
        options,
      });
      return fetchEntries(source, lastCollectedAt, options);
    },
    async fetchContent(entry, options) {
      contentCalls.push({ externalId: entry.external_id, options });
      return fetchContent(entry, options);
    },
  };
}

function countTransactions(db: Database.Database): {
  readonly database: Database.Database;
  readonly count: () => number;
} {
  let transactionCount = 0;
  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        const transaction = target.transaction.bind(target);
        return ((operation: () => unknown) => {
          transactionCount += 1;
          return transaction(operation);
        }) as Database.Database["transaction"];
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database.Database;

  return { database, count: () => transactionCount };
}

function readCheckpoint(db: Database.Database): string | null {
  return (
    db
      .prepare("SELECT last_collected_at FROM sources WHERE id = ?")
      .get(SOURCE_ID) as CheckpointRow
  ).last_collected_at;
}

function readSourceItems(db: Database.Database): SourceItemRow[] {
  return db
    .prepare(
      `
        SELECT id, external_id, content_id
        FROM source_items
        WHERE source_id = ?
        ORDER BY rowid ASC
      `,
    )
    .all(SOURCE_ID) as SourceItemRow[];
}

function createSourceItemDraft(entry: SourceEntry): SourceItemDraft {
  return {
    source_id: entry.source_id,
    external_id: entry.external_id,
    url: entry.url,
    title: entry.title,
    published_at: entry.published_at,
    discovered_at: STARTED_AT,
    content_id: null,
    raw_data: "{}",
  };
}

class FailSecondInsertRepository implements Pick<
  SourceItemRepository,
  "existsByExternalId" | "existsByUrlAndPublishedAt" | "insert"
> {
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

  insert(draft: SourceItemDraft) {
    this.inserts += 1;
    if (this.inserts === 2) {
      throw new Error("private SQLite insert detail");
    }

    return this.repository.insert(draft);
  }
}

function createHarness(options: {
  readonly db: Database.Database;
  readonly adapter: SourceAdapter;
  readonly sourceItems?: SourceItemRepository;
  readonly ids?: readonly string[];
}) {
  const sourceItems =
    options.sourceItems ??
    new SqliteSourceItemRepository(
      options.db,
      new SequenceIdGenerator(options.ids ?? []),
    );
  const { database, count } = countTransactions(options.db);
  const persistence = createCollectionPersistence({
    database,
    sourceItemRepository: sourceItems,
  });
  const sourceRepository = new SqliteSourceRepository(
    options.db,
    new SequenceIdGenerator([]),
  );
  const logger = new CapturedLogger();
  const clock = new FakeClock(new Date("2026-11-17T02:00:00.000Z"));
  const collect = createSourceCollector({
    sourceRepository,
    sourceItemRepository: sourceItems,
    adapters: createSourceAdapterRegistry(
      new Map<string, SourceAdapter>([["RSS", options.adapter]]),
    ),
    clock,
    logger,
    persistence,
  });

  return { collect, logger, transactionCount: count };
}

describe("Collection collector transaction integration", () => {
  it("COL-01 wires acquisition into one persisted result and returns only committed IDs", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const first = createEntry({ external_id: "first-guid" });
        const second = createEntry({ external_id: "second-guid" });
        const adapter = createAdapter(
          async () => [first, second],
          async (entry) => createContent(entry),
        );
        const harness = createHarness({
          db,
          adapter,
          ids: ["source-item-first", "source-item-second"],
        });

        await expect(harness.collect(SOURCE_ID)).resolves.toEqual({
          new_source_item_ids: ["source-item-first", "source-item-second"],
        });

        expect(harness.transactionCount()).toBe(1);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
        expect(readSourceItems(db)).toEqual([
          {
            id: "source-item-first",
            external_id: "first-guid",
            content_id: null,
          },
          {
            id: "source-item-second",
            external_id: "second-guid",
            content_id: null,
          },
        ]);
        expect(harness.logger.entries).toContainEqual({
          sourceId: SOURCE_ID,
          stage: "complete",
          count: 2,
        });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-12 returns empty IDs and advances checkpoint for a successful empty list", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const adapter = createAdapter(
          async () => [],
          async (entry) => createContent(entry),
        );
        const harness = createHarness({ db, adapter });

        await expect(harness.collect(SOURCE_ID)).resolves.toEqual({
          new_source_item_ids: [],
        });

        expect(harness.transactionCount()).toBe(1);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
        expect(readSourceItems(db)).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-07 rechecks after the prefilter window and skips a concurrently inserted identity", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const repository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-concurrent"]),
        );
        const entry = createEntry({ external_id: "racing-guid" });
        const adapter = createAdapter(
          async () => [entry],
          async (contentEntry) => {
            repository.insert(createSourceItemDraft(contentEntry));
            return createContent(contentEntry);
          },
        );
        const harness = createHarness({ db, adapter, sourceItems: repository });

        await expect(harness.collect(SOURCE_ID)).resolves.toEqual({
          new_source_item_ids: [],
        });

        expect(harness.transactionCount()).toBe(1);
        expect(readSourceItems(db)).toEqual([
          {
            id: "source-item-concurrent",
            external_id: "racing-guid",
            content_id: null,
          },
        ]);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-11 performs no transaction for list failure, content programming error, or pre-abort", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const listAdapter = createAdapter(
          async () => {
            throw new AdapterError("network_error");
          },
          async (entry) => createContent(entry),
        );
        const listHarness = createHarness({ db, adapter: listAdapter });

        await expect(listHarness.collect(SOURCE_ID)).rejects.toMatchObject({
          code: "collection_failed",
          message: "The collection operation failed",
        });
        expect(listHarness.transactionCount()).toBe(0);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);

        const programmingFailure = new Error("private programming detail");
        const contentAdapter = createAdapter(
          async () => [createEntry()],
          async () => {
            throw programmingFailure;
          },
        );
        const contentHarness = createHarness({
          db,
          adapter: contentAdapter,
        });

        await expect(contentHarness.collect(SOURCE_ID)).rejects.toBe(
          programmingFailure,
        );
        expect(contentHarness.transactionCount()).toBe(0);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);

        const abortAdapter = createAdapter(
          async () => [createEntry()],
          async (entry) => createContent(entry),
        );
        const abortHarness = createHarness({ db, adapter: abortAdapter });
        const controller = new AbortController();
        controller.abort();

        await expect(
          abortHarness.collect(SOURCE_ID, { signal: controller.signal }),
        ).rejects.toMatchObject({ code: "aborted" });
        expect(abortAdapter.entryCalls).toHaveLength(0);
        expect(abortHarness.transactionCount()).toBe(0);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-11 maps database insert failure to a safe error and rolls back all writes", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sqliteRepository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-rolled-back"]),
        );
        const adapter = createAdapter(
          async () => [
            createEntry({ external_id: "first-guid" }),
            createEntry({ external_id: "second-guid" }),
          ],
          async (entry) => createContent(entry),
        );
        const harness = createHarness({
          db,
          adapter,
          sourceItems: new FailSecondInsertRepository(sqliteRepository),
        });

        const error = await harness
          .collect(SOURCE_ID)
          .catch((caught) => caught);
        expect(error).toMatchObject({
          name: "CollectionError",
          code: "collection_failed",
          message: "The collection operation failed",
        });
        expect(String(error)).not.toContain("private SQLite insert detail");
        expect(harness.transactionCount()).toBe(1);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
        expect(JSON.stringify(harness.logger.entries)).not.toContain(
          "private SQLite insert detail",
        );
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-14 keeps acquisition and persistence inside one shared single-flight operation", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        let resolveEntries!: (entries: SourceEntry[]) => void;
        const entries = new Promise<SourceEntry[]>((resolve) => {
          resolveEntries = resolve;
        });
        const entry = createEntry({ external_id: "shared-guid" });
        const adapter = createAdapter(
          async () => entries,
          async (contentEntry) => createContent(contentEntry),
        );
        const harness = createHarness({
          db,
          adapter,
          ids: ["source-item-shared"],
        });

        const first = harness.collect(SOURCE_ID);
        const second = harness.collect(SOURCE_ID);
        await Promise.resolve();
        expect(adapter.entryCalls).toHaveLength(1);

        resolveEntries([entry]);
        await expect(Promise.all([first, second])).resolves.toEqual([
          { new_source_item_ids: ["source-item-shared"] },
          { new_source_item_ids: ["source-item-shared"] },
        ]);

        expect(adapter.entryCalls).toHaveLength(1);
        expect(adapter.contentCalls).toHaveLength(1);
        expect(harness.transactionCount()).toBe(1);
        expect(readSourceItems(db)).toEqual([
          {
            id: "source-item-shared",
            external_id: "shared-guid",
            content_id: null,
          },
        ]);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
      } finally {
        closeDatabase(db);
      }
    });
  });
});
