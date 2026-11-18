import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
  type SourceItemRecord,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import {
  ContentPersistence,
  type ContentPersistenceDependencies,
} from "../../src/processing/content-persistence.js";
import {
  SqliteContentRepository,
  type ContentDraft,
  type ContentRecord,
  type ContentRepository,
} from "../../src/processing/content-repository.js";
import {
  SqliteProcessingSourceItemRepository,
  type ProcessingSourceItemRepository,
} from "../../src/processing/source-item-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_ID = "source-processing";

function insertSource(db: Database.Database): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
  ).run(
    SOURCE_ID,
    "Processing Source",
    "RSS",
    "https://fixture.example/processing.xml",
    "0 * * * *",
    1,
    null,
  );
}

function createSourceItemDraft(
  overrides: Partial<SourceItemDraft> = {},
): SourceItemDraft {
  return {
    source_id: SOURCE_ID,
    external_id: "fixture-guid",
    url: "https://fixture.example/item",
    title: "Fixture item",
    published_at: "2026-11-18T08:00:00.000+08:00",
    discovered_at: "2026-11-18T08:01:00.000+08:00",
    content_id: null,
    raw_data: '{"schema_version":1}',
    ...overrides,
  };
}

function insertSourceItem(
  db: Database.Database,
  id: string,
  overrides: Partial<SourceItemDraft> = {},
): SourceItemRecord {
  return new SqliteSourceItemRepository(
    db,
    new SequenceIdGenerator([id]),
  ).insert(createSourceItemDraft(overrides));
}

function createDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    title: "Persisted Content",
    url: "https://fixture.example/content",
    author: "Fixture Author",
    published_at: "2026-11-18T07:30:00.000+08:00",
    created_at: "2026-11-18T09:00:00.000+08:00",
    body: "Fixture body",
    summary: "Fixture summary",
    language: null,
    completeness: "FULL",
    ...overrides,
  };
}

function createRepositories(
  db: Database.Database,
  contentIds: readonly string[],
): {
  sourceItemRepository: SqliteProcessingSourceItemRepository;
  contentRepository: SqliteContentRepository;
} {
  return {
    sourceItemRepository: new SqliteProcessingSourceItemRepository(db),
    contentRepository: new SqliteContentRepository(
      db,
      new SequenceIdGenerator(contentIds),
    ),
  };
}

function createPersistence(
  dependencies: ContentPersistenceDependencies,
): ContentPersistence {
  return new ContentPersistence(dependencies);
}

function countContents(db: Database.Database): number {
  return (
    db.prepare("SELECT count(*) AS count FROM contents").get() as {
      count: number;
    }
  ).count;
}

function readContentId(
  db: Database.Database,
  sourceItemId: string,
): string | null {
  const row = db
    .prepare("SELECT content_id FROM source_items WHERE id = ?")
    .get(sourceItemId) as { content_id: string | null } | undefined;

  if (row === undefined) {
    throw new Error("Expected Source Item to exist");
  }

  return row.content_id;
}

function readContent(
  db: Database.Database,
  contentId: string,
): ContentRecord | undefined {
  return db
    .prepare(
      `
        SELECT
          id, title, url, author, published_at, created_at, body, summary,
          language, completeness
        FROM contents
        WHERE id = ?
      `,
    )
    .get(contentId) as ContentRecord | undefined;
}

class ObservingSourceItemRepository implements ProcessingSourceItemRepository {
  readonly associations: Array<{
    inTransaction: boolean;
    contentCount: number;
    contentId: string | null;
  }> = [];

  constructor(
    private readonly db: Database.Database,
    private readonly delegate: ProcessingSourceItemRepository,
  ) {}

  getById(id: string): SourceItemRecord | null {
    return this.delegate.getById(id);
  }

  setContentId(id: string, contentId: string): SourceItemRecord {
    const sourceItem = this.delegate.setContentId(id, contentId);
    const contentCount = countContents(this.db);

    this.associations.push({
      inTransaction: this.db.inTransaction,
      contentCount,
      contentId: readContentId(this.db, id),
    });

    return sourceItem;
  }
}

class TransactionRecordingSourceItemRepository implements ProcessingSourceItemRepository {
  readonly readsInTransaction: boolean[] = [];

  constructor(
    private readonly db: Database.Database,
    private readonly delegate: ProcessingSourceItemRepository,
  ) {}

  getById(id: string): SourceItemRecord | null {
    this.readsInTransaction.push(this.db.inTransaction);
    return this.delegate.getById(id);
  }

  setContentId(id: string, contentId: string): SourceItemRecord {
    return this.delegate.setContentId(id, contentId);
  }
}

class FailAfterInsertContentRepository implements ContentRepository {
  constructor(
    private readonly delegate: ContentRepository,
    private readonly failure: Error,
  ) {}

  getById(id: string): ContentRecord | null {
    return this.delegate.getById(id);
  }

