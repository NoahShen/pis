import type Database from "better-sqlite3";

import type {
  PublicationFeed,
  PublicationTargetType,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
} from "./contracts.js";

const PUBLISHED_ITEM_COLUMNS = `
  id, target_type, target_id, title, summary, body, published_at
`;
const SELECT_PUBLISHED_ITEM_BY_TARGET = `
  SELECT ${PUBLISHED_ITEM_COLUMNS}
  FROM published_items
  WHERE target_type = ? AND target_id = ?
`;
const SELECT_EVENT_FEED = `
  SELECT ${PUBLISHED_ITEM_COLUMNS}
  FROM published_items
  WHERE target_type IN ('EVENT', 'EVENT_UPDATE')
  ORDER BY published_at DESC, id DESC
`;
const SELECT_KNOWLEDGE_FEED = `
  SELECT ${PUBLISHED_ITEM_COLUMNS}
  FROM published_items
  WHERE target_type = 'KNOWLEDGE'
  ORDER BY published_at DESC, id DESC
`;
const INSERT_PUBLISHED_ITEM = `
  INSERT INTO published_items (
    id, target_type, target_id, title, summary, body, published_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`;

function isValidTargetType(value: unknown): value is PublicationTargetType {
  return value === "EVENT" || value === "EVENT_UPDATE" || value === "KNOWLEDGE";
}

function mapPublishedItemRow(row: PublishedItem): PublishedItem {
  if (
    typeof row.id !== "string" ||
    !isValidTargetType(row.target_type) ||
    typeof row.target_id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.body !== "string" ||
    typeof row.published_at !== "string"
  ) {
    throw new Error("Malformed Published Item row");
  }

  return {
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    published_at: row.published_at,
  };
}

function isSamePublishedItem(
  left: PublishedItem,
  right: PublishedItem,
): boolean {
  return (
    left.id === right.id &&
    left.target_type === right.target_type &&
    left.target_id === right.target_id &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.body === right.body &&
    left.published_at === right.published_at
  );
}

export class SqlitePublishedItemRepository implements PublishedItemRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  findByTarget(
    targetType: PublicationTargetType,
    targetId: string,
  ): PublishedItem | null {
    const row = this.#database
      .prepare<[PublicationTargetType, string], PublishedItem>(
        SELECT_PUBLISHED_ITEM_BY_TARGET,
      )
      .get(targetType, targetId);

    return row === undefined ? null : mapPublishedItemRow(row);
  }

  insert(item: PublishedItemInsert): PublishedItem {
    if (this.#database.inTransaction !== true) {
      throw new Error("Published Item writes require an active transaction");
    }

    const result = this.#database
      .prepare<
        [string, PublicationTargetType, string, string, string, string, string]
      >(INSERT_PUBLISHED_ITEM)
      .run(
        item.id,
        item.target_type,
        item.target_id,
        item.title,
        item.summary,
        item.body,
        item.published_at,
      );

    if (result.changes !== 1) {
      throw new Error("Published Item insert did not insert exactly one row");
    }

    const readBack = this.findByTarget(item.target_type, item.target_id);
    if (readBack === null || !isSamePublishedItem(readBack, item)) {
      throw new Error("Published Item readback did not match the insert");
    }

    return readBack;
  }

  listForFeed(feed: PublicationFeed): readonly PublishedItem[] {
    if (feed === "EVENT") {
      return this.#database
        .prepare<[], PublishedItem>(SELECT_EVENT_FEED)
        .all()
        .map(mapPublishedItemRow);
    }

    if (feed === "KNOWLEDGE") {
      return this.#database
        .prepare<[], PublishedItem>(SELECT_KNOWLEDGE_FEED)
        .all()
        .map(mapPublishedItemRow);
    }

    throw new Error("Unsupported publication feed");
  }
}
