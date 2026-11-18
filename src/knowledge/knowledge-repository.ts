import type Database from "better-sqlite3";

export type KnowledgeFinding = {
  title: string;
  description: string;
};

export type KnowledgeCategory =
  "Insight" | "Experience" | "Method" | "Resource" | null;

export interface KnowledgeDraft {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: KnowledgeCategory;
  findings: KnowledgeFinding[];
  value: string;
}

export interface KnowledgeRecord extends KnowledgeDraft {}

export interface KnowledgeRepository {
  getByContentId(contentId: string): KnowledgeRecord | null;
  insert(draft: KnowledgeDraft): KnowledgeRecord;
}

interface KnowledgeRow {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: string | null;
  findings_json: string;
  value: string;
}

const KNOWLEDGE_COLUMNS = `
  id, content_id, title, summary, category, findings_json, value
`;
const SELECT_BY_CONTENT_ID = `
  SELECT ${KNOWLEDGE_COLUMNS}
  FROM knowledge
  WHERE content_id = ?
`;
const SELECT_BY_ID = `
  SELECT ${KNOWLEDGE_COLUMNS}
  FROM knowledge
  WHERE id = ?
`;
const INSERT_KNOWLEDGE = `
  INSERT INTO knowledge (
    id, content_id, title, summary, category, findings_json, value
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`;
const KNOWLEDGE_CATEGORIES = new Set<string>([
  "Insight",
  "Experience",
  "Method",
  "Resource",
]);

function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return (
    value === null ||
    (typeof value === "string" && KNOWLEDGE_CATEGORIES.has(value))
  );
}

function isKnowledgeFinding(value: unknown): value is KnowledgeFinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const finding = value as { title?: unknown; description?: unknown };
  return (
    typeof finding.title === "string" && typeof finding.description === "string"
  );
}

function parseFindings(findingsJson: string): KnowledgeFinding[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    throw new Error("Malformed Knowledge findings JSON");
  }

  if (!Array.isArray(parsed) || !parsed.every(isKnowledgeFinding)) {
    throw new Error("Malformed Knowledge findings JSON");
  }

  return parsed;
}

function mapKnowledgeRow(row: KnowledgeRow): KnowledgeRecord {
  if (
    typeof row.id !== "string" ||
    typeof row.content_id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.value !== "string" ||
    typeof row.findings_json !== "string"
  ) {
    throw new Error("Malformed Knowledge row");
  }

  if (!isKnowledgeCategory(row.category)) {
    throw new Error("Malformed Knowledge category");
  }

  return {
    id: row.id,
    content_id: row.content_id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    findings: parseFindings(row.findings_json),
    value: row.value,
  };
}

function serializeFindings(findings: readonly KnowledgeFinding[]): string {
  if (!Array.isArray(findings) || !findings.every(isKnowledgeFinding)) {
    throw new Error("Malformed Knowledge findings");
  }

  return JSON.stringify(findings);
}

export class SqliteKnowledgeRepository implements KnowledgeRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getByContentId(contentId: string): KnowledgeRecord | null {
    const row = this.#db.prepare(SELECT_BY_CONTENT_ID).get(contentId) as
      KnowledgeRow | undefined;

    return row === undefined ? null : mapKnowledgeRow(row);
  }

  insert(draft: KnowledgeDraft): KnowledgeRecord {
    const findingsJson = serializeFindings(draft.findings);
    const result = this.#db
      .prepare(INSERT_KNOWLEDGE)
      .run(
        draft.id,
        draft.content_id,
        draft.title,
        draft.summary,
        draft.category,
        findingsJson,
        draft.value,
      );

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly one Knowledge insert, received ${result.changes}`,
      );
    }

    const inserted = this.#readById(draft.id);
    if (inserted === null || inserted.content_id !== draft.content_id) {
      throw new Error("Inserted Knowledge could not be read");
    }

    return inserted;
  }

  #readById(id: string): KnowledgeRecord | null {
    const row = this.#db.prepare(SELECT_BY_ID).get(id) as
      KnowledgeRow | undefined;

    return row === undefined ? null : mapKnowledgeRow(row);
  }
}
