import { describe, expect, it } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";
import {
  RSS_FEEDS,
  RssError,
  buildRssArchiveKey,
  createRssSyncService,
  discoverArchives,
  parseRssArchiveDocument,
  planAndRenderSync,
  renderRssArchive,
} from "../../src/rss/index.js";
import type { RssFeedKind } from "../../src/rss/index.js";
import {
  MemoryRssArtifactStore,
  StubRssPublishedItemReader,
  createRssItems,
  createRssPublishedItem,
  xmlBytesToText,
} from "../fixtures/rss.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;
const CURATED_FEED = RSS_FEEDS.CURATED_CONTENT;
const EVENT_ARCHIVE_ONE = "archive/event-updates-0001.xml";
const EVENT_ARCHIVE_TWO = "archive/event-updates-0002.xml";

function rows(
  event: readonly PublishedItem[] = [],
  curated: readonly PublishedItem[] = [],
): Readonly<Record<RssFeedKind, readonly PublishedItem[]>> {
  return { EVENT_UPDATES: event, CURATED_CONTENT: curated };
}

function parsePending(
  store: MemoryRssArtifactStore,
  feed: typeof EVENT_FEED | typeof CURATED_FEED,
  batchSize: number,
  latestArchiveKey: string | null,
) {
  const bytes = store.bytes(feed.pendingKey);
  if (bytes === null) {
    throw new Error("Expected pending bytes");
  }
  return parseRssArchiveDocument(feed, feed.pendingKey, bytes, {
    batchSize,
    latestArchiveKey,
  });
}

function parseHead(
  store: MemoryRssArtifactStore,
  feed: typeof EVENT_FEED | typeof CURATED_FEED,
) {
  const bytes = store.bytes(feed.headKey);
  if (bytes === null) {
    throw new Error("Expected head bytes");
  }
  return parseRssArchiveDocument(feed, feed.headKey, bytes);
}

function itemIds(items: readonly { readonly id: string }[]): string[] {
  return items.map((item) => item.id);
}

function expectRssError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(RssError);
  expect((error as RssError).code).toBe(code);
}

