import type Database from "better-sqlite3";

import { encodeRetrievalCursor } from "../pagination.js";
import type {
  ContentDto,
  EvidenceContentDto,
  EventDto,
  EventUpdateDto,
  KnowledgeDto,
  RetrievalList,
  RetrievalListOptions,
  RetrievalTargetDto,
  RetrievalTargetType,
  SourceDto,
  SourceItemDto,
  TopicDto,
} from "../contracts.js";

export interface SqlRow {
  readonly [column: string]: unknown;
}

export function retrievalLimit(limit: number | undefined): number {
  return limit ?? 50;
}

export function list<T extends SqlRow, D>(
  rows: T[],
  options: RetrievalListOptions,
  map: (row: T) => D,
  cursorRow: (row: T) => { time: string; id: string },
): RetrievalList<D> {
  const limit = retrievalLimit(options.limit);
  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    next_cursor:
      hasNext && last !== undefined
        ? encodeRetrievalCursor(cursorRow(last), {
            target_type: options.target_type,
            published_after: options.published_after,
            published_before: options.published_before,
          })
        : null,
  };
}

export function getRow(
  db: Database.Database,
  sql: string,
  ...parameters: string[]
): SqlRow | undefined {
  return db.prepare(sql).get(...parameters) as SqlRow | undefined;
}

export function getRows(
  db: Database.Database,
  sql: string,
  ...parameters: Array<string | number>
): SqlRow[] {
  return db.prepare(sql).all(...parameters) as SqlRow[];
}

function text(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Malformed retrieval row: ${column}`);
  }
  return value;
}

function nullableText(row: SqlRow, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Malformed retrieval row: ${column}`);
  }
  return value;
}

export function mapEvent(row: SqlRow): EventDto {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    entity_name: text(row, "entity_name"),
    subject: text(row, "subject"),
    scope: text(row, "scope"),
    description: text(row, "description"),
    occurred_at: nullableText(row, "occurred_at"),
    discovered_at: text(row, "discovered_at"),
  };
}

export function mapEventUpdate(row: SqlRow): EventUpdateDto {
  return {
    id: text(row, "id"),
    event_id: text(row, "event_id"),
    title: text(row, "title"),
    description: text(row, "description"),
    occurred_at: nullableText(row, "occurred_at"),
    discovered_at: text(row, "discovered_at"),
  };
}

export function parseFindings(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapKnowledge(row: SqlRow): KnowledgeDto {
  const category = nullableText(row, "category");
  if (
    category !== null &&
    category !== "Insight" &&
    category !== "Experience" &&
    category !== "Method" &&
    category !== "Resource"
  ) {
    throw new Error("Malformed retrieval row: category");
  }
  return {
    id: text(row, "id"),
    content_id: text(row, "content_id"),
    title: text(row, "title"),
    summary: text(row, "summary"),
    category,
    findings: parseFindings(text(row, "findings_json")),
    value: text(row, "value"),
  };
}

export function mapContent(row: SqlRow): ContentDto {
  const completeness = text(row, "completeness");
  if (completeness !== "FULL" && completeness !== "PARTIAL") {
    throw new Error("Malformed retrieval row: completeness");
  }
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    url: nullableText(row, "url"),
    author: nullableText(row, "author"),
    published_at: nullableText(row, "published_at"),
    created_at: text(row, "created_at"),
    body: text(row, "body"),
    summary: nullableText(row, "summary"),
    language: nullableText(row, "language"),
    completeness,
  };
}

export function mapEvidence(row: SqlRow): EvidenceContentDto {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    url: nullableText(row, "url"),
    author: nullableText(row, "author"),
    published_at: nullableText(row, "published_at"),
    created_at: text(row, "created_at"),
  };
}

export function mapSourceItem(row: SqlRow): SourceItemDto {
  return {
    id: text(row, "id"),
    source_id: text(row, "source_id"),
    external_id: nullableText(row, "external_id"),
    url: nullableText(row, "url"),
    title: nullableText(row, "title"),
    published_at: nullableText(row, "published_at"),
    discovered_at: text(row, "discovered_at"),
    content_id: nullableText(row, "content_id"),
    raw_data: nullableText(row, "raw_data"),
  };
}

export function mapSource(row: SqlRow): SourceDto {
  const enabled = row.enabled;
  if (enabled !== 0 && enabled !== 1) {
    throw new Error("Malformed retrieval row: enabled");
  }
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    type: text(row, "type"),
    url: text(row, "url"),
    cron: text(row, "cron"),
    enabled: enabled === 1,
    description: nullableText(row, "description"),
    last_collected_at: nullableText(row, "last_collected_at"),
  };
}

export function mapTopic(row: SqlRow): TopicDto {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    matched_at: text(row, "matched_at"),
  };
}

export function evidenceFor(
  db: Database.Database,
  targetType: "EVENT" | "EVENT_UPDATE",
  targetId: string,
): EvidenceContentDto[] {
  return getRows(
    db,
    `SELECT c.id, c.title, c.url, c.author, c.published_at, c.created_at
     FROM event_content_links AS l
     JOIN contents AS c ON c.id = l.content_id
     WHERE l.target_type = ? AND l.target_id = ?
     ORDER BY c.created_at DESC, c.id DESC`,
    targetType,
    targetId,
  ).map(mapEvidence);
}

export function topicsFor(
  db: Database.Database,
  targetType: RetrievalTargetType,
  targetId: string,
): TopicDto[] {
  return getRows(
    db,
    `SELECT t.id, t.name, a.matched_at
     FROM topic_associations AS a
     JOIN topics AS t ON t.id = a.topic_id
     WHERE a.target_type = ? AND a.target_id = ?
     ORDER BY a.matched_at DESC, t.id DESC`,
    targetType,
    targetId,
  ).map(mapTopic);
}

export const EVENT_COLUMNS =
  "id, title, entity_name, subject, scope, description, occurred_at, discovered_at";
export const EVENT_UPDATE_COLUMNS =
  "id, event_id, title, description, occurred_at, discovered_at";
export const KNOWLEDGE_COLUMNS =
  "id, content_id, title, summary, category, findings_json, value";
export const CONTENT_COLUMNS =
  "id, title, url, author, published_at, created_at, body, summary, language, completeness";

export function readTarget(
  db: Database.Database,
  targetType: RetrievalTargetType,
  targetId: string,
): RetrievalTargetDto | null {
  try {
    if (targetType === "EVENT") {
      const row = getRow(
        db,
        `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`,
        targetId,
      );
      return row === undefined ? null : mapEvent(row);
    }
    if (targetType === "EVENT_UPDATE") {
      const row = getRow(
        db,
        `SELECT ${EVENT_UPDATE_COLUMNS} FROM event_updates WHERE id = ?`,
        targetId,
      );
      return row === undefined ? null : mapEventUpdate(row);
    }
    const row = getRow(
      db,
      `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge WHERE id = ?`,
      targetId,
    );
    return row === undefined ? null : mapKnowledge(row);
  } catch {
    return null;
  }
}
