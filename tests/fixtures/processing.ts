import type Database from "better-sqlite3";
import { vi, type MockInstance } from "vitest";

import type {
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import {
  createRawDataSourceItemV1,
  serializeRawDataSourceItemV1,
  type RawDataSourceItemV1,
} from "../../src/collection/raw-data.js";
import {
  SqliteSourceItemRepository,
  type SourceItemRecord,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type { TextCompletionRequest } from "../../src/llm/chat-completions-client.js";
import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type { ProcessResult } from "../../src/processing/contracts.js";
import {
  SqliteContentRepository,
  type ContentRecord,
} from "../../src/processing/content-repository.js";
import type {
  ProcessingLogMetadata,
  ProcessingLogger,
} from "../../src/processing/processing-logger.js";
import { createProcessing } from "../../src/processing/processing.js";
import { SqliteProcessingSourceItemRepository } from "../../src/processing/source-item-repository.js";
import { closeDatabase, withDatabasePath } from "./database.js";
import { FakeClock } from "./fake-clock.js";
import { FixtureCollectionAdapter } from "./collection.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { StubLLM } from "./stub-llm.js";

export const PROCESSING_SOURCE_ID = "processing-fixture-source";
export const PROCESSING_FIXTURE_TIME = "2026-11-18T10:30:00.000+08:00";
export const PROCESSING_RAW_SENTINEL = "PROCESSING_RAW_DATA_SENTINEL";
export const PROCESSING_BODY_SENTINEL = "PROCESSING_BODY_SENTINEL";
export const PROCESSING_TOKEN_SENTINEL = "PROCESSING_TOKEN_SENTINEL";
export const PROCESSING_PROMPT_SENTINEL = "Route fixture content.";

export const PROCESSING_SYNTHETIC_CONFIG = Object.freeze({
  endpoint: "https://llm.processing.example.test/v1/chat/completions",
  apiKey: PROCESSING_TOKEN_SENTINEL,
  model: "synthetic-processing-model",
});

export function createProcessingEntry(
  overrides: Partial<SourceEntry> = {},
): SourceEntry {
  return {
    source_id: PROCESSING_SOURCE_ID,
    external_id: PROCESSING_RAW_SENTINEL,
    url: "https://article.processing.example.test/full-story",
    title: "Synthetic processing title",
    author: "Synthetic Processing Author",
    published_at: "2026-11-18T09:00:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

export function createProcessingSourceContent(
  entryOverrides: Partial<SourceEntry> = {},
  overrides: Partial<SourceContent> = {},
): SourceContent {
  const entry = createProcessingEntry(entryOverrides);

  return {
    schema_version: 1,
    entry,
    body: PROCESSING_BODY_SENTINEL,
    summary: null,
    content_kind: "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
    ...overrides,
  };
}

export function createProcessingRawData(
  entryOverrides: Partial<SourceEntry> = {},
  contentOverrides: Partial<SourceContent> = {},
): RawDataSourceItemV1 {
  return createRawDataSourceItemV1(
    createProcessingSourceContent(entryOverrides, contentOverrides),
  );
}

export function serializeProcessingRawData(content: SourceContent): string {
  return serializeRawDataSourceItemV1(createRawDataSourceItemV1(content));
}

export function insertProcessingSource(db: Database.Database): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
  ).run(
    PROCESSING_SOURCE_ID,
    "Synthetic Processing Source",
    "RSS",
    "https://feed.processing.example.test/feed.xml",
    "0 * * * *",
    1,
    "Synthetic processing integration fixture",
  );
}

export interface ProcessingSourceItemOptions {
  readonly id: string;
  readonly content?: SourceContent;
  readonly rawData?: string | null;
  readonly externalId?: string | null;
  readonly url?: string | null;
  readonly title?: string | null;
  readonly publishedAt?: string | null;
  readonly discoveredAt?: string;
}

export function insertProcessingSourceItem(
  db: Database.Database,
  options: ProcessingSourceItemOptions,
): SourceItemRecord {
  const content = options.content ?? createProcessingSourceContent();
  const rawData =
    options.rawData === undefined
      ? serializeProcessingRawData(content)
      : options.rawData;
  const repository = new SqliteSourceItemRepository(
    db,
    new SequenceIdGenerator([options.id]),
  );
  const sourceItem = repository.insert({
    source_id: PROCESSING_SOURCE_ID,
    external_id:
      options.externalId === undefined
        ? content.entry.external_id
        : options.externalId,
    url: options.url === undefined ? content.entry.url : options.url,
    title: options.title === undefined ? content.entry.title : options.title,
    published_at:
      options.publishedAt === undefined
        ? content.entry.published_at
        : options.publishedAt,
    discovered_at: options.discoveredAt ?? PROCESSING_FIXTURE_TIME,
    content_id: null,
    raw_data: rawData ?? "{}",
  });

  if (rawData === null) {
    db.prepare("UPDATE source_items SET raw_data = NULL WHERE id = ?").run(
      sourceItem.id,
    );
  }

  return sourceItem;
}

export class CapturedProcessingLogger implements ProcessingLogger {
  readonly entries: ProcessingLogMetadata[] = [];

  log(metadata: ProcessingLogMetadata): void {
    this.entries.push(metadata);
  }
}

export type ProcessingCompleteHook = (
  request: TextCompletionRequest,
  callIndex: number,
  stub: StubLLM,
) => void | Promise<void>;

export class ProcessingStubLLM extends StubLLM {
  private callIndex = 0;

  constructor(
    sequence: readonly (string | Error)[],
    private readonly completeHook?: ProcessingCompleteHook,
  ) {
    super(sequence);
  }

  override async complete(request: TextCompletionRequest): Promise<string> {
    const callIndex = this.callIndex;
    this.callIndex += 1;
    await this.completeHook?.(request, callIndex, this);
    return super.complete(request);
  }
}

export function createStubTypedLlmCalls(
  routeProcessing: TypedLlmCalls["routeProcessing"],
): TypedLlmCalls {
  const unexpectedCall = async (): Promise<never> => {
    throw new Error("Unexpected typed LLM operation in Processing tests");
  };

  return {
    routeProcessing,
    searchEvents: unexpectedCall,
    analyzeEvents: unexpectedCall,
    analyzeKnowledge: unexpectedCall,
    matchTopics: unexpectedCall,
  };
}

class ProcessingIdGenerator {
  private index = 0;

  constructor(private readonly prefix: string) {}

  next(): string {
    this.index += 1;
    return `${this.prefix}-${this.index}`;
  }
}

export interface ProcessingHarness {
  readonly service: ReturnType<typeof createProcessing>;
  readonly stub: ProcessingStubLLM;
  readonly calls: TypedLlmCalls;
  readonly logger: CapturedProcessingLogger;
  readonly clock: FakeClock;
  readonly contentRepository: SqliteContentRepository;
  readonly sourceItemRepository: SqliteProcessingSourceItemRepository;
}

export interface ProcessingHarnessOptions {
  readonly database: Database.Database;
  readonly promptDirectory: string;
  readonly responses: readonly (string | Error)[];
  readonly contentIdPrefix?: string;
  readonly completeHook?: ProcessingCompleteHook;
  readonly initialTime?: Date;
}

export function createProcessingHarness(
  options: ProcessingHarnessOptions,
): ProcessingHarness {
  const prompts = new PromptRepository(options.promptDirectory);
  const stub = new ProcessingStubLLM(options.responses, options.completeHook);
  const calls = createTypedLlmCalls({
    prompts,
    completionClient: stub,
  });
  const logger = new CapturedProcessingLogger();
  const clock = new FakeClock(
    options.initialTime ?? new Date(PROCESSING_FIXTURE_TIME),
  );
  const contentRepository = new SqliteContentRepository(
    options.database,
    new ProcessingIdGenerator(options.contentIdPrefix ?? "processing-content"),
  );
  const sourceItemRepository = new SqliteProcessingSourceItemRepository(
    options.database,
  );
  const service = createProcessing({
    database: options.database,
    sourceItemRepository,
    contentRepository,
    typedLlmCalls: calls,
    clock,
    logger,
  });

  return {
    service,
    stub,
    calls,
    logger,
    clock,
    contentRepository,
    sourceItemRepository,
  };
}

export function countProcessingContents(db: Database.Database): number {
  const row = db.prepare("SELECT count(*) AS count FROM contents").get() as {
    count: number;
  };
  return row.count;
}

export function countProcessingSourceItems(db: Database.Database): number {
  const row = db
    .prepare("SELECT count(*) AS count FROM source_items")
    .get() as { count: number };
  return row.count;
}

export function readProcessingSourceItem(
  db: Database.Database,
  id: string,
): SourceItemRecord | null {
  const row = db
    .prepare(
      `
        SELECT id, source_id, external_id, url, title, published_at,
               discovered_at, content_id, raw_data
        FROM source_items
        WHERE id = ?
      `,
    )
    .get(id) as SourceItemRecord | undefined;

  return row ?? null;
}

export function readProcessingContent(
  db: Database.Database,
  id: string,
): ContentRecord | null {
  const row = db
    .prepare(
      `
        SELECT id, title, url, author, published_at, created_at, body, summary,
               language, completeness
        FROM contents
        WHERE id = ?
      `,
    )
    .get(id) as ContentRecord | undefined;

  return row ?? null;
}

export interface ProcessingHttpSpies {
  readonly fetchContent: MockInstance<FixtureCollectionAdapter["fetchContent"]>;
  readonly fetch: MockInstance<typeof globalThis.fetch>;
  restore(): void;
}

export function installProcessingHttpSpies(): ProcessingHttpSpies {
  const adapter = new FixtureCollectionAdapter();
  const fetchContent = vi.spyOn(adapter, "fetchContent");
  const fetch = vi.spyOn(globalThis, "fetch");

  return {
    fetchContent,
    fetch,
    restore(): void {
      fetch.mockRestore();
      fetchContent.mockRestore();
    },
  };
}

export async function withProcessingDatabase<T>(
  callback: (db: Database.Database) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const db = openDatabase(databasePath);

    try {
      initializeDatabase(db);
      return await callback(db);
    } finally {
      closeDatabase(db);
    }
  });
}

export function expectEmptyProcessingResult(result: ProcessResult): void {
  if (result.content_id !== null || result.routes.length !== 0) {
    throw new Error("Expected an empty Processing result");
  }
}
