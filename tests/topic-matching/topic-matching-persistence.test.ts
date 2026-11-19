import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Topic } from "../../src/configuration/contracts.js";
import { withTransaction } from "../../src/database/transaction.js";
import { formatTimestamp } from "../../src/time/format-time.js";
import { SqlitePublishedItemRepository } from "../../src/topic-matching/published-item-repository.js";
import { SqliteTopicAssociationRepository } from "../../src/topic-matching/topic-association-repository.js";
import {
  TOPIC_MATCHING_ERROR_MESSAGES,
  TopicMatchingError,
} from "../../src/topic-matching/topic-matching-errors.js";
import {
  persistTopicAssociations,
  type TopicMatchingPersistenceDependencies,
  type TopicMatchingPersistenceInput,
} from "../../src/topic-matching/topic-matching-persistence.js";
import { SqliteTopicMatchingTargetRepository } from "../../src/topic-matching/topic-matching-target-repository.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import {
  TOPIC_MATCHING_BUSINESS_TABLES,
  createTopicMatchingEnabledTopics,
  insertStoredEvent,
  insertStoredEventUpdate,
  insertStoredKnowledge,
  insertStoredPublishedItem,
  insertStoredTopic,
  insertStoredTopicAssociation,
  insertTopicMatchingContent,
  listStoredTopicAssociations,
  snapshotTopicMatchingRows,
  topicMatchingEventRow,
  topicMatchingFixtureIds,
  topicMatchingKnowledgeRow,
  topicMatchingTopicIds,
  topicMatchingUpdateRow,
  withTopicMatchingDatabase,
} from "../fixtures/topic-matching.js";

vi.mock("../../src/time/format-time.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/time/format-time.js")>();
  return { ...actual, formatTimestamp: vi.fn(actual.formatTimestamp) };
});

const formatTimestampMock = vi.mocked(formatTimestamp);

const FIXED_NOW = new Date("2026-11-19T03:05:06.789Z");
const EXPECTED_MATCHED_AT = "2026-11-19T11:05:06.789+08:00";
const ALPHA = topicMatchingTopicIds.alpha;
const ZULU = topicMatchingTopicIds.zulu;
const DISABLED = topicMatchingTopicIds.disabled;

const INSERT_FAILURE = new Error("injected topic association insert failure");
const READBACK_FAILURE = new Error(
  "injected topic association readback failure",
);

type TopicMatchingSnapshot = ReturnType<typeof snapshotTopicMatchingRows>;

class CountingClock extends FakeClock {
  calls = 0;

  override now(): Date {
    this.calls += 1;
    return super.now();
  }
}

function insertTopics(db: Database.Database, topics: readonly Topic[]): void {
  for (const topic of topics) {
    insertStoredTopic(db, {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      enabled: topic.enabled ? 1 : 0,
    });
  }
}

function seedAllTargets(db: Database.Database): void {
  insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
  insertStoredEvent(db);
  insertStoredEventUpdate(db);
  insertStoredKnowledge(db);
}

function createDependencies(
  database: Database.Database,
  clock: CountingClock,
): TopicMatchingPersistenceDependencies {
  return {
    database,
    targetRepository: new SqliteTopicMatchingTargetRepository(database),
    associationRepository: new SqliteTopicAssociationRepository(database),
    clock,
  };
}

function createInput(
  targetType: TopicMatchingPersistenceInput["targetType"],
  targetId: string,
  enabledTopicIds: readonly string[],
  matchedTopicIds: readonly string[],
): TopicMatchingPersistenceInput {
  return { targetType, targetId, enabledTopicIds, matchedTopicIds };
}

function expectOnlyAssociationsChanged(
  before: TopicMatchingSnapshot,
  after: TopicMatchingSnapshot,
): void {
  for (const table of TOPIC_MATCHING_BUSINESS_TABLES) {
    if (table !== "topic_associations") {
      expect(after[table]).toEqual(before[table]);
    }
  }
}

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

interface FaultPlan {
  readonly failInsertAt?: number;
  readonly failReadAt?: number;
}

