import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  rebuildEventSearch,
  refreshEventSearch,
} from "../../src/database/event-search.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import {
  EventDecisionPersistence,
  type EventDecisionOutcome,
} from "../../src/event-analysis/event-decision-persistence.js";
import { SqliteEventRepository } from "../../src/event-analysis/event-repository.js";
import { refreshAffectedEvents } from "../../src/event-analysis/event-search-refresh.js";
import type { IdGenerator } from "../../src/id/id-generator.js";
import type { Clock } from "../../src/time/clock.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../../src/llm/response-validators.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { createFaultyDatabase } from "../fixtures/faulty-database.js";
import {
  countEventAnalysisRows,
  eventAnalysisFixtureIds,
  eventAnalysisFixtureRows,
  insertEventAnalysisContent,
  insertStoredEvent,
  insertStoredEventUpdate,
  insertStoredUpdateEvidence,
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
type NoIncrementDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NO_INCREMENT" }
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

function noIncrementDecision(
  overrides: Partial<NoIncrementDecision> = {},
): NoIncrementDecision {
  return {
    action: "NO_INCREMENT",
    event_id: eventAnalysisFixtureIds.event,
    event_update_id: null,
    confirmed_aliases: [],
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

function applyAndRefresh(
  db: Database.Database,
  persistence: EventDecisionPersistence,
  contentId: string,
  decision: EventAnalysisDecision,
): EventDecisionOutcome {
  return withTransaction(db, () => {
    const outcome = persistence.apply(contentId, decision);
    refreshAffectedEvents(db, outcome.affectedEventIds);
    return outcome;
  });
}

function searchEventIds(db: Database.Database, terms: string): string[] {
  return db
    .prepare<[string], { readonly event_id: string }>(
      `
        SELECT event_id
        FROM event_search
        WHERE event_search MATCH ?
        ORDER BY event_id COLLATE BINARY
      `,
    )
    .all(terms)
    .map(({ event_id }) => event_id);
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
          affectedEventIds: [
            "event-new-missing-occurred",
            "event-new-missing-occurred",
          ],
        },
        {
          newTarget: {
            target_type: "EVENT",
            target_id: "event-new-null-occurred",
          },
          affectedEventIds: [
            "event-new-null-occurred",
            "event-new-null-occurred",
          ],
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
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(2);
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
        "event_entity_aliases",
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
        affectedEventIds: [
          eventAnalysisFixtureIds.event,
          eventAnalysisFixtureIds.event,
        ],
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
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(1);
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

  it("EVT-03 records only the specified Update evidence and does not refresh FTS", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      refreshEventSearch(db, eventAnalysisFixtureIds.event);
      const idGenerator = new CountingIdGenerator(["must-not-be-used"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);
      const updateBefore = readUpdate(db, eventAnalysisFixtureIds.priorUpdate);
      const searchBefore = snapshotEventAnalysisRows(db).event_search;
      const decision = noIncrementDecision({
        event_update_id: eventAnalysisFixtureIds.priorUpdate,
      });
      const before = snapshotEventAnalysisRows(db);

      const outcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        decision,
      );

      expect(outcome).toEqual({ newTarget: null, affectedEventIds: [] });
      expect(idGenerator.calls).toBe(0);
      expect(clock.calls).toBe(0);
      expect(readUpdate(db, eventAnalysisFixtureIds.priorUpdate)).toEqual(
        updateBefore,
      );
      expect(countEventAnalysisRows(db, "event_updates")).toBe(1);
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
          target_type: "EVENT_UPDATE",
          target_id: eventAnalysisFixtureIds.priorUpdate,
          content_id: eventAnalysisFixtureIds.content,
        },
      ]);
      expect(snapshotEventAnalysisRows(db).event_search).toEqual(searchBefore);
      expectNoChangesAfterSnapshot(db, before, ["event_content_links"]);
    });
  });

  it("EVT-04 null Update evidence links only the Event and never guesses an Update", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["must-not-be-used"]),
        new CountingClock(FIXED_TIME),
      );

      const outcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        noIncrementDecision(),
      );

      expect(outcome).toEqual({ newTarget: null, affectedEventIds: [] });
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
            `,
          )
          .get(),
      ).toEqual({
        target_type: "EVENT",
        target_id: eventAnalysisFixtureIds.event,
        content_id: eventAnalysisFixtureIds.content,
      });
    });
  });

  it("WRONG_UPDATE_OWNER rejects a real Update from another Event with zero writes", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEvent(db, eventAnalysisFixtureRows.otherEvent);
      insertStoredEventUpdate(db, {
        ...eventAnalysisFixtureRows.priorUpdate,
        event_id: eventAnalysisFixtureIds.otherEvent,
      });
      refreshEventSearch(db, eventAnalysisFixtureIds.event);
      refreshEventSearch(db, eventAnalysisFixtureIds.otherEvent);
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["must-not-be-used"]),
        new CountingClock(FIXED_TIME),
      );
      const before = snapshotEventAnalysisRows(db);

      expect(() =>
        applyAndRefresh(
          db,
          persistence,
          eventAnalysisFixtureIds.content,
          noIncrementDecision({
            event_update_id: eventAnalysisFixtureIds.priorUpdate,
          }),
        ),
      ).toThrow("NO_INCREMENT Event Update does not belong to Event");

      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toEqual(before);
    });
  });

  it("EVT-17 / REUSE replays the same Content and Event without rewriting Update or returning a target", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      insertStoredUpdateEvidence(
        db,
        eventAnalysisFixtureIds.priorUpdate,
        eventAnalysisFixtureIds.content,
      );
      refreshEventSearch(db, eventAnalysisFixtureIds.event);
      const updateBefore = readUpdate(db, eventAnalysisFixtureIds.priorUpdate);
      const evidenceBefore = snapshotEventAnalysisRows(db).event_content_links;
      const searchBefore = snapshotEventAnalysisRows(db).event_search;
      const idGenerator = new CountingIdGenerator(["must-not-be-used"]);
      const clock = new CountingClock(FIXED_TIME);
      const persistence = createPersistence(db, idGenerator, clock);
      const decision = newUpdateDecision({
        title: "Must not replace prior Update",
        description: "Must not replace prior description",
        confirmed_aliases: [],
      });

      const outcomes = withTransaction(db, () => {
        const first = persistence.apply(
          eventAnalysisFixtureIds.content,
          decision,
        );
        refreshAffectedEvents(db, first.affectedEventIds);
        const second = persistence.apply(
          eventAnalysisFixtureIds.content,
          decision,
        );
        refreshAffectedEvents(db, second.affectedEventIds);
        return [first, second] as const;
      });

      expect(outcomes).toEqual([
        { newTarget: null, affectedEventIds: [] },
        { newTarget: null, affectedEventIds: [] },
      ] satisfies EventDecisionOutcome[]);
      expect(idGenerator.calls).toBe(0);
      expect(clock.calls).toBe(0);
      expect(readUpdate(db, eventAnalysisFixtureIds.priorUpdate)).toEqual(
        updateBefore,
      );
      expect(countEventAnalysisRows(db, "event_updates")).toBe(1);
      expect(snapshotEventAnalysisRows(db).event_content_links).toEqual(
        evidenceBefore,
      );
      expect(snapshotEventAnalysisRows(db).event_search).toEqual(searchBefore);
    });
  });

  it("EVT-12/13 saves exact aliases for NEW_EVENT and NO_INCREMENT without overwriting evidence", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const mixedCaseAlias = "  Alias Mixed CASE  ";
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-alias-new"]),
        new CountingClock(FIXED_TIME),
      );

      const newEventOutcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        newEventDecision({
          confirmed_aliases: [mixedCaseAlias, "Second Alias Token"],
        }),
      );

      expect(newEventOutcome).toEqual({
        newTarget: { target_type: "EVENT", target_id: "event-alias-new" },
        affectedEventIds: [
          "event-alias-new",
          "event-alias-new",
          "event-alias-new",
        ],
      });
      expect(
        db
          .prepare(
            `
              SELECT event_id, alias, content_id
              FROM event_entity_aliases
              ORDER BY alias COLLATE BINARY
            `,
          )
          .all(),
      ).toEqual([
        {
          event_id: "event-alias-new",
          alias: mixedCaseAlias,
          content_id: eventAnalysisFixtureIds.content,
        },
        {
          event_id: "event-alias-new",
          alias: "Second Alias Token",
          content_id: eventAnalysisFixtureIds.content,
        },
      ]);
      expect(searchEventIds(db, "Second Alias Token")).toEqual([
        "event-alias-new",
      ]);
      expect(countEventAnalysisRows(db, "event_search")).toBe(1);
      const searchBefore = snapshotEventAnalysisRows(db).event_search;

      const noIncrementOutcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.otherContent,
        noIncrementDecision({
          event_id: "event-alias-new",
          confirmed_aliases: [mixedCaseAlias],
        }),
      );

      expect(noIncrementOutcome).toEqual({
        newTarget: null,
        affectedEventIds: [],
      });
      expect(
        db
          .prepare(
            `
              SELECT content_id
              FROM event_entity_aliases
              WHERE event_id = ? AND alias = ?
            `,
          )
          .get("event-alias-new", mixedCaseAlias),
      ).toEqual({ content_id: eventAnalysisFixtureIds.content });
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(2);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(2);
      expect(snapshotEventAnalysisRows(db).event_search).toEqual(searchBefore);
    });
  });

  it("EVT-14 writes no alias for confirmed_aliases=[] and has no search-term input path", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-no-alias"]),
        new CountingClock(FIXED_TIME),
      );

      const outcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        newEventDecision({ confirmed_aliases: [] }),
      );

      expect(outcome.affectedEventIds).toEqual(["event-no-alias"]);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(1);
    });
  });

  it("EVT-24 isolates the same alias by Event and refreshes only the Event with a new alias", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      const sharedAlias = "Shared Alias Token";
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-alias-first", "event-alias-second"]),
        new CountingClock(FIXED_TIME),
      );

      const outcomes = withTransaction(db, () => {
        const first = persistence.apply(
          eventAnalysisFixtureIds.content,
          newEventDecision({
            title: "First Alias Event",
            confirmed_aliases: [sharedAlias],
          }),
        );
        const second = persistence.apply(
          eventAnalysisFixtureIds.otherContent,
          newEventDecision({
            title: "Second Alias Event",
            confirmed_aliases: [sharedAlias],
          }),
        );
        refreshAffectedEvents(db, [
          ...second.affectedEventIds,
          ...first.affectedEventIds,
        ]);
        return [first, second] as const;
      });

      expect(outcomes.map(({ newTarget }) => newTarget)).toEqual([
        { target_type: "EVENT", target_id: "event-alias-first" },
        { target_type: "EVENT", target_id: "event-alias-second" },
      ]);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(2);
      expect(searchEventIds(db, sharedAlias)).toEqual([
        "event-alias-first",
        "event-alias-second",
      ]);
      const secondSearchBefore = snapshotEventAnalysisRows(
        db,
      ).event_search.find(
        (row) =>
          (JSON.parse(row) as { event_id: string }).event_id ===
          "event-alias-second",
      );

      const aliasOutcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        noIncrementDecision({
          event_id: "event-alias-first",
          confirmed_aliases: ["Only Event One Token"],
        }),
      );

      expect(aliasOutcome).toEqual({
        newTarget: null,
        affectedEventIds: ["event-alias-first"],
      });
      expect(searchEventIds(db, "Only Event One Token")).toEqual([
        "event-alias-first",
      ]);
      expect(
        snapshotEventAnalysisRows(db).event_search.find(
          (row) =>
            (JSON.parse(row) as { event_id: string }).event_id ===
            "event-alias-second",
        ),
      ).toEqual(secondSearchBefore);
    });
  });

  it("EVT-18 refreshes one logical FTS row, recalls prior Update and new alias, and rebuild converges", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      const persistence = createPersistence(
        db,
        new CountingIdGenerator(["event-update-fts"]),
        new CountingClock(FIXED_TIME),
      );

      const outcome = applyAndRefresh(
        db,
        persistence,
        eventAnalysisFixtureIds.content,
        newUpdateDecision({
          title: "Fresh Update Recall Title",
          description: "Fresh Update Recall Description",
          confirmed_aliases: ["Fresh Alias Recall Token"],
        }),
      );

      expect(outcome.newTarget).toEqual({
        target_type: "EVENT_UPDATE",
        target_id: "event-update-fts",
      });
      expect(countEventAnalysisRows(db, "event_search")).toBe(1);
      expect(searchEventIds(db, "Prior Update Title")).toEqual([
        eventAnalysisFixtureIds.event,
      ]);
      expect(searchEventIds(db, "Fresh Alias Recall Token")).toEqual([
        eventAnalysisFixtureIds.event,
      ]);
      const repository = new SqliteEventRepository(db);
      const searchBeforeRebuild = repository.getEventSearchText(
        eventAnalysisFixtureIds.event,
      );
      expect(searchBeforeRebuild).toContain("Fresh Update Recall Description");
      expect(searchBeforeRebuild).toContain("Fresh Alias Recall Token");

      rebuildEventSearch(db);

      expect(repository.getEventSearchText(eventAnalysisFixtureIds.event)).toBe(
        searchBeforeRebuild,
      );
      expect(countEventAnalysisRows(db, "event_search")).toBe(1);
    });
  });

  it("FTS_IMPACT_SET sorts BINARY and refreshes each Event once, with zero FTS SQL for an empty set", async () => {
    await withEventAnalysisDatabase((db) => {
      insertStoredEvent(db);
      insertStoredEvent(db, eventAnalysisFixtureRows.otherEvent);
      const preparedSql: string[] = [];
      const refreshedEventIds: string[] = [];
      const observedDb = new Proxy(db, {
        get(target, property, receiver) {
          if (property === "prepare") {
            return (source: string): Database.Statement => {
              const normalized = source.replace(/\s+/g, " ").trim();
              preparedSql.push(normalized);
              const statement = target.prepare(source);
              if (
                normalized !==
                "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)"
              ) {
                return statement;
              }

              return new Proxy(statement, {
                get(statementTarget, statementProperty, statementReceiver) {
                  if (statementProperty === "run") {
                    return (...parameters: unknown[]) => {
                      refreshedEventIds.push(String(parameters[0]));
                      return statementTarget.run(...parameters);
                    };
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

      withTransaction(observedDb, () =>
        refreshAffectedEvents(observedDb, [
          eventAnalysisFixtureIds.otherEvent,
          eventAnalysisFixtureIds.event,
          eventAnalysisFixtureIds.otherEvent,
        ]),
      );

      expect(refreshedEventIds).toEqual([
        eventAnalysisFixtureIds.event,
        eventAnalysisFixtureIds.otherEvent,
      ]);
      expect(countEventAnalysisRows(db, "event_search")).toBe(2);

      preparedSql.length = 0;
      withTransaction(observedDb, () => refreshAffectedEvents(observedDb, []));

      expect(preparedSql).toEqual([]);
      expect(() => refreshAffectedEvents(observedDb, [])).toThrow(
        "refreshAffectedEvents requires an active transaction",
      );
      expect(preparedSql).toEqual([]);
    });
  });

  it("ATOMIC_ROLLBACK restores Event/Update/evidence/alias/FTS after an injected FTS insert failure", async () => {
    await withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      const before = snapshotEventAnalysisRows(db);
      const faultyEventDb = createFaultyDatabase(db, 1);
      const eventPersistence = createPersistence(
        faultyEventDb,
        new CountingIdGenerator(["event-fts-rollback"]),
        new CountingClock(FIXED_TIME),
      );

      expect(() =>
        withTransaction(faultyEventDb, () => {
          const outcome = eventPersistence.apply(
            eventAnalysisFixtureIds.content,
            newEventDecision({
              confirmed_aliases: ["Atomic Event Alias"],
            }),
          );
          refreshAffectedEvents(faultyEventDb, outcome.affectedEventIds);
        }),
      ).toThrow("injected event_search insert failure");
      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toEqual(before);

      const faultyUpdateDb = createFaultyDatabase(db, 1);
      const updatePersistence = createPersistence(
        faultyUpdateDb,
        new CountingIdGenerator(["event-update-fts-rollback"]),
        new CountingClock(FIXED_TIME),
      );

      expect(() =>
        withTransaction(faultyUpdateDb, () => {
          const outcome = updatePersistence.apply(
            eventAnalysisFixtureIds.content,
            newUpdateDecision({
              title: "Atomic Update Title",
              confirmed_aliases: ["Atomic Update Alias"],
            }),
          );
          refreshAffectedEvents(faultyUpdateDb, outcome.affectedEventIds);
        }),
      ).toThrow("injected event_search insert failure");
      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toEqual(before);
    });
  });

  it("SQL_BOUNDARY prepares only bound SELECT/INSERT statements for the five owned tables", async () => {
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
            sql.startsWith("INSERT INTO event_content_links ") ||
            sql.startsWith("INSERT INTO event_entity_aliases "),
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
      expect(preparedSql.every((sql) => !sql.includes("' OR 1=1"))).toBe(true);
      expect(preparedSql.every((sql) => sql.includes("?"))).toBe(true);
    });
  });
});
