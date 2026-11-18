import { readFile } from "node:fs/promises";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeAnalysisResponse } from "../../src/llm/response-validators.js";
import type { ContentRecord } from "../../src/processing/content-repository.js";
import * as publicKnowledge from "../../src/knowledge/index.js";
import {
  createKnowledgeAnalysis,
  KnowledgeError,
  type KnowledgeDependencies,
  type KnowledgeLogger,
  type KnowledgeResult,
} from "../../src/knowledge/index.js";
import type {
  KnowledgeDraft,
  KnowledgeRecord,
} from "../../src/knowledge/knowledge-repository.js";

const CONTENT_ID = "unit-content-sentinel";
const KNOWLEDGE_ID = "unit-knowledge-sentinel";
const BODY_SENTINEL = "UNIT_BODY_SENTINEL";
const RAW_SENTINEL = "UNIT_RAW_SENTINEL";
const TOPIC_SENTINEL = "UNIT_TOPIC_SENTINEL";
const HISTORY_SENTINEL = "UNIT_HISTORY_SENTINEL";
const TOKEN_SENTINEL = "UNIT_TOKEN_SENTINEL";
const PROMPT_SENTINEL = "UNIT_PROMPT_SENTINEL";

const VALUABLE_RESPONSE: KnowledgeAnalysisResponse = {
  valuable: true,
  title: "Unit Knowledge title",
  summary: "Unit Knowledge summary",
  category: "Method",
  findings: [
    { title: "Unit finding", description: "Unit finding description" },
  ],
  value: "Unit Knowledge value",
};

type AnalyzeKnowledge =
  KnowledgeDependencies["typedLlmCalls"]["analyzeKnowledge"];
type GetContent = KnowledgeDependencies["contentRepository"]["getById"];
type GetKnowledge =
  KnowledgeDependencies["knowledgeRepository"]["getByContentId"];
type InsertKnowledge = KnowledgeDependencies["knowledgeRepository"]["insert"];

interface ServiceHarness {
  readonly dependencies: KnowledgeDependencies;
  readonly getContent: ReturnType<typeof vi.fn<GetContent>>;
  readonly getKnowledge: ReturnType<typeof vi.fn<GetKnowledge>>;
  readonly insertKnowledge: ReturnType<typeof vi.fn<InsertKnowledge>>;
  readonly analyzeKnowledge: ReturnType<typeof vi.fn<AnalyzeKnowledge>>;
  readonly nextId: ReturnType<typeof vi.fn>;
  readonly logger: ReturnType<typeof vi.fn<KnowledgeLogger>>;
}

const openDatabases: Database.Database[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database?.open === true) {
      database.close();
    }
  }
});

function createContent(): ContentRecord & {
  readonly raw_data: string;
  readonly topics: readonly string[];
  readonly history: readonly string[];
  readonly token: string;
  readonly prompt: string;
} {
  return {
    id: CONTENT_ID,
    title: "Unit Content title",
    url: "https://unit.example.test/content",
    author: "Unit Author",
    published_at: "2026-11-18T08:00:00.000+08:00",
    created_at: "2026-11-18T08:05:00.000+08:00",
    body: BODY_SENTINEL,
    summary: "Unit Content summary",
    language: null,
    completeness: "FULL",
    raw_data: RAW_SENTINEL,
    topics: [TOPIC_SENTINEL],
    history: [HISTORY_SENTINEL],
    token: TOKEN_SENTINEL,
    prompt: PROMPT_SENTINEL,
  };
}

function knowledgeRecord(
  overrides: Partial<KnowledgeRecord> = {},
): KnowledgeRecord {
  return {
    id: KNOWLEDGE_ID,
    content_id: CONTENT_ID,
    title: "Stored Knowledge title",
    summary: "Stored Knowledge summary",
    category: "Insight",
    findings: [],
    value: "Stored Knowledge value",
    ...overrides,
  };
}

