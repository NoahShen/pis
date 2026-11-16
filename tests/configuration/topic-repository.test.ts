import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { ConfigurationInputError } from "../../src/configuration/contracts.js";
import { SqliteTopicRepository } from "../../src/configuration/topic-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import {
  ConfigurationCreateReadBackFailure,
  ConfigurationReadBackFailure,
  createConfigurationCreateReadBackFailureDatabase,
  createConfigurationUpdateFailureDatabase,
  readTopicRows,
} from "../fixtures/configuration.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const TOPIC_INPUT = {
  name: "  Synthetic Topic  ",
  description: "  Synthetic topic description.  ",
  enabled: true,
} as const;

function createRepository(
  db: Database.Database,
  ids: readonly string[],
): SqliteTopicRepository {
  return new SqliteTopicRepository(db, new SequenceIdGenerator(ids));
}

describe("SqliteTopicRepository", () => {
  it("topic repository persists enabled state and reopens stable configuration", async () => {
    await withDatabasePath(async (databasePath) => {
      let db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, [
          "topic-z",
          "topic-a",
          "topic-m",
        ]);

        const first = repository.create({
          name: TOPIC_INPUT.name,
          description: TOPIC_INPUT.description,
        });
        const second = repository.create({
          ...TOPIC_INPUT,
          name: TOPIC_INPUT.name,
          enabled: false,
        });
        const third = repository.create({
          name: "Another Disabled Topic",
          description: "Description.",
          enabled: false,
        });

        expect(first).toEqual({
          id: "topic-z",
          name: TOPIC_INPUT.name,
          description: TOPIC_INPUT.description,
          enabled: true,
        });
        expect(second).toMatchObject({ id: "topic-a", enabled: false });
        expect(third).toMatchObject({ id: "topic-m", enabled: false });
        expect(repository.getById("topic-a")).toEqual(second);
        expect(repository.getById("missing")).toBeNull();
        expect(repository.list().map(({ id }) => id)).toEqual([
          "topic-a",
          "topic-m",
          "topic-z",
        ]);
        expect(repository.listEnabled().map(({ id }) => id)).toEqual([
          "topic-z",
        ]);

        expect(
          repository.update("topic-a", {
            name: "Updated Topic",
            description: "Updated description.",
            enabled: true,
          }),
        ).toEqual({
          id: "topic-a",
          name: "Updated Topic",
          description: "Updated description.",
          enabled: true,
        });
        expect(repository.update("missing", { enabled: false })).toBeNull();
        expect(
          repository.update("topic-a", { name: "Updated Topic" }),
        ).toMatchObject({ name: "Updated Topic" });

        expect(readTopicRows(db)).toEqual([
          {
            id: "topic-a",
            name: "Updated Topic",
            description: "Updated description.",
            enabled: 1,
          },
          {
            id: "topic-m",
            name: third.name,
            description: third.description,
            enabled: 0,
          },
          {
            id: "topic-z",
            name: first.name,
            description: first.description,
            enabled: 1,
          },
        ]);
      } finally {
        closeDatabase(db);
      }

      db = openDatabase(databasePath);
      try {
        const repository = createRepository(db, []);
        expect(repository.list().map(({ id }) => id)).toEqual([
          "topic-a",
          "topic-m",
          "topic-z",
        ]);
        expect(repository.getById("topic-a")).toEqual({
          id: "topic-a",
          name: "Updated Topic",
          description: "Updated description.",
          enabled: true,
        });
        expect(repository.getById("topic-m")).toEqual({
          id: "topic-m",
          name: "Another Disabled Topic",
          description: "Description.",
          enabled: false,
        });
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
        const repository = createRepository(db, ["topic-1", "unused"]);
        const created = repository.create(TOPIC_INPUT);
        const before = readTopicRows(db);

        for (const invalidCreate of [
          { name: "", description: "description" },
          { name: "topic", description: "   " },
          { ...TOPIC_INPUT, enabled: 1 },
          { ...TOPIC_INPUT, unknown: true },
          { ...TOPIC_INPUT, id: "topic-other" },
        ]) {
          expect(() => repository.create(invalidCreate)).toThrow(
            ConfigurationInputError,
          );
        }

        for (const invalidUpdate of [
          {},
          null,
          [],
          { id: created.id },
          { name: "  " },
          { description: "" },
          { enabled: "false" },
          { unknown: true },
          { name: undefined },
          { description: undefined },
          { enabled: undefined },
          { name: undefined, description: undefined },
        ]) {
          expect(() => repository.update(created.id, invalidUpdate)).toThrow(
            ConfigurationInputError,
          );
          expect(readTopicRows(db)).toEqual(before);
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
        const repository = createRepository(db, ["topic-1"]);
        const created = repository.create(TOPIC_INPUT);

        expect(
          repository.update(created.id, {
            name: undefined,
            enabled: false,
          }),
        ).toEqual({ ...created, enabled: false });
        expect(readTopicRows(db)).toEqual([
          {
            id: created.id,
            name: created.name,
            description: created.description,
            enabled: 0,
          },
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("topic repository rolls back create when read-back fails", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const before = readTopicRows(db);
        const faultyDb = createConfigurationCreateReadBackFailureDatabase(db);
        let idCalls = 0;
        const repository = new SqliteTopicRepository(faultyDb, {
          next() {
            idCalls += 1;
            return "topic-create-rollback";
          },
        });

        expect(() =>
          repository.create({ ...TOPIC_INPUT, description: " " }),
        ).toThrow(ConfigurationInputError);
        expect(idCalls).toBe(0);
        expect(readTopicRows(db)).toEqual(before);

        let observed: unknown;
        try {
          repository.create(TOPIC_INPUT);
        } catch (error) {
          observed = error;
        }

        expect(observed).toBeInstanceOf(ConfigurationCreateReadBackFailure);
        expect(observed).toMatchObject({
          successfulInserts: 1,
          rowDuringTransaction: {
            id: "topic-create-rollback",
            name: TOPIC_INPUT.name,
            enabled: 1,
          },
        });
        expect(idCalls).toBe(1);
        expect(readTopicRows(db)).toEqual(before);
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
        const repository = createRepository(db, ["topic-1"]);
        repository.create(TOPIC_INPUT);
        const before = readTopicRows(db);
        const faultyRepository = createRepository(
          createConfigurationUpdateFailureDatabase(db, {
            failReadAfterSuccessfulUpdates: 1,
          }),
          [],
        );

        let observed: unknown;
        try {
          faultyRepository.update("topic-1", {
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
            id: "topic-1",
            name: "Should roll back",
            enabled: 0,
          },
        });
        expect(readTopicRows(db)).toEqual(before);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("does not retry generated ID collisions", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        let idCalls = 0;
        const repository = new SqliteTopicRepository(db, {
          next() {
            idCalls += 1;
            return "duplicate-topic-id";
          },
        });

        repository.create(TOPIC_INPUT);
        expect(idCalls).toBe(1);
        expect(() => repository.create(TOPIC_INPUT)).toThrow();
        expect(idCalls).toBe(2);
        expect(readTopicRows(db)).toHaveLength(1);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("topic repository updates enabled state without touching historical rows", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = createRepository(db, ["topic-2", "topic-1"]);
        const first = repository.create(TOPIC_INPUT);
        const second = repository.create(TOPIC_INPUT);

        expect(first.id).toBe("topic-2");
        expect(second.id).toBe("topic-1");
        expect(readTopicRows(db)).toHaveLength(2);

        db.prepare(
          `
            INSERT INTO topic_associations (
              topic_id, target_type, target_id, matched_at
            ) VALUES (?, ?, ?, ?)
          `,
        ).run("topic-1", "EVENT", "event-1", "2026-11-15T09:00:00.000+08:00");
        const associationsBefore = db
          .prepare("SELECT * FROM topic_associations ORDER BY topic_id")
          .all();
        const rowsBefore = readTopicRows(db);
        const unrelatedBefore = rowsBefore.filter(({ id }) => id !== "topic-1");

        expect(rowsBefore.find(({ id }) => id === "topic-1")?.enabled).toBe(1);
        expect(
          repository.update("topic-1", {
            name: "Updated Topic",
            description: "Updated description.",
            enabled: false,
          }),
        ).toEqual({
          id: "topic-1",
          name: "Updated Topic",
          description: "Updated description.",
          enabled: false,
        });
        expect(readTopicRows(db).find(({ id }) => id === "topic-1")).toEqual({
          id: "topic-1",
          name: "Updated Topic",
          description: "Updated description.",
          enabled: 0,
        });

        expect(
          db
            .prepare("SELECT * FROM topic_associations ORDER BY topic_id")
            .all(),
        ).toEqual(associationsBefore);
        expect(readTopicRows(db).filter(({ id }) => id !== "topic-1")).toEqual(
          unrelatedBefore,
        );
      } finally {
        closeDatabase(db);
      }
    });
  });
});
