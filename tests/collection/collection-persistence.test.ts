import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type {
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import {
  createCollectionPersistence,
  type CollectionPersistenceDependencies,
} from "../../src/collection/collection-persistence.js";
import type {
  AcquisitionDraft,
  AcquisitionResult,
} from "../../src/collection/collector.js";
import {
  createNoneSourceContent,
  createRawDataSourceItemV1,
  parseRawDataSourceItemV1,
  serializeRawDataSourceItemV1,
} from "../../src/collection/raw-data.js";
import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
  type SourceItemRepository,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_ID = "source-transaction";
const OLD_CHECKPOINT = "2026-11-17T09:00:00.000+08:00";
const STARTED_AT = "2026-11-17T10:00:00.000+08:00";

interface SourceItemRow {
  id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  discovered_at: string;
  content_id: string | null;
  raw_data: string | null;
}

interface CheckpointRow {
  last_collected_at: string | null;
}

interface DatabaseState {
  transactionCount: number;
  checkpointUpdateCount: number;
}

interface DatabaseFaults {
  readonly failCheckpointUpdate?: boolean;
  readonly failCheckpointReadBack?: boolean;
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
    summary: "Fixture summary",
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

function createDraft(
  entry: SourceEntry,
  content = createContent(entry),
): AcquisitionDraft {
  const rawData = createRawDataSourceItemV1(content);
  return {
    entry: content.entry,
    content,
    raw_data: serializeRawDataSourceItemV1(rawData),
  };
}

function createAcquisition(
  drafts: AcquisitionDraft[],
  startedAt: string | null = STARTED_AT,
): AcquisitionResult {
  return { startedAt, drafts };
}

function insertSource(
  db: Database.Database,
  id = SOURCE_ID,
  lastCollectedAt: string | null = OLD_CHECKPOINT,
): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, 'RSS', ?, '0 * * * *', 1, NULL, ?)
    `,
  ).run(
    id,
    `Source ${id}`,
    `https://fixture.example/${id}.xml`,
    lastCollectedAt,
  );
}

