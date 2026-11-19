import type Database from "better-sqlite3";

import type { TopicTargetType } from "./contracts.js";

export interface TopicAssociation {
  readonly topic_id: string;
  readonly target_type: TopicTargetType;
  readonly target_id: string;
  readonly matched_at: string;
}

export interface TopicAssociationInsertResult {
  readonly changes: 0 | 1;
  readonly association: TopicAssociation;
}

export interface TopicAssociationRepository {
  existsForTarget(targetType: TopicTargetType, targetId: string): boolean;
  get(
    topicId: string,
    targetType: TopicTargetType,
    targetId: string,
  ): TopicAssociation | null;
  insertIfAbsent(association: TopicAssociation): TopicAssociationInsertResult;
}

const ASSOCIATION_COLUMNS = "topic_id, target_type, target_id, matched_at";
const SELECT_ASSOCIATION = `
  SELECT ${ASSOCIATION_COLUMNS}
  FROM topic_associations
  WHERE topic_id = ? AND target_type = ? AND target_id = ?
`;
const EXISTS_ASSOCIATION_FOR_TARGET = `
  SELECT 1
  FROM topic_associations
  WHERE target_type = ? AND target_id = ?
  LIMIT 1
`;
const INSERT_ASSOCIATION = `
  INSERT INTO topic_associations (topic_id, target_type, target_id, matched_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (topic_id, target_type, target_id) DO NOTHING
`;

function mapAssociationRow(row: TopicAssociation): TopicAssociation {
  return {
    topic_id: row.topic_id,
    target_type: row.target_type,
    target_id: row.target_id,
    matched_at: row.matched_at,
  };
}

export class SqliteTopicAssociationRepository implements TopicAssociationRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  existsForTarget(targetType: TopicTargetType, targetId: string): boolean {
    const row = this.#database
      .prepare<[TopicTargetType, string], { readonly present: 1 }>(
        EXISTS_ASSOCIATION_FOR_TARGET,
      )
      .get(targetType, targetId);

    return row !== undefined;
  }

  get(
    topicId: string,
    targetType: TopicTargetType,
    targetId: string,
  ): TopicAssociation | null {
    const row = this.#database
      .prepare<[string, TopicTargetType, string], TopicAssociation>(
        SELECT_ASSOCIATION,
      )
      .get(topicId, targetType, targetId);

    return row === undefined ? null : mapAssociationRow(row);
  }

  insertIfAbsent(association: TopicAssociation): TopicAssociationInsertResult {
    this.#assertTransaction();

    const result = this.#database
      .prepare<[string, TopicTargetType, string, string]>(INSERT_ASSOCIATION)
      .run(
        association.topic_id,
        association.target_type,
        association.target_id,
        association.matched_at,
      );

    if (result.changes !== 0 && result.changes !== 1) {
      throw new Error(
        "Topic Association insert returned an unexpected change count",
      );
    }

    const row = this.#database
      .prepare<[string, TopicTargetType, string], TopicAssociation>(
        SELECT_ASSOCIATION,
      )
      .get(
        association.topic_id,
        association.target_type,
        association.target_id,
      );

    if (row === undefined) {
      throw new Error("Topic Association could not be read back");
    }

    const readBack = mapAssociationRow(row);
    if (
      readBack.topic_id !== association.topic_id ||
      readBack.target_type !== association.target_type ||
      readBack.target_id !== association.target_id ||
      (result.changes === 1 && readBack.matched_at !== association.matched_at)
    ) {
      throw new Error("Topic Association readback did not match the insert");
    }

    return {
      changes: result.changes,
      association: readBack,
    };
  }

  #assertTransaction(): void {
    if (this.#database.inTransaction !== true) {
      throw new Error(
        "TopicAssociationRepository writes require an active transaction",
      );
    }
  }
}
