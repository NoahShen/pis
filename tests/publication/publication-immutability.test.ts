import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type {
  PublicationTargetType,
  PublishedItem,
} from "../../src/publication/contracts.js";
import {
  createPublicationP0Harness,
  publicationFixtureIds,
  readPublishedItems,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

function addContentEvidence(
  database: Database.Database,
  targetType: "EVENT" | "EVENT_UPDATE",
  targetId: string,
  contentId: string,
  url: string,
): void {
  database
    .prepare(
      `
        INSERT INTO contents (
          id, title, url, author, published_at, created_at, body, summary,
          language, completeness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      contentId,
      `Synthetic late evidence ${contentId}`,
      url,
      null,
      null,
      "2026-11-20T13:00:00.000+08:00",
      "Synthetic late evidence body",
      "Synthetic late evidence summary",
      "en",
      "FULL",
    );
  database
    .prepare(
      `
        INSERT INTO event_content_links (target_type, target_id, content_id)
        VALUES (?, ?, ?)
      `,
    )
    .run(targetType, targetId, contentId);
}

function snapshotsByTarget(
  database: Database.Database,
): Record<PublicationTargetType, PublishedItem> {
  return Object.fromEntries(
    readPublishedItems(database).map((item) => [item.target_type, item]),
  ) as Record<PublicationTargetType, PublishedItem>;
}

describe("PUB-09 and PUB-12 immutable Published Item snapshots", () => {
  it("PUB-09_IMMUTABLE_EVIDENCE_AND_PUB-12_NO_RERENDER preserves all seven columns", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createPublicationP0Harness(database, {
          ids: [
            "publication-immutable-event",
            "publication-immutable-update",
            "publication-immutable-knowledge",
          ],
        });
        const targets = [
          ["EVENT", publicationFixtureIds.event],
          ["EVENT_UPDATE", publicationFixtureIds.update],
          ["KNOWLEDGE", publicationFixtureIds.knowledge],
        ] as const;

        for (const [targetType, targetId] of targets) {
          await harness.service.publish(targetType, targetId);
        }
        await harness.notifier.waitForCalls(3);
        const before = snapshotsByTarget(database);
        const beforeBytes = JSON.stringify(before);

        database
          .prepare(
            "UPDATE events SET title = ?, description = ?, occurred_at = ? WHERE id = ?",
          )
          .run(
            "Synthetic Changed Event Title",
            "Synthetic Changed Event Description",
            "2026-11-21T08:00:00.000+08:00",
            publicationFixtureIds.event,
          );
        database
          .prepare(
            "UPDATE event_updates SET title = ?, description = ? WHERE id = ?",
          )
          .run(
            "Synthetic Changed Update Title",
            "Synthetic Changed Update Description",
            publicationFixtureIds.update,
          );
        database
          .prepare(
            `
              UPDATE knowledge
              SET title = ?, summary = ?, category = ?, findings_json = ?, value = ?
              WHERE id = ?
            `,
          )
          .run(
            "Synthetic Changed Knowledge Title",
            "Synthetic Changed Knowledge Summary",
            "Experience",
            JSON.stringify([
              {
                title: "Synthetic late Finding",
                description: "Synthetic late Finding description",
              },
            ]),
            "Synthetic Changed Knowledge Value",
            publicationFixtureIds.knowledge,
          );

        addContentEvidence(
          database,
          "EVENT",
          publicationFixtureIds.event,
          "publication-late-event-content",
          "https://publication.example.test/late-event-evidence",
        );
        addContentEvidence(
          database,
          "EVENT_UPDATE",
          publicationFixtureIds.update,
          "publication-late-update-content",
          "https://publication.example.test/late-update-evidence",
        );
        database
          .prepare("UPDATE source_items SET url = ? WHERE id = ?")
          .run(
            "https://publication.example.test/late-knowledge-evidence",
            publicationFixtureIds.knowledgeSourceItem,
          );

        const addTopicAssociation = database.prepare(
          `
            INSERT INTO topic_associations (
              topic_id, target_type, target_id, matched_at
            ) VALUES (?, ?, ?, ?)
          `,
        );
        for (const [targetType, targetId] of targets) {
          addTopicAssociation.run(
            publicationFixtureIds.topicBeta,
            targetType,
            targetId,
            "2026-11-21T09:00:00.000+08:00",
          );
        }
        database
          .prepare(
            `
              INSERT INTO event_updates (
                id, event_id, title, description, occurred_at, discovered_at
              ) VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "publication-late-update",
            publicationFixtureIds.event,
            "Synthetic Late Update",
            "Synthetic Late Update Description",
            "2026-11-21T10:00:00.000+08:00",
            "2026-11-21T10:00:00.000+08:00",
          );

        for (const [targetType, targetId] of targets) {
          await expect(
            harness.service.publish(targetType, targetId),
          ).resolves.toEqual({
            published_item_id: before[targetType].id,
            already_published: true,
          });
        }

        const after = snapshotsByTarget(database);
        expect(after).toEqual(before);
        expect(JSON.stringify(after)).toBe(beforeBytes);
        expect(readPublishedItems(database)).toHaveLength(3);
        expect(harness.renderer.calls).toBe(3);
        expect(harness.source.calls).toBe(3);
        expect(harness.clock.calls).toBe(3);
        expect(harness.ids.calls).toBe(3);
        expect(harness.notifier.calls).toBe(3);
        expect(harness.renderer.transactionStates).toEqual([
          false,
          false,
          false,
        ]);
        expect(harness.source.transactionStates).toEqual([false, false, false]);
        expect(harness.clock.transactionStates).toEqual([true, true, true]);
        expect(harness.ids.transactionStates).toEqual([true, true, true]);
      },
      {
        includeEventUrl: true,
        includeUpdateUrl: true,
        includeKnowledgeUrl: true,
      },
    );
  });
});
