import { describe, expect, it } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";
import {
  RSS_FEEDS,
  RssError,
  buildRssArchiveKey,
  discoverArchives,
  parseRssArchiveDocument,
  parseRssArchiveKey,
  renderRssArchive,
  renderRssHead,
  renderRssPending,
} from "../../src/rss/index.js";
import {
  MemoryRssArtifactStore,
  createRssItems,
  createRssPublishedItem,
  xmlBytesToText,
} from "../fixtures/rss.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;
const CURATED_FEED = RSS_FEEDS.CURATED_CONTENT;
const ARCHIVE_ONE = "archive/event-updates-0001.xml";
const ARCHIVE_TWO = "archive/event-updates-0002.xml";

function archive(items: readonly PublishedItem[], sequence = 1): Uint8Array {
  return renderRssArchive({
    feed: EVENT_FEED,
    items,
    documentHref: buildRssArchiveKey(EVENT_FEED, sequence),
    previousArchiveHref:
      sequence === 1 ? null : buildRssArchiveKey(EVENT_FEED, sequence - 1),
  });
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

describe("RSS archive keys and document parsing", () => {
  it("accepts only exact feed archive keys and the feed root pending key", () => {
    expect(buildRssArchiveKey(EVENT_FEED, 1)).toBe(ARCHIVE_ONE);
    expect(parseRssArchiveKey(EVENT_FEED, ARCHIVE_ONE)).toBe(1);
    expect(parseRssArchiveKey(EVENT_FEED, ARCHIVE_TWO)).toBe(2);

    for (const key of [
      "archive/event-updates-0000.xml",
      "archive/event-updates-0001.xml?before=next",
      "archive/event-updates-000.xml",
      "archive/event-updates-0001.xml.bak",
      "archive/curated-content-0001.xml",
      "../archive/event-updates-0001.xml",
    ]) {
      expectRssError(
        () => parseRssArchiveKey(EVENT_FEED, key),
        "invalid_archive",
      );
    }
  });

  it("parses single and array item shapes without losing the full item payload", () => {
    const first = createRssPublishedItem({
      id: "rss-parse-0001",
      title: "Parsed title",
      summary: "Parsed summary",
      body: "<p>Parsed body</p>",
    });
    const bytes = archive([first], 1);
    const document = parseRssArchiveDocument(EVENT_FEED, ARCHIVE_ONE, bytes, {
      batchSize: 1,
    });

    expect(document.documentType).toBe("archive");
    expect(document.previousArchiveKey).toBeNull();
    expect(document.items).toEqual([
      expect.objectContaining({
        id: first.id,
        guid: `pis:published:${first.id}`,
        title: first.title,
        link: null,
        summary: first.summary,
        body: first.body,
        pubDate: new Date(first.published_at).toUTCString(),
      }),
    ]);
  });

  it("parses zero and partial pending documents and keeps their previous chain", () => {
    const zero = renderRssPending({
      feed: EVENT_FEED,
      items: [],
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: null,
    });
    const partial = renderRssPending({
      feed: EVENT_FEED,
      items: [createRssPublishedItem({ id: "pending-201" })],
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: ARCHIVE_ONE,
    });

    expect(
      parseRssArchiveDocument(EVENT_FEED, EVENT_FEED.pendingKey, zero, {
        latestArchiveKey: null,
      }).items,
    ).toEqual([]);
    const parsed = parseRssArchiveDocument(
      EVENT_FEED,
      EVENT_FEED.pendingKey,
      partial,
      { latestArchiveKey: ARCHIVE_ONE },
    );
    expect(parsed.documentType).toBe("pending");
    expect(parsed.previousArchiveKey).toBe(ARCHIVE_ONE);
    expect(parsed.items.map((item) => item.id)).toEqual(["pending-201"]);
  });

  it("rejects wrong RFC 5005 markers, Feed identity and cross-Feed keys", () => {
    const pending = xmlBytesToText(
      renderRssPending({
        feed: EVENT_FEED,
        items: [createRssPublishedItem()],
        documentHref: EVENT_FEED.pendingKey,
        previousArchiveHref: null,
      }),
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          new TextEncoder().encode(pending.replace("<fh:archive/>", "")),
        ),
      "invalid_pending",
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          new TextEncoder().encode(
            pending.replace(EVENT_FEED.title, "Wrong Feed title"),
          ),
        ),
      "invalid_pending",
    );

    const head = xmlBytesToText(
      renderRssHead({
        feed: EVENT_FEED,
        items: [createRssPublishedItem()],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.headKey,
          new TextEncoder().encode(
            head.replace("<description>", "<fh:archive/><description>"),
          ),
        ),
      "invalid_archive",
    );
    const archiveBytes = archive([createRssPublishedItem()], 1);
    expectRssError(
      () =>
        parseRssArchiveDocument(
          CURATED_FEED,
          "archive/curated-content-0001.xml",
          archiveBytes,
          { batchSize: 1 },
        ),
      "invalid_archive",
    );
  });

  it("rejects duplicate GUIDs, non-batch archives, empty archives and oversized pending", () => {
    const first = createRssPublishedItem({ id: "duplicate-a" });
    const second = createRssPublishedItem({ id: "duplicate-b" });
    const duplicateBytes = xmlBytesToText(archive([first, second], 1)).replace(
      "pis:published:duplicate-b",
      "pis:published:duplicate-a",
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          ARCHIVE_ONE,
          new TextEncoder().encode(duplicateBytes),
          { batchSize: 2 },
        ),
      "invalid_archive",
    );

    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          ARCHIVE_ONE,
          archive([first, second], 1),
          { batchSize: 3 },
        ),
      "invalid_archive",
    );
    const emptyPending = xmlBytesToText(
      renderRssPending({
        feed: EVENT_FEED,
        items: [],
        documentHref: EVENT_FEED.pendingKey,
        previousArchiveHref: null,
      }),
    ).replace(EVENT_FEED.pendingKey, ARCHIVE_ONE);
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          ARCHIVE_ONE,
          new TextEncoder().encode(emptyPending),
          { batchSize: 3 },
        ),
      "invalid_archive",
    );

    const pendingThree = renderRssPending({
      feed: EVENT_FEED,
      items: [first, second, createRssPublishedItem({ id: "pending-c" })],
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: null,
    });
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          pendingThree,
          { batchSize: 3 },
        ),
      "invalid_pending",
    );

    const pendingOneHundredNinetyNine = xmlBytesToText(
      renderRssPending({
        feed: EVENT_FEED,
        items: [...createRssItems(199)].reverse(),
        documentHref: EVENT_FEED.pendingKey,
        previousArchiveHref: null,
      }),
    );
    const extraItemXml = xmlBytesToText(
      renderRssHead({
        feed: EVENT_FEED,
        items: [createRssItems(200)[0]!],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    ).match(/<item>[\s\S]*?<\/item>/u)?.[0];
    if (extraItemXml === undefined) {
      throw new Error("Expected synthetic item XML");
    }
    const pendingTwoHundred = new TextEncoder().encode(
      pendingOneHundredNinetyNine.replace(
        "</channel>",
        `${extraItemXml}</channel>`,
      ),
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          pendingTwoHundred,
        ),
      "invalid_pending",
    );
  });

  it("rejects wrong previous links for archives, pending and head", () => {
    const items = [createRssPublishedItem({ id: "archive-item" })];
    const archiveTwo = xmlBytesToText(archive(items, 2)).replace(
      ARCHIVE_ONE,
      buildRssArchiveKey(EVENT_FEED, 3),
    );
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          ARCHIVE_TWO,
          new TextEncoder().encode(archiveTwo),
          { batchSize: 1 },
        ),
      "invalid_archive",
    );

    const pending = renderRssPending({
      feed: EVENT_FEED,
      items,
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: ARCHIVE_ONE,
    });
    expectRssError(
      () =>
        parseRssArchiveDocument(EVENT_FEED, EVENT_FEED.pendingKey, pending, {
          latestArchiveKey: ARCHIVE_TWO,
        }),
      "invalid_pending",
    );

    const head = xmlBytesToText(
      renderRssHead({
        feed: EVENT_FEED,
        items,
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    ).replace(EVENT_FEED.pendingKey, ARCHIVE_ONE);
    expectRssError(
      () =>
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.headKey,
          new TextEncoder().encode(head),
        ),
      "invalid_archive",
    );
  });
});

