import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";

import { SqliteTopicRepository } from "../../src/configuration/topic-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type { Topic } from "../../src/configuration/contracts.js";
import type {
  EventTopicTarget,
  EventUpdateTopicTarget,
  TopicMatchingCalls,
  TopicMatchingDependencies,
  TopicTargetType,
} from "../../src/topic-matching/contracts.js";
import { SqlitePublishedItemRepository } from "../../src/topic-matching/published-item-repository.js";
import type { TopicAssociation } from "../../src/topic-matching/topic-association-repository.js";
import { SqliteTopicAssociationRepository } from "../../src/topic-matching/topic-association-repository.js";
import type { TopicMatchingLogger } from "../../src/topic-matching/topic-matching-logger.js";
import { SqliteTopicMatchingTargetRepository } from "../../src/topic-matching/topic-matching-target-repository.js";
import type { Clock } from "../../src/time/clock.js";
import type {
  EventRecord,
  EventUpdateRecord,
} from "../../src/event-analysis/event-repository.js";
import type { KnowledgeDraft } from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase, withDatabasePath } from "./database.js";
import { FakeClock } from "./fake-clock.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";

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

export const topicMatchingPromptSentinels = {
  instructions: "SYNTHETIC_TOPIC_MATCHING_PROMPT_SENTINEL",
  userContext: "SYNTHETIC_TOPIC_MATCHING_USER_CONTEXT_SENTINEL",
  modelOutput: "SYNTHETIC_TOPIC_MATCHING_MODEL_OUTPUT_SENTINEL",
  token: "SYNTHETIC_TOPIC_MATCHING_TOKEN_SENTINEL",
} as const;

export async function writeTopicMatchingPromptFixture(
  directory: string,
  options: { readonly includeUserContext?: boolean } = {},
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "topic-matching.md"),
    `# Synthetic Topic Matching\n${topicMatchingPromptSentinels.instructions}\n`,
    "utf8",
  );

  if (options.includeUserContext === true) {
    await writeFile(
      path.join(directory, "user-context.md"),
      `# Synthetic User Context\n${topicMatchingPromptSentinels.userContext}\n`,
      "utf8",
    );
  }
}

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

