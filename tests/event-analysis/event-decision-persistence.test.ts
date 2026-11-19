import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import {
  EventDecisionPersistence,
  type EventDecisionOutcome,
} from "../../src/event-analysis/event-decision-persistence.js";
import { SqliteEventRepository } from "../../src/event-analysis/event-repository.js";
import type { IdGenerator } from "../../src/id/id-generator.js";
import type { Clock } from "../../src/time/clock.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../../src/llm/response-validators.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import {
  countEventAnalysisRows,
  eventAnalysisFixtureIds,
  eventAnalysisFixtureRows,
  insertEventAnalysisContent,
  insertStoredEvent,
  insertStoredEventUpdate,
  snapshotEventAnalysisRows,
} from "../fixtures/event-analysis.js";

const FIXED_TIME = new Date("2026-11-19T00:30:00.000Z");
const FIXED_TIMESTAMP = "2026-11-19T08:30:00.000+08:00";

type NewEventDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_EVENT" }
>;
type NewUpdateDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_UPDATE" }
>;

interface EventRow {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface EventUpdateRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

class CountingIdGenerator implements IdGenerator {
  calls = 0;

  constructor(private readonly values: readonly string[]) {}

  next(): string {
    const value = this.values[this.calls];
    this.calls += 1;

    if (value === undefined) {
      throw new Error("CountingIdGenerator exhausted");
    }

    return value;
  }
}

class CountingClock implements Clock {
  calls = 0;

  constructor(private readonly time: Date) {}

  now(): Date {
    this.calls += 1;
    return new Date(this.time);
  }
}

async function withEventAnalysisDatabase<T>(
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

function newEventDecision(
  overrides: Partial<NewEventDecision> = {},
): NewEventDecision {
  return {
    action: "NEW_EVENT",
    title: "  New Event title  ",
    entity: { name: "New Entity" },
    subject: "New Subject",
    scope: "New Scope",
    description: "New Event description\nwith exact spacing",
    confirmed_aliases: ["New alias"],
    ...overrides,
  };
}

function newUpdateDecision(
  overrides: Partial<NewUpdateDecision> = {},
): NewUpdateDecision {
  return {
    action: "NEW_UPDATE",
    event_id: eventAnalysisFixtureIds.event,
    title: "  New Update title  ",
    description: "New Update description\nwith exact spacing",
    occurred_at: "2026-11-18T06:00:00.000+08:00",
    confirmed_aliases: ["Update alias"],
    ...overrides,
  };
}

function createPersistence(
  db: Database.Database,
  idGenerator: IdGenerator,
  clock: Clock,
): EventDecisionPersistence {
  return new EventDecisionPersistence({
    database: db,
    eventRepository: new SqliteEventRepository(db),
    idGenerator,
    clock,
  });
}

function readEvent(db: Database.Database, id: string): EventRow | undefined {
  return db
    .prepare<[string], EventRow>(
      `
        SELECT
          id, title, entity_name, subject, scope, description, occurred_at,
          discovered_at
        FROM events
        WHERE id = ?
      `,
    )
    .get(id);
}

function readUpdate(
  db: Database.Database,
  id: string,
): EventUpdateRow | undefined {
  return db
    .prepare<[string], EventUpdateRow>(
      `
        SELECT
          id, event_id, title, description, occurred_at, discovered_at
        FROM event_updates
        WHERE id = ?
      `,
    )
    .get(id);
}

function expectNoChangesAfterSnapshot(
  db: Database.Database,
  before: ReturnType<typeof snapshotEventAnalysisRows>,
  changedTables: ReadonlyArray<keyof typeof before>,
): void {
  const after = snapshotEventAnalysisRows(db);

  for (const table of Object.keys(before) as Array<keyof typeof before>) {
    if (changedTables.includes(table)) {
      continue;
    }
    expect(after[table], table).toStrictEqual(before[table]);
  }
}

describe("EventDecisionPersistence.apply", () => {
  it("EVT-01 and TIME_BINDING create one Event and EVENT evidence with exact bound values", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const before = snapshotEventAnalysisRows(db);
      const idGenerator = new CountingIdGenerator([
        "event-new-missing-occurred",
        "event-new-null-occurred",
      ]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);
      const decisions = [
        newEventDecision(),
        newEventDecision({
          title: "Explicit null occurrence",
          occurred_at: null,
        }),
      ] as const;

      const outcomes = withTransaction(db, () =>
        decisions.map((decision, index) =>
          persistence.apply(
            index === 0
              ? eventAnalysisFixtureIds.content
              : eventAnalysisFixtureIds.otherContent,
            decision,
          ),
        ),
      );

      expect(outcomes).toEqual([
        {
          newTarget: {
            target_type: "EVENT",
            target_id: "event-new-missing-occurred",
          },
          affectedEventIds: ["event-new-missing-occurred"],
        },
        {
          newTarget: {
            target_type: "EVENT",
            target_id: "event-new-null-occurred",
          },
          affectedEventIds: ["event-new-null-occurred"],
        },
      ] satisfies EventDecisionOutcome[]);
      expect(idGenerator.calls).toBe(2);
      expect(clock.calls).toBe(2);
      expect(readEvent(db, "event-new-missing-occurred")).toEqual({
        id: "event-new-missing-occurred",
        title: "  New Event title  ",
        entity_name: "New Entity",
        subject: "New Subject",
        scope: "New Scope",
        description: "New Event description\nwith exact spacing",
        occurred_at: null,
        discovered_at: FIXED_TIMESTAMP,
      });
      expect(readEvent(db, "event-new-null-occurred")).toEqual({
        id: "event-new-null-occurred",
        title: "Explicit null occurrence",
        entity_name: "New Entity",
        subject: "New Subject",
        scope: "New Scope",
        description: "New Event description\nwith exact spacing",
        occurred_at: null,
        discovered_at: FIXED_TIMESTAMP,
      });
      expect(countEventAnalysisRows(db, "events")).toBe(2);
      expect(countEventAnalysisRows(db, "event_updates")).toBe(0);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(2);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(0);
      expect(
        db
          .prepare(
            `
              SELECT target_type, target_id, content_id
              FROM event_content_links
              ORDER BY target_id
            `,
          )
          .all(),
      ).toEqual([
        {
          target_type: "EVENT",
          target_id: "event-new-missing-occurred",
          content_id: eventAnalysisFixtureIds.content,
        },
        {
          target_type: "EVENT",
          target_id: "event-new-null-occurred",
          content_id: eventAnalysisFixtureIds.otherContent,
        },
      ]);
      expectNoChangesAfterSnapshot(db, before, [
        "events",
        "event_content_links",
      ]);
    });
  });

