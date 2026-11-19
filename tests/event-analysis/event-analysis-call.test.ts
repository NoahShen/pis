import { readdir } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type {
  EventCandidate,
  EventCandidateUpdate,
} from "../../src/event-search/contracts.js";
import type { EventAnalysisResponse } from "../../src/llm/response-validators.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import {
  buildEventAnalysisReferences,
  buildEventAnalysisTaskData,
  type EventAnalysisTaskData,
} from "../../src/event-analysis/content-input.js";
import {
  callEventAnalysis,
  type EventAnalysisCalls,
} from "../../src/event-analysis/event-analysis-call.js";
import {
  EventAnalysisError,
  EVENT_ANALYSIS_ERROR_MESSAGES,
  isEventAnalysisAbort,
  type EventAnalysisErrorCode,
} from "../../src/event-analysis/event-analysis-errors.js";
import { EVENT_ANALYSIS_RESPONSE } from "../fixtures/llm-responses.js";
import {
  PROMPT_FIXTURES,
  writePromptFiles,
} from "../fixtures/prompt-directory.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";
import {
  createSyntheticContent,
  PRIVACY_SENTINELS,
} from "../fixtures/event-search.js";

const EMPTY_RESPONSE: EventAnalysisResponse = { results: [] };
const PRIVATE_ERROR_TEXT = `${PRIVACY_SENTINELS.model} ${PRIVACY_SENTINELS.prompt} ${PRIVACY_SENTINELS.sql}`;

function update(eventId: string, id: string): EventCandidateUpdate {
  return {
    id,
    event_id: eventId,
    title: `${id} title`,
    description: `${id} description`,
    occurred_at: null,
    discovered_at: "2026-11-19T09:00:00.000+08:00",
  };
}

function candidate(eventId: string, updateId: string): EventCandidate {
  return {
    id: eventId,
    title: `${eventId} title`,
    entity_name: `${eventId} entity`,
    subject: `${eventId} subject`,
    scope: `${eventId} scope`,
    description: `${eventId} description`,
    occurred_at: null,
    discovered_at: "2026-11-19T08:00:00.000+08:00",
    updates: [update(eventId, updateId)],
  };
}

const CANDIDATES = [
  candidate("event-synthetic-1", "update-synthetic-1"),
  candidate("event-synthetic-2", "update-synthetic-2"),
];
const TASK_DATA = buildEventAnalysisTaskData(
  createSyntheticContent(),
  CANDIDATES,
);
const REFERENCES = buildEventAnalysisReferences(CANDIDATES);

function analyzeEvents(
  implementation: EventAnalysisCalls["analyzeEvents"] = async () =>
    EMPTY_RESPONSE,
): ReturnType<typeof vi.fn<EventAnalysisCalls["analyzeEvents"]>> {
  return vi.fn<EventAnalysisCalls["analyzeEvents"]>(implementation);
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected event analysis to fail");
}

