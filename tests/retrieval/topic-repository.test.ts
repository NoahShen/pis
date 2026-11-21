import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqliteTopicRetrievalRepository } from "../../src/retrieval/repositories/topic-repository.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

describe("SqliteTopicRetrievalRepository", () => {
  it("returns stable topic associations with typed snapshots", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteTopicRetrievalRepository(db);
      const result = repository.listItems("topic-1");
      expect(result).not.toBeNull();
      expect(result?.next_cursor).toBeNull();
      expect(result?.items.map((item) => item.target_id)).toEqual([
        "update-1",
        "event-1",
        "knowledge-1",
      ]);
      expect(result?.items[0].target).toMatchObject({
        id: "update-1",
        event_id: "event-1",
      });
      expect(result?.items[2].target).toMatchObject({
        findings: [{ title: "Finding", description: "Description" }],
      });
    });
  });

  it("distinguishes a missing parent, empty associations, and broken targets", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteTopicRetrievalRepository(db);
      expect(repository.listItems("missing")).toBeNull();
      db.prepare(
        "INSERT INTO topics (id, name, description, enabled) VALUES ('topic-2', 'Empty', '', 1)",
      ).run();
      expect(repository.listItems("topic-2")).toEqual({
        items: [],
        next_cursor: null,
      });
      db.prepare(
        `INSERT INTO topic_associations (topic_id, target_type, target_id, matched_at)
         VALUES ('topic-2', 'EVENT', 'missing-event', '2026-02-01T00:00:00+08:00')`,
      ).run();
      expect(repository.listItems("topic-2")?.items[0].target).toBeNull();
    });
  });

  it("applies the basic limit and works on a query_only connection", async () => {
    await withRetrievalFixture(({ databasePath, db }) => {
      db.close();
      const queryOnly = new Database(databasePath);
      queryOnly.pragma("query_only = ON");
      try {
        const repository = new SqliteTopicRetrievalRepository(queryOnly);
        const result = repository.listItems("topic-1", { limit: 1 });
        expect(result?.items).toHaveLength(1);
        expect(result?.items[0].target_id).toBe("update-1");
      } finally {
        queryOnly.close();
      }
    });
  });
});
