import type Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type {
  ContentDraft,
  ContentRecord,
} from "../../src/processing/content-repository.js";
import { SqliteContentRepository } from "../../src/processing/content-repository.js";
import { rebuildEventSearch } from "../../src/database/event-search.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import {
  SqliteEventCandidateRepository,
  type EventCandidateClue,
  type EventCandidateRepository,
  type EventCandidateSearchResult,
} from "../../src/event-search/event-candidate-repository.js";
import type {
  EventSearchDependencies,
  EventSearchLogger,
  EventSearchLogMetadata,
} from "../../src/event-search/index.js";
import { FixtureCollectionAdapter } from "./collection.js";
import { closeDatabase } from "./database.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { StubLLM, type StubLlmResult } from "./stub-llm.js";
import { withTempDirectory } from "./temp-directory.js";

export { SequenceIdGenerator } from "./sequence-id-generator.js";

export const EVENT_SEARCH_CURRENT_CONTENT_ID = "content-current-event-search";
export const SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS =
  "SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS_SENTINEL";

export const PRIVACY_SENTINELS = {
  contentId: EVENT_SEARCH_CURRENT_CONTENT_ID,
  raw: "PRIVATE_RAW_DATA_SENTINEL",
  topic: "PRIVATE_TOPIC_SENTINEL",
  history: "PRIVATE_HISTORY_SENTINEL",
  token: "PRIVATE_TOKEN_SENTINEL",
  prompt: "PRIVATE_REAL_PROMPT_SENTINEL",
  model: "PRIVATE_MODEL_OUTPUT_SENTINEL",
  sql: "PRIVATE_SQL_SENTINEL",
  body: "SYNTHETIC_CONTENT_BODY_SENTINEL",
  background: "SYNTHETIC_CONTENT_BACKGROUND_SENTINEL",
} as const;

export const EVENT_SEARCH_FIXTURE_IDS = {
  sharedA: "event-shared-a",
  sharedB: "event-shared-b",
  oldStandard: "event-old-standard",
  oldAlias: "event-old-alias",
  oldFts: "event-old-fts",
  window: "event-window",
  sameAliasA: "event-same-alias-a",
  sameAliasB: "event-same-alias-b",
  dedupe: "event-dedupe",
  rankDirectTwo: "rank-direct-two",
  rankDirectOneNew: "rank-direct-one-new",
  rankDirectOneOld: "rank-direct-one-old",
  rankAliasOne: "rank-alias-one",
  rankFtsClueTwo: "rank-fts-clue-two",
  rankFtsTermsTwo: "rank-fts-terms-two",
  rankFtsTieA: "rank-fts-tie-a",
  rankFtsTieZ: "rank-fts-tie-z",
  literal: "event-fts-literal",
  orphan: "event-orphan-index",
} as const;

export interface SyntheticContentRecord extends ContentRecord {
  readonly raw_data: string;
  readonly html_fragment: string;
  readonly topics: readonly string[];
  readonly historical_events: readonly string[];
  readonly private_token: string;
  readonly background: string;
}

export function createSyntheticContent(): SyntheticContentRecord {
  return {
    id: EVENT_SEARCH_CURRENT_CONTENT_ID,
    title: "Synthetic Content Title",
    url: "https://synthetic-content.example.test/article",
    author: "Synthetic Author",
    published_at: "2026-11-18T09:30:00.000+08:00",
    created_at: "2026-11-18T10:00:00.000+08:00",
    body: `Synthetic Content Body ${PRIVACY_SENTINELS.body}`,
    summary: "Synthetic Content Summary",
    language: null,
    completeness: "PARTIAL",
    raw_data: PRIVACY_SENTINELS.raw,
    html_fragment: "<article>private synthetic html</article>",
    topics: [PRIVACY_SENTINELS.topic],
    historical_events: [PRIVACY_SENTINELS.history],
    private_token: PRIVACY_SENTINELS.token,
    background: PRIVACY_SENTINELS.background,
  };
}

export function createSyntheticContentDraft(): ContentDraft {
  const content = createSyntheticContent();

  return {
    title: content.title,
    url: content.url,
    author: content.author,
    published_at: content.published_at,
    created_at: content.created_at,
    body: content.body,
    summary: content.summary,
    language: content.language,
    completeness: content.completeness,
  };
}

