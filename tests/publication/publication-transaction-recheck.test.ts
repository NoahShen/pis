import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import {
  createPublicationP0Harness,
  flushPublicationTasks,
  publicationFixtureIds,
  publicationP0FixtureIds,
  readPublishedItemCount,
  readPublishedItems,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

function businessRowCounts(
  database: Parameters<typeof readPublishedItemCount>[0],
) {
  return {
    events: (
      database.prepare("SELECT COUNT(*) AS count FROM events").get() as {
        readonly count: number;
      }
    ).count,
    updates: (
      database.prepare("SELECT COUNT(*) AS count FROM event_updates").get() as {
        readonly count: number;
      }
    ).count,
    knowledge: (
      database.prepare("SELECT COUNT(*) AS count FROM knowledge").get() as {
        readonly count: number;
      }
    ).count,
    associations: (
      database
        .prepare("SELECT COUNT(*) AS count FROM topic_associations")
        .get() as { readonly count: number }
    ).count,
    published: readPublishedItemCount(database),
  };
}

describe("PUB-11 transaction target and association rechecks (P1)", () => {
  it("PUB-11_TARGET_REMOVED returns empty with zero clock, ID, insert, or notification", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      const before = businessRowCounts(database);
      harness.target.transactionContext = null;

      const result = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      await flushPublicationTasks();

      expect(result).toEqual({
        published_item_id: null,
        already_published: false,
      });
      expect(harness.target.contextTransactionStates).toEqual([false, true]);
      expect(harness.target.associationTransactionStates).toEqual([false]);
      expect(harness.published.findCalls).toBe(2);
      expect(harness.published.insertCalls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(harness.notifier.calls).toBe(0);
      expect(businessRowCounts(database)).toEqual(before);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("PUB-11_ASSOC_REMOVED returns empty with zero clock, ID, insert, or notification", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      const before = businessRowCounts(database);
      harness.target.transactionAssociation = false;

      const result = await harness.service.publish(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      await flushPublicationTasks();

      expect(result).toEqual({
        published_item_id: null,
        already_published: false,
      });
      expect(harness.target.contextTransactionStates).toEqual([false, true]);
      expect(harness.target.associationTransactionStates).toEqual([
        false,
        true,
      ]);
      expect(harness.published.insertCalls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(harness.notifier.calls).toBe(0);
      expect(businessRowCounts(database)).toEqual(before);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("PUB-11_EXISTING_RACE returns the winner ID/true without a second insert", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const winner = {
        id: "publication-transaction-winner",
        target_type: "EVENT" as const,
        target_id: publicationFixtureIds.event,
        title: "Synthetic race winner title",
        summary: "Synthetic race winner summary",
        body: "<section><p>Synthetic race winner body</p></section>",
        published_at: "2026-11-20T12:00:00.000+08:00",
      };
      withTransaction(database, () => {
        new SqlitePublishedItemRepository(database).insert(winner);
      });
      const harness = createPublicationP0Harness(database);
      harness.published.externalFindResult = null;

      const result = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      await flushPublicationTasks();

      expect(result).toEqual({
        published_item_id: winner.id,
        already_published: true,
      });
      expect(harness.published.findCalls).toBe(2);
      expect(harness.published.insertCalls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(harness.notifier.calls).toBe(0);
      expect(readPublishedItemCount(database)).toBe(1);
      expect(readPublishedItems(database)).toEqual([winner]);
    });
  });

  it("TX_RECHECK_ORDER runs find, context, association, clock, ID, timestamp, insert synchronously", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database, {
        ids: [publicationP0FixtureIds[0]],
      });

      await harness.service.publish("EVENT", publicationFixtureIds.event);
      await harness.notifier.waitForCalls(1);

      expect(harness.trace).toEqual([
        "find",
        "context",
        "association",
        "find",
        "context",
        "association",
        "clock",
        "id",
        "insert",
      ]);

      const source = await readFile(
        new URL("../../src/publication/publication.ts", import.meta.url),
        "utf8",
      );
      const start = source.indexOf("outcome = withTransaction");
      const end = source.indexOf("} catch (error)", start);
      const transactionBody = source.slice(start, end);
      const positions = [
        "findByTarget",
        "getContext",
        "hasAnyTopicAssociation",
        "clock.now",
        "idGenerator.next",
        "formatTimestamp",
        "publishedItemRepository.insert",
      ].map((token) => transactionBody.indexOf(token));

      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual(
        [...positions].sort((left, right) => left - right),
      );
      expect(transactionBody.match(/formatTimestamp\(/g)).toHaveLength(1);
      expect(transactionBody).not.toMatch(
        /\bawait\b|renderer|sourceLinkRepository|notify\(|logPublication/,
      );
      expect(database.inTransaction).toBe(false);
    });
  });
});
