import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { refreshEventSearch } from "../../src/database/event-search.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import {
  type EventRecord,
  type EventRepository,
  SqliteEventRepository,
} from "../../src/event-analysis/event-repository.js";
import { persistEventAnalysis } from "../../src/event-analysis/event-analysis-persistence.js";
import type { EventAnalysisTarget } from "../../src/event-analysis/contracts.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../../src/llm/response-validators.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
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
import { createFaultyDatabase } from "../fixtures/faulty-database.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const FIXED_TIME = new Date("2026-11-19T01:30:00.000Z");
const EVENT_SEARCH_INSERT =
  "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)";
const EVENT_INSERT = `
  INSERT INTO events (
    id, title, entity_name, subject, scope, description, occurred_at,
    discovered_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

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

interface EventSearchRow {
  readonly event_id: string;
  readonly search_text: string;
}

interface DatabaseObservation {
  readonly database: Database.Database;
  readonly transactionCalls: { value: number };
  readonly prepareCalls: { value: number };
  readonly refreshedEventIds: string[];
}

function newEventDecision(
  overrides: Partial<NewEventDecision> = {},
): NewEventDecision {
  return {
    action: "NEW_EVENT",
    title: "Created Event Title",
    entity: { name: "Created Entity" },
    subject: "Created Subject",
    scope: "Created Scope",
    description: "Created Event Description",
    occurred_at: "2026-11-18T10:00:00.000+08:00",
    confirmed_aliases: [],
    ...overrides,
  };
}

function newUpdateDecision(
  overrides: Partial<NewUpdateDecision> = {},
): NewUpdateDecision {
  return {
    action: "NEW_UPDATE",
    event_id: eventAnalysisFixtureIds.event,
    title: "Created Update Title",
    description: "Created Update Description",
    occurred_at: "2026-11-18T11:00:00.000+08:00",
    confirmed_aliases: [],
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

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function withEventAnalysisDatabase<T>(callback: (db: Database.Database) => T) {
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

function observeDatabase(
  db: Database.Database,
  captureRefreshes: boolean,
): DatabaseObservation {
  const transactionCalls = { value: 0 };
  const prepareCalls = { value: 0 };
  const refreshedEventIds: string[] = [];
  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (operation: () => unknown) => {
          transactionCalls.value += 1;
          return target.transaction(operation);
        };
      }

      if (property === "prepare") {
        return (source: string): Database.Statement => {
          prepareCalls.value += 1;
          const statement = target.prepare(source);
          if (
            !captureRefreshes ||
            normalizeSql(source) !== EVENT_SEARCH_INSERT
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

  return {
    database,
    transactionCalls,
    prepareCalls,
    refreshedEventIds,
  };
}

function databaseFailingOnNthRun(
  db: Database.Database,
  failingSql: string,
  failingOccurrence: number,
  failure: Error,
): Database.Database {
  let occurrence = 0;
  const normalizedFailureSql = normalizeSql(failingSql);

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          if (normalizeSql(source) !== normalizedFailureSql) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run") {
                return (...parameters: unknown[]) => {
                  occurrence += 1;
                  if (occurrence === failingOccurrence) {
                    throw failure;
                  }

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
}

function eventSearchRows(
  db: Database.Database,
  eventId: string,
): EventSearchRow[] {
  return db
    .prepare<[string], EventSearchRow>(
      `
        SELECT event_id, search_text
        FROM event_search
        WHERE event_id = ?
      `,
    )
    .all(eventId);
}

function searchEventIds(db: Database.Database, term: string): string[] {
  return db
    .prepare<[string], { readonly event_id: string }>(
      `
        SELECT event_id
        FROM event_search
        WHERE event_search MATCH ?
        ORDER BY event_id COLLATE BINARY
      `,
    )
    .all(term)
    .map(({ event_id }) => event_id);
}

function insertStoredAlias(
  db: Database.Database,
  eventId: string,
  alias: string,
  contentId: string,
): void {
  db.prepare(
    `
      INSERT INTO event_entity_aliases (event_id, alias, content_id)
      VALUES (?, ?, ?)
    `,
  ).run(eventId, alias, contentId);
}

function expectNoThen(value: unknown): void {
  expect((value as { readonly then?: unknown }).then).toBeUndefined();
}

describe("persistEventAnalysis", () => {
  it("EVT-07 / MULTI_EVENT persists NEW_EVENT and NEW_UPDATE in one outer transaction with ordered targets and BINARY refreshes", () =>
    withEventAnalysisDatabase((db) => {
      const createdZId = "event-created-z";
      const createdAId = "event-created-a";
      const createdUpdateId = "event-update-created-a";
      const historicalAlias = "HistoricalAliasToken";

      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.otherContent);
      insertStoredEvent(db);
      insertStoredEvent(db, eventAnalysisFixtureRows.otherEvent);
      insertStoredEventUpdate(db);
      insertStoredEventUpdate(db, {
        ...eventAnalysisFixtureRows.priorUpdate,
        id: "event-update-other-historical",
        event_id: eventAnalysisFixtureIds.otherEvent,
      });
      insertStoredUpdateEvidence(
        db,
        "event-update-other-historical",
        eventAnalysisFixtureIds.content,
      );
      insertStoredAlias(
        db,
        eventAnalysisFixtureIds.otherEvent,
        historicalAlias,
        eventAnalysisFixtureIds.otherContent,
      );

      const ids = new SequenceIdGenerator([
        createdZId,
        createdUpdateId,
        createdAId,
      ]);
      const observation = observeDatabase(db, true);
      const repository = new SqliteEventRepository(observation.database);
      const results: EventAnalysisDecision[] = [
        newEventDecision({
          title: "Created Z Title",
          confirmed_aliases: ["ZebraRecallToken"],
        }),
        newUpdateDecision({
          title: "Event A Fresh Update Title",
          confirmed_aliases: ["KangarooRecallToken"],
        }),
        newUpdateDecision({
          event_id: eventAnalysisFixtureIds.otherEvent,
          title: "Reused Update Text Must Not Replace Prior",
          confirmed_aliases: [historicalAlias],
        }),
        newEventDecision({
          title: "Created A Title",
          confirmed_aliases: ["AardvarkRecallToken"],
        }),
      ];

      const result = persistEventAnalysis(
        {
          database: observation.database,
          eventRepository: repository,
          idGenerator: ids,
          clock: new FakeClock(FIXED_TIME),
        },
        eventAnalysisFixtureIds.content,
        results,
      );

      expect(result).toStrictEqual({
        new_targets: [
          { target_type: "EVENT", target_id: createdZId },
          { target_type: "EVENT_UPDATE", target_id: createdUpdateId },
          { target_type: "EVENT", target_id: createdAId },
        ] satisfies EventAnalysisTarget[],
      });
      expectNoThen(result);
      expect({
        transactionCalls: observation.transactionCalls.value,
        refreshedEventIds: observation.refreshedEventIds,
      }).toStrictEqual({
        transactionCalls: 4,
        refreshedEventIds: [
          createdAId,
          createdZId,
          eventAnalysisFixtureIds.event,
        ],
      });
      expect(db.inTransaction).toBe(false);
      expect(countEventAnalysisRows(db, "events")).toBe(4);
      expect(countEventAnalysisRows(db, "event_updates")).toBe(3);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(4);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(4);
      expect(countEventAnalysisRows(db, "event_search")).toBe(3);
      expect(searchEventIds(db, "ZebraRecallToken")).toStrictEqual([
        createdZId,
      ]);
      expect(searchEventIds(db, "AardvarkRecallToken")).toStrictEqual([
        createdAId,
      ]);
      expect(searchEventIds(db, "KangarooRecallToken")).toStrictEqual([
        eventAnalysisFixtureIds.event,
      ]);
      expect(
        db
          .prepare<[string, string], { readonly content_id: string }>(
            `
              SELECT content_id
              FROM event_entity_aliases
              WHERE event_id = ? AND alias = ?
            `,
          )
          .get(eventAnalysisFixtureIds.otherEvent, historicalAlias),
      ).toStrictEqual({ content_id: eventAnalysisFixtureIds.otherContent });
      expect(eventSearchRows(db, createdAId)).toHaveLength(1);
      expect(eventSearchRows(db, createdZId)).toHaveLength(1);
      expect(eventSearchRows(db, eventAnalysisFixtureIds.event)).toHaveLength(
        1,
      );
    }));

  it("TARGET_ORDER_DEDUPE returns a repeated target only once while retaining its first position", () =>
    withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      const repository = new SqliteEventRepository(db);
      let insertedEvents = 0;
      let insertedEvidence = 0;
      let firstEvent: EventRecord | null = null;
      const repeatedTargetRepository = new Proxy(repository, {
        get(target, property, receiver) {
          if (property === "insertEvent") {
            return (record: EventRecord): EventRecord => {
              insertedEvents += 1;
              if (insertedEvents === 1) {
                firstEvent = target.insertEvent(record);
                return firstEvent;
              }

              if (firstEvent === null) {
                throw new Error("Expected first Event to be inserted");
              }
              return firstEvent;
            };
          }

          if (property === "insertEvidence") {
            return (
              targetType: "EVENT" | "EVENT_UPDATE",
              targetId: string,
              contentId: string,
            ) => {
              insertedEvidence += 1;
              const inserted = target.insertEvidence(
                targetType,
                targetId,
                contentId,
              );
              return insertedEvidence === 2
                ? { ...inserted, inserted: true }
                : inserted;
            };
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as EventRepository;
      const observation = observeDatabase(db, true);
      const observedRepository = new Proxy(repeatedTargetRepository, {
        get(target, property, receiver) {
          if (property === "getEventSearchText") {
            return (eventId: string) =>
              new SqliteEventRepository(
                observation.database,
              ).getEventSearchText(eventId);
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const decision = newEventDecision({
        confirmed_aliases: ["Repeated Target Alias"],
      });

      const result = persistEventAnalysis(
        {
          database: observation.database,
          eventRepository: observedRepository,
          idGenerator: new SequenceIdGenerator([
            "event-dedupe-first",
            "event-dedupe-second",
          ]),
          clock: new FakeClock(FIXED_TIME),
        },
        eventAnalysisFixtureIds.content,
        [decision, decision],
      );

      expect(result).toStrictEqual({
        new_targets: [
          { target_type: "EVENT", target_id: "event-dedupe-first" },
        ],
      });
      expect(observation.transactionCalls.value).toBe(2);
      expect(observation.refreshedEventIds).toStrictEqual([
        "event-dedupe-first",
      ]);
      expect(countEventAnalysisRows(db, "events")).toBe(1);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(1);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(1);
      expect(db.inTransaction).toBe(false);
    }));

  it("AFFECTED_DEDUPE handles repeated NO_INCREMENT evidence and aliases for one Event with one refresh", () =>
    withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      refreshEventSearch(db, eventAnalysisFixtureIds.event);
      const searchBefore = eventSearchRows(db, eventAnalysisFixtureIds.event);
      const observation = observeDatabase(db, true);
      const repository = new SqliteEventRepository(observation.database);

      const result = persistEventAnalysis(
        {
          database: observation.database,
          eventRepository: repository,
          idGenerator: new SequenceIdGenerator([]),
          clock: new FakeClock(FIXED_TIME),
        },
        eventAnalysisFixtureIds.content,
        [
          noIncrementDecision({
            event_update_id: eventAnalysisFixtureIds.priorUpdate,
          }),
          noIncrementDecision({ confirmed_aliases: ["Stable Alias"] }),
          noIncrementDecision({ confirmed_aliases: ["Stable Alias"] }),
        ],
      );

      expect(result).toStrictEqual({ new_targets: [] });
      expect(observation.transactionCalls.value).toBe(2);
      expect(observation.refreshedEventIds).toStrictEqual([
        eventAnalysisFixtureIds.event,
      ]);
      expect(countEventAnalysisRows(db, "event_updates")).toBe(1);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(2);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(1);
      expect(eventSearchRows(db, eventAnalysisFixtureIds.event)).toHaveLength(
        1,
      );
      expect(
        eventSearchRows(db, eventAnalysisFixtureIds.event)[0]?.search_text,
      ).toContain("Stable Alias");
      expect(searchBefore).toHaveLength(1);
      expect(db.inTransaction).toBe(false);
    }));

  it("EVIDENCE_NO_REFRESH performs zero FTS work for evidence-only NO_INCREMENT results", () =>
    withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      refreshEventSearch(db, eventAnalysisFixtureIds.event);
      const searchBefore = snapshotEventAnalysisRows(db).event_search;
      const observation = observeDatabase(db, true);
      const repository = new SqliteEventRepository(observation.database);

      const result = persistEventAnalysis(
        {
          database: observation.database,
          eventRepository: repository,
          idGenerator: new SequenceIdGenerator([]),
          clock: new FakeClock(FIXED_TIME),
        },
        eventAnalysisFixtureIds.content,
        [
          noIncrementDecision({
            event_update_id: eventAnalysisFixtureIds.priorUpdate,
          }),
          noIncrementDecision(),
        ],
      );

      expect(result).toStrictEqual({ new_targets: [] });
      expect(observation.transactionCalls.value).toBe(1);
      expect(observation.refreshedEventIds).toStrictEqual([]);
      expect(snapshotEventAnalysisRows(db).event_search).toStrictEqual(
        searchBefore,
      );
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(2);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(db.inTransaction).toBe(false);
    }));

  it("EVT-16 / MID_DB_FAILURE / ATOMIC rolls back all prior Event, Update, evidence, alias, and FTS rows", () =>
    withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      insertStoredEvent(db);
      const before = snapshotEventAnalysisRows(db);
      const failure = new Error("injected middle Event insert failure");
      const failingDatabase = databaseFailingOnNthRun(
        db,
        EVENT_INSERT,
        2,
        failure,
      );
      let observed: unknown;

      try {
        persistEventAnalysis(
          {
            database: failingDatabase,
            eventRepository: new SqliteEventRepository(failingDatabase),
            idGenerator: new SequenceIdGenerator([
              "event-before-db-failure",
              "event-update-before-db-failure",
              "event-db-failure",
            ]),
            clock: new FakeClock(FIXED_TIME),
          },
          eventAnalysisFixtureIds.content,
          [
            newEventDecision({
              title: "Event Before DB Failure",
              confirmed_aliases: ["Alias Before DB Failure"],
            }),
            newUpdateDecision({
              title: "Update Before DB Failure",
              confirmed_aliases: ["Update Alias Before DB Failure"],
            }),
            newEventDecision({ title: "Failing Event" }),
          ],
        );
      } catch (error) {
        observed = error;
      }

      expect(observed).toBe(failure);
      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toStrictEqual(before);

      const firstFtsFailureDatabase = createFaultyDatabase(db, 2);
      let ftsFailure: unknown;
      try {
        persistEventAnalysis(
          {
            database: firstFtsFailureDatabase,
            eventRepository: new SqliteEventRepository(firstFtsFailureDatabase),
            idGenerator: new SequenceIdGenerator([
              "event-before-fts-failure",
              "event-fts-failure",
            ]),
            clock: new FakeClock(FIXED_TIME),
          },
          eventAnalysisFixtureIds.content,
          [
            newEventDecision({ title: "Event Before FTS Failure" }),
            newEventDecision({ title: "FTS Failure Event" }),
          ],
        );
      } catch (error) {
        ftsFailure = error;
      }

      expect(ftsFailure).toMatchObject({
        message: "injected event_search insert failure",
      });
      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toStrictEqual(before);
    }));

  it("READBACK_FAILURE rejects a missing Event readback and rolls back the committed-path candidates", () =>
    withEventAnalysisDatabase((db) => {
      insertEventAnalysisContent(db, eventAnalysisFixtureIds.content);
      const before = snapshotEventAnalysisRows(db);
      const repository = new SqliteEventRepository(db);
      const unreadableRepository = new Proxy(repository, {
        get(target, property, receiver) {
          if (property === "getEventById") {
            return () => null;
          }

          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      expect(() =>
        persistEventAnalysis(
          {
            database: db,
            eventRepository: unreadableRepository,
            idGenerator: new SequenceIdGenerator(["event-readback-failure"]),
            clock: new FakeClock(FIXED_TIME),
          },
          eventAnalysisFixtureIds.content,
          [newEventDecision({ confirmed_aliases: ["Readback Alias"] })],
        ),
      ).toThrow("Persisted Event could not be read back");

      expect(db.inTransaction).toBe(false);
      expect(snapshotEventAnalysisRows(db)).toStrictEqual(before);
      expect(countEventAnalysisRows(db, "events")).toBe(0);
      expect(countEventAnalysisRows(db, "event_content_links")).toBe(0);
      expect(countEventAnalysisRows(db, "event_entity_aliases")).toBe(0);
      expect(countEventAnalysisRows(db, "event_search")).toBe(0);
    }));

  it("NO_RESULTS / SYNC_CALLBACK returns before transaction and proves the real transaction rejects a thenable", () =>
    withEventAnalysisDatabase((db) => {
      const observation = observeDatabase(db, true);

      const result = persistEventAnalysis(
        {
          database: observation.database,
          eventRepository: new SqliteEventRepository(observation.database),
          idGenerator: new SequenceIdGenerator([]),
          clock: new FakeClock(FIXED_TIME),
        },
        eventAnalysisFixtureIds.content,
        [],
      );

      expect(result).toStrictEqual({ new_targets: [] });
      expectNoThen(result);
      expect(observation.transactionCalls.value).toBe(0);
      expect(observation.prepareCalls.value).toBe(0);
      expect(observation.refreshedEventIds).toStrictEqual([]);
      expect(db.inTransaction).toBe(false);

      const callUnsafeTransaction = withTransaction as unknown as (
        database: Database.Database,
        operation: () => unknown,
      ) => unknown;
      expect(() =>
        callUnsafeTransaction(db, () => ({ then: () => undefined })),
      ).toThrow("withTransaction callback must not return a thenable");
      expect(db.inTransaction).toBe(false);
    }));
});
