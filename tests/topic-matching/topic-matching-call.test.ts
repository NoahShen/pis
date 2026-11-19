import { readdir } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import type { TopicMatchingResponse } from "../../src/llm/response-validators.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type { EventUpdateTopicTarget } from "../../src/topic-matching/contracts.js";
import {
  buildTopicMatchingReferences,
  buildTopicMatchingTaskData,
  callTopicMatching,
  type TopicMatchingCalls,
  type TopicMatchingTaskData,
} from "../../src/topic-matching/topic-matching-call.js";
import {
  TOPIC_MATCHING_ERROR_MESSAGES,
  TopicMatchingError,
  isTopicMatchingAbort,
  normalizeTopicMatchingError,
  type TopicMatchingErrorCode,
} from "../../src/topic-matching/topic-matching-errors.js";
import {
  PROMPT_FIXTURES,
  writePromptFiles,
} from "../fixtures/prompt-directory.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";
import {
  createTopicMatchingDisabledTopic,
  createTopicMatchingEnabledTopics,
  createTopicMatchingEventTarget,
  createTopicMatchingUpdateTarget,
  topicMatchingTopicIds,
} from "../fixtures/topic-matching.js";

const EMPTY_RESPONSE: TopicMatchingResponse = { matched_topic_ids: [] };
const MATCHED_RESPONSE: TopicMatchingResponse = {
  matched_topic_ids: [topicMatchingTopicIds.zulu],
};
const PRIVATE_PROVIDER_MESSAGE = "PRIVATE_PROVIDER_MESSAGE_SENTINEL";
const PRIVATE_PROMPT = "PRIVATE_REAL_PROMPT_SENTINEL";
const PRIVATE_SQL = "PRIVATE_SQL_SENTINEL";
const PRIVATE_TOKEN = "PRIVATE_TOKEN_SENTINEL";
const USER_CONTEXT_SENTINEL = "PRIVATE_USER_CONTEXT_SENTINEL";

const TARGET = createTopicMatchingEventTarget();
const TOPICS = createTopicMatchingEnabledTopics();
const TASK_DATA = buildTopicMatchingTaskData(TARGET, TOPICS);
const REFERENCES = buildTopicMatchingReferences(TOPICS);

type MatchTopics = TypedLlmCalls["matchTopics"];

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

function matchTopicsCalls(implementation: MatchTopics) {
  return { matchTopics: vi.fn<MatchTopics>(implementation) };
}