interface EventSeed {
  readonly id: string;
  readonly title: string;
  readonly entityName: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurredAt?: string | null;
  readonly discoveredAt: string;
}

interface UpdateSeed {
  readonly id: string;
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
  readonly occurredAt?: string | null;
  readonly discoveredAt: string;
}

interface AliasSeed {
  readonly eventId: string;
  readonly alias: string;
  readonly contentId: string;
}

const ALIAS_CONTENT_IDS = {
  oldAlias: "content-alias-old",
  sameAliasA: "content-alias-same-a",
  sameAliasB: "content-alias-same-b",
  dedupe: "content-alias-dedupe",
  rank: "content-alias-rank",
} as const;

const EVENTS: readonly EventSeed[] = [
  {
    id: EVENT_SEARCH_FIXTURE_IDS.sharedA,
    title: "Shared Entity Alpha",
    entityName: "Shared Entity",
    subject: "Shared Subject Alpha",
    scope: "Shared scope alpha",
    description: "Shared direct description alpha",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.sharedB,
    title: "Shared Entity Beta",
    entityName: "Shared Entity",
    subject: "Shared Subject Beta",
    scope: "Shared scope beta",
    description: "Shared direct description beta",
    discoveredAt: "2026-11-17T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.oldStandard,
    title: "Old Standard Route Event",
    entityName: "Old Standard Entity",
    subject: "Old Standard Subject",
    scope: "Old standard scope",
    description: "Old standard description",
    discoveredAt: "2016-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.oldAlias,
    title: "Old Alias Route Event",
    entityName: "Old Alias Entity",
    subject: "Old Alias Subject",
    scope: "Old alias scope",
    description: "Old alias description",
    discoveredAt: "2016-02-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.oldFts,
    title: "Old FTS Route Event",
    entityName: "Old FTS Entity",
    subject: "Old FTS Subject",
    scope: "Old FTS scope",
    description: "Old only indexed description",
    discoveredAt: "2016-03-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.window,
    title: "Window Event",
    entityName: "Window Entity",
    subject: "Window Subject",
    scope: "Window scope",
    description: "Window direct description",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
    title: "Same Alias Alpha",
    entityName: "Same Alias Entity A",
    subject: "Same alias subject A",
    scope: "Same alias scope A",
    description: "Same alias description A",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
    title: "Same Alias Beta",
    entityName: "Same Alias Entity B",
    subject: "Same alias subject B",
    scope: "Same alias scope B",
    description: "Same alias description B",
    discoveredAt: "2026-11-18T09:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.dedupe,
    title: "Dedupe Event",
    entityName: "Dedupe Entity",
    subject: "Dedupe Subject",
    scope: "Dedupe scope",
    description: "Dedupe Search Term",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankDirectTwo,
    title: "Rank Direct Two",
    entityName: "Rank Direct",
    subject: "Rank Subject",
    scope: "Rank scope direct two",
    description: "rank clue alpha rank clue beta",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankDirectOneNew,
    title: "Rank Direct One New",
    entityName: "Rank Direct",
    subject: "Rank Separate Subject",
    scope: "Rank scope direct one new",
    description: "rank direct one new",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankDirectOneOld,
    title: "Rank Direct One Old",
    entityName: "Rank Direct",
    subject: "Rank Another Subject",
    scope: "Rank scope direct one old",
    description: "rank direct one old",
    discoveredAt: "2025-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankAliasOne,
    title: "Rank Alias One",
    entityName: "Rank Unrelated Entity",
    subject: "Rank Alias Subject",
    scope: "Rank scope alias",
    description: "rank alias one",
    discoveredAt: "2025-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankFtsClueTwo,
    title: "Rank FTS Clue Two",
    entityName: "Rank FTS Entity Clue",
    subject: "Rank FTS Subject Clue",
    scope: "Rank scope clue two",
    description: "rank clue alpha rank clue gamma",
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankFtsTermsTwo,
    title: "Rank FTS Terms Two",
    entityName: "Rank FTS Entity Terms",
    subject: "Rank FTS Subject Terms",
    scope: "Rank scope terms two",
    description: "rank clue alpha rank clue beta",
    discoveredAt: "2025-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankFtsTieA,
    title: "Rank FTS Tie A",
    entityName: "Rank FTS Tie Entity A",
    subject: "Rank FTS Tie Subject A",
    scope: "Rank scope tie a",
    description: "rank clue delta",
    discoveredAt: "2024-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.rankFtsTieZ,
    title: "Rank FTS Tie Z",
    entityName: "Rank FTS Tie Entity Z",
    subject: "Rank FTS Tie Subject Z",
    scope: "Rank scope tie z",
    description: "rank clue delta",
    discoveredAt: "2024-01-10T08:00:00.000+08:00",
  },
  {
    id: EVENT_SEARCH_FIXTURE_IDS.literal,
    title: "FTS Literal Event",
    entityName: "Literal Entity",
    subject: "Literal Subject",
    scope: "Literal scope",
    description: `quote " literal, bracket(value), colon:value, star*, NEAR, ' OR 1=1 --, ${PRIVACY_SENTINELS.sql}`,
    discoveredAt: "2026-11-18T08:00:00.000+08:00",
  },
];

