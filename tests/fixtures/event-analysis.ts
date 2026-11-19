import type Database from "better-sqlite3";

import type {
  EventRecord,
  EventUpdateRecord,
} from "../../src/event-analysis/event-repository.js";

export const eventAnalysisFixtureIds = {
  content: "content-d09-t02",
  otherContent: "content-d09-t02-other",
  event: "event-d09-t02-existing",
  priorUpdate: "event-update-d09-t02-prior",
} as const;

export const eventAnalysisFixtureRows = {
  event: {
    id: eventAnalysisFixtureIds.event,
    title: "Existing Event Title",
    entity_name: "Existing Entity",
    subject: "Existing Subject",
    scope: "Existing Scope",
    description: "Existing Event Description",
    occurred_at: "2026-11-10T08:00:00.000+08:00",
    discovered_at: "2026-11-10T09:00:00.000+08:00",
  },
  priorUpdate: {
    id: eventAnalysisFixtureIds.priorUpdate,
    event_id: eventAnalysisFixtureIds.event,
    title: "Prior Update Title",
    description: "Prior Update Description",
    occurred_at: null,
    discovered_at: "2026-11-11T09:00:00.000+08:00",
  },
} as const satisfies {
  event: EventRecord;
  priorUpdate: EventUpdateRecord;
};

export type EventAnalysisSnapshotTable =
  | "sources"
  | "contents"
  | "events"
  | "event_updates"
  | "knowledge"
  | "topics"
  | "published_items"
  | "source_items"
  | "event_content_links"
  | "event_entity_aliases"
  | "topic_associations"
  | "event_search";

export function insertEventAnalysisContent(
  db: Database.Database,
  id: string,
): void {
  db.prepare(
    `
      INSERT INTO contents (
        id, title, created_at, body, completeness
      ) VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    `Content ${id}`,
    "2026-11-18T09:00:00.000+08:00",
    `Body for ${id}`,
    "FULL",
  );
}

export function insertStoredEvent(
  db: Database.Database,
  record: EventRecord = eventAnalysisFixtureRows.event,
): void {
  db.prepare(
    `
      INSERT INTO events (
        id, title, entity_name, subject, scope, description, occurred_at,
        discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.title,
    record.entity_name,
    record.subject,
    record.scope,
    record.description,
    record.occurred_at,
    record.discovered_at,
  );
}

export function insertStoredEventUpdate(
  db: Database.Database,
  record: EventUpdateRecord = eventAnalysisFixtureRows.priorUpdate,
): void {
  db.prepare(
    `
      INSERT INTO event_updates (
        id, event_id, title, description, occurred_at, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.event_id,
    record.title,
    record.description,
    record.occurred_at,
    record.discovered_at,
  );
}

export function countEventAnalysisRows(
  db: Database.Database,
  table: EventAnalysisSnapshotTable,
): number {
  const row = db
    .prepare<[], { readonly count: number }>(
      `SELECT count(*) AS count FROM ${table}`,
    )
    .get();

  if (row === undefined) {
    throw new Error(`Expected row count for ${table}`);
  }

  return row.count;
}

export function snapshotEventAnalysisRows(
  db: Database.Database,
): Record<EventAnalysisSnapshotTable, readonly string[]> {
  const rowsFor = (table: EventAnalysisSnapshotTable): readonly string[] =>
    db
      .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => JSON.stringify(row));

  return {
    sources: rowsFor("sources"),
    contents: rowsFor("contents"),
    events: rowsFor("events"),
    event_updates: rowsFor("event_updates"),
    knowledge: rowsFor("knowledge"),
    topics: rowsFor("topics"),
    published_items: rowsFor("published_items"),
    source_items: rowsFor("source_items"),
    event_content_links: rowsFor("event_content_links"),
    event_entity_aliases: rowsFor("event_entity_aliases"),
    topic_associations: rowsFor("topic_associations"),
    event_search: rowsFor("event_search"),
  };
}
