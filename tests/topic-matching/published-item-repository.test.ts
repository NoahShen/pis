import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqlitePublishedItemRepository } from "../../src/topic-matching/published-item-repository.js";
import {
  insertStoredPublishedItem,
  snapshotTopicMatchingRows,
  topicMatchingEventRow,
  topicMatchingFixtureIds,
  topicMatchingKnowledgeRow,
  withTopicMatchingDatabase,
  type StoredPublishedItemRow,
} from "../fixtures/topic-matching.js";

const PUBLISHED_AT = "2026-11-19T10:00:00.000+08:00";

const eventPublishedItem: StoredPublishedItemRow = {
  id: "topic-matching-published-event",
  target_type: "EVENT",
  target_id: topicMatchingEventRow.id,
  title: "Published Event Title",
  summary: "Published Event Summary",
  body: "Published Event Body",
  published_at: PUBLISHED_AT,
};

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

describe("SqlitePublishedItemRepository", () => {
  it("PUBLISHED_EXISTS returns true only for the exact target", async () => {
    await withTopicMatchingDatabase((db) => {
      insertStoredPublishedItem(db, eventPublishedItem);
      insertStoredPublishedItem(db, {
        id: "topic-matching-published-knowledge",
        target_type: "KNOWLEDGE",
        target_id: topicMatchingKnowledgeRow.id,
        title: "Published Knowledge Title",
        summary: "Published Knowledge Summary",
        body: "Published Knowledge Body",
        published_at: PUBLISHED_AT,
      });

      const before = snapshotTopicMatchingRows(db);
      const repository = new SqlitePublishedItemRepository(db);

      expect(
        repository.existsForTarget("EVENT", topicMatchingEventRow.id),
      ).toBe(true);
      expect(
        repository.existsForTarget("KNOWLEDGE", topicMatchingKnowledgeRow.id),
      ).toBe(true);
      expect(
        repository.existsForTarget("EVENT_UPDATE", topicMatchingEventRow.id),
      ).toBe(false);
      expect(repository.existsForTarget("EVENT", "missing-target")).toBe(false);
      expect(
        repository.existsForTarget("EVENT", topicMatchingKnowledgeRow.id),
      ).toBe(false);

      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(db.inTransaction).toBe(false);
    });
  });

  it("READ_ONLY_PUBLISHED issues only a parameterized existence SELECT", async () => {
    await withTopicMatchingDatabase((db) => {
      insertStoredPublishedItem(db, eventPublishedItem);
      const before = snapshotTopicMatchingRows(db);
      const observed = observePreparedSql(db);
      const repository = new SqlitePublishedItemRepository(observed.database);

      expect(
        repository.existsForTarget("EVENT", topicMatchingEventRow.id),
      ).toBe(true);
      expect(
        repository.existsForTarget("EVENT", topicMatchingFixtureIds.update),
      ).toBe(false);

      expect(observed.preparedSql).toEqual([
        "SELECT 1 FROM published_items WHERE target_type = ? AND target_id = ? LIMIT 1",
        "SELECT 1 FROM published_items WHERE target_type = ? AND target_id = ? LIMIT 1",
      ]);
      for (const sql of observed.preparedSql) {
        expect(sql).not.toMatch(/\b(?:title|summary|body|published_at)\b/i);
        expect(sql).not.toMatch(/^SELECT \*/i);
      }

      expect(snapshotTopicMatchingRows(db)).toEqual(before);
      expect(SqlitePublishedItemRepository.length).toBe(1);
    });
  });
});
