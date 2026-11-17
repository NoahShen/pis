import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

import type {
  AdapterCallOptions,
  AdapterSource,
  SourceAdapter,
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import {
  type RssTransport,
  type RssTransportDocument,
  type RssTransportRequest,
} from "../../src/adapters/transport.js";
import type { Source } from "../../src/configuration/contracts.js";
import type {
  CollectionLogMetadata,
  CollectionLogger,
} from "../../src/collection/collector.js";
import type {
  SourceItemDraft,
  SourceItemRepository,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type { IdGenerator } from "../../src/id/id-generator.js";
import type { Clock } from "../../src/time/clock.js";

export const FIXTURE_SOURCE_ID = "fixture-source";
export const FIXTURE_FEED_URL =
  "https://feeds.collection.example.test/feed.xml";
export const FIXTURE_ARTICLE_ONE_URL =
  "https://articles.collection.example.test/one";
export const FIXTURE_ARTICLE_TWO_URL =
  "https://articles.collection.example.test/two";
export const FIXTURE_ARTICLE_THREE_URL =
  "https://articles.collection.example.test/three";
export const FIXTURE_OLD_CHECKPOINT = "2026-11-17T08:00:00.000+08:00";
export const FIXTURE_STARTED_AT = "2026-11-17T09:00:00.000+08:00";
export const FIXTURE_LATER_AT = "2026-11-17T09:15:00.000+08:00";

export function createFixtureSource(overrides: Partial<Source> = {}): Source {
  return {
    id: FIXTURE_SOURCE_ID,
    name: "Fixture Collection Source",
    type: "RSS",
    url: FIXTURE_FEED_URL,
    cron: "0 * * * *",
    enabled: true,
    description: "Synthetic collection fixture",
    last_collected_at: FIXTURE_OLD_CHECKPOINT,
    ...overrides,
  };
}

export function insertFixtureSource(
  db: Database.Database,
  source = createFixtureSource(),
): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    source.id,
    source.name,
    source.type,
    source.url,
    source.cron,
    source.enabled ? 1 : 0,
    source.description,
    source.last_collected_at,
  );
}

export function createFixtureEntry(
  overrides: Partial<SourceEntry> = {},
): SourceEntry {
  return {
    source_id: FIXTURE_SOURCE_ID,
    external_id: "fixture-entry-guid",
    url: FIXTURE_ARTICLE_ONE_URL,
    title: "Fixture Collection Entry",
    author: "Fixture Author",
    published_at: "2026-11-17T07:30:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

export function createFixtureContent(
  entry: SourceEntry,
  overrides: Partial<SourceContent> = {},
): SourceContent {
  return {
    schema_version: 1,
    entry,
    body: "Synthetic collection body.",
    summary: null,
    content_kind: "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
    ...overrides,
  };
}

export function createFixtureSourceItemDraft(
  entry: SourceEntry,
  discoveredAt = FIXTURE_STARTED_AT,
): SourceItemDraft {
  return {
    source_id: entry.source_id,
    external_id: entry.external_id,
    url: entry.url,
    title: entry.title,
    published_at: entry.published_at,
    discovered_at: discoveredAt,
    content_id: null,
    raw_data: "{}",
  };
}

export class FixtureClock implements Clock {
  calls = 0;

  constructor(private milliseconds: number) {}

  now(): Date {
    this.calls += 1;
    return new Date(this.milliseconds);
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds;
  }
}

export class CapturedCollectionLogger implements CollectionLogger {
  readonly entries: CollectionLogMetadata[] = [];

  log(metadata: CollectionLogMetadata): void {
    this.entries.push(metadata);
  }
}

export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T | PromiseLike<T>) => void;
  private rejectPromise!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }

  reject(reason: unknown): void {
    this.rejectPromise(reason);
  }
}

export interface FixtureEntryCall {
  readonly source: AdapterSource;
  readonly lastCollectedAt: string | null;
  readonly options: AdapterCallOptions | undefined;
}

export interface FixtureContentCall {
  readonly entry: SourceEntry;
  readonly options: AdapterCallOptions | undefined;
}

type EntryHandler = (
  source: AdapterSource,
  lastCollectedAt: string | null,
  options: AdapterCallOptions | undefined,
) => SourceEntry[] | Promise<SourceEntry[]>;

type ContentHandler = (
  entry: SourceEntry,
  options: AdapterCallOptions | undefined,
) => SourceContent | Promise<SourceContent>;

export class FixtureCollectionAdapter implements SourceAdapter {
  readonly entryCalls: FixtureEntryCall[] = [];
  readonly contentCalls: FixtureContentCall[] = [];
  private readonly entryQueue: EntryHandler[] = [];
  private readonly contentQueue: ContentHandler[] = [];

  enqueueEntries(handler: EntryHandler): void {
    this.entryQueue.push(handler);
  }

