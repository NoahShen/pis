import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { summarizeLlmFailure } from "../../src/llm/failure-summary.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import {
  resolveLlmOperationPolicies,
  streamingConfigForOperation,
  waitForRetryDelay,
} from "../../src/llm/operation-policy.js";
import { createStreamingChatCompletionsClient } from "../../src/llm/streaming-chat-completions-client.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";

// @ts-expect-error The executable acceptance harness is plain ESM, matching existing script-test practice.
import * as harness from "../../scripts/event-prompt-compatibility.mjs";

const components = {
  PromptRepository,
  createTypedLlmCalls,
  createStreamingChatCompletionsClient,
  resolveLlmOperationPolicies,
  streamingConfigForOperation,
  waitForRetryDelay,
  summarizeLlmFailure,
};

type Attempt = {
  scenario: string;
  operation: string;
  attempt: number;
  category: string;
  reason: string;
  outputShape: "valid" | "fenced" | "prose" | "schema" | "reference" | null;
  durationMs: number;
  firstByteMs: number | null;
  firstContentMs: number | null;
};

afterEach(() => vi.unstubAllGlobals());

describe("Event Prompt compatibility harness (offline)", () => {
  it.each([
    { argv: [], matches: /Usage/u },
    { argv: ["--self-test", "--output", "/tmp/out"], matches: /Usage/u },
    { argv: ["--env-file", "/tmp/env"], matches: /Usage/u },
    { argv: ["--output", "/tmp/out"], matches: /Usage/u },
    { argv: ["--self-test", "--unknown"], matches: /Usage/u },
    { argv: ["--env-file", "--output", "/tmp/out"], matches: /Missing/u },
    { argv: ["--output"], matches: /Missing/u },
  ])("rejects incomplete or unsafe arguments: $argv", ({ argv, matches }) => {
    expect(() => harness.parseArguments(argv)).toThrow(matches);
  });

  it("accepts only explicit absolute private real-mode paths", () => {
    expect(
      harness.parseArguments([
        "--env-file",
        "/private/llm.env",
        "--output",
        "/private/report.json",
      ]),
    ).toEqual({
      selfTest: false,
      envFile: "/private/llm.env",
      output: "/private/report.json",
    });
    expect(() => harness.validatePrivatePath("report.json")).toThrow(
      /absolute/u,
    );
    expect(() =>
      harness.validatePrivatePath(path.resolve("report.json")),
    ).toThrow(/outside/u);
  });

  it("parses explicit env text without inheriting process configuration", () => {
    expect(
      harness.parseEnvironment(
        "# fixture\nexport PIS_LLM_ENDPOINT=https://example.invalid\nPIS_LLM_API_KEY='PRIVATE_TOKEN'\nPIS_LLM_MODEL=fixture\n",
      ),
    ).toEqual({
      PIS_LLM_ENDPOINT: "https://example.invalid",
      PIS_LLM_API_KEY: "PRIVATE_TOKEN",
      PIS_LLM_MODEL: "fixture",
    });
    expect(() =>
      harness.parseEnvironment("PIS_LLM_MODEL=one\nPIS_LLM_MODEL=two"),
    ).toThrow(/Duplicate/u);
  });

  it.each([
    [JSON.stringify({ clues: [] }), "LLM_CALL_SUCCEEDED", "valid"],
    ['```json\n{"clues":[]}\n```', "LLM_OUTPUT_JSON_INVALID", "fenced"],
    ["Explanation then JSON", "LLM_OUTPUT_JSON_INVALID", "prose"],
    ['{"clues":[{"bad":true}]}', "LLM_OUTPUT_SCHEMA_INVALID", "schema"],
    ["{}", "LLM_OUTPUT_REFERENCE_INVALID", "reference"],
    [undefined, "LLM_NETWORK_ERROR", null],
  ])("classifies only safe output shapes", (content, reason, expected) => {
    expect(harness.classifyOutputShape(content, reason)).toBe(expected);
  });

  it("covers all required synthetic semantic and negative scenarios", () => {
    expect(
      harness.SYNTHETIC_SCENARIOS.map(({ id }: { id: string }) => id),
    ).toEqual([
      "event-fact",
      "new-update",
      "no-increment",
      "cross-language-coreference",
      "company-not-product",
      "empty-no-facts",
      "invalid-reference",
    ]);
    for (const scenarioValue of harness.SYNTHETIC_SCENARIOS) {
      expect(scenarioValue.search.acceptance_scenario).toBe(scenarioValue.id);
      expect(scenarioValue.analysis.content.acceptance_scenario).toBe(
        scenarioValue.id,
      );
      expect(scenarioValue.references.candidateEventIds).toEqual(
        scenarioValue.analysis.candidates.map(({ id }: { id: string }) => id),
      );
    }
  });

  it("self-tests production Prompts and typed streaming calls with safe shapes", async () => {
    const report = await harness.runSelfTest(components);
    expect(report).toMatchObject({
      mode: "self-test",
      modelExecuted: false,
      network: false,
      promptSource: "production-event-prompts",
    });
    const attempts = report.attempts as Attempt[];
    // Seven scenarios run both operations (14 initial attempts). Four
    // recoverable first-attempt failures plus the invalid reference retry once.
    expect(attempts).toHaveLength(19);
    const scenarioOperations = attempts.map(
      ({ scenario, operation }) => `${scenario}:${operation}`,
    );
    expect(new Set(scenarioOperations).size).toBe(14);
    for (const scenarioValue of harness.SYNTHETIC_SCENARIOS) {
      for (const operation of ["event-search", "event-analysis"]) {
        const operationAttempts = attempts.filter(
          (attempt) =>
            attempt.scenario === scenarioValue.id &&
            attempt.operation === operation,
        );
        expect(operationAttempts.length).toBeGreaterThanOrEqual(1);
        expect(operationAttempts.length).toBeLessThanOrEqual(2);
        const expectedFailure =
          scenarioValue.id === "invalid-reference" &&
          operation === "event-analysis";
        expect(operationAttempts.at(-1)?.category).toBe(
          expectedFailure ? "output_validation" : "success",
        );
      }
    }
    const expectedSearchAttempts: Record<
      string,
      Array<{ outputShape: Attempt["outputShape"]; category: string }>
    > = {
      "event-fact": [
        { outputShape: "fenced", category: "output_validation" },
        { outputShape: "valid", category: "success" },
      ],
      "new-update": [
        { outputShape: "schema", category: "output_validation" },
        { outputShape: "valid", category: "success" },
      ],
      "no-increment": [
        { outputShape: null, category: "response_protocol" },
        { outputShape: "valid", category: "success" },
      ],
      "cross-language-coreference": [
        { outputShape: "valid", category: "success" },
      ],
      "company-not-product": [
        { outputShape: "prose", category: "output_validation" },
        { outputShape: "valid", category: "success" },
      ],
      "empty-no-facts": [{ outputShape: "valid", category: "success" }],
      "invalid-reference": [{ outputShape: "valid", category: "success" }],
    };
    for (const scenarioValue of harness.SYNTHETIC_SCENARIOS) {
      expect(
        attempts
          .filter(
            ({ scenario, operation }) =>
              scenario === scenarioValue.id && operation === "event-search",
          )
          .map(({ outputShape, category }) => ({ outputShape, category })),
      ).toEqual(expectedSearchAttempts[scenarioValue.id]);
      const analysis = attempts.filter(
        ({ scenario, operation }) =>
          scenario === scenarioValue.id && operation === "event-analysis",
      );
      expect(analysis.map(({ outputShape }) => outputShape)).toEqual(
        scenarioValue.id === "invalid-reference"
          ? ["reference", "reference"]
          : ["valid"],
      );
    }
    expect(
      attempts.find(
        ({ scenario, operation, attempt }) =>
          scenario === "no-increment" &&
          operation === "event-search" &&
          attempt === 1,
      )?.reason,
    ).toBe("LLM_RESPONSE_MALFORMED");
    expect(
      attempts.find(
        ({ scenario, operation, attempt }) =>
          scenario === "event-fact" &&
          operation === "event-search" &&
          attempt === 1,
      ),
    ).toMatchObject({
      reason: "LLM_OUTPUT_JSON_INVALID",
      outputShape: "fenced",
    });
    expect(
      attempts.findLast(
        ({ scenario, operation }) =>
          scenario === "invalid-reference" && operation === "event-analysis",
      ),
    ).toMatchObject({
      reason: "LLM_OUTPUT_REFERENCE_INVALID",
      outputShape: "reference",
      attempt: 2,
    });
    for (const attempt of attempts) {
      expect(attempt.durationMs).toEqual(expect.any(Number));
      expect(attempt.firstByteMs).toEqual(expect.any(Number));
      if (attempt.outputShape === null) {
        expect(attempt.firstContentMs).toBeNull();
      } else {
        expect(attempt.firstContentMs).toEqual(expect.any(Number));
      }
      expect(Object.keys(attempt).sort()).toEqual([
        "attempt",
        "category",
        "durationMs",
        "firstByteMs",
        "firstContentMs",
        "operation",
        "outputShape",
        "reason",
        "scenario",
      ]);
    }
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "PRIVATE_TOKEN",
      "synthetic-not-a-secret",
      "synthetic-not-a-model",
      "synthetic.invalid",
      "Orion trial completed",
      "task_data",
      "```",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("writes safe reports and raw SSE mode 600 without real network", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pis-event-prompt-report-test-"),
    );
    const output = path.join(directory, "report.json");
    const rawSentinel = "PRIVATE_RAW_SENTINEL";
    const fetchStub = vi.fn(async () => {
      const response = harness.SYNTHETIC_SCENARIOS[0];
      const value =
        Math.floor(fetchStub.mock.calls.length % 2) === 1
          ? { clues: [] }
          : { results: [] };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n: ${rawSentinel}\n\n`,
        { status: 200 },
      );
    });
    try {
      const report = await harness.execute(
        components,
        {
          PIS_LLM_ENDPOINT: "https://synthetic.invalid/v1/chat/completions",
          PIS_LLM_API_KEY: "PRIVATE_REAL_PATH_KEY",
          PIS_LLM_MODEL: "PRIVATE_REAL_PATH_MODEL",
          PIS_LLM_EVENT_SEARCH_MAX_ATTEMPTS: "1",
          PIS_LLM_EVENT_ANALYSIS_MAX_ATTEMPTS: "1",
        },
        output,
        fetchStub,
        "self-test",
      );
      expect(fetchStub).toHaveBeenCalledTimes(14);
      expect(report.summary).toMatchObject({ count: 14, succeeded: 14 });
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect((await stat(`${output}.raw.jsonl`)).mode & 0o777).toBe(0o600);
      expect(await readFile(`${output}.raw.jsonl`, "utf8")).toContain(
        rawSentinel,
      );
      const serialized = JSON.stringify(report);
      for (const forbidden of [
        rawSentinel,
        "PRIVATE_REAL_PATH_KEY",
        "PRIVATE_REAL_PATH_MODEL",
        "synthetic.invalid",
        "P-02",
        "task_data",
      ])
        expect(serialized).not.toContain(forbidden);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await expect(stat(output)).rejects.toThrow();
  });
});
