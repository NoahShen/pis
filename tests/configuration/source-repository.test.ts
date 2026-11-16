import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { ConfigurationInputError } from "../../src/configuration/contracts.js";
import { SqliteSourceRepository } from "../../src/configuration/source-repository.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { openDatabase } from "../../src/database/open-database.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import {
  ConfigurationCreateReadBackFailure,
  ConfigurationReadBackFailure,
  createConfigurationCreateReadBackFailureDatabase,
  createConfigurationUpdateFailureDatabase,
  readSourceRows,
  type SourceRowSnapshot,
} from "../fixtures/configuration.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_INPUT = {
  name: "  Synthetic Source  ",
  type: "RSS",
  url: "https://source.example.test/feed.xml?edition=daily",
  cron: "  0 */5 * * * *  ",
  enabled: true,
  description: "  Synthetic source description  ",
} as const;

function createRepository(
  db: Database.Database,
  ids: readonly string[] = ["source-1"],
): SqliteSourceRepository {
  return new SqliteSourceRepository(db, new SequenceIdGenerator(ids));
}

function insertSource(db: Database.Database, row: SourceRowSnapshot): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    row.id,
    row.name,
    row.type,
    row.url,
    row.cron,
    row.enabled,
    row.description,
    row.last_collected_at,
  );
}