function createFaultDatabase(
  db: Database.Database,
  plan: FaultPlan,
): Database.Database {
  let insertCount = 0;
  let readCount = 0;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          const sql = normalizeSql(source);

          if (sql.startsWith("INSERT INTO topic_associations")) {
            return new Proxy(statement, {
              get(statementTarget, statementProperty, statementReceiver) {
                if (statementProperty === "run") {
                  return (...parameters: unknown[]) => {
                    insertCount += 1;
                    if (insertCount === plan.failInsertAt) {
                      throw INSERT_FAILURE;
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
          }

          if (
            sql.startsWith(
              "SELECT topic_id, target_type, target_id, matched_at FROM topic_associations",
            )
          ) {
            return new Proxy(statement, {
              get(statementTarget, statementProperty, statementReceiver) {
                if (statementProperty === "get") {
                  return (...parameters: unknown[]) => {
                    readCount += 1;
                    if (readCount === plan.failReadAt) {
                      throw READBACK_FAILURE;
                    }

                    return statementTarget.get(...parameters);
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
          }

          return statement;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function observeImmediateTransactions(db: Database.Database): {
  database: Database.Database;
  immediateCount: () => number;
} {
  let count = 0;
  const observed = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (operation: () => unknown) => {
          const transaction = target.transaction(operation);
          return {
            immediate: () => {
              count += 1;
              return transaction.immediate();
            },
          };
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { database: observed, immediateCount: () => count };
}

beforeEach(() => {
  formatTimestampMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistTopicAssociations", () => {
  it("TOP-02_PERSIST writes two associations with one matched_at and one publish result", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, createTopicMatchingEnabledTopics());
      insertStoredEvent(db);
      insertStoredPublishedItem(db, {
        id: "topic-matching-published-existing",
        target_type: "KNOWLEDGE",
        target_id: topicMatchingKnowledgeRow.id,
        title: "Existing Published Title",
        summary: "Existing Published Summary",
        body: "Existing Published Body",
        published_at: EXPECTED_MATCHED_AT,
      });
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);
      const before = snapshotTopicMatchingRows(db);

      const result = persistTopicAssociations(
        dependencies,
        createInput(
          "EVENT",
          topicMatchingEventRow.id,
          [ALPHA, ZULU],
          [ALPHA, ZULU],
        ),
      );

      expect(result).toEqual({ should_publish: true });
      expect(Array.isArray(result)).toBe(false);
      expect(listStoredTopicAssociations(db)).toEqual([
        {
          topic_id: ALPHA,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
        {
          topic_id: ZULU,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
      ]);
      expect(clock.calls).toBe(1);
      expect(formatTimestampMock).toHaveBeenCalledTimes(1);

      const after = snapshotTopicMatchingRows(db);
      expectOnlyAssociationsChanged(before, after);
      expect(after.published_items).toEqual(before.published_items);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("SNAPSHOT_ORDER follows the enabledTopicIds input order and filters unmatched ids", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [
        ...createTopicMatchingEnabledTopics(),
        {
          id: DISABLED,
          name: "Synthetic Disabled Topic",
          description: "Synthetic Disabled Topic Description",
          enabled: false,
        },
      ]);
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);

      persistTopicAssociations(
        dependencies,
        createInput(
          "EVENT",
          topicMatchingEventRow.id,
          [ZULU, DISABLED, ALPHA],
          [ZULU, ALPHA],
        ),
      );

      expect(
        listStoredTopicAssociations(db).map(({ topic_id }) => topic_id),
      ).toEqual([ZULU, ALPHA]);
      expect(
        listStoredTopicAssociations(db).some(
          ({ topic_id }) => topic_id === DISABLED,
        ),
      ).toBe(false);
    });
  });

  it("TOP-10/16_PERSIST keeps the snapshot writable after disable and leaves existing rows untouched", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, createTopicMatchingEnabledTopics());
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);
      const enabledTopicIds = [ALPHA, ZULU];

      db.prepare(
        "UPDATE topics SET enabled = 0, name = ?, description = ? WHERE id = ?",
      ).run("Renamed Zulu", "Renamed Zulu Description", ZULU);

      const first = persistTopicAssociations(
        dependencies,
        createInput("EVENT", topicMatchingEventRow.id, enabledTopicIds, [
          ALPHA,
          ZULU,
        ]),
      );
      expect(first).toEqual({ should_publish: true });
      expect(listStoredTopicAssociations(db)).toEqual([
        {
          topic_id: ALPHA,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
        {
          topic_id: ZULU,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
      ]);
      expect(clock.calls).toBe(1);

      const rowsBeforeRepeat = listStoredTopicAssociations(db);
      clock.calls = 0;
      formatTimestampMock.mockClear();

      const second = persistTopicAssociations(
        dependencies,
        createInput("EVENT", topicMatchingEventRow.id, enabledTopicIds, [
          ALPHA,
          ZULU,
        ]),
      );

      expect(second).toEqual({ should_publish: true });
      expect(clock.calls).toBe(0);
      expect(formatTimestampMock).not.toHaveBeenCalled();
      expect(listStoredTopicAssociations(db)).toEqual(rowsBeforeRepeat);
    });
  });

  it("TARGET_RECHECK rechecks the target before associations and writes nothing", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [createTopicMatchingEnabledTopics()[0]]);
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);

      expect(
        dependencies.targetRepository.getTarget(
          "EVENT",
          topicMatchingEventRow.id,
        ),
      ).not.toBeNull();

      db.prepare("DELETE FROM events WHERE id = ?").run(
        topicMatchingEventRow.id,
      );
      const before = snapshotTopicMatchingRows(db);

      let observed: unknown;
      try {
        persistTopicAssociations(
          dependencies,
          createInput("EVENT", topicMatchingEventRow.id, [ALPHA], [ALPHA]),
        );
      } catch (error) {
        observed = error;
      }

      expect(observed).toBeInstanceOf(TopicMatchingError);
      expect(observed).toMatchObject({
        code: "target_not_found",
        message: TOPIC_MATCHING_ERROR_MESSAGES.target_not_found,
      });
      expect(clock.calls).toBe(0);
      expect(formatTimestampMock).not.toHaveBeenCalled();
      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(listStoredTopicAssociations(db)).toEqual([]);
      expect(db.inTransaction).toBe(false);

      const missingAssociation = {
        topic_id: ALPHA,
        target_type: "EVENT" as const,
        target_id: "topic-matching-event-missing",
        matched_at: EXPECTED_MATCHED_AT,
      };
      insertStoredTopicAssociation(db, missingAssociation);
      const beforeMissing = snapshotTopicMatchingRows(db);

      expect(() =>
        persistTopicAssociations(
          dependencies,
          createInput("EVENT", missingAssociation.target_id, [ALPHA], [ALPHA]),
        ),
      ).toThrow(TOPIC_MATCHING_ERROR_MESSAGES.target_not_found);
      expect(snapshotTopicMatchingRows(db)).toEqual(beforeMissing);
      expect(clock.calls).toBe(0);
      expect(formatTimestampMock).not.toHaveBeenCalled();
    });
  });

  it("CLOCK_ONCE calls clock and formatTimestamp once only for actual inserts", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [createTopicMatchingEnabledTopics()[0]]);
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);

      persistTopicAssociations(
        dependencies,
        createInput("EVENT", topicMatchingEventRow.id, [ALPHA], [ALPHA]),
      );

      expect(clock.calls).toBe(1);
      expect(formatTimestampMock).toHaveBeenCalledTimes(1);
      const rows = listStoredTopicAssociations(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.matched_at).toBe(EXPECTED_MATCHED_AT);

      clock.calls = 0;
      formatTimestampMock.mockClear();
      persistTopicAssociations(
        dependencies,
        createInput("EVENT", topicMatchingEventRow.id, [ALPHA], [ALPHA]),
      );

      expect(clock.calls).toBe(0);
      expect(formatTimestampMock).not.toHaveBeenCalled();
      expect(listStoredTopicAssociations(db)).toEqual(rows);
    });
  });

  it("TARGET_TYPES_PERSIST writes exact rows for EVENT_UPDATE and KNOWLEDGE", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [createTopicMatchingEnabledTopics()[1]]);
      seedAllTargets(db);
      const clock = new CountingClock(FIXED_NOW);
      const dependencies = createDependencies(db, clock);

      persistTopicAssociations(
        dependencies,
        createInput("EVENT_UPDATE", topicMatchingUpdateRow.id, [ZULU], [ZULU]),
      );
      persistTopicAssociations(
        dependencies,
        createInput("KNOWLEDGE", topicMatchingKnowledgeRow.id, [ZULU], [ZULU]),
      );

      expect(listStoredTopicAssociations(db)).toEqual([
        {
          topic_id: ZULU,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
        {
          topic_id: ZULU,
          target_type: "KNOWLEDGE",
          target_id: topicMatchingKnowledgeRow.id,
          matched_at: EXPECTED_MATCHED_AT,
        },
      ]);
    });
  });

  it("ROLLBACK rolls back the first row when the second insert fails", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, createTopicMatchingEnabledTopics());
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const faulty = createFaultDatabase(db, { failInsertAt: 2 });
      const dependencies = createDependencies(faulty, clock);
      const before = snapshotTopicMatchingRows(db);

      let observed: unknown;
      try {
        persistTopicAssociations(
          dependencies,
          createInput(
            "EVENT",
            topicMatchingEventRow.id,
            [ALPHA, ZULU],
            [ALPHA, ZULU],
          ),
        );
      } catch (error) {
        observed = error;
      }

      expect(observed).toBe(INSERT_FAILURE);
      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(listStoredTopicAssociations(db)).toEqual([]);
      expect(clock.calls).toBe(1);
      expect(formatTimestampMock).toHaveBeenCalledTimes(1);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("ROLLBACK rolls back every row when a readback fails", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, createTopicMatchingEnabledTopics());
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const faulty = createFaultDatabase(db, { failReadAt: 2 });
      const dependencies = createDependencies(faulty, clock);
      const before = snapshotTopicMatchingRows(db);

      let observed: unknown;
      try {
        persistTopicAssociations(
          dependencies,
          createInput(
            "EVENT",
            topicMatchingEventRow.id,
            [ALPHA, ZULU],
            [ALPHA, ZULU],
          ),
        );
      } catch (error) {
        observed = error;
      }

      expect(observed).toBe(READBACK_FAILURE);
      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(listStoredTopicAssociations(db)).toEqual([]);
      expect(clock.calls).toBe(1);
      expect(formatTimestampMock).toHaveBeenCalledTimes(1);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("SYNC_TRANSACTION uses one immediate D01 transaction, stays sync, and calls no fetch", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [createTopicMatchingEnabledTopics()[0]]);
      insertStoredEvent(db);
      const clock = new CountingClock(FIXED_NOW);
      const observed = observeImmediateTransactions(db);
      const dependencies = createDependencies(observed.database, clock);
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      expect(Object.keys(dependencies).sort()).toEqual([
        "associationRepository",
        "clock",
        "database",
        "targetRepository",
      ]);

      const result = persistTopicAssociations(
        dependencies,
        createInput("EVENT", topicMatchingEventRow.id, [ALPHA], [ALPHA]),
      );

      expect(observed.immediateCount()).toBe(1);
      expect(result).toEqual({ should_publish: true });
      expect(result).not.toBeInstanceOf(Promise);
      expect("then" in result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      const runTransaction = withTransaction as unknown as (
        database: Database.Database,
        operation: () => unknown,
      ) => unknown;
      const rowsBeforeThenable = listStoredTopicAssociations(db);
      expect(() =>
        runTransaction(db, () => {
          insertStoredTopicAssociation(db, {
            topic_id: ALPHA,
            target_type: "KNOWLEDGE",
            target_id: "topic-matching-thenable-target",
            matched_at: EXPECTED_MATCHED_AT,
          });
          return Promise.resolve(1);
        }),
      ).toThrow("withTransaction callback must not return a thenable");
      expect(listStoredTopicAssociations(db)).toEqual(rowsBeforeThenable);
    });
  });
});