function expectEventAnalysisError(
  error: unknown,
  code: EventAnalysisErrorCode,
): asserts error is EventAnalysisError {
  expect(error).toBeInstanceOf(EventAnalysisError);
  expect(error).toMatchObject({
    name: "EventAnalysisError",
    code,
    message: EVENT_ANALYSIS_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");
  for (const sentinel of Object.values(PRIVACY_SENTINELS)) {
    expect(String(error)).not.toContain(sentinel);
  }
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function p03ErrorCases(): readonly {
  readonly name: string;
  readonly output: string;
}[] {
  const newEvent = {
    action: "NEW_EVENT",
    title: "Synthetic new event",
    entity: { name: "Synthetic entity" },
    subject: "Synthetic subject",
    scope: "Synthetic scope",
    description: "Synthetic description",
    occurred_at: null,
    confirmed_aliases: [],
  };
  const newUpdate = {
    action: "NEW_UPDATE",
    event_id: "event-synthetic-1",
    title: "Synthetic update",
    description: "Synthetic update description",
    occurred_at: null,
    confirmed_aliases: [],
  };
  const noIncrement = {
    action: "NO_INCREMENT",
    event_id: "event-synthetic-1",
    event_update_id: "update-synthetic-1",
    confirmed_aliases: [],
  };

  return [
    {
      name: "invalid JSON",
      output: `not-json ${PRIVACY_SENTINELS.model}`,
    },
    {
      name: "outer extra field",
      output: JSON.stringify({
        results: [],
        private_model_output: PRIVACY_SENTINELS.model,
      }),
    },
    {
      name: "outer wrong type",
      output: JSON.stringify({ results: PRIVACY_SENTINELS.model }),
    },
    {
      name: "NEW_EVENT self-generated ID",
      output: JSON.stringify({
        results: [{ ...newEvent, event_id: "event-model-authored" }],
      }),
    },
    {
      name: "NO_INCREMENT missing Event",
      output: JSON.stringify({
        results: [{ ...noIncrement, event_id: undefined }],
      }),
    },
    {
      name: "candidate-external Event",
      output: JSON.stringify({
        results: [{ ...newUpdate, event_id: "event-outside-candidates" }],
      }),
    },
    {
      name: "Update owned by another Event",
      output: JSON.stringify({
        results: [
          {
            ...noIncrement,
            event_id: "event-synthetic-2",
          },
        ],
      }),
    },
    {
      name: "conflicting Actions for one Event",
      output: JSON.stringify({ results: [newUpdate, noIncrement] }),
    },
    {
      name: "result extra field",
      output: JSON.stringify({
        results: [
          { ...newEvent, private_model_output: PRIVACY_SENTINELS.model },
        ],
      }),
    },
  ];
}

describe("event analysis error boundary", () => {
  it("ERROR_SAFETY exposes four exact stable codes/messages without causes", () => {
    for (const code of [
      "invalid_input",
      "aborted",
      "event_analysis_failed",
      "llm_failed",
    ] as const) {
      const error = new EventAnalysisError(code);

      expectEventAnalysisError(error, code);
      expect(error.message).toBe(EVENT_ANALYSIS_ERROR_MESSAGES[code]);
    }
  });

  it.each([
    [
      "AbortError",
      Object.assign(new Error(PRIVATE_ERROR_TEXT), {
        name: "AbortError",
        cause: new Error(PRIVACY_SENTINELS.token),
      }),
    ],
    [
      "ABORT_ERR",
      Object.assign(new Error(PRIVATE_ERROR_TEXT), {
        code: "ABORT_ERR",
        cause: new Error(PRIVACY_SENTINELS.token),
      }),
    ],
    [
      "LLM_CANCELLED",
      Object.assign(new Error(PRIVATE_ERROR_TEXT), {
        code: "LLM_CANCELLED",
        cause: new Error(PRIVACY_SENTINELS.token),
      }),
    ],
  ])("ABORT safely recognizes %s", async (_name, failure) => {
    expect(isEventAnalysisAbort(failure)).toBe(true);
    const typed = analyzeEvents(() => Promise.reject(failure));
    const error = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        undefined,
      ),
    );

    expectEventAnalysisError(error, "aborted");
    expect(typed).toHaveBeenCalledTimes(1);
  });

  it("ERROR_SAFETY maps a non-cancel Prompt/model failure to llm_failed", async () => {
    const failure = Object.assign(new Error(PRIVATE_ERROR_TEXT), {
      name: "PromptConfigurationError",
      cause: new Error(PRIVACY_SENTINELS.token),
    });
    const typed = analyzeEvents(() => Promise.reject(failure));
    const error = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        undefined,
      ),
    );

    expectEventAnalysisError(error, "llm_failed");
    expect(typed).toHaveBeenCalledTimes(1);
  });
});

describe("callEventAnalysis", () => {
  it("P03_CALL / SIGNAL calls analyzeEvents exactly once with the original inputs and signal", async () => {
    const signal = new AbortController().signal;
    const typed = analyzeEvents(async () => EMPTY_RESPONSE);

    await expect(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        signal,
      ),
    ).resolves.toBe(EMPTY_RESPONSE);

    expect(typed).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledWith(TASK_DATA, REFERENCES, { signal });
  });

  it("ABORT pre-abort performs zero analyzeEvents calls", async () => {
    const controller = new AbortController();
    controller.abort();
    const typed = analyzeEvents();
    const error = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        controller.signal,
      ),
    );

    expectEventAnalysisError(error, "aborted");
    expect(typed).not.toHaveBeenCalled();
  });

  it("ABORT during the call maps both signal cancellation and abort-shaped rejection to aborted", async () => {
    const duringSignal = new AbortController();
    const duringSignalCall = analyzeEvents(async () => {
      duringSignal.abort();
      return EMPTY_RESPONSE;
    });
    const duringSignalError = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: duringSignalCall },
        duringSignal.signal,
      ),
    );
    expectEventAnalysisError(duringSignalError, "aborted");
    expect(duringSignalCall).toHaveBeenCalledTimes(1);

    const rejectionSignal = new AbortController();
    const rejectingCall = analyzeEvents(async () => {
      rejectionSignal.abort();
      throw new Error(PRIVATE_ERROR_TEXT);
    });
    const rejectionError = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: rejectingCall },
        rejectionSignal.signal,
      ),
    );
    expectEventAnalysisError(rejectionError, "aborted");
    expect(rejectingCall).toHaveBeenCalledTimes(1);
  });

  it("ABORT after a successful return takes priority before the response escapes", async () => {
    const controller = new AbortController();
    const typed = analyzeEvents(async () => {
      controller.abort();
      return EMPTY_RESPONSE;
    });
    const error = await captureRejection(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        controller.signal,
      ),
    );

    expectEventAnalysisError(error, "aborted");
    expect(typed).toHaveBeenCalledTimes(1);
  });

  it("EVT-05 returns a legal empty results response unchanged", async () => {
    const response: EventAnalysisResponse = { results: [] };
    const typed = analyzeEvents(async () => response);

    await expect(
      callEventAnalysis(
        TASK_DATA,
        REFERENCES,
        { analyzeEvents: typed },
        undefined,
      ),
    ).resolves.toBe(response);
    expect(typed).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledWith(TASK_DATA, REFERENCES, {
      signal: undefined,
    });
  });
});

