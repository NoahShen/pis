import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { loadEventCandidateContexts } from "../../src/event-search/candidate-context.js";
import type {
  EventCandidateClueEvidence,
  EventCandidateHit,
} from "../../src/event-search/event-candidate-repository.js";
import { EventSearchError } from "../../src/event-search/event-search-errors.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

const EVENT_WINDOW = "event-window";
const EVENT_ALPHA = "event-alpha";
const EVENT_BETA = "event-beta";
const ALL_HISTORY_IDS = Array.from(
  { length: 12 },
  (_, index) => `update-${String(index + 1).padStart(2, "0")}`,
);

interface EventSeed {
  readonly id: string;
  readonly title?: string;
  readonly entityName?: string;
  readonly subject?: string;
  readonly scope?: string;
  readonly description?: string;
  readonly occurredAt?: string | null;
  readonly discoveredAt?: string;
}

interface StatementCall {
  readonly method: "all" | "get" | "run";
  readonly parameters: readonly unknown[];
  readonly sql: string;
}

interface ProbeState {
  transactionCalls: number;
}

interface DatabaseProbe {
  readonly calls: StatementCall[];
  readonly database: Database.Database;
  readonly preparedSql: string[];
  readonly state: ProbeState;
}

interface InstrumentOptions {
  readonly afterStatementCall?: (call: StatementCall) => void;
}

