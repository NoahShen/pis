import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import path from "node:path";

import { initializeDatabase } from "../../src/database/schema.js";
import { withTempDirectory } from "./temp-directory.js";

export interface RetrievalFixture {
  readonly db: SqliteDatabase;
  readonly databasePath: string;
}

export async function withRetrievalFixture<T>(
  callback: (fixture: RetrievalFixture) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "retrieval.sqlite");
    const db = new Database(databasePath);
    initializeDatabase(db);
    seedRetrieval(db);
    try {
      return await callback({ db, databasePath });
    } finally {
      if (db.open) db.close();
    }
  });
}

export function seedRetrieval(db: SqliteDatabase): void {
  db.prepare(
    `INSERT INTO sources
      (id, name, type, url, cron, enabled, description, last_collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "source-1",
    "Example source",
    "RSS",
    "https://example.com/feed.xml",
    "0 * * * *",
    1,
    "fixture",
    null,
  );

  const insertContent = db.prepare(
    `INSERT INTO contents
      (id, title, url, author, published_at, created_at, body, summary, language, completeness)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertContent.run(
    "content-1",
    "First content",
    "https://example.com/1",
    "Author One",
    "2026-01-01T09:00:00+08:00",
    "2026-01-01T10:00:00+08:00",
    "First body",
    "First summary",
    "zh",
    "FULL",
  );
  insertContent.run(
    "content-2",
    "Second content",
    null,
    null,
    null,
    "2026-01-02T10:00:00+08:00",
    "Second body",
    null,
    null,
    "PARTIAL",
  );

  db.prepare(
    `INSERT INTO source_items
      (id, source_id, external_id, url, title, published_at, discovered_at, content_id, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "source-item-1",
    "source-1",
    "external-1",
    "https://example.com/1",
    "First content",
    "2026-01-01T09:00:00+08:00",
    "2026-01-01T09:30:00+08:00",
    "content-1",
    "{}",
  );

  db.prepare(
    `INSERT INTO events
      (id, title, entity_name, subject, scope, description, occurred_at, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "event-1",
    "Event one",
    "Entity",
    "Subject",
    "Scope",
    "Event description",
    "2026-01-01T08:00:00+08:00",
    "2026-01-01T11:00:00+08:00",
  );
  const insertUpdate = db.prepare(
    `INSERT INTO event_updates
      (id, event_id, title, description, occurred_at, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertUpdate.run(
    "update-1",
    "event-1",
    "Update one",
    "Update description",
    null,
    "2026-01-02T11:00:00+08:00",
  );
  insertUpdate.run(
    "update-2",
    "event-1",
    "Update two",
    "Older update",
    null,
    "2026-01-01T12:00:00+08:00",
  );

  const insertLink = db.prepare(
    "INSERT INTO event_content_links (target_type, target_id, content_id) VALUES (?, ?, ?)",
  );
  insertLink.run("EVENT", "event-1", "content-1");
  insertLink.run("EVENT_UPDATE", "update-1", "content-2");

  db.prepare(
    `INSERT INTO knowledge
      (id, content_id, title, summary, category, findings_json, value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "knowledge-1",
    "content-2",
    "Knowledge one",
    "Knowledge summary",
    "Insight",
    JSON.stringify([{ title: "Finding", description: "Description" }]),
    "Knowledge value",
  );

  db.prepare(
    "INSERT INTO topics (id, name, description, enabled) VALUES (?, ?, ?, ?)",
  ).run("topic-1", "Topic one", "Topic description", 1);
  const insertAssociation = db.prepare(
    `INSERT INTO topic_associations (topic_id, target_type, target_id, matched_at)
     VALUES (?, ?, ?, ?)`,
  );
  insertAssociation.run(
    "topic-1",
    "EVENT",
    "event-1",
    "2026-01-03T10:00:00+08:00",
  );
  insertAssociation.run(
    "topic-1",
    "EVENT_UPDATE",
    "update-1",
    "2026-01-04T10:00:00+08:00",
  );
  insertAssociation.run(
    "topic-1",
    "KNOWLEDGE",
    "knowledge-1",
    "2026-01-02T10:00:00+08:00",
  );

  const insertPublished = db.prepare(
    `INSERT INTO published_items
      (id, target_type, target_id, title, summary, body, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertPublished.run(
    "published-1",
    "EVENT",
    "event-1",
    "Published event",
    "Published summary",
    "Immutable event body",
    "2026-01-05T10:00:00+08:00",
  );
  insertPublished.run(
    "published-2",
    "KNOWLEDGE",
    "knowledge-1",
    "Published knowledge",
    "Published summary",
    "Immutable knowledge body",
    "2026-01-04T10:00:00+08:00",
  );
}
