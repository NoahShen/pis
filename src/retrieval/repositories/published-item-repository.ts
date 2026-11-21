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
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.target_type !== undefined) {
      conditions.push("target_type = ?");
      parameters.push(options.target_type);
    }
    if (options.published_after !== undefined) {
      conditions.push("julianday(published_at) >= julianday(?)");
      parameters.push(options.published_after);
    }
    if (options.published_before !== undefined) {
      conditions.push("julianday(published_at) <= julianday(?)");
      parameters.push(options.published_before);
    }
    if (options.cursor !== undefined) {
      conditions.push("(published_at < ? OR (published_at = ? AND id < ?))");
      parameters.push(
        options.cursor.time,
        options.cursor.time,
        options.cursor.id,
      );
    }
    parameters.push(retrievalLimit(options.limit) + 1);
    const rows = getRows(
      this.#db,
      `SELECT id, target_type, target_id, title, summary, body, published_at
       FROM published_items
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY published_at DESC, id DESC LIMIT ?`,
      ...parameters,
    );
    return list(
      rows,
      options,
      (row) => {
        const item = snapshot(row);
        return {
          ...item,
          topics: topicsFor(this.#db, item.target_type, item.target_id),
        };
      },
      (row) => ({ time: row.published_at as string, id: row.id as string }),
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
