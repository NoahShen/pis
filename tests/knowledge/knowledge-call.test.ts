import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ChatCompletionsError } from "../../src/llm/chat-completions-client.js";
import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import type { KnowledgeAnalysisResponse } from "../../src/llm/response-validators.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type { KnowledgeTaskData } from "../../src/knowledge/content-input.js";
import { callKnowledgeAnalysis } from "../../src/knowledge/knowledge-call.js";
import {
  KNOWLEDGE_ERROR_MESSAGES,
  KnowledgeError,
  type KnowledgeErrorCode,
} from "../../src/knowledge/knowledge-errors.js";
import {
  logKnowledge,
  type KnowledgeLogger,
} from "../../src/knowledge/knowledge-logger.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const KNOWLEDGE_INSTRUCTIONS = "Synthetic knowledge-analysis instructions";
const USER_CONTEXT = "Synthetic user context";

const TASK_DATA: KnowledgeTaskData = {
  title: "Synthetic knowledge title",
  body: "Synthetic knowledge body",
  summary: "Synthetic knowledge summary",
  author: "Synthetic author",
  published_at: "2026-11-18T00:00:00Z",
  completeness: "FULL",
};

const VALUABLE_RESPONSE: KnowledgeAnalysisResponse = {
  valuable: true,
  title: "Synthetic insight",
  summary: "Synthetic summary",
  category: "Insight",
  findings: [
    { title: "Finding one", description: "First synthetic finding" },
    { title: "Finding two", description: "Second synthetic finding" },
    { title: "Finding three", description: "Third synthetic finding" },
  ],
  value: "Synthetic value",
};

const NEGATIVE_RESPONSE: KnowledgeAnalysisResponse = { valuable: false };

type AnalyzeKnowledge = TypedLlmCalls["analyzeKnowledge"];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function withStrictCalls<T>(
  response: string,
  callback: (
    calls: TypedLlmCalls,
    stub: StubLLM,
    directory: string,
  ) => Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    await writeFile(
      path.join(directory, "knowledge-analysis.md"),
      KNOWLEDGE_INSTRUCTIONS,
      "utf8",
    );
    await writeFile(
      path.join(directory, "user-context.md"),
      USER_CONTEXT,
      "utf8",
    );

    const stub = new StubLLM([response]);
    const calls = createTypedLlmCalls({
      prompts: new PromptRepository(directory),
      completionClient: stub,
    });

    return callback(calls, stub, directory);
  });
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the knowledge call to fail");
}

