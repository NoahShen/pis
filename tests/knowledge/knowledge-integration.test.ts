import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeAnalysisResponse } from "../../src/llm/response-validators.js";
import { KnowledgeError } from "../../src/knowledge/index.js";
import type { KnowledgeDraft } from "../../src/knowledge/knowledge-repository.js";
import { closeDatabase } from "../fixtures/database.js";
import {
  countBusinessRows,
  countKnowledgeRows,
  createKnowledgeHarness,
  insertKnowledgeContent,
  insertStoredKnowledge,
  KNOWLEDGE_AUTHOR,
  KNOWLEDGE_BODY_SENTINEL,
  KNOWLEDGE_CONTEXT_SENTINEL,
  KNOWLEDGE_CONTENT_ID,
  KNOWLEDGE_CREATED_AT,
  KNOWLEDGE_FINDING_SENTINEL,
  KNOWLEDGE_HTML_SENTINEL,
  KNOWLEDGE_HISTORY_SENTINEL,
  KNOWLEDGE_OUTPUT_SENTINEL,
  KNOWLEDGE_PROMPT_SENTINEL,
  KNOWLEDGE_PUBLISHED_AT,
  KNOWLEDGE_RAW_SENTINEL,
  KNOWLEDGE_SECOND_CONTENT_ID,
  KNOWLEDGE_SUMMARY,
  KNOWLEDGE_TITLE,
  KNOWLEDGE_TOKEN_SENTINEL,
  KNOWLEDGE_TOPIC_SENTINEL,
  readKnowledgeContent,
  readKnowledgeRow,
  type KnowledgeCompleteHook,
  type KnowledgeHarness,
  withKnowledgeDatabase,
  writeKnowledgePromptDirectory,
} from "../fixtures/knowledge.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const FINDINGS = [
  { title: "Finding one", description: "First synthetic finding" },
  { title: "Finding two", description: "Second synthetic finding" },
  { title: "Finding three", description: "Third synthetic finding" },
] as const;

function valuableResponse(
  overrides: Partial<
    Extract<KnowledgeAnalysisResponse, { valuable: true }>
  > = {},
): KnowledgeAnalysisResponse {
  return {
    valuable: true,
    title: "Validated Knowledge title",
    summary: "Validated Knowledge summary",
    category: "Insight",
    findings: [...FINDINGS],
    value: "Validated Knowledge value",
    ...overrides,
  };
}

function jsonResponse(response: unknown): string {
  return JSON.stringify(response);
}

async function captureKnowledgeError(
  operation: Promise<unknown>,
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
  for (const sentinel of [
    KNOWLEDGE_RAW_SENTINEL,
    KNOWLEDGE_TOPIC_SENTINEL,
    KNOWLEDGE_HISTORY_SENTINEL,
    KNOWLEDGE_TOKEN_SENTINEL,
    KNOWLEDGE_PROMPT_SENTINEL,
    KNOWLEDGE_OUTPUT_SENTINEL,
  ]) {
    expect(String(error)).not.toContain(sentinel);
  }
}

interface IntegrationOptions {
  readonly responses: readonly (string | Error)[];
  readonly completeHook?: KnowledgeCompleteHook;
  readonly knowledgeIds?: readonly string[];
}

interface IntegrationContext {
  readonly db: Database.Database;
  readonly harness: KnowledgeHarness;
  readonly promptDirectory: string;
}

