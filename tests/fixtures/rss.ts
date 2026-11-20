import { XMLParser } from "fast-xml-parser";

import type {
  PublicationFeed,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
} from "../../src/publication/contracts.js";
import type {
  RssArtifactStore,
  RssFeedKind,
  RssPublishedItemReader,
} from "../../src/rss/index.js";
import { RssError } from "../../src/rss/index.js";

export const RSS_SOURCE_URLS = {
  first: "https://source.example.test/first?a=1&b=2",
  second: "https://source.example.test/second",
  knowledge: "https://knowledge.example.test/article",
} as const;

export function sourceSection(...hrefs: readonly string[]): string {
  const items = hrefs
    .map(
      (href) =>
        `<li><a href="${href.replaceAll("&", "&amp;")}">Source</a></li>`,
    )
    .join("");
  return `<section><h2>来源</h2><ul>${items}</ul></section>`;
}

export const rssBodies = {
  withSource: `<p>Body content</p>${sourceSection(RSS_SOURCE_URLS.first)}`,
  withoutSource: "<p>Body content without source</p>",
  knowledge: `<p>Knowledge body</p>${sourceSection(RSS_SOURCE_URLS.knowledge)}`,
} as const;

export function createRssPublishedItem(
  overrides: Partial<PublishedItem> = {},
): PublishedItem {
  return {
    id: "rss-event-first",
    target_type: "EVENT",
    target_id: "rss-target-event-first",
    title: "Event title",
    summary: "Event summary",
    body: rssBodies.withSource,
    published_at: "2026-11-20T08:00:00.000+08:00",
    ...overrides,
  };
}

export function createRssItems(
  count: number,
  targetType: "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE" = "EVENT",
): readonly PublishedItem[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("RSS fixture count must be a non-negative integer");
  }
  return Array.from({ length: count }, (_, offset) => {
    const sequence = count - offset;
    const suffix = String(sequence).padStart(4, "0");
    return createRssPublishedItem({
      id: `rss-${suffix}`,
      target_type: targetType,
      target_id: `rss-target-${suffix}`,
      title: `RSS item ${suffix}`,
      summary: `RSS summary ${suffix}`,
      body: `<p>RSS body ${suffix}</p>`,
      published_at: new Date(
        Date.UTC(2026, 0, 1) + sequence * 60_000,
      ).toISOString(),
    });
  });
}

export class StubRssPublishedItemReader implements RssPublishedItemReader {
  readonly calls: RssFeedKind[] = [];
  #rows: Readonly<Record<RssFeedKind, readonly PublishedItem[]>>;

  constructor(
    rows: Readonly<Record<RssFeedKind, readonly PublishedItem[]>> = {
      EVENT_UPDATES: [],
      CURATED_CONTENT: [],
    },
  ) {
    this.#rows = rows;
  }

  replace(rows: Readonly<Record<RssFeedKind, readonly PublishedItem[]>>): void {
    this.#rows = rows;
  }

  async list(feed: RssFeedKind): Promise<readonly PublishedItem[]> {
    this.calls.push(feed);
    return this.#rows[feed];
  }
}

export interface RssWriteCall {
  readonly key: string;
  readonly onlyIfAbsent: boolean;
}

export class MemoryRssArtifactStore implements RssArtifactStore {
  readonly #artifacts = new Map<string, Uint8Array>();
  readonly #hiddenFromList = new Set<string>();
  readonly #nextWriteFailures = new Map<string, Error>();
  readonly writeAttempts: RssWriteCall[] = [];
  readonly writeKeys: string[] = [];

  constructor(initial: Readonly<Record<string, Uint8Array>> = {}) {
    for (const [key, bytes] of Object.entries(initial)) {
      this.seed(key, bytes);
    }
  }

  seed(key: string, bytes: Uint8Array): void {
    this.#artifacts.set(key, Uint8Array.from(bytes));
  }

  hideFromList(key: string): void {
    if (!this.#artifacts.has(key)) {
      throw new Error(`Cannot hide missing RSS artifact ${key}`);
    }
    this.#hiddenFromList.add(key);
  }

