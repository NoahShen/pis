import type Database from "better-sqlite3";

import type { PublishedItem } from "../../src/publication/contracts.js";
import { withDatabasePath } from "./database.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";

/**
 * Sentinels written to files that live OUTSIDE the RSS output root. The RSS
 * sync must never copy, read or echo these into generated XML or the output
 * directory; tests assert their absence from every produced artifact.
 */
export const RSS_EXTERNAL_SENTINELS = Object.freeze({
  database: "RSS_EXTERNAL_DATABASE_SENTINEL",
  env: "RSS_EXTERNAL_ENV_SENTINEL",
  prompt: "RSS_EXTERNAL_PROMPT_SENTINEL",
  log: "RSS_EXTERNAL_LOG_SENTINEL",
} as const);

export type RssDatabaseTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

const SOURCE_BASE = "https://rss-source.example.test";

function sourceSection(id: string): string {
  return (
    `<section><h2>来源</h2><ul>` +
    `<li><a href="${SOURCE_BASE}/${id}">来源链接</a></li>` +
    `</ul></section>`
  );
}

function buildItem(
  sequence: number,
  targetType: RssDatabaseTargetType,
): PublishedItem {
  const suffix = String(sequence).padStart(5, "0");
  const id = `rss-db-${targetType.toLowerCase()}-${suffix}`;
  return {
    id,
    target_type: targetType,
    target_id: `rss-db-target-${suffix}`,
    title: `RSS 数据库条目 ${suffix}`,
    summary: `RSS 数据库摘要 ${suffix} & <标记>`,
    body: `<p>合成正文 ${suffix}，包含中文与 HTML 标记。</p>${sourceSection(id)}`,
    published_at: new Date(
      Date.UTC(2026, 0, 1) + sequence * 60_000,
    ).toISOString(),
  };
}

/**
 * Builds deterministic EVENT / EVENT_UPDATE items for the Event Updates feed.
 * Even sequences are EVENT, odd sequences are EVENT_UPDATE so both target
 * types are represented while remaining valid for the same feed.
 */
export function buildRssEventFeedItems(
  startSequence: number,
  count: number,
): readonly PublishedItem[] {
  if (!Number.isInteger(startSequence) || startSequence < 1) {
    throw new Error("RSS database start sequence must be a positive integer");
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("RSS database count must be a non-negative integer");
  }
  return Array.from({ length: count }, (_, offset) => {
    const sequence = startSequence + offset;
    return buildItem(sequence, sequence % 2 === 0 ? "EVENT_UPDATE" : "EVENT");
  });
}

/** Builds deterministic KNOWLEDGE items for the Curated Content feed. */
export function buildRssCuratedFeedItems(
  startSequence: number,
  count: number,
): readonly PublishedItem[] {
  if (!Number.isInteger(startSequence) || startSequence < 1) {
    throw new Error("RSS database start sequence must be a positive integer");
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("RSS database count must be a non-negative integer");
  }
  return Array.from({ length: count }, (_, offset) =>
    buildItem(startSequence + offset, "KNOWLEDGE"),
  );
}

/**
 * Directly seeds `published_items` with the frozen seven-column snapshot.
 * No PublishTask, template, LLM, User Context or extra table is involved.
 */
export function seedRssDatabasePublishedItems(
  database: Database.Database,
  items: readonly PublishedItem[],
): void {
  const insert = database.prepare(
    `
      INSERT INTO published_items (
        id, target_type, target_id, title, summary, body, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const seed = database.transaction((rows: readonly PublishedItem[]) => {
    for (const item of rows) {
      insert.run(
        item.id,
        item.target_type,
        item.target_id,
        item.title,
        item.summary,
        item.body,
        item.published_at,
      );
    }
  });
  seed(items);
}

/**
 * Opens an isolated temporary SQLite database, initializes the frozen schema
 * and hands it to the callback. The default `data/pis.sqlite` is never used.
 */
export async function withRssDatabase<T>(
  callback: (database: Database.Database) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const database = openDatabase(databasePath);
    try {
      initializeDatabase(database);
      return await callback(database);
    } finally {
      if (database.open) {
        database.close();
      }
    }
  });
}
