import type Database from "better-sqlite3";

import type {
  PublicationSourceLinkRepository,
  PublicationTargetType,
} from "./contracts.js";

interface SourceLinkRow {
  readonly source_url: string | null;
  readonly content_url: string | null;
}

const EVENT_SOURCE_SQL = `
  SELECT
    source_items.url AS source_url,
    contents.url AS content_url
  FROM event_content_links
  JOIN contents
    ON contents.id = event_content_links.content_id
  LEFT JOIN source_items
    ON source_items.content_id = contents.id
  WHERE event_content_links.target_type = ?
    AND event_content_links.target_id = ?
  ORDER BY source_items.discovered_at ASC, source_items.id ASC
`;

const KNOWLEDGE_SOURCE_SQL = `
  SELECT
    source_items.url AS source_url,
    contents.url AS content_url
  FROM knowledge
  JOIN contents
    ON contents.id = knowledge.content_id
  LEFT JOIN source_items
    ON source_items.content_id = contents.id
  WHERE knowledge.id = ?
  ORDER BY source_items.discovered_at ASC, source_items.id ASC
`;

function sourceUrlFromRow(row: SourceLinkRow): string {
  if (typeof row.source_url === "string") {
    const sourceUrl = row.source_url.trim();
    if (sourceUrl.length > 0) {
      return sourceUrl;
    }
  }

  return typeof row.content_url === "string" ? row.content_url : "";
}

export class SqlitePublicationSourceLinkRepository implements PublicationSourceLinkRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  listSourceUrls(
    targetType: PublicationTargetType,
    targetId: string,
  ): readonly string[] {
    const rows =
      targetType === "KNOWLEDGE"
        ? (this.#database
            .prepare(KNOWLEDGE_SOURCE_SQL)
            .all(targetId) as SourceLinkRow[])
        : (this.#database
            .prepare(EVENT_SOURCE_SQL)
            .all(targetType, targetId) as SourceLinkRow[]);

    return rows.map(sourceUrlFromRow);
  }
}
