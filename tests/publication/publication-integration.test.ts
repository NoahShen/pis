import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";
import type {
  PublicationTargetType,
  PublishedItem,
} from "../../src/publication/contracts.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import { SqlitePublicationTargetRepository } from "../../src/publication/publication-target-repository.js";
import type { StageServices } from "../../src/runtime/contracts.js";
import { mapResultToDownstreamTasks } from "../../src/runtime/task-mapping.js";
import {
  createPublicationP0Harness,
  publicationFixtureIds,
  publicationFixtureUrls,
  readPublishedItemCount,
  readPublishedItems,
  sortedKeys,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

function insertContent(
  database: Database.Database,
  id: string,
  url: string | null,
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
      id,
      `Synthetic integration content ${id}`,
      url,
      null,
      null,
      "2026-11-20T10:00:00.000+08:00",
      `Synthetic body ${id}`,
      `Synthetic summary ${id}`,
      "en",
      "FULL",
    );
}

function linkEventEvidence(
  database: Database.Database,
  targetType: "EVENT" | "EVENT_UPDATE",
  targetId: string,
  contentId: string,
): void {
  database
    .prepare(
      `
        INSERT INTO event_content_links (target_type, target_id, content_id)
        VALUES (?, ?, ?)
      `,
    )
    .run(targetType, targetId, contentId);
}

function bodyHrefs(body: string): string[] {
  return [...body.matchAll(/<a href="([^"]+)">/g)].map((match) => match[1]!);
}

function assertSafeBody(body: string): void {
  const allowedTags = new Set([
    "a",
    "h2",
    "h3",
    "li",
    "p",
    "section",
    "strong",
    "ul",
  ]);
  for (const match of body.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    expect(allowedTags.has(match[1]!.toLowerCase())).toBe(true);
  }
  expect(body).not.toMatch(/<script\b|<img\b|<[^>]*onerror\s*=/i);
}

