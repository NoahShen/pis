import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";
import { vi } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type { TextCompletionRequest } from "../../src/llm/chat-completions-client.js";
import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import {
  type ContentRecord,
  SqliteContentRepository,
} from "../../src/processing/content-repository.js";
import {
  createKnowledgeAnalysis,
  type KnowledgeLogger,
  type KnowledgeService,
} from "../../src/knowledge/index.js";
import type { KnowledgeLogEntry } from "../../src/knowledge/knowledge-logger.js";
import {
  type KnowledgeDraft,
  type KnowledgeRecord,
  SqliteKnowledgeRepository,
} from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase } from "./database.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { StubLLM } from "./stub-llm.js";
import { withTempDirectory } from "./temp-directory.js";

export const KNOWLEDGE_CONTENT_ID = "knowledge-content-sentinel";
export const KNOWLEDGE_SECOND_CONTENT_ID = "knowledge-second-content-sentinel";
export const KNOWLEDGE_TITLE = "Synthetic knowledge title";
export const KNOWLEDGE_BODY_SENTINEL = "KNOWLEDGE_BODY_SENTINEL";
export const KNOWLEDGE_SUMMARY = "Synthetic Content summary";
export const KNOWLEDGE_AUTHOR = "Synthetic Knowledge Author";
export const KNOWLEDGE_PUBLISHED_AT = "2026-11-18T09:30:00.000+08:00";
export const KNOWLEDGE_CREATED_AT = "2026-11-18T10:00:00.000+08:00";
export const KNOWLEDGE_RAW_SENTINEL = "KNOWLEDGE_RAW_DATA_SENTINEL";
export const KNOWLEDGE_HTML_SENTINEL = "<p>KNOWLEDGE_HTML_SENTINEL</p>";
export const KNOWLEDGE_TOPIC_SENTINEL = "KNOWLEDGE_TOPIC_SENTINEL";
export const KNOWLEDGE_HISTORY_SENTINEL = "KNOWLEDGE_HISTORY_SENTINEL";
export const KNOWLEDGE_TOKEN_SENTINEL = "KNOWLEDGE_TOKEN_SENTINEL";
export const KNOWLEDGE_PROMPT_SENTINEL =
  "KNOWLEDGE_PROMPT_INSTRUCTION_SENTINEL";
export const KNOWLEDGE_CONTEXT_SENTINEL = "KNOWLEDGE_USER_CONTEXT_SENTINEL";
export const KNOWLEDGE_FINDING_SENTINEL = "KNOWLEDGE_FINDING_SENTINEL";
export const KNOWLEDGE_OUTPUT_SENTINEL = "KNOWLEDGE_MODEL_OUTPUT_SENTINEL";

export const KNOWLEDGE_PRIVACY_SENTINELS = [
  KNOWLEDGE_CONTENT_ID,
  KNOWLEDGE_RAW_SENTINEL,
  KNOWLEDGE_HTML_SENTINEL,
  KNOWLEDGE_TOPIC_SENTINEL,
  KNOWLEDGE_HISTORY_SENTINEL,
  KNOWLEDGE_TOKEN_SENTINEL,
  KNOWLEDGE_PROMPT_SENTINEL,
  KNOWLEDGE_CONTEXT_SENTINEL,
  KNOWLEDGE_FINDING_SENTINEL,
  KNOWLEDGE_OUTPUT_SENTINEL,
] as const;

export const KNOWLEDGE_BUSINESS_TABLES = [
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
] as const;

export interface KnowledgeContentOptions {
  readonly id: string;
  readonly title?: string;
  readonly url?: string | null;
  readonly author?: string | null;
  readonly published_at?: string | null;
  readonly created_at?: string;
  readonly body?: string;
  readonly summary?: string | null;
  readonly completeness?: "FULL" | "PARTIAL";
}