interface TableNameRow {
  readonly name: string;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function seedEvent(database: Database.Database, seed: EventSeed): void {
  database
    .prepare(
      `
        INSERT INTO events (
          id, title, entity_name, subject, scope, description, occurred_at,
          discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      seed.id,
      seed.title ?? `${seed.id} title`,
      seed.entityName ?? `${seed.id} entity`,
      seed.subject ?? `${seed.id} subject`,
      seed.scope ?? `${seed.id} scope`,
      seed.description ?? `${seed.id} description`,
      seed.occurredAt === undefined ? null : seed.occurredAt,
      seed.discoveredAt ?? "2026-11-18T08:00:00.000+08:00",
    );
}

function updateDiscoveredAt(index: number): string {
  if (index >= 11) {
    return "2026-11-18T12:00:00.000+08:00";
  }

  return `2026-11-${String(index).padStart(2, "0")}T08:00:00.000+08:00`;
}

function seedUpdate(
  database: Database.Database,
  id: string,
  eventId: string,
  index: number,
): void {
  database
    .prepare(
      `
        INSERT INTO event_updates (
          id, event_id, title, description, occurred_at, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      eventId,
      `${id} title`,
      `${id} description`,
      index === 12
        ? null
        : `2025-12-${String(index).padStart(2, "0")}T08:00:00.000+08:00`,
      updateDiscoveredAt(index),
    );
}

function seedWindowUpdates(database: Database.Database, eventId: string): void {
  for (const index of [7, 12, 2, 11, 1, 10, 9, 8, 6, 5, 4, 3]) {
    seedUpdate(
      database,
      `update-${String(index).padStart(2, "0")}`,
      eventId,
      index,
    );
  }
}

function clueEvidence(
  clueIndex: number,
  ftsMatchedTerms: readonly string[],
  directEntityHit = false,
  aliasHit = false,
): EventCandidateClueEvidence {
  return { clueIndex, directEntityHit, aliasHit, ftsMatchedTerms };
}

function candidateHit(
  eventId: string,
  clue: EventCandidateClueEvidence = clueEvidence(0, []),
): EventCandidateHit {
  return {
    eventId,
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
    firstClueIndex: clue.clueIndex,
    clueEvidence: [clue],
  };
}

function instrumentDatabase(
  database: Database.Database,
  options: InstrumentOptions = {},
): DatabaseProbe {
  const calls: StatementCall[] = [];
  const preparedSql: string[] = [];
  const state: ProbeState = { transactionCalls: 0 };

  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string): Database.Statement => {
          preparedSql.push(sql);
          const statement = target.prepare(sql);

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (
                statementProperty === "all" ||
                statementProperty === "get" ||
                statementProperty === "run"
              ) {
                const method = statementProperty;
                const implementation = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementReceiver,
                ) as (...parameters: unknown[]) => unknown;

                return (...parameters: unknown[]): unknown => {
                  const call: StatementCall = { method, parameters, sql };
                  calls.push(call);
                  const result = Reflect.apply(
                    implementation,
                    statementTarget,
                    parameters,
                  );
                  options.afterStatementCall?.(call);
                  return result;
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

      if (property === "transaction") {
        return (): never => {
          state.transactionCalls += 1;
          throw new Error("unexpected transaction");
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { calls, database: wrapped, preparedSql, state };
}

function snapshotDatabase(
  database: Database.Database,
): Readonly<Record<string, readonly string[]>> {
  const tables = database
    .prepare<[], TableNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name COLLATE BINARY
      `,
    )
    .all();

  return Object.fromEntries(
    tables.map(({ name }) => {
      const quotedName = `"${name.replaceAll('"', '""')}"`;
      const rows = database.prepare(`SELECT * FROM ${quotedName}`).all();
      return [
        name,
        rows
          .map((row) => JSON.stringify(row))
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      ];
    }),
  );
}

function statementCalls(
  probe: DatabaseProbe,
  tableName: string,
): StatementCall[] {
  return probe.calls.filter(({ sql }) =>
    normalizeSql(sql).includes(`FROM ${tableName}`),
  );
}

function preparedStatements(probe: DatabaseProbe, tableName: string): string[] {
  return probe.preparedSql.filter((sql) =>
    normalizeSql(sql).includes(`FROM ${tableName}`),
  );
}

function expectAborted(operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected aborted EventSearchError");
  } catch (error) {
    expect(error).toBeInstanceOf(EventSearchError);
    expect((error as EventSearchError).code).toBe("aborted");
    expect((error as EventSearchError).message).toBe(
      "Event search was aborted",
    );
  }
}

describe("loadEventCandidateContexts", () => {
  it.each([
    { maxUpdates: 0, expectedUpdateIds: [] },
    { maxUpdates: 1, expectedUpdateIds: ALL_HISTORY_IDS.slice(11) },
    { maxUpdates: 10, expectedUpdateIds: ALL_HISTORY_IDS.slice(2) },
    { maxUpdates: 100, expectedUpdateIds: ALL_HISTORY_IDS },
  ])(
    "EVT-11 / WINDOW_ZERO / WINDOW_BINDING applies maxUpdates=$maxUpdates",
    async ({ maxUpdates, expectedUpdateIds }) => {
      await withDatabasePath((databasePath) => {
        const database = openDatabase(databasePath);

        try {
          initializeDatabase(database);
          seedEvent(database, {
            id: EVENT_WINDOW,
            title: "Window Event",
            entityName: "Window Entity",
            subject: "Window Subject",
            scope: "Window Scope",
            description: "Window Description",
          });
          seedWindowUpdates(database, EVENT_WINDOW);
          const probe = instrumentDatabase(database);

          const candidates = loadEventCandidateContexts(
            probe.database,
            [candidateHit(EVENT_WINDOW)],
            maxUpdates,
          );

          expect(candidates).toHaveLength(1);
          expect(candidates[0]?.id).toBe(EVENT_WINDOW);
          expect(candidates[0]?.updates.map(({ id }) => id)).toEqual(
            expectedUpdateIds,
          );
          if (expectedUpdateIds.length > 0) {
            expect(candidates[0]?.updates.at(-1)).toMatchObject({
              id: "update-12",
              occurred_at: null,
            });
          }
          expect(probe.state.transactionCalls).toBe(0);
          expect(statementCalls(probe, "events")).toHaveLength(1);

          if (maxUpdates === 0) {
            expect(preparedStatements(probe, "event_updates")).toEqual([]);
            expect(statementCalls(probe, "event_updates")).toEqual([]);
            expect(candidates[0]?.updates).toEqual([]);
          } else {
            const updateStatements = statementCalls(probe, "event_updates");
            expect(updateStatements).toHaveLength(1);
            expect(updateStatements[0]?.parameters).toEqual([
              EVENT_WINDOW,
              maxUpdates,
            ]);
            expect(normalizeSql(updateStatements[0]?.sql ?? "")).toContain(
              "WHERE event_id = ? ORDER BY discovered_at DESC, id DESC LIMIT ?",
            );
          }
        } finally {
          closeDatabase(database);
        }
      });
    },
  );

  it("CONTEXT_SHAPE returns exact public Event and Update fields with null preservation", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, {
          id: EVENT_WINDOW,
          title: "Exact Event Title",
          entityName: "Exact Entity",
          subject: "Exact Subject",
          scope: "Exact Scope",
          description: "Exact Description",
          occurredAt: null,
          discoveredAt: "2026-11-18T08:00:00.000+08:00",
        });
        seedUpdate(database, "update-shape", EVENT_WINDOW, 12);
        const probe = instrumentDatabase(database);

        const [candidate] = loadEventCandidateContexts(
          probe.database,
          [candidateHit(EVENT_WINDOW)],
          1,
        );

        expect(candidate).toEqual({
          id: EVENT_WINDOW,
          title: "Exact Event Title",
          entity_name: "Exact Entity",
          subject: "Exact Subject",
          scope: "Exact Scope",
          description: "Exact Description",
          occurred_at: null,
          discovered_at: "2026-11-18T08:00:00.000+08:00",
          updates: [
            {
              id: "update-shape",
              event_id: EVENT_WINDOW,
              title: "update-shape title",
              description: "update-shape description",
              occurred_at: null,
              discovered_at: "2026-11-18T12:00:00.000+08:00",
            },
          ],
        });
        expect(Object.keys(candidate ?? {}).sort()).toEqual([
          "description",
          "discovered_at",
          "entity_name",
          "id",
          "occurred_at",
          "scope",
          "subject",
          "title",
          "updates",
        ]);
        expect(Object.keys(candidate?.updates[0] ?? {}).sort()).toEqual([
          "description",
          "discovered_at",
          "event_id",
          "id",
          "occurred_at",
          "title",
        ]);
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("EVT-10 / OLD_EVENT loads old Event context without a time filter", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, {
          id: "event-2016",
          discoveredAt: "2016-01-10T08:00:00.000+08:00",
        });
        const probe = instrumentDatabase(database);

        const candidates = loadEventCandidateContexts(
          probe.database,
          [candidateHit("event-2016")],
          0,
        );

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
          id: "event-2016",
          discovered_at: "2016-01-10T08:00:00.000+08:00",
          updates: [],
        });
        expect(statementCalls(probe, "events")[0]?.parameters).toEqual([
          "event-2016",
        ]);
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("EVT-23 keeps an old-clue hit but does not add an Update outside the configured window", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, { id: EVENT_WINDOW });
        seedWindowUpdates(database, EVENT_WINDOW);
        const oldClueHit = candidateHit(
          EVENT_WINDOW,
          clueEvidence(0, ["old update clue"]),
        );
        const probe = instrumentDatabase(database);

