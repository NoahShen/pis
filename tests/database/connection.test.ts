import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

function expectConnectionPragmas(db: Database.Database): void {
  const journalMode = db.pragma("journal_mode", { simple: true });

  expect(typeof journalMode).toBe("string");
  expect(String(journalMode).toLowerCase()).toBe("wal");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
}

describe("openDatabase", () => {
  it("openDatabase enables WAL foreign keys and busy timeout", async () => {
    let databasePath = "";

    await withDatabasePath((path) => {
      databasePath = path;
      const db = openDatabase(path);

      try {
        expectConnectionPragmas(db);
        expect(existsSync(path)).toBe(true);
      } finally {
        closeDatabase(db);
      }
    });

    expect(existsSync(databasePath)).toBe(false);
  });

  it("openDatabase configures every independent connection", async () => {
    await withDatabasePath((databasePath) => {
      const first = openDatabase(databasePath);
      const second = openDatabase(databasePath);

      try {
        expectConnectionPragmas(first);
        expectConnectionPragmas(second);
      } finally {
        closeDatabase(second);
        closeDatabase(first);
      }
    });
  });

  it("openDatabase closes a connection when database configuration fails", async () => {
    await withDatabasePath(async (databasePath) => {
      await writeFile(databasePath, "not a sqlite database", "utf8");

      const originalClose = Database.prototype.close;
      const closeSpy = vi
        .spyOn(Database.prototype, "close")
        .mockImplementation(function (
          this: Database.Database,
        ): Database.Database {
          originalClose.call(this);
          throw new Error("close failure after configuration error");
        });

      try {
        let failure: unknown;

        try {
          openDatabase(databasePath);
        } catch (error) {
          failure = error;
        }

        expect(failure).toMatchObject({ code: "SQLITE_NOTADB" });
        expect(closeSpy).toHaveBeenCalledOnce();
      } finally {
        closeSpy.mockRestore();
      }
    });
  });
});
