import type Database from "better-sqlite3";

import type {
  PublishedItemDetailDto,
  PublishedItemDto,
  PublishedItemRetrievalRepository,
  RetrievalList,
  RetrievalListOptions,
  RetrievalTargetType,
} from "../contracts.js";
import {
  getRow,
  getRows,
  list,
  readTarget,
  retrievalLimit,
  topicsFor,
} from "./shared.js";

interface PublishedSnapshot {
  id: string;
  target_type: RetrievalTargetType;
  target_id: string;
  title: string;
  summary: string;
  body: string;
  published_at: string;
}

function snapshot(row: Record<string, unknown>): PublishedSnapshot {
  return {
    id: row.id as string,
    target_type: row.target_type as RetrievalTargetType,
    target_id: row.target_id as string,
    title: row.title as string,
    summary: row.summary as string,
    body: row.body as string,
    published_at: row.published_at as string,
  };
}

export class SqlitePublishedItemRetrievalRepository implements PublishedItemRetrievalRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  list(options: RetrievalListOptions = {}): RetrievalList<PublishedItemDto> {
    const rows = getRows(
      this.#db,
      `SELECT id, target_type, target_id, title, summary, body, published_at
       FROM published_items ORDER BY published_at DESC, id DESC LIMIT ?`,
      retrievalLimit(options.limit),
    );
    return list(
      rows.map((row) => {
        const item = snapshot(row);
        return {
          ...item,
          topics: topicsFor(this.#db, item.target_type, item.target_id),
        };
      }),
    );
  }

  getById(id: string): PublishedItemDetailDto | null {
    const row = getRow(
      this.#db,
      `SELECT id, target_type, target_id, title, summary, body, published_at
       FROM published_items WHERE id = ?`,
      id,
    );
    if (row === undefined) return null;
    const item = snapshot(row);
    return {
      ...item,
      target: readTarget(this.#db, item.target_type, item.target_id),
      topics: topicsFor(this.#db, item.target_type, item.target_id),
    };
  }
}

export { SqlitePublishedItemRetrievalRepository as SqliteRetrievalPublishedItemRepository };
