import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";
import {
  SqliteTopicAssociationRepository,
  type TopicAssociation,
  type TopicAssociationInsertResult,
  type TopicAssociationRepository,
} from "../../src/topic-matching/topic-association-repository.js";
import {
  insertStoredEvent,
  insertStoredEventUpdate,
  insertStoredKnowledge,
  insertStoredTopic,
  insertTopicMatchingContent,
  listStoredTopicAssociations,
  topicMatchingEventRow,
  topicMatchingFixtureIds,
  topicMatchingKnowledgeRow,
  topicMatchingUpdateRow,
  withTopicMatchingDatabase,
} from "../fixtures/topic-matching.js";

const TOPIC_A = "topic-association-roundtrip-a";
const TOPIC_B = "topic-association-roundtrip-b";
const MATCHED_AT_A = "2026-11-19T10:00:00.000+08:00";
const MATCHED_AT_B = "2026-11-19T11:00:00.000+08:00";

function insertTopics(db: Database.Database, ids: readonly string[]): void {
  for (const id of ids) {
    insertStoredTopic(db, {
      id,
      name: `Synthetic Topic ${id}`,
      description: `Synthetic Topic Description ${id}`,
      enabled: 1,
    });
  }
}

function seedAllTargetTypes(db: Database.Database): void {
  insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
  insertStoredEvent(db);
  insertStoredEventUpdate(db);
  insertStoredKnowledge(db);
}

function insertAssociation(
  db: Database.Database,
  repository: TopicAssociationRepository,
  association: TopicAssociation,
): TopicAssociationInsertResult {
  return withTransaction(db, () => repository.insertIfAbsent(association));
}