function createHarness(
  options: {
    readonly content?: ContentRecord | null;
    readonly existingKnowledge?: KnowledgeRecord | null;
    readonly response?: KnowledgeAnalysisResponse;
    readonly logger?: KnowledgeLogger;
  } = {},
): ServiceHarness {
  const database = new Database(":memory:");
  openDatabases.push(database);
  const content =
    options.content === undefined ? createContent() : options.content;
  const existingKnowledge = options.existingKnowledge ?? null;
  const response = options.response ?? VALUABLE_RESPONSE;
  const getContent = vi.fn<GetContent>(() => content);
  let insertedKnowledge: KnowledgeRecord | null = null;
  const getKnowledge = vi.fn<GetKnowledge>(
    () => existingKnowledge ?? insertedKnowledge,
  );
  const insertKnowledge = vi.fn<InsertKnowledge>((draft: KnowledgeDraft) => {
    insertedKnowledge = { ...draft };
    return insertedKnowledge;
  });
  const analyzeKnowledge = vi.fn<AnalyzeKnowledge>(async () => response);
  const nextId = vi.fn(() => KNOWLEDGE_ID);
  const logger = vi.fn<KnowledgeLogger>();

  return {
    dependencies: {
      database,
      contentRepository: { getById: getContent },
      knowledgeRepository: {
        getByContentId: getKnowledge,
        insert: insertKnowledge,
      },
      typedLlmCalls: { analyzeKnowledge },
      idGenerator: { next: nextId },
      logger: options.logger ?? logger,
    },
    getContent,
    getKnowledge,
    insertKnowledge,
    analyzeKnowledge,
    nextId,
    logger,
  };
}

async function captureKnowledgeError(
  operation: Promise<KnowledgeResult>,
): Promise<KnowledgeError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    if (error instanceof KnowledgeError) {
      return error;
    }
  }

  throw new Error("Expected Knowledge analysis to fail");
}

function expectSafeError(
  error: KnowledgeError,
  code: KnowledgeError["code"],
): void {
  expect(error.code).toBe(code);
  expect(error.message).toBe(
    {
      invalid_input: "Invalid knowledge input",
      aborted: "Knowledge analysis was aborted",
      knowledge_failed: "Knowledge operation failed",
      llm_failed: "Knowledge LLM call failed",
    }[code],
  );
  expect(error).not.toHaveProperty("cause");
}

