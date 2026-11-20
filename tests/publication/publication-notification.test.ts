import { describe, expect, it } from "vitest";

import type { PublicationLogEntry } from "../../src/publication/contracts.js";
import {
  createPublicationP0Harness,
  flushPublicationTasks,
  publicationFixtureIds,
  readPublishedItemCount,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

describe("COMMIT-after publication notification", () => {
  it("NOTIFY_AFTER_COMMIT notifies created Event/Update/Knowledge once with COMMIT-time feeds", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database, {
        ids: [
          "publication-notice-event",
          "publication-notice-update",
          "publication-notice-knowledge",
        ],
      });

      const event = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      const update = await harness.service.publish(
        "EVENT_UPDATE",
        publicationFixtureIds.update,
      );
      const knowledge = await harness.service.publish(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      await harness.notifier.waitForCalls(3);

      expect(event.already_published).toBe(false);
      expect(update.already_published).toBe(false);
      expect(knowledge.already_published).toBe(false);
      expect(harness.notifier.feeds).toEqual(["EVENT", "EVENT", "KNOWLEDGE"]);
      expect(harness.notifier.transactionStates).toEqual([false, false, false]);
      expect(database.inTransaction).toBe(false);
      expect(readPublishedItemCount(database)).toBe(3);

      await harness.service.publish("EVENT", publicationFixtureIds.event);
      await harness.service.publish(
        "EVENT_UPDATE",
        publicationFixtureIds.update,
      );
      await harness.service.publish(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      await harness.service.publish("EVENT", "publication-missing-target");
      await flushPublicationTasks();

      expect(harness.notifier.calls).toBe(3);
      expect(harness.renderer.calls).toBe(3);
      expect(harness.source.calls).toBe(3);
      expect(harness.clock.calls).toBe(3);
      expect(harness.ids.calls).toBe(3);
      expect(readPublishedItemCount(database)).toBe(3);
    });
  });

  it("PUB-02_EMPTY_NO_NOTIFY does not notify for any target with zero Topic Associations", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createPublicationP0Harness(database);

        for (const [targetType, targetId] of [
          ["EVENT", publicationFixtureIds.event],
          ["EVENT_UPDATE", publicationFixtureIds.update],
          ["KNOWLEDGE", publicationFixtureIds.knowledge],
        ] as const) {
          await expect(
            harness.service.publish(targetType, targetId),
          ).resolves.toEqual({
            published_item_id: null,
            already_published: false,
          });
        }
        await flushPublicationTasks();

        expect(harness.notifier.calls).toBe(0);
        expect(harness.clock.calls).toBe(0);
        expect(harness.ids.calls).toBe(0);
        expect(readPublishedItemCount(database)).toBe(0);
      },
      {
        eventAssociations: 0,
        updateAssociations: 0,
        knowledgeAssociations: 0,
      },
    );
  });

  it("NOTIFY_BEST_EFFORT_SYNC_THROW keeps the commit and records notify_failed", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const entries: PublicationLogEntry[] = [];
      const harness = createPublicationP0Harness(database, {
        notifierMode: "throw",
        logger: (entry) => {
          entries.push(entry);
        },
      });

      await expect(
        harness.service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toEqual({
        published_item_id: "publication-p0-event",
        already_published: false,
      });
      await harness.notifier.waitForCalls(1);
      await flushPublicationTasks();

      expect(readPublishedItemCount(database)).toBe(1);
      expect(harness.notifier.transactionStates).toEqual([false]);
      expect(entries).toContainEqual({
        targetType: "EVENT",
        targetId: publicationFixtureIds.event,
        stage: "notify",
        reason: "notify_failed",
        publishedItemId: "publication-p0-event",
      });

      await expect(
        harness.service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toEqual({
        published_item_id: "publication-p0-event",
        already_published: true,
      });
      await flushPublicationTasks();
      expect(harness.notifier.calls).toBe(1);
      expect(harness.renderer.calls).toBe(1);
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("NOTIFY_BEST_EFFORT_ASYNC_REJECT keeps the commit, logs once, and reuses it", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const entries: PublicationLogEntry[] = [];
      const harness = createPublicationP0Harness(database, {
        notifierMode: "reject",
        ids: ["publication-p0-knowledge"],
        logger: (entry) => {
          entries.push(entry);
        },
      });

      const first = await harness.service.publish(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      await harness.notifier.waitForCalls(1);
      await flushPublicationTasks();

      expect(first).toEqual({
        published_item_id: "publication-p0-knowledge",
        already_published: false,
      });
      expect(readPublishedItemCount(database)).toBe(1);
      expect(harness.notifier.transactionStates).toEqual([false]);
      expect(entries).toContainEqual({
        targetType: "KNOWLEDGE",
        targetId: publicationFixtureIds.knowledge,
        stage: "notify",
        reason: "notify_failed",
        publishedItemId: "publication-p0-knowledge",
      });

      await expect(
        harness.service.publish("KNOWLEDGE", publicationFixtureIds.knowledge),
      ).resolves.toEqual({
        published_item_id: "publication-p0-knowledge",
        already_published: true,
      });
      await flushPublicationTasks();
      expect(harness.notifier.calls).toBe(1);
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("NOTIFY_DEFERRED does not block Publish completion or repeat reuse", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database, {
        notifierMode: "deferred",
      });

      const first = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      expect(first).toEqual({
        published_item_id: "publication-p0-event",
        already_published: false,
      });
      expect(readPublishedItemCount(database)).toBe(1);
      expect(database.inTransaction).toBe(false);

      await harness.notifier.waitForCalls(1);
      expect(harness.notifier.transactionStates).toEqual([false]);

      await expect(
        harness.service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toEqual({
        published_item_id: first.published_item_id,
        already_published: true,
      });
      expect(harness.notifier.calls).toBe(1);

      harness.notifier.resolveDeferred();
      await flushPublicationTasks();
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });
});