describe("RSS sync write order and static coverage", () => {
  it("RSS-08 writes 201 items as archive, pending, head and exposes the full chain", async () => {
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));
    const store = new MemoryRssArtifactStore();
    const service = createRssSyncService({ reader, store });
    const result = await service.sync("EVENT_UPDATES");

    expect(store.writeKeys).toEqual([
      EVENT_ARCHIVE_ONE,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
    ]);
    expect(store.writeAttempts).toEqual([
      { key: EVENT_ARCHIVE_ONE, onlyIfAbsent: true },
      { key: EVENT_FEED.pendingKey, onlyIfAbsent: false },
      { key: EVENT_FEED.headKey, onlyIfAbsent: false },
    ]);
    expect(result).toEqual({
      feed: "EVENT_UPDATES",
      headKey: EVENT_FEED.headKey,
      pendingKey: EVENT_FEED.pendingKey,
      pendingGuidCount: 1,
      existingArchiveKeys: [],
      createdArchiveKeys: [EVENT_ARCHIVE_ONE],
      archivedOnlyGuidCount: 0,
    });

    const archive = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_ONE,
      store.bytes(EVENT_ARCHIVE_ONE)!,
    );
    const pending = parsePending(store, EVENT_FEED, 200, EVENT_ARCHIVE_ONE);
    const head = parseHead(store, EVENT_FEED);
    expect(itemIds(archive.items)[0]).toBe("rss-0001");
    expect(itemIds(archive.items).at(-1)).toBe("rss-0200");
    expect(itemIds(pending.items)).toEqual(["rss-0201"]);
    expect(itemIds(head.items)).toEqual(
      Array.from(
        { length: 200 },
        (_, offset) => `rss-${String(201 - offset).padStart(4, "0")}`,
      ),
    );
    expect(head.previousArchiveKey).toBe(EVENT_FEED.pendingKey);
    expect(pending.previousArchiveKey).toBe(EVENT_ARCHIVE_ONE);
    expect(xmlBytesToText(store.bytes(EVENT_FEED.headKey)!)).not.toMatch(
      /<fh:archive\s*\/>/u,
    );
    expect(xmlBytesToText(store.bytes(EVENT_FEED.pendingKey)!)).toMatch(
      /<fh:archive\s*\/>/u,
    );
    expect(
      new Set([
        ...itemIds(head.items),
        ...itemIds(pending.items),
        ...itemIds(archive.items),
      ]).size,
    ).toBe(201);
  });

  it("RSS-09 writes both full archives before pending/head for a 451-item snapshot", async () => {
    const reader = new StubRssPublishedItemReader(rows(createRssItems(451)));
    const store = new MemoryRssArtifactStore();

    await createRssSyncService({ reader, store }).sync("EVENT_UPDATES");
    expect(store.writeKeys).toEqual([
      EVENT_ARCHIVE_ONE,
      EVENT_ARCHIVE_TWO,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
    ]);
    const archiveTwo = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_TWO,
      store.bytes(EVENT_ARCHIVE_TWO)!,
    );
    const pending = parsePending(store, EVENT_FEED, 200, EVENT_ARCHIVE_TWO);
    const head = parseHead(store, EVENT_FEED);
    expect(archiveTwo.previousArchiveKey).toBe(EVENT_ARCHIVE_ONE);
    expect(itemIds(pending.items).at(0)).toBe("rss-0401");
    expect(itemIds(pending.items).at(-1)).toBe("rss-0451");
    expect(itemIds(head.items).at(0)).toBe("rss-0451");
    expect(itemIds(head.items).at(-1)).toBe("rss-0252");
    expect(xmlBytesToText(store.bytes(EVENT_FEED.headKey)!)).not.toContain(
      "?before",
    );
    expect(xmlBytesToText(store.bytes(EVENT_FEED.pendingKey)!)).not.toContain(
      "?before",
    );
  });

  it("RSS-10 keeps repeated head/pending/archive payloads byte-stable", async () => {
    const publishedAt = "2026-11-20T00:00:00.000Z";
    const items = createRssItems(201).map((item) => ({
      ...item,
      published_at: publishedAt,
    }));
    const reader = new StubRssPublishedItemReader(rows(items));
    const store = new MemoryRssArtifactStore();
    const service = createRssSyncService({ reader, store });

    await service.sync("EVENT_UPDATES");
    const archiveBefore = store.bytes(EVENT_ARCHIVE_ONE)!;
    const pendingBefore = store.bytes(EVENT_FEED.pendingKey)!;
    const headBefore = store.bytes(EVENT_FEED.headKey)!;
    store.writeKeys.length = 0;
    store.writeAttempts.length = 0;
    const second = await service.sync("EVENT_UPDATES");

    expect(second.createdArchiveKeys).toEqual([]);
    expect(store.writeKeys).toEqual([
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
    ]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(archiveBefore);
    expect(store.bytes(EVENT_FEED.pendingKey)).toEqual(pendingBefore);
    expect(store.bytes(EVENT_FEED.headKey)).toEqual(headBefore);

    const archive = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_ONE,
      archiveBefore,
    );
    const pending = parsePending(store, EVENT_FEED, 200, EVENT_ARCHIVE_ONE);
    const head = parseHead(store, EVENT_FEED);
    for (const id of ["rss-0002", "rss-0201"]) {
      const headItem = head.items.find((item) => item.id === id);
      const otherItem =
        archive.items.find((item) => item.id === id) ??
        pending.items.find((item) => item.id === id);
      expect(headItem).toEqual(otherItem);
    }
  });

  it("RSS-17 interleaves two Feed syncs without crossing item or archive boundaries", async () => {
    const withKnowledgeIds = (
      items: readonly PublishedItem[],
    ): readonly PublishedItem[] =>
      items.map((item) => ({
        ...item,
        id: `knowledge-${item.id.slice("rss-".length)}`,
        target_id: `knowledge-target-${item.id.slice("rss-".length)}`,
      }));
    const eventItems = createRssItems(201);
    const curatedItems = withKnowledgeIds(createRssItems(201, "KNOWLEDGE"));
    const reader = new StubRssPublishedItemReader(
      rows(eventItems, curatedItems),
    );
    const store = new MemoryRssArtifactStore();
    const service = createRssSyncService({ reader, store });

    await service.sync("EVENT_UPDATES");
    await service.sync("CURATED_CONTENT");
    await service.sync("EVENT_UPDATES");
    await service.sync("CURATED_CONTENT");

    const expandedEventItems = createRssItems(401);
    const expandedCuratedItems = withKnowledgeIds(
      createRssItems(401, "KNOWLEDGE"),
    );
    reader.replace(rows(expandedEventItems, expandedCuratedItems));
    await service.sync("EVENT_UPDATES");
    await service.sync("CURATED_CONTENT");
    expect(store.writeKeys).toEqual([
      EVENT_ARCHIVE_ONE,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
      "archive/curated-content-0001.xml",
      CURATED_FEED.pendingKey,
      CURATED_FEED.headKey,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
      CURATED_FEED.pendingKey,
      CURATED_FEED.headKey,
      EVENT_ARCHIVE_TWO,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
      "archive/curated-content-0002.xml",
      CURATED_FEED.pendingKey,
      CURATED_FEED.headKey,
    ]);

    const eventArchiveOne = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_ONE,
      store.bytes(EVENT_ARCHIVE_ONE)!,
    );
    const eventArchiveTwo = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_TWO,
      store.bytes(EVENT_ARCHIVE_TWO)!,
    );
    const eventPending = parsePending(
      store,
      EVENT_FEED,
      200,
      EVENT_ARCHIVE_TWO,
    );
    const eventHead = parseHead(store, EVENT_FEED);
    const curatedArchiveOne = parseRssArchiveDocument(
      CURATED_FEED,
      "archive/curated-content-0001.xml",
      store.bytes("archive/curated-content-0001.xml")!,
    );
    const curatedArchiveTwo = parseRssArchiveDocument(
      CURATED_FEED,
      "archive/curated-content-0002.xml",
      store.bytes("archive/curated-content-0002.xml")!,
    );
    const curatedPending = parsePending(
      store,
      CURATED_FEED,
      200,
      "archive/curated-content-0002.xml",
    );
    const curatedHead = parseHead(store, CURATED_FEED);

    const eventIds = [
      ...itemIds(eventArchiveOne.items),
      ...itemIds(eventArchiveTwo.items),
      ...itemIds(eventPending.items),
      ...itemIds(eventHead.items),
    ];
    const curatedIds = [
      ...itemIds(curatedArchiveOne.items),
      ...itemIds(curatedArchiveTwo.items),
      ...itemIds(curatedPending.items),
      ...itemIds(curatedHead.items),
    ];
    expect(eventIds.every((id) => id.startsWith("rss-"))).toBe(true);
    expect(curatedIds.every((id) => id.startsWith("knowledge-"))).toBe(true);
    expect(new Set(eventIds)).toEqual(
      new Set(expandedEventItems.map((item) => item.id)),
    );
    expect(new Set(curatedIds)).toEqual(
      new Set(expandedCuratedItems.map((item) => item.id)),
    );
  });
});