describe("Knowledge service contract", () => {
  it.each(["", "   ", "\n\t"])(
    "KNO-ENTRY rejects invalid Content ID %j before all dependencies",
    async (contentId) => {
      const harness = createHarness();
      const service = createKnowledgeAnalysis(harness.dependencies);

      const error = await captureKnowledgeError(service.analyze(contentId));

      expectSafeError(error, "invalid_input");
      expect(harness.getKnowledge).not.toHaveBeenCalled();
      expect(harness.getContent).not.toHaveBeenCalled();
      expect(harness.analyzeKnowledge).not.toHaveBeenCalled();
      expect(harness.insertKnowledge).not.toHaveBeenCalled();
      expect(harness.logger).toHaveBeenCalledWith({
        stage: "check",
        reason: "invalid_input",
      });
    },
  );

  it("KNO-ENTRY rejects a pre-aborted signal before knowledge and Content reads", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const service = createKnowledgeAnalysis(harness.dependencies);

    const error = await captureKnowledgeError(
      service.analyze(CONTENT_ID, { signal: controller.signal }),
    );

    expectSafeError(error, "aborted");
    expect(harness.getKnowledge).not.toHaveBeenCalled();
    expect(harness.getContent).not.toHaveBeenCalled();
    expect(harness.analyzeKnowledge).not.toHaveBeenCalled();
    expect(harness.insertKnowledge).not.toHaveBeenCalled();
  });

  it("KNO-04 reuses existing Knowledge with zero Content reads and zero LLM calls", async () => {
    const existing = knowledgeRecord();
    const harness = createHarness({ existingKnowledge: existing });
    const service = createKnowledgeAnalysis(harness.dependencies);

    await expect(service.analyze(CONTENT_ID)).resolves.toStrictEqual({
      knowledge_id: existing.id,
    });

    expect(harness.getKnowledge).toHaveBeenCalledTimes(1);
    expect(harness.getKnowledge).toHaveBeenCalledWith(CONTENT_ID);
    expect(harness.getContent).not.toHaveBeenCalled();
    expect(harness.analyzeKnowledge).not.toHaveBeenCalled();
    expect(harness.insertKnowledge).not.toHaveBeenCalled();
    expect(harness.nextId).not.toHaveBeenCalled();
  });

  it("MISSING returns the strict snake_case empty result with zero LLM and zero writes", async () => {
    const harness = createHarness({ content: null });
    const service = createKnowledgeAnalysis(harness.dependencies);

    await expect(service.analyze(CONTENT_ID)).resolves.toStrictEqual({
      knowledge_id: null,
    });

    expect(harness.getKnowledge).toHaveBeenCalledTimes(1);
    expect(harness.getContent).toHaveBeenCalledTimes(1);
    expect(harness.analyzeKnowledge).not.toHaveBeenCalled();
    expect(harness.insertKnowledge).not.toHaveBeenCalled();
    expect(harness.nextId).not.toHaveBeenCalled();
  });

  it("KNO-01 / KNO-06 sends the exact six fields and persists one validated draft", async () => {
    const harness = createHarness();
    const service = createKnowledgeAnalysis(harness.dependencies);

    await expect(service.analyze(CONTENT_ID)).resolves.toStrictEqual({
      knowledge_id: KNOWLEDGE_ID,
    });

    expect(harness.getKnowledge.mock.calls).toEqual([
      [CONTENT_ID],
      [CONTENT_ID],
      [CONTENT_ID],
    ]);
    expect(harness.getContent).toHaveBeenCalledTimes(1);
    expect(harness.getContent).toHaveBeenCalledWith(CONTENT_ID);
    expect(harness.analyzeKnowledge).toHaveBeenCalledTimes(1);

    const taskData = harness.analyzeKnowledge.mock.calls[0]?.[0];
    expect(taskData).toStrictEqual({
      title: "Unit Content title",
      body: BODY_SENTINEL,
      summary: "Unit Content summary",
      author: "Unit Author",
      published_at: "2026-11-18T08:00:00.000+08:00",
      completeness: "FULL",
    });
    expect(Object.keys(taskData ?? {})).toEqual([
      "title",
      "body",
      "summary",
      "author",
      "published_at",
      "completeness",
    ]);
    for (const sentinel of [
      CONTENT_ID,
      RAW_SENTINEL,
      TOPIC_SENTINEL,
      HISTORY_SENTINEL,
      TOKEN_SENTINEL,
      PROMPT_SENTINEL,
    ]) {
      expect(JSON.stringify(taskData)).not.toContain(sentinel);
    }

    expect(harness.insertKnowledge).toHaveBeenCalledTimes(1);
    expect(harness.insertKnowledge).toHaveBeenCalledWith({
      id: KNOWLEDGE_ID,
      content_id: CONTENT_ID,
      title: VALUABLE_RESPONSE.valuable
        ? VALUABLE_RESPONSE.title
        : "unreachable",
      summary: VALUABLE_RESPONSE.valuable
        ? VALUABLE_RESPONSE.summary
        : "unreachable",
      category: "Method",
      findings: VALUABLE_RESPONSE.valuable ? VALUABLE_RESPONSE.findings : [],
      value: VALUABLE_RESPONSE.valuable
        ? VALUABLE_RESPONSE.value
        : "unreachable",
    });
    expect(harness.nextId).toHaveBeenCalledTimes(1);

    const loggerJson = JSON.stringify(harness.logger.mock.calls);
    for (const sentinel of [
      BODY_SENTINEL,
      RAW_SENTINEL,
      TOPIC_SENTINEL,
      HISTORY_SENTINEL,
      TOKEN_SENTINEL,
      PROMPT_SENTINEL,
    ]) {
      expect(loggerJson).not.toContain(sentinel);
    }
  });

  it("KNO-02 returns only the empty ID for valuable=false and performs zero persistence", async () => {
    const harness = createHarness({ response: { valuable: false } });
    const service = createKnowledgeAnalysis(harness.dependencies);

    const result = await service.analyze(CONTENT_ID);

    expect(result).toStrictEqual({ knowledge_id: null });
    expect(Object.keys(result)).toEqual(["knowledge_id"]);
    expect(harness.analyzeKnowledge).toHaveBeenCalledTimes(1);
    expect(harness.insertKnowledge).not.toHaveBeenCalled();
    expect(harness.nextId).not.toHaveBeenCalled();
  });

  it("KNO-11 maps omitted category to SQL-nullable draft null", async () => {
    const response = {
      valuable: true,
      title: "No category title",
      summary: "No category summary",
      findings: [],
      value: "No category value",
    } as const satisfies KnowledgeAnalysisResponse;
    const harness = createHarness({ response });
    const service = createKnowledgeAnalysis(harness.dependencies);

    await service.analyze(CONTENT_ID);

    expect(harness.insertKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, findings: [] }),
    );
  });

  it.each([
    [
      "knowledge lookup",
      (harness: ServiceHarness) => {
        harness.getKnowledge.mockImplementationOnce(() => {
          throw new Error(`SQL ${TOKEN_SENTINEL} ${PROMPT_SENTINEL}`);
        });
      },
      "knowledge_failed",
    ],
    [
      "Content lookup",
      (harness: ServiceHarness) => {
        harness.getContent.mockImplementationOnce(() => {
          throw new Error(`SQL ${TOKEN_SENTINEL} ${PROMPT_SENTINEL}`);
        });
      },
      "knowledge_failed",
    ],
    [
      "persistence",
      (harness: ServiceHarness) => {
        harness.insertKnowledge.mockImplementationOnce(() => {
          throw new Error(`SQL ${TOKEN_SENTINEL} ${PROMPT_SENTINEL}`);
        });
      },
      "knowledge_failed",
    ],
    [
      "typed LLM call",
      (harness: ServiceHarness) => {
        harness.analyzeKnowledge.mockRejectedValueOnce(
          new Error(`MODEL ${TOKEN_SENTINEL} ${PROMPT_SENTINEL}`, {
            cause: { sql: RAW_SENTINEL },
          }),
        );
      },
      "llm_failed",
    ],
  ])(
    "maps %s failure to the stable safe error",
    async (_name, arrange, code) => {
      const harness = createHarness();
      arrange(harness);
      const service = createKnowledgeAnalysis(harness.dependencies);

      const error = await captureKnowledgeError(service.analyze(CONTENT_ID));

      expectSafeError(error, code as KnowledgeError["code"]);
      expect(String(error)).not.toContain(TOKEN_SENTINEL);
      expect(String(error)).not.toContain(PROMPT_SENTINEL);
      expect(String(error)).not.toContain(RAW_SENTINEL);
    },
  );

  it("CANCEL after the typed call resolves aborts before persistence", async () => {
    let resolveAnalysis!: (response: KnowledgeAnalysisResponse) => void;
    const pending = new Promise<KnowledgeAnalysisResponse>((resolve) => {
      resolveAnalysis = resolve;
    });
    const harness = createHarness();
    harness.analyzeKnowledge.mockImplementationOnce(() => pending);
    const controller = new AbortController();
    const service = createKnowledgeAnalysis(harness.dependencies);

    const operation = service.analyze(CONTENT_ID, {
      signal: controller.signal,
    });
    controller.abort();
    resolveAnalysis(VALUABLE_RESPONSE);

    const error = await captureKnowledgeError(operation);
    expectSafeError(error, "aborted");
    expect(harness.insertKnowledge).not.toHaveBeenCalled();
    expect(harness.nextId).not.toHaveBeenCalled();
  });

  it("LOGGER failures never alter a success or a stable business error", async () => {
    const throwingLogger: KnowledgeLogger = () => {
      throw new Error("LOGGER_PRIVATE_SENTINEL");
    };
    const success = createHarness({
      response: { valuable: false },
      logger: throwingLogger,
    });
    await expect(
      createKnowledgeAnalysis(success.dependencies).analyze(CONTENT_ID),
    ).resolves.toStrictEqual({ knowledge_id: null });

    const failure = createHarness({ logger: throwingLogger });
    failure.analyzeKnowledge.mockRejectedValueOnce(
      new Error("UNDERLYING_PRIVATE_SENTINEL"),
    );
    const error = await captureKnowledgeError(
      createKnowledgeAnalysis(failure.dependencies).analyze(CONTENT_ID),
    );
    expectSafeError(error, "llm_failed");
  });

  it("independent factories do not share per-call or identifier state", async () => {
    const first = createHarness();
    const second = createHarness();

    const results = await Promise.all([
      createKnowledgeAnalysis(first.dependencies).analyze(CONTENT_ID),
      createKnowledgeAnalysis(second.dependencies).analyze(CONTENT_ID),
    ]);

    expect(results).toStrictEqual([
      { knowledge_id: KNOWLEDGE_ID },
      { knowledge_id: KNOWLEDGE_ID },
    ]);
    expect(first.analyzeKnowledge).toHaveBeenCalledTimes(1);
    expect(second.analyzeKnowledge).toHaveBeenCalledTimes(1);
    expect(first.insertKnowledge).toHaveBeenCalledTimes(1);
    expect(second.insertKnowledge).toHaveBeenCalledTimes(1);
  });
});

describe("Knowledge public module", () => {
  it("exports only the factory and stable error at runtime", () => {
    expect(Object.keys(publicKnowledge).sort()).toEqual([
      "KnowledgeError",
      "createKnowledgeAnalysis",
    ]);
  });

  it("factory source has no Clock dependency or forbidden downstream operations", async () => {
    const source = await readFile(
      new URL("../../src/knowledge/knowledge.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /\b(?:Clock|routeProcessing|searchEvents|analyzeEvents|matchTopics|fetchContent|withTransaction|config\/prompts|process\.env|apiKey)\b/,
    );
    expect(source.match(/callKnowledgeAnalysis\s*\(/g)).toHaveLength(1);
  });
});
