import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqlitePublishedItemRetrievalRepository } from "../../src/retrieval/repositories/published-item-repository.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

describe("SqlitePublishedItemRetrievalRepository", () => {
  it("lists immutable snapshots with topics and detail targets", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqlitePublishedItemRetrievalRepository(db);
      const result = repository.list({ limit: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "published-1",
        body: "Immutable event body",
        topics: [{ id: "topic-1", name: "Topic one" }],
      });
      const detail = repository.getById("published-1");
      expect(detail?.target).toMatchObject({ id: "event-1" });
      expect(detail?.topics[0].matched_at).toBe("2026-01-03T10:00:00+08:00");
      expect(repository.getById("missing")).toBeNull();
    });
  });

  it("keeps a detail when its polymorphic target is broken", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqlitePublishedItemRetrievalRepository(db);
      db.prepare(
        "UPDATE published_items SET target_id = 'missing' WHERE id = 'published-1'",
      ).run();
      expect(repository.getById("published-1")?.target).toBeNull();
    });
  });

  it("reads published snapshots from a query_only database", async () => {
    await withRetrievalFixture(({ db, databasePath }) => {
      db.close();
      const queryOnly = new Database(databasePath);
      queryOnly.pragma("query_only = ON");
      try {
        const repository = new SqlitePublishedItemRetrievalRepository(
          queryOnly,
        );
        expect(repository.list().items).toHaveLength(2);
        expect(repository.getById("published-2")?.body).toBe(
          "Immutable knowledge body",
        );
      } finally {
        queryOnly.close();
      }
    });
  });
});