describe("RSS immutable history, recovery and failure isolation", () => {
  it("rejects a visible sealed archive whose payload differs from the current snapshot", async () => {
    const currentItems = createRssItems(200);
    const archiveItems = [...currentItems]
      .reverse()
      .map((item, index) =>
        index === 0 ? { ...item, title: "Drifted sealed archive title" } : item,
      );
    const conflictingArchive = renderRssArchive({
      feed: EVENT_FEED,
      items: archiveItems,
      documentHref: EVENT_ARCHIVE_ONE,
      previousArchiveHref: null,
    });
    const pendingBefore = new TextEncoder().encode("old pending bytes");
    const headBefore = new TextEncoder().encode("old head bytes");
    const store = new MemoryRssArtifactStore({
      [EVENT_ARCHIVE_ONE]: conflictingArchive,
      [EVENT_FEED.pendingKey]: pendingBefore,
      [EVENT_FEED.headKey]: headBefore,
    });

    const discovered = await discoverArchives(store, EVENT_FEED, 200);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.document.items).toHaveLength(200);
    expect(new Set(itemIds(discovered[0]!.document.items))).toEqual(
      new Set(currentItems.map((item) => item.id)),
    );

    const reader = new StubRssPublishedItemReader(rows(currentItems));
    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);

    expectRssError(error, "archive_conflict");
    expect(store.writeAttempts).toEqual([]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(conflictingArchive);
    expect(store.bytes(EVENT_FEED.pendingKey)).toEqual(pendingBefore);
    expect(store.bytes(EVENT_FEED.headKey)).toEqual(headBefore);
  });

  it("RSS-11/24 keeps sealed bytes through late/callback items and rebalances only pending", async () => {
    const initial = createRssItems(4);
    const reader = new StubRssPublishedItemReader(rows(initial));
    const store = new MemoryRssArtifactStore();
    const service = createRssSyncService({
      reader,
      store,
      options: { archiveBatchSize: 3 },
    });
    await service.sync("EVENT_UPDATES");
    const archiveBefore = store.bytes(EVENT_ARCHIVE_ONE)!;

    const late = createRssPublishedItem({
      id: "rss-late",
      target_id: "rss-target-late",
      published_at: "2025-12-31T00:00:00.000Z",
    });
    reader.replace(rows([...initial, late]));
    await service.sync("EVENT_UPDATES");
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(archiveBefore);
    expect(
      itemIds(parsePending(store, EVENT_FEED, 3, EVENT_ARCHIVE_ONE).items),
    ).toEqual(["rss-late", "rss-0004"]);

    const callback = createRssPublishedItem({
      id: "rss-callback",
      target_id: "rss-target-callback",
      published_at: "2025-01-01T00:00:00.000Z",
    });
    reader.replace(rows([...initial, late, callback]));
    await service.sync("EVENT_UPDATES");

    const archiveTwo = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_ARCHIVE_TWO,
      store.bytes(EVENT_ARCHIVE_TWO)!,
      { batchSize: 3 },
    );
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(archiveBefore);
    expect(itemIds(archiveTwo.items)).toEqual([
      "rss-callback",
      "rss-late",
      "rss-0004",
    ]);
    expect(parsePending(store, EVENT_FEED, 3, EVENT_ARCHIVE_TWO).items).toEqual(
      [],
    );
  });

  it("retains a same-key archive conflict without pending/head writes", async () => {
    const expectedPlan = planAndRenderSync(
      { feed: "EVENT_UPDATES", items: createRssItems(201) },
      [],
    );
    const conflicting = new TextEncoder().encode("old conflicting archive");
    const pendingBefore = new TextEncoder().encode("old pending bytes");
    const headBefore = new TextEncoder().encode("old head bytes");
    const store = new MemoryRssArtifactStore({
      [EVENT_ARCHIVE_ONE]: conflicting,
      [EVENT_FEED.pendingKey]: pendingBefore,
      [EVENT_FEED.headKey]: headBefore,
    });
    expect(expectedPlan.newArchives[0]!.key).toBe(EVENT_ARCHIVE_ONE);
    store.hideFromList(EVENT_ARCHIVE_ONE);
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));

    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "archive_conflict");
    expect(store.writeAttempts).toEqual([]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(conflicting);
    expect(store.bytes(EVENT_FEED.pendingKey)).toEqual(pendingBefore);
    expect(store.bytes(EVENT_FEED.headKey)).toEqual(headBefore);
  });

  it("reuses a hidden same-name archive only when its bytes are identical", async () => {
    const expectedPlan = planAndRenderSync(
      { feed: "EVENT_UPDATES", items: createRssItems(201) },
      [],
    );
    const expectedArchive = expectedPlan.newArchives[0]!.bytes;
    const store = new MemoryRssArtifactStore({
      [EVENT_ARCHIVE_ONE]: expectedArchive,
    });
    store.hideFromList(EVENT_ARCHIVE_ONE);
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));
    const result = await createRssSyncService({ reader, store }).sync(
      "EVENT_UPDATES",
    );

    expect(result.createdArchiveKeys).toEqual([]);
    expect(store.writeKeys).toEqual([
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
    ]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(expectedArchive);
  });

  it("does not write pending/head after archive write failure and keeps completed archives", async () => {
    const items = createRssItems(401);
    const store = new MemoryRssArtifactStore();
    store.failNextWrite(EVENT_ARCHIVE_TWO);
    const reader = new StubRssPublishedItemReader(rows(items));

    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "artifact_write_failed");
    expect(store.writeAttempts).toEqual([
      { key: EVENT_ARCHIVE_ONE, onlyIfAbsent: true },
      { key: EVENT_ARCHIVE_TWO, onlyIfAbsent: true },
    ]);
    expect(store.writeKeys).toEqual([EVENT_ARCHIVE_ONE]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).not.toBeNull();
    expect(store.bytes(EVENT_FEED.pendingKey)).toBeNull();
    expect(store.bytes(EVENT_FEED.headKey)).toBeNull();
  });

  it("keeps a completed archive but not head when pending write fails", async () => {
    const store = new MemoryRssArtifactStore();
    store.failNextWrite(EVENT_FEED.pendingKey);
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));

    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "artifact_write_failed");
    expect(store.writeAttempts.map(({ key }) => key)).toEqual([
      EVENT_ARCHIVE_ONE,
      EVENT_FEED.pendingKey,
    ]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).not.toBeNull();
    expect(store.bytes(EVENT_FEED.pendingKey)).toBeNull();
    expect(store.bytes(EVENT_FEED.headKey)).toBeNull();
  });

  it("keeps the new pending and old head when head write fails", async () => {
    const oldHead = new TextEncoder().encode("old head");
    const store = new MemoryRssArtifactStore({
      [EVENT_FEED.headKey]: oldHead,
    });
    store.failNextWrite(EVENT_FEED.headKey);
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));

    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "artifact_write_failed");
    expect(store.writeAttempts.map(({ key }) => key)).toEqual([
      EVENT_ARCHIVE_ONE,
      EVENT_FEED.pendingKey,
      EVENT_FEED.headKey,
    ]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).not.toBeNull();
    expect(
      itemIds(parsePending(store, EVENT_FEED, 200, EVENT_ARCHIVE_ONE).items),
    ).toEqual(["rss-0201"]);
    expect(store.bytes(EVENT_FEED.headKey)).toEqual(oldHead);
  });

  it("rejects corrupted sealed archives before writing pending/head", async () => {
    const sentinelPending = new TextEncoder().encode("do not replace pending");
    const sentinelHead = new TextEncoder().encode("do not replace head");
    const store = new MemoryRssArtifactStore({
      [EVENT_ARCHIVE_ONE]: new TextEncoder().encode("corrupt archive"),
      [EVENT_FEED.pendingKey]: sentinelPending,
      [EVENT_FEED.headKey]: sentinelHead,
    });
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));

    const error = await createRssSyncService({ reader, store })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "invalid_archive");
    expect(store.writeAttempts).toEqual([]);
    expect(store.bytes(EVENT_FEED.pendingKey)).toEqual(sentinelPending);
    expect(store.bytes(EVENT_FEED.headKey)).toEqual(sentinelHead);
  });

  it("rebuilds missing or damaged pending and head without touching sealed archives", async () => {
    const reader = new StubRssPublishedItemReader(rows(createRssItems(201)));
    const store = new MemoryRssArtifactStore();
    const service = createRssSyncService({ reader, store });
    await service.sync("EVENT_UPDATES");
    const archiveBefore = store.bytes(EVENT_ARCHIVE_ONE)!;

    store.seed(
      EVENT_FEED.pendingKey,
      new TextEncoder().encode("damaged pending"),
    );
    store.seed(EVENT_FEED.headKey, new TextEncoder().encode("damaged head"));
    await service.sync("EVENT_UPDATES");

    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(archiveBefore);
    expect(
      itemIds(parsePending(store, EVENT_FEED, 200, EVENT_ARCHIVE_ONE).items),
    ).toEqual(["rss-0201"]);
    expect(itemIds(parseHead(store, EVENT_FEED).items)[0]).toBe("rss-0201");
  });

  it("rejects an existing archive with an invalid expected chain without repair", async () => {
    const first = [...createRssItems(1)].reverse();
    const one = renderRssArchive({
      feed: EVENT_FEED,
      items: first,
      documentHref: buildRssArchiveKey(EVENT_FEED, 1),
      previousArchiveHref: null,
    });
    const broken = new TextEncoder().encode(
      xmlBytesToText(one).replace(
        "<fh:archive/>",
        '<atom:link rel="prev-archive" href="archive/event-updates-0003.xml"/><fh:archive/>',
      ),
    );
    const store = new MemoryRssArtifactStore({ [EVENT_ARCHIVE_ONE]: broken });
    const reader = new StubRssPublishedItemReader(rows(first));

    const error = await createRssSyncService({
      reader,
      store,
      options: { archiveBatchSize: 1 },
    })
      .sync("EVENT_UPDATES")
      .catch((caught: unknown) => caught);
    expectRssError(error, "invalid_archive");
    expect(store.writeAttempts).toEqual([]);
    expect(store.bytes(EVENT_ARCHIVE_ONE)).toEqual(broken);
  });
});
