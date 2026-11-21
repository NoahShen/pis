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
    const rows = getRows(
      this.#db,
      `SELECT topic_id, target_type, target_id, matched_at
       FROM topic_associations
       WHERE topic_id = ?
       ORDER BY matched_at DESC, target_id DESC
       LIMIT ?`,
      topicId,
      limit,
    );
    return list(
      rows.map((row) => {
        const targetType = row.target_type as RetrievalTargetType;
        const targetId = row.target_id as string;
        return {
          topic_id: row.topic_id as string,
          target_type: targetType,
          target_id: targetId,
          matched_at: row.matched_at as string,
          target: readTarget(this.#db, targetType, targetId),
        };
      }),
    );
  }
}

export { SqliteTopicRetrievalRepository as SqliteRetrievalTopicRepository };