function expectKnowledgeError(
  error: unknown,
  code: KnowledgeErrorCode,
): asserts error is KnowledgeError {
  expect(error).toBeInstanceOf(KnowledgeError);
  expect(error).toMatchObject({
    name: "KnowledgeError",
    code,
    message: KNOWLEDGE_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  if (code === "aborted") {
    expect(error).not.toHaveProperty("llmFailure");
  }
}

function spyCalls(implementation: AnalyzeKnowledge): Pick<
  TypedLlmCalls,
  "analyzeKnowledge"
> & {
  readonly analyzeKnowledge: ReturnType<typeof vi.fn<AnalyzeKnowledge>>;
} {
  return { analyzeKnowledge: vi.fn<AnalyzeKnowledge>(implementation) };
}

function abortErrorWithName(): Error {
  const error = new Error("PRIVATE_ABORT_CAUSE");
  error.name = "AbortError";
  return error;
}

function abortErrorWithCode(): Error & { readonly code: string } {
  return Object.assign(new Error("PRIVATE_ABORT_CAUSE"), {
    code: "ABORT_ERR",
  });
}

describe("knowledge call boundary", () => {
  it("preserves a fixed knowledge-analysis failure summary", async () => {
    const calls = spyCalls(() =>
      Promise.reject(new ChatCompletionsError("LLM_NETWORK_ERROR")),
    );
    const error = await captureRejection(
      callKnowledgeAnalysis(TASK_DATA, calls, undefined, undefined),
    );

    expectKnowledgeError(error, "llm_failed");
    expect(error.llmFailure).toEqual({
      operation: "knowledge-analysis",
      category: "network",
      reason: "LLM_NETWORK_ERROR",
      retryable: true,
    });
  });

  it("KNO-01 returns a valuable response with three findings after one LLM call", async () => {
    await withStrictCalls(
      JSON.stringify(VALUABLE_RESPONSE),
      async (calls, stub) => {
        const result = await callKnowledgeAnalysis(
          TASK_DATA,
          calls,
          undefined,
          undefined,
        );

        expect(result).toEqual(VALUABLE_RESPONSE);
        expect(stub.requests).toHaveLength(1);
        expect(JSON.parse(stub.requests[0]?.userContent ?? "")).toMatchObject({
          task_data: TASK_DATA,
          user_context: USER_CONTEXT,
        });
      },
    );
  });

  it("KNO-02 returns valuable=false without fabricating knowledge fields", async () => {
    await withStrictCalls(
      JSON.stringify(NEGATIVE_RESPONSE),
      async (calls, stub) => {
        const logger = vi.fn<KnowledgeLogger>();
        const result = await callKnowledgeAnalysis(
          TASK_DATA,
          calls,
          logger,
          undefined,
        );

        expect(result).toEqual({ valuable: false });
        expect(Object.keys(result)).toEqual(["valuable"]);
        expect(stub.requests).toHaveLength(1);
        expect(logger).toHaveBeenCalledWith({
          stage: "analyze",
          valuable: false,
        });
      },
    );
  });

  it.each([
    [
      "missing title",
      {
        valuable: true,
        summary: "Synthetic summary",
        findings: [],
        value: "Synthetic value",
      },
    ],
    [
      "missing value",
      {
        valuable: true,
        title: "Synthetic title",
        summary: "Synthetic summary",
        findings: [],
      },
    ],
    ["invalid findings", { ...VALUABLE_RESPONSE, findings: "not-an-array" }],
    ["invalid category", { ...VALUABLE_RESPONSE, category: "Other" }],
    [
      "finding additional field",
      {
        ...VALUABLE_RESPONSE,
        findings: [
          {
            title: "Finding one",
            description: "First synthetic finding",
            raw_data: "MODEL_RAW_DATA_SENTINEL",
          },
        ],
      },
    ],
  ])(
    "KNO-08 maps %s from real D02 validation to llm_failed",
    async (_name, invalidResponse) => {
      await withStrictCalls(
        JSON.stringify(invalidResponse),
        async (calls, stub) => {
          const error = await captureRejection(
            callKnowledgeAnalysis(TASK_DATA, calls, undefined, undefined),
          );

          expectKnowledgeError(error, "llm_failed");
          expect(stub.requests).toHaveLength(1);
        },
      );
    },
  );

  it.each([
    [
      "category omitted",
      {
        valuable: true,
        title: "Synthetic title",
        summary: "Synthetic summary",
        findings: [],
        value: "Synthetic value",
      },
    ],
    [
      "category null",
      {
        valuable: true,
        title: "Synthetic title",
        summary: "Synthetic summary",
        category: null,
        findings: [],
        value: "Synthetic value",
      },
    ],
  ])("KNO-11 accepts %s with empty findings", async (_name, response) => {
    await withStrictCalls(JSON.stringify(response), async (calls, stub) => {
      await expect(
        callKnowledgeAnalysis(TASK_DATA, calls, undefined, undefined),
      ).resolves.toEqual(response);
      expect(stub.requests).toHaveLength(1);
    });
  });

  it("KNO-12 maps valuable=false with additional fields to llm_failed", async () => {
    const invalidResponse = {
      valuable: false,
      title: "Forbidden title",
      value: "Forbidden value",
      extra: "MODEL_EXTRA_SENTINEL",
    };

    await withStrictCalls(
      JSON.stringify(invalidResponse),
      async (calls, stub) => {
        const error = await captureRejection(
          callKnowledgeAnalysis(TASK_DATA, calls, undefined, undefined),
        );

        expectKnowledgeError(error, "llm_failed");
        expect(error.message).not.toContain("MODEL_EXTRA_SENTINEL");
        expect(stub.requests).toHaveLength(1);
      },
    );
  });

  it("CALL_COUNT performs zero calls before an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const logger = vi.fn<KnowledgeLogger>();
    const calls = spyCalls(() => Promise.resolve(VALUABLE_RESPONSE));

    const error = await captureRejection(
      callKnowledgeAnalysis(TASK_DATA, calls, logger, controller.signal),
    );

    expectKnowledgeError(error, "aborted");
    expect(calls.analyzeKnowledge).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith({ stage: "check", reason: "aborted" });
  });

  it("CALL_COUNT preserves the exact signal reference and calls once on success", async () => {
    const controller = new AbortController();
    const calls = spyCalls(() => Promise.resolve(VALUABLE_RESPONSE));

    await expect(
      callKnowledgeAnalysis(TASK_DATA, calls, undefined, controller.signal),
    ).resolves.toBe(VALUABLE_RESPONSE);

    expect(calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
    expect(calls.analyzeKnowledge).toHaveBeenCalledWith(TASK_DATA, {
      signal: controller.signal,
    });
    expect(calls.analyzeKnowledge.mock.calls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
  });

  it.each([
    ["AbortError", abortErrorWithName],
    ["ABORT_ERR", abortErrorWithCode],
  ])(
    "CANCEL maps %s from the typed call to aborted",
    async (_name, makeError) => {
      const calls = spyCalls(() => Promise.reject(makeError()));
      const logger = vi.fn<KnowledgeLogger>();

      const error = await captureRejection(
        callKnowledgeAnalysis(TASK_DATA, calls, logger, undefined),
      );

      expectKnowledgeError(error, "aborted");
      expect(calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledWith({
        stage: "analyze",
        reason: "aborted",
      });
    },
  );

  it("CANCEL maps a post-return abort to aborted without returning the response", async () => {
    const controller = new AbortController();
    const pending = deferred<KnowledgeAnalysisResponse>();
    const calls = spyCalls(() => pending.promise);

    const operation = callKnowledgeAnalysis(
      TASK_DATA,
      calls,
      undefined,
      controller.signal,
    );
    expect(calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
    controller.abort();
    pending.resolve(VALUABLE_RESPONSE);

    const error = await captureRejection(operation);
    expectKnowledgeError(error, "aborted");
  });

  it("maps non-cancellation failures to llm_failed without retrying", async () => {
    const providerError = new Error("PROVIDER_RAW_MODEL_SENTINEL", {
      cause: { sql: "SQL_SENTINEL", token: "TOKEN_SENTINEL" },
    });
    const calls = spyCalls(() => Promise.reject(providerError));
    const logger = vi.fn<KnowledgeLogger>();

    const error = await captureRejection(
      callKnowledgeAnalysis(TASK_DATA, calls, logger, undefined),
    );

    expectKnowledgeError(error, "llm_failed");
    expect(calls.analyzeKnowledge).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith({
      stage: "analyze",
      reason: "llm_failed",
    });
    expect(String(error)).not.toContain("PROVIDER_RAW_MODEL_SENTINEL");
  });

  it("ERROR_SAFETY uses only fixed messages without preserving cause or sensitive data", async () => {
    const sentinels = {
      cause: "CAUSE_SENTINEL",
      sql: "SQL_SENTINEL",
      zod: "ZOD_DETAIL_SENTINEL",
      model: "RAW_MODEL_OUTPUT_SENTINEL",
      prompt: "PROMPT_SENTINEL",
      token: "TOKEN_SENTINEL",
    };

    for (const code of Object.keys(
      KNOWLEDGE_ERROR_MESSAGES,
    ) as KnowledgeErrorCode[]) {
      const error = new KnowledgeError(code);
      expectKnowledgeError(error, code);
      expect(error.message).toBe(KNOWLEDGE_ERROR_MESSAGES[code]);
      for (const sentinel of Object.values(sentinels)) {
        expect(error.message).not.toContain(sentinel);
      }
    }

    const sensitiveInvalidOutput = JSON.stringify({
      valuable: true,
      title: sentinels.model,
      summary: sentinels.prompt,
      category: sentinels.zod,
      findings: [],
      value: sentinels.token,
    });
    await withStrictCalls(sensitiveInvalidOutput, async (calls) => {
      const error = await captureRejection(
        callKnowledgeAnalysis(TASK_DATA, calls, undefined, undefined),
      );
      expectKnowledgeError(error, "llm_failed");
      for (const sentinel of Object.values(sentinels)) {
        expect(String(error)).not.toContain(sentinel);
      }
    });
  });

  it("LOGGER receives only whitelisted fields", () => {
    const logger = vi.fn<KnowledgeLogger>();
    const bodySentinel = "BODY_SENTINEL";
    const summarySentinel = "SUMMARY_SENTINEL";
    const findingsSentinel = "FINDINGS_SENTINEL";
    const promptSentinel = "PROMPT_SENTINEL";
    const tokenSentinel = "TOKEN_SENTINEL";
    const entryWithExtras = {
      contentId: "content-1",
      knowledgeId: "knowledge-1",
      stage: "persist" as const,
      reason: "knowledge_failed" as const,
      valuable: true,
      body: bodySentinel,
      summary: summarySentinel,
      findings: [findingsSentinel],
      prompt: promptSentinel,
      token: tokenSentinel,
    };

    logKnowledge(logger, entryWithExtras);

    expect(logger).toHaveBeenCalledWith({
      contentId: "content-1",
      knowledgeId: "knowledge-1",
      stage: "persist",
      reason: "knowledge_failed",
      valuable: true,
    });
    const capturedEntry = logger.mock.calls[0]?.[0];
    expect(capturedEntry).toBeDefined();
    expect(Object.keys(capturedEntry ?? {}).sort()).toEqual([
      "contentId",
      "knowledgeId",
      "reason",
      "stage",
      "valuable",
    ]);
    for (const sentinel of [
      bodySentinel,
      summarySentinel,
      findingsSentinel,
      promptSentinel,
      tokenSentinel,
    ]) {
      expect(JSON.stringify(capturedEntry)).not.toContain(sentinel);
    }
  });

  it("LOGGER failures do not change successful results or business errors", async () => {
    const throwingLogger: KnowledgeLogger = () => {
      throw new Error("LOGGER_FAILURE_SENTINEL");
    };
    const successfulCalls = spyCalls(() => Promise.resolve(NEGATIVE_RESPONSE));
    await expect(
      callKnowledgeAnalysis(
        TASK_DATA,
        successfulCalls,
        throwingLogger,
        undefined,
      ),
    ).resolves.toBe(NEGATIVE_RESPONSE);

    const failingCalls = spyCalls(() =>
      Promise.reject(new Error("UNDERLYING_LLM_FAILURE")),
    );
    const error = await captureRejection(
      callKnowledgeAnalysis(TASK_DATA, failingCalls, throwingLogger, undefined),
    );
    expectKnowledgeError(error, "llm_failed");
    expect(failingCalls.analyzeKnowledge).toHaveBeenCalledTimes(1);
  });

  it("STRUCTURE contains no database, repository, adapter, raw-data, transaction, or alternate-operation dependency", async () => {
    const source = await readFile(
      new URL("../../src/knowledge/knowledge-call.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /\b(?:Database|Repository|Adapter|raw_data|withTransaction)\b|better-sqlite3|fetch\s*\(/,
    );
    expect(source).not.toMatch(
      /\b(?:routeProcessing|searchEvents|analyzeEvents|matchTopics)\b/,
    );
    expect(source.match(/analyzeKnowledge\s*\(/g)).toHaveLength(1);
  });
});