export function insertStoredTopics(
  db: Database.Database,
  topics: readonly Topic[],
): void {
  for (const topic of topics) {
    insertStoredTopic(db, {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      enabled: topic.enabled ? 1 : 0,
    });
  }
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

export function insertStoredTopicAssociation(
  db: Database.Database,
  association: TopicAssociation,
): void {
  db.prepare(
    `
      INSERT INTO topic_associations (
        topic_id, target_type, target_id, matched_at
      ) VALUES (?, ?, ?, ?)
    `,
  ).run(
    association.topic_id,
    association.target_type,
    association.target_id,
    association.matched_at,
  );
}

export function listStoredTopicAssociations(
  db: Database.Database,
): TopicAssociation[] {
  return db
    .prepare(
      `
        SELECT topic_id, target_type, target_id, matched_at
        FROM topic_associations
        ORDER BY rowid
      `,
    )
    .all() as TopicAssociation[];
}

export interface StoredPublishedItemRow {
  readonly id: string;
  readonly target_type: TopicTargetType;
  readonly target_id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly published_at: string;
}

export function insertStoredPublishedItem(
  db: Database.Database,
  record: StoredPublishedItemRow,
): void {
  db.prepare(
    `
      INSERT INTO published_items (
        id, target_type, target_id, title, summary, body, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.target_type,
    record.target_id,
    record.title,
    record.summary,
    record.body,
    record.published_at,
  );
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

export interface TopicMatchingSqliteHarness {
  readonly dependencies: TopicMatchingDependencies;
  readonly targetRepository: SqliteTopicMatchingTargetRepository;
  readonly topicRepository: SqliteTopicRepository;
  readonly associationRepository: SqliteTopicAssociationRepository;
  readonly publishedItemRepository: SqlitePublishedItemRepository;
}

export function createTopicMatchingSqliteHarness(options: {
  readonly database: Database.Database;
  readonly typedLlmCalls: TopicMatchingCalls;
  readonly clock: Clock;
  readonly logger: TopicMatchingLogger;
  readonly topicIds?: readonly string[];
}): TopicMatchingSqliteHarness {
  const targetRepository = new SqliteTopicMatchingTargetRepository(
    options.database,
  );
  const topicRepository = new SqliteTopicRepository(
    options.database,
    new SequenceIdGenerator(options.topicIds ?? []),
  );
  const associationRepository = new SqliteTopicAssociationRepository(
    options.database,
  );
  const publishedItemRepository = new SqlitePublishedItemRepository(
    options.database,
  );

  return {
    dependencies: {
      database: options.database,
      targetRepository,
      topicRepository,
      associationRepository,
      publishedItemRepository,
      typedLlmCalls: options.typedLlmCalls,
      clock: options.clock,
      logger: options.logger,
    },
    targetRepository,
    topicRepository,
    associationRepository,
    publishedItemRepository,
  };
}

export class CountingFakeClock extends FakeClock {
  calls = 0;

  override now(): Date {
    this.calls += 1;
    return super.now();
  }
}

export interface TopicMatchingDatabaseProbeOptions {
  readonly failInsertAt?: number;
  readonly failReadAt?: number;
  readonly onInsert?: (insertIndex: number) => void;
}

export interface TopicMatchingDatabaseProbe {
  readonly database: Database.Database;
  readonly associationInsertTransactionStates: readonly boolean[];
  readonly associationReadbackTransactionStates: readonly boolean[];
  readonly immediateTransactionCount: number;
}

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

export function probeTopicMatchingDatabase(
  db: Database.Database,
  options: TopicMatchingDatabaseProbeOptions = {},
): TopicMatchingDatabaseProbe {
  const associationInsertTransactionStates: boolean[] = [];
  const associationReadbackTransactionStates: boolean[] = [];
  let insertCount = 0;
  let readCount = 0;
  let transactionCount = 0;

  const observed = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (operation: () => unknown) => {
          const transaction = target.transaction(operation);
          return {
            immediate: () => {
              transactionCount += 1;
              return transaction.immediate();
            },
            deferred: () => transaction.deferred(),
            exclusive: () => transaction.exclusive(),
          };
        };
      }

      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          const sql = normalizeSql(source);

          if (sql.startsWith("INSERT INTO topic_associations")) {
            return new Proxy(statement, {
              get(statementTarget, statementProperty, statementReceiver) {
                if (statementProperty === "run") {
                  return (...parameters: unknown[]) => {
                    insertCount += 1;
                    associationInsertTransactionStates.push(
                      target.inTransaction,
                    );
                    options.onInsert?.(insertCount);
                    if (insertCount === options.failInsertAt) {
                      throw new Error(
                        "Injected Topic Association insert failure",
                      );
                    }

                    return statementTarget.run(...parameters);
                  };
                }

                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementReceiver,
                );
                return typeof value === "function"
                  ? value.bind(statementTarget)
                  : value;
              },
            });
          }

          if (
            sql.startsWith(
              "SELECT topic_id, target_type, target_id, matched_at FROM topic_associations",
            ) &&
            sql.includes("WHERE topic_id = ?")
          ) {
            return new Proxy(statement, {
              get(statementTarget, statementProperty, statementReceiver) {
                if (statementProperty === "get") {
                  return (...parameters: unknown[]) => {
                    readCount += 1;
                    associationReadbackTransactionStates.push(
                      target.inTransaction,
                    );
                    if (readCount === options.failReadAt) {
                      throw new Error(
                        "Injected Topic Association readback failure",
                      );
                    }

                    return statementTarget.get(...parameters);
                  };
                }

                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementReceiver,
                );
                return typeof value === "function"
                  ? value.bind(statementTarget)
                  : value;
              },
            });
          }

          return statement;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    database: observed,
    associationInsertTransactionStates,
    associationReadbackTransactionStates,
    get immediateTransactionCount() {
      return transactionCount;
    },
  };
}

export async function withTopicMatchingDatabase<T>(
  callback: (db: Database.Database) => T | Promise<T>,
  afterClose?: (databasePath: string) => void | Promise<void>,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const db = openDatabase(databasePath);
    initializeDatabase(db);

    try {
      return await callback(db);
    } finally {
      closeDatabase(db);
      await afterClose?.(databasePath);
    }
  });
}