  failNextWrite(
    key: string,
    error = new Error("Injected RSS write failure"),
  ): void {
    this.#nextWriteFailures.set(key, error);
  }

  bytes(key: string): Uint8Array | null {
    const value = this.#artifacts.get(key);
    return value === undefined ? null : Uint8Array.from(value);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.#artifacts.keys()]
      .filter((key) => key.startsWith(prefix) && !this.#hiddenFromList.has(key))
      .sort();
  }

  async read(key: string): Promise<Uint8Array | null> {
    return this.bytes(key);
  }

  async write(
    key: string,
    bytes: Uint8Array,
    options: { readonly onlyIfAbsent?: boolean } = {},
  ): Promise<void> {
    const onlyIfAbsent = options.onlyIfAbsent === true;
    this.writeAttempts.push({ key, onlyIfAbsent });

    const injected = this.#nextWriteFailures.get(key);
    if (injected !== undefined) {
      this.#nextWriteFailures.delete(key);
      throw injected;
    }
    if (onlyIfAbsent && this.#artifacts.has(key)) {
      throw new RssError("artifact_exists");
    }

    this.#artifacts.set(key, Uint8Array.from(bytes));
    this.writeKeys.push(key);
  }
}

export const rssFeedItems: Readonly<
  Record<PublicationFeed, readonly PublishedItem[]>
> = Object.freeze({
  EVENT: Object.freeze([
    createRssPublishedItem({
      id: "rss-event-update",
      target_type: "EVENT_UPDATE",
      target_id: "rss-target-event-update",
      title: "Update title",
      published_at: "2026-11-20T09:00:00.000+08:00",
    }),
    createRssPublishedItem({
      id: "rss-event-first",
      title: "Event title",
      published_at: "2026-11-20T08:00:00.000+08:00",
    }),
  ]),
  KNOWLEDGE: Object.freeze([
    createRssPublishedItem({
      id: "rss-knowledge",
      target_type: "KNOWLEDGE",
      target_id: "rss-target-knowledge",
      title: "Knowledge title",
      summary: "Knowledge summary",
      body: rssBodies.knowledge,
      published_at: "2026-11-20T10:00:00.000+08:00",
    }),
  ]),
});

export class StubRssPublishedItemRepository implements PublishedItemRepository {
  readonly listCalls: PublicationFeed[] = [];
  findCalls = 0;
  insertCalls = 0;
  readonly rows: Readonly<Record<PublicationFeed, readonly PublishedItem[]>>;

  constructor(
    rows: Readonly<
      Record<PublicationFeed, readonly PublishedItem[]>
    > = rssFeedItems,
  ) {
    this.rows = rows;
  }

  findByTarget(): PublishedItem | null {
    this.findCalls += 1;
    throw new Error("Unexpected findByTarget call");
  }

  insert(_item: PublishedItemInsert): PublishedItem {
    this.insertCalls += 1;
    throw new Error("Unexpected insert call");
  }

  listForFeed(feed: PublicationFeed): readonly PublishedItem[] {
    this.listCalls.push(feed);
    return this.rows[feed];
  }
}

export type ParsedRssItem = Readonly<{
  title: string;
  link?: string;
  description: string;
  "content:encoded": string;
  guid: string | Readonly<Record<string, string>>;
  pubDate: string;
}>;

export type ParsedRssDocument = Readonly<{
  rss: Readonly<{
    channel: Readonly<{
      title: string;
      link: string;
      description: string;
      "atom:link"?: Readonly<Record<string, string>>;
      "fh:archive"?: string;
      item?: ParsedRssItem | ParsedRssItem[];
    }>;
  }>;
}>;

export function parseRssXml(xml: string): ParsedRssDocument {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  return parser.parse(xml) as ParsedRssDocument;
}

export function parsedRssItems(
  parsed: ParsedRssDocument,
): readonly ParsedRssItem[] {
  const item = parsed.rss.channel.item;
  if (item === undefined) {
    return [];
  }
  return Array.isArray(item) ? item : [item];
}

export function xmlBytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function xmlTextToBytes(xml: string): Uint8Array {
  return new TextEncoder().encode(xml);
}
