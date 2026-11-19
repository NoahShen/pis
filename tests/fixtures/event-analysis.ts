import type Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { openDatabase } from "../../src/database/open-database.js";
import type {
  EventAnalysisDependencies,
  EventAnalysisLogger,
  EventAnalysisLogMetadata,
} from "../../src/event-analysis/contracts.js";
import type { EventRepository } from "../../src/event-analysis/event-repository.js";
import { SqliteEventRepository } from "../../src/event-analysis/event-repository.js";
import { SqliteEventCandidateRepository } from "../../src/event-search/event-candidate-repository.js";
import {
  createEventSearch,
  type EventSearchDependencies,
  type EventSearchLogger,
  type EventSearchLogMetadata,
  type EventSearchService,
} from "../../src/event-search/index.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type { ContentRepository } from "../../src/processing/content-repository.js";
import type {
  EventContentEvidence,
  EventRecord,
  EventUpdateRecord,
} from "../../src/event-analysis/event-repository.js";
import type { EventTargetType } from "../../src/event-analysis/contracts.js";
import { FixtureCollectionAdapter } from "./collection.js";
import { closeDatabase } from "./database.js";
import {
  createEventSearchDatabaseFixture,
  PRIVACY_SENTINELS,
  TransactionAssertingStubLlm,
  writeSyntheticEventSearchPrompt,
} from "./event-search.js";
import { FakeClock } from "./fake-clock.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { withTempDirectory } from "./temp-directory.js";

export const eventAnalysisFixtureIds = {
  content: "content-d09-t02",
  otherContent: "content-d09-t02-other",
  event: "event-d09-t02-existing",
  otherEvent: "event-d09-t03-other-existing",
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
  otherEvent: {
    id: eventAnalysisFixtureIds.otherEvent,
    title: "Other Existing Event Title",
    entity_name: "Other Existing Entity",
    subject: "Other Existing Subject",
    scope: "Other Existing Scope",
    description: "Other Existing Event Description",
    occurred_at: null,
    discovered_at: "2026-11-12T09:00:00.000+08:00",
  },
} as const satisfies {
  event: EventRecord;
  priorUpdate: EventUpdateRecord;
  otherEvent: EventRecord;
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

export function insertStoredEvidence(
  db: Database.Database,
  evidence: EventContentEvidence,
): void {
  db.prepare(
    `
      INSERT INTO event_content_links (target_type, target_id, content_id)
      VALUES (?, ?, ?)
    `,
  ).run(evidence.target_type, evidence.target_id, evidence.content_id);
}

export function insertStoredUpdateEvidence(
  db: Database.Database,
  updateId: string,
  contentId: string,
): void {
  insertEvidence(db, "EVENT_UPDATE", updateId, contentId);
}

export function insertStoredEventEvidence(
  db: Database.Database,
  eventId: string,
  contentId: string,
): void {
  insertEvidence(db, "EVENT", eventId, contentId);
}

function insertEvidence(
  db: Database.Database,
  targetType: EventTargetType,
  targetId: string,
  contentId: string,
): void {
  insertStoredEvidence(db, {
    target_type: targetType,
    target_id: targetId,
    content_id: contentId,
  });
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

export const SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS =
  "SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS_SENTINEL";

export interface EventAnalysisObservedDatabase {
  readonly database: Database.Database;
  readonly preparedSql: string[];
  readonly transactionStates: boolean[];
  readonly transactionCalls: number;
  readonly ftsTransactionStates: boolean[];
  readonly ftsWriteTransactionStates: boolean[];
}

export function observeEventAnalysisDatabase(
  database: Database.Database,
): EventAnalysisObservedDatabase {
  const preparedSql: string[] = [];
  const transactionStates: boolean[] = [];
  const ftsTransactionStates: boolean[] = [];
  const ftsWriteTransactionStates: boolean[] = [];
  const state = { transactionCalls: 0 };
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string): Database.Statement => {
          preparedSql.push(sql);
          const statement = target.prepare(sql);
          const normalized = sql.replace(/\s+/gu, " ");
          const isFtsStatement =
            normalized.includes(" event_search ") ||
            normalized.includes("FROM event_search");
          const isFtsWrite =
            normalized.includes("INSERT INTO event_search") ||
            normalized.includes("DELETE FROM event_search");
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (
                statementProperty === "all" ||
                statementProperty === "get" ||
                statementProperty === "run"
              ) {
                const implementation = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementReceiver,
                ) as (...parameters: unknown[]) => unknown;
                return (...parameters: unknown[]): unknown => {
                  const inTransaction = target.inTransaction;
                  transactionStates.push(inTransaction);
                  if (isFtsStatement) {
                    ftsTransactionStates.push(inTransaction);
                  }
                  if (isFtsWrite) {
                    ftsWriteTransactionStates.push(inTransaction);
                  }
                  return Reflect.apply(
                    implementation,
                    statementTarget,
                    parameters,
                  );
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
        };
      }

      if (property === "transaction") {
        return (operation: () => unknown) => {
          state.transactionCalls += 1;
          return target.transaction(operation);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    database: wrapped,
    preparedSql,
    transactionStates,
    get transactionCalls() {
      return state.transactionCalls;
    },
    ftsTransactionStates,
    ftsWriteTransactionStates,
  };
}

function observeRepository(
  eventRepository: EventRepository,
  database: Database.Database,
  states: boolean[],
): EventRepository {
  return new Proxy(eventRepository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }

      return (...parameters: unknown[]): unknown => {
        const state = database.inTransaction;
        if (state) {
          states.push(true);
        }
        return Reflect.apply(value, target, parameters);
      };
    },
  });
}

