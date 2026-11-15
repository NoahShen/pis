import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

describe("SQLite runtime capabilities", () => {
  it("runtime exposes trigram FTS5 and JSON array functions", async () => {
    await withDatabasePath((databasePath) => {
      const db = new Database(databasePath);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE runtime_search USING fts5(
            value,
            tokenize = 'trigram'
          );
          INSERT INTO runtime_search(value) VALUES ('中华人民共和国');
        `);

        const hits = db
          .prepare<[string], { value: string }>(
            "SELECT value FROM runtime_search WHERE runtime_search MATCH ?",
          )
          .all("中华人");
        const validJson = db
          .prepare<[string], { valid: number }>("SELECT json_valid(?) AS valid")
          .get('["event"]');
        const jsonType = db
          .prepare<[string, string], { type: string }>(
            "SELECT json_type(?, ?) AS type",
          )
          .get('["event"]', "$[0]");

        expect(hits).toEqual([{ value: "中华人民共和国" }]);
        expect(validJson).toEqual({ valid: 1 });
        expect(jsonType).toEqual({ type: "text" });
      } finally {
        closeDatabase(db);
      }
    });
  });
});
