import { describe, expect, it } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";
import {
  RSS_FEEDS,
  RssError,
  discoverArchives,
  parseRssArchiveDocument,
  planAndRenderSync,
  renderRssArchive,
} from "../../src/rss/index.js";
import {
  MemoryRssArtifactStore,
  createRssItems,
  createRssPublishedItem,
  xmlBytesToText,
} from "../fixtures/rss.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;

function ids(count: number, start = 1): string[] {
  return Array.from(
    { length: count },
    (_, offset) => `rss-${String(start + offset).padStart(4, "0")}`,
  );
}

function reverseIds(count: number, end = count): string[] {
  return Array.from(
    { length: count },
    (_, offset) => `rss-${String(end - offset).padStart(4, "0")}`,
  );
}

function plannedIds(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id);
}

function expectRssError(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RssError);
    expect((error as RssError).code).toBe(code);
    return;
  }
  throw new Error(`Expected RssError(${code})`);
}

describe("RSS archive planning windows and chains", () => {
  it("RSS-08 plans 201 items as sealed 1..200, pending 201 and head 2..201", () => {
    const items = createRssItems(201);
    const plan = planAndRenderSync({ feed: "EVENT_UPDATES", items }, []);

    expect(plan.newArchives).toHaveLength(1);
    expect(plannedIds(plan.newArchives[0]!.items)).toEqual(ids(200));
    expect(plan.pendingGuidCount).toBe(1);
    const archive = parseRssArchiveDocument(
      EVENT_FEED,
      plan.newArchives[0]!.key,
      plan.newArchives[0]!.bytes,
    );
    const pending = parseRssArchiveDocument(
      EVENT_FEED,
      plan.pendingKey,
      plan.pendingBytes,
      { latestArchiveKey: plan.newArchives[0]!.key },
    );
    const head = parseRssArchiveDocument(
      EVENT_FEED,
      plan.headKey,
      plan.headBytes,
    );

    expect(archive.previousArchiveKey).toBeNull();
    expect(plannedIds(archive.items)).toEqual(ids(200));
    expect(pending.previousArchiveKey).toBe(plan.newArchives[0]!.key);
    expect(plannedIds(pending.items)).toEqual(["rss-0201"]);
    expect(plannedIds(head.items)).toEqual(reverseIds(200, 201));
    expect(head.previousArchiveKey).toBe(plan.pendingKey);
    expect(
      new Set([
        ...plannedIds(head.items),
        ...plannedIds(pending.items),
        ...plannedIds(archive.items),
      ]),
    ).toEqual(new Set(ids(201)));
  });

  it("RSS-09 covers 400, 401 and 451 item snapshots with exact static chains", () => {
    const expected = [
      {
        count: 400,
        archiveCount: 2,
        pending: [],
        head: reverseIds(200, 400),
      },
      {
        count: 401,
        archiveCount: 2,
        pending: ["rss-0401"],
        head: reverseIds(200, 401),
      },
      {
        count: 451,
        archiveCount: 2,
        pending: ids(51, 401),
        head: reverseIds(200, 451),
      },
    ] as const;

    for (const testCase of expected) {
      const plan = planAndRenderSync(
        { feed: "EVENT_UPDATES", items: createRssItems(testCase.count) },
        [],
      );
      expect(plan.newArchives).toHaveLength(testCase.archiveCount);
      expect(plan.pendingGuidCount).toBe(testCase.pending.length);

      const latestArchiveKey = plan.newArchives.at(-1)!.key;
      const pending = parseRssArchiveDocument(
        EVENT_FEED,
        plan.pendingKey,
        plan.pendingBytes,
        { latestArchiveKey },
      );
      const head = parseRssArchiveDocument(
        EVENT_FEED,
        plan.headKey,
        plan.headBytes,
      );
      expect(plannedIds(pending.items)).toEqual(testCase.pending);
      expect(plannedIds(head.items)).toEqual(testCase.head);
      expect(pending.previousArchiveKey).toBe(latestArchiveKey);
      expect(head.previousArchiveKey).toBe(plan.pendingKey);

      const archiveIds = plan.newArchives.flatMap((archive) =>
        plannedIds(archive.items),
      );
      expect(
        new Set([
          ...plannedIds(head.items),
          ...plannedIds(pending.items),
          ...archiveIds,
        ]),
      ).toEqual(new Set(ids(testCase.count)));
      expect(xmlBytesToText(plan.headBytes)).not.toContain("?before");
      expect(xmlBytesToText(plan.pendingBytes)).not.toContain("?before");
    }
  });

  it("RSS-10 uses ID-stable DESC head and ASC archive/pending ordering", () => {
    const publishedAt = "2026-11-20T00:00:00.000Z";
    const items = createRssItems(201).map((item) => ({
      ...item,
      published_at: publishedAt,
    }));

    const first = planAndRenderSync({ feed: "EVENT_UPDATES", items }, []);
    const second = planAndRenderSync({ feed: "EVENT_UPDATES", items }, []);
    const archive = parseRssArchiveDocument(
      EVENT_FEED,
      first.newArchives[0]!.key,
      first.newArchives[0]!.bytes,
    );
    const pending = parseRssArchiveDocument(
      EVENT_FEED,
      first.pendingKey,
      first.pendingBytes,
      { latestArchiveKey: first.newArchives[0]!.key },
    );
    const head = parseRssArchiveDocument(
      EVENT_FEED,
      first.headKey,
      first.headBytes,
    );

    expect(plannedIds(archive.items)).toEqual(ids(200));
    expect(plannedIds(pending.items)).toEqual(["rss-0201"]);
    expect(plannedIds(head.items)).toEqual(reverseIds(200, 201));
    expect(first.newArchives[0]!.bytes).toEqual(second.newArchives[0]!.bytes);
    expect(first.pendingBytes).toEqual(second.pendingBytes);
    expect(first.headBytes).toEqual(second.headBytes);

    for (const id of ["rss-0002", "rss-0201"]) {
      const headItem = head.items.find((item) => item.id === id);
      const archiveOrPendingItem =
        archive.items.find((item) => item.id === id) ??
        pending.items.find((item) => item.id === id);
      expect(headItem).toEqual(archiveOrPendingItem);
    }
  });

  it("reuses archived GUID boundaries without re-slicing sealed members", async () => {
    const initialItems = [...createRssItems(2)].reverse();
    const firstArchiveBytes = renderRssArchive({
      feed: EVENT_FEED,
      items: initialItems,
      documentHref: "archive/event-updates-0001.xml",
      previousArchiveHref: null,
    });
    const store = new MemoryRssArtifactStore({
      "archive/event-updates-0001.xml": firstArchiveBytes,
    });
    const archives = await discoverArchives(store, EVENT_FEED, 2);
    const plan = planAndRenderSync(
      { feed: "EVENT_UPDATES", items: createRssItems(5) },
      archives,
      { archiveBatchSize: 2 },
    );

    expect(plan.existingArchiveKeys).toEqual([
      "archive/event-updates-0001.xml",
    ]);
    expect(plan.newArchives).toHaveLength(1);
    expect(plannedIds(plan.newArchives[0]!.items)).toEqual([
      "rss-0003",
      "rss-0004",
    ]);
    expect(plan.pendingGuidCount).toBe(1);
    expect(plan.archivedOnlyGuidCount).toBe(0);
  });

  it("counts archived-only GUIDs and rejects invalid sizes or duplicate snapshots", () => {
    const archived = createRssPublishedItem({
      id: "archived-only",
      published_at: "2025-01-01T00:00:00.000Z",
    });
    const kept = createRssPublishedItem({
      id: "kept",
      published_at: "2026-01-01T00:00:00.000Z",
    });
    const archivedBytes = renderRssArchive({
      feed: EVENT_FEED,
      items: [archived],
      documentHref: "archive/event-updates-0001.xml",
      previousArchiveHref: null,
    });
    const document = parseRssArchiveDocument(
      EVENT_FEED,
      "archive/event-updates-0001.xml",
      archivedBytes,
      { batchSize: 1 },
    );
    const plan = planAndRenderSync(
      { feed: "EVENT_UPDATES", items: [kept] },
      [
        {
          feed: "EVENT_UPDATES",
          sequence: 1,
          key: "archive/event-updates-0001.xml",
          bytes: archivedBytes,
          document,
        },
      ],
      { archiveBatchSize: 1 },
    );

    expect(plan.archivedOnlyGuidCount).toBe(1);
    expect(plan.pendingGuidCount).toBe(0);
    for (const options of [
      { headLimit: 0 },
      { headLimit: 201 },
      { archiveBatchSize: 0 },
      { archiveBatchSize: 201 },
      { archiveBatchSize: 1.5 },
    ]) {
      expectRssError(
        () =>
          planAndRenderSync(
            { feed: "EVENT_UPDATES", items: [kept] },
            [],
            options,
          ),
        "invalid_input",
      );
    }
    expectRssError(
      () =>
        planAndRenderSync({ feed: "EVENT_UPDATES", items: [kept, kept] }, []),
      "invalid_input",
    );
  });
});