describe("RSS static archive discovery", () => {
  it("discovers only the requested Feed in sequence and preserves bytes", async () => {
    const eventOne = archive([createRssPublishedItem({ id: "event-1" })], 1);
    const eventTwo = archive([createRssPublishedItem({ id: "event-2" })], 2);
    const curated = renderRssArchive({
      feed: CURATED_FEED,
      items: [
        createRssPublishedItem({
          id: "knowledge-1",
          target_type: "KNOWLEDGE",
        }),
      ],
      documentHref: "archive/curated-content-0001.xml",
      previousArchiveHref: null,
    });
    const store = new MemoryRssArtifactStore({
      [ARCHIVE_ONE]: eventOne,
      [ARCHIVE_TWO]: eventTwo,
      "archive/curated-content-0001.xml": curated,
    });

    const discovered = await discoverArchives(store, EVENT_FEED, 1);
    expect(discovered.map(({ sequence, key }) => ({ sequence, key }))).toEqual([
      { sequence: 1, key: ARCHIVE_ONE },
      { sequence: 2, key: ARCHIVE_TWO },
    ]);
    expect(discovered[0]?.bytes).toEqual(eventOne);
    expect(discovered[1]?.bytes).toEqual(eventTwo);
    expect(
      discovered.flatMap((entry) =>
        entry.document.items.map((item) => item.id),
      ),
    ).toEqual(["event-1", "event-2"]);
  });

  it("rejects holes, malformed own keys, cross-archive duplicate GUIDs and bad chains", async () => {
    const one = archive([createRssPublishedItem({ id: "event-1" })], 1);
    const three = archive([createRssPublishedItem({ id: "event-3" })], 3);
    await expect(
      discoverArchives(
        new MemoryRssArtifactStore({
          [ARCHIVE_ONE]: one,
          "archive/event-updates-0003.xml": three,
        }),
        EVENT_FEED,
        1,
      ),
    ).rejects.toMatchObject({ code: "invalid_archive" });

    await expect(
      discoverArchives(
        new MemoryRssArtifactStore({
          [ARCHIVE_ONE]: one,
          "archive/event-updates-not-a-sequence.xml": one,
        }),
        EVENT_FEED,
        1,
      ),
    ).rejects.toMatchObject({ code: "invalid_archive" });

    const two = archive([createRssPublishedItem({ id: "event-2" })], 2);
    const duplicate = xmlBytesToText(two).replace(
      "pis:published:event-2",
      "pis:published:event-1",
    );
    await expect(
      discoverArchives(
        new MemoryRssArtifactStore({
          [ARCHIVE_ONE]: one,
          [ARCHIVE_TWO]: new TextEncoder().encode(duplicate),
        }),
        EVENT_FEED,
        1,
      ),
    ).rejects.toMatchObject({ code: "invalid_archive" });

    const brokenChain = xmlBytesToText(two).replace(
      ARCHIVE_ONE,
      buildRssArchiveKey(EVENT_FEED, 3),
    );
    await expect(
      discoverArchives(
        new MemoryRssArtifactStore({
          [ARCHIVE_ONE]: one,
          [ARCHIVE_TWO]: new TextEncoder().encode(brokenChain),
        }),
        EVENT_FEED,
        1,
      ),
    ).rejects.toMatchObject({ code: "invalid_archive" });
  });
});