        const candidates = loadEventCandidateContexts(
          probe.database,
          [oldClueHit],
          10,
        );
        const updateIds = candidates[0]?.updates.map(({ id }) => id) ?? [];

        expect(oldClueHit.eventId).toBe(EVENT_WINDOW);
        expect(oldClueHit.clueEvidence[0]?.ftsMatchedTerms).toEqual([
          "old update clue",
        ]);
        expect(updateIds).toEqual(ALL_HISTORY_IDS.slice(2));
        expect(updateIds).not.toContain("update-01");
        expect(updateIds).not.toContain("update-02");
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("EVT-24 isolates Updates by event_id and keeps candidate order independent of maxUpdates", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, { id: EVENT_ALPHA });
        seedEvent(database, { id: EVENT_BETA });
        seedUpdate(database, "alpha-update", EVENT_ALPHA, 1);
        seedUpdate(database, "beta-update", EVENT_BETA, 12);
        const sharedAliasEvidence = (clueIndex: number) =>
          clueEvidence(clueIndex, ["shared alias"], false, true);
        const rankedHits = [
          candidateHit(EVENT_BETA, sharedAliasEvidence(0)),
          candidateHit(EVENT_ALPHA, sharedAliasEvidence(1)),
        ];
        const probe = instrumentDatabase(database);

        const withoutUpdates = loadEventCandidateContexts(
          probe.database,
          rankedHits,
          0,
        );
        const withUpdates = loadEventCandidateContexts(
          probe.database,
          rankedHits,
          100,
        );

        expect(withoutUpdates.map(({ id }) => id)).toEqual([
          EVENT_BETA,
          EVENT_ALPHA,
        ]);
        expect(withUpdates.map(({ id }) => id)).toEqual([
          EVENT_BETA,
          EVENT_ALPHA,
        ]);
        expect(withUpdates[0]?.updates.map(({ id }) => id)).toEqual([
          "beta-update",
        ]);
        expect(withUpdates[1]?.updates.map(({ id }) => id)).toEqual([
          "alpha-update",
        ]);
        expect(withUpdates[0]?.updates[0]?.event_id).toBe(EVENT_BETA);
        expect(withUpdates[1]?.updates[0]?.event_id).toBe(EVENT_ALPHA);

        const updateParameters = statementCalls(probe, "event_updates").map(
          ({ parameters }) => parameters,
        );
        expect(updateParameters).toEqual([
          [EVENT_BETA, 100],
          [EVENT_ALPHA, 100],
        ]);
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("READ_ONLY / NO_MATCHES leaves all tables unchanged, opens no transaction, and uses zero SQL for empty hits", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, { id: EVENT_WINDOW });
        seedWindowUpdates(database, EVENT_WINDOW);
        const before = snapshotDatabase(database);
        const probe = instrumentDatabase(database);

