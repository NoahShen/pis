import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { formatTimestamp } from "../../src/time/format-time.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

interface StoredTimestamp {
  created_at: string;
  storage_type: string;
}

describe("SQLite timestamp storage", () => {
  it("formatTimestamp round-trips unchanged through SQLite TEXT", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const timestamp = formatTimestamp(new Date("2026-11-15T01:02:03.456Z"));

      try {
        initializeDatabase(db);
        db.prepare(
          `
            INSERT INTO contents (
              id, title, created_at, body, completeness
            ) VALUES (?, ?, ?, ?, ?)
          `,
        ).run(
          "content-time-storage",
          "Timestamp round trip",
          timestamp,
          "Fixtures verify text storage.",
          "FULL",
        );

        const stored = db
          .prepare(
            `
              SELECT created_at, typeof(created_at) AS storage_type
              FROM contents
              WHERE id = ?
            `,
          )
          .get("content-time-storage") as StoredTimestamp;

        expect(timestamp).toBe("2026-11-15T09:02:03.456+08:00");
        expect(stored).toEqual({
          created_at: "2026-11-15T09:02:03.456+08:00",
          storage_type: "text",
        });
      } finally {
        closeDatabase(db);
      }
    });
  });
});
