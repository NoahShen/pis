import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type {
  EventTopicTarget,
  EventUpdateTopicTarget,
  KnowledgeTopicTarget,
  TopicMatchingTarget,
} from "../../src/topic-matching/contracts.js";
import { SqliteTopicMatchingTargetRepository } from "../../src/topic-matching/topic-matching-target-repository.js";
import {
  insertStoredEvent,
  insertStoredEventUpdate,
  insertStoredKnowledge,
  insertStoredTopic,
  insertTopicMatchingContent,
  readTopicMatchingKnowledgeRow,
  snapshotTopicMatchingRows,
  topicMatchingEventRow,
  topicMatchingFixtureIds,
  topicMatchingKnowledgeRow,
  topicMatchingUpdateRow,
  withTopicMatchingDatabase,
} from "../fixtures/topic-matching.js";

const EVENT_DTO_KEYS = [
  "description",
  "entity_name",
  "id",
  "occurred_at",
  "scope",
  "subject",
  "target_type",
  "title",
].sort();
const UPDATE_DTO_KEYS = [
  "description",
  "event",
  "event_id",
  "id",
  "occurred_at",
  "target_type",
  "title",
].sort();
const KNOWLEDGE_DTO_KEYS = [
  "category",
  "findings",
  "id",
  "summary",
  "target_type",
  "title",
  "value",
].sort();

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function asEventTarget(target: TopicMatchingTarget | null): EventTopicTarget {
  if (target === null || target.target_type !== "EVENT") {
    throw new Error("Expected an EVENT target");
  }

  return target;
}

function asUpdateTarget(
  target: TopicMatchingTarget | null,
): EventUpdateTopicTarget {
  if (target === null || target.target_type !== "EVENT_UPDATE") {
    throw new Error("Expected an EVENT_UPDATE target");
  }

  return target;
}

