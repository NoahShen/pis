import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initializeDatabase } from "../../src/database/schema.js";
import {
  type KnowledgeCategory,
  type KnowledgeDraft,
  type KnowledgeFinding,
  SqliteKnowledgeRepository,
} from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

interface RawKnowledgeRow {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: string | null;
  findings_json: string;
  value: string;
}

const findings: KnowledgeFinding[] = [
  { title: "First", description: "First finding" },
  { title: "Second", description: "Second finding" },
  { title: "Third", description: "Third finding" },
];

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

function insertContent(db: Database.Database, id: string): void {
  db.prepare(
    `
      INSERT INTO contents (
        id, title, created_at, body, completeness
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    `Content ${id}`,
    "2026-11-18T09:00:00.000+08:00",
    `Body for ${id}`,
    "FULL",
  );
}

function draftFor(
  id: string,
  contentId: string,
  overrides: Partial<KnowledgeDraft> = {},
): KnowledgeDraft {
  return {
    id,
    content_id: contentId,
    title: "Knowledge title",
    summary: "Knowledge summary",
    category: "Insight",
    findings: [...findings],
    value: "Knowledge value",
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

function captureError(callback: () => void): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to fail");
}

describe("SqliteKnowledgeRepository", () => {
  it("REPOSITORY_ROUNDTRIP inserts and reads back all seven fields with bound parameters", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-roundtrip");
      const repository = new SqliteKnowledgeRepository(db);
      const draft = draftFor("knowledge-roundtrip", "content-roundtrip", {
        category: "Method",
      });

      expect(repository.insert(draft)).toEqual(draft);
      expect(repository.getByContentId(draft.content_id)).toEqual(draft);
      expect(rawKnowledge(db, draft.content_id)).toEqual({
        id: draft.id,
        content_id: draft.content_id,
        title: draft.title,
        summary: draft.summary,
        category: draft.category,
        findings_json: JSON.stringify(draft.findings),
        value: draft.value,
      });

      expect(repository.getByContentId("missing' OR 1=1 --")).toBeNull();
    });
  });

  it("FINDINGS_JSON keeps three findings in one JSON array and stores empty arrays exactly", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-findings");
      insertContent(db, "content-empty-findings");
      const repository = new SqliteKnowledgeRepository(db);

      repository.insert(
        draftFor("knowledge-findings", "content-findings", {
          findings: findings.map((finding) => ({ ...finding })),
        }),
      );
      repository.insert(
        draftFor("knowledge-empty-findings", "content-empty-findings", {
          findings: [],
        }),
      );

      const populatedRow = rawKnowledge(db, "content-findings");
      const emptyRow = rawKnowledge(db, "content-empty-findings");
      expect(knowledgeCount(db)).toBe(2);
      expect(JSON.parse(populatedRow?.findings_json ?? "null")).toEqual(
        findings,
      );
      expect(emptyRow?.findings_json).toBe("[]");
      expect(
        repository.getByContentId("content-empty-findings")?.findings,
      ).toEqual([]);
    });
  });

  it("CATEGORY_NULL binds SQLite NULL while non-null categories roundtrip", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-null-category");
      insertContent(db, "content-resource-category");
      const repository = new SqliteKnowledgeRepository(db);

      repository.insert(
        draftFor("knowledge-null-category", "content-null-category", {
          category: null,
        }),
      );
      repository.insert(
        draftFor("knowledge-resource-category", "content-resource-category", {
          category: "Resource",
        }),
      );

      const nullRow = rawKnowledge(db, "content-null-category");
      expect(nullRow?.category).toBeNull();
      expect(typeof nullRow?.category).toBe("object");
      expect(rawKnowledge(db, "content-resource-category")?.category).toBe(
        "Resource",
      );
    });
  });

  it("does not map an empty-string category to null", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-empty-category");
      db.pragma("ignore_check_constraints = ON");
      db.prepare(
        `
          INSERT INTO knowledge (
            id, content_id, title, summary, category, findings_json, value
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "knowledge-empty-category",
        "content-empty-category",
        "Title",
        "Summary",
        "",
        "[]",
        "Value",
      );

      expect(rawKnowledge(db, "content-empty-category")?.category).toBe("");
      expect(() =>
        new SqliteKnowledgeRepository(db).getByContentId(
          "content-empty-category",
        ),
      ).toThrow("Malformed Knowledge category");
    });
  });

  it("UNIQUE_CONSTRAINT rejects a second content_id insert without changing the first row", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-unique");
      const repository = new SqliteKnowledgeRepository(db);
      const original = draftFor("knowledge-unique-first", "content-unique", {
        title: "Original title",
      });
      repository.insert(original);

      const error = captureError(() =>
        repository.insert(
          draftFor("knowledge-unique-second", "content-unique", {
            title: "Replacement title",
          }),
        ),
      );

      expect(error).toMatchObject({ code: "SQLITE_CONSTRAINT_UNIQUE" });
      expect(knowledgeCount(db)).toBe(1);
      expect(repository.getByContentId("content-unique")).toEqual(original);
    });
  });

  it("returns null for a missing content_id", async () => {
    await withKnowledgeDatabase((db) => {
      const repository = new SqliteKnowledgeRepository(db);
      expect(repository.getByContentId("content-does-not-exist")).toBeNull();
    });
  });

  it("fails on malformed findings instead of silently accepting them", async () => {
    await withKnowledgeDatabase((db) => {
      insertContent(db, "content-malformed-draft");
      insertContent(db, "content-malformed-row");
      const repository = new SqliteKnowledgeRepository(db);
      const malformedDraft = draftFor(
        "knowledge-malformed-draft",
        "content-malformed-draft",
        {
          findings: [{ title: "Missing description" }],
        } as unknown as Partial<KnowledgeDraft>,
      );

      expect(() => repository.insert(malformedDraft)).toThrow(
        "Malformed Knowledge findings",
      );
      expect(knowledgeCount(db)).toBe(0);

      db.pragma("ignore_check_constraints = ON");
      db.prepare(
        `
          INSERT INTO knowledge (
            id, content_id, title, summary, category, findings_json, value
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "knowledge-malformed-row",
        "content-malformed-row",
        "Title",
        "Summary",
        "Insight",
        "{}",
        "Value",
      );

      expect(() => repository.getByContentId("content-malformed-row")).toThrow(
        "Malformed Knowledge findings JSON",
      );
    });
  });

  it("exposes only the fixed repository surface", async () => {
    expect(
      Object.getOwnPropertyNames(SqliteKnowledgeRepository.prototype).sort(),
    ).toEqual(["constructor", "getByContentId", "insert"]);
  });

  it("accepts only category values permitted by the internal type", () => {
    const categories: KnowledgeCategory[] = [
      "Insight",
      "Experience",
      "Method",
      "Resource",
      null,
    ];

    expect(categories).toHaveLength(5);
  });
});
