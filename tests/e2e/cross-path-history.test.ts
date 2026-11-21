import { stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EventAnalysisResponse } from "../../src/llm/response-validators.js";

import {
  RSS_FEEDS,
  RssError,
  buildRssArchiveKey,
  discoverArchives,
  parseRssArchiveDocument,
  renderRssArchive,
} from "../../src/rss/index.js";
import { countRows } from "../fixtures/e2e-pipeline.js";
import {
  withCrossPathHarness,
  withPublishedHistory,
} from "../fixtures/e2e-history.js";
import {
  buildRssCuratedFeedItems,
  buildRssEventFeedItems,
} from "../fixtures/rss-database.js";

const KNOWLEDGE = {
  valuable: true,
  title: "Cross-path Knowledge",
  summary: "A deterministic dual-route Knowledge result.",
  category: "Method",
  findings: [{ title: "Finding", description: "Finding description." }],
  value: "Value",
} as const;

function newEventAnalysis(): EventAnalysisResponse {
  return {
    results: [
      {
        action: "NEW_EVENT",
        title: "Cross-path Event",
        entity: { name: "Cross Path Regulator" },
        subject: "Investigation",
        scope: "Shared scope",
        description: "A deterministic dual-route Event result.",
        occurred_at: null,
        confirmed_aliases: [],
      },
    ],
  };
}