describe("callEventAnalysis with real D02 typed calls", () => {
  it("PMT-09 / EVT-14 uses only the synthetic P-03 Prompt and task_data without User Context", async () => {
    await withTempDirectory(async (directory) => {
      await writePromptFiles(directory, ["event-analysis.md"]);
      const prompts = new PromptRepository(directory);
      const load = vi.spyOn(prompts, "load");
      const stub = new StubLLM([JSON.stringify(EVENT_ANALYSIS_RESPONSE)]);
      const calls = createTypedLlmCalls({ prompts, completionClient: stub });

      await expect(
        callEventAnalysis(TASK_DATA, REFERENCES, calls, undefined),
      ).resolves.toEqual(EVENT_ANALYSIS_RESPONSE);

      expect(await readdir(directory)).toEqual(["event-analysis.md"]);
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith("event-analysis");
      expect(stub.requests).toHaveLength(1);
      const request = stub.requests[0];
      expect(request?.systemContent).toContain(
        PROMPT_FIXTURES["event-analysis.md"],
      );
      const userPayload = parseObject(request?.userContent ?? "");
      expect(Object.keys(userPayload)).toEqual(["task_data"]);
      expect(userPayload).not.toHaveProperty("user_context");
      expect(userPayload.task_data).toEqual(TASK_DATA);

      const taskData = userPayload.task_data as Record<string, unknown>;
      expect(Object.keys(taskData)).toEqual(["content", "candidates"]);
      expect(Object.keys(taskData.content as object).sort()).toEqual([
        "author",
        "body",
        "completeness",
        "published_at",
        "summary",
        "title",
      ]);
      const [firstCandidate] = taskData.candidates as Array<
        Record<string, unknown>
      >;
      expect(Object.keys(firstCandidate ?? {}).sort()).toEqual([
        "description",
        "discovered_at",
        "entity_name",
        "id",
        "occurred_at",
        "scope",
        "subject",
        "title",
        "updates",
      ]);
      expect(
        Object.keys((firstCandidate?.updates as Array<object>)[0] ?? {}).sort(),
      ).toEqual([
        "description",
        "discovered_at",
        "event_id",
        "id",
        "occurred_at",
        "title",
      ]);

      for (const forbidden of [
        PRIVACY_SENTINELS.raw,
        PRIVACY_SENTINELS.topic,
        PRIVACY_SENTINELS.history,
        PRIVACY_SENTINELS.token,
        PRIVACY_SENTINELS.prompt,
        PRIVACY_SENTINELS.model,
        PRIVACY_SENTINELS.sql,
        "user_context",
        "search_terms",
        "raw_data",
      ]) {
        expect(request?.userContent).not.toContain(forbidden);
      }
    });
  });

  it.each(p03ErrorCases())(
    "EVT-15 / PMT-14/15 maps real D02 $name rejection to llm_failed after one call",
    async ({ output }) => {
      await withTempDirectory(async (directory) => {
        await writePromptFiles(directory, ["event-analysis.md"]);
        const prompts = new PromptRepository(directory);
        const stub = new StubLLM([output]);
        const calls = createTypedLlmCalls({ prompts, completionClient: stub });
        const error = await captureRejection(
          callEventAnalysis(TASK_DATA, REFERENCES, calls, undefined),
        );

        expectEventAnalysisError(error, "llm_failed");
        expect(stub.requests).toHaveLength(1);
      });
    },
  );
});
