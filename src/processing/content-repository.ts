import type Database from "better-sqlite3";

import type { IdGenerator } from "../id/id-generator.js";

export interface ContentDraft {
  title: string;
  url: string | null;
  author: string | null;
  published_at: string | null;
  created_at: string;
  body: string;
  summary: string | null;
  language: null;
  completeness: "FULL" | "PARTIAL";
}

export interface ContentRecord extends ContentDraft {
  id: string;
}

interface ContentRow {
  id: string;
  title: string;
  url: string | null;
  author: string | null;
  published_at: string | null;
  created_at: string;
  body: string;
  summary: string | null;
  language: string | null;
  completeness: "FULL" | "PARTIAL";
}

export interface ContentRepository {
  getById(id: string): ContentRecord | null;
  insert(draft: ContentDraft): ContentRecord;
}

const CONTENT_COLUMNS = `
  id, title, url, author, published_at, created_at, body, summary, language,
  completeness
`;
const SELECT_BY_ID = `
  SELECT ${CONTENT_COLUMNS}
  FROM contents
  WHERE id = ?
`;
const INSERT_CONTENT = `
  INSERT INTO contents (
    id, title, url, author, published_at, created_at, body, summary, language,
    completeness
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function mapContentRow(row: ContentRow): ContentRecord {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    published_at: row.published_at,
    created_at: row.created_at,
    body: row.body,
    summary: row.summary,
    language: null,
    completeness: row.completeness,
  };
}

export class SqliteContentRepository implements ContentRepository {
  private readonly db: Database.Database;
  private readonly idGenerator: IdGenerator;

  constructor(db: Database.Database, idGenerator: IdGenerator) {
    this.db = db;
    this.idGenerator = idGenerator;
  }

  getById(id: string): ContentRecord | null {
    const row = this.db.prepare(SELECT_BY_ID).get(id) as ContentRow | undefined;

    return row === undefined ? null : mapContentRow(row);
  }

  insert(draft: ContentDraft): ContentRecord {
    const id = this.idGenerator.next();
    const result = this.db
      .prepare(INSERT_CONTENT)
      .run(
        id,
        draft.title,
        draft.url,
        draft.author,
        draft.published_at,
        draft.created_at,
        draft.body,
        draft.summary,
        draft.language,
        draft.completeness,
      );

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly one Content insert, received ${result.changes}`,
      );
    }

    const content = this.getById(id);
    if (content === null) {
      throw new Error("Inserted Content could not be read");
    }

    return content;
  }
}
