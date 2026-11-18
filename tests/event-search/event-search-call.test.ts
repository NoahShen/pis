import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { EventSearchTaskData } from "../../src/event-search/content-input.js";
import { callEventSearch } from "../../src/event-search/event-search-call.js";
import {
  EVENT_SEARCH_ERROR_MESSAGES,
  EventSearchError,
  type EventSearchErrorCode,
} from "../../src/event-search/event-search-errors.js";
import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import type { EventSearchResponse } from "../../src/llm/response-validators.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const PROMPT_INSTRUCTIONS = "SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS_SENTINEL";
const PRIVATE_PROMPT = "PRIVATE_PROMPT_SENTINEL";
const PRIVATE_MODEL_OUTPUT = "PRIVATE_MODEL_OUTPUT_SENTINEL";
const PRIVATE_PROVIDER_MESSAGE = "PRIVATE_PROVIDER_MESSAGE_SENTINEL";
const PRIVATE_TOKEN = "PRIVATE_TOKEN_SENTINEL";
const PRIVATE_CAUSE = "PRIVATE_CAUSE_SENTINEL";
const PRIVATE_SQL = "PRIVATE_SQL_SENTINEL";

const TASK_DATA: EventSearchTaskData = {
  title: "Synthetic event search title",
  body: "Synthetic event search body",
  summary: "Synthetic event search summary",
  author: "Synthetic event search author",
  published_at: "2026-11-18T00:00:00Z",
  completeness: "FULL",
};

const CLUE_RESPONSE: EventSearchResponse = {
  clues: [
    {
      entity_name: "Synthetic Entity",
      subject: "Synthetic Subject",
      search_terms: ["synthetic-term-one", "synthetic-term-two"],
    },
  ],
};

const EMPTY_RESPONSE: EventSearchResponse = { clues: [] };

type SearchEvents = TypedLlmCalls["searchEvents"];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function searchCalls(implementation: SearchEvents): {
  readonly searchEvents: ReturnType<typeof vi.fn<SearchEvents>>;
} {
  return { searchEvents: vi.fn<SearchEvents>(implementation) };
}