export class CapturedEventAnalysisLogger implements EventAnalysisLogger {
  readonly entries: EventAnalysisLogMetadata[] = [];
  failure: "throw" | "reject" | undefined;

  log(metadata: EventAnalysisLogMetadata): void | PromiseLike<void> {
    this.entries.push(Object.freeze({ ...metadata }));

    if (this.failure === "throw") {
      throw new Error(`logger throw ${PRIVACY_SENTINELS.token}`);
    }
    if (this.failure === "reject") {
      return Promise.reject(
        new Error(`logger reject ${PRIVACY_SENTINELS.token}`),
      );
    }
  }
}

export class CapturedEventAnalysisEventSearchLogger implements EventSearchLogger {
  readonly entries: EventSearchLogMetadata[] = [];

  log(metadata: EventSearchLogMetadata): void {
    this.entries.push(Object.freeze({ ...metadata }));
  }
}

export interface EventAnalysisIntegrationHarness {
  readonly rootDirectory: string;
  readonly databasePath: string;
  readonly rawDatabase: Database.Database;
  readonly observedDatabase: EventAnalysisObservedDatabase;
  readonly promptDirectory: string;
  readonly contentRepository: ContentRepository;
  readonly eventRepository: EventRepository;
  readonly eventSearch: EventSearchService;
  readonly stubLlm: TransactionAssertingStubLlm;
  readonly logger: CapturedEventAnalysisLogger;
  readonly eventSearchLogger: CapturedEventAnalysisEventSearchLogger;
  readonly adapter: FixtureCollectionAdapter;
  readonly dependencies: EventAnalysisDependencies;
  readonly counts: {
    search: number;
    p02: number;
    p03: number;
  };
  readonly repositoryTransactionStates: boolean[];
}

export async function writeSyntheticEventAnalysisPrompts(
  promptsDirectory: string,
): Promise<void> {
  await writeSyntheticEventSearchPrompt(promptsDirectory);
  await mkdir(promptsDirectory, { recursive: true });
  await writeFile(
    path.join(promptsDirectory, "event-analysis.md"),
    `# Synthetic event analysis\n${SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS}\n`,
    "utf8",
  );
}

export async function withEventAnalysisIntegrationHarness<T>(
  responses: readonly string[],
  callback: (harness: EventAnalysisIntegrationHarness) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (rootDirectory) => {
    const databasePath = path.join(rootDirectory, "database.sqlite");
    const promptDirectory = path.join(rootDirectory, "prompts");
    const rawDatabase = openDatabase(databasePath);
    const repositoryTransactionStates: boolean[] = [];

    try {
      const contentRepository = createEventSearchDatabaseFixture(rawDatabase);
      await writeSyntheticEventAnalysisPrompts(promptDirectory);
      const observedDatabase = observeEventAnalysisDatabase(rawDatabase);
      const stubLlm = new TransactionAssertingStubLlm(
        responses,
        observedDatabase.database,
      );
      const typedLlmCalls = createTypedLlmCalls({
        prompts: new PromptRepository(promptDirectory),
        completionClient: stubLlm,
      });
      const counts = { search: 0, p02: 0, p03: 0 };
      const eventSearchLogger = new CapturedEventAnalysisEventSearchLogger();
      const eventSearchDependencies: EventSearchDependencies = {
        database: observedDatabase.database,
        contentRepository,
        candidateRepository: new SqliteEventCandidateRepository(
          observedDatabase.database,
        ),
        typedLlmCalls: {
          async searchEvents(taskData, options) {
            counts.p02 += 1;
            if (observedDatabase.database.inTransaction) {
              throw new Error("P-02 ran inside a transaction");
            }
            return typedLlmCalls.searchEvents(taskData, options);
          },
        },
        logger: eventSearchLogger,
      };
      const eventSearchPipeline = createEventSearch(eventSearchDependencies);
      const eventSearch: EventSearchService = {
        async search(contentId, options) {
          counts.search += 1;
          if (observedDatabase.database.inTransaction) {
            throw new Error("D08 search ran inside a transaction");
          }
          return eventSearchPipeline.search(contentId, options);
        },
      };
      const eventRepository = observeRepository(
        new SqliteEventRepository(observedDatabase.database),
        observedDatabase.database,
        repositoryTransactionStates,
      );
      const logger = new CapturedEventAnalysisLogger();
      const dependencies: EventAnalysisDependencies = {
        database: observedDatabase.database,
        contentRepository,
        eventSearch,
        typedLlmCalls: {
          async analyzeEvents(taskData, references, options) {
            counts.p03 += 1;
            if (observedDatabase.database.inTransaction) {
              throw new Error("P-03 ran inside a transaction");
            }
            return typedLlmCalls.analyzeEvents(taskData, references, options);
          },
        },
        eventRepository,
        clock: new FakeClock(new Date("2026-11-19T01:30:00.000Z")),
        idGenerator: new SequenceIdGenerator([
          "event-created-t05-a",
          "event-update-created-t05-a",
          "event-created-t05-b",
          "event-update-created-t05-b",
          "event-created-t05-c",
          "event-update-created-t05-c",
          "event-created-t05-d",
          "event-update-created-t05-d",
        ]),
        logger,
      };

      return await callback({
        rootDirectory,
        databasePath,
        rawDatabase,
        observedDatabase,
        promptDirectory,
        contentRepository,
        eventRepository,
        eventSearch,
        stubLlm,
        logger,
        eventSearchLogger,
        adapter: new FixtureCollectionAdapter(),
        dependencies,
        counts,
        repositoryTransactionStates,
      });
    } finally {
      closeDatabase(rawDatabase);
    }
  });
}
