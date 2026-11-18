import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createNoneSourceContent } from "../../src/collection/raw-data.js";
import type { ProcessingDependencies } from "../../src/processing/contracts.js";
import {
  ProcessingError,
  type ProcessingErrorCode,
} from "../../src/processing/processing-errors.js";
import { createProcessing } from "../../src/processing/processing.js";
import {
  countFixtureRows,
  fixtureDownstreamTables,
} from "../fixtures/collection.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";
import { writePromptDirectory } from "../fixtures/prompt-directory.js";
import {
  countProcessingContents,
  countProcessingSourceItems,
  createProcessingEntry,
  createProcessingHarness,
  createProcessingSourceContent,
  expectEmptyProcessingResult,
  insertProcessingSource,
  insertProcessingSourceItem,
  installProcessingHttpSpies,
  PROCESSING_BODY_SENTINEL,
  PROCESSING_PROMPT_SENTINEL,
  PROCESSING_RAW_SENTINEL,
  PROCESSING_TOKEN_SENTINEL,
  readProcessingContent,
  readProcessingSourceItem,
  withProcessingDatabase,
  type ProcessingCompleteHook,
  type ProcessingHarness,
} from "../fixtures/processing.js";

const CONTENT_ID = "processing-content-1";
const SOURCE_ITEM_ID = "processing-source-item-1";

interface IntegrationOptions {
  readonly responses: readonly (string | Error)[];
  readonly completeHook?: ProcessingCompleteHook;
  readonly contentIdPrefix?: string;
}

interface IntegrationContext {
  readonly db: Database.Database;
  readonly harness: ProcessingHarness;
}

async function withIntegrationHarness<T>(
  options: IntegrationOptions,
  callback: (context: IntegrationContext) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (promptDirectory) => {
    await writePromptDirectory(promptDirectory);

    return withProcessingDatabase(async (db) => {
      insertProcessingSource(db);
      const harness = createProcessingHarness({
        database: db,
        promptDirectory,
        responses: options.responses,
        ...(options.completeHook === undefined
          ? {}
          : { completeHook: options.completeHook }),
        ...(options.contentIdPrefix === undefined
          ? {}
          : { contentIdPrefix: options.contentIdPrefix }),
      });

      return callback({ db, harness });
    });
  });
}

function routeResponse(...routes: Array<"EVENT" | "KNOWLEDGE">): string {
  return JSON.stringify({ routes });
}

function parseUserContent(userContent: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(userContent);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object in userContent");
  }
  return parsed as Record<string, unknown>;
}

async function captureProcessingError(
  operation: Promise<unknown>,
): Promise<ProcessingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    if (error instanceof ProcessingError) {
      return error;
    }
  }

  throw new Error("Expected Processing to fail");
}

function expectSafeError(
  error: ProcessingError,
  code: ProcessingErrorCode,
): void {
  expect(error.code).toBe(code);
  expect(error.message).toBe(
    {
      invalid_input: "Invalid processing input",
      aborted: "Processing was aborted",
      processing_failed: "Processing failed",
      llm_failed: "LLM processing failed",
    }[code],
  );
  expect(error).not.toHaveProperty("cause");
}

function expectNoDownstreamRows(db: Database.Database): void {
  for (const table of fixtureDownstreamTables) {
    if (table !== "contents") {
      expect(countFixtureRows(db, table), table).toBe(0);
    }
  }
}

