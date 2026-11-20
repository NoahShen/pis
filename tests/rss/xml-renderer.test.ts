import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";
import {
  RSS_ARCHIVE_BATCH_SIZE,
  RSS_FEEDS,
  RssError,
  renderRssArchive,
  renderRssDocument,
  renderRssHead,
  renderRssPending,
} from "../../src/rss/index.js";
import {
  RSS_SOURCE_URLS,
  createRssPublishedItem,
  parseRssXml,
  parsedRssItems,
  sourceSection,
  xmlBytesToText,
  type ParsedRssDocument,
  type ParsedRssItem,
} from "../fixtures/rss.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;
const CURATED_FEED = RSS_FEEDS.CURATED_CONTENT;

function validateAndParse(bytes: Uint8Array): ParsedRssDocument {
  const xml = xmlBytesToText(bytes);
  expect(XMLValidator.validate(xml)).toBe(true);
  return parseRssXml(xml);
}

function itemAt(items: readonly ParsedRssItem[], index = 0): ParsedRssItem {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing parsed RSS item ${index}`);
  }
  return item;
}

function guidParts(item: ParsedRssItem): {
  readonly isPermaLink: string;
  readonly value: string;
} {
  if (typeof item.guid === "string") {
    return { isPermaLink: "", value: item.guid };
  }
  return {
    isPermaLink: item.guid["@isPermaLink"] ?? "",
    value: item.guid["#text"] ?? "",
  };
}

function expectRenderError(render: () => Uint8Array, code: string): RssError {
  try {
    render();
  } catch (error) {
    expect(error).toBeInstanceOf(RssError);
    expect((error as RssError).code).toBe(code);
    return error as RssError;
  }
  throw new Error(`Expected RssError(${code})`);
}

describe("RSS document rendering", () => {
  it("RSS-01/02_HEAD emits the fixed Feed channel and no fh:archive marker", () => {
    const bytes = renderRssHead({
      feed: EVENT_FEED,
      items: [
        createRssPublishedItem({
          id: "rss-event-update",
          target_type: "EVENT_UPDATE",
          target_id: "rss-target-event-update",
          title: "Update title",
          published_at: "2026-11-20T09:00:00.000+08:00",
        }),
        createRssPublishedItem({ id: "rss-event-first" }),
      ],
      documentHref: "event-updates.xml",
      previousArchiveHref: "event-updates-pending.xml",
    });
    const xml = xmlBytesToText(bytes);
    const parsed = validateAndParse(bytes);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      'xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    );
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain('xmlns:fh="http://purl.org/syndication/history/1.0"');
    expect(xml).not.toMatch(/<fh:archive\s*\/>/u);
    expect(parsed.rss.channel.title).toBe("PIS Event Updates");
    expect(parsed.rss.channel.link).toBe("event-updates.xml");
    expect(parsed.rss.channel["atom:link"]).toEqual({
      "@rel": "prev-archive",
      "@href": "event-updates-pending.xml",
    });
    expect(parsedRssItems(parsed).map((item) => item.title)).toEqual([
      "Update title",
      "Event title",
    ]);

    const curated = validateAndParse(
      renderRssHead({
        feed: CURATED_FEED,
        items: [
          createRssPublishedItem({
            id: "rss-knowledge",
            target_type: "KNOWLEDGE",
            target_id: "rss-target-knowledge",
            title: "Knowledge title",
          }),
        ],
        documentHref: "curated-content.xml",
        previousArchiveHref: "curated-content-pending.xml",
      }),
    );
    expect(curated.rss.channel.title).toBe("PIS Curated Content");
    expect(parsedRssItems(curated)[0]?.title).toBe("Knowledge title");
  });

  it("RSS-03_ESCAPING preserves Chinese, XML text, HTML and split CDATA exactly", () => {
    const body =
      "<p>中文 &amp; raw &lt;tag&gt; <strong>HTML</strong> 1 < 2</p>" +
      "]]><p>after CDATA terminator</p>" +
      sourceSection(RSS_SOURCE_URLS.first);
    const item = createRssPublishedItem({
      id: "rss-&<中文>",
      title: '中文 & < > " title',
      summary: '摘要 & < > "',
      body,
    });
    const bytes = renderRssHead({
      feed: EVENT_FEED,
      items: [item],
      documentHref: EVENT_FEED.headKey,
      previousArchiveHref: EVENT_FEED.pendingKey,
    });
    const xml = xmlBytesToText(bytes);
    const parsed = validateAndParse(bytes);
    const parsedItem = itemAt(parsedRssItems(parsed));

    expect(xml).toContain('中文 &amp; &lt; &gt; " title');
    expect(xml).toContain("]]]]><![CDATA[>");
    expect(xml).toContain("?a=1&amp;b=2");
    expect(parsedItem.title).toBe('中文 & < > " title');
    expect(parsedItem.description).toBe('摘要 & < > "');
    expect(parsedItem["content:encoded"]).toBe(body);
    expect(parsedItem["content:encoded"]).toContain("<strong>HTML</strong>");
    expect(parsedItem["content:encoded"]).not.toContain("&lt;strong&gt;");
    expect(parsedItem.link).toBe(RSS_SOURCE_URLS.first);
    expect(guidParts(parsedItem)).toEqual({
      isPermaLink: "false",
      value: "pis:published:rss-&<中文>",
    });
  });

  it("RSS-05_TIME converts +08:00 to RFC 822 GMT and rejects invalid instants", () => {
    const sourceTime = "2026-11-20T08:00:00.000+08:00";
    const parsed = validateAndParse(
      renderRssHead({
        feed: EVENT_FEED,
        items: [createRssPublishedItem({ published_at: sourceTime })],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    );
    const pubDate = itemAt(parsedRssItems(parsed)).pubDate;

    expect(pubDate).toBe("Fri, 20 Nov 2026 00:00:00 GMT");
    expect(Date.parse(pubDate)).toBe(Date.parse(sourceTime));
    expect(pubDate).not.toContain("+0800");

    for (const invalid of [
      "2026-02-30T08:00:00.000+08:00",
      "2026-11-20T24:00:00.000+08:00",
      "2026-11-20T08:00:00",
      "not-a-time",
    ]) {
      expectRenderError(
        () =>
          renderRssHead({
            feed: EVENT_FEED,
            items: [createRssPublishedItem({ published_at: invalid })],
            documentHref: EVENT_FEED.headKey,
            previousArchiveHref: EVENT_FEED.pendingKey,
          }),
        "invalid_time",
      );
    }
  });

  it("RSS-06/07_LINK omits absent links and keeps the first source-section link stable", () => {
    const absent = validateAndParse(
      renderRssHead({
        feed: EVENT_FEED,
        items: [createRssPublishedItem({ body: "<p>No source link</p>" })],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    );
    const invalid = validateAndParse(
      renderRssHead({
        feed: EVENT_FEED,
        items: [
          createRssPublishedItem({
            body: sourceSection(
              "javascript:alert(1)",
              "https://user:secret@source.example.test/private",
            ),
          }),
        ],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      }),
    );
    const linkedBody = [
      '<p><a href="https://other.example.test/body">Body link</a></p>',
      sourceSection(RSS_SOURCE_URLS.second),
    ].join("");
    const linkRequest = {
      feed: EVENT_FEED,
      items: [createRssPublishedItem({ body: linkedBody })],
      documentHref: EVENT_FEED.headKey,
      previousArchiveHref: EVENT_FEED.pendingKey,
    } as const;
    const first = renderRssHead(linkRequest);
    const repeated = renderRssHead(linkRequest);

    expect(itemAt(parsedRssItems(absent)).link).toBeUndefined();
    expect(itemAt(parsedRssItems(invalid)).link).toBeUndefined();
    expect(first).toEqual(repeated);
    expect(itemAt(parsedRssItems(validateAndParse(first))).link).toBe(
      RSS_SOURCE_URLS.second,
    );
  });

  it("RSS-04_DETERMINISM produces identical bytes and ID-only GUIDs without clock fields", () => {
    const item = createRssPublishedItem({ id: "stable-published-id" });
    const request = {
      feed: EVENT_FEED,
      items: [item],
      documentHref: EVENT_FEED.headKey,
      previousArchiveHref: EVENT_FEED.pendingKey,
    } as const;
    const first = renderRssHead(request);
    const second = renderRssHead(request);
    const titleChanged = renderRssHead({
      ...request,
      items: [{ ...item, title: "Different title" }],
    });
    const xml = xmlBytesToText(first);
    const parsedItem = itemAt(parsedRssItems(validateAndParse(first)));
    const parsedChanged = itemAt(
      parsedRssItems(validateAndParse(titleChanged)),
    );

    expect(first).toEqual(second);
    expect(xml).not.toContain("generatedAt");
    expect(xml).not.toContain("category");
    expect(guidParts(parsedItem).value).toBe(
      "pis:published:stable-published-id",
    );
    expect(guidParts(parsedChanged).value).toBe(guidParts(parsedItem).value);
  });
});

describe("RFC 5005 document markers and archive chains", () => {
  it("renders zero-item and partial pending documents with fh:archive and no head marker", () => {
    const pendingZeroBytes = renderRssPending({
      feed: EVENT_FEED,
      items: [],
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: null,
    });
    const pendingPartialBytes = renderRssPending({
      feed: EVENT_FEED,
      items: [createRssPublishedItem()],
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: "archive/event-updates-0001.xml",
    });
    const headBytes = renderRssHead({
      feed: EVENT_FEED,
      items: [],
      documentHref: EVENT_FEED.headKey,
      previousArchiveHref: EVENT_FEED.pendingKey,
    });
    const pendingMaximum = Array.from(
      { length: RSS_ARCHIVE_BATCH_SIZE - 1 },
      (_, index) =>
        createRssPublishedItem({
          id: `pending-max-${String(index + 1).padStart(4, "0")}`,
          target_id: `pending-max-target-${String(index + 1).padStart(4, "0")}`,
        }),
    );
    const pendingMaximumBytes = renderRssPending({
      feed: EVENT_FEED,
      items: pendingMaximum,
      documentHref: EVENT_FEED.pendingKey,
      previousArchiveHref: "archive/event-updates-0001.xml",
    });

    for (const pending of [
      pendingZeroBytes,
      pendingPartialBytes,
      pendingMaximumBytes,
    ]) {
      const xml = xmlBytesToText(pending);
      const parsed = validateAndParse(pending);
      expect(xml).toMatch(/<fh:archive\s*\/>/u);
      expect(parsed.rss.channel["fh:archive"]).toBe("");
    }
    expect(parsedRssItems(validateAndParse(pendingZeroBytes))).toEqual([]);
    expect(parsedRssItems(validateAndParse(pendingPartialBytes))).toHaveLength(
      1,
    );
    expect(parsedRssItems(validateAndParse(pendingMaximumBytes))).toHaveLength(
      RSS_ARCHIVE_BATCH_SIZE - 1,
    );
    expect(xmlBytesToText(headBytes)).not.toMatch(/<fh:archive\s*\/>/u);
  });

  it("renders a full 200-item sealed archive with fh:archive and an exact previous chain", () => {
    const items = Array.from({ length: RSS_ARCHIVE_BATCH_SIZE }, (_, index) =>
      createRssPublishedItem({
        id: `archive-${String(index + 1).padStart(4, "0")}`,
        target_id: `archive-target-${String(index + 1).padStart(4, "0")}`,
        title: `Archive item ${String(index + 1).padStart(4, "0")}`,
      }),
    );
    const bytes = renderRssArchive({
      feed: EVENT_FEED,
      items,
      documentHref: "archive/event-updates-0002.xml",
      previousArchiveHref: "archive/event-updates-0001.xml",
    });
    const xml = xmlBytesToText(bytes);
    const parsed = validateAndParse(bytes);

    expect(xml).toMatch(/<fh:archive\s*\/>/u);
    expect(parsed.rss.channel["fh:archive"]).toBe("");
    expect(parsed.rss.channel["atom:link"]).toEqual({
      "@rel": "prev-archive",
      "@href": "archive/event-updates-0001.xml",
    });
    expect(parsedRssItems(parsed)).toHaveLength(RSS_ARCHIVE_BATCH_SIZE);
  });

  it("uses byte-identical item payloads across head, pending and sealed archive", () => {
    const item = createRssPublishedItem({
      id: "consistent-0001",
      title: "Consistent title",
      summary: "Consistent summary",
      body: `${rssConsistentBody()}${sourceSection(RSS_SOURCE_URLS.second)}`,
    });
    const headItem = itemAt(
      parsedRssItems(
        validateAndParse(
          renderRssHead({
            feed: EVENT_FEED,
            items: [item],
            documentHref: EVENT_FEED.headKey,
            previousArchiveHref: EVENT_FEED.pendingKey,
          }),
        ),
      ),
    );
    const pendingItem = itemAt(
      parsedRssItems(
        validateAndParse(
          renderRssPending({
            feed: EVENT_FEED,
            items: [item],
            documentHref: EVENT_FEED.pendingKey,
            previousArchiveHref: null,
          }),
        ),
      ),
    );
    const archiveItems = Array.from(
      { length: RSS_ARCHIVE_BATCH_SIZE },
      (_, index) => {
        if (index === 0) {
          return item;
        }
        return createRssPublishedItem({
          id: `consistent-${String(index + 1).padStart(4, "0")}`,
          target_id: `consistent-target-${String(index + 1).padStart(4, "0")}`,
        });
      },
    );
    const archiveItem = itemAt(
      parsedRssItems(
        validateAndParse(
          renderRssArchive({
            feed: EVENT_FEED,
            items: archiveItems,
            documentHref: "archive/event-updates-0001.xml",
            previousArchiveHref: null,
          }),
        ),
      ),
    );

    expect(pendingItem).toEqual(headItem);
    expect(archiveItem).toEqual(headItem);
  });
});

describe("RSS renderer boundaries", () => {
  it("rejects invalid XML characters and illegal document sizes with safe errors", () => {
    const secretBody = `<p>private${"\u0000"}body</p>`;
    const characterError = expectRenderError(
      () =>
        renderRssHead({
          feed: EVENT_FEED,
          items: [createRssPublishedItem({ body: secretBody })],
          documentHref: EVENT_FEED.headKey,
          previousArchiveHref: EVENT_FEED.pendingKey,
        }),
      "invalid_xml_character",
    );
    expect(characterError.message).not.toContain("private");

    const pendingItems = Array.from(
      { length: RSS_ARCHIVE_BATCH_SIZE + 1 },
      (_, index) =>
        createRssPublishedItem({
          id: `pending-${String(index).padStart(4, "0")}`,
        }),
    );
    expectRenderError(
      () =>
        renderRssPending({
          feed: EVENT_FEED,
          items: pendingItems,
          documentHref: EVENT_FEED.pendingKey,
          previousArchiveHref: null,
        }),
      "invalid_pending",
    );

    const headItems = Array.from(
      { length: RSS_ARCHIVE_BATCH_SIZE + 1 },
      (_, index) =>
        createRssPublishedItem({
          id: `head-${String(index).padStart(4, "0")}`,
        }),
    );
    expectRenderError(
      () =>
        renderRssHead({
          feed: EVENT_FEED,
          items: headItems,
          documentHref: EVENT_FEED.headKey,
          previousArchiveHref: EVENT_FEED.pendingKey,
        }),
      "invalid_input",
    );
  });

  it("rejects altered Feed definitions and cross-Feed item types", () => {
    expectRenderError(
      () =>
        renderRssHead({
          feed: {
            ...EVENT_FEED,
            title: "Altered title",
          } as unknown as typeof EVENT_FEED,
          items: [createRssPublishedItem()],
          documentHref: EVENT_FEED.headKey,
          previousArchiveHref: EVENT_FEED.pendingKey,
        }),
      "invalid_input",
    );
    expectRenderError(
      () =>
        renderRssHead({
          feed: EVENT_FEED,
          items: [
            createRssPublishedItem({
              target_type: "KNOWLEDGE",
              target_id: "rss-target-knowledge",
            }),
          ],
          documentHref: EVENT_FEED.headKey,
          previousArchiveHref: EVENT_FEED.pendingKey,
        }),
      "invalid_input",
    );
    expectRenderError(
      () =>
        renderRssDocument({
          feed: EVENT_FEED,
          documentType: "unknown" as never,
          items: [],
          documentHref: EVENT_FEED.headKey,
          previousArchiveHref: EVENT_FEED.pendingKey,
        }),
      "invalid_input",
    );
  });

  it("rejects absolute, cross-Feed, query, traversal and non-contiguous archive hrefs", () => {
    const base = {
      feed: EVENT_FEED,
      items: [createRssPublishedItem()],
    } as const;
    const invalidCalls: readonly [() => Uint8Array, string][] = [
      [
        () =>
          renderRssHead({
            ...base,
            documentHref: EVENT_FEED.headKey,
            previousArchiveHref:
              "https://evil.example.test/event-updates-pending.xml",
          }),
        "invalid_archive",
      ],
      [
        () =>
          renderRssHead({
            ...base,
            documentHref: EVENT_FEED.headKey,
            previousArchiveHref: CURATED_FEED.pendingKey,
          }),
        "invalid_archive",
      ],
      [
        () =>
          renderRssPending({
            ...base,
            documentHref: EVENT_FEED.pendingKey,
            previousArchiveHref: "../archive/event-updates-0001.xml",
          }),
        "invalid_pending",
      ],
      [
        () =>
          renderRssPending({
            ...base,
            documentHref: EVENT_FEED.pendingKey,
            previousArchiveHref: "archive/curated-content-0001.xml",
          }),
        "invalid_pending",
      ],
      [
        () =>
          renderRssArchive({
            ...base,
            documentHref: "archive/event-updates-0002.xml",
            previousArchiveHref: "archive/event-updates-0000.xml",
          }),
        "invalid_archive",
      ],
      [
        () =>
          renderRssArchive({
            ...base,
            documentHref: "archive/event-updates-0003.xml",
            previousArchiveHref: "archive/event-updates-0001.xml",
          }),
        "invalid_archive",
      ],
      [
        () =>
          renderRssDocument({
            ...base,
            documentType: "pending",
            documentHref: "archive/event-updates-0001.xml?before=next",
            previousArchiveHref: null,
          }),
        "invalid_pending",
      ],
    ];

    for (const [render, code] of invalidCalls) {
      expectRenderError(render, code);
    }
  });
});

function rssConsistentBody(): string {
  return "<p>Consistent body &amp; HTML</p>";
}
