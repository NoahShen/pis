import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { IdGenerator } from "../id/id-generator.js";
import {
  parseTopicCreate,
  parseTopicUpdate,
  type Topic,
  type TopicCreateInput,
  type TopicUpdateInput,
} from "./contracts.js";

interface TopicRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
}

export interface TopicRepository {
  create(value: unknown): Topic;
  getById(id: string): Topic | null;
  list(): Topic[];
  listEnabled(): Topic[];
  update(id: string, value: unknown): Topic | null;
}

const TOPIC_COLUMNS = "id, name, description, enabled";
const SELECT_TOPIC_BY_ID = `SELECT ${TOPIC_COLUMNS} FROM topics WHERE id = ?`;
const SELECT_ALL_TOPICS = `SELECT ${TOPIC_COLUMNS} FROM topics ORDER BY id COLLATE BINARY ASC`;
const SELECT_ENABLED_TOPICS = `SELECT ${TOPIC_COLUMNS} FROM topics WHERE enabled = 1 ORDER BY id COLLATE BINARY ASC`;
const INSERT_TOPIC = `
  INSERT INTO topics (id, name, description, enabled) VALUES (?, ?, ?, ?)
`;

function mapTopicRow(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
  };
}

function getTopicRow(db: Database.Database, id: string): TopicRow | undefined {
  return db.prepare(SELECT_TOPIC_BY_ID).get(id) as TopicRow | undefined;
}

function listTopicRows(
  db: Database.Database,
  statementSource: string,
): Topic[] {
  const rows = db.prepare(statementSource).all() as TopicRow[];
  return rows.map(mapTopicRow);
}

function createTopic(
  db: Database.Database,
  idGenerator: IdGenerator,
  value: TopicCreateInput,
): Topic {
  return withTransaction(db, () => {
    const id = idGenerator.next();
    db.prepare(INSERT_TOPIC).run(
      id,
      value.name,
      value.description,
      (value.enabled ?? true) ? 1 : 0,
    );

    const row = getTopicRow(db, id);
    if (row === undefined) {
      throw new Error("Created Topic could not be read");
    }

    return mapTopicRow(row);
  });
}

function updateTopic(
  db: Database.Database,
  id: string,
  value: TopicUpdateInput,
): Topic | null {
  return withTransaction(db, () => {
    if (getTopicRow(db, id) === undefined) {
      return null;
    }

    const assignments: string[] = [];
    const parameters: Array<string | number> = [];

    if (value.name !== undefined) {
      assignments.push("name = ?");
      parameters.push(value.name);
    }
    if (value.description !== undefined) {
      assignments.push("description = ?");
      parameters.push(value.description);
    }
    if (value.enabled !== undefined) {
      assignments.push("enabled = ?");
      parameters.push(value.enabled ? 1 : 0);
    }

    db.prepare(`UPDATE topics SET ${assignments.join(", ")} WHERE id = ?`).run(
      ...parameters,
      id,
    );

    const row = getTopicRow(db, id);
    if (row === undefined) {
      throw new Error("Updated Topic could not be read");
    }

    return mapTopicRow(row);
  });
}

export class SqliteTopicRepository implements TopicRepository {
  private readonly db: Database.Database;
  private readonly idGenerator: IdGenerator;

  constructor(db: Database.Database, idGenerator: IdGenerator) {
    this.db = db;
    this.idGenerator = idGenerator;
  }

  create(value: unknown): Topic {
    return createTopic(this.db, this.idGenerator, parseTopicCreate(value));
  }

  getById(id: string): Topic | null {
    const row = getTopicRow(this.db, id);
    return row === undefined ? null : mapTopicRow(row);
  }

  list(): Topic[] {
    return listTopicRows(this.db, SELECT_ALL_TOPICS);
  }

  listEnabled(): Topic[] {
    return listTopicRows(this.db, SELECT_ENABLED_TOPICS);
  }

  update(id: string, value: unknown): Topic | null {
    return updateTopic(this.db, id, parseTopicUpdate(value));
  }
}