  insert(draft: ContentDraft): ContentRecord {
    this.delegate.insert(draft);
    throw this.failure;
  }
}

class ThenableContentRepository implements ContentRepository {
  thenCalls = 0;

  constructor(private readonly delegate: ContentRepository) {}

  getById(id: string): ContentRecord | null {
    return this.delegate.getById(id);
  }

  insert(draft: ContentDraft): ContentRecord {
    const content = this.delegate.insert(draft);

    return {
      ...content,
      then: () => {
        this.thenCalls += 1;
      },
    } as unknown as ContentRecord;
  }
}

describe("ContentPersistence.ensureContent", () => {
  it("PRO-01 persists complete Content values, associates the Source Item, and is visible inside the transaction", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-pro-01");
        const repositories = createRepositories(db, ["content-pro-01"]);
        const observingRepository = new ObservingSourceItemRepository(
          db,
          repositories.sourceItemRepository,
        );
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: observingRepository,
          contentRepository: repositories.contentRepository,
        });
        const draft = createDraft();

        const content = persistence.ensureContent(sourceItem.id, draft);

        expect(content).toEqual({ id: "content-pro-01", ...draft });
        expect(readContent(db, "content-pro-01")).toEqual(content);
        expect(readContentId(db, sourceItem.id)).toBe("content-pro-01");
        expect(observingRepository.associations).toEqual([
          {
            inTransaction: true,
            contentCount: 1,
            contentId: "content-pro-01",
          },
        ]);
        expect(db.inTransaction).toBe(false);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it.each(["FULL", "PARTIAL"] as const)(
    "PRO-02 persists %s body and summary verbatim without fabricated values",
    async (completeness) => {
      await withDatabasePath((databasePath) => {
        const db = openDatabase(databasePath);

        try {
          initializeDatabase(db);
          insertSource(db);
          const sourceItem = insertSourceItem(
            db,
            `source-item-pro-02-${completeness}`,
          );
          const repositories = createRepositories(db, [
            `content-pro-02-${completeness}`,
          ]);
          const persistence = createPersistence({
            database: db,
            sourceItemRepository: repositories.sourceItemRepository,
            contentRepository: repositories.contentRepository,
          });
          const body =
            completeness === "FULL"
              ? "Actual FULL body <algorithm>\nList<T> ?"
              : "Only the actual acquired summary <kept>";
          const summary =
            completeness === "FULL"
              ? null
              : "Only the actual acquired summary <kept>";
          const draft = createDraft({
            title: `Title ${completeness} <T>`,
            url: "https://fixture.example/shared?title=<kept>",
            author: null,
            published_at: null,
            body,
            summary,
            completeness,
          });

          const content = persistence.ensureContent(sourceItem.id, draft);

          expect(content).toEqual({
            id: `content-pro-02-${completeness}`,
            ...draft,
          });
          expect(readContent(db, `content-pro-02-${completeness}`)).toEqual(
            content,
          );
          expect(readContentId(db, sourceItem.id)).toBe(
            `content-pro-02-${completeness}`,
          );
        } finally {
          closeDatabase(db);
        }
      });
    },
  );

  it("PRO-04 reuses an already-associated Content without inserting another row", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-pro-04-linked");
        const repositories = createRepositories(db, ["existing-content"]);
        const existing = repositories.contentRepository.insert(createDraft());
        repositories.sourceItemRepository.setContentId(
          sourceItem.id,
          existing.id,
        );
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: repositories.sourceItemRepository,
          contentRepository: repositories.contentRepository,
        });

        const reused = persistence.ensureContent(
          sourceItem.id,
          createDraft({ title: "Must not be inserted" }),
        );

        expect(reused).toEqual(existing);
        expect(countContents(db)).toBe(1);
        expect(readContentId(db, sourceItem.id)).toBe(existing.id);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("PRO-04 rechecks the association inside the transaction and reuses the same Content", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-pro-04-recheck");
        const repositories = createRepositories(db, ["content-pro-04"]);
        const recordingRepository =
          new TransactionRecordingSourceItemRepository(
            db,
            repositories.sourceItemRepository,
          );
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: recordingRepository,
          contentRepository: repositories.contentRepository,
        });

        const first = persistence.ensureContent(sourceItem.id, createDraft());
        const second = persistence.ensureContent(sourceItem.id, createDraft());

        expect(second).toEqual(first);
        expect(second?.id).toBe("content-pro-04");
        expect(countContents(db)).toBe(1);
        expect(readContentId(db, sourceItem.id)).toBe("content-pro-04");
        expect(recordingRepository.readsInTransaction).toEqual([
          true,
          true,
          true,
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("PRO-05 creates independent Content rows for Source Items with identical body and URL", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const firstSourceItem = insertSourceItem(
          db,
          "source-item-pro-05-first",
          { url: "https://fixture.example/identical", title: "First" },
        );
        const secondSourceItem = insertSourceItem(
          db,
          "source-item-pro-05-second",
          { url: "https://fixture.example/identical", title: "Second" },
        );
        const repositories = createRepositories(db, [
          "content-pro-05-first",
          "content-pro-05-second",
        ]);
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: repositories.sourceItemRepository,
          contentRepository: repositories.contentRepository,
        });
        const draft = createDraft({
          title: "Identical persisted draft",
          url: "https://fixture.example/identical",
          body: "Identical body",
          summary: "Identical summary",
        });

        const first = persistence.ensureContent(firstSourceItem.id, draft);
        const second = persistence.ensureContent(secondSourceItem.id, draft);

        expect(first?.id).toBe("content-pro-05-first");
        expect(second?.id).toBe("content-pro-05-second");
        expect(first?.id).not.toBe(second?.id);
        expect(countContents(db)).toBe(2);
        expect(readContentId(db, firstSourceItem.id)).toBe(first?.id);
        expect(readContentId(db, secondSourceItem.id)).toBe(second?.id);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("returns null without inserting when the Source Item does not exist", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repositories = createRepositories(db, []);
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: repositories.sourceItemRepository,
          contentRepository: repositories.contentRepository,
        });

        expect(
          persistence.ensureContent("missing-source-item", createDraft()),
        ).toBeNull();
        expect(countContents(db)).toBe(0);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("PRO-06 rolls back an inserted Content when association fails before write", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-pro-06");
        const repositories = createRepositories(db, ["content-pro-06"]);
        const failure = new Error("injected association failure");
        const failingRepository: ProcessingSourceItemRepository = {
          getById: (id) => repositories.sourceItemRepository.getById(id),
          setContentId: () => {
            throw failure;
          },
        };
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: failingRepository,
          contentRepository: repositories.contentRepository,
        });
        let observed: unknown;

        try {
          persistence.ensureContent(sourceItem.id, createDraft());
        } catch (error) {
          observed = error;
        }

        expect(observed).toBe(failure);
        expect(countContents(db)).toBe(0);
        expect(readContentId(db, sourceItem.id)).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("PRO-06 rolls back Content and association when Source Item readback fails after write", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-readback");
        const repositories = createRepositories(db, ["content-readback"]);
        const failure = new Error("injected readback failure");
        let readCount = 0;
        const failingRepository: ProcessingSourceItemRepository = {
          getById: (id) => {
            readCount += 1;
            if (readCount === 2) {
              throw failure;
            }
            return repositories.sourceItemRepository.getById(id);
          },
          setContentId: (id, contentId) =>
            repositories.sourceItemRepository.setContentId(id, contentId),
        };
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: failingRepository,
          contentRepository: repositories.contentRepository,
        });

        expect(() =>
          persistence.ensureContent(sourceItem.id, createDraft()),
        ).toThrow(failure);
        expect(countContents(db)).toBe(0);
        expect(readContentId(db, sourceItem.id)).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("rolls back Content when Content insertion fails after writing", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-insert-failure");
        const repositories = createRepositories(db, ["content-insert-failure"]);
        const failure = new Error("injected insert failure");
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: repositories.sourceItemRepository,
          contentRepository: new FailAfterInsertContentRepository(
            repositories.contentRepository,
            failure,
          ),
        });

        expect(() =>
          persistence.ensureContent(sourceItem.id, createDraft()),
        ).toThrow(failure);
        expect(countContents(db)).toBe(0);
        expect(readContentId(db, sourceItem.id)).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("rejects a thenable transaction result and rolls back all writes", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-thenable");
        const repositories = createRepositories(db, ["content-thenable"]);
        const thenableRepository = new ThenableContentRepository(
          repositories.contentRepository,
        );
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: repositories.sourceItemRepository,
          contentRepository: thenableRepository,
        });

        expect(() =>
          persistence.ensureContent(sourceItem.id, createDraft()),
        ).toThrow("withTransaction callback must not return a thenable");
        expect(thenableRepository.thenCalls).toBe(0);
        expect(countContents(db)).toBe(0);
        expect(readContentId(db, sourceItem.id)).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("fails when an existing content_id points to a missing Content", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-dangling");
        const repositories = createRepositories(db, []);
        const danglingRepository: ProcessingSourceItemRepository = {
          getById: () => ({ ...sourceItem, content_id: "missing-content" }),
          setContentId: () => {
            throw new Error("Must not write a dangling association");
          },
        };
        const persistence = createPersistence({
          database: db,
          sourceItemRepository: danglingRepository,
          contentRepository: repositories.contentRepository,
        });

        expect(() =>
          persistence.ensureContent(sourceItem.id, createDraft()),
        ).toThrow("Associated Content could not be read");
        expect(countContents(db)).toBe(0);
        expect(readContentId(db, sourceItem.id)).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });
});
