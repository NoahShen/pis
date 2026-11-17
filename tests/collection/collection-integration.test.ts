import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createRssAdapter } from "../../src/adapters/rss-adapter.js";
import { createSourceAdapterRegistry } from "../../src/collection/adapter-registry.js";
import { createCollection } from "../../src/collection/index.js";
import { parseRawDataSourceItemV1 } from "../../src/collection/raw-data.js";
import { SqliteSourceItemRepository } from "../../src/collection/source-item-repository.js";
import { SqliteSourceRepository } from "../../src/configuration/source-repository.js";
import { CryptoIdGenerator } from "../../src/id/crypto-id-generator.js";
import {
  CapturedCollectionLogger,
  countFixtureRows,
  FIXTURE_ARTICLE_ONE_URL,
  FIXTURE_ARTICLE_THREE_URL,
  FIXTURE_ARTICLE_TWO_URL,
  FIXTURE_FEED_URL,
  FIXTURE_LATER_AT,
  FIXTURE_SOURCE_ID,
  FIXTURE_STARTED_AT,
  FixtureClock,
  fixtureArticleHtml,
  fixtureRssFeed,
  fixtureRssItem,
  FixtureRssTransport,
  fixtureDownstreamTables,
  insertFixtureSource,
  readFixtureCheckpoint,
  readFixtureSourceItems,
  trackFixtureTransactions,
  withFixtureCollectionDatabase,
} from "../fixtures/collection.js";

function createIntegrationHarness(
  db: Database.Database,
  transport: FixtureRssTransport,
  clock: FixtureClock,
) {
  const transactions = trackFixtureTransactions(db);
  const logger = new CapturedCollectionLogger();
  const adapter = createRssAdapter({
    transport,
    httpPolicy: {
      requestTimeoutMs: 100,
      articleMinTextChars: 80,
    },
  });
  const collection = createCollection({
    database: transactions.database,
    sourceRepository: new SqliteSourceRepository(db, new CryptoIdGenerator()),
    sourceItemRepository: new SqliteSourceItemRepository(
      db,
      new CryptoIdGenerator(),
    ),
    adapters: createSourceAdapterRegistry(new Map([["RSS", adapter]])),
    clock,
    logger,
  });

  return { collection, logger, transactionCount: transactions.count };
}