function observePreparedSql(db: Database.Database): {
  database: Database.Database;
  preparedSql: string[];
} {
  const preparedSql: string[] = [];
  const observed = new Proxy(db, {
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

  return { database: observed, preparedSql };
}

describe("SqliteTopicAssociationRepository", () => {
  it("ASSOCIATION_ROUNDTRIP round-trips all four fields across all three target types", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [TOPIC_A, TOPIC_B]);
      seedAllTargetTypes(db);
      const repository = new SqliteTopicAssociationRepository(db);

      const associations: readonly TopicAssociation[] = [
        {
          topic_id: TOPIC_A,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: MATCHED_AT_A,
        },
        {
          topic_id: TOPIC_B,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: MATCHED_AT_B,
        },
        {
          topic_id: TOPIC_A,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
          matched_at: MATCHED_AT_B,
        },
        {
          topic_id: TOPIC_B,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
          matched_at: MATCHED_AT_A,
        },
        {
          topic_id: TOPIC_A,
          target_type: "KNOWLEDGE",
          target_id: topicMatchingKnowledgeRow.id,
          matched_at: MATCHED_AT_A,
        },
        {
          topic_id: TOPIC_B,
          target_type: "KNOWLEDGE",
          target_id: topicMatchingKnowledgeRow.id,
          matched_at: MATCHED_AT_B,
        },
      ];

      for (const association of associations) {
        const result = insertAssociation(db, repository, association);
        expect(result.changes).toBe(1);
        expect(result.association).toEqual(association);
      }

      for (const association of associations) {
        expect(
          repository.get(
            association.topic_id,
            association.target_type,
            association.target_id,
          ),
        ).toEqual(association);
        expect(
          repository.existsForTarget(
            association.target_type,
            association.target_id,
          ),
        ).toBe(true);
      }

      expect(listStoredTopicAssociations(db)).toEqual(associations);
      expect(
        repository.get(TOPIC_A, "KNOWLEDGE", topicMatchingEventRow.id),
      ).toBeNull();
      expect(
        repository.existsForTarget("KNOWLEDGE", topicMatchingEventRow.id),
      ).toBe(false);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("ASSOCIATION_IDEMPOTENT keeps the original matched_at and isolates keys", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [TOPIC_A, TOPIC_B]);
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      insertStoredEvent(db);
      insertStoredKnowledge(db);
      const repository = new SqliteTopicAssociationRepository(db);

      const original: TopicAssociation = {
        topic_id: TOPIC_A,
        target_type: "EVENT",
        target_id: topicMatchingEventRow.id,
        matched_at: MATCHED_AT_A,
      };
      const conflicting: TopicAssociation = {
        ...original,
        matched_at: MATCHED_AT_B,
      };

      const [first, second] = withTransaction(db, () => [
        repository.insertIfAbsent(original),
        repository.insertIfAbsent(conflicting),
      ]);

      expect(first.changes).toBe(1);
      expect(first.association).toEqual(original);
      expect(second.changes).toBe(0);
      expect(second.association).toEqual(original);
      expect(listStoredTopicAssociations(db)).toEqual([original]);
      expect(
        repository.get(TOPIC_A, "EVENT", topicMatchingEventRow.id),
      ).toEqual(original);

      const otherTopic = insertAssociation(db, repository, {
        topic_id: TOPIC_B,
        target_type: "EVENT",
        target_id: topicMatchingEventRow.id,
        matched_at: MATCHED_AT_B,
      });
      const otherTarget = insertAssociation(db, repository, {
        topic_id: TOPIC_A,
        target_type: "KNOWLEDGE",
        target_id: topicMatchingKnowledgeRow.id,
        matched_at: MATCHED_AT_B,
      });

      expect(otherTopic.changes).toBe(1);
      expect(otherTarget.changes).toBe(1);
      expect(listStoredTopicAssociations(db)).toEqual([
        original,
        {
          topic_id: TOPIC_B,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: MATCHED_AT_B,
        },
        {
          topic_id: TOPIC_A,
          target_type: "KNOWLEDGE",
          target_id: topicMatchingKnowledgeRow.id,
          matched_at: MATCHED_AT_B,
        },
      ]);
    });
  });

  it("TRANSACTION_OUTSIDE rejects writes without an active transaction and preserves rows", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [TOPIC_A]);
      insertStoredEvent(db);
      const repository = new SqliteTopicAssociationRepository(db);
      const association: TopicAssociation = {
        topic_id: TOPIC_A,
        target_type: "EVENT",
        target_id: topicMatchingEventRow.id,
        matched_at: MATCHED_AT_A,
      };

      expect(() => repository.insertIfAbsent(association)).toThrow(
        "TopicAssociationRepository writes require an active transaction",
      );
      expect(listStoredTopicAssociations(db)).toEqual([]);

      insertAssociation(db, repository, association);

      expect(() =>
        repository.insertIfAbsent({
          ...association,
          matched_at: MATCHED_AT_B,
        }),
      ).toThrow(
        "TopicAssociationRepository writes require an active transaction",
      );
      expect(listStoredTopicAssociations(db)).toEqual([association]);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("EXPLICIT_SQL projects four columns and binds every value", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopics(db, [TOPIC_A]);
      insertStoredEvent(db);
      const observed = observePreparedSql(db);
      const repository = new SqliteTopicAssociationRepository(
        observed.database,
      );

      repository.existsForTarget("EVENT", topicMatchingEventRow.id);
      repository.get(TOPIC_A, "EVENT", topicMatchingEventRow.id);
      withTransaction(observed.database, () =>
        repository.insertIfAbsent({
          topic_id: TOPIC_A,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: MATCHED_AT_A,
        }),
      );

      const insertSql = observed.preparedSql.find((sql) =>
        sql.startsWith("INSERT INTO topic_associations"),
      );
      expect(insertSql).toBe(
        "INSERT INTO topic_associations (topic_id, target_type, target_id, matched_at) VALUES (?, ?, ?, ?) ON CONFLICT (topic_id, target_type, target_id) DO NOTHING",
      );

      for (const sql of observed.preparedSql) {
        expect(sql).not.toContain("SELECT *");
        expect(sql).not.toContain(TOPIC_A);
        expect(sql).not.toContain(topicMatchingEventRow.id);
      }

      expect(SqliteTopicAssociationRepository.length).toBe(1);
    });
  });
});