describe("Processing public integration", () => {
  it("PRO-01 / COMMIT_ORDER / CALL_COUNT / TASK_INPUT / PRIVACY opens the LLM only after Content commit and sends the exact seven-field task", async () => {
    const expectedSummary = "Synthetic committed summary";
    let hookCalls = 0;
    let database: Database.Database | null = null;

    await withIntegrationHarness(
      {
        responses: [routeResponse("EVENT", "KNOWLEDGE")],
        completeHook: (request) => {
          hookCalls += 1;
          if (database === null) {
            throw new Error("Expected the integration database to be ready");
          }
          expect(database.inTransaction).toBe(false);
          expect(countProcessingContents(database)).toBe(1);
          const content = readProcessingContent(database, CONTENT_ID);
          expect(content).not.toBeNull();
          expect(content?.body).toBe(PROCESSING_BODY_SENTINEL);
          expect(content?.summary).toBe(expectedSummary);
          expect(
            readProcessingSourceItem(database, SOURCE_ITEM_ID)?.content_id,
          ).toBe(CONTENT_ID);
          expect(request.userContent).not.toContain(PROCESSING_RAW_SENTINEL);
          expect(request.userContent).not.toContain(PROCESSING_TOKEN_SENTINEL);
          expect(request.systemContent).not.toContain(PROCESSING_RAW_SENTINEL);
          expect(request.systemContent).not.toContain(
            PROCESSING_TOKEN_SENTINEL,
          );
          expect(request.systemContent).toContain(PROCESSING_PROMPT_SENTINEL);
        },
      },
      async ({ db, harness }) => {
        database = db;
        const http = installProcessingHttpSpies();

        try {
          const sourceItem = insertProcessingSourceItem(db, {
            id: SOURCE_ITEM_ID,
            content: createProcessingSourceContent(
              { external_id: PROCESSING_RAW_SENTINEL },
              {
                body: PROCESSING_BODY_SENTINEL,
                summary: expectedSummary,
              },
            ),
          });
          const result = await harness.service.process(sourceItem.id);

          expect(Object.keys(result)).toEqual(["content_id", "routes"]);
          expect(result).toStrictEqual({
            content_id: CONTENT_ID,
            routes: ["EVENT", "KNOWLEDGE"],
          });
          expect(hookCalls).toBe(1);
          expect(harness.stub.requests).toHaveLength(1);

          const request = harness.stub.requests[0];
          expect(request).toBeDefined();
          if (request === undefined) {
            throw new Error("Expected one LLM request");
          }

          const parsed = parseUserContent(request.userContent);
          expect(parsed).toStrictEqual({
            task_data: {
              title: "Synthetic processing title",
              body: PROCESSING_BODY_SENTINEL,
              summary: expectedSummary,
              completeness: "FULL",
              url: "https://article.processing.example.test/full-story",
              author: "Synthetic Processing Author",
              published_at: "2026-11-18T09:00:00.000+08:00",
            },
          });
          expect(Object.keys(parsed)).toEqual(["task_data"]);
          const taskData = parsed.task_data;
          if (
            typeof taskData !== "object" ||
            taskData === null ||
            Array.isArray(taskData)
          ) {
            throw new Error("Expected task_data to be a JSON object");
          }
          expect(Object.keys(taskData as Record<string, unknown>)).toEqual([
            "title",
            "body",
            "summary",
            "completeness",
            "url",
            "author",
            "published_at",
          ]);
          expect(request.userContent).not.toContain("content_id");
          expect(request.userContent).not.toContain("raw_data");
          expect(request.userContent).not.toContain("<p>");
          expect(
            request.userContent.split(PROCESSING_BODY_SENTINEL),
          ).toHaveLength(2);
          expect(request.systemContent).not.toContain(PROCESSING_BODY_SENTINEL);

          const loggerJson = JSON.stringify(harness.logger.entries);
          expect(loggerJson).not.toContain(PROCESSING_BODY_SENTINEL);
          expect(loggerJson).not.toContain(expectedSummary);
          expect(loggerJson).not.toContain(PROCESSING_RAW_SENTINEL);
          expect(loggerJson).not.toContain(PROCESSING_TOKEN_SENTINEL);
          expect(http.fetchContent).not.toHaveBeenCalled();
          expect(http.fetch).not.toHaveBeenCalled();
        } finally {
          http.restore();
        }
      },
    );
  });

  it("PRO-02 / PRO-12 persists and routes an actual summary-backed PARTIAL body", async () => {
    const partialText = "Actual acquired summary <kept> 知识";

    await withIntegrationHarness(
      { responses: [routeResponse("KNOWLEDGE")] },
      async ({ db, harness }) => {
        const sourceContent = createProcessingSourceContent(
          {
            title: "Summary-backed PARTIAL title",
            external_id: "summary-backed-entry",
          },
          {
            body: null,
            summary: partialText,
            content_kind: "SUMMARY",
            acquired_via: "SOURCE_FALLBACK",
            completeness_basis: "PARTIAL_ONLY",
          },
        );
        const sourceItem = insertProcessingSourceItem(db, {
          id: "summary-backed-item",
          content: sourceContent,
        });

        const result = await harness.service.process(sourceItem.id);

        expect(result).toStrictEqual({
          content_id: CONTENT_ID,
          routes: ["KNOWLEDGE"],
        });
        expect(readProcessingContent(db, CONTENT_ID)).toMatchObject({
          body: partialText,
          summary: partialText,
          completeness: "PARTIAL",
        });
        expect(harness.stub.requests).toHaveLength(1);
        const request = harness.stub.requests[0];
        expect(request?.userContent).toBeDefined();
        if (request === undefined) {
          throw new Error("Expected one LLM request");
        }
        expect(parseUserContent(request.userContent)).toStrictEqual({
          task_data: {
            title: "Summary-backed PARTIAL title",
            body: partialText,
            summary: partialText,
            completeness: "PARTIAL",
            url: sourceContent.entry.url,
            author: sourceContent.entry.author,
            published_at: sourceContent.entry.published_at,
          },
        });
      },
    );
  });

  it("PRO-03 keeps Source Items and performs zero writes or LLM calls for missing, null, NONE, invalid, pre-abort, and dangling-content inputs", async () => {
    await withIntegrationHarness({ responses: [] }, async ({ db, harness }) => {
      const noneContent = createNoneSourceContent(
        createProcessingEntry({ external_id: "none-entry" }),
        "timeout",
      );
      insertProcessingSourceItem(db, {
        id: "none-source-item",
        content: noneContent,
      });
      insertProcessingSourceItem(db, {
        id: "null-raw-source-item",
        rawData: null,
      });
      insertProcessingSourceItem(db, {
        id: "pre-abort-source-item",
      });
      insertProcessingSourceItem(db, {
        id: "dangling-source-item",
      });

      db.pragma("foreign_keys = OFF");
      db.prepare("UPDATE source_items SET content_id = ? WHERE id = ?").run(
        "missing-content",
        "dangling-source-item",
      );
      db.pragma("foreign_keys = ON");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

      const http = installProcessingHttpSpies();
      const controller = new AbortController();
      controller.abort();

      try {
        expectEmptyProcessingResult(
          await harness.service.process("missing-source-item"),
        );
        expectEmptyProcessingResult(
          await harness.service.process("null-raw-source-item"),
        );
        expectEmptyProcessingResult(
          await harness.service.process("none-source-item"),
        );
        const invalidError = await captureProcessingError(
          harness.service.process("   "),
        );
        expectSafeError(invalidError, "invalid_input");
        const abortError = await captureProcessingError(
          harness.service.process("pre-abort-source-item", {
            signal: controller.signal,
          }),
        );
        expectSafeError(abortError, "aborted");
        const danglingError = await captureProcessingError(
          harness.service.process("dangling-source-item"),
        );
        expectSafeError(danglingError, "processing_failed");

        expect(countProcessingSourceItems(db)).toBe(4);
        expect(countProcessingContents(db)).toBe(0);
        expect(readProcessingSourceItem(db, "none-source-item")).not.toBeNull();
        expect(
          readProcessingSourceItem(db, "null-raw-source-item")?.content_id,
        ).toBeNull();
        expect(harness.stub.requests).toHaveLength(0);
        expect(http.fetchContent).not.toHaveBeenCalled();
        expect(http.fetch).not.toHaveBeenCalled();
      } finally {
        http.restore();
      }
    });
  });

  it("PRO-04 / PRO-11 reuses one committed Content and preserves Unicode and literal angle-bracket text", async () => {
    const body = "Unicode 知识 <algorithm> List<T> <Foo/> 空白";

    await withIntegrationHarness(
      {
        responses: [routeResponse("EVENT"), routeResponse("KNOWLEDGE")],
      },
      async ({ db, harness }) => {
        const sourceItem = insertProcessingSourceItem(db, {
          id: "repeat-angle-source-item",
          content: createProcessingSourceContent(
            { title: "标题 <T>", external_id: "repeat-angle-entry" },
            { body, summary: "Angle summary" },
          ),
        });

        const first = await harness.service.process(sourceItem.id);
        const sourceAfterFirst = readProcessingSourceItem(db, sourceItem.id);
        const second = await harness.service.process(sourceItem.id);

        expect(first).toStrictEqual({
          content_id: CONTENT_ID,
          routes: ["EVENT"],
        });
        expect(second).toStrictEqual({
          content_id: CONTENT_ID,
          routes: ["KNOWLEDGE"],
        });
        expect(harness.stub.requests).toHaveLength(2);
        expect(countProcessingContents(db)).toBe(1);
        expect(sourceAfterFirst?.content_id).toBe(CONTENT_ID);
        expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
          CONTENT_ID,
        );
        expect(readProcessingContent(db, CONTENT_ID)).toMatchObject({
          title: "标题 <T>",
          body,
          completeness: "FULL",
        });

        for (const literal of ["<algorithm>", "List<T>", "<Foo/>", "知识"]) {
          expect(readProcessingContent(db, CONTENT_ID)?.body).toContain(
            literal,
          );
        }
      },
    );
  });

  it("PRO-05 creates independent Contents for two Source Items with identical body and URL", async () => {
    const sharedBody = "Identical body for independent Content rows";
    const sharedUrl = "https://article.processing.example.test/shared";

    await withIntegrationHarness(
      { responses: [routeResponse("EVENT"), routeResponse("EVENT")] },
      async ({ db, harness }) => {
        const first = insertProcessingSourceItem(db, {
          id: "identical-source-item-1",
          content: createProcessingSourceContent(
            {
              external_id: "identical-entry-1",
              url: sharedUrl,
            },
            { body: sharedBody },
          ),
        });
        const second = insertProcessingSourceItem(db, {
          id: "identical-source-item-2",
          content: createProcessingSourceContent(
            {
              external_id: "identical-entry-2",
              url: sharedUrl,
            },
            { body: sharedBody },
          ),
        });

        const firstResult = await harness.service.process(first.id);
        const secondResult = await harness.service.process(second.id);

        expect(firstResult.content_id).toBe("processing-content-1");
        expect(secondResult.content_id).toBe("processing-content-2");
        expect(firstResult.content_id).not.toBe(secondResult.content_id);
        expect(countProcessingContents(db)).toBe(2);
        expect(readProcessingSourceItem(db, first.id)?.content_id).toBe(
          firstResult.content_id,
        );
        expect(readProcessingSourceItem(db, second.id)?.content_id).toBe(
          secondResult.content_id,
        );
        expect(harness.stub.requests).toHaveLength(2);
      },
    );
  });

  it("PRO-06 rolls back inserted Content when association fails and exposes only a safe processing error", async () => {
    await withIntegrationHarness({ responses: [] }, async ({ db, harness }) => {
      const sourceItem = insertProcessingSourceItem(db, {
        id: "rollback-source-item",
      });
      const failingSourceRepository = {
        getById: (id: string) => harness.sourceItemRepository.getById(id),
        setContentId: (): never => {
          throw new Error("SQLITE_PRIVATE_SENTINEL association failure");
        },
      };
      const dependencies: ProcessingDependencies = {
        database: db,
        sourceItemRepository: failingSourceRepository,
        contentRepository: harness.contentRepository,
        typedLlmCalls: harness.calls,
        clock: harness.clock,
        logger: harness.logger,
      };
      const service = createProcessing(dependencies);

      const error = await captureProcessingError(
        service.process(sourceItem.id),
      );

      expectSafeError(error, "processing_failed");
      expect(error.message).not.toContain("SQLITE_PRIVATE_SENTINEL");
      expect(countProcessingContents(db)).toBe(0);
      expect(
        readProcessingSourceItem(db, sourceItem.id)?.content_id,
      ).toBeNull();
      expect(harness.stub.requests).toHaveLength(0);
      expectNoDownstreamRows(db);
    });
  });

  it("PRO-07 / RETRY preserves committed Content after an LLM failure and reuses it on a second process", async () => {
    await withIntegrationHarness(
      {
        responses: [
          new Error("SQL JSON Zod Prompt private model output"),
          routeResponse("KNOWLEDGE", "EVENT", "KNOWLEDGE"),
        ],
      },
      async ({ db, harness }) => {
        const sourceItem = insertProcessingSourceItem(db, {
          id: "retry-source-item",
        });

        const firstError = await captureProcessingError(
          harness.service.process(sourceItem.id),
        );
        expectSafeError(firstError, "llm_failed");
        expect(firstError.message).not.toContain("private model output");
        expect(countProcessingContents(db)).toBe(1);
        expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
          CONTENT_ID,
        );
        expect(harness.stub.requests).toHaveLength(1);

        const second = await harness.service.process(sourceItem.id);

        expect(second).toStrictEqual({
          content_id: CONTENT_ID,
          routes: ["KNOWLEDGE", "EVENT"],
        });
        expect(countProcessingContents(db)).toBe(1);
        expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
          CONTENT_ID,
        );
        expect(harness.stub.requests).toHaveLength(2);
      },
    );
  });

  it("keeps committed Content when cancellation is observed after the LLM call", async () => {
    const controller = new AbortController();

    await withIntegrationHarness(
      {
        responses: [routeResponse("EVENT"), routeResponse("EVENT")],
        completeHook: (_request, callIndex) => {
          if (callIndex === 0) {
            controller.abort();
          }
        },
      },
      async ({ db, harness }) => {
        const sourceItem = insertProcessingSourceItem(db, {
          id: "cancel-after-commit-source-item",
        });

        const error = await captureProcessingError(
          harness.service.process(sourceItem.id, {
            signal: controller.signal,
          }),
        );

        expectSafeError(error, "aborted");
        expect(countProcessingContents(db)).toBe(1);
        expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
          CONTENT_ID,
        );

        const retry = await harness.service.process(sourceItem.id);
        expect(retry).toStrictEqual({
          content_id: CONTENT_ID,
          routes: ["EVENT"],
        });
        expect(harness.stub.requests).toHaveLength(2);
        expect(countProcessingContents(db)).toBe(1);
      },
    );
  });

  it.each([
    ["EVENT", ["EVENT"]],
    ["KNOWLEDGE", ["KNOWLEDGE"]],
    ["BOTH", ["EVENT", "KNOWLEDGE"]],
    ["empty", []],
  ] as const)(
    "PRO-08 maps %s routing to the public routes result without downstream dispatch",
    async (_caseName, routes) => {
      await withIntegrationHarness(
        { responses: [routeResponse(...routes)] },
        async ({ db, harness }) => {
          const sourceItem = insertProcessingSourceItem(db, {
            id: `route-source-item-${_caseName}`,
          });

          const result = await harness.service.process(sourceItem.id);

          expect(result).toStrictEqual({
            content_id: CONTENT_ID,
            routes,
          });
          expect(countProcessingContents(db)).toBe(1);
          expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
            CONTENT_ID,
          );
          expectNoDownstreamRows(db);
          expect(harness.stub.requests).toHaveLength(1);
        },
      );
    },
  );

  it.each([
    [
      "duplicate",
      routeResponse("KNOWLEDGE", "EVENT", "KNOWLEDGE"),
      ["KNOWLEDGE", "EVENT"],
    ],
    [
      "unknown enum",
      JSON.stringify({ routes: ["EVENT", "UNKNOWN"] }),
      undefined,
    ],
    [
      "extra field",
      JSON.stringify({ routes: ["EVENT"], extra: "route-sentinel" }),
      undefined,
    ],
  ] as const)(
    "PRO-10 applies D02 strict validation for %s while preserving committed Content",
    async (_caseName, response, expectedRoutes) => {
      await withIntegrationHarness(
        { responses: [response] },
        async ({ db, harness }) => {
          const sourceItem = insertProcessingSourceItem(db, {
            id: `validation-source-item-${_caseName}`,
          });

          if (expectedRoutes !== undefined) {
            await expect(
              harness.service.process(sourceItem.id),
            ).resolves.toStrictEqual({
              content_id: CONTENT_ID,
              routes: expectedRoutes,
            });
          } else {
            const error = await captureProcessingError(
              harness.service.process(sourceItem.id),
            );
            expectSafeError(error, "llm_failed");
            expect(error.message).not.toContain("UNKNOWN");
            expect(error.message).not.toContain("route-sentinel");
          }

          expect(countProcessingContents(db)).toBe(1);
          expect(readProcessingSourceItem(db, sourceItem.id)?.content_id).toBe(
            CONTENT_ID,
          );
          expect(harness.stub.requests).toHaveLength(1);
          expectNoDownstreamRows(db);
        },
      );
    },
  );
});