        const candidates = loadEventCandidateContexts(
          probe.database,
          [candidateHit(EVENT_WINDOW)],
          0,
        );

        expect(candidates).toHaveLength(1);
        expect(snapshotDatabase(database)).toEqual(before);
        expect(probe.state.transactionCalls).toBe(0);

        const emptyProbe = instrumentDatabase(database);
        expect(
          loadEventCandidateContexts(emptyProbe.database, [], 100),
        ).toEqual([]);
        expect(emptyProbe.preparedSql).toEqual([]);
        expect(emptyProbe.calls).toEqual([]);
        expect(emptyProbe.state.transactionCalls).toBe(0);
        expect(snapshotDatabase(database)).toEqual(before);
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("MISSING_EVENT skips an absent candidate without creating a replacement object", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        const probe = instrumentDatabase(database);

        const candidates = loadEventCandidateContexts(
          probe.database,
          [candidateHit("event-missing")],
          100,
        );

        expect(candidates).toEqual([]);
        expect(statementCalls(probe, "events")).toHaveLength(1);
        expect(statementCalls(probe, "event_updates")).toEqual([]);
        expect(probe.state.transactionCalls).toBe(0);
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("SQL_BINDING keeps Event IDs and the Update window as parameters", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        const hostileEventId = "event' OR 1=1 --";
        seedEvent(database, { id: hostileEventId });
        seedUpdate(database, "hostile-update", hostileEventId, 1);
        const probe = instrumentDatabase(database);

        const candidates = loadEventCandidateContexts(
          probe.database,
          [candidateHit(hostileEventId)],
          1,
        );

        expect(candidates[0]?.id).toBe(hostileEventId);
        expect(candidates[0]?.updates.map(({ id }) => id)).toEqual([
          "hostile-update",
        ]);

        const eventStatement = statementCalls(probe, "events")[0];
        const updateStatement = statementCalls(probe, "event_updates")[0];
        expect(eventStatement?.parameters).toEqual([hostileEventId]);
        expect(updateStatement?.parameters).toEqual([hostileEventId, 1]);
        expect(eventStatement?.sql).not.toContain(hostileEventId);
        expect(updateStatement?.sql).not.toContain(hostileEventId);
        expect(updateStatement?.sql).not.toContain("LIMIT 1");
        expect(normalizeSql(updateStatement?.sql ?? "")).toContain(
          "WHERE event_id = ? ORDER BY discovered_at DESC, id DESC LIMIT ?",
        );
      } finally {
        closeDatabase(database);
      }
    });
  });

  it("ABORT before SQL and after Event/Update reads throws aborted and stops further reads", async () => {
    await withDatabasePath((databasePath) => {
      const database = openDatabase(databasePath);

      try {
        initializeDatabase(database);
        seedEvent(database, { id: EVENT_WINDOW });
        seedWindowUpdates(database, EVENT_WINDOW);

        const preAborted = new AbortController();
        preAborted.abort();
        const preAbortProbe = instrumentDatabase(database);
        expectAborted(() =>
          loadEventCandidateContexts(
            preAbortProbe.database,
            [candidateHit(EVENT_WINDOW)],
            10,
            preAborted.signal,
          ),
        );
        expect(preAbortProbe.preparedSql).toEqual([]);
        expect(preAbortProbe.calls).toEqual([]);

        const eventController = new AbortController();
        const eventProbe = instrumentDatabase(database, {
          afterStatementCall({ sql }) {
            if (normalizeSql(sql).includes("FROM events")) {
              eventController.abort();
            }
          },
        });
        expectAborted(() =>
          loadEventCandidateContexts(
            eventProbe.database,
            [candidateHit(EVENT_WINDOW)],
            10,
            eventController.signal,
          ),
        );
        expect(statementCalls(eventProbe, "event_updates")).toEqual([]);

        const updateController = new AbortController();
        const updateProbe = instrumentDatabase(database, {
          afterStatementCall({ sql }) {
            if (normalizeSql(sql).includes("FROM event_updates")) {
              updateController.abort();
            }
          },
        });
        expectAborted(() =>
          loadEventCandidateContexts(
            updateProbe.database,
            [candidateHit(EVENT_WINDOW)],
            10,
            updateController.signal,
          ),
        );
        expect(statementCalls(updateProbe, "event_updates")).toHaveLength(1);
      } finally {
        closeDatabase(database);
      }
    });
  });
});