  enqueueContent(handler: ContentHandler): void {
    this.contentQueue.push(handler);
  }

  async fetchEntries(
    source: AdapterSource,
    lastCollectedAt: string | null,
    options?: AdapterCallOptions,
  ): Promise<SourceEntry[]> {
    this.entryCalls.push({ source, lastCollectedAt, options });
    const handler = this.entryQueue.shift();
    if (handler === undefined) {
      throw new Error("Fixture entry queue is empty");
    }

    return handler(source, lastCollectedAt, options);
  }

  async fetchContent(
    entry: SourceEntry,
    options?: AdapterCallOptions,
  ): Promise<SourceContent> {
    this.contentCalls.push({ entry, options });
    const handler = this.contentQueue.shift();
    if (handler === undefined) {
      throw new Error("Fixture content queue is empty");
    }

    return handler(entry, options);
  }
}

export function fixtureRssFeed(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel><title>Collection Fixture</title>${items}</channel>
</rss>`;
}

export function fixtureRssItem({
  guid,
  title,
  link,
  summary,
}: {
  guid: string;
  title: string;
  link: string;
  summary?: string;
}): string {
  return `<item>
    <guid isPermaLink="false">${guid}</guid>
    <title>${title}</title>
    <link>${link}</link>
    <pubDate>Mon, 17 Nov 2026 07:30:00 +0800</pubDate>
    ${summary === undefined ? "" : `<description><![CDATA[${summary}]]></description>`}
  </item>`;
}

export const FIXTURE_ARTICLE_TEXT =
  "Synthetic article evidence contains enough detail for deterministic extraction. ".repeat(
    4,
  );

export function fixtureArticleHtml(body = FIXTURE_ARTICLE_TEXT): string {
  const paragraphs = body
    .split("\n")
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
  return `<!doctype html><html><body><main><article><h1>Fixture article</h1>${paragraphs}</article></main></body></html>`;
}

export class FixtureRssTransport implements RssTransport {
  readonly requests: RssTransportRequest[] = [];
  private feedBody = fixtureRssFeed("");
  private readonly articles = new Map<string, string>();

  setFeed(body: string): void {
    this.feedBody = body;
  }

  setArticle(url: string, body: string): void {
    this.articles.set(url, body);
  }

  async fetch(
    request: Readonly<RssTransportRequest>,
  ): Promise<RssTransportDocument> {
    this.requests.push({ ...request });
    if (request.kind === "feed") {
      return {
        finalUrl: request.url,
        body: this.feedBody,
        receivedResponse: true,
      };
    }

    const article = this.articles.get(request.url);
    if (article === undefined) {
      throw new Error("Fixture article is not configured");
    }

    return {
      finalUrl: request.url,
      body: article,
      receivedResponse: true,
    };
  }
}

export class FixtureSequenceIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly prefix: string) {}

  next(): string {
    this.index += 1;
    return `${this.prefix}-${this.index}`;
  }
}

export interface FixtureSourceItemRow {
  id: string;
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  discovered_at: string;
  content_id: string | null;
  raw_data: string | null;
}

export function readFixtureSourceItems(
  db: Database.Database,
  sourceId = FIXTURE_SOURCE_ID,
): FixtureSourceItemRow[] {
  return db
    .prepare(
      `
        SELECT id, source_id, external_id, url, title, published_at,
               discovered_at, content_id, raw_data
        FROM source_items
        WHERE source_id = ?
        ORDER BY rowid ASC
      `,
    )
    .all(sourceId) as FixtureSourceItemRow[];
}

export function readFixtureCheckpoint(
  db: Database.Database,
  sourceId = FIXTURE_SOURCE_ID,
): string | null {
  const row = db
    .prepare("SELECT last_collected_at FROM sources WHERE id = ?")
    .get(sourceId) as { last_collected_at: string | null } | undefined;
  if (row === undefined) {
    throw new Error("Fixture Source does not exist");
  }

  return row.last_collected_at;
}

export const fixtureDownstreamTables = [
  "contents",
  "events",
  "event_updates",
  "knowledge",
  "topics",
  "published_items",
  "event_content_links",
  "event_entity_aliases",
  "topic_associations",
] as const;

export function countFixtureRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

export function trackFixtureTransactions(db: Database.Database): {
  readonly database: Database.Database;
  count(): number;
} {
  let transactionCount = 0;
  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        const transaction = target.transaction.bind(target);
        return ((operation: () => unknown) => {
          transactionCount += 1;
          return transaction(operation);
        }) as Database.Database["transaction"];
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database.Database;

  return { database, count: () => transactionCount };
}

export async function withFixtureCollectionDatabase<T>(
  callback: (db: Database.Database) => T | Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "pis-d05-t04-"));
  const db = openDatabase(path.join(directory, "database.sqlite"));

  try {
    initializeDatabase(db);
    return await callback(db);
  } finally {
    if (db.open) {
      db.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
}
