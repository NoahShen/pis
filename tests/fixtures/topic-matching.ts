import type Database from "better-sqlite3";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type {
  EventTopicTarget,
  EventUpdateTopicTarget,
} from "../../src/topic-matching/contracts.js";
import type { Topic } from "../../src/configuration/contracts.js";
import type {
  EventRecord,
  EventUpdateRecord,
} from "../../src/event-analysis/event-repository.js";
import type { KnowledgeDraft } from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase, withDatabasePath } from "./database.js";

export const topicMatchingFixtureIds = {
  content: "topic-matching-content",
  event: "topic-matching-event",
  update: "topic-matching-update",
  knowledge: "topic-matching-knowledge",
  topic: "topic-matching-topic",
} as const;

export const topicMatchingEventRow: EventRecord = {
  id: topicMatchingFixtureIds.event,
  title: "Synthetic Event Title",
  entity_name: "Synthetic Event Entity",
  subject: "Synthetic Event Subject",
  scope: "Synthetic Event Scope",
  description: "Synthetic Event Description",
  occurred_at: "2026-11-17T08:00:00.000+08:00",
  discovered_at: "2026-11-17T09:00:00.000+08:00",
};

export const topicMatchingUpdateRow: EventUpdateRecord = {
  id: topicMatchingFixtureIds.update,
  event_id: topicMatchingFixtureIds.event,
  title: "Synthetic Event Update Title",
  description: "Synthetic Event Update Description",
  occurred_at: "2026-11-18T08:00:00.000+08:00",
  discovered_at: "2026-11-18T09:00:00.000+08:00",
};

export const topicMatchingKnowledgeRow: KnowledgeDraft = {
  id: topicMatchingFixtureIds.knowledge,
  content_id: topicMatchingFixtureIds.content,
  title: "Synthetic Knowledge Title",
  summary: "Synthetic Knowledge Summary",
  category: "Insight",
  findings: [
    { title: "Synthetic Finding One", description: "Finding one description" },
    { title: "Synthetic Finding Two", description: "Finding two description" },
  ],
  value: "Synthetic Knowledge Value",
};

export const topicMatchingTopicRow = {
  id: topicMatchingFixtureIds.topic,
  name: "Synthetic Topic Name",
  description: "Synthetic Topic Description",
  enabled: 1,
} as const;

export const topicMatchingTopicIds = {
  alpha: "topic-matching-topic-alpha",
  zulu: "topic-matching-topic-zulu",
  disabled: "topic-matching-topic-disabled",
} as const;

export function createTopicMatchingEnabledTopics(): Topic[] {
  return [
    {
      id: topicMatchingTopicIds.alpha,
      name: "Synthetic Alpha Topic",
      description: "Synthetic Alpha Topic Description",
      enabled: true,
    },
    {
      id: topicMatchingTopicIds.zulu,
      name: "Synthetic Zulu Topic",
      description: "Synthetic Zulu Topic Description",
      enabled: true,
    },
  ];
}

export function createTopicMatchingDisabledTopic(): Topic {
  return {
    id: topicMatchingTopicIds.disabled,
    name: "Synthetic Disabled Topic",
    description: "Synthetic Disabled Topic Description",
    enabled: false,
  };
}

export function createTopicMatchingEventTarget(): EventTopicTarget {
  return {
    target_type: "EVENT",
    id: topicMatchingEventRow.id,
    title: topicMatchingEventRow.title,
    entity_name: topicMatchingEventRow.entity_name,
    subject: topicMatchingEventRow.subject,
    scope: topicMatchingEventRow.scope,
    description: topicMatchingEventRow.description,
    occurred_at: topicMatchingEventRow.occurred_at,
  };
}

export function createTopicMatchingUpdateTarget(): EventUpdateTopicTarget {
  return {
    target_type: "EVENT_UPDATE",
    id: topicMatchingUpdateRow.id,
    event_id: topicMatchingUpdateRow.event_id,
    title: topicMatchingUpdateRow.title,
    description: topicMatchingUpdateRow.description,
    occurred_at: topicMatchingUpdateRow.occurred_at,
    event: {
      id: topicMatchingEventRow.id,
      title: topicMatchingEventRow.title,
      entity_name: topicMatchingEventRow.entity_name,
      subject: topicMatchingEventRow.subject,
      scope: topicMatchingEventRow.scope,
      description: topicMatchingEventRow.description,
    },
  };
}

export function insertTopicMatchingContent(
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
    "2026-11-16T09:00:00.000+08:00",
    `Body for ${id}`,
    "FULL",
  );
}

export function insertStoredEvent(
  db: Database.Database,
  record: EventRecord = topicMatchingEventRow,
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
  record: EventUpdateRecord = topicMatchingUpdateRow,
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

export function insertStoredKnowledge(
  db: Database.Database,
  draft: KnowledgeDraft = topicMatchingKnowledgeRow,
): void {
  db.prepare(
    `
      INSERT INTO knowledge (
        id, content_id, title, summary, category, findings_json, value
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    draft.id,
    draft.content_id,
    draft.title,
    draft.summary,
    draft.category,
    JSON.stringify(draft.findings),
    draft.value,
  );
}

export function insertStoredTopic(
  db: Database.Database,
  record: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly enabled: number;
  } = topicMatchingTopicRow,
): void {
  db.prepare(
    `
      INSERT INTO topics (id, name, description, enabled)
      VALUES (?, ?, ?, ?)
    `,
  ).run(record.id, record.name, record.description, record.enabled);
}

export interface RawTopicMatchingKnowledgeRow {
  readonly id: string;
  readonly content_id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string | null;
  readonly findings_json: string;
  readonly value: string;
}

export function readTopicMatchingKnowledgeRow(
  db: Database.Database,
  id: string,
): RawTopicMatchingKnowledgeRow | undefined {
  return db
    .prepare(
      `
        SELECT id, content_id, title, summary, category, findings_json, value
        FROM knowledge
        WHERE id = ?
      `,
    )
    .get(id) as RawTopicMatchingKnowledgeRow | undefined;
}

export const TOPIC_MATCHING_BUSINESS_TABLES = [
  "sources",
  "contents",
  "events",
  "event_updates",
  "knowledge",
  "topics",
  "published_items",
  "source_items",
  "event_content_links",
  "event_entity_aliases",
  "topic_associations",
  "event_search",
] as const;

export type TopicMatchingSnapshotTable =
  (typeof TOPIC_MATCHING_BUSINESS_TABLES)[number];

export function snapshotTopicMatchingRows(
  db: Database.Database,
): Record<TopicMatchingSnapshotTable, readonly string[]> {
  const rowsFor = (table: TopicMatchingSnapshotTable): readonly string[] =>
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

export async function withTopicMatchingDatabase<T>(
  callback: (db: Database.Database) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath((databasePath) => {
    const db = openDatabase(databasePath);
    initializeDatabase(db);

    try {
      return callback(db);
    } finally {
      closeDatabase(db);
    }
  });
}