async function withKnowledgeHarness<T>(
  options: IntegrationOptions,
  callback: (context: IntegrationContext) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (promptDirectory) => {
    await writeKnowledgePromptDirectory(promptDirectory);

    return withKnowledgeDatabase(async (db) => {
      const harness = createKnowledgeHarness({
        database: db,
        promptDirectory,
        responses: options.responses,
        ...(options.completeHook === undefined
          ? {}
          : { completeHook: options.completeHook }),
        ...(options.knowledgeIds === undefined
          ? {}
          : { knowledgeIds: options.knowledgeIds }),
      });

      return callback({ db, harness, promptDirectory });
    });
  });
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function expectFindingTableAbsent(db: Database.Database): void {
  const rows = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND lower(name) LIKE '%finding%'
      `,
    )
    .all() as Array<{ name: string }>;
  expect(rows).toEqual([]);
}

function expectOnlyKnowledgeCountChanged(
  before: ReturnType<typeof countBusinessRows>,
  after: ReturnType<typeof countBusinessRows>,
): void {
  for (const table of Object.keys(before) as Array<keyof typeof before>) {
    expect(after[table], table).toBe(
      before[table] + (table === "knowledge" ? 1 : 0),
    );
  }
}

describe("Knowledge public integration", () => {
  it("KNO-01 / COMMIT_ORDER / CALL_COUNT / KNO-06 sends exact synthetic input outside a transaction and commits one row", async () => {
    let activeDb: Database.Database | null = null;
    let hookCalls = 0;

    await withKnowledgeHarness(
      {
        responses: [jsonResponse(valuableResponse())],
        knowledgeIds: ["knowledge-1"],
        completeHook: (request) => {
          hookCalls += 1;
          if (activeDb === null) {
            throw new Error("Expected an active integration database");
          }

          expect(activeDb.inTransaction).toBe(false);
          expect(countBusinessRows(activeDb).contents).toBe(1);
          expect(countKnowledgeRows(activeDb)).toBe(0);
          expect(
            readKnowledgeContent(activeDb, KNOWLEDGE_CONTENT_ID),
          ).toMatchObject({
            id: KNOWLEDGE_CONTENT_ID,
            title: KNOWLEDGE_TITLE,
            body: KNOWLEDGE_BODY_SENTINEL,
          });
          expect(request.systemContent).toContain(KNOWLEDGE_PROMPT_SENTINEL);
          expect(request.systemContent).not.toContain(
            KNOWLEDGE_CONTEXT_SENTINEL,
          );
          expect(request.systemContent).not.toContain(KNOWLEDGE_BODY_SENTINEL);
        },
      },
      async ({ db, harness, promptDirectory }) => {
        activeDb = db;
        insertKnowledgeContent(db, { id: KNOWLEDGE_CONTENT_ID });
        const contentBeforeAnalysis = readKnowledgeContent(
          db,
          KNOWLEDGE_CONTENT_ID,
        );
        expect(contentBeforeAnalysis).toBeDefined();
        const businessBefore = countBusinessRows(db);
        const promptLoad = vi.spyOn(harness.prompts, "load");
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        try {
          expect((await readdir(promptDirectory)).sort()).toEqual([
            "knowledge-analysis.md",
            "user-context.md",
          ]);
          const result = await harness.service.analyze(KNOWLEDGE_CONTENT_ID);

          expect(result).toStrictEqual({ knowledge_id: "knowledge-1" });
          expect(Object.keys(result)).toEqual(["knowledge_id"]);
          expect(hookCalls).toBe(1);
          expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
          expect(harness.stub.requests).toHaveLength(1);
          expect(promptLoad).toHaveBeenCalledTimes(1);
          expect(promptLoad).toHaveBeenCalledWith("knowledge-analysis");
          expect(fetchSpy).not.toHaveBeenCalled();

          const request = harness.stub.requests[0];
          expect(request).toBeDefined();
          if (request === undefined) {
            throw new Error("Expected one synthetic LLM request");
          }

          expect(request.systemContent).toContain(KNOWLEDGE_PROMPT_SENTINEL);
          expect(request.systemContent).not.toContain(
            KNOWLEDGE_CONTEXT_SENTINEL,
          );
          expect(request.systemContent).not.toContain(KNOWLEDGE_BODY_SENTINEL);

          const userPayload = parseObject(request.userContent);
          expect(Object.keys(userPayload)).toEqual([
            "task_data",
            "user_context",
          ]);
          expect(userPayload.user_context).toBe(KNOWLEDGE_CONTEXT_SENTINEL);
          expect(
            request.userContent.split(KNOWLEDGE_BODY_SENTINEL),
          ).toHaveLength(2);

          const taskData = userPayload.task_data;
          expect(taskData).toStrictEqual({
            title: KNOWLEDGE_TITLE,
            body: KNOWLEDGE_BODY_SENTINEL,
            summary: KNOWLEDGE_SUMMARY,
            author: KNOWLEDGE_AUTHOR,
            published_at: KNOWLEDGE_PUBLISHED_AT,
            completeness: "FULL",
          });
          expect(Object.keys(taskData as Record<string, unknown>)).toEqual([
            "title",
            "body",
            "summary",
            "author",
            "published_at",
            "completeness",
          ]);

          for (const forbidden of [
            KNOWLEDGE_CONTENT_ID,
            KNOWLEDGE_RAW_SENTINEL,
            KNOWLEDGE_HTML_SENTINEL,
            KNOWLEDGE_TOPIC_SENTINEL,
            KNOWLEDGE_HISTORY_SENTINEL,
            KNOWLEDGE_TOKEN_SENTINEL,
          ]) {
            expect(JSON.stringify(taskData)).not.toContain(forbidden);
            expect(request.systemContent).not.toContain(forbidden);
          }
          expect(request.userContent).not.toContain(KNOWLEDGE_RAW_SENTINEL);
          expect(request.userContent).not.toContain(KNOWLEDGE_HTML_SENTINEL);
          expect(request.userContent).not.toContain(KNOWLEDGE_TOPIC_SENTINEL);
          expect(request.userContent).not.toContain(KNOWLEDGE_HISTORY_SENTINEL);
          expect(request.userContent).not.toContain(KNOWLEDGE_TOKEN_SENTINEL);

          const row = readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID);
          expect(row).toStrictEqual({
            id: "knowledge-1",
            content_id: KNOWLEDGE_CONTENT_ID,
            title: "Validated Knowledge title",
            summary: "Validated Knowledge summary",
            category: "Insight",
            findings_json: JSON.stringify(FINDINGS),
            value: "Validated Knowledge value",
          });
          expect(countKnowledgeRows(db)).toBe(1);
          expect(db.inTransaction).toBe(false);
          expect(readKnowledgeContent(db, KNOWLEDGE_CONTENT_ID)).toStrictEqual(
            contentBeforeAnalysis,
          );
          expectOnlyKnowledgeCountChanged(
            businessBefore,
            countBusinessRows(db),
          );
          expectFindingTableAbsent(db);

          const loggerJson = JSON.stringify(harness.logger.entries);
          for (const sentinel of [
            KNOWLEDGE_BODY_SENTINEL,
            KNOWLEDGE_SUMMARY,
            KNOWLEDGE_RAW_SENTINEL,
            KNOWLEDGE_HTML_SENTINEL,
            KNOWLEDGE_TOPIC_SENTINEL,
            KNOWLEDGE_HISTORY_SENTINEL,
            KNOWLEDGE_TOKEN_SENTINEL,
            KNOWLEDGE_PROMPT_SENTINEL,
            KNOWLEDGE_CONTEXT_SENTINEL,
            KNOWLEDGE_FINDING_SENTINEL,
            KNOWLEDGE_OUTPUT_SENTINEL,
          ]) {
            expect(loggerJson).not.toContain(sentinel);
          }
        } finally {
          fetchSpy.mockRestore();
          promptLoad.mockRestore();
        }
      },
    );
  });

  it("KNO-02 returns null for valuable=false with one call, zero writes and unchanged Content", async () => {
    await withKnowledgeHarness(
      { responses: [jsonResponse({ valuable: false })] },
      async ({ db, harness }) => {
        const content = insertKnowledgeContent(db, {
          id: KNOWLEDGE_CONTENT_ID,
        });
        const businessBefore = countBusinessRows(db);

        const result = await harness.service.analyze(KNOWLEDGE_CONTENT_ID);

        expect(result).toStrictEqual({ knowledge_id: null });
        expect(Object.keys(result)).toEqual(["knowledge_id"]);
        expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
        expect(harness.stub.requests).toHaveLength(1);
        expect(countKnowledgeRows(db)).toBe(0);
        expect(countBusinessRows(db)).toStrictEqual(businessBefore);
        expect(readKnowledgeContent(db, content.id)).toStrictEqual(content);
      },
    );
  });

  it("CALL_COUNT is exactly zero for existing Knowledge, missing Content, invalid input and pre-abort", async () => {
    await withKnowledgeHarness({ responses: [] }, async ({ db, harness }) => {
      const content = insertKnowledgeContent(db, {
        id: KNOWLEDGE_CONTENT_ID,
      });
      const stored: KnowledgeDraft = {
        id: "existing-knowledge-id",
        content_id: KNOWLEDGE_CONTENT_ID,
        title: "Existing Knowledge title",
        summary: "Existing Knowledge summary",
        category: "Experience",
        findings: [],
        value: "Existing Knowledge value",
      };
      insertStoredKnowledge(db, stored);
      const businessBefore = countBusinessRows(db);
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.service.analyze(KNOWLEDGE_CONTENT_ID),
      ).resolves.toStrictEqual({ knowledge_id: stored.id });
      await expect(
        harness.service.analyze("missing-content-sentinel"),
      ).resolves.toStrictEqual({ knowledge_id: null });

      const invalidError = await captureKnowledgeError(
        harness.service.analyze("   "),
      );
      expectSafeError(invalidError, "invalid_input");
      const abortError = await captureKnowledgeError(
        harness.service.analyze(KNOWLEDGE_CONTENT_ID, {
          signal: controller.signal,
        }),
      );
      expectSafeError(abortError, "aborted");

      expect(harness.calls.analyzeKnowledge).not.toHaveBeenCalled();
      expect(harness.stub.requests).toHaveLength(0);
      expect(countKnowledgeRows(db)).toBe(1);
      expect(countBusinessRows(db)).toStrictEqual(businessBefore);
      expect(readKnowledgeContent(db, content.id)).toStrictEqual(content);
      expect(readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID)?.id).toBe(stored.id);
    });
  });

  it.each([
    [
      "missing title",
      {
        valuable: true,
        summary: "Invalid response summary",
        findings: [],
        value: "Invalid response value",
      },
    ],
    [
      "invalid findings",
      {
        valuable: true,
        title: "Invalid response title",
        summary: "Invalid response summary",
        findings: KNOWLEDGE_OUTPUT_SENTINEL,
        value: "Invalid response value",
      },
    ],
    [
      "invalid category",
      {
        valuable: true,
        title: "Invalid response title",
        summary: "Invalid response summary",
        category: "Other",
        findings: [],
        value: "Invalid response value",
      },
    ],
    [
      "valuable=false with extra fields",
      {
        valuable: false,
        title: KNOWLEDGE_OUTPUT_SENTINEL,
        value: KNOWLEDGE_TOKEN_SENTINEL,
      },
    ],
  ])(
    "KNO-08 / KNO-12 rejects %s after one D02 call and leaves zero partial writes",
    async (_name, response) => {
      await withKnowledgeHarness(
        { responses: [jsonResponse(response)] },
        async ({ db, harness }) => {
          const content = insertKnowledgeContent(db, {
            id: KNOWLEDGE_CONTENT_ID,
          });
          const insert = vi.spyOn(harness.knowledgeRepository, "insert");
          const businessBefore = countBusinessRows(db);

          const error = await captureKnowledgeError(
            harness.service.analyze(KNOWLEDGE_CONTENT_ID),
          );

          expectSafeError(error, "llm_failed");
          expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
          expect(harness.stub.requests).toHaveLength(1);
          expect(insert).not.toHaveBeenCalled();
          expect(countBusinessRows(db)).toStrictEqual(businessBefore);
          expect(countKnowledgeRows(db)).toBe(0);
          expect(readKnowledgeContent(db, content.id)).toStrictEqual(content);
        },
      );
    },
  );

  it("KNO-11 persists omitted and explicit-null category as SQL NULL with findings exactly []", async () => {
    const omittedCategory = {
      valuable: true,
      title: "Omitted category title",
      summary: "Omitted category summary",
      findings: [],
      value: "Omitted category value",
    };
    const explicitNullCategory = {
      ...omittedCategory,
      category: null,
      title: "Explicit null category title",
    };

    await withKnowledgeHarness(
      {
        responses: [
          jsonResponse(omittedCategory),
          jsonResponse(explicitNullCategory),
        ],
        knowledgeIds: ["knowledge-omitted", "knowledge-explicit-null"],
      },
      async ({ db, harness }) => {
        insertKnowledgeContent(db, { id: KNOWLEDGE_CONTENT_ID });
        insertKnowledgeContent(db, { id: KNOWLEDGE_SECOND_CONTENT_ID });

        await expect(
          harness.service.analyze(KNOWLEDGE_CONTENT_ID),
        ).resolves.toStrictEqual({ knowledge_id: "knowledge-omitted" });
        await expect(
          harness.service.analyze(KNOWLEDGE_SECOND_CONTENT_ID),
        ).resolves.toStrictEqual({
          knowledge_id: "knowledge-explicit-null",
        });

        const omittedRow = readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID);
        const explicitRow = readKnowledgeRow(db, KNOWLEDGE_SECOND_CONTENT_ID);
        expect(omittedRow?.category).toBeNull();
        expect(explicitRow?.category).toBeNull();
        expect(omittedRow?.findings_json).toBe("[]");
        expect(explicitRow?.findings_json).toBe("[]");
        expect(countKnowledgeRows(db)).toBe(2);
        expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(2);
        expect(harness.stub.requests).toHaveLength(2);
      },
    );
  });

  it("KNO-03 / KNO-04 stores three findings in one row and reuses it without another LLM call", async () => {
    await withKnowledgeHarness(
      {
        responses: [jsonResponse(valuableResponse())],
        knowledgeIds: ["knowledge-three-findings"],
      },
      async ({ db, harness }) => {
        const content = insertKnowledgeContent(db, {
          id: KNOWLEDGE_CONTENT_ID,
        });

        const first = await harness.service.analyze(KNOWLEDGE_CONTENT_ID);
        const firstRow = readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID);
        const second = await harness.service.analyze(KNOWLEDGE_CONTENT_ID);

        expect(first).toStrictEqual({
          knowledge_id: "knowledge-three-findings",
        });
        expect(second).toStrictEqual(first);
        expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
        expect(harness.stub.requests).toHaveLength(1);
        expect(countKnowledgeRows(db)).toBe(1);
        expect(firstRow?.findings_json).toBe(JSON.stringify(FINDINGS));
        expect(JSON.parse(firstRow?.findings_json ?? "null")).toHaveLength(3);
        expect(readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID)).toStrictEqual(
          firstRow,
        );
        expect(readKnowledgeContent(db, content.id)).toStrictEqual(content);
        expectFindingTableAbsent(db);
      },
    );
  });

  it("KNO-05 creates independent Knowledge rows and IDs for two Contents with identical bodies", async () => {
    const identicalBody = "IDENTICAL_BODY_SENTINEL";

    await withKnowledgeHarness(
      {
        responses: [
          jsonResponse(valuableResponse({ title: "First identical body" })),
          jsonResponse(valuableResponse({ title: "Second identical body" })),
        ],
        knowledgeIds: ["knowledge-identical-one", "knowledge-identical-two"],
      },
      async ({ db, harness }) => {
        const firstContent = insertKnowledgeContent(db, {
          id: KNOWLEDGE_CONTENT_ID,
          body: identicalBody,
        });
        const secondContent = insertKnowledgeContent(db, {
          id: KNOWLEDGE_SECOND_CONTENT_ID,
          body: identicalBody,
        });

        const first = await harness.service.analyze(KNOWLEDGE_CONTENT_ID);
        const second = await harness.service.analyze(
          KNOWLEDGE_SECOND_CONTENT_ID,
        );

        expect(first).toStrictEqual({
          knowledge_id: "knowledge-identical-one",
        });
        expect(second).toStrictEqual({
          knowledge_id: "knowledge-identical-two",
        });
        expect(first.knowledge_id).not.toBe(second.knowledge_id);
        expect(countKnowledgeRows(db)).toBe(2);
        expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(2);
        expect(harness.stub.requests).toHaveLength(2);
        expect(readKnowledgeRow(db, KNOWLEDGE_CONTENT_ID)?.content_id).toBe(
          KNOWLEDGE_CONTENT_ID,
        );
        expect(
          readKnowledgeRow(db, KNOWLEDGE_SECOND_CONTENT_ID)?.content_id,
        ).toBe(KNOWLEDGE_SECOND_CONTENT_ID);
        expect(readKnowledgeContent(db, firstContent.id)).toStrictEqual(
          firstContent,
        );
        expect(readKnowledgeContent(db, secondContent.id)).toStrictEqual(
          secondContent,
        );
      },
    );
  });

  it("ROLLBACK maps a real SQLite insert failure to knowledge_failed with no partial row", async () => {
    await withKnowledgeHarness(
      {
        responses: [jsonResponse(valuableResponse())],
        knowledgeIds: ["knowledge-rejected"],
      },
      async ({ db, harness }) => {
        const content = insertKnowledgeContent(db, {
          id: KNOWLEDGE_CONTENT_ID,
        });
        db.exec(`
          CREATE TRIGGER reject_knowledge_insert
          BEFORE INSERT ON knowledge
          BEGIN
            SELECT RAISE(ABORT, 'synthetic transaction failure');
          END;
        `);

        const error = await captureKnowledgeError(
          harness.service.analyze(KNOWLEDGE_CONTENT_ID),
        );

        expectSafeError(error, "knowledge_failed");
        expect(harness.calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
        expect(harness.stub.requests).toHaveLength(1);
        expect(countKnowledgeRows(db)).toBe(0);
        expect(db.inTransaction).toBe(false);
        expect(readKnowledgeContent(db, content.id)).toStrictEqual(content);
      },
    );
  });

  it("RESOURCE_CLEANUP closes SQLite and leaves no WAL/SHM or network/timer/handle dependencies", async () => {
    let unhandledRejections = 0;
    const onUnhandledRejection = (): void => {
      unhandledRejections += 1;
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      await withKnowledgeDatabase(async (db, directory) => {
        insertKnowledgeContent(db, { id: KNOWLEDGE_CONTENT_ID });
        const harness = createKnowledgeHarness({
          database: db,
          promptDirectory: path.join(directory, "synthetic-prompts"),
          responses: [jsonResponse({ valuable: false })],
        });
        await writeKnowledgePromptDirectory(
          path.join(directory, "synthetic-prompts"),
        );
        const fetchSpy = vi.spyOn(globalThis, "fetch");

        try {
          await harness.service.analyze(KNOWLEDGE_CONTENT_ID);
          expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }

        expect(db.inTransaction).toBe(false);
        closeDatabase(db);
        expect(db.open).toBe(false);
        await Promise.resolve();

        const files = await readdir(directory);
        expect(files).toContain("database.sqlite");
        expect(files.filter((file) => /\.(?:wal|shm)$/u.test(file))).toEqual(
          [],
        );
      });
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledRejections).toBe(0);

    const source = await Promise.all(
      ["contracts.ts", "knowledge.ts", "index.ts"].map((file) =>
        readFile(
          new URL(`../../src/knowledge/${file}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    for (const contents of source) {
      expect(contents).not.toMatch(
        /\b(?:createServer|fetch|setTimeout|setInterval|net\.|socket)\b/,
      );
    }
  });
});
