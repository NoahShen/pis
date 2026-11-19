import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import {
  type EventRecord,
  type EventUpdateRecord,
  SqliteEventRepository,
} from "../../src/event-analysis/event-repository.js";
import { refreshEventSearch } from "../../src/database/event-search.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import {
  eventAnalysisFixtureIds,
  insertEventAnalysisContent,
  insertStoredEventEvidence,
} from "../fixtures/event-analysis.js";

const EVENT_INSERT_SQL = `
  INSERT INTO events (
    id, title, entity_name, subject, scope, description, occurred_at,
    discovered_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const EVENT_READ_SQL = `
  SELECT
    id, title, entity_name, subject, scope, description, occurred_at, discovered_at
  FROM events
  WHERE id = ?
`;

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

async function withEventDatabase<T>(
  callback: (database: Database.Database) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath((databasePath) => {
    const db = openDatabase(databasePath);
    initializeDatabase(db);

    try {
      return callback(db);
    } finally {
      closeDatabase(db);
    }
  });
}

function databaseWithZeroEventInsertChanges(
  db: Database.Database,
): Database.Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          if (normalizeSql(source) !== normalizeSql(EVENT_INSERT_SQL)) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run") {
                return () => ({ changes: 0, lastInsertRowid: 0 });
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function databaseWithEventReadbackMiss(
  db: Database.Database,
): Database.Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          if (normalizeSql(source) !== normalizeSql(EVENT_READ_SQL)) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "get") {
                return () => undefined;
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function eventRecord(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "event-roundtrip-null",
    title: "  Event title '); DROP TABLE events; --  ",
    entity_name: "Entity ' OR 1=1 --",
    subject: "Subject with   spacing",
    scope: "Scope",
    description: "Description\nkept exactly",
    occurred_at: null,
    discovered_at: "2026-11-18T10:11:12.345+08:00",
    ...overrides,
  };
}

function updateRecord(
  overrides: Partial<EventUpdateRecord> = {},
): EventUpdateRecord {
  return {
    id: "event-update-roundtrip",
    event_id: "event-roundtrip-null",
    title: "Update ' OR 1=1 --",
    description: "  Update description kept exactly  ",
    occurred_at: "2026-11-19T01:02:03.004+08:00",
    discovered_at: "2026-11-19T02:03:04.005+08:00",
    ...overrides,
  };
}

describe("SqliteEventRepository", () => {
  it("REPOSITORY_ROUNDTRIP preserves every Event and Update column, including SQL NULL and text", async () => {
    await withEventDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const repository = new SqliteEventRepository(db);
      const nullOccurrence = eventRecord();
      const stringOccurrence = eventRecord({
        id: "event-roundtrip-string",
        occurred_at: "2026-11-17T07:08:09.010+08:00",
        discovered_at: "2026-11-18T11:12:13.014+08:00",
      });
      const update = updateRecord();

      const result = withTransaction(db, () => {
        const insertedNull = repository.insertEvent(nullOccurrence);
        const insertedString = repository.insertEvent(stringOccurrence);
        const insertedUpdate = repository.insertUpdate(update);

        return {
          insertedNull,
          insertedString,
          insertedUpdate,
          readNull: repository.getEventById(nullOccurrence.id),
          readString: repository.getEventById(stringOccurrence.id),
          readUpdate: repository.getUpdateById(update.id),
        };
      });

      expect(result).toEqual({
        insertedNull: nullOccurrence,
        insertedString: stringOccurrence,
        insertedUpdate: update,
        readNull: nullOccurrence,
        readString: stringOccurrence,
        readUpdate: update,
      });
      expect(result.readNull?.occurred_at).toBeNull();
      expect(result.readString?.occurred_at).toBe(
        "2026-11-17T07:08:09.010+08:00",
      );
      expect(result.readUpdate?.occurred_at).toBe(
        "2026-11-19T01:02:03.004+08:00",
      );
      expect(result.readNull?.discovered_at).toBe(
        "2026-11-18T10:11:12.345+08:00",
      );
      expect(repository.getEventById("missing' OR 1=1 --")).toBeNull();
      expect(repository.getUpdateById("missing' OR 1=1 --")).toBeNull();
    });
  });

  it("EVIDENCE_IDEMPOTENT inserts each target/content relation once and preserves independent links", async () => {
    await withEventDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const repository = new SqliteEventRepository(db);
      const event = eventRecord();
      const update = updateRecord();

      const result = withTransaction(db, () => {
        repository.insertEvent(event);
        repository.insertUpdate(update);
        const first = repository.insertEvidence(
          "EVENT",
          event.id,
          eventAnalysisFixtureIds.content,
        );
        const repeated = repository.insertEvidence(
          "EVENT",
          event.id,
          eventAnalysisFixtureIds.content,
        );
        const updateEvidence = repository.insertEvidence(
          "EVENT_UPDATE",
          update.id,
          eventAnalysisFixtureIds.content,
        );
        const otherContentEvidence = repository.insertEvidence(
          "EVENT",
          event.id,
          eventAnalysisFixtureIds.otherContent,
        );

        return {
          first,
          repeated,
          updateEvidence,
          otherContentEvidence,
        };
      });

      expect(result.first.inserted).toBe(true);
      expect(result.repeated.inserted).toBe(false);
      expect(result.repeated.evidence).toEqual(result.first.evidence);
      expect(result.updateEvidence.inserted).toBe(true);
      expect(result.otherContentEvidence.inserted).toBe(true);
      expect(
        db
          .prepare(
            `
              SELECT target_type, target_id, content_id
              FROM event_content_links
              ORDER BY target_type, target_id, content_id
            `,
          )
          .all(),
      ).toEqual([
        {
          target_type: "EVENT",
          target_id: event.id,
          content_id: eventAnalysisFixtureIds.content,
        },
        {
          target_type: "EVENT",
          target_id: event.id,
          content_id: eventAnalysisFixtureIds.otherContent,
        },
        {
          target_type: "EVENT_UPDATE",
          target_id: update.id,
          content_id: eventAnalysisFixtureIds.content,
        },
      ]);
      expect(
        repository.getEvidence(
          "EVENT",
          event.id,
          eventAnalysisFixtureIds.content,
        ),
      ).toEqual(result.first.evidence);
    });
  });

  it("EVT-17 / REUSE and REUSE_ORDER select the first Event Update by Evidence, discovered_at, and id", async () => {
    await withEventDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const preparedSql: string[] = [];
      const observedDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === "prepare") {
            return (source: string): Database.Statement => {
              preparedSql.push(source.replace(/\s+/g, " ").trim());
              return target.prepare(source);
            };
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const repository = new SqliteEventRepository(observedDb);
      const event = eventRecord({ id: "event-reuse-order" });
      const eventWithWrongEvidenceType = eventRecord({
        id: "event-wrong-evidence-type",
      });
      const laterUpdate = updateRecord({
        id: "event-update-reuse-later",
        event_id: event.id,
        discovered_at: "2026-11-20T00:00:00.000+08:00",
      });
      const sameTimeIdLater = updateRecord({
        id: "event-update-reuse-b",
        event_id: event.id,
        discovered_at: "2026-11-19T00:00:00.000+08:00",
      });
      const sameTimeIdEarlier = updateRecord({
        id: "event-update-reuse-a",
        event_id: event.id,
        discovered_at: "2026-11-19T00:00:00.000+08:00",
      });
      const wrongTypeUpdate = updateRecord({
        id: "event-update-wrong-type-only",
        event_id: eventWithWrongEvidenceType.id,
        discovered_at: "2026-11-18T00:00:00.000+08:00",
      });

      const result = withTransaction(observedDb, () => {
        repository.insertEvent(event);
        repository.insertEvent(eventWithWrongEvidenceType);
        repository.insertUpdate(laterUpdate);
        repository.insertUpdate(sameTimeIdLater);
        repository.insertUpdate(sameTimeIdEarlier);
        repository.insertUpdate(wrongTypeUpdate);
        for (const update of [
          laterUpdate,
          sameTimeIdLater,
          sameTimeIdEarlier,
        ]) {
          repository.insertEvidence(
            "EVENT_UPDATE",
            update.id,
            eventAnalysisFixtureIds.content,
          );
        }
        insertStoredEventEvidence(
          db,
          wrongTypeUpdate.id,
          eventAnalysisFixtureIds.content,
        );

        return repository.findReusableUpdate(
          event.id,
          eventAnalysisFixtureIds.content,
        );
      });

      expect(result).toEqual(sameTimeIdEarlier);
      expect(
        repository.findReusableUpdate(
          event.id,
          eventAnalysisFixtureIds.otherContent,
        ),
      ).toBeNull();
      expect(
        repository.findReusableUpdate(
          eventWithWrongEvidenceType.id,
          eventAnalysisFixtureIds.content,
        ),
      ).toBeNull();
      const reuseSql = preparedSql.find((sql) =>
        sql.includes("JOIN event_content_links"),
      );
      expect(reuseSql).toBeDefined();
      expect(reuseSql).toContain("evidence.target_type = 'EVENT_UPDATE'");
      expect(reuseSql).toContain("ORDER BY u.discovered_at ASC, u.id ASC");
      expect(reuseSql).toContain("LIMIT 1");
    });
  });

  it("EVT-12/13 and EVT-24 preserve exact aliases, content evidence, and Event isolation", async () => {
    await withEventDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const repository = new SqliteEventRepository(db);
      const event = eventRecord({ id: "event-alias-a" });
      const otherEvent = eventRecord({ id: "event-alias-b" });
      const mixedCaseAlias = "  Case Sensitive Alias  ";

      const inserted = withTransaction(db, () => {
        repository.insertEvent(event);
        repository.insertEvent(otherEvent);
        const first = repository.insertAlias(
          event.id,
          mixedCaseAlias,
          eventAnalysisFixtureIds.content,
        );
        const repeated = repository.insertAlias(
          event.id,
          mixedCaseAlias,
          eventAnalysisFixtureIds.otherContent,
        );
        const lowerCaseVariant = repository.insertAlias(
          event.id,
          "case sensitive alias",
          eventAnalysisFixtureIds.content,
        );
        const sameAliasOtherEvent = repository.insertAlias(
          otherEvent.id,
          mixedCaseAlias,
          eventAnalysisFixtureIds.otherContent,
        );

        return {
          first,
          repeated,
          lowerCaseVariant,
          sameAliasOtherEvent,
        };
      });

      expect(inserted.first).toEqual({
        alias: {
          event_id: event.id,
          alias: mixedCaseAlias,
          content_id: eventAnalysisFixtureIds.content,
        },
        inserted: true,
      });
      expect(inserted.repeated).toEqual({
        alias: inserted.first.alias,
        inserted: false,
      });
      expect(inserted.lowerCaseVariant.inserted).toBe(true);
      expect(inserted.sameAliasOtherEvent).toEqual({
        alias: {
          event_id: otherEvent.id,
          alias: mixedCaseAlias,
          content_id: eventAnalysisFixtureIds.otherContent,
        },
        inserted: true,
      });
      expect(repository.getAlias(event.id, mixedCaseAlias)).toEqual(
        inserted.first.alias,
      );
      expect(
        db
          .prepare(
            `
              SELECT count(*) AS count
              FROM event_entity_aliases
              WHERE alias = ?
            `,
          )
          .get(mixedCaseAlias),
      ).toEqual({ count: 2 });

      refreshEventSearch(db, event.id);
      const searchText = repository.getEventSearchText(event.id);
      expect(searchText).toContain(mixedCaseAlias);
      expect(searchText).toContain("case sensitive alias");
      expect(repository.getEventSearchText("event-missing-search")).toBeNull();
    });
  });

  it("INSERT_VERIFY throws on anomalous changes or readback failure and rolls back the same transaction", async () => {
    await withEventDatabase((db) => {
      const event = eventRecord();
      const zeroChangesDb = databaseWithZeroEventInsertChanges(db);

      expect(() =>
        withTransaction(zeroChangesDb, () =>
          new SqliteEventRepository(zeroChangesDb).insertEvent(event),
        ),
      ).toThrow("Expected exactly one Event insert, received 0");
      expect(db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({
        count: 0,
      });

      const readMissDb = databaseWithEventReadbackMiss(db);
      expect(() =>
        withTransaction(readMissDb, () =>
          new SqliteEventRepository(readMissDb).insertEvent(event),
        ),
      ).toThrow("Inserted Event could not be verified");
      expect(db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({
        count: 0,
      });
    });
  });

  it("rejects Repository writes outside a caller-owned transaction", async () => {
    await withEventDatabase((db) => {
      const repository = new SqliteEventRepository(db);

      expect(() => repository.insertEvent(eventRecord())).toThrow(
        "EventRepository writes require an active transaction",
      );
      expect(db.inTransaction).toBe(false);
      expect(db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({
        count: 0,
      });
    });
  });
});
