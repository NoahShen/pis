import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqliteKnowledgeContentRetrievalRepository } from "../../src/retrieval/repositories/knowledge-content-repository.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

describe("SqliteKnowledgeContentRetrievalRepository", () => {
  it("lists knowledge by content creation time and returns typed findings", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteKnowledgeContentRetrievalRepository(db);
      expect(repository.listKnowledge().items[0]).toMatchObject({
        id: "knowledge-1",
        findings: [{ title: "Finding", description: "Description" }],
      });
      expect(repository.getKnowledgeById("knowledge-1")?.content?.id).toBe(
        "content-2",
      );
      expect(repository.getKnowledgeById("missing")).toBeNull();
    });
  });

  it("returns the complete nullable source chain", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteKnowledgeContentRetrievalRepository(db);
      const linked = repository.getContentById("content-1");
      expect(linked?.source_item?.id).toBe("source-item-1");
      expect(linked?.source).toMatchObject({ id: "source-1", enabled: true });
      expect(repository.getContentById("content-2")).toMatchObject({
        source_item: null,
        source: null,
      });
      expect(repository.getContentById("missing")).toBeNull();
    });
  });

  it("tolerates a missing source and preserves array findings", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteKnowledgeContentRetrievalRepository(db);
      db.pragma("foreign_keys = OFF");
      db.prepare(
        "UPDATE source_items SET source_id = 'missing' WHERE id = 'source-item-1'",
      ).run();
      expect(repository.getContentById("content-1")?.source).toBeNull();
      db.prepare(
        "UPDATE knowledge SET findings_json = '[\"plain finding\"]' WHERE id = 'knowledge-1'",
      ).run();
      expect(repository.getKnowledgeById("knowledge-1")?.findings).toEqual([
        "plain finding",
      ]);
    });
  });

  it("reads knowledge and content from a query_only database", async () => {
    await withRetrievalFixture(({ db, databasePath }) => {
      db.close();
      const queryOnly = new Database(databasePath);
      queryOnly.pragma("query_only = ON");
      try {
        const repository = new SqliteKnowledgeContentRetrievalRepository(
          queryOnly,
        );
        expect(repository.listKnowledge().items).toHaveLength(1);
        expect(repository.getContentById("content-1")?.source?.id).toBe(
          "source-1",
        );
      } finally {
        queryOnly.close();
      }
    });
  });
});