function createSourceItemDraft(
  entry: SourceEntry,
  discoveredAt = STARTED_AT,
): SourceItemDraft {
  return {
    source_id: entry.source_id,
    external_id: entry.external_id,
    url: entry.url,
    title: entry.title,
    published_at: entry.published_at,
    discovered_at: discoveredAt,
    content_id: null,
    raw_data: "{}",
  };
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
        SELECT
          id, external_id, url, title, published_at, discovered_at,
          content_id, raw_data
        FROM source_items
        WHERE source_id = ?
        ORDER BY rowid ASC
      `,
    )
    .all(SOURCE_ID) as SourceItemRow[];
}

function instrumentDatabase(
  db: Database.Database,
  faults: DatabaseFaults = {},
): {
  readonly database: Database.Database;
  readonly state: DatabaseState;
} {
  const state: DatabaseState = {
    transactionCount: 0,
    checkpointUpdateCount: 0,
  };
  let checkpointUpdated = false;

  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        const transaction = target.transaction.bind(target);
        return ((operation: () => unknown) => {
          state.transactionCount += 1;
          return transaction(operation);
        }) as Database.Database["transaction"];
      }

      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          const isCheckpointUpdate = /\bUPDATE\s+sources\s+SET\b/iu.test(
            source,
          );
          const isCheckpointReadBack = /\bSELECT\s+last_collected_at\b/iu.test(
            source,
          );

          if (!isCheckpointUpdate && !isCheckpointReadBack) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run" && isCheckpointUpdate) {
                return (...parameters: unknown[]) => {
                  if (faults.failCheckpointUpdate === true) {
                    throw new Error("injected checkpoint update failure");
                  }

                  const result = Reflect.apply(
                    statementTarget.run,
                    statementTarget,
                    parameters,
                  );
                  state.checkpointUpdateCount += 1;
                  checkpointUpdated = true;
                  return result;
                };
              }

              if (
                statementProperty === "get" &&
                isCheckpointReadBack &&
                checkpointUpdated &&
                faults.failCheckpointReadBack === true
              ) {
                return (...parameters: unknown[]) => {
                  Reflect.apply(
                    statementTarget.get,
                    statementTarget,
                    parameters,
                  );
                  throw new Error("injected checkpoint read-back failure");
                };
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database.Database;

  return { database, state };
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
      throw new Error("injected private insert failure");
    }

    return this.repository.insert(draft);
  }
}

describe("Collection persistence", () => {
  it("COL-01/COL-16 inserts two ordered IDs once, advances checkpoint, and persists NONE with content_id NULL", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sqliteRepository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-a", "source-item-b"]),
        );
        const { database, state } = instrumentDatabase(db);
        const persistence = createCollectionPersistence({
          database,
          sourceItemRepository: sqliteRepository,
        });
        const firstEntry = createEntry({ external_id: "first-guid" });
        const noneEntry = createEntry({
          external_id: "none-guid",
          title: "NONE fixture",
        });
        const firstDraft = createDraft(firstEntry);
        const noneDraft = createDraft(
          noneEntry,
          createNoneSourceContent(noneEntry, "network_error"),
        );

        const result = persistence.persist(
          SOURCE_ID,
          createAcquisition([firstDraft, noneDraft]),
        );

        expect(result).toEqual({
          new_source_item_ids: ["source-item-a", "source-item-b"],
        });
        expect(state.transactionCount).toBe(1);
        expect(state.checkpointUpdateCount).toBe(1);
        expect(readCheckpoint(db)).toBe(STARTED_AT);

        const rows = readSourceItems(db);
        expect(rows.map((row) => row.id)).toEqual(result.new_source_item_ids);
        expect(rows.map((row) => row.content_id)).toEqual([null, null]);
        expect(rows.map((row) => row.discovered_at)).toEqual([
          STARTED_AT,
          STARTED_AT,
        ]);
        expect(rows.map((row) => row.raw_data)).toEqual([
          firstDraft.raw_data,
          noneDraft.raw_data,
        ]);
        expect(
          parseRawDataSourceItemV1(rows[1]?.raw_data ?? "").content,
        ).toMatchObject({
          body: null,
          summary: null,
          content_kind: "NONE",
          acquired_via: "NONE",
          completeness_basis: "NO_CONTENT",
        });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-07 rechecks each draft in order and accepts title-only duplicates", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const repository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator([
            "source-item-existing",
            "source-item-batch",
            "source-item-title-a",
            "source-item-title-b",
          ]),
        );
        const existingEntry = createEntry({ external_id: "existing-guid" });
        repository.insert(createSourceItemDraft(existingEntry));

        const persistence = createCollectionPersistence({
          database: db,
          sourceItemRepository: repository,
        });
        const batchEntry = createEntry({ external_id: "batch-guid" });
        const duplicateBatchEntry = createEntry({
          external_id: "batch-guid",
          title: "Same GUID in one transaction",
        });
        const titleOnlyA = createEntry({
          external_id: null,
          url: null,
          title: "Title only A",
        });
        const titleOnlyB = createEntry({
          external_id: null,
          url: null,
          title: "Title only B",
        });

        const result = persistence.persist(
          SOURCE_ID,
          createAcquisition([
            createDraft(existingEntry),
            createDraft(batchEntry),
            createDraft(duplicateBatchEntry),
            createDraft(titleOnlyA),
            createDraft(titleOnlyB),
          ]),
        );

        expect(result.new_source_item_ids).toEqual([
          "source-item-batch",
          "source-item-title-a",
          "source-item-title-b",
        ]);
        expect(readSourceItems(db).map((row) => row.id)).toEqual([
          "source-item-existing",
          "source-item-batch",
          "source-item-title-a",
          "source-item-title-b",
        ]);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-12 advances checkpoint exactly once for an empty successful acquisition", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const { database, state } = instrumentDatabase(db);
        const persistence = createCollectionPersistence({
          database,
          sourceItemRepository: new SqliteSourceItemRepository(
            db,
            new SequenceIdGenerator([]),
          ),
        });

        const result = persistence.persist(SOURCE_ID, createAcquisition([]));

        expect(result).toEqual({ new_source_item_ids: [] });
        expect(state.transactionCount).toBe(1);
        expect(state.checkpointUpdateCount).toBe(1);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(STARTED_AT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-11 rolls back earlier inserts and checkpoint when a later insert fails", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sqliteRepository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-first"]),
        );
        const { database, state } = instrumentDatabase(db);
        const persistence = createCollectionPersistence({
          database,
          sourceItemRepository: new FailSecondInsertRepository(
            sqliteRepository,
          ),
        });

        expect(() =>
          persistence.persist(
            SOURCE_ID,
            createAcquisition([
              createDraft(createEntry({ external_id: "first-guid" })),
              createDraft(createEntry({ external_id: "second-guid" })),
            ]),
          ),
        ).toThrow("injected private insert failure");

        expect(state.transactionCount).toBe(1);
        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-11 rolls back inserted rows when checkpoint update fails", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const { database } = instrumentDatabase(db, {
          failCheckpointUpdate: true,
        });
        const persistence = createCollectionPersistence({
          database,
          sourceItemRepository: new SqliteSourceItemRepository(
            db,
            new SequenceIdGenerator(["source-item-update-failure"]),
          ),
        });

        expect(() =>
          persistence.persist(
            SOURCE_ID,
            createAcquisition([createDraft(createEntry())]),
          ),
        ).toThrow("injected checkpoint update failure");

        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-11 rolls back checkpoint and rows when checkpoint read-back fails after UPDATE", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const { database } = instrumentDatabase(db, {
          failCheckpointReadBack: true,
        });
        const persistence = createCollectionPersistence({
          database,
          sourceItemRepository: new SqliteSourceItemRepository(
            db,
            new SequenceIdGenerator(["source-item-read-back-failure"]),
          ),
        });

        expect(() =>
          persistence.persist(
            SOURCE_ID,
            createAcquisition([createDraft(createEntry())]),
          ),
        ).toThrow("injected checkpoint read-back failure");

        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("requires the checkpoint update to match exactly one Source row", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const persistence = createCollectionPersistence({
          database: db,
          sourceItemRepository: new SqliteSourceItemRepository(
            db,
            new SequenceIdGenerator(["source-item-mismatched-source"]),
          ),
        });

        expect(() =>
          persistence.persist(
            "missing-source",
            createAcquisition([createDraft(createEntry())]),
          ),
        ).toThrow("Collection checkpoint did not match one Source");

        expect(readSourceItems(db)).toEqual([]);
        expect(readCheckpoint(db)).toBe(OLD_CHECKPOINT);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction rejects async and thenable callbacks inside the real database boundary", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const asyncCallback = async () => 1;
        const thenableCallback = () => ({ then: () => undefined });

        expect(() =>
          withTransaction(db, asyncCallback as unknown as () => number),
        ).toThrow("withTransaction requires a synchronous callback");
        expect(() =>
          withTransaction(db, thenableCallback as unknown as () => number),
        ).toThrow("withTransaction callback must not return a thenable");
      } finally {
        closeDatabase(db);
      }
    });
  });
});
