import { describe, expect, it } from "vitest";

import type {
  PublicationFeed,
  PublishedItem,
  PublishedItemRepository,
} from "../../src/publication/contracts.js";
import {
  RSS_FEEDS,
  RssError,
  createPublishedItemSource,
  getRssFeed,
} from "../../src/rss/index.js";
import {
  StubRssPublishedItemRepository,
  createRssPublishedItem,
  rssFeedItems,
} from "../fixtures/rss.js";

function repositoryWith(
  rows: Readonly<Record<PublicationFeed, readonly PublishedItem[]>>,
): StubRssPublishedItemRepository {
  return new StubRssPublishedItemRepository(rows);
}

describe("RSS feed definitions", () => {
  it("RSS-01/02_FEEDS fixes the exact EVENT and KNOWLEDGE mapping matrix", () => {
    expect(RSS_FEEDS).toEqual({
      EVENT_UPDATES: {
        kind: "EVENT_UPDATES",
        publicationFeed: "EVENT",
        title: "PIS Event Updates",
        description: "PIS event and event-update publications",
        headKey: "event-updates.xml",
        pendingKey: "event-updates-pending.xml",
        archiveFilePrefix: "event-updates",
      },
      CURATED_CONTENT: {
        kind: "CURATED_CONTENT",
        publicationFeed: "KNOWLEDGE",
        title: "PIS Curated Content",
        description: "PIS curated knowledge publications",
        headKey: "curated-content.xml",
        pendingKey: "curated-content-pending.xml",
        archiveFilePrefix: "curated-content",
      },
    });
    expect(Object.isFrozen(RSS_FEEDS)).toBe(true);
    expect(Object.isFrozen(RSS_FEEDS.EVENT_UPDATES)).toBe(true);
    expect(getRssFeed("EVENT_UPDATES")).toBe(RSS_FEEDS.EVENT_UPDATES);
    expect(getRssFeed("CURATED_CONTENT")).toBe(RSS_FEEDS.CURATED_CONTENT);
  });

  it("rejects fuzzy or unknown feed names without falling back", () => {
    for (const value of ["event-updates", "EVENT", "UNKNOWN"]) {
      expect(() => getRssFeed(value as never)).toThrow(RssError);
    }
  });
});

