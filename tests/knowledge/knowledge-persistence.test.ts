import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initializeDatabase } from "../../src/database/schema.js";
import type { IdGenerator } from "../../src/id/id-generator.js";
import {
  KnowledgePersistence,
  type KnowledgeDraftInput,
} from "../../src/knowledge/knowledge-persistence.js";
import {
  type KnowledgeDraft,
  type KnowledgeRecord,
  type KnowledgeRepository,
  SqliteKnowledgeRepository,
} from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

interface RawKnowledgeRow {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: string | null;
  findings_json: string;
  value: string;
}

interface RepositoryEvent {
  operation: "get" | "insert";
  inTransaction: boolean;
}

async function withKnowledgeDatabase<T>(
  callback: (db: Database.Database) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath((databasePath) => {
    const db = new Database(databasePath);
    initializeDatabase(db);

    try {
      return callback(db);
    } finally {
      closeDatabase(db);
    }
  });
}

function insertContent(
  db: Database.Database,
  id: string,
  body = `Body for ${id}`,
): void {
  db.prepare(
    `
      INSERT INTO contents (
        id, title, created_at, body, completeness
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(id, "Shared title", "2026-11-18T09:00:00.000+08:00", body, "FULL");
}

function draftFor(contentId: string): KnowledgeDraftInput {
  return {
    content_id: contentId,
    title: "Knowledge title",
    summary: "Knowledge summary",
    category: "Experience",
    findings: [
      { title: "First", description: "First finding" },
      { title: "Second", description: "Second finding" },
    ],
    value: "Knowledge value",
  };
}

function storedDraft(
  id: string,
  contentId: string,
  overrides: Partial<KnowledgeDraft> = {},
): KnowledgeDraft {
  return {
    id,
    ...draftFor(contentId),
    ...overrides,
  };
}

function knowledgeCount(db: Database.Database): number {
  const row = db.prepare("SELECT count(*) AS count FROM knowledge").get() as {
    count: number;
  };
  return row.count;
}

function rawKnowledge(
  db: Database.Database,
  contentId: string,
): RawKnowledgeRow | undefined {
  return db
    .prepare(
      `
        SELECT id, content_id, title, summary, category, findings_json, value
        FROM knowledge
        WHERE content_id = ?
      `,
    )
    .get(contentId) as RawKnowledgeRow | undefined;
}

function persistenceFor(
  db: Database.Database,
  knowledgeRepository: KnowledgeRepository,
  idGenerator: IdGenerator,
): KnowledgePersistence {
  return new KnowledgePersistence({
    database: db,
    knowledgeRepository,
    idGenerator,
  });
}

class RecordingKnowledgeRepository implements KnowledgeRepository {
  readonly events: RepositoryEvent[] = [];
  readonly #db: Database.Database;
  readonly #delegate: KnowledgeRepository;

  constructor(db: Database.Database, delegate: KnowledgeRepository) {
    this.#db = db;
    this.#delegate = delegate;
  }

  getByContentId(contentId: string): KnowledgeRecord | null {
    this.events.push({
      operation: "get",
      inTransaction: this.#db.inTransaction,
    });
    return this.#delegate.getByContentId(contentId);
  }

  insert(draft: KnowledgeDraft): KnowledgeRecord {
    this.events.push({
      operation: "insert",
      inTransaction: this.#db.inTransaction,
    });
    return this.#delegate.insert(draft);
  }
}

class StaleOnceKnowledgeRepository implements KnowledgeRepository {
  #getCount = 0;
  insertCallCount = 0;
  readonly #delegate: KnowledgeRepository;

  constructor(delegate: KnowledgeRepository) {
    this.#delegate = delegate;
  }

  getByContentId(contentId: string): KnowledgeRecord | null {
    this.#getCount += 1;
    if (this.#getCount === 1) {
      return null;
    }

    return this.#delegate.getByContentId(contentId);
  }

  insert(draft: KnowledgeDraft): KnowledgeRecord {
    this.insertCallCount += 1;
    return this.#delegate.insert(draft);
  }
}

class AfterInsertFailureKnowledgeRepository implements KnowledgeRepository {
  insertCompleted = false;
  readonly #delegate: KnowledgeRepository;
  readonly #failure: Error;

  constructor(delegate: KnowledgeRepository, failure: Error) {
    this.#delegate = delegate;
    this.#failure = failure;
  }

  getByContentId(contentId: string): KnowledgeRecord | null {
    return this.#delegate.getByContentId(contentId);
  }

  insert(draft: KnowledgeDraft): KnowledgeRecord {
    this.#delegate.insert(draft);
    this.insertCompleted = true;
    throw this.#failure;
  }
}

function captureError(callback: () => void): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to fail");
}

describe("KnowledgePersistence", () => {
  it("ENSURE_INSERT generates the ID, inserts and verifies inside one transaction", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-insert");
      const delegate = new SqliteKnowledgeRepository(db);
      const repository = new RecordingKnowledgeRepository(db, delegate);
      const persistence = persistenceFor(
        db,
        repository,
        new SequenceIdGenerator(["generated-knowledge-id"]),
      );
      const input = { ...draftFor("content-insert"), id: "caller-id" };

      const result = persistence.ensureKnowledge(input);

      expect(result).toMatchObject({
        id: "generated-knowledge-id",
        content_id: "content-insert",
      });
      expect(repository.events).toEqual([
        { operation: "get", inTransaction: true },
        { operation: "insert", inTransaction: true },
        { operation: "get", inTransaction: true },
      ]);
      expect(db.inTransaction).toBe(false);
      expect(knowledgeCount(db)).toBe(1);
      expect(rawKnowledge(db, "content-insert")?.id).toBe(
        "generated-knowledge-id",
      );
    });
  });

  it("ENSURE_REUSE returns the original row without generating an ID or inserting", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-reuse");
      const delegate = new SqliteKnowledgeRepository(db);
      const original = delegate.insert(
        storedDraft("knowledge-original", "content-reuse", {
          title: "Original title",
          findings: [{ title: "Original", description: "Unchanged" }],
        }),
      );
      const repository = new RecordingKnowledgeRepository(db, delegate);
      const persistence = persistenceFor(
        db,
        repository,
        new SequenceIdGenerator([]),
      );

      const result = persistence.ensureKnowledge({
        ...draftFor("content-reuse"),
        title: "Replacement title",
      });

      expect(result).toEqual(original);
      expect(repository.events).toEqual([
        { operation: "get", inTransaction: true },
      ]);
      expect(knowledgeCount(db)).toBe(1);
      expect(delegate.getByContentId("content-reuse")).toEqual(original);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("ROLLBACK leaves no row when insert fails", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-insert-failure");
      db.exec(`
        CREATE TRIGGER reject_knowledge_insert
        BEFORE INSERT ON knowledge
        BEGIN
          SELECT RAISE(ABORT, 'fixture insert failure');
        END;
      `);
      const persistence = persistenceFor(
        db,
        new SqliteKnowledgeRepository(db),
        new SequenceIdGenerator(["knowledge-failed-insert"]),
      );

      expect(() =>
        persistence.ensureKnowledge(draftFor("content-insert-failure")),
      ).toThrow("fixture insert failure");
      expect(knowledgeCount(db)).toBe(0);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("ROLLBACK_AFTER_INSERT removes a successfully inserted row when the delegate subsequently throws", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-after-insert-failure");
      const delegate = new SqliteKnowledgeRepository(db);
      const failure = new Error("fixture after-insert failure");
      const repository = new AfterInsertFailureKnowledgeRepository(
        delegate,
        failure,
      );
      const persistence = persistenceFor(
        db,
        repository,
        new SequenceIdGenerator(["knowledge-after-insert-failure"]),
      );

      const observed = captureError(() =>
        persistence.ensureKnowledge(draftFor("content-after-insert-failure")),
      );

      expect(observed).toBe(failure);
      expect(repository.insertCompleted).toBe(true);
      expect(knowledgeCount(db)).toBe(0);
      expect(db.inTransaction).toBe(false);
      expect(
        delegate.getByContentId("content-after-insert-failure"),
      ).toBeNull();
    });
  });

  it("ROLLBACK removes the inserted row when ID readback fails", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-readback-failure");
      db.exec(`
        CREATE TRIGGER remove_knowledge_before_readback
        AFTER INSERT ON knowledge
        BEGIN
          DELETE FROM knowledge WHERE id = NEW.id;
        END;
      `);
      const persistence = persistenceFor(
        db,
        new SqliteKnowledgeRepository(db),
        new SequenceIdGenerator(["knowledge-failed-readback"]),
      );

      expect(() =>
        persistence.ensureKnowledge(draftFor("content-readback-failure")),
      ).toThrow("Inserted Knowledge could not be read");
      expect(knowledgeCount(db)).toBe(0);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("SYNC_CALLBACK rejects a thenable through the real withTransaction and rolls back writes", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-thenable");
      let thenCallCount = 0;
      const thenableRecord = {
        then: () => {
          thenCallCount += 1;
        },
      } as unknown as KnowledgeRecord;
      const repository: KnowledgeRepository = {
        getByContentId(contentId) {
          db.prepare(
            `
              INSERT INTO knowledge (
                id, content_id, title, summary, category, findings_json, value
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            "knowledge-thenable",
            contentId,
            "Title",
            "Summary",
            "Insight",
            "[]",
            "Value",
          );
          return thenableRecord;
        },
        insert() {
          throw new Error("insert must not run for a thenable recheck");
        },
      };
      const persistence = persistenceFor(
        db,
        repository,
        new SequenceIdGenerator(["unused-knowledge-id"]),
      );

      expect(() =>
        persistence.ensureKnowledge(draftFor("content-thenable")),
      ).toThrow("withTransaction callback must not return a thenable");
      expect(thenCallCount).toBe(0);
      expect(knowledgeCount(db)).toBe(0);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("UNIQUE_RACE rolls back, rereads the competitor row and reuses its ID", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-race");
      const delegate = new SqliteKnowledgeRepository(db);
      const competitor = delegate.insert(
        storedDraft("knowledge-competitor", "content-race", {
          title: "Competitor title",
        }),
      );
      const repository = new StaleOnceKnowledgeRepository(delegate);
      const persistence = persistenceFor(
        db,
        repository,
        new SequenceIdGenerator(["knowledge-race-loser"]),
      );

      const result = persistence.ensureKnowledge({
        ...draftFor("content-race"),
        title: "Loser title",
      });

      expect(result).toEqual(competitor);
      expect(repository.insertCallCount).toBe(1);
      expect(knowledgeCount(db)).toBe(1);
      expect(delegate.getByContentId("content-race")).toEqual(competitor);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("INDEPENDENT_CONTENT creates different IDs for identical fields in different Content", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-one", "Identical body");
      insertContent(db, "content-two", "Identical body");
      const persistence = persistenceFor(
        db,
        new SqliteKnowledgeRepository(db),
        new SequenceIdGenerator(["knowledge-one", "knowledge-two"]),
      );

      const first = persistence.ensureKnowledge(draftFor("content-one"));
      const second = persistence.ensureKnowledge(draftFor("content-two"));

      expect(first.id).toBe("knowledge-one");
      expect(second.id).toBe("knowledge-two");
      expect(first.id).not.toBe(second.id);
      expect(knowledgeCount(db)).toBe(2);
      expect(rawKnowledge(db, "content-one")?.id).toBe("knowledge-one");
      expect(rawKnowledge(db, "content-two")?.id).toBe("knowledge-two");
      expect(db.inTransaction).toBe(false);
    });
  });

  it("KNO-11 persists null category as SQL NULL and findings as an empty JSON array", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-empty-values");
      const persistence = persistenceFor(
        db,
        new SqliteKnowledgeRepository(db),
        new SequenceIdGenerator(["knowledge-empty-values"]),
      );

      persistence.ensureKnowledge({
        ...draftFor("content-empty-values"),
        category: null,
        findings: [],
      });

      const row = rawKnowledge(db, "content-empty-values");
      expect(row?.category).toBeNull();
      expect(row?.findings_json).toBe("[]");
      expect(db.inTransaction).toBe(false);
    });
  });

  it("fails malformed drafts and empty categories without leaving a row", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-malformed");
      insertContent(db, "content-empty-category");
      const malformed = {
        ...draftFor("content-malformed"),
        findings: [{ title: "Missing description" }],
      } as unknown as KnowledgeDraftInput;
      const persistence = persistenceFor(
        db,
        new SqliteKnowledgeRepository(db),
        new SequenceIdGenerator([
          "knowledge-malformed",
          "knowledge-empty-category",
        ]),
      );

      expect(() => persistence.ensureKnowledge(malformed)).toThrow(
        "Malformed Knowledge findings",
      );
      expect(
        rawKnowledge(db, "content-empty-category")?.category,
      ).toBeUndefined();

      const emptyCategory = {
        ...draftFor("content-empty-category"),
        category: "",
      } as unknown as KnowledgeDraftInput;
      expect(() => persistence.ensureKnowledge(emptyCategory)).toThrow();
      expect(knowledgeCount(db)).toBe(0);
      expect(db.inTransaction).toBe(false);
    });
  });
});