describe("D11 real SQLite publication integration", () => {
  it("PUB-01_SQLITE_THREE_KINDS creates one readable snapshot for every target type", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createPublicationP0Harness(database, {
          ids: [
            "publication-integration-event",
            "publication-integration-update",
            "publication-integration-knowledge",
          ],
        });

        await harness.service.publish("EVENT", publicationFixtureIds.event);
        await harness.service.publish(
          "EVENT_UPDATE",
          publicationFixtureIds.update,
        );
        await harness.service.publish(
          "KNOWLEDGE",
          publicationFixtureIds.knowledge,
        );
        await harness.notifier.waitForCalls(3);

        const rows = readPublishedItems(database);
        expect(rows).toHaveLength(3);
        expect(rows.map(({ target_type }) => target_type)).toEqual([
          "EVENT",
          "EVENT_UPDATE",
          "KNOWLEDGE",
        ]);
        for (const row of rows) {
          expect(row.title.trim()).not.toBe("");
          expect(row.summary.trim()).not.toBe("");
          expect(row.body.trim()).not.toBe("");
          expect(row.body).toContain(row.title.replace(/&/g, "&amp;"));
          assertSafeBody(row.body);
        }
        expect(rows[0]!.body).toContain(publicationFixtureUrls.event);
        expect(rows[1]!.body).toContain(publicationFixtureUrls.update);
        expect(rows[1]!.body).not.toContain(publicationFixtureUrls.event);
        expect(rows[2]!.body).toContain(publicationFixtureUrls.knowledge);
        expect(
          Object.keys(harness.dependencies).some((key) =>
            /completion|prompt|userContext/i.test(key),
          ),
        ).toBe(false);
      },
      {
        includeEventUrl: true,
        includeUpdateUrl: true,
        includeKnowledgeUrl: true,
      },
    );
  });

  it("PUB-02_SQLITE_GATE rejects all three target kinds when no association exists", async () => {
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

        expect(readPublishedItemCount(database)).toBe(0);
        expect(harness.renderer.calls).toBe(0);
        expect(harness.source.calls).toBe(0);
        expect(harness.clock.calls).toBe(0);
        expect(harness.ids.calls).toBe(0);
        expect(harness.notifier.calls).toBe(0);
      },
      {
        eventAssociations: 0,
        updateAssociations: 0,
        knowledgeAssociations: 0,
      },
    );
  });

  it("PUB-03_SQLITE_GUARD and DB-13_SERVICE_BOUNDARY leave no dangling service rows", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);

      for (const targetType of [
        "EVENT",
        "EVENT_UPDATE",
        "KNOWLEDGE",
      ] as const) {
        await expect(
          harness.service.publish(targetType, `${targetType}-missing`),
        ).resolves.toEqual({
          published_item_id: null,
          already_published: false,
        });
      }
      expect(readPublishedItemCount(database)).toBe(0);

      const orphan: PublishedItem = {
        id: "publication-direct-polymorphic-orphan",
        target_type: "EVENT",
        target_id: "publication-direct-missing-target",
        title: "Synthetic direct orphan",
        summary: "Synthetic direct orphan summary",
        body: "<section><p>Synthetic direct orphan body</p></section>",
        published_at: "2026-11-20T12:00:00.000+08:00",
      };
      withTransaction(database, () => {
        new SqlitePublishedItemRepository(database).insert(orphan);
      });
      expect(readPublishedItemCount(database)).toBe(1);

      const guarded = await harness.service.publish(
        "EVENT",
        "publication-another-missing-target",
      );
      expect(guarded).toEqual({
        published_item_id: null,
        already_published: false,
      });
      expect(readPublishedItemCount(database)).toBe(1);

      const counters = createPublicationP0Harness(database);
      await expect(
        counters.service.publish(
          "UNKNOWN" as PublicationTargetType,
          "synthetic-invalid-target",
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(counters.published.findCalls).toBe(0);
      expect(counters.target.contextCalls).toBe(0);
      expect(counters.target.associationCalls).toBe(0);
    });
  });

  it("PUB-04_SQLITE_MULTI_TOPIC keeps one snapshot for two Topic Associations", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createPublicationP0Harness(database);
        const result = await harness.service.publish(
          "EVENT",
          publicationFixtureIds.event,
        );
        await harness.notifier.waitForCalls(1);

        expect(result.published_item_id).toBe("publication-p0-event");
        expect(readPublishedItemCount(database)).toBe(1);
        const associationCount = (
          database
            .prepare(
              `
                SELECT COUNT(*) AS count
                FROM topic_associations
                WHERE target_type = 'EVENT' AND target_id = ?
              `,
            )
            .get(publicationFixtureIds.event) as { readonly count: number }
        ).count;
        expect(associationCount).toBe(2);
      },
      { eventAssociations: 2 },
    );
  });

  it("PUB-05_REUSE_AND_UNIQUE returns the original ID and preserves SQLite UNIQUE", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      const first = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      const repeated = await harness.service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      await harness.notifier.waitForCalls(1);

      expect(first).toEqual({
        published_item_id: "publication-p0-event",
        already_published: false,
      });
      expect(repeated).toEqual({
        published_item_id: first.published_item_id,
        already_published: true,
      });
      expect(readPublishedItemCount(database)).toBe(1);
      expect(harness.renderer.calls).toBe(1);
      expect(harness.source.calls).toBe(1);
      expect(harness.clock.calls).toBe(1);
      expect(harness.ids.calls).toBe(1);

      const schema = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'published_items'",
        )
        .get() as { readonly sql: string };
      expect(schema.sql).toMatch(
        /UNIQUE\s*\(\s*target_type\s*,\s*target_id\s*\)/i,
      );

      const duplicate = {
        ...readPublishedItems(database)[0]!,
        id: "publication-duplicate-id",
      };
      expect(() =>
        withTransaction(database, () => {
          new SqlitePublishedItemRepository(database).insert(duplicate);
        }),
      ).toThrow();
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("PUB-06_SQLITE_LINK deduplicates normalized evidence URLs and preserves first order", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const firstUrl = "https://publication.example.test/duplicate-link";
      const secondUrl = "https://publication.example.test/second-link";
      insertContent(database, "publication-link-first", firstUrl);
      insertContent(database, "publication-link-duplicate", firstUrl);
      insertContent(database, "publication-link-second", secondUrl);
      linkEventEvidence(
        database,
        "EVENT",
        publicationFixtureIds.event,
        "publication-link-first",
      );
      linkEventEvidence(
        database,
        "EVENT",
        publicationFixtureIds.event,
        "publication-link-duplicate",
      );
      linkEventEvidence(
        database,
        "EVENT",
        publicationFixtureIds.event,
        "publication-link-second",
      );
      const harness = createPublicationP0Harness(database);

      await harness.service.publish("EVENT", publicationFixtureIds.event);
      await harness.notifier.waitForCalls(1);
      const body = readPublishedItems(database)[0]!.body;
      const hrefs = bodyHrefs(body);

      expect(hrefs.filter((href) => href === firstUrl)).toHaveLength(1);
      expect(hrefs.indexOf(firstUrl)).toBeLessThan(hrefs.indexOf(secondUrl));
      expect(body.match(/<h2>来源<\/h2>/g)).toHaveLength(1);
    });
  });

  it("PUB-07_SQLITE_NO_LINK publishes normally without a source section or placeholder", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      const result = await harness.service.publish(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      await harness.notifier.waitForCalls(1);
      const row = readPublishedItems(database)[0]!;

      expect(result.already_published).toBe(false);
      expect(row.body).not.toContain("来源");
      expect(row.body).not.toMatch(/<a\b|href=|https?:\/\//);
      assertSafeBody(row.body);
    });
  });

  it("PUB-08_SQLITE_FILTER drops unsafe evidence URLs without blocking publication", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const validUrl = "https://publication.example.test/safe-evidence";
      const badUrls = [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///private/synthetic",
        "https://user:password@publication.example.test/private",
        "https://publication.example.test/control\nsynthetic",
        "",
      ];
      insertContent(database, "publication-safe-evidence", validUrl);
      linkEventEvidence(
        database,
        "EVENT",
        publicationFixtureIds.event,
        "publication-safe-evidence",
      );
      badUrls.forEach((url, index) => {
        const contentId = `publication-bad-evidence-${index}`;
        insertContent(database, contentId, url);
        linkEventEvidence(
          database,
          "EVENT",
          publicationFixtureIds.event,
          contentId,
        );
      });
      const harness = createPublicationP0Harness(database);

      await expect(
        harness.service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toMatchObject({ already_published: false });
      await harness.notifier.waitForCalls(1);
      const row = readPublishedItems(database)[0]!;
      expect(bodyHrefs(row.body)).toEqual([validUrl]);
      expect(row.body).not.toContain("javascript:alert");
      expect(row.body).not.toContain("data:text/html");
      expect(row.body).not.toContain("file:///private");
      expect(row.body).not.toContain("user:password");
    });
  });

  it("PUB-10_INVALID_DRAFT rejects blank fields for all three target kinds before writes", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      harness.renderer.nextDraft = {
        title: " ",
        summary: "",
        body: "<section></section>",
      };

      for (const [targetType, targetId] of [
        ["EVENT", publicationFixtureIds.event],
        ["EVENT_UPDATE", publicationFixtureIds.update],
        ["KNOWLEDGE", publicationFixtureIds.knowledge],
      ] as const) {
        await expect(
          harness.service.publish(targetType, targetId),
        ).rejects.toMatchObject({ code: "publication_failed" });
      }

      expect(readPublishedItemCount(database)).toBe(0);
      expect(harness.published.insertCalls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(harness.notifier.calls).toBe(0);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("PUB-13_SAFE_BODY escapes display HTML and links only to stored evidence", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const malicious =
        '<script>alert("synthetic")</script><img src=x onerror="synthetic">';
      database
        .prepare(
          `
            UPDATE events
            SET title = ?, entity_name = ?, subject = ?, scope = ?, description = ?
            WHERE id = ?
          `,
        )
        .run(
          malicious,
          malicious,
          malicious,
          malicious,
          `${malicious} https://description.example.test/not-evidence`,
          publicationFixtureIds.event,
        );
      const evidenceUrl = "https://publication.example.test/safe-body-evidence";
      insertContent(database, "publication-safe-body-evidence", evidenceUrl);
      linkEventEvidence(
        database,
        "EVENT",
        publicationFixtureIds.event,
        "publication-safe-body-evidence",
      );
      const harness = createPublicationP0Harness(database);

      await harness.service.publish("EVENT", publicationFixtureIds.event);
      await harness.notifier.waitForCalls(1);
      const row = readPublishedItems(database)[0]!;

      expect(row.body).not.toContain("<script>");
      expect(row.body).not.toContain("<img");
      expect(row.body).toContain("&lt;script&gt;");
      expect(row.body).toContain("&lt;img");
      expect(bodyHrefs(row.body)).toEqual([evidenceUrl]);
      expect(bodyHrefs(row.body)).not.toContain(
        "https://description.example.test/not-evidence",
      );
      assertSafeBody(row.body);
    });
  });

  it("TARGET_DTO contains no raw_data, User Context, historical Updates, or parent description", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const repository = new SqlitePublicationTargetRepository(database);
      const event = repository.getContext("EVENT", publicationFixtureIds.event);
      if (event?.targetType !== "EVENT") {
        throw new Error("Expected an Event context");
      }
      expect(sortedKeys(event.event)).toEqual(
        ["description", "entityName", "id", "scope", "subject", "title"].sort(),
      );
      const update = repository.getContext(
        "EVENT_UPDATE",
        publicationFixtureIds.update,
      );
      if (update?.targetType !== "EVENT_UPDATE") {
        throw new Error("Expected an Event Update context");
      }
      expect(update.parentEvent).not.toHaveProperty("description");
      const knowledge = repository.getContext(
        "KNOWLEDGE",
        publicationFixtureIds.knowledge,
      );
      if (knowledge?.targetType !== "KNOWLEDGE") {
        throw new Error("Expected a Knowledge context");
      }
      expect(sortedKeys(knowledge.knowledge)).toEqual(
        ["category", "findings", "id", "summary", "title", "value"].sort(),
      );
      const serialized = JSON.stringify([event, update, knowledge]);
      for (const forbidden of [
        ["raw", "data"].join("_"),
        ["user", "Context"].join(""),
        "historical_updates",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  it("D15_DIRECT_ASSIGNMENT accepts the nullable D11 publish and keeps PUBLISH terminal", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createPublicationP0Harness(database);
      const stagePublish: StageServices["publish"] = harness.service.publish;
      expect(stagePublish).toBeTypeOf("function");
      const result = await stagePublish(
        "EVENT",
        "publication-missing-for-nullable-contract",
      );

      expect(result).toEqual({
        published_item_id: null,
        already_published: false,
      });
      expect(
        mapResultToDownstreamTasks(
          {
            type: "PUBLISH",
            target_type: "EVENT",
            target_id: "publication-missing-for-nullable-contract",
          },
          { published_item_id: null },
        ),
      ).toEqual([]);
    });
  });
});
