import type Database from "better-sqlite3";

import type { IdGenerator } from "../id/id-generator.js";

export interface SourceItemDraft {
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  discovered_at: string;
  content_id: null;
  raw_data: string;
}

export interface SourceItemRecord {
  id: string;
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  discovered_at: string;
  content_id: string | null;
  raw_data: string | null;
}

export interface SourceItemRepository {
  existsByExternalId(sourceId: string, externalId: string): boolean;
  existsByUrlAndPublishedAt(
    sourceId: string,
    url: string,
    publishedAt: string | null,
  ): boolean;
  insert(draft: SourceItemDraft): SourceItemRecord;
}

interface SourceItemRow {
  id: string;
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  discovered_at: string;
  content_id: string | null;
  raw_data: string | null;
}

const SOURCE_ITEM_COLUMNS = `
  id, source_id, external_id, url, title, published_at, discovered_at,
  content_id, raw_data
`;
const EXISTS_BY_EXTERNAL_ID = `
  SELECT 1
  FROM source_items
  WHERE source_id = ? AND external_id = ?
  LIMIT 1
`;
const EXISTS_BY_URL_AND_PUBLISHED_AT = `
  SELECT 1
  FROM source_items
  WHERE source_id = ? AND url = ? AND published_at = ?
  LIMIT 1
`;
const EXISTS_BY_URL_AND_NULL_PUBLISHED_AT = `
  SELECT 1
  FROM source_items
  WHERE source_id = ? AND url = ? AND published_at IS NULL
  LIMIT 1
`;
const SELECT_BY_ID = `
  SELECT ${SOURCE_ITEM_COLUMNS}
  FROM source_items
  WHERE id = ?
`;
const INSERT_SOURCE_ITEM = `
  INSERT INTO source_items (
    id, source_id, external_id, url, title, published_at, discovered_at,
    content_id, raw_data
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
`;

function mapSourceItemRow(row: SourceItemRow): SourceItemRecord {
  return {
    id: row.id,
    source_id: row.source_id,
    external_id: row.external_id,
    url: row.url,
    title: row.title,
    published_at: row.published_at,
    discovered_at: row.discovered_at,
    content_id: row.content_id,
    raw_data: row.raw_data,
  };
}

export class SqliteSourceItemRepository implements SourceItemRepository {
  private readonly db: Database.Database;
  private readonly idGenerator: IdGenerator;

  constructor(db: Database.Database, idGenerator: IdGenerator) {
    this.db = db;
    this.idGenerator = idGenerator;
  }

  existsByExternalId(sourceId: string, externalId: string): boolean {
    return (
      this.db.prepare(EXISTS_BY_EXTERNAL_ID).get(sourceId, externalId) !==
      undefined
    );
  }

  existsByUrlAndPublishedAt(
    sourceId: string,
    url: string,
    publishedAt: string | null,
  ): boolean {
    if (publishedAt === null) {
      return (
        this.db
          .prepare(EXISTS_BY_URL_AND_NULL_PUBLISHED_AT)
          .get(sourceId, url) !== undefined
      );
    }

    return (
      this.db
        .prepare(EXISTS_BY_URL_AND_PUBLISHED_AT)
        .get(sourceId, url, publishedAt) !== undefined
    );
  }

  insert(draft: SourceItemDraft): SourceItemRecord {
    const id = this.idGenerator.next();

    this.db
      .prepare(INSERT_SOURCE_ITEM)
      .run(
        id,
        draft.source_id,
        draft.external_id,
        draft.url,
        draft.title,
        draft.published_at,
        draft.discovered_at,
        draft.raw_data,
      );

    const row = this.db.prepare(SELECT_BY_ID).get(id) as
      SourceItemRow | undefined;
    if (row === undefined) {
      throw new Error("Inserted Source Item could not be read");
    }

    return mapSourceItemRow(row);
  }
}