function alternateOperationSpies(): {
  readonly routeProcessing: ReturnType<
    typeof vi.fn<TypedLlmCalls["routeProcessing"]>
  >;
  readonly analyzeEvents: ReturnType<
    typeof vi.fn<TypedLlmCalls["analyzeEvents"]>
  >;
  readonly analyzeKnowledge: ReturnType<
    typeof vi.fn<TypedLlmCalls["analyzeKnowledge"]>
  >;
  readonly matchTopics: ReturnType<typeof vi.fn<TypedLlmCalls["matchTopics"]>>;
} {
  return {
    routeProcessing: vi.fn<TypedLlmCalls["routeProcessing"]>(),
    analyzeEvents: vi.fn<TypedLlmCalls["analyzeEvents"]>(),
    analyzeKnowledge: vi.fn<TypedLlmCalls["analyzeKnowledge"]>(),
    matchTopics: vi.fn<TypedLlmCalls["matchTopics"]>(),
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the event search call to fail");
}

function expectEventSearchError(
  error: unknown,
  code: EventSearchErrorCode,
  forbiddenValues: readonly string[] = [],
): asserts error is EventSearchError {
  if (!(error instanceof EventSearchError)) {
    throw new Error("Expected EventSearchError");
  }

  expect(error).toBeInstanceOf(EventSearchError);
  expect(error).toMatchObject({
    name: "EventSearchError",
    code,
    message: EVENT_SEARCH_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("data");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");

  for (const forbiddenValue of forbiddenValues) {
    expect(String(error)).not.toContain(forbiddenValue);
    expect(error.message).not.toContain(forbiddenValue);
  }
}

function abortErrorWithName(): Error {
  const error = new Error(PRIVATE_PROVIDER_MESSAGE);
  error.name = "AbortError";
  return error;
}

function abortErrorWithCode(): Error & { readonly code: string } {
  return Object.assign(new Error(PRIVATE_PROVIDER_MESSAGE), {
    code: "ABORT_ERR",
  });
}

function cancelledError(): Error & { readonly code: string } {
  return Object.assign(new Error(PRIVATE_PROVIDER_MESSAGE), {
    code: "LLM_CANCELLED",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  expect(isRecord(parsed)).toBe(true);
  if (!isRecord(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed;
}

async function withStrictEventSearchCalls<T>(
  modelOutput: string,
  callback: (
    calls: TypedLlmCalls,
    stub: StubLLM,
    directory: string,
  ) => Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    await writeFile(
      path.join(directory, "event-search.md"),
      `${PROMPT_INSTRUCTIONS}\n${PRIVATE_PROMPT}\n`,
      "utf8",
    );

    const stub = new StubLLM([modelOutput]);
    const calls = createTypedLlmCalls({
      prompts: new PromptRepository(directory),
      completionClient: stub,
    });

    return callback(calls, stub, directory);
  });
}

describe("event search call boundary", () => {
  it("P02_CALL / SIGNAL calls searchEvents once with exact task data and signal", async () => {
    const controller = new AbortController();
    const searchEvents = vi.fn<SearchEvents>(() =>
      Promise.resolve(CLUE_RESPONSE),
    );
    const otherCalls = alternateOperationSpies();
    const calls = { searchEvents, ...otherCalls };

    await expect(
      callEventSearch(TASK_DATA, calls, controller.signal),
    ).resolves.toBe(CLUE_RESPONSE);

    expect(searchEvents).toHaveBeenCalledTimes(1);
    expect(searchEvents).toHaveBeenCalledWith(TASK_DATA, {
      signal: controller.signal,
    });
    expect(searchEvents.mock.calls[0]?.[0]).toBe(TASK_DATA);
    expect(searchEvents.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    for (const alternateCall of Object.values(otherCalls)) {
      expect(alternateCall).not.toHaveBeenCalled();
    }
  });

  it("EVT-21_PRE returns legal empty clues unchanged", async () => {
    const calls = searchCalls(() => Promise.resolve(EMPTY_RESPONSE));

    await expect(callEventSearch(TASK_DATA, calls, undefined)).resolves.toBe(
      EMPTY_RESPONSE,
    );
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
    expect(calls.searchEvents).toHaveBeenCalledWith(TASK_DATA, {
      signal: undefined,
    });
  });

  it("PMT-09 uses only synthetic event-search content and never injects user_context", async () => {
    await withStrictEventSearchCalls(
      JSON.stringify(CLUE_RESPONSE),
      async (calls, stub, directory) => {
        expect(await readdir(directory)).toEqual(["event-search.md"]);

        await expect(
          callEventSearch(TASK_DATA, calls, undefined),
        ).resolves.toEqual(CLUE_RESPONSE);

        expect(stub.requests).toHaveLength(1);
        const request = stub.requests[0];
        expect(request).toBeDefined();
        expect(request?.systemContent).toContain(PROMPT_INSTRUCTIONS);
        expect(request?.systemContent).not.toContain(TASK_DATA.body);

        const userPayload = parseObject(request?.userContent ?? "");
        expect(Object.keys(userPayload)).toEqual(["task_data"]);
        expect(userPayload).not.toHaveProperty("user_context");
        expect(request?.userContent).not.toContain(PROMPT_INSTRUCTIONS);

        const taskData = userPayload.task_data;
        expect(isRecord(taskData)).toBe(true);
        if (!isRecord(taskData)) {
          throw new Error("Expected task_data to be an object");
        }
        expect(taskData).toEqual(TASK_DATA);
        expect(Object.keys(taskData).sort()).toEqual([
          "author",
          "body",
          "completeness",
          "published_at",
          "summary",
          "title",
        ]);
      },
    );
  });

  it.each([
    ["invalid JSON", `not-json ${PRIVATE_MODEL_OUTPUT}`],
    [
      "missing search_terms",
      JSON.stringify({
        clues: [{ entity_name: "Entity", subject: "Subject" }],
      }),
    ],
    [
      "wrong search_terms type",
      JSON.stringify({
        clues: [
          {
            entity_name: "Entity",
            subject: "Subject",
            search_terms: PRIVATE_MODEL_OUTPUT,
          },
        ],
      }),
    ],
    [
      "outer extra field",
      JSON.stringify({ clues: [], model_extra: PRIVATE_MODEL_OUTPUT }),
    ],
    [
      "clue extra field",
      JSON.stringify({
        clues: [
          {
            entity_name: "Entity",
            subject: "Subject",
            search_terms: ["term"],
            model_extra: PRIVATE_MODEL_OUTPUT,
          },
        ],
      }),
    ],
  ])(
    "PMT-15 maps %s from real D02 validation to llm_failed",
    async (_name, modelOutput) => {
      await withStrictEventSearchCalls(modelOutput, async (calls, stub) => {
        const error = await captureRejection(
          callEventSearch(TASK_DATA, calls, undefined),
        );

        expectEventSearchError(error, "llm_failed", [
          PRIVATE_MODEL_OUTPUT,
          PRIVATE_PROMPT,
          TASK_DATA.body,
        ]);
        expect(stub.requests).toHaveLength(1);
      });
    },
  );

  it("ABORT / ERROR_SAFETY performs zero calls before an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const calls = searchCalls(() => Promise.resolve(CLUE_RESPONSE));

    const error = await captureRejection(
      callEventSearch(TASK_DATA, calls, controller.signal),
    );

    expectEventSearchError(error, "aborted");
    expect(calls.searchEvents).not.toHaveBeenCalled();
  });

  it.each([
    ["AbortError", abortErrorWithName],
    ["ABORT_ERR", abortErrorWithCode],
    ["LLM_CANCELLED", cancelledError],
  ])(
    "ABORT / ERROR_SAFETY maps %s from searchEvents to aborted",
    async (_name, makeError) => {
      const calls = searchCalls(() => Promise.reject(makeError()));

      const error = await captureRejection(
        callEventSearch(TASK_DATA, calls, undefined),
      );

      expectEventSearchError(error, "aborted", [PRIVATE_PROVIDER_MESSAGE]);
      expect(calls.searchEvents).toHaveBeenCalledTimes(1);
    },
  );

  it("ABORT / ERROR_SAFETY gives the signal priority when cancellation arrives during the call", async () => {
    const controller = new AbortController();
    const pending = deferred<EventSearchResponse>();
    const calls = searchCalls(() => pending.promise);

    const operation = callEventSearch(TASK_DATA, calls, controller.signal);
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
    controller.abort();
    pending.reject(new Error(PRIVATE_PROVIDER_MESSAGE));

    const error = await captureRejection(operation);
    expectEventSearchError(error, "aborted", [PRIVATE_PROVIDER_MESSAGE]);
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
  });

  it("ABORT / ERROR_SAFETY maps a post-return cancellation without returning clues", async () => {
    const controller = new AbortController();
    const pending = deferred<EventSearchResponse>();
    const calls = searchCalls(() => pending.promise);

    const operation = callEventSearch(TASK_DATA, calls, controller.signal);
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
    controller.abort();
    pending.resolve(CLUE_RESPONSE);

    const error = await captureRejection(operation);
    expectEventSearchError(error, "aborted");
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
  });

  it("ABORT / ERROR_SAFETY maps non-cancellation failures once without retrying", async () => {
    const providerError = new Error(PRIVATE_PROVIDER_MESSAGE, {
      cause: {
        sql: PRIVATE_SQL,
        token: PRIVATE_TOKEN,
        cause: PRIVATE_CAUSE,
      },
    });
    const calls = searchCalls(() => Promise.reject(providerError));

    const error = await captureRejection(
      callEventSearch(TASK_DATA, calls, undefined),
    );

    expectEventSearchError(error, "llm_failed", [
      PRIVATE_PROVIDER_MESSAGE,
      PRIVATE_SQL,
      PRIVATE_TOKEN,
      PRIVATE_CAUSE,
      PRIVATE_PROMPT,
      TASK_DATA.body,
    ]);
    expect(calls.searchEvents).toHaveBeenCalledTimes(1);
  });

  it("ABORT / ERROR_SAFETY exposes only four fixed messages without retained data", () => {
    const sensitiveValues = [
      PRIVATE_PROVIDER_MESSAGE,
      PRIVATE_SQL,
      PRIVATE_TOKEN,
      PRIVATE_CAUSE,
      PRIVATE_PROMPT,
      PRIVATE_MODEL_OUTPUT,
      TASK_DATA.body,
    ];

    expect(Object.keys(EVENT_SEARCH_ERROR_MESSAGES).sort()).toEqual([
      "aborted",
      "event_search_failed",
      "invalid_input",
      "llm_failed",
    ]);

    for (const code of Object.keys(
      EVENT_SEARCH_ERROR_MESSAGES,
    ) as EventSearchErrorCode[]) {
      const error = new EventSearchError(code);
      expectEventSearchError(error, code, sensitiveValues);
      expect(error.message).toBe(EVENT_SEARCH_ERROR_MESSAGES[code]);
    }
  });
});
