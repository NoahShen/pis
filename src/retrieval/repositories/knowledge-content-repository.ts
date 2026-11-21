import type Database from "better-sqlite3";

import type {
  ContentDetailDto,
  KnowledgeContentRetrievalRepository,
  KnowledgeDetailDto,
  KnowledgeDto,
  RetrievalList,
  RetrievalListOptions,
} from "../contracts.js";
import {
  CONTENT_COLUMNS,
  KNOWLEDGE_COLUMNS,
  getRow,
  getRows,
  list,
  mapContent,
  mapKnowledge,
  mapSource,
  mapSourceItem,
  retrievalLimit,
} from "./shared.js";

export class SqliteKnowledgeContentRetrievalRepository implements KnowledgeContentRetrievalRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  listKnowledge(
    options: RetrievalListOptions = {},
  ): RetrievalList<KnowledgeDto> {
    const rows = getRows(
      this.#db,
      `SELECT k.id, k.content_id, k.title, k.summary, k.category,
              k.findings_json, k.value
       FROM knowledge AS k
       JOIN contents AS c ON c.id = k.content_id
       ORDER BY c.created_at DESC, k.id DESC
       LIMIT ?`,
      retrievalLimit(options.limit),
    );
    return list(rows.map(mapKnowledge));
  }

  getKnowledgeById(id: string): KnowledgeDetailDto | null {
    const row = getRow(
      this.#db,
      `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge WHERE id = ?`,
      id,
    );
    if (row === undefined) return null;
    const knowledge = mapKnowledge(row);
    const content = getRow(
      this.#db,
      `SELECT ${CONTENT_COLUMNS} FROM contents WHERE id = ?`,
      knowledge.content_id,
    );
    return {
      ...knowledge,
      content: content === undefined ? null : mapContent(content),
    };
  }

  getContentById(id: string): ContentDetailDto | null {
    const row = getRow(
      this.#db,
      `SELECT ${CONTENT_COLUMNS} FROM contents WHERE id = ?`,
      id,
    );
    if (row === undefined) return null;
    const sourceItem = getRow(
      this.#db,
      `SELECT id, source_id, external_id, url, title, published_at,
              discovered_at, content_id, raw_data
       FROM source_items WHERE content_id = ?`,
      id,
    );
    if (sourceItem === undefined) {
      return { ...mapContent(row), source_item: null, source: null };
    }
    const mappedItem = mapSourceItem(sourceItem);
    const source = getRow(
      this.#db,
      `SELECT id, name, type, url, cron, enabled, description, last_collected_at
       FROM sources WHERE id = ?`,
      mappedItem.source_id,
    );
    return {
      ...mapContent(row),
      source_item: mappedItem,
      source: source === undefined ? null : mapSource(source),
    };
  }
}

export { SqliteKnowledgeContentRetrievalRepository as SqliteRetrievalKnowledgeContentRepository };