describe("D16 cross-path and history E2E", () => {
  it("E2E-06 matches both routes independently and publishes one item to each Feed", async () => {
    await withCrossPathHarness(
      {
        name: "e2e06",
        route: "BOTH",
        eventTurns: [{ analysis: newEventAnalysis() }],
        knowledgeTurns: [KNOWLEDGE],
      },
      async (harness) => {
        await harness.collect();
        const db = harness.assembly.database;
        expect(countRows(db, "source_items")).toBe(1);
        expect(countRows(db, "contents")).toBe(1);
        expect(countRows(db, "events")).toBe(1);
        expect(countRows(db, "knowledge")).toBe(1);
        const contentId = (
          db.prepare("SELECT content_id FROM source_items").get() as {
            content_id: string;
          }
        ).content_id;
        const event = db.prepare("SELECT id FROM events").get() as {
          id: string;
        };
        const knowledge = db
          .prepare("SELECT id, content_id FROM knowledge")
          .get() as { id: string; content_id: string };
        expect(knowledge.content_id).toBe(contentId);
        expect(
          db
            .prepare(
              "SELECT target_id, content_id FROM event_content_links WHERE target_type = 'EVENT'",
            )
            .get(),
        ).toEqual({ target_id: event.id, content_id: contentId });
        expect(
          db
            .prepare(
              "SELECT target_type, target_id, topic_id FROM topic_associations",
            )
            .all(),
        ).toEqual(
          expect.arrayContaining([
            {
              target_type: "EVENT",
              target_id: event.id,
              topic_id: harness.topicIds[0],
            },
            {
              target_type: "KNOWLEDGE",
              target_id: knowledge.id,
              topic_id: harness.topicIds[0],
            },
          ]),
        );
        const items = db
          .prepare("SELECT id, target_type, target_id FROM published_items")
          .all() as Array<{
          id: string;
          target_type: string;
          target_id: string;
        }>;
        expect(items).toHaveLength(2);
        expect(items.map(({ target_type }) => target_type).sort()).toEqual([
          "EVENT",
          "KNOWLEDGE",
        ]);
        for (const item of items) {
          expect(item.target_id).toBe(
            item.target_type === "EVENT" ? event.id : knowledge.id,
          );
        }
        const eventVersion = harness.publisher.versions.findLast(
          ({ feed }) => feed === "EVENT_UPDATES",
        )!;
        const curatedVersion = harness.publisher.versions.findLast(
          ({ feed }) => feed === "CURATED_CONTENT",
        )!;
        const eventXml = new TextDecoder().decode(
          eventVersion.files["event-updates.xml"],
        );
        const curatedXml = new TextDecoder().decode(
          curatedVersion.files["curated-content.xml"],
        );
        expect(eventXml.match(/<item>/g)).toHaveLength(1);
        expect(curatedXml.match(/<item>/g)).toHaveLength(1);
        for (const item of items) {
          const expected = `pis:published:${item.id}`;
          expect(
            item.target_type === "EVENT" ? eventXml : curatedXml,
          ).toContain(expected);
          expect(
            item.target_type === "EVENT" ? curatedXml : eventXml,
          ).not.toContain(expected);
        }
      },
    );
  });

  it("E2E-09 gives a new Update two associations but one Published Item and GUID", async () => {
    await withCrossPathHarness(
      {
        name: "e2e09",
        route: "EVENT",
        topicCount: 2,
        eventTurns: [
          { analysis: newEventAnalysis() },
          {
            analysis: ([eventId]) => {
              if (eventId === undefined) throw new Error("Expected candidate");
              return {
                results: [
                  {
                    action: "NEW_UPDATE",
                    event_id: eventId,
                    title: "Multi-topic Update",
                    description: "The Update matches two Topics.",
                    occurred_at: null,
                    confirmed_aliases: [],
                  },
                ],
              };
            },
          },
        ],
      },
      async (harness) => {
        await harness.collect();
        harness.setEntry("e2e09-guid-2", "A new update");
        await harness.collect();
        const db = harness.assembly.database;
        const update = db.prepare("SELECT id FROM event_updates").get() as {
          id: string;
        };
        const associations = db
          .prepare(
            "SELECT topic_id FROM topic_associations WHERE target_type = 'EVENT_UPDATE' AND target_id = ?",
          )
          .all(update.id) as Array<{ topic_id: string }>;
        expect(associations.map(({ topic_id }) => topic_id).sort()).toEqual(
          [...harness.topicIds].sort(),
        );
        const items = db
          .prepare(
            "SELECT id FROM published_items WHERE target_type = 'EVENT_UPDATE' AND target_id = ?",
          )
          .all(update.id) as Array<{ id: string }>;
        expect(items).toHaveLength(1);
        const xml = new TextDecoder().decode(
          harness.publisher.versions.findLast(
            ({ feed }) => feed === "EVENT_UPDATES",
          )!.files["event-updates.xml"],
        );
        expect(
          xml.match(new RegExp(`pis:published:${items[0]!.id}`, "g")),
        ).toHaveLength(1);
        expect(countRows(db, "topic_associations")).toBe(4);
        expect(countRows(db, "published_items")).toBe(2);
      },
    );
  });

  it("E2E-13 deduplicates same-Source GUID changes but permits same-body new GUIDs for both routes", async () => {
    for (const route of ["EVENT", "KNOWLEDGE"] as const) {
      await withCrossPathHarness(
        {
          name: `e2e13-${route.toLowerCase()}`,
          route,
          matchTopics: false,
          eventTurns: [
            { analysis: newEventAnalysis() },
            { analysis: newEventAnalysis() },
          ],
          knowledgeTurns: [KNOWLEDGE, KNOWLEDGE],
        },
        async (harness) => {
          await harness.collect();
          const operationsBeforeRepeat = [...harness.llm.operations];
          const db = harness.assembly.database;
          const before = db
            .prepare("SELECT id, content_id FROM source_items")
            .get() as { id: string; content_id: string };
          harness.setEntry(
            `e2e13-${route.toLowerCase()}-guid-1`,
            "Changed title and body",
            "Changed article body.",
          );
          await harness.collect();
          expect(
            db.prepare("SELECT id, content_id FROM source_items").all(),
          ).toEqual([before]);
          expect(countRows(db, "contents")).toBe(1);
          expect(harness.llm.operations).toEqual(operationsBeforeRepeat);
          harness.setEntry(
            `e2e13-${route.toLowerCase()}-guid-2`,
            "New GUID with original body",
          );
          await harness.collect();
          const items = db
            .prepare("SELECT id, content_id FROM source_items ORDER BY rowid")
            .all() as Array<{ id: string; content_id: string }>;
          expect(items).toHaveLength(2);
          expect(items[0]).toEqual(before);
          expect(items[1]!.content_id).not.toBe(before.content_id);
          expect(countRows(db, "contents")).toBe(2);
          if (route === "EVENT") {
            expect(countRows(db, "events")).toBe(2);
            expect(countRows(db, "knowledge")).toBe(0);
          } else {
            expect(countRows(db, "knowledge")).toBe(2);
            expect(countRows(db, "events")).toBe(0);
          }
          expect(harness.llm.operations).toEqual(
            route === "EVENT"
              ? [
                  "processing-route",
                  "event-search",
                  "event-analysis",
                  "topic-matching",
                  "processing-route",
                  "event-search",
                  "event-analysis",
                  "topic-matching",
                ]
              : [
                  "processing-route",
                  "knowledge-analysis",
                  "topic-matching",
                  "processing-route",
                  "knowledge-analysis",
                  "topic-matching",
                ],
          );
        },
      );
    }
  });

  it("E2E-12 server_side_archive_only preserves complete isolated immutable history", async () => {
    const eventItems = buildRssEventFeedItems(1, 401);
    const curatedItems = buildRssCuratedFeedItems(1, 401);
    await withPublishedHistory(
      { EVENT_UPDATES: eventItems, CURATED_CONTENT: curatedItems },
      async ({ directory, store, publisher, publish }) => {
        const unknownKey = "archive/unknown-history.xml";
        const unknownBytes = new TextEncoder().encode("<unknown/>");
        await store.write(unknownKey, unknownBytes, { onlyIfAbsent: true });
        for (const feed of ["EVENT_UPDATES", "CURATED_CONTENT"] as const) {
          await publish(feed);
          await publish(feed);
        }
        const versions = publisher.versions;
        expect(versions).toHaveLength(4);
        for (const version of versions) {
          expect(Object.keys(version.files).sort()).toEqual(
            [
              ".nojekyll",
              ...[1, 2].map((sequence) =>
                buildRssArchiveKey(RSS_FEEDS[version.feed], sequence),
              ),
              RSS_FEEDS[version.feed].headKey,
              RSS_FEEDS[version.feed].pendingKey,
            ].sort(),
          );
          for (const other of ["EVENT_UPDATES", "CURATED_CONTENT"] as const) {
            if (other === version.feed) continue;
            expect(Object.keys(version.files)).not.toContain(
              RSS_FEEDS[other].headKey,
            );
            expect(
              Object.keys(version.files).some((key) =>
                key.includes(RSS_FEEDS[other].archiveFilePrefix),
              ),
            ).toBe(false);
          }
          expect(version.files[unknownKey]).toBeUndefined();
        }
        expect(await store.read(unknownKey)).toEqual(unknownBytes);

        for (const feed of ["EVENT_UPDATES", "CURATED_CONTENT"] as const) {
          const definition = RSS_FEEDS[feed];
          const items = feed === "EVENT_UPDATES" ? eventItems : curatedItems;
          const archives = await discoverArchives(store, definition);
          expect(archives).toHaveLength(2);
          for (const archive of archives)
            expect(archive.document.items).toHaveLength(200);
          const latest = archives.at(-1)!.key;
          const pending = parseRssArchiveDocument(
            definition,
            definition.pendingKey,
            (await store.read(definition.pendingKey))!,
            { latestArchiveKey: latest },
          );
          const head = parseRssArchiveDocument(
            definition,
            definition.headKey,
            (await store.read(definition.headKey))!,
          );
          expect(pending.items).toHaveLength(1);
          expect(pending.previousArchiveKey).toBe(latest);
          expect(head.previousArchiveKey).toBe(definition.pendingKey);
          const occurrences = [
            ...archives,
            { document: pending },
            { document: head },
          ]
            .flatMap(({ document }) => document.items)
            .map(({ guid }) => guid);
          const unique = new Set(occurrences);
          expect(unique).toEqual(
            new Set(items.map(({ id }) => `pis:published:${id}`)),
          );
          expect(unique.size).toBe(401);
          const uniqueOccurrences = [...archives, { document: pending }]
            .flatMap(({ document }) => document.items)
            .map(({ guid }) => guid);
          expect(new Set(uniqueOccurrences).size).toBe(401);
          const other = feed === "EVENT_UPDATES" ? curatedItems : eventItems;
          for (const item of other)
            expect(unique).not.toContain(`pis:published:${item.id}`);
        }

        const eventFirstKey = buildRssArchiveKey(RSS_FEEDS.EVENT_UPDATES, 1);
        const stable = (await store.read(eventFirstKey))!;
        const beforeStat = await stat(path.join(directory, eventFirstKey));
        await publish("EVENT_UPDATES");
        expect((await stat(path.join(directory, eventFirstKey))).mtimeMs).toBe(
          beforeStat.mtimeMs,
        );
        expect(await store.read(eventFirstKey)).toEqual(stable);
        const drifted = renderRssArchive({
          feed: RSS_FEEDS.EVENT_UPDATES,
          items: eventItems
            .slice(0, 200)
            .map((item, index) =>
              index === 0
                ? { ...item, title: "Drifted immutable history" }
                : item,
            ),
          documentHref: eventFirstKey,
          previousArchiveHref: null,
        });
        await store.write(eventFirstKey, drifted);
        const pendingBefore = await store.read(
          RSS_FEEDS.EVENT_UPDATES.pendingKey,
        );
        const error = await publish("EVENT_UPDATES").catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(RssError);
        expect((error as RssError).code).toBe("archive_conflict");
        expect(await store.read(eventFirstKey)).toEqual(drifted);
        expect(await store.read(RSS_FEEDS.EVENT_UPDATES.pendingKey)).toEqual(
          pendingBefore,
        );
        expect(await store.read(unknownKey)).toEqual(unknownBytes);
        expect(
          await store.read(RSS_FEEDS.CURATED_CONTENT.headKey),
        ).not.toBeNull();
        console.info("E2E-12 evidence: server_side_archive_only");
      },
    );
  }, 30_000);
});