const ALIASES: readonly AliasSeed[] = [
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.oldAlias,
    alias: "Old Confirmed Alias",
    contentId: ALIAS_CONTENT_IDS.oldAlias,
  },
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
    alias: "Shared Alias Text",
    contentId: ALIAS_CONTENT_IDS.sameAliasA,
  },
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
    alias: "Shared Alias Text",
    contentId: ALIAS_CONTENT_IDS.sameAliasB,
  },
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.dedupe,
    alias: "Dedupe Alias",
    contentId: ALIAS_CONTENT_IDS.dedupe,
  },
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.rankAliasOne,
    alias: "Rank Direct",
    contentId: ALIAS_CONTENT_IDS.rank,
  },
  {
    eventId: EVENT_SEARCH_FIXTURE_IDS.rankDirectTwo,
    alias: "Rank Alias Entity",
    contentId: ALIAS_CONTENT_IDS.rank,
  },
];

function insertAliasSourceContent(
  database: Database.Database,
  id: string,
): void {
  database
    .prepare(
      `
        INSERT INTO contents (id, title, created_at, body, completeness)
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      `Synthetic alias source ${id}`,
      "2026-11-18T08:00:00.000+08:00",
      `Synthetic alias source body ${id}`,
      "FULL",
    );
}

function insertEvent(database: Database.Database, event: EventSeed): void {
  database
    .prepare(
      `
        INSERT INTO events (
          id, title, entity_name, subject, scope, description, occurred_at,
          discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      event.id,
      event.title,
      event.entityName,
      event.subject,
      event.scope,
      event.description,
      event.occurredAt ?? null,
      event.discoveredAt,
    );
}

function insertAlias(database: Database.Database, alias: AliasSeed): void {
  database
    .prepare(
      `
        INSERT INTO event_entity_aliases (event_id, alias, content_id)
        VALUES (?, ?, ?)
      `,
    )
    .run(alias.eventId, alias.alias, alias.contentId);
}

function insertUpdate(database: Database.Database, update: UpdateSeed): void {
  database
    .prepare(
      `
        INSERT INTO event_updates (
          id, event_id, title, description, occurred_at, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      update.id,
      update.eventId,
      update.title,
      update.description,
      update.occurredAt ?? null,
      update.discoveredAt,
    );
}

function updateDiscoveredAt(index: number): string {
  if (index >= 11) {
    return "2026-11-18T12:00:00.000+08:00";
  }

  return `2026-01-${String(index).padStart(2, "0")}T08:00:00.000+08:00`;
}

function seedWindowUpdates(database: Database.Database): void {
  for (let index = 12; index >= 1; index -= 1) {
    insertUpdate(database, {
      id: `window-update-${String(index).padStart(2, "0")}`,
      eventId: EVENT_SEARCH_FIXTURE_IDS.window,
      title: `Window Update ${index}`,
      description:
        index === 1
          ? "history deep clue"
          : `Window update description ${index}`,
      discoveredAt: updateDiscoveredAt(index),
    });
  }
}

function seedCandidateLimitEvents(database: Database.Database): void {
  for (let index = 0; index < 55; index += 1) {
    insertEvent(database, {
      id: `limit-event-${String(index).padStart(2, "0")}`,
      title: `Limit Event ${index}`,
      entityName: "Limit Entity",
      subject: "Limit Subject",
      scope: "Limit scope",
      description: "limit recall clue",
      discoveredAt: "2025-06-01T00:00:00.000Z",
    });
  }
}

export function seedEventSearchFixture(database: Database.Database): void {
  for (const contentId of Object.values(ALIAS_CONTENT_IDS)) {
    insertAliasSourceContent(database, contentId);
  }

  for (const event of EVENTS) {
    insertEvent(database, event);
  }
  seedCandidateLimitEvents(database);

  for (const alias of ALIASES) {
    insertAlias(database, alias);
  }

  seedWindowUpdates(database);
  insertUpdate(database, {
    id: "same-alias-update-a",
    eventId: EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
    title: "Same Alias Update A",
    description: "Same alias isolated update A",
    discoveredAt: "2026-11-10T08:00:00.000+08:00",
  });
  insertUpdate(database, {
    id: "same-alias-update-b",
    eventId: EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
    title: "Same Alias Update B",
    description: "Same alias isolated update B",
    discoveredAt: "2026-11-11T08:00:00.000+08:00",
  });

  rebuildEventSearch(database);
}

export function createEventSearchDatabaseFixture(
  database: Database.Database,
): SqliteContentRepository {
  initializeDatabase(database);
  const contentRepository = new SqliteContentRepository(
    database,
    new SequenceIdGenerator([EVENT_SEARCH_CURRENT_CONTENT_ID]),
  );
  contentRepository.insert(createSyntheticContentDraft());
  seedEventSearchFixture(database);
  return contentRepository;
}

export function snapshotEventSearchDatabase(
  database: Database.Database,
): Readonly<Record<string, readonly string[]>> {
  const tables = database
    .prepare<[], { readonly name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'event_search_%'
        ORDER BY name COLLATE BINARY
      `,
    )
    .all();

  return Object.fromEntries(
    tables.map(({ name }) => {
      const quotedName = `"${name.replaceAll('"', '""')}"`;
      const rows = database.prepare(`SELECT * FROM ${quotedName}`).all();
      return [
        name,
        rows
          .map((row) => JSON.stringify(row))
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      ];
    }),
  );
}

export async function writeSyntheticEventSearchPrompt(
  promptsDirectory: string,
): Promise<void> {
  await mkdir(promptsDirectory, { recursive: true });
  await writeFile(
    path.join(promptsDirectory, "event-search.md"),
    `# Synthetic event search\n${SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS}\n`,
    "utf8",
  );
}

export interface StatementCall {
  readonly method: "all" | "get" | "run";
  readonly parameters: readonly unknown[];
  readonly sql: string;
}

export interface ObservedDatabase {
  readonly database: Database.Database;
  readonly calls: StatementCall[];
  readonly preparedSql: string[];
  readonly transactionStates: boolean[];
  readonly transactionCalls: number;
  readonly updateCalls: StatementCall[];
}

export function observeEventSearchDatabase(
  database: Database.Database,
): ObservedDatabase {
  const calls: StatementCall[] = [];
  const preparedSql: string[] = [];
  const transactionStates: boolean[] = [];
  const state = { transactionCalls: 0 };
  const wrapped = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string): Database.Statement => {
          preparedSql.push(sql);
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (
                statementProperty === "all" ||
                statementProperty === "get" ||
                statementProperty === "run"
              ) {
                const method = statementProperty;
                const implementation = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementReceiver,
                ) as (...parameters: unknown[]) => unknown;
                return (...parameters: unknown[]): unknown => {
                  calls.push({ method, parameters, sql });
                  const inTransaction = target.inTransaction;
                  transactionStates.push(inTransaction);
                  if (inTransaction) {
                    throw new Error(
                      "event search SQL ran inside a transaction",
                    );
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
        return (): never => {
          state.transactionCalls += 1;
          throw new Error("event search must not open a transaction");
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    database: wrapped,
    calls,
    preparedSql,
    transactionStates,
    get transactionCalls() {
      return state.transactionCalls;
    },
    get updateCalls() {
      return calls.filter(({ sql }) =>
        sql.replace(/\s+/gu, " ").includes("FROM event_updates"),
      );
    },
  };
}

export class TransactionAssertingStubLlm implements TextCompletionClient {
  readonly transactionStates: boolean[] = [];
  readonly stub: StubLLM;

  constructor(
    responses: readonly StubLlmResult[],
    private readonly database: Database.Database,
  ) {
    this.stub = new StubLLM(responses);
  }

  get requests(): readonly TextCompletionRequest[] {
    return this.stub.requests;
  }

  async complete(request: TextCompletionRequest): Promise<string> {
    const inTransaction = this.database.inTransaction;
    this.transactionStates.push(inTransaction);
    if (inTransaction) {
      throw new Error("searchEvents called inside a transaction");
    }

    return this.stub.complete(request);
  }
}

export class FixtureEventCandidateRepository implements EventCandidateRepository {
  readonly calls: Array<readonly EventCandidateClue[]> = [];
  readonly transactionStates: boolean[] = [];
  lastHitCount = 0;

  constructor(
    private readonly repository: EventCandidateRepository,
    private readonly database: Database.Database,
  ) {}

  search(clues: readonly EventCandidateClue[]): EventCandidateSearchResult {
    this.calls.push(structuredClone(clues));
    this.transactionStates.push(this.database.inTransaction);
    if (this.database.inTransaction) {
      throw new Error("candidate search called inside a transaction");
    }

    const result = this.repository.search(clues);
    this.lastHitCount = result.hits.length;
    return result;
  }
}

export class CapturedEventSearchLogger implements EventSearchLogger {
  readonly entries: EventSearchLogMetadata[] = [];
  failure: "throw" | "reject" | undefined;

  log(metadata: EventSearchLogMetadata): void | PromiseLike<void> {
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

export interface EventSearchHarness {
  readonly rootDirectory: string;
  readonly databasePath: string;
  readonly rawDatabase: Database.Database;
  readonly observedDatabase: ObservedDatabase;
  readonly promptDirectory: string;
  readonly contentRepository: SqliteContentRepository;
  readonly candidateRepository: FixtureEventCandidateRepository;
  readonly stubLlm: TransactionAssertingStubLlm;
  readonly typedLlmCalls: ReturnType<typeof createTypedLlmCalls>;
  readonly logger: CapturedEventSearchLogger;
  readonly adapter: FixtureCollectionAdapter;
  readonly dependencies: EventSearchDependencies;
}

export async function withEventSearchHarness<T>(
  responses: readonly StubLlmResult[],
  callback: (harness: EventSearchHarness) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (rootDirectory) => {
    const databasePath = path.join(rootDirectory, "database.sqlite");
    const promptDirectory = path.join(rootDirectory, "prompts");
    const rawDatabase = openDatabase(databasePath);

    try {
      const contentRepository = createEventSearchDatabaseFixture(rawDatabase);
      await writeSyntheticEventSearchPrompt(promptDirectory);
      const observedDatabase = observeEventSearchDatabase(rawDatabase);
      const stubLlm = new TransactionAssertingStubLlm(
        responses,
        observedDatabase.database,
      );
      const typedLlmCalls = createTypedLlmCalls({
        prompts: new PromptRepository(promptDirectory),
        completionClient: stubLlm,
      });
      const candidateRepository = new FixtureEventCandidateRepository(
        new SqliteEventCandidateRepository(observedDatabase.database),
        observedDatabase.database,
      );
      const logger = new CapturedEventSearchLogger();
      const dependencies: EventSearchDependencies = {
        database: observedDatabase.database,
        contentRepository,
        candidateRepository,
        typedLlmCalls,
        logger,
      };

      return await callback({
        rootDirectory,
        databasePath,
        rawDatabase,
        observedDatabase,
        promptDirectory,
        contentRepository,
        candidateRepository,
        stubLlm,
        typedLlmCalls,
        logger,
        adapter: new FixtureCollectionAdapter(),
        dependencies,
      });
    } finally {
      closeDatabase(rawDatabase);
    }
  });
}