function asKnowledgeTarget(
  target: TopicMatchingTarget | null,
): KnowledgeTopicTarget {
  if (target === null || target.target_type !== "KNOWLEDGE") {
    throw new Error("Expected a KNOWLEDGE target");
  }

  return target;
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

function insertRawKnowledge(
  db: Database.Database,
  id: string,
  contentId: string,
  findingsJson: string,
  category: string | null,
): void {
  db.prepare(
    `
      INSERT INTO knowledge (
        id, content_id, title, summary, category, findings_json, value
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    contentId,
    "Raw knowledge title",
    "Raw knowledge summary",
    category,
    findingsJson,
    "Raw knowledge value",
  );
}

describe("SqliteTopicMatchingTargetRepository", () => {
  it("EVENT_DTO returns the minimal Event projection and null for a missing id", async () => {
    await withTopicMatchingDatabase((db) => {
      insertStoredEvent(db);
      const repository = new SqliteTopicMatchingTargetRepository(db);

      const event = asEventTarget(
        repository.getTarget("EVENT", topicMatchingEventRow.id),
      );

      expect(event).toEqual<EventTopicTarget>({
        target_type: "EVENT",
        id: topicMatchingEventRow.id,
        title: topicMatchingEventRow.title,
        entity_name: topicMatchingEventRow.entity_name,
        subject: topicMatchingEventRow.subject,
        scope: topicMatchingEventRow.scope,
        description: topicMatchingEventRow.description,
        occurred_at: topicMatchingEventRow.occurred_at,
      });
      expect(sortedKeys(event)).toEqual(EVENT_DTO_KEYS);
      expect(event).not.toHaveProperty("discovered_at");
      expect(repository.getTarget("EVENT", "event-does-not-exist")).toBeNull();
    });
  });

  it("EVENT_DTO maps SQL NULL and string occurred_at exactly", async () => {
    await withTopicMatchingDatabase((db) => {
      const repository = new SqliteTopicMatchingTargetRepository(db);
      const nullOccurredAt = {
        ...topicMatchingEventRow,
        id: "topic-matching-event-null-occurred-at",
        occurred_at: null,
      };
      const stringOccurredAt = {
        ...topicMatchingEventRow,
        id: "topic-matching-event-string-occurred-at",
        occurred_at: "2026-11-18T10:00:00.000+08:00",
      };
      insertStoredEvent(db, nullOccurredAt);
      insertStoredEvent(db, stringOccurredAt);

      expect(
        asEventTarget(repository.getTarget("EVENT", nullOccurredAt.id))
          .occurred_at,
      ).toBeNull();
      expect(
        asEventTarget(repository.getTarget("EVENT", stringOccurredAt.id))
          .occurred_at,
      ).toBe("2026-11-18T10:00:00.000+08:00");
    });
  });

  it("EVENT_UPDATE_DTO returns the current Update plus parent Event background only", async () => {
    await withTopicMatchingDatabase((db) => {
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      const repository = new SqliteTopicMatchingTargetRepository(db);

      const update = asUpdateTarget(
        repository.getTarget("EVENT_UPDATE", topicMatchingUpdateRow.id),
      );

      expect(update).toEqual<EventUpdateTopicTarget>({
        target_type: "EVENT_UPDATE",
        id: topicMatchingUpdateRow.id,
        event_id: topicMatchingUpdateRow.event_id,
        title: topicMatchingUpdateRow.title,
        description: topicMatchingUpdateRow.description,
        occurred_at: topicMatchingUpdateRow.occurred_at,
        event: {
          id: topicMatchingEventRow.id,
          title: topicMatchingEventRow.title,
          entity_name: topicMatchingEventRow.entity_name,
          subject: topicMatchingEventRow.subject,
          scope: topicMatchingEventRow.scope,
          description: topicMatchingEventRow.description,
        },
      });
      expect(sortedKeys(update)).toEqual(UPDATE_DTO_KEYS);
      expect(sortedKeys(update.event)).toEqual(
        [
          "description",
          "entity_name",
          "id",
          "scope",
          "subject",
          "title",
        ].sort(),
      );
      expect(update).not.toHaveProperty("discovered_at");
      expect(update).not.toHaveProperty("updates");
      expect(
        repository.getTarget("EVENT_UPDATE", "update-does-not-exist"),
      ).toBeNull();
    });
  });

  it("TOP-08/09_CONTEXT keeps Update DTO independent of parent associations and history Updates", async () => {
    await withTopicMatchingDatabase((db) => {
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      insertStoredTopic(db);
      insertStoredEventUpdate(db, {
        ...topicMatchingUpdateRow,
        id: "topic-matching-update-history",
        discovered_at: "2026-11-19T09:00:00.000+08:00",
      });
      db.prepare(
        `
          INSERT INTO topic_associations (
            topic_id, target_type, target_id, matched_at
          ) VALUES (?, ?, ?, ?)
        `,
      ).run(
        topicMatchingFixtureIds.topic,
        "EVENT",
        topicMatchingEventRow.id,
        "2026-11-19T01:00:00.000+08:00",
      );

      const repository = new SqliteTopicMatchingTargetRepository(db);
      const update = asUpdateTarget(
        repository.getTarget("EVENT_UPDATE", topicMatchingUpdateRow.id),
      );

      expect(update).toEqual<EventUpdateTopicTarget>({
        target_type: "EVENT_UPDATE",
        id: topicMatchingUpdateRow.id,
        event_id: topicMatchingUpdateRow.event_id,
        title: topicMatchingUpdateRow.title,
        description: topicMatchingUpdateRow.description,
        occurred_at: topicMatchingUpdateRow.occurred_at,
        event: {
          id: topicMatchingEventRow.id,
          title: topicMatchingEventRow.title,
          entity_name: topicMatchingEventRow.entity_name,
          subject: topicMatchingEventRow.subject,
          scope: topicMatchingEventRow.scope,
          description: topicMatchingEventRow.description,
        },
      });
      expect(update).not.toHaveProperty("associations");
      expect(update).not.toHaveProperty("updates");
      expect(update.event).not.toHaveProperty("discovered_at");
    });
  });

  it("KNOWLEDGE_DTO projects Title, Summary, Category, Findings and Value", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      insertStoredKnowledge(db);
      const repository = new SqliteTopicMatchingTargetRepository(db);

      const knowledge = asKnowledgeTarget(
        repository.getTarget("KNOWLEDGE", topicMatchingKnowledgeRow.id),
      );

      expect(knowledge).toEqual<KnowledgeTopicTarget>({
        target_type: "KNOWLEDGE",
        id: topicMatchingKnowledgeRow.id,
        title: topicMatchingKnowledgeRow.title,
        summary: topicMatchingKnowledgeRow.summary,
        category: "Insight",
        findings: [
          {
            title: "Synthetic Finding One",
            description: "Finding one description",
          },
          {
            title: "Synthetic Finding Two",
            description: "Finding two description",
          },
        ],
        value: topicMatchingKnowledgeRow.value,
      });
      expect(sortedKeys(knowledge)).toEqual(KNOWLEDGE_DTO_KEYS);
      for (const finding of knowledge.findings) {
        expect(sortedKeys(finding)).toEqual(["description", "title"]);
      }
      expect(knowledge).not.toHaveProperty("content_id");
      expect(
        repository.getTarget("KNOWLEDGE", "knowledge-does-not-exist"),
      ).toBeNull();
    });
  });

  it("KNOWLEDGE_CATEGORY_NULL maps SQL NULL to null", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      insertStoredKnowledge(db, {
        ...topicMatchingKnowledgeRow,
        category: null,
      });
      const repository = new SqliteTopicMatchingTargetRepository(db);

      const knowledge = asKnowledgeTarget(
        repository.getTarget("KNOWLEDGE", topicMatchingKnowledgeRow.id),
      );

      expect(knowledge.category).toBeNull();
    });
  });

  it("EXPLICIT_PROJECTION strips extra database fields and extra findings JSON keys", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      insertStoredEvent(db);
      const projectionId = "topic-matching-knowledge-projection";
      insertRawKnowledge(
        db,
        projectionId,
        topicMatchingFixtureIds.content,
        '[{"title":"Projection finding","description":"Projection description","extra":"strip-me","nested":{"a":1}}]',
        "Insight",
      );

      const repository = new SqliteTopicMatchingTargetRepository(db);
      const event = asEventTarget(
        repository.getTarget("EVENT", topicMatchingEventRow.id),
      );
      const knowledge = asKnowledgeTarget(
        repository.getTarget("KNOWLEDGE", projectionId),
      );

      const rawRow = readTopicMatchingKnowledgeRow(db, projectionId);
      expect(rawRow?.content_id).toBe(topicMatchingFixtureIds.content);
      expect(JSON.parse(rawRow?.findings_json ?? "[]")[0]).toHaveProperty(
        "extra",
      );
      expect(knowledge.findings).toEqual([
        { title: "Projection finding", description: "Projection description" },
      ]);
      expect(knowledge.findings[0]).not.toHaveProperty("extra");
      expect(knowledge.findings[0]).not.toHaveProperty("nested");
      expect(knowledge).not.toHaveProperty("content_id");
      expect(event).not.toHaveProperty("discovered_at");
    });
  });

  it("TOP-15_NOT_FOUND returns null for all three target types without writes", async () => {
    await withTopicMatchingDatabase((db) => {
      const repository = new SqliteTopicMatchingTargetRepository(db);
      const before = snapshotTopicMatchingRows(db);

      expect(repository.getTarget("EVENT", "missing-event")).toBeNull();
      expect(repository.getTarget("EVENT_UPDATE", "missing-update")).toBeNull();
      expect(repository.getTarget("KNOWLEDGE", "missing-knowledge")).toBeNull();

      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("MALFORMED_KNOWLEDGE throws instead of returning a partial DTO", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      const missingDescriptionId =
        "topic-matching-knowledge-missing-description";
      const nonObjectElementId = "topic-matching-knowledge-non-object-element";
      const missingDescriptionContent =
        "topic-matching-content-missing-description";
      const nonObjectElementContent =
        "topic-matching-content-non-object-element";
      insertTopicMatchingContent(db, missingDescriptionContent);
      insertTopicMatchingContent(db, nonObjectElementContent);
      insertRawKnowledge(
        db,
        missingDescriptionId,
        missingDescriptionContent,
        '[{"title":"Only title"}]',
        "Insight",
      );
      insertRawKnowledge(
        db,
        nonObjectElementId,
        nonObjectElementContent,
        '["not-an-object"]',
        "Insight",
      );
      const repository = new SqliteTopicMatchingTargetRepository(db);

      expect(() =>
        repository.getTarget("KNOWLEDGE", missingDescriptionId),
      ).toThrow("Malformed Knowledge findings JSON");
      expect(() =>
        repository.getTarget("KNOWLEDGE", nonObjectElementId),
      ).toThrow("Malformed Knowledge findings JSON");
    });
  });

  it("MALFORMED_CATEGORY throws instead of returning a partial DTO", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      const badCategoryId = "topic-matching-knowledge-bad-category";
      db.pragma("ignore_check_constraints = ON");
      insertRawKnowledge(
        db,
        badCategoryId,
        topicMatchingFixtureIds.content,
        "[]",
        "",
      );
      const repository = new SqliteTopicMatchingTargetRepository(db);

      expect(() => repository.getTarget("KNOWLEDGE", badCategoryId)).toThrow(
        "Malformed Knowledge target category",
      );
    });
  });

  it("READ_ONLY repository issues no writes and leaves every business table unchanged", async () => {
    await withTopicMatchingDatabase((db) => {
      insertTopicMatchingContent(db, topicMatchingFixtureIds.content);
      insertStoredEvent(db);
      insertStoredEventUpdate(db);
      insertStoredKnowledge(db);
      const before = snapshotTopicMatchingRows(db);
      const observed = observePreparedSql(db);
      const repository = new SqliteTopicMatchingTargetRepository(
        observed.database,
      );

      repository.getTarget("EVENT", topicMatchingEventRow.id);
      repository.getTarget("EVENT_UPDATE", topicMatchingUpdateRow.id);
      repository.getTarget("KNOWLEDGE", topicMatchingKnowledgeRow.id);

      for (const sql of observed.preparedSql) {
        expect(sql).toMatch(/^SELECT/i);
      }
      expect(observed.preparedSql.some((sql) => sql.includes("SELECT *"))).toBe(
        false,
      );
      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(db.inTransaction).toBe(false);
    });
  });
});
