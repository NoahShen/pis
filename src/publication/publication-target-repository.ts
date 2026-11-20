import type Database from "better-sqlite3";

import type {
  PublicationContext,
  PublicationEvent,
  PublicationEventSummary,
  PublicationFinding,
  PublicationKnowledge,
  PublicationTargetRepository,
  PublicationTargetType,
  PublicationUpdate,
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
}

interface KnowledgeTargetRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string | null;
  readonly findings_json: string;
  readonly value: string;
}

const SELECT_EVENT_TARGET = `
  SELECT id, title, entity_name, subject, scope, description, occurred_at
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
    e.scope AS parent_scope
  FROM event_updates AS u
  JOIN events AS e ON e.id = u.event_id
  WHERE u.id = ?
`;
const SELECT_KNOWLEDGE_TARGET = `
  SELECT id, title, summary, category, findings_json, value
  FROM knowledge
  WHERE id = ?
`;
const EXISTS_TOPIC_ASSOCIATION = `
  SELECT 1
  FROM topic_associations
  WHERE target_type = ? AND target_id = ?
  LIMIT 1
`;

function isPublicationFinding(value: unknown): value is PublicationFinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const finding = value as {
    readonly title?: unknown;
    readonly description?: unknown;
  };
  return (
    typeof finding.title === "string" && typeof finding.description === "string"
  );
}

function parseFindings(findingsJson: string): PublicationFinding[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(findingsJson);
  } catch {
    throw new Error("Malformed Publication knowledge findings JSON");
  }

  if (!Array.isArray(parsed) || !parsed.every(isPublicationFinding)) {
    throw new Error("Malformed Publication knowledge findings JSON");
  }

  return parsed.map((finding) => ({
    title: finding.title,
    description: finding.description,
  }));
}

function mapEvent(row: EventTargetRow): PublicationContext {
  const event: PublicationEvent = {
    id: row.id,
    title: row.title,
    entityName: row.entity_name,
    subject: row.subject,
    scope: row.scope,
    description: row.description,
  };

  return {
    targetType: "EVENT",
    event,
    occurredAt: row.occurred_at,
  };
}

function mapEventUpdate(row: EventUpdateTargetRow): PublicationContext {
  const update: PublicationUpdate = {
    id: row.id,
    eventId: row.event_id,
    title: row.title,
    description: row.description,
  };
  const parentEvent: PublicationEventSummary = {
    id: row.parent_id,
    title: row.parent_title,
    entityName: row.parent_entity_name,
    subject: row.parent_subject,
    scope: row.parent_scope,
  };

  return {
    targetType: "EVENT_UPDATE",
    update,
    parentEvent,
    occurredAt: row.occurred_at,
  };
}

function mapKnowledge(row: KnowledgeTargetRow): PublicationContext {
  if (
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    typeof row.summary !== "string" ||
    (row.category !== null && typeof row.category !== "string") ||
    typeof row.findings_json !== "string" ||
    typeof row.value !== "string"
  ) {
    throw new Error("Malformed Publication knowledge row");
  }

  const knowledge: PublicationKnowledge = {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    findings: parseFindings(row.findings_json),
    value: row.value,
  };

  return {
    targetType: "KNOWLEDGE",
    knowledge,
  };
}

export class SqlitePublicationTargetRepository implements PublicationTargetRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  getContext(
    targetType: PublicationTargetType,
    targetId: string,
  ): PublicationContext | null {
    if (targetType === "EVENT") {
      const row = this.#database
        .prepare<[string], EventTargetRow>(SELECT_EVENT_TARGET)
        .get(targetId);
      return row === undefined ? null : mapEvent(row);
    }

    if (targetType === "EVENT_UPDATE") {
      const row = this.#database
        .prepare<[string], EventUpdateTargetRow>(SELECT_EVENT_UPDATE_TARGET)
        .get(targetId);
      return row === undefined ? null : mapEventUpdate(row);
    }

    const row = this.#database
      .prepare<[string], KnowledgeTargetRow>(SELECT_KNOWLEDGE_TARGET)
      .get(targetId);
    return row === undefined ? null : mapKnowledge(row);
  }

  hasAnyTopicAssociation(
    targetType: PublicationTargetType,
    targetId: string,
  ): boolean {
    const row = this.#database
      .prepare<[PublicationTargetType, string], { readonly present: 1 }>(
        EXISTS_TOPIC_ASSOCIATION,
      )
      .get(targetType, targetId);

    return row !== undefined;
  }
}
