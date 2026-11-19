import type Database from "better-sqlite3";

import type { EventTargetType } from "./contracts.js";

export interface EventRecord {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

export interface EventUpdateRecord {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

export interface EventContentEvidence {
  readonly target_type: EventTargetType;
  readonly target_id: string;
  readonly content_id: string;
}

export interface EventEvidenceInsertResult {
  readonly evidence: EventContentEvidence;
  readonly inserted: boolean;
}

export interface EventRepository {
  getEventById(eventId: string): EventRecord | null;
  getUpdateById(updateId: string): EventUpdateRecord | null;
  insertEvent(record: EventRecord): EventRecord;
  insertUpdate(record: EventUpdateRecord): EventUpdateRecord;
  getEvidence(
    targetType: EventTargetType,
    targetId: string,
    contentId: string,
  ): EventContentEvidence | null;
  insertEvidence(
    targetType: EventTargetType,
    targetId: string,
    contentId: string,
  ): EventEvidenceInsertResult;
}

const EVENT_COLUMNS = `
  id, title, entity_name, subject, scope, description, occurred_at, discovered_at
`;
const UPDATE_COLUMNS = `
  id, event_id, title, description, occurred_at, discovered_at
`;
const EVIDENCE_COLUMNS = `
  target_type, target_id, content_id
`;
const SELECT_EVENT_BY_ID = `
  SELECT ${EVENT_COLUMNS}
  FROM events
  WHERE id = ?
`;
const SELECT_UPDATE_BY_ID = `
  SELECT ${UPDATE_COLUMNS}
  FROM event_updates
  WHERE id = ?
`;
const SELECT_EVIDENCE = `
  SELECT ${EVIDENCE_COLUMNS}
  FROM event_content_links
  WHERE target_type = ? AND target_id = ? AND content_id = ?
`;
const INSERT_EVENT = `
  INSERT INTO events (
    id, title, entity_name, subject, scope, description, occurred_at,
    discovered_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const INSERT_UPDATE = `
  INSERT INTO event_updates (
    id, event_id, title, description, occurred_at, discovered_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`;
const INSERT_EVIDENCE = `
  INSERT INTO event_content_links (target_type, target_id, content_id)
  VALUES (?, ?, ?)
  ON CONFLICT DO NOTHING
`;

interface EventRow {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface EventUpdateRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface EvidenceRow {
  readonly target_type: EventTargetType;
  readonly target_id: string;
  readonly content_id: string;
}

function sameEvent(record: EventRecord, row: EventRow): boolean {
  return (
    row.id === record.id &&
    row.title === record.title &&
    row.entity_name === record.entity_name &&
    row.subject === record.subject &&
    row.scope === record.scope &&
    row.description === record.description &&
    row.occurred_at === record.occurred_at &&
    row.discovered_at === record.discovered_at
  );
}

function sameUpdate(record: EventUpdateRecord, row: EventUpdateRow): boolean {
  return (
    row.id === record.id &&
    row.event_id === record.event_id &&
    row.title === record.title &&
    row.description === record.description &&
    row.occurred_at === record.occurred_at &&
    row.discovered_at === record.discovered_at
  );
}

function sameEvidence(
  evidence: EventContentEvidence,
  row: EvidenceRow,
): boolean {
  return (
    row.target_type === evidence.target_type &&
    row.target_id === evidence.target_id &&
    row.content_id === evidence.content_id
  );
}

export class SqliteEventRepository implements EventRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  getEventById(eventId: string): EventRecord | null {
    const row = this.#database
      .prepare<[string], EventRow>(SELECT_EVENT_BY_ID)
      .get(eventId);

    return row ?? null;
  }

  getUpdateById(updateId: string): EventUpdateRecord | null {
    const row = this.#database
      .prepare<[string], EventUpdateRow>(SELECT_UPDATE_BY_ID)
      .get(updateId);

    return row ?? null;
  }

  insertEvent(record: EventRecord): EventRecord {
    this.#assertInTransaction();
    const result = this.#database
      .prepare(INSERT_EVENT)
      .run(
        record.id,
        record.title,
        record.entity_name,
        record.subject,
        record.scope,
        record.description,
        record.occurred_at,
        record.discovered_at,
      );

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly one Event insert, received ${result.changes}`,
      );
    }

    const inserted = this.getEventById(record.id);
    if (inserted === null || !sameEvent(record, inserted)) {
      throw new Error("Inserted Event could not be verified");
    }

    return inserted;
  }

  insertUpdate(record: EventUpdateRecord): EventUpdateRecord {
    this.#assertInTransaction();
    const result = this.#database
      .prepare(INSERT_UPDATE)
      .run(
        record.id,
        record.event_id,
        record.title,
        record.description,
        record.occurred_at,
        record.discovered_at,
      );

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly one Event Update insert, received ${result.changes}`,
      );
    }

    const inserted = this.getUpdateById(record.id);
    if (inserted === null || !sameUpdate(record, inserted)) {
      throw new Error("Inserted Event Update could not be verified");
    }

    return inserted;
  }

  getEvidence(
    targetType: EventTargetType,
    targetId: string,
    contentId: string,
  ): EventContentEvidence | null {
    const row = this.#database
      .prepare<[EventTargetType, string, string], EvidenceRow>(SELECT_EVIDENCE)
      .get(targetType, targetId, contentId);

    return row ?? null;
  }

  insertEvidence(
    targetType: EventTargetType,
    targetId: string,
    contentId: string,
  ): EventEvidenceInsertResult {
    this.#assertInTransaction();
    const result = this.#database
      .prepare(INSERT_EVIDENCE)
      .run(targetType, targetId, contentId);

    if (result.changes !== 0 && result.changes !== 1) {
      throw new Error(
        `Expected at most one evidence insert, received ${result.changes}`,
      );
    }

    const evidence = this.getEvidence(targetType, targetId, contentId);
    if (
      evidence === null ||
      !sameEvidence(evidence, {
        target_type: targetType,
        target_id: targetId,
        content_id: contentId,
      })
    ) {
      throw new Error("Event evidence could not be verified");
    }

    return { evidence, inserted: result.changes === 1 };
  }

  #assertInTransaction(): void {
    if (!this.#database.inTransaction) {
      throw new Error("EventRepository writes require an active transaction");
    }
  }
}
