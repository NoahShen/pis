import type Database from "better-sqlite3";

import type {
  RetrievalList,
  RetrievalListOptions,
  RetrievalTargetType,
  TopicItemDto,
  TopicRetrievalRepository,
} from "../contracts.js";
import { getRow, getRows, list, readTarget, retrievalLimit } from "./shared.js";

export class SqliteTopicRetrievalRepository implements TopicRetrievalRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  listItems(
    topicId: string,
    options: RetrievalListOptions = {},
  ): RetrievalList<TopicItemDto> | null {
    if (
      getRow(this.#db, "SELECT id FROM topics WHERE id = ?", topicId) ===
      undefined
    ) {
      return null;
    }
    const limit = retrievalLimit(options.limit);
    const parameters: Array<string | number> = [topicId];
    const conditions = ["topic_id = ?"];
    if (options.target_type !== undefined) {
      conditions.push("target_type = ?");
      parameters.push(options.target_type);
    }
    if (options.cursor !== undefined) {
      conditions.push("(matched_at < ? OR (matched_at = ? AND target_id < ?))");
      parameters.push(
        options.cursor.time,
        options.cursor.time,
        options.cursor.id,
      );
    }
    parameters.push(limit + 1);
    const rows = getRows(
      this.#db,
      `SELECT topic_id, target_type, target_id, matched_at
       FROM topic_associations
       WHERE ${conditions.join(" AND ")}
       ORDER BY matched_at DESC, target_id DESC
       LIMIT ?`,
      ...parameters,
    );
    return list(
      rows,
      options,
      (row) => {
        const targetType = row.target_type as RetrievalTargetType;
        const targetId = row.target_id as string;
        return {
          topic_id: row.topic_id as string,
          target_type: targetType,
          target_id: targetId,
          matched_at: row.matched_at as string,
          target: readTarget(this.#db, targetType, targetId),
        };
      },
      (row) => ({
        time: row.matched_at as string,
        id: row.target_id as string,
      }),
    );
  }
}

export { SqliteTopicRetrievalRepository as SqliteRetrievalTopicRepository };
