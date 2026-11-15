import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { schemaFixtureIds, seedSchemaData } from "../fixtures/schema-data.js";

const businessTables = [
  "sources",
  "contents",
  "events",
  "event_updates",
  "knowledge",
  "topics",
  "published_items",
  "source_items",
  "event_content_links",
  "event_entity_aliases",
  "topic_associations",
].sort();

const explicitIndexes = [
  "idx_source_items_ext",
  "idx_source_items_url_pub",
  "uq_source_items_content",
  "idx_events_entity_name",
  "idx_event_updates_history",
  "idx_event_content_links_content",
  "idx_event_entity_aliases_alias",
  "idx_topic_associations_target",
  "idx_topic_associations_history",
  "idx_published_items_feed",
  "idx_published_items_latest",
].sort();

const userTablesSql = `
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'event_search_%'
  ORDER BY name;
`;

const explicitIndexesSql = `
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'index'
    AND name NOT LIKE 'sqlite_autoindex_%'
  ORDER BY name;
`;

interface SqliteError extends Error {
  code: string;
}

function captureSqliteError(callback: () => void): SqliteError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as SqliteError;
  }

  throw new Error("Expected SQLite operation to fail");
}

function expectConstraintError(code: string, callback: () => void): void {
  expect(captureSqliteError(callback).code).toBe(code);
}