  it("EVT-02 and TIME_BINDING create one first Event Update and parent EVENT_UPDATE evidence", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      const parentBefore = readEvent(db, eventAnalysisFixtureIds.event);
      const idGenerator = new CountingIdGenerator(["event-update-new"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);
      const decision = newUpdateDecision();

      const outcome = withTransaction(db, () =>
        persistence.apply(eventAnalysisFixtureIds.content, decision),
      );

      expect(outcome).toEqual({
        newTarget: {
          target_type: "EVENT_UPDATE",
          target_id: "event-update-new",
        },
        affectedEventIds: [eventAnalysisFixtureIds.event],
      });
      expect(idGenerator.calls).toBe(1);
      expect(clock.calls).toBe(1);
      expect(readEvent(db, eventAnalysisFixtureIds.event)).toEqual(
        parentBefore,
      );
      expect(readUpdate(db, "event-update-new")).toEqual({
        id: "event-update-new",
        event_id: eventAnalysisFixtureIds.event,
        title: "  New Update title  ",
        description: "New Update description\nwith exact spacing",
        occurred_at: "2026-11-18T06:00:00.000+08:00",
        discovered_at: FIXED_TIMESTAMP,
      });
      expect(countEventAnalysisRows(db, "event_updates")).toBe(1);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(1);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(0);
      expect(
        db
          .prepare(
            `
              SELECT target_type, target_id, content_id
              FROM event_content_links
              WHERE target_type = 'EVENT_UPDATE'
            `,
          )
          .get(),
      ).toEqual({
        target_type: "EVENT_UPDATE",
        target_id: "event-update-new",
        content_id: eventAnalysisFixtureIds.content,
      });
    });
  });

  it("EVT-08/09 saves one exact Update without modifying the parent Event or prior Update", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      const parentBefore = readEvent(db, eventAnalysisFixtureIds.event);
      const priorBefore = readUpdate(db, eventAnalysisFixtureIds.priorUpdate);
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-update-correction"]),
        new CountingClock(FIXED_TIME),
      );
      const decision = newUpdateDecision({
        title: "Correction title",
        description: "  Corrected fact, not a replacement  ",
        occurred_at: null,
        confirmed_aliases: [],
      });

      withTransaction(db, () =>
        persistence.apply(eventAnalysisFixtureIds.content, decision),
      );

      expect(readEvent(db, eventAnalysisFixtureIds.event)).toEqual(
        parentBefore,
      );
      expect(readUpdate(db, eventAnalysisFixtureIds.priorUpdate)).toEqual(
        priorBefore,
      );
      expect(readUpdate(db, "event-update-correction")).toEqual({
        id: "event-update-correction",
        event_id: eventAnalysisFixtureIds.event,
        title: "Correction title",
        description: "  Corrected fact, not a replacement  ",
        occurred_at: null,
        discovered_at: FIXED_TIMESTAMP,
      });
      expect(countEventAnalysisRows(db, "event_updates")).toBe(2);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(1);
    });
  });

  it("EVT-15_PRE rechecks Event existence inside the active transaction before ID generation", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      const idGenerator = new CountingIdGenerator(["must-not-be-used"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);

      expect(() =>
        withTransaction(db, () =>
          persistence.apply(
            eventAnalysisFixtureIds.content,
            newUpdateDecision({ event_id: "event-missing-in-database" }),
          ),
        ),
      ).toThrow("Event for Event Update no longer exists");

      expect(idGenerator.calls).toBe(0);
      expect(clock.calls).toBe(0);
      expect(countEventAnalysisRows(db, "events")).toBe(0);
      expect(countEventAnalysisRows(db, "event_updates")).toBe(0);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(0);
    });
  });

  it("SYNC_BOUNDARY rejects db.inTransaction=false before any SQL, ID, or Clock work", async () => {
    await withEventAnalysisDatabase((db) => {
      let prepareCalls = 0;
      const observedDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === "prepare") {
            return (source: string): Database.Statement => {
              prepareCalls += 1;
              return target.prepare(source);
            };
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const idGenerator = new CountingIdGenerator(["must-not-be-used"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(observedDb, idGenerator, clock);

      expect(() =>
        persistence.apply(eventAnalysisFixtureIds.content, newEventDecision()),
      ).toThrow(
        "EventDecisionPersistence.apply requires an active transaction",
      );

      expect(observedDb.inTransaction).toBe(false);
      expect(prepareCalls).toBe(0);
      expect(idGenerator.calls).toBe(0);
      expect(clock.calls).toBe(0);
      expect(countEventAnalysisRows(db, "events")).toBe(0);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(0);
    });
  });

  it("ROLLBACK removes the Event and evidence already written when the outer transaction throws", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      const failure = new Error("injected failure after evidence insert");
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-rolled-back"]),
        new CountingClock(FIXED_TIME),
      );
      let observed: unknown;

      try {
        withTransaction(db, () => {
          persistence.apply(
            eventAnalysisFixtureIds.content,
            newEventDecision(),
          );
          throw failure;
        });
      } catch (error) {
        observed = error;
      }

      expect(observed).toBe(failure);
      expect(db.inTransaction).toBe(false);
      expect(countEventAnalysisRows(db, "events")).toBe(0);
      expect(countEventAnalysisRows(db, "event_updates")).toBe(0);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(0);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(0);
    });
  });

  it("T02_SCOPE rejects NO_INCREMENT without writing or resolving IDs", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      const idGenerator = new CountingIdGenerator(["must-not-be-used"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);
      const decision: EventAnalysisDecision = {
        action: "NO_INCREMENT",
        event_id: eventAnalysisFixtureIds.event,
        event_update_id: null,
        confirmed_aliases: [],
      };
      const before = snapshotEventAnalysisRows(db);

      expect(() =>
        withTransaction(db, () =>
          persistence.apply(eventAnalysisFixtureIds.content, decision),
        ),
      ).toThrow("NO_INCREMENT persistence is not available in D09-T02");

      expect(idGenerator.calls).toBe(0);
      expect(clock.calls).toBe(0);
      expect(snapshotEventAnalysisRows(db)).toEqual(before);
    });
  });

  it("SQL_BOUNDARY prepares only bound SELECT/INSERT statements for the three owned tables", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
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
      const persistence = createPersistence(
        observedDb,
        new CountingIdGenerator(["event-sql-bound", "event-update-sql-bound"]),
        new CountingClock(FIXED_TIME),
      );

      withTransaction(observedDb, () => {
        persistence.apply(
          eventAnalysisFixtureIds.content,
          newEventDecision({
            title: "SQL injection probe '); DROP TABLE events; --",
          }),
        );
        persistence.apply(eventAnalysisFixtureIds.content, newUpdateDecision());
      });

      expect(preparedSql.length).toBeGreaterThan(0);
      expect(
        preparedSql.every(
          (sql) =>
            sql.startsWith("SELECT ") ||
            sql.startsWith("INSERT INTO events ") ||
            sql.startsWith("INSERT INTO event_updates ") ||
            sql.startsWith("INSERT INTO event_content_links "),
        ),
      ).toBe(true);
      expect(
        preparedSql.some((sql) =>
          /event_search|refreshEventSearch|rebuildEventSearch/i.test(sql),
        ),
      ).toBe(false);
      expect(preparedSql.some((sql) => sql.includes("DROP TABLE events"))).toBe(
        false,
      );
      expect(
        preparedSql.every(
          (sql) =>
            sql.endsWith("?") ||
            sql.includes("?,") ||
            sql.includes("?)") ||
            sql.includes("VALUES (?, ?, ?)"),
        ),
      ).toBe(true);
    });
  });
});
