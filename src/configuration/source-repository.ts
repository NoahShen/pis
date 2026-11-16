import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { IdGenerator } from "../id/id-generator.js";
import {
  parseSourceCreate,
  parseSourceUpdate,
  type Source,
  type SourceCreateInput,
  type SourceUpdateInput,
} from "./contracts.js";

interface SourceRow {
  id: string;
  name: string;
  type: string;
  url: string;
  cron: string;
  enabled: number;
  description: string | null;
  last_collected_at: string | null;
}

export interface SourceRepository {
  create(value: unknown): Source;
  getById(id: string): Source | null;
  list(): Source[];
  listEnabled(): Source[];
  update(id: string, value: unknown): Source | null;
}

const SOURCE_COLUMNS = `
  id, name, type, url, cron, enabled, description, last_collected_at
`;
const SELECT_SOURCE_BY_ID = `SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`;
const SELECT_ALL_SOURCES = `SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY id COLLATE BINARY ASC`;
const SELECT_ENABLED_SOURCES = `SELECT ${SOURCE_COLUMNS} FROM sources WHERE enabled = 1 ORDER BY id COLLATE BINARY ASC`;
const INSERT_SOURCE = `
  INSERT INTO sources (
    id, name, type, url, cron, enabled, description, last_collected_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
`;

function mapSourceRow(row: SourceRow): Source {
  if (row.type !== "RSS") {
    throw new Error("Persisted Source type is not supported");
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url,
    cron: row.cron,
    enabled: row.enabled === 1,
    description: row.description,
    last_collected_at: row.last_collected_at,
  };
}

function getSourceRow(
  db: Database.Database,
  id: string,
): SourceRow | undefined {
  return db.prepare(SELECT_SOURCE_BY_ID).get(id) as SourceRow | undefined;
}

function listSourceRows(
  db: Database.Database,
  statementSource: string,
): Source[] {
  const rows = db.prepare(statementSource).all() as SourceRow[];
  return rows.map(mapSourceRow);
}

function createSource(
  db: Database.Database,
  idGenerator: IdGenerator,
  value: SourceCreateInput,
): Source {
  return withTransaction(db, () => {
    const id = idGenerator.next();
    db.prepare(INSERT_SOURCE).run(
      id,
      value.name,
      value.type,
      value.url,
      value.cron,
      (value.enabled ?? true) ? 1 : 0,
      value.description ?? null,
    );

    const row = getSourceRow(db, id);
    if (row === undefined) {
      throw new Error("Created Source could not be read");
    }

    return mapSourceRow(row);
  });
}

function updateSource(
  db: Database.Database,
  id: string,
  value: SourceUpdateInput,
): Source | null {
  return withTransaction(db, () => {
    if (getSourceRow(db, id) === undefined) {
      return null;
    }

    const assignments: string[] = [];
    const parameters: Array<string | number | null> = [];

    if (value.name !== undefined) {
      assignments.push("name = ?");
      parameters.push(value.name);
    }
    if (value.cron !== undefined) {
      assignments.push("cron = ?");
      parameters.push(value.cron);
    }
    if (value.enabled !== undefined) {
      assignments.push("enabled = ?");
      parameters.push(value.enabled ? 1 : 0);
    }
    if (value.description !== undefined) {
      assignments.push("description = ?");
      parameters.push(value.description);
    }

    db.prepare(`UPDATE sources SET ${assignments.join(", ")} WHERE id = ?`).run(
      ...parameters,
      id,
    );

    const row = getSourceRow(db, id);
    if (row === undefined) {
      throw new Error("Updated Source could not be read");
    }

    return mapSourceRow(row);
  });
}

export class SqliteSourceRepository implements SourceRepository {
  private readonly db: Database.Database;
  private readonly idGenerator: IdGenerator;

  constructor(db: Database.Database, idGenerator: IdGenerator) {
    this.db = db;
    this.idGenerator = idGenerator;
  }

  create(value: unknown): Source {
    return createSource(this.db, this.idGenerator, parseSourceCreate(value));
  }

  getById(id: string): Source | null {
    const row = getSourceRow(this.db, id);
    return row === undefined ? null : mapSourceRow(row);
  }

  list(): Source[] {
    return listSourceRows(this.db, SELECT_ALL_SOURCES);
  }

  listEnabled(): Source[] {
    return listSourceRows(this.db, SELECT_ENABLED_SOURCES);
  }

  update(id: string, value: unknown): Source | null {
    return updateSource(this.db, id, parseSourceUpdate(value));
  }
}
