import type Database from "better-sqlite3";

import type { TopicTargetType } from "./contracts.js";

export interface PublishedItemRepository {
  existsForTarget(targetType: TopicTargetType, targetId: string): boolean;
}

const EXISTS_PUBLISHED_ITEM_FOR_TARGET = `
  SELECT 1
  FROM published_items
  WHERE target_type = ? AND target_id = ?
  LIMIT 1
`;

export class SqlitePublishedItemRepository implements PublishedItemRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  existsForTarget(targetType: TopicTargetType, targetId: string): boolean {
    const row = this.#database
      .prepare<[TopicTargetType, string], { readonly present: 1 }>(
        EXISTS_PUBLISHED_ITEM_FOR_TARGET,
      )
      .get(targetType, targetId);

    return row !== undefined;
  }
}