function userTableNames(db: Database.Database): string[] {
  const rows = db.prepare(userTablesSql).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function expectInitializedSchema(db: Database.Database): void {
  expect(userTableNames(db)).toEqual(
    [...businessTables, "event_search"].sort(),
  );

  const indexes = db.prepare(explicitIndexesSql).all() as Array<{
    name: string;
    sql: string | null;
  }>;
  expect(indexes.map((index) => index.name)).toEqual(explicitIndexes);

  const indexSql = new Map(indexes.map((index) => [index.name, index.sql]));
  expect(indexSql.get("idx_source_items_ext")).toContain(
    "WHERE external_id IS NOT NULL",
  );
  expect(indexSql.get("idx_source_items_url_pub")).toContain(
    "WHERE url IS NOT NULL",
  );
  expect(indexSql.get("uq_source_items_content")).toMatch(
    /^CREATE UNIQUE INDEX .*WHERE content_id IS NOT NULL$/s,
  );

  const eventSearch = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'event_search'")
    .get() as { sql: string };
  expect(eventSearch.sql).toContain("tokenize = 'trigram'");
}

function insertContent(
  db: Database.Database,
  id: string,
  completeness = "FULL",
): void {
  db.prepare(
    `
      INSERT INTO contents (
        id, title, created_at, body, completeness
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    `Content ${id}`,
    "2026-11-15T09:00:00.000+08:00",
    `Body ${id}`,
    completeness,
  );
}

function insertKnowledge(
  db: Database.Database,
  id: string,
  contentId: string,
  findingsJson = '["finding"]',
  category = "Insight",
): void {
  db.prepare(
    `
      INSERT INTO knowledge (
        id, content_id, title, summary, category, findings_json, value
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    contentId,
    `Knowledge ${id}`,
    "Fixture summary",
    category,
    findingsJson,
    "Fixture value",
  );
}

function insertPublishedItem(
  db: Database.Database,
  id: string,
  targetType: string,
  targetId: string,
  title: string,
  body: string,
): void {
  db.prepare(
    `
      INSERT INTO published_items (
        id, target_type, target_id, title, summary, body, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    targetType,
    targetId,
    title,
    "Fixture summary",
    body,
    "2026-11-15T12:00:00.000+08:00",
  );
}

describe("frozen database constraints", () => {
  it("initializeDatabase creates eleven business tables plus event search", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        initializeDatabase(db);
        expectInitializedSchema(db);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("initializeDatabase is idempotent for the current schema and preserves data", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        initializeDatabase(db);
        seedSchemaData(db);
        initializeDatabase(db);

        expect(
          db
            .prepare("SELECT id FROM sources WHERE id = ?")
            .get(schemaFixtureIds.source),
        ).toEqual({ id: schemaFixtureIds.source });
        expect(
          db
            .prepare("SELECT id FROM events WHERE id = ?")
            .get(schemaFixtureIds.event),
        ).toEqual({ id: schemaFixtureIds.event });
        expectInitializedSchema(db);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("initializeDatabase rolls back all new structures on DDL failure", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.exec(
          "CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL, broken TEXT NOT NULL)",
        );

        expect(() => initializeDatabase(db)).toThrow(
          "no such column: entity_name",
        );
        expect(userTableNames(db)).toEqual(["events"]);
        expect(
          db
            .prepare(
              `
                SELECT name
                FROM sqlite_master
                WHERE type = 'index'
                  AND name NOT LIKE 'sqlite_autoindex_%'
              `,
            )
            .all(),
        ).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("schema rejects invalid enums booleans and findings JSON", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.pragma("foreign_keys = ON");
        initializeDatabase(db);
        seedSchemaData(db);
        insertContent(db, "content-json-invalid");
        insertContent(db, "content-json-object");
        insertContent(db, "content-json-array");
        insertContent(db, "content-invalid-category");

        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertKnowledge(
            db,
            "knowledge-invalid-json",
            "content-json-invalid",
            "not-json",
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertKnowledge(
            db,
            "knowledge-object-json",
            "content-json-object",
            "{}",
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertContent(db, "content-invalid-enum", "UNKNOWN");
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertKnowledge(
            db,
            "knowledge-invalid-category",
            "content-invalid-category",
            '["finding"]',
            "Unknown",
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          db.prepare(
            "INSERT INTO topics(id, name, description, enabled) VALUES (?, ?, ?, ?)",
          ).run("topic-enabled", "Topic", "Description", 2);
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertPublishedItem(
            db,
            "published-invalid-target",
            "TOPIC",
            "target",
            "Title",
            "Body",
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          insertPublishedItem(
            db,
            "published-empty-body",
            "KNOWLEDGE",
            "target",
            "Title",
            "   ",
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          db.prepare(
            `
              INSERT INTO sources (
                id, name, type, url, cron, enabled
              ) VALUES (?, ?, ?, ?, ?, ?)
            `,
          ).run(
            "source-invalid-enabled",
            "Invalid source",
            "RSS",
            "https://fixture.example/invalid.xml",
            "0 * * * *",
            2,
          );
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          db.prepare(
            `
              INSERT INTO event_content_links (target_type, target_id, content_id)
              VALUES (?, ?, ?)
            `,
          ).run("KNOWLEDGE", schemaFixtureIds.event, "content-json-array");
        });
        expectConstraintError("SQLITE_CONSTRAINT_CHECK", () => {
          db.prepare(
            `
              INSERT INTO topic_associations (
                topic_id, target_type, target_id, matched_at
              ) VALUES (?, ?, ?, ?)
            `,
          ).run(
            schemaFixtureIds.topic,
            "SOURCE",
            schemaFixtureIds.source,
            "2026-11-15T12:00:00.000+08:00",
          );
        });

        insertKnowledge(
          db,
          "knowledge-valid-array",
          "content-json-array",
          '["finding"]',
        );
        expect(
          db
            .prepare("SELECT findings_json FROM knowledge WHERE id = ?")
            .get("knowledge-valid-array"),
        ).toEqual({ findings_json: '["finding"]' });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("schema enforces unique constraints without overwriting existing rows", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.pragma("foreign_keys = ON");
        initializeDatabase(db);
        seedSchemaData(db);
        insertContent(db, "content-unique-one");
        insertContent(db, "content-unique-two");
        insertKnowledge(db, "knowledge-unique-one", "content-unique-one");
        insertKnowledge(db, "knowledge-unique-two", "content-unique-two");

        expectConstraintError("SQLITE_CONSTRAINT_UNIQUE", () => {
          insertKnowledge(
            db,
            "knowledge-duplicate-content",
            "content-unique-one",
          );
        });
        expect(
          db
            .prepare("SELECT id FROM knowledge WHERE content_id = ?")
            .get("content-unique-one"),
        ).toEqual({ id: "knowledge-unique-one" });

        insertPublishedItem(
          db,
          "published-one",
          "EVENT",
          "event-target",
          "Original title",
          "Body",
        );
        expectConstraintError("SQLITE_CONSTRAINT_UNIQUE", () => {
          insertPublishedItem(
            db,
            "published-two",
            "EVENT",
            "event-target",
            "Replacement title",
            "Body",
          );
        });
        expect(
          db
            .prepare(
              "SELECT id, title FROM published_items WHERE target_type = ? AND target_id = ?",
            )
            .get("EVENT", "event-target"),
        ).toEqual({ id: "published-one", title: "Original title" });

        const insertEvidence = db.prepare(
          `
            INSERT INTO event_content_links (target_type, target_id, content_id)
            VALUES (?, ?, ?)
          `,
        );
        insertEvidence.run(
          "EVENT",
          schemaFixtureIds.event,
          "content-unique-one",
        );
        expectConstraintError("SQLITE_CONSTRAINT_PRIMARYKEY", () => {
          insertEvidence.run(
            "EVENT",
            schemaFixtureIds.event,
            "content-unique-one",
          );
        });
        expect(
          db
            .prepare(
              "SELECT content_id FROM event_content_links WHERE target_type = ? AND target_id = ?",
            )
            .all("EVENT", schemaFixtureIds.event),
        ).toEqual([{ content_id: "content-unique-one" }]);

        const insertAlias = db.prepare(
          "INSERT INTO event_entity_aliases (event_id, alias, content_id) VALUES (?, ?, ?)",
        );
        insertAlias.run(
          schemaFixtureIds.event,
          "Fixture alias",
          "content-unique-one",
        );
        expectConstraintError("SQLITE_CONSTRAINT_PRIMARYKEY", () => {
          insertAlias.run(
            schemaFixtureIds.event,
            "Fixture alias",
            "content-unique-two",
          );
        });
        expect(
          db
            .prepare(
              "SELECT content_id FROM event_entity_aliases WHERE event_id = ? AND alias = ?",
            )
            .get(schemaFixtureIds.event, "Fixture alias"),
        ).toEqual({ content_id: "content-unique-one" });

        const insertTopicAssociation = db.prepare(
          `
            INSERT INTO topic_associations (
              topic_id, target_type, target_id, matched_at
            ) VALUES (?, ?, ?, ?)
          `,
        );
        insertTopicAssociation.run(
          schemaFixtureIds.topic,
          "EVENT",
          schemaFixtureIds.event,
          "2026-11-15T12:00:00.000+08:00",
        );
        expectConstraintError("SQLITE_CONSTRAINT_PRIMARYKEY", () => {
          insertTopicAssociation.run(
            schemaFixtureIds.topic,
            "EVENT",
            schemaFixtureIds.event,
            "2026-11-15T12:01:00.000+08:00",
          );
        });
        expect(
          db
            .prepare(
              `
                SELECT matched_at
                FROM topic_associations
                WHERE topic_id = ? AND target_type = ? AND target_id = ?
              `,
            )
            .get(schemaFixtureIds.topic, "EVENT", schemaFixtureIds.event),
        ).toEqual({ matched_at: "2026-11-15T12:00:00.000+08:00" });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("schema enforces ordinary foreign keys and documents polymorphic boundaries", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.pragma("foreign_keys = ON");
        initializeDatabase(db);
        seedSchemaData(db);

        expectConstraintError("SQLITE_CONSTRAINT_FOREIGNKEY", () => {
          db.prepare(
            `
              INSERT INTO source_items (
                id, source_id, discovered_at
              ) VALUES (?, ?, ?)
            `,
          ).run(
            "source-item-dangling-source",
            "missing-source",
            "2026-11-15T09:00:00.000+08:00",
          );
        });

        expectConstraintError("SQLITE_CONSTRAINT_FOREIGNKEY", () => {
          db.prepare(
            `
              INSERT INTO event_updates (
                id, event_id, title, description, discovered_at
              ) VALUES (?, ?, ?, ?, ?)
            `,
          ).run(
            "event-update-dangling-event",
            "missing-event",
            "Dangling event update",
            "Fixture description",
            "2026-11-15T09:00:00.000+08:00",
          );
        });

        expectConstraintError("SQLITE_CONSTRAINT_FOREIGNKEY", () => {
          insertKnowledge(db, "knowledge-dangling-content", "missing-content");
        });

        db.prepare(
          `
            INSERT INTO event_content_links (target_type, target_id, content_id)
            VALUES (?, ?, ?)
          `,
        ).run("EVENT", "missing-event", schemaFixtureIds.contentOne);
        expect(
          db
            .prepare(
              "SELECT target_type, target_id FROM event_content_links WHERE target_id = ?",
            )
            .all("missing-event"),
        ).toEqual([{ target_type: "EVENT", target_id: "missing-event" }]);

        db.prepare(
          `
            INSERT INTO topic_associations (
              topic_id, target_type, target_id, matched_at
            ) VALUES (?, ?, ?, ?)
          `,
        ).run(
          schemaFixtureIds.topic,
          "EVENT",
          "missing-event",
          "2026-11-15T12:00:00.000+08:00",
        );
        expect(
          db
            .prepare(
              `
                SELECT target_type, target_id
                FROM topic_associations
                WHERE topic_id = ? AND target_id = ?
              `,
            )
            .get(schemaFixtureIds.topic, "missing-event"),
        ).toEqual({ target_type: "EVENT", target_id: "missing-event" });

        insertPublishedItem(
          db,
          "published-missing-target",
          "EVENT",
          "missing-event",
          "Dangling target",
          "Body",
        );
        expect(
          db
            .prepare(
              "SELECT id FROM published_items WHERE target_type = ? AND target_id = ?",
            )
            .get("EVENT", "missing-event"),
        ).toEqual({ id: "published-missing-target" });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("allows multiple null source content IDs and rejects a repeated non-null value", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.pragma("foreign_keys = ON");
        initializeDatabase(db);
        seedSchemaData(db);

        const insertSourceItem = db.prepare(
          `
            INSERT INTO source_items (
              id, source_id, discovered_at, content_id
            ) VALUES (?, ?, ?, ?)
          `,
        );
        insertSourceItem.run(
          "source-item-null-one",
          schemaFixtureIds.source,
          "2026-11-15T09:00:00.000+08:00",
          null,
        );
        insertSourceItem.run(
          "source-item-null-two",
          schemaFixtureIds.source,
          "2026-11-15T09:01:00.000+08:00",
          null,
        );
        insertSourceItem.run(
          "source-item-content-one",
          schemaFixtureIds.source,
          "2026-11-15T09:02:00.000+08:00",
          schemaFixtureIds.contentOne,
        );

        expectConstraintError("SQLITE_CONSTRAINT_UNIQUE", () => {
          insertSourceItem.run(
            "source-item-content-two",
            schemaFixtureIds.source,
            "2026-11-15T09:03:00.000+08:00",
            schemaFixtureIds.contentOne,
          );
        });
        expect(
          db
            .prepare(
              "SELECT count(*) AS count FROM source_items WHERE content_id IS NULL",
            )
            .get(),
        ).toEqual({ count: 2 });
        expect(
          db
            .prepare("SELECT id FROM source_items WHERE content_id = ?")
            .get(schemaFixtureIds.contentOne),
        ).toEqual({ id: "source-item-content-one" });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("uses the WAL and trigram FTS5 features required by the frozen schema", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        expect(db.pragma("journal_mode", { simple: true })).toBe("wal");

        db.prepare(
          "INSERT INTO event_search(event_id, search_text) VALUES (?, ?)",
        ).run("event-search-one", "中华人民共和国");

        expect(
          db
            .prepare(
              "SELECT event_id FROM event_search WHERE event_search MATCH ?",
            )
            .all("中华人"),
        ).toEqual([{ event_id: "event-search-one" }]);
      } finally {
        closeDatabase(db);
      }
    });
  });
});