describe("Published Item reader", () => {
  it("RSS-01/02_MAPPING keeps Event, Update and Knowledge in their exact Feed only", async () => {
    const repository = repositoryWith(rssFeedItems);
    const reader = createPublishedItemSource(repository);

    const eventItems = await reader.list("EVENT_UPDATES");
    const knowledgeItems = await reader.list("CURATED_CONTENT");

    expect(repository.listCalls).toEqual(["EVENT", "KNOWLEDGE"]);
    expect(repository.findCalls).toBe(0);
    expect(repository.insertCalls).toBe(0);
    expect(eventItems.map((item) => item.target_type)).toEqual([
      "EVENT_UPDATE",
      "EVENT",
    ]);
    expect(eventItems.map((item) => item.id)).toEqual([
      "rss-event-update",
      "rss-event-first",
    ]);
    expect(knowledgeItems.map((item) => item.target_type)).toEqual([
      "KNOWLEDGE",
    ]);
    expect(knowledgeItems.map((item) => item.id)).toEqual(["rss-knowledge"]);
  });

  it("returns a frozen seven-field snapshot without reordering repository output", async () => {
    const inputRows = {
      EVENT: [createRssPublishedItem({ id: "rss-stable" })],
      KNOWLEDGE: [],
    } satisfies Record<PublicationFeed, PublishedItem[]>;
    const repository = repositoryWith(inputRows);
    const result =
      await createPublishedItemSource(repository).list("EVENT_UPDATES");

    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(result[0]).toEqual({
      id: "rss-stable",
      target_type: "EVENT",
      target_id: "rss-target-event-first",
      title: "Event title",
      summary: "Event summary",
      body: expect.stringContaining("<p>Body content</p>"),
      published_at: "2026-11-20T08:00:00.000+08:00",
    });
    expect(Object.keys(result[0]!)).toEqual([
      "id",
      "target_type",
      "target_id",
      "title",
      "summary",
      "body",
      "published_at",
    ]);

    expect(result[0]).not.toBe(inputRows.EVENT[0]);
    expect(() => {
      (result[0] as { id: string }).id = "mutated-result";
    }).toThrow(TypeError);
  });

  it("rejects cross-Feed targets instead of silently filtering or reordering", async () => {
    const invalidEventRows = Object.freeze([
      createRssPublishedItem({
        target_type: "KNOWLEDGE",
        target_id: "rss-target-knowledge",
      }),
    ]);
    const repository = repositoryWith({
      EVENT: invalidEventRows,
      KNOWLEDGE: rssFeedItems.KNOWLEDGE,
    });

    await expect(
      createPublishedItemSource(repository).list("EVENT_UPDATES"),
    ).rejects.toMatchObject({ name: "RssError", code: "invalid_input" });
  });

  it("rejects malformed fields and invalid time", async () => {
    const malformedItems: readonly PublishedItem[] = [
      createRssPublishedItem({ id: "" }),
      createRssPublishedItem({ title: undefined as never }),
      createRssPublishedItem({ published_at: "not-a-time" }),
      createRssPublishedItem({
        published_at: "2026-02-30T08:00:00.000+08:00",
      }),
    ];

    for (const item of malformedItems) {
      const repository = repositoryWith({
        EVENT: [item],
        KNOWLEDGE: [],
      });
      const expectedCode = item.published_at.includes("2026-11-20")
        ? "invalid_input"
        : "invalid_time";
      await expect(
        createPublishedItemSource(repository).list("EVENT_UPDATES"),
      ).rejects.toMatchObject({ name: "RssError", code: expectedCode });
    }
  });

  it("preserves the repository's deterministic ID-DESC order for equal instants", async () => {
    const repository = repositoryWith({
      EVENT: [
        createRssPublishedItem({ id: "rss-b" }),
        createRssPublishedItem({ id: "rss-a" }),
      ],
      KNOWLEDGE: [],
    });
    const result =
      await createPublishedItemSource(repository).list("EVENT_UPDATES");

    expect(result.map((item) => item.id)).toEqual(["rss-b", "rss-a"]);
  });

  it("rejects unstable and duplicate repository rows instead of sorting them", async () => {
    const invalidRows = [
      [
        createRssPublishedItem({
          id: "rss-earlier",
          published_at: "2026-11-20T07:00:00.000+08:00",
        }),
        createRssPublishedItem({
          id: "rss-later",
          published_at: "2026-11-20T08:00:00.000+08:00",
        }),
      ],
      [
        createRssPublishedItem({ id: "rss-a" }),
        createRssPublishedItem({ id: "rss-b" }),
      ],
      [
        createRssPublishedItem({ id: "rss-duplicate" }),
        createRssPublishedItem({ id: "rss-duplicate" }),
      ],
    ] as const;

    for (const rows of invalidRows) {
      const repository = repositoryWith({
        EVENT: rows,
        KNOWLEDGE: [],
      });
      await expect(
        createPublishedItemSource(repository).list("EVENT_UPDATES"),
      ).rejects.toMatchObject({ name: "RssError", code: "invalid_input" });
    }
  });

  it("normalizes repository failures to a safe public error", async () => {
    const repository: PublishedItemRepository = {
      findByTarget: () => null,
      insert: () => {
        throw new Error("unexpected");
      },
      listForFeed: () => {
        throw new Error("private body and SQL must not be exposed");
      },
    };

    try {
      await createPublishedItemSource(repository).list("EVENT_UPDATES");
      throw new Error("Expected the reader to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RssError);
      expect((error as RssError).code).toBe("invalid_input");
      expect((error as Error).message).toBe("Invalid RSS input");
      expect((error as Error).message).not.toContain("private body");
    }
  });
});