function alternateOperationSpies(): {
  readonly routeProcessing: ReturnType<
    typeof vi.fn<TypedLlmCalls["routeProcessing"]>
  >;
  readonly searchEvents: ReturnType<
    typeof vi.fn<TypedLlmCalls["searchEvents"]>
  >;
  readonly analyzeEvents: ReturnType<
    typeof vi.fn<TypedLlmCalls["analyzeEvents"]>
  >;
  readonly analyzeKnowledge: ReturnType<
    typeof vi.fn<TypedLlmCalls["analyzeKnowledge"]>
  >;
} {
  return {
    routeProcessing: vi.fn<TypedLlmCalls["routeProcessing"]>(),
    searchEvents: vi.fn<TypedLlmCalls["searchEvents"]>(),
    analyzeEvents: vi.fn<TypedLlmCalls["analyzeEvents"]>(),
    analyzeKnowledge: vi.fn<TypedLlmCalls["analyzeKnowledge"]>(),
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected topic matching to fail");
}

function expectTopicMatchingError(
  error: unknown,
  code: TopicMatchingErrorCode,
  forbiddenValues: readonly string[] = [],
): asserts error is TopicMatchingError {
  expect(error).toBeInstanceOf(TopicMatchingError);
  expect(error).toMatchObject({
    name: "TopicMatchingError",
    code,
    message: TOPIC_MATCHING_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("data");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");

  for (const forbiddenValue of forbiddenValues) {
    expect(String(error)).not.toContain(forbiddenValue);
    expect((error as Error).message).not.toContain(forbiddenValue);
  }
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

async function withStrictTopicMatchingCalls<T>(
  modelOutputs: readonly string[],
  callback: (
    calls: TypedLlmCalls,
    stub: StubLLM,
    directory: string,
  ) => Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    await writePromptFiles(directory, ["topic-matching.md", "user-context.md"]);

    const stub = new StubLLM(modelOutputs);
    const calls = createTypedLlmCalls({
      prompts: new PromptRepository(directory),
      completionClient: stub,
    });

    return callback(calls, stub, directory);
  });
}

function abortErrorWithName(): Error {
  return Object.assign(new Error(PRIVATE_PROVIDER_MESSAGE), {
    name: "AbortError",
    cause: new Error(PRIVATE_TOKEN),
  });
}

function abortErrorWithCode(): Error & { readonly code: string } {
  return Object.assign(new Error(PRIVATE_PROVIDER_MESSAGE), {
    code: "ABORT_ERR",
    cause: new Error(PRIVATE_TOKEN),
  });
}

function cancelledError(): Error & { readonly code: string } {
  return Object.assign(new Error(PRIVATE_PROVIDER_MESSAGE), {
    code: "LLM_CANCELLED",
    cause: new Error(PRIVATE_TOKEN),
  });
}

describe("topic matching payload builders", () => {
  it("P05_TASK_DATA / PRIVACY_TASK returns only target/topics and ordered topic projections", () => {
    const taskData = buildTopicMatchingTaskData(TARGET, TOPICS);

    expect(Object.keys(taskData)).toEqual(["target", "topics"]);
    expect(taskData.target).toEqual(TARGET);
    expect(taskData.topics.map(({ id }) => id)).toEqual(
      TOPICS.map(({ id }) => id),
    );

    for (const topic of taskData.topics) {
      expect(Object.keys(topic).sort()).toEqual(["description", "id", "name"]);
    }

    expect(taskData).not.toHaveProperty("user_context");
    expect(taskData).not.toHaveProperty("raw_data");
    expect(taskData).not.toHaveProperty("url");
    expect(taskData).not.toHaveProperty("discovered_at");
    expect(taskData.topics[0]).not.toHaveProperty("enabled");
  });

  it("P05_REFERENCES preserves the enabled input order without extra fields or deduplication", () => {
    const references = buildTopicMatchingReferences(TOPICS);
    expect(Object.keys(references)).toEqual(["enabledTopicIds"]);
    expect(references.enabledTopicIds).toEqual([
      topicMatchingTopicIds.alpha,
      topicMatchingTopicIds.zulu,
    ]);

    const duplicateTopics = [
      ...TOPICS,
      {
        ...TOPICS[0],
        name: "Duplicate ID Topic",
      },
    ];
    expect(
      buildTopicMatchingReferences(duplicateTopics).enabledTopicIds,
    ).toEqual([
      topicMatchingTopicIds.alpha,
      topicMatchingTopicIds.zulu,
      topicMatchingTopicIds.alpha,
    ]);
  });

  it("SNAPSHOT detaches target/topics/references and captures a fresh snapshot for each build", () => {
    const targetFixture = createTopicMatchingUpdateTarget();
    const target = {
      ...targetFixture,
      event: { ...targetFixture.event },
    };
    const topics = createTopicMatchingEnabledTopics();
    const originalTarget = structuredClone(target);
    const originalIds = topics.map(({ id }) => id);
    const taskData = buildTopicMatchingTaskData(target, topics);
    const references = buildTopicMatchingReferences(topics);

    target.title = "Mutated update title";
    target.event.title = "Mutated Event title";
    topics[0].id = "mutated-topic-id";
    topics[0].name = "Mutated Topic name";
    topics[1].description = "Mutated Topic description";
    topics.push(createTopicMatchingDisabledTopic());

    expect(taskData.target).toEqual(originalTarget);
    expect((taskData.target as EventUpdateTopicTarget).event.title).toBe(
      originalTarget.event.title,
    );
    expect(taskData.topics).toEqual([
      {
        id: topicMatchingTopicIds.alpha,
        name: "Synthetic Alpha Topic",
        description: "Synthetic Alpha Topic Description",
      },
      {
        id: topicMatchingTopicIds.zulu,
        name: "Synthetic Zulu Topic",
        description: "Synthetic Zulu Topic Description",
      },
    ]);
    expect(references.enabledTopicIds).toEqual(originalIds);

    const rebuiltTaskData = buildTopicMatchingTaskData(target, topics);
    const rebuiltReferences = buildTopicMatchingReferences(topics);
    expect(rebuiltTaskData.target).toEqual(target);
    expect(rebuiltTaskData.topics[0]).toEqual({
      id: "mutated-topic-id",
      name: "Mutated Topic name",
      description: "Synthetic Alpha Topic Description",
    });
    expect(rebuiltReferences.enabledTopicIds).toEqual([
      "mutated-topic-id",
      topicMatchingTopicIds.zulu,
      topicMatchingTopicIds.disabled,
    ]);
  });
});

describe("topic matching error boundary", () => {
  it("ERROR_SAFETY exposes the exact five stable codes and messages without causes", () => {
    expect(Object.keys(TOPIC_MATCHING_ERROR_MESSAGES)).toEqual([
      "invalid_input",
      "aborted",
      "target_not_found",
      "topic_matching_failed",
      "llm_failed",
    ]);

    for (const code of Object.keys(
      TOPIC_MATCHING_ERROR_MESSAGES,
    ) as TopicMatchingErrorCode[]) {
      const error = new TopicMatchingError(code);
      expectTopicMatchingError(error, code);
      expect(error.message).toBe(TOPIC_MATCHING_ERROR_MESSAGES[code]);
    }
  });

  it.each([
    ["AbortError", abortErrorWithName],
    ["ABORT_ERR", abortErrorWithCode],
    ["LLM_CANCELLED", cancelledError],
    ["existing TopicMatching aborted", () => new TopicMatchingError("aborted")],
  ])(
    "ABORT_ERROR safely recognizes %s and maps it to aborted",
    async (_name, makeError) => {
      const failure = makeError();
      expect(isTopicMatchingAbort(failure)).toBe(true);
      expect(normalizeTopicMatchingError(failure, "llm_failed").code).toBe(
        "aborted",
      );

      const calls = matchTopicsCalls(() => Promise.reject(failure));
      const error = await captureRejection(
        callTopicMatching(TASK_DATA, REFERENCES, calls, undefined),
      );

      expectTopicMatchingError(error, "aborted", [
        PRIVATE_PROVIDER_MESSAGE,
        PRIVATE_TOKEN,
      ]);
      expect(calls.matchTopics).toHaveBeenCalledTimes(1);
    },
  );

  it("ABORT_ERROR ignores throwing error fields and maps ordinary failures to llm_failed", async () => {
    const unsafeError = {
      get name(): string {
        throw new Error(PRIVATE_TOKEN);
      },
      get code(): string {
        throw new Error(PRIVATE_TOKEN);
      },
    };
    expect(isTopicMatchingAbort(unsafeError)).toBe(false);

    const providerError = new Error(PRIVATE_PROVIDER_MESSAGE, {
      cause: {
        sql: PRIVATE_SQL,
        token: PRIVATE_TOKEN,
      },
    });
    const calls = matchTopicsCalls(() => Promise.reject(providerError));
    const error = await captureRejection(
      callTopicMatching(TASK_DATA, REFERENCES, calls, undefined),
    );

    expectTopicMatchingError(error, "llm_failed", [
      PRIVATE_PROVIDER_MESSAGE,
      PRIVATE_SQL,
      PRIVATE_TOKEN,
    ]);
    expect(calls.matchTopics).toHaveBeenCalledTimes(1);
  });
});

describe("callTopicMatching", () => {
  it("CALL_ONCE passes exact task data/references/signal to matchTopics once and returns the D02 result unchanged", async () => {
    const controller = new AbortController();
    const calls = matchTopicsCalls(() => Promise.resolve(MATCHED_RESPONSE));
    const otherCalls = alternateOperationSpies();

    await expect(
      callTopicMatching(
        TASK_DATA,
        REFERENCES,
        { matchTopics: calls.matchTopics, ...otherCalls },
        controller.signal,
      ),
    ).resolves.toBe(MATCHED_RESPONSE);

    expect(calls.matchTopics).toHaveBeenCalledTimes(1);
    expect(calls.matchTopics).toHaveBeenCalledWith(TASK_DATA, REFERENCES, {
      signal: controller.signal,
    });
    expect(calls.matchTopics.mock.calls[0]?.[0]).toBe(TASK_DATA);
    expect(calls.matchTopics.mock.calls[0]?.[1]).toBe(REFERENCES);
    expect(calls.matchTopics.mock.calls[0]?.[2]?.signal).toBe(
      controller.signal,
    );
    for (const alternateCall of Object.values(otherCalls)) {
      expect(alternateCall).not.toHaveBeenCalled();
    }
  });

  it("TOP-03_PRE / CALL_ONCE performs zero calls for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const calls = matchTopicsCalls(() => Promise.resolve(EMPTY_RESPONSE));
    const error = await captureRejection(
      callTopicMatching(TASK_DATA, REFERENCES, calls, controller.signal),
    );

    expectTopicMatchingError(error, "aborted");
    expect(calls.matchTopics).not.toHaveBeenCalled();
  });

  it("ABORT_ERROR gives an in-call signal cancellation priority over a provider rejection", async () => {
    const controller = new AbortController();
    const pending = deferred<TopicMatchingResponse>();
    const calls = matchTopicsCalls(() => pending.promise);
    const operation = callTopicMatching(
      TASK_DATA,
      REFERENCES,
      calls,
      controller.signal,
    );

    expect(calls.matchTopics).toHaveBeenCalledTimes(1);
    controller.abort();
    pending.reject(new Error(PRIVATE_PROVIDER_MESSAGE));

    const error = await captureRejection(operation);
    expectTopicMatchingError(error, "aborted", [PRIVATE_PROVIDER_MESSAGE]);
    expect(calls.matchTopics).toHaveBeenCalledTimes(1);
  });

  it("ABORT_ERROR maps cancellation observed after the typed call resolves without returning the response", async () => {
    const controller = new AbortController();
    const pending = deferred<TopicMatchingResponse>();
    const calls = matchTopicsCalls(() => pending.promise);
    const operation = callTopicMatching(
      TASK_DATA,
      REFERENCES,
      calls,
      controller.signal,
    );

    controller.abort();
    pending.resolve(EMPTY_RESPONSE);

    const error = await captureRejection(operation);
    expectTopicMatchingError(error, "aborted");
    expect(calls.matchTopics).toHaveBeenCalledTimes(1);
  });
});

describe("callTopicMatching with real D02 typed calls", () => {
  it("PMT-09 / TOP-03 uses only synthetic topic-matching Prompt data and returns empty matches unchanged", async () => {
    await withStrictTopicMatchingCalls(
      [JSON.stringify(EMPTY_RESPONSE)],
      async (calls, stub, directory) => {
        await expect(
          callTopicMatching(TASK_DATA, REFERENCES, calls, undefined),
        ).resolves.toEqual(EMPTY_RESPONSE);

        expect(await readdir(directory)).toEqual(
          ["topic-matching.md", "user-context.md"].sort(),
        );
        expect(stub.requests).toHaveLength(1);
        const request = stub.requests[0];
        expect(request?.systemContent).toContain(
          PROMPT_FIXTURES["topic-matching.md"],
        );

        const userPayload = parseObject(request?.userContent ?? "");
        expect(Object.keys(userPayload)).toEqual(["task_data"]);
        expect(userPayload).not.toHaveProperty("user_context");
        expect(userPayload.task_data).toEqual(TASK_DATA);
        expect(request?.userContent).not.toContain(USER_CONTEXT_SENTINEL);
        expect(request?.userContent).not.toContain(PRIVATE_PROMPT);
        expect(request?.userContent).not.toContain(PRIVATE_TOKEN);
      },
    );
  });

  it.each([
    ["invalid JSON", `not-json ${PRIVATE_PROVIDER_MESSAGE}`],
    ["missing matched_topic_ids", JSON.stringify({})],
    [
      "non-array matched_topic_ids",
      JSON.stringify({ matched_topic_ids: PRIVATE_PROVIDER_MESSAGE }),
    ],
    ["wrong item type", JSON.stringify({ matched_topic_ids: [123] })],
    [
      "extra response field",
      JSON.stringify({
        matched_topic_ids: [],
        private_model_output: PRIVATE_PROVIDER_MESSAGE,
      }),
    ],
    ["top-level array", JSON.stringify([{ matched_topic_ids: [] }])],
  ])(
    "PMT-07 strict P-05 maps %s from real D02 to llm_failed after one call",
    async (_name, output) => {
      await withStrictTopicMatchingCalls([output], async (calls, stub) => {
        const error = await captureRejection(
          callTopicMatching(TASK_DATA, REFERENCES, calls, undefined),
        );

        expectTopicMatchingError(error, "llm_failed", [
          PRIVATE_PROVIDER_MESSAGE,
          PRIVATE_PROMPT,
          PRIVATE_TOKEN,
        ]);
        expect(stub.requests).toHaveLength(1);
      });
    },
  );

  it.each([
    ["illegal ID", "topic-not-enabled"],
    ["disabled ID", topicMatchingTopicIds.disabled],
  ])(
    "TOP-05/12_PRE maps a %s from real D02 reference validation to llm_failed",
    async (_name, topicId) => {
      await withStrictTopicMatchingCalls(
        [JSON.stringify({ matched_topic_ids: [topicId] })],
        async (calls, stub) => {
          expect(createTopicMatchingDisabledTopic().enabled).toBe(false);
          const error = await captureRejection(
            callTopicMatching(TASK_DATA, REFERENCES, calls, undefined),
          );

          expectTopicMatchingError(error, "llm_failed");
          expect(stub.requests).toHaveLength(1);
        },
      );
    },
  );

  it("TOP-05/12_PRE preserves first-seen order while D02 deduplicates repeated matched IDs", async () => {
    const output = {
      matched_topic_ids: [
        topicMatchingTopicIds.zulu,
        topicMatchingTopicIds.alpha,
        topicMatchingTopicIds.zulu,
        topicMatchingTopicIds.alpha,
      ],
    };

    await withStrictTopicMatchingCalls(
      [JSON.stringify(output)],
      async (calls, stub) => {
        const result = await callTopicMatching(
          TASK_DATA,
          REFERENCES,
          calls,
          undefined,
        );

        expect(result).toEqual({
          matched_topic_ids: [
            topicMatchingTopicIds.zulu,
            topicMatchingTopicIds.alpha,
          ],
        });
        expect(stub.requests).toHaveLength(1);
      },
    );
  });
});