describe("SqliteSourceRepository", () => {
  it("source repository persists and reopens stable configuration", async () => {
    await withDatabasePath(async (databasePath) => {
      let db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const ids = new SequenceIdGenerator([
          "source-z",
          "source-a",
          "source-m",
        ]);
        const repository = new SqliteSourceRepository(db, ids);

        const first = repository.create({
          ...SOURCE_INPUT,
          type: "RSS",
          enabled: undefined,
          description: undefined,
        });
        const second = repository.create({
          ...SOURCE_INPUT,
          name: SOURCE_INPUT.name,
          url: SOURCE_INPUT.url,
          enabled: false,
          description: null,
        });
        const third = repository.create({
          name: "Disabled Source",
          type: "RSS",
          url: "http://disabled.example.test/feed",
          cron: "0 * * * *",
          enabled: false,
        });

        expect(first).toEqual({
          id: "source-z",
          name: SOURCE_INPUT.name,
          type: "RSS",
          url: SOURCE_INPUT.url,
          cron: SOURCE_INPUT.cron,
          enabled: true,
          description: null,
          last_collected_at: null,
        });
        expect(second).toMatchObject({
          id: "source-a",
          enabled: false,
          description: null,
        });
        expect(third).toMatchObject({ id: "source-m", enabled: false });
        expect(repository.getById("source-a")).toEqual(second);
        expect(repository.getById("missing")).toBeNull();
        expect(repository.list().map(({ id }) => id)).toEqual([
          "source-a",
          "source-m",
          "source-z",
        ]);
        expect(repository.listEnabled().map(({ id }) => id)).toEqual([
          "source-z",
        ]);

        expect(
          repository.update("source-a", {
            name: first.name,
            cron: first.cron,
            enabled: true,
            description: "",
          }),
        ).toMatchObject({
          id: "source-a",
          name: first.name,
          cron: first.cron,
          enabled: true,
          description: "",
          url: second.url,
          type: "RSS",
          last_collected_at: null,
        });
        expect(repository.update("missing", { enabled: false })).toBeNull();

        const checkpoint = "2026-11-15T08:00:00.000+08:00";
        db.prepare("UPDATE sources SET last_collected_at = ? WHERE id = ?").run(
          checkpoint,
          "source-a",
        );

        const beforePreservedHistory = readSourceRows(db);
        repository.update("source-a", {
          name: "Changed but same checkpoint",
          cron: "0 1 * * *",
          enabled: false,
          description: null,
        });
        const afterPreservedHistory = readSourceRows(db);
        const targetBefore = beforePreservedHistory.find(
          (row) => row.id === "source-a",
        );
        const targetAfter = afterPreservedHistory.find(
          (row) => row.id === "source-a",
        );

        expect(targetBefore?.last_collected_at).toBe(checkpoint);
        expect(targetAfter?.last_collected_at).toBe(checkpoint);
        expect(targetAfter).toMatchObject({
          name: "Changed but same checkpoint",
          cron: "0 1 * * *",
          enabled: 0,
          description: null,
        });
        expect(
          afterPreservedHistory.filter((row) => row.id !== "source-a"),
        ).toEqual(
          beforePreservedHistory.filter((row) => row.id !== "source-a"),
        );
      } finally {
        closeDatabase(db);
      }

      db = openDatabase(databasePath);
      try {
        const repository = createRepository(db, []);
        expect(repository.list().map(({ id }) => id)).toEqual([
          "source-a",
          "source-m",
          "source-z",
        ]);
        expect(repository.getById("source-a")).toMatchObject({
          name: "Changed but same checkpoint",
          cron: "0 1 * * *",
          enabled: false,
          description: null,
          last_collected_at: "2026-11-15T08:00:00.000+08:00",
        });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("source repository never mutates immutable or checkpoint fields", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-id", "unused"]);
        const created = repository.create(SOURCE_INPUT);
        const before = readSourceRows(db);

        for (const invalidUpdate of [
          { type: "RSS" },
          { type: "ATOM" },
          { url: SOURCE_INPUT.url },
          { url: "https://changed.example.test/feed" },
          { last_collected_at: null },
          { id: created.id },
          { name: "mixed update", type: "RSS" },
          { enabled: false, url: "https://changed.example.test/feed" },
        ]) {
          expect(() => repository.update(created.id, invalidUpdate)).toThrow(
            ConfigurationInputError,
          );
          expect(readSourceRows(db)).toEqual(before);
          expect(repository.getById(created.id)).toEqual(created);
        }
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("source repository accepts same-value mutable patches without changing state", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-1"]);
        const created = repository.create(SOURCE_INPUT);
        const checkpoint = "2026-11-15T08:00:00.000+08:00";
        db.prepare("UPDATE sources SET last_collected_at = ? WHERE id = ?").run(
          checkpoint,
          created.id,
        );
        const current = repository.getById(created.id);
        const before = readSourceRows(db);

        if (current === null) {
          throw new Error("expected the created source to exist");
        }

        for (const patch of [
          { name: current.name },
          { cron: current.cron },
          { enabled: current.enabled },
          { description: current.description },
        ]) {
          expect(repository.update(created.id, patch)).toEqual(current);
          expect(readSourceRows(db)).toEqual(before);
          expect(readSourceRows(db)[0]?.last_collected_at).toBe(checkpoint);
        }
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("source repository rolls back create when read-back fails", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const before = readSourceRows(db);
        const faultyDb = createConfigurationCreateReadBackFailureDatabase(db);
        let idCalls = 0;
        const repository = new SqliteSourceRepository(faultyDb, {
          next() {
            idCalls += 1;
            return "source-create-rollback";
          },
        });

        expect(() => repository.create({ ...SOURCE_INPUT, name: " " })).toThrow(
          ConfigurationInputError,
        );
        expect(idCalls).toBe(0);
        expect(readSourceRows(db)).toEqual(before);

        let observed: unknown;
        try {
          repository.create(SOURCE_INPUT);
        } catch (error) {
          observed = error;
        }

        expect(observed).toBeInstanceOf(ConfigurationCreateReadBackFailure);
        expect(observed).toMatchObject({
          successfulInserts: 1,
          rowDuringTransaction: {
            id: "source-create-rollback",
            name: SOURCE_INPUT.name,
            enabled: 1,
          },
        });
        expect(idCalls).toBe(1);
        expect(readSourceRows(db)).toEqual(before);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("repository validation failure performs no write", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-id", "never-used"]);
        const created = repository.create(SOURCE_INPUT);
        const before = readSourceRows(db);
        const sentinel = "private-input-sentinel";

        for (const invalidCreate of [
          { ...SOURCE_INPUT, name: " " },
          { ...SOURCE_INPUT, url: sentinel },
          { ...SOURCE_INPUT, cron: sentinel },
          { ...SOURCE_INPUT, type: "ATOM" },
          { ...SOURCE_INPUT, unknown: sentinel },
        ]) {
          expect(() => repository.create(invalidCreate)).toThrow(
            ConfigurationInputError,
          );
        }

        for (const invalidUpdate of [
          { type: "RSS" },
          { url: SOURCE_INPUT.url },
          { type: "RSS", name: "would-change" },
          { url: "https://changed.example.test", enabled: false },
          { id: created.id, name: "would-change" },
          { last_collected_at: null, enabled: false },
          {},
          { name: undefined },
          { description: undefined },
          { enabled: undefined },
          { name: undefined, cron: undefined, description: undefined },
          null,
        ]) {
          let observed: unknown;
          try {
            repository.update(created.id, invalidUpdate);
          } catch (error) {
            observed = error;
          }

          expect(observed).toBeInstanceOf(ConfigurationInputError);
          expect(String(observed)).not.toContain(sentinel);
          expect(readSourceRows(db)).toEqual(before);
          expect(repository.list()).toEqual([created]);
        }
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("repository ignores undefined fields when one mutable field is defined", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-1"]);
        const created = repository.create(SOURCE_INPUT);
        const checkpoint = "2026-11-15T08:00:00.000+08:00";
        db.prepare("UPDATE sources SET last_collected_at = ? WHERE id = ?").run(
          checkpoint,
          created.id,
        );
        const before = readSourceRows(db);

        expect(
          repository.update(created.id, {
            name: undefined,
            enabled: false,
          }),
        ).toEqual({
          ...created,
          enabled: false,
          last_collected_at: checkpoint,
        });
        expect(readSourceRows(db)).toEqual([
          { ...before[0], enabled: 0, last_collected_at: checkpoint },
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("repository update rolls back completely when its second SQL step fails", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-1"]);
        repository.create(SOURCE_INPUT);
        const before = readSourceRows(db);
        const faultyDb = createConfigurationUpdateFailureDatabase(db, {
          failReadAfterSuccessfulUpdates: 1,
        });
        const faultyRepository = createRepository(faultyDb, []);

        let observed: unknown;
        try {
          faultyRepository.update("source-1", {
            name: "Should roll back",
            enabled: false,
          });
        } catch (error) {
          observed = error;
        }

        expect(observed).toBeInstanceOf(ConfigurationReadBackFailure);
        expect(observed).toMatchObject({
          successfulUpdates: 1,
          rowDuringTransaction: {
            id: "source-1",
            name: "Should roll back",
            enabled: 0,
          },
        });
        expect(readSourceRows(db)).toEqual(before);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("does not retry a generated ID collision", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        let idCalls = 0;
        const repository = new SqliteSourceRepository(db, {
          next() {
            idCalls += 1;
            return "duplicate-id";
          },
        });

        repository.create({
          ...SOURCE_INPUT,
          name: "First collision source",
        });
        expect(idCalls).toBe(1);
        expect(() =>
          repository.create({
            ...SOURCE_INPUT,
            name: "Second collision source",
          }),
        ).toThrow();
        expect(idCalls).toBe(2);
        expect(readSourceRows(db)).toHaveLength(1);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("allows duplicate names and urls while keeping independent IDs", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-2", "source-1"]);
        const first = repository.create(SOURCE_INPUT);
        const second = repository.create(SOURCE_INPUT);

        expect(first.id).toBe("source-2");
        expect(second.id).toBe("source-1");
        expect(first).not.toEqual(second);
        expect(readSourceRows(db)).toHaveLength(2);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("preserves historical source relationships and published rows on update", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["source-1"]);
        repository.create(SOURCE_INPUT);
        insertSource(db, {
          id: "source-2",
          name: "Untouched Source",
          type: "RSS",
          url: "https://untouched.example.test/feed",
          cron: "0 0 * * *",
          enabled: 1,
          description: null,
          last_collected_at: null,
        });
        db.exec(`
          INSERT INTO contents (
            id, title, url, author, published_at, created_at, body, summary,
            language, completeness
          ) VALUES (
            'content-1', 'Content', NULL, NULL, NULL,
            '2026-11-15T09:00:00.000+08:00', 'Body', NULL, NULL, 'FULL'
          );
          INSERT INTO source_items (
            id, source_id, external_id, url, title, published_at,
            discovered_at, content_id, raw_data
          ) VALUES (
            'source-item-1', 'source-1', NULL, NULL, NULL, NULL,
            '2026-11-15T09:01:00.000+08:00', 'content-1', NULL
          );
          INSERT INTO published_items (
            id, target_type, target_id, title, summary, body, published_at
          ) VALUES (
            'published-1', 'KNOWLEDGE', 'knowledge-1', 'Published',
            'Summary', 'Body', '2026-11-15T09:02:00.000+08:00'
          );
        `);

        const sourcesBefore = readSourceRows(db);
        const sourceItemsBefore = db
          .prepare("SELECT * FROM source_items ORDER BY id")
          .all();
        const publishedBefore = db
          .prepare("SELECT * FROM published_items ORDER BY id")
          .all();

        repository.update("source-1", {
          name: "Updated Source",
          cron: "0 1 * * *",
          enabled: false,
          description: null,
        });

        expect(
          readSourceRows(db).filter((row) => row.id === "source-2"),
        ).toEqual(sourcesBefore.filter((row) => row.id === "source-2"));
        expect(
          db.prepare("SELECT * FROM source_items ORDER BY id").all(),
        ).toEqual(sourceItemsBefore);
        expect(
          db.prepare("SELECT * FROM published_items ORDER BY id").all(),
        ).toEqual(publishedBefore);
      } finally {
        closeDatabase(db);
      }
    });
  });
});