describe("Collection public integration", () => {
  it("collects only new RSS entries through raw_data v1 into one SQLite transaction", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const transport = new FixtureRssTransport();
      const clock = new FixtureClock(new Date(FIXTURE_STARTED_AT).getTime());
      const harness = createIntegrationHarness(db, transport, clock);

      transport.setArticle(
        FIXTURE_ARTICLE_ONE_URL,
        fixtureArticleHtml("Initial existing body evidence. ".repeat(4)),
      );
      transport.setFeed(
        fixtureRssFeed(
          fixtureRssItem({
            guid: "existing-guid",
            title: "Existing story",
            link: FIXTURE_ARTICLE_ONE_URL,
            summary: "<p>Existing summary</p>",
          }),
        ),
      );
      await expect(
        harness.collection.collect(FIXTURE_SOURCE_ID),
      ).resolves.toMatchObject({
        new_source_item_ids: [expect.any(String)],
      });

      transport.setArticle(
        FIXTURE_ARTICLE_ONE_URL,
        fixtureArticleHtml("Changed existing body evidence. ".repeat(4)),
      );
      transport.setFeed(
        fixtureRssFeed(`
          ${fixtureRssItem({
            guid: "existing-guid",
            title: "Existing story changed",
            link: FIXTURE_ARTICLE_ONE_URL,
          })}
          ${fixtureRssItem({
            guid: "new-full-guid",
            title: "Fresh full story",
            link: FIXTURE_ARTICLE_TWO_URL,
            summary: "<p>Fresh full source summary</p>",
          })}
          ${fixtureRssItem({
            guid: "new-summary-guid",
            title: "Fresh summary story",
            link: FIXTURE_ARTICLE_THREE_URL,
            summary: "<p>Summary-only source evidence</p>",
          })}
        `),
      );
      transport.setArticle(
        FIXTURE_ARTICLE_TWO_URL,
        fixtureArticleHtml("Fresh article body evidence. ".repeat(4)),
      );
      transport.setArticle(FIXTURE_ARTICLE_THREE_URL, fixtureArticleHtml());

      clock.advance(
        new Date(FIXTURE_LATER_AT).getTime() -
          new Date(FIXTURE_STARTED_AT).getTime(),
      );
      const beforeSecondCollection = harness.transactionCount();
      const result = await harness.collection.collect(FIXTURE_SOURCE_ID);
      const rows = readFixtureSourceItems(db);
      const rowsByExternalId = new Map(
        rows.map((row) => [row.external_id, row] as const),
      );

      expect(result.new_source_item_ids).toHaveLength(2);
      expect(result.new_source_item_ids).toEqual(
        expect.arrayContaining(rows.slice(1).map((row) => row.id)),
      );
      expect(harness.transactionCount()).toBe(beforeSecondCollection + 1);
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.content_id === null)).toBe(true);
      expect(readFixtureCheckpoint(db)).toBe(FIXTURE_LATER_AT);
      expect(transport.requests).toEqual([
        expect.objectContaining({ kind: "feed", url: FIXTURE_FEED_URL }),
        expect.objectContaining({
          kind: "article",
          url: FIXTURE_ARTICLE_ONE_URL,
        }),
        expect.objectContaining({ kind: "feed", url: FIXTURE_FEED_URL }),
        expect.objectContaining({
          kind: "article",
          url: FIXTURE_ARTICLE_TWO_URL,
        }),
        expect.objectContaining({
          kind: "article",
          url: FIXTURE_ARTICLE_THREE_URL,
        }),
      ]);

      const existing = rowsByExternalId.get("existing-guid");
      const freshFull = rowsByExternalId.get("new-full-guid");
      const freshSummary = rowsByExternalId.get("new-summary-guid");
      expect(existing?.raw_data).not.toBeNull();
      expect(freshFull?.raw_data).not.toBeNull();
      expect(freshSummary?.raw_data).not.toBeNull();

      const existingRaw = parseRawDataSourceItemV1(existing?.raw_data ?? "");
      expect(existingRaw.content.body).toContain(
        "Initial existing body evidence.",
      );
      expect(existingRaw.schema_version).toBe(1);

      const freshFullRaw = parseRawDataSourceItemV1(freshFull?.raw_data ?? "");
      expect(freshFullRaw).toMatchObject({
        schema_version: 1,
        entry: {
          external_id: "new-full-guid",
          title: "Fresh full story",
        },
        content: {
          body: expect.stringContaining("Fresh article body evidence."),
          summary: "Fresh full source summary",
          content_kind: "FULL_BODY",
          acquired_via: "ARTICLE_EXTRACT",
          completeness_basis: "ARTICLE_EXTRACTED",
          article: {
            status: "SUCCESS",
            reason: null,
            final_url: FIXTURE_ARTICLE_TWO_URL,
          },
        },
      });

      const freshSummaryRaw = parseRawDataSourceItemV1(
        freshSummary?.raw_data ?? "",
      );
      expect(freshSummaryRaw.entry.external_id).toBe("new-summary-guid");
      expect(freshSummaryRaw.content.summary).toBe(
        "Summary-only source evidence",
      );
      expect(freshSummaryRaw.content.body).toContain(
        "Synthetic article evidence",
      );
      expect(freshSummaryRaw.content.content_kind).toBe("FULL_BODY");
      expect(freshSummaryRaw.content.acquired_via).toBe("ARTICLE_EXTRACT");
      expect(freshSummaryRaw.content.completeness_basis).toBe(
        "ARTICLE_EXTRACTED",
      );
      expect(freshSummaryRaw.content.article).toEqual({
        status: "SUCCESS",
        reason: null,
        final_url: FIXTURE_ARTICLE_THREE_URL,
      });
      expect(JSON.parse(JSON.stringify(freshSummaryRaw))).toEqual(
        freshSummaryRaw,
      );

      expect(countFixtureRows(db, "contents")).toBe(0);
      for (const table of fixtureDownstreamTables) {
        expect(countFixtureRows(db, table)).toBe(0);
      }
    });
  });

  it("E2E-13 keeps changed GUID bodies out and inserts new GUIDs with repeated bodies", async () => {
    await withFixtureCollectionDatabase(async (db) => {
      insertFixtureSource(db);
      const transport = new FixtureRssTransport();
      const clock = new FixtureClock(new Date(FIXTURE_STARTED_AT).getTime());
      const harness = createIntegrationHarness(db, transport, clock);
      const originalBody = "Original stable GUID evidence. ".repeat(4);
      const repeatedBody = "Repeated body across different GUIDs. ".repeat(4);

      transport.setArticle(
        FIXTURE_ARTICLE_ONE_URL,
        fixtureArticleHtml(originalBody),
      );
      transport.setFeed(
        fixtureRssFeed(
          fixtureRssItem({
            guid: "stable-guid",
            title: "Stable title",
            link: FIXTURE_ARTICLE_ONE_URL,
            summary: "<p>Original stable GUID summary</p>",
          }),
        ),
      );
      await harness.collection.collect(FIXTURE_SOURCE_ID);

      transport.setArticle(
        FIXTURE_ARTICLE_ONE_URL,
        fixtureArticleHtml(repeatedBody),
      );
      transport.setArticle(
        FIXTURE_ARTICLE_TWO_URL,
        fixtureArticleHtml(repeatedBody),
      );
      transport.setFeed(
        fixtureRssFeed(`
          ${fixtureRssItem({
            guid: "stable-guid",
            title: "Stable title changed",
            link: FIXTURE_ARTICLE_ONE_URL,
            summary: "<p>Repeated body across different GUIDs.</p>",
          })}
          ${fixtureRssItem({
            guid: "new-guid",
            title: "Distinct title",
            link: FIXTURE_ARTICLE_TWO_URL,
            summary: "<p>Repeated body across different GUIDs.</p>",
          })}
        `),
      );
      clock.advance(
        new Date(FIXTURE_LATER_AT).getTime() -
          new Date(FIXTURE_STARTED_AT).getTime(),
      );

      const result = await harness.collection.collect(FIXTURE_SOURCE_ID);
      const rows = readFixtureSourceItems(db);
      const byExternalId = new Map(
        rows.map((row) => [row.external_id, row] as const),
      );

      expect(result.new_source_item_ids).toEqual([
        byExternalId.get("new-guid")?.id,
      ]);
      expect(rows).toHaveLength(2);
      expect(
        rows.filter((row) => row.external_id === "stable-guid"),
      ).toHaveLength(1);
      expect(rows.filter((row) => row.external_id === "new-guid")).toHaveLength(
        1,
      );
      expect(
        parseRawDataSourceItemV1(
          byExternalId.get("stable-guid")?.raw_data ?? "",
        ).content.body,
      ).toContain("Original stable GUID evidence.");
      expect(
        parseRawDataSourceItemV1(byExternalId.get("new-guid")?.raw_data ?? "")
          .content.body,
      ).toContain("Repeated body across different GUIDs.");
      expect(countFixtureRows(db, "contents")).toBe(0);
      expect(rows.every((row) => row.content_id === null)).toBe(true);
    });
  });
});