export function insertKnowledgeContent(
  db: Database.Database,
  options: KnowledgeContentOptions,
): ContentRecord {
  const record: ContentRecord = {
    id: options.id,
    title: options.title ?? KNOWLEDGE_TITLE,
    url: options.url ?? "https://knowledge.example.test/article",
    author: options.author ?? KNOWLEDGE_AUTHOR,
    published_at: options.published_at ?? KNOWLEDGE_PUBLISHED_AT,
    created_at: options.created_at ?? KNOWLEDGE_CREATED_AT,
    body: options.body ?? KNOWLEDGE_BODY_SENTINEL,
    summary: options.summary ?? KNOWLEDGE_SUMMARY,
    language: null,
    completeness: options.completeness ?? "FULL",
  };

  db.prepare(
    `
      INSERT INTO contents (
        id, title, url, author, published_at, created_at, body, summary,
        language, completeness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    record.id,
    record.title,
    record.url,
    record.author,
    record.published_at,
    record.created_at,
    record.body,
    record.summary,
    record.language,
    record.completeness,
  );

  return record;
}

export function readKnowledgeContent(
  db: Database.Database,
  id: string,
): ContentRecord | undefined {
  return db
    .prepare(
      `
        SELECT id, title, url, author, published_at, created_at, body, summary,
               language, completeness
        FROM contents
        WHERE id = ?
      `,
    )
    .get(id) as ContentRecord | undefined;
}

export interface RawKnowledgeRow {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: string | null;
  findings_json: string;
  value: string;
}

export function readKnowledgeRow(
  db: Database.Database,
  contentId: string,
): RawKnowledgeRow | undefined {
  return db
    .prepare(
      `
        SELECT id, content_id, title, summary, category, findings_json, value
        FROM knowledge
        WHERE content_id = ?
      `,
    )
    .get(contentId) as RawKnowledgeRow | undefined;
}

export function countKnowledgeRows(db: Database.Database): number {
  const row = db.prepare("SELECT count(*) AS count FROM knowledge").get() as {
    count: number;
  };
  return row.count;
}

export function countBusinessRows(
  db: Database.Database,
): Record<(typeof KNOWLEDGE_BUSINESS_TABLES)[number], number> {
  const counts = {} as Record<
    (typeof KNOWLEDGE_BUSINESS_TABLES)[number],
    number
  >;

  for (const table of KNOWLEDGE_BUSINESS_TABLES) {
    const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    counts[table] = row.count;
  }

  return counts;
}

export function insertStoredKnowledge(
  db: Database.Database,
  draft: KnowledgeDraft,
): KnowledgeRecord {
  return new SqliteKnowledgeRepository(db).insert(draft);
}

export async function writeKnowledgePromptDirectory(
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "knowledge-analysis.md"),
    `${KNOWLEDGE_PROMPT_SENTINEL}\n`,
    "utf8",
  );
  await writeFile(
    path.join(directory, "user-context.md"),
    KNOWLEDGE_CONTEXT_SENTINEL,
    "utf8",
  );
}

export type KnowledgeCompleteHook = (
  request: TextCompletionRequest,
  callIndex: number,
  stub: KnowledgeStubLLM,
) => void | Promise<void>;

export class KnowledgeStubLLM extends StubLLM {
  private callIndex = 0;

  constructor(
    sequence: readonly (string | Error)[],
    private readonly completeHook?: KnowledgeCompleteHook,
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

export type CapturedKnowledgeLogger = KnowledgeLogger & {
  readonly entries: KnowledgeLogEntry[];
};

function createCapturedKnowledgeLogger(): CapturedKnowledgeLogger {
  const entries: KnowledgeLogEntry[] = [];
  const logger = ((entry: KnowledgeLogEntry): void => {
    entries.push(entry);
  }) as CapturedKnowledgeLogger;
  Object.defineProperty(logger, "entries", { value: entries });
  return logger;
}

type AnalyzeKnowledge = TypedLlmCalls["analyzeKnowledge"];
type AnalyzeKnowledgeSpy = ReturnType<typeof vi.fn<AnalyzeKnowledge>>;

export interface KnowledgeTypedCalls extends TypedLlmCalls {
  readonly analyzeKnowledge: AnalyzeKnowledgeSpy;
}

function createKnowledgeTypedCalls(
  prompts: PromptRepository,
  stub: KnowledgeStubLLM,
): KnowledgeTypedCalls {
  const realCalls = createTypedLlmCalls({
    prompts,
    completionClient: stub,
  });
  const unexpectedCall = async (): Promise<never> => {
    throw new Error("Unexpected typed LLM operation in Knowledge tests");
  };

  return {
    routeProcessing: unexpectedCall,
    searchEvents: unexpectedCall,
    analyzeEvents: unexpectedCall,
    analyzeKnowledge: vi.fn<AnalyzeKnowledge>((taskData, options) =>
      realCalls.analyzeKnowledge(taskData, options),
    ),
    matchTopics: unexpectedCall,
  };
}

export interface KnowledgeHarness {
  readonly service: KnowledgeService;
  readonly stub: KnowledgeStubLLM;
  readonly calls: KnowledgeTypedCalls;
  readonly prompts: PromptRepository;
  readonly logger: CapturedKnowledgeLogger;
  readonly contentRepository: SqliteContentRepository;
  readonly knowledgeRepository: SqliteKnowledgeRepository;
  readonly idGenerator: SequenceIdGenerator;
}

export interface KnowledgeHarnessOptions {
  readonly database: Database.Database;
  readonly promptDirectory: string;
  readonly responses: readonly (string | Error)[];
  readonly completeHook?: KnowledgeCompleteHook;
  readonly knowledgeIds?: readonly string[];
}

export function createKnowledgeHarness(
  options: KnowledgeHarnessOptions,
): KnowledgeHarness {
  const stub = new KnowledgeStubLLM(options.responses, options.completeHook);
  const prompts = new PromptRepository(options.promptDirectory);
  const calls = createKnowledgeTypedCalls(prompts, stub);
  const logger = createCapturedKnowledgeLogger();
  const contentRepository = new SqliteContentRepository(
    options.database,
    new SequenceIdGenerator(["unused-content-id"]),
  );
  const knowledgeRepository = new SqliteKnowledgeRepository(options.database);
  const idGenerator = new SequenceIdGenerator(options.knowledgeIds ?? []);
  const service = createKnowledgeAnalysis({
    database: options.database,
    contentRepository,
    knowledgeRepository,
    typedLlmCalls: calls,
    idGenerator,
    logger,
  });

  return {
    service,
    stub,
    calls,
    prompts,
    logger,
    contentRepository,
    knowledgeRepository,
    idGenerator,
  };
}

export async function withKnowledgeDatabase<T>(
  callback: (db: Database.Database, directory: string) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    const db = openDatabase(path.join(directory, "database.sqlite"));

    try {
      initializeDatabase(db);
      return await callback(db, directory);
    } finally {
      closeDatabase(db);
    }
  });
}
