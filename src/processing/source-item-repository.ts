import type Database from "better-sqlite3";

import type { SourceItemRecord } from "../collection/source-item-repository.js";

export interface ProcessingSourceItemRepository {
  getById(id: string): SourceItemRecord | null;
  setContentId(id: string, contentId: string): SourceItemRecord;
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
const SELECT_BY_ID = `
  SELECT ${SOURCE_ITEM_COLUMNS}
  FROM source_items
  WHERE id = ?
`;
const UPDATE_CONTENT_ID = `
  UPDATE source_items
  SET content_id = ?
  WHERE id = ?
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

export class SqliteProcessingSourceItemRepository implements ProcessingSourceItemRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getById(id: string): SourceItemRecord | null {
    const row = this.db.prepare(SELECT_BY_ID).get(id) as
      SourceItemRow | undefined;

    return row === undefined ? null : mapSourceItemRow(row);
  }

  setContentId(id: string, contentId: string): SourceItemRecord {
    const result = this.db.prepare(UPDATE_CONTENT_ID).run(contentId, id);

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly one Source Item update, received ${result.changes}`,
      );
    }

    const sourceItem = this.getById(id);
    if (sourceItem === null) {
      throw new Error("Updated Source Item could not be read");
    }

    return sourceItem;
  }
}
