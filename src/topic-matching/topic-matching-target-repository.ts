import type Database from "better-sqlite3";

import type { KnowledgeCategory } from "../knowledge/knowledge-repository.js";
import type {
  EventTopicTarget,
  EventUpdateTopicTarget,
  KnowledgeTopicFinding,
  KnowledgeTopicTarget,
  TopicMatchingTarget,
  TopicTargetType,
} from "./contracts.js";

interface EventTargetRow {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
}

interface EventUpdateTargetRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly parent_id: string;
  readonly parent_title: string;
  readonly parent_entity_name: string;
  readonly parent_subject: string;
  readonly parent_scope: string;
  readonly parent_description: string;
}

interface KnowledgeTargetRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string | null;
  readonly findings_json: string;
  readonly value: string;
}

const EVENT_TARGET_COLUMNS = `
  id, title, entity_name, subject, scope, description, occurred_at
`;
const KNOWLEDGE_TARGET_COLUMNS = `
  id, title, summary, category, findings_json, value
`;
const SELECT_EVENT_TARGET = `
  SELECT ${EVENT_TARGET_COLUMNS}
  FROM events
  WHERE id = ?
`;
const SELECT_EVENT_UPDATE_TARGET = `
  SELECT
    u.id AS id,
    u.event_id AS event_id,
    u.title AS title,
    u.description AS description,
    u.occurred_at AS occurred_at,
    e.id AS parent_id,
    e.title AS parent_title,
    e.entity_name AS parent_entity_name,
    e.subject AS parent_subject,
    e.scope AS parent_scope,
    e.description AS parent_description
  FROM event_updates AS u
  JOIN events AS e ON e.id = u.event_id
  WHERE u.id = ?
`;
const SELECT_KNOWLEDGE_TARGET = `
  SELECT ${KNOWLEDGE_TARGET_COLUMNS}
  FROM knowledge
  WHERE id = ?
`;

const KNOWLEDGE_CATEGORIES = new Set([
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

function isKnowledgeTopicFinding(
  value: unknown,
): value is KnowledgeTopicFinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const finding = value as { title?: unknown; description?: unknown };
  return (
    typeof finding.title === "string" && typeof finding.description === "string"
  );
}

function parseKnowledgeFindings(findingsJson: string): KnowledgeTopicFinding[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    throw new Error("Malformed Knowledge findings JSON");
  }

  if (!Array.isArray(parsed) || !parsed.every(isKnowledgeTopicFinding)) {
    throw new Error("Malformed Knowledge findings JSON");
  }

  return parsed.map((finding) => ({
    title: finding.title,
    description: finding.description,
  }));
}

function mapEventTarget(row: EventTargetRow): EventTopicTarget {
  return {
    target_type: "EVENT",
    id: row.id,
    title: row.title,
    entity_name: row.entity_name,
    subject: row.subject,
    scope: row.scope,
    description: row.description,
    occurred_at: row.occurred_at,
  };
}

function mapEventUpdateTarget(
  row: EventUpdateTargetRow,
): EventUpdateTopicTarget {
  return {
    target_type: "EVENT_UPDATE",
    id: row.id,
    event_id: row.event_id,
    title: row.title,
    description: row.description,
    occurred_at: row.occurred_at,
    event: {
      id: row.parent_id,
      title: row.parent_title,
      entity_name: row.parent_entity_name,
      subject: row.parent_subject,
      scope: row.parent_scope,
      description: row.parent_description,
    },
  };
}

function mapKnowledgeTarget(row: KnowledgeTargetRow): KnowledgeTopicTarget {
  if (
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.value !== "string" ||
    typeof row.findings_json !== "string"
  ) {
    throw new Error("Malformed Knowledge target row");
  }

  if (!isKnowledgeCategory(row.category)) {
    throw new Error("Malformed Knowledge target category");
  }

  return {
    target_type: "KNOWLEDGE",
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    findings: parseKnowledgeFindings(row.findings_json),
    value: row.value,
  };
}

export interface TopicMatchingTargetRepository {
  getTarget(
    targetType: TopicTargetType,
    targetId: string,
  ): TopicMatchingTarget | null;
}

export class SqliteTopicMatchingTargetRepository implements TopicMatchingTargetRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  getTarget(
    targetType: TopicTargetType,
    targetId: string,
  ): TopicMatchingTarget | null {
    if (targetType === "EVENT") {
      return this.#getEventTarget(targetId);
    }

    if (targetType === "EVENT_UPDATE") {
      return this.#getEventUpdateTarget(targetId);
    }

    return this.#getKnowledgeTarget(targetId);
  }

  #getEventTarget(targetId: string): EventTopicTarget | null {
    const row = this.#database
      .prepare<[string], EventTargetRow>(SELECT_EVENT_TARGET)
      .get(targetId);

    return row === undefined ? null : mapEventTarget(row);
  }

  #getEventUpdateTarget(targetId: string): EventUpdateTopicTarget | null {
    const row = this.#database
      .prepare<[string], EventUpdateTargetRow>(SELECT_EVENT_UPDATE_TARGET)
      .get(targetId);

    return row === undefined ? null : mapEventUpdateTarget(row);
  }

  #getKnowledgeTarget(targetId: string): KnowledgeTopicTarget | null {
    const row = this.#database
      .prepare<[string], KnowledgeTargetRow>(SELECT_KNOWLEDGE_TARGET)
      .get(targetId);

    return row === undefined ? null : mapKnowledgeTarget(row);
  }
}
