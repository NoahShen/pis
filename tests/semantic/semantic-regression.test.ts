import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseLlmResponse } from "../../src/llm/response-validators.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
// @ts-expect-error The executable regression harness is plain ESM, matching existing script-test practice.
import * as semanticHarness from "../../scripts/semantic-regression.mjs";
// @ts-expect-error Fixed JavaScript fixtures are outside the production TypeScript graph.
import * as semanticFixtures from "../../scripts/semantic-regression-fixtures.mjs";

const {
  executeSemanticCases,
  parseArguments,
  parseEnvironment,
  runSelfTest,
  safeError,
  validatePrivatePath,
} = semanticHarness;
const { SEMANTIC_CASES, SYNTHETIC_USER_CONTEXT } = semanticFixtures;

const caseById = (id: string) =>
  SEMANTIC_CASES.find((item: { id: string }) => item.id === id);

describe("D16 semantic regression offline harness", () => {
  it("parses only explicit self-test or private env/output arguments", () => {
    expect(parseArguments(["--self-test"])).toEqual({
      selfTest: true,
      envFile: undefined,
      output: undefined,
    });
    expect(
      parseArguments([
        "--env-file",
        "/private/tmp/credentials",
        "--output",
        "/private/tmp/report",
      ]),
    ).toMatchObject({ selfTest: false });
    for (const args of [
      [],
      ["--env-file"],
      ["--output", "--self-test"],
      ["--self-test", "--output", "/tmp/x"],
      ["--env-file", "/tmp/x"],
    ])
      expect(() => parseArguments(args)).toThrow();
  });

  it("parses existing llm.env fields without exposing values", () => {
    expect(
      parseEnvironment(
        "PIS_LLM_ENDPOINT=https://example.invalid/v1\nPIS_LLM_API_KEY='secret value'\nexport PIS_LLM_MODEL=fixed-model\n",
      ),
    ).toEqual({
      PIS_LLM_ENDPOINT: "https://example.invalid/v1",
      PIS_LLM_API_KEY: "secret value",
      PIS_LLM_MODEL: "fixed-model",
    });
    expect(() =>
      parseEnvironment("PIS_LLM_API_KEY=one\nPIS_LLM_API_KEY=two"),
    ).toThrow("Duplicate");
    expect(() => parseEnvironment("not an assignment")).toThrow("line 1");
  });

  it("requires absolute paths outside the repository", () => {
    expect(validatePrivatePath("/private/tmp/report.json")).toBe(
      path.resolve("/private/tmp/report.json"),
    );
    for (const value of [
      "relative.json",
      path.resolve("report.json"),
      path.resolve(process.cwd(), "package.json"),
    ])
      expect(() => validatePrivatePath(value)).toThrow();
  });

  it("redacts arbitrary errors and preserves only allowlisted safe codes", () => {
    const secret = "never-print-this-secret";
    expect(JSON.stringify(safeError(new Error(secret)))).not.toContain(secret);
    expect(
      safeError(
        Object.assign(new Error(secret), {
          category: "output_validation",
          code: "LLM_OUTPUT_REFERENCE_INVALID",
        }),
      ),
    ).toEqual({
      category: "output_validation",
      code: "LLM_OUTPUT_REFERENCE_INVALID",
    });
  });

  it("self-test traverses real PromptRepository/typed calls for 36 bounded offline calls", async () => {
    const outcome = await runSelfTest({
      createTypedLlmCalls,
      PromptRepository,
    });
    expect(outcome.callsAttempted).toBe(36);
    expect(
      outcome.results.every(
        (result: { verdict: string }) => result.verdict === "PASS",
      ),
    ).toBe(true);
    expect(SYNTHETIC_USER_CONTEXT).toContain("fabricated");
  });

  it("PMT-06b has an explicit education scope and an unrelated incidental word only", () => {
    const item = caseById("PMT-06b");
    expect(item.taskData.topics).toHaveLength(1);
    expect(item.taskData.topics[0].description).toContain(
      "after-school services",
    );
    expect(item.taskData.target.description).toContain("Go scheduler");
    expect(item.taskData.target.description).not.toContain("after-school");
    expect(item.judge({ matched_topic_ids: [] })).toBe(true);
    expect(item.judge({ matched_topic_ids: ["T-EDU"] })).toBe(false);
  });

  it("uses valid candidate timestamps and all required semantic cases", () => {
    expect(
      new Date(
        SEMANTIC_CASES[7].taskData.candidates[0].discovered_at,
      ).toISOString(),
    ).toBe("2026-11-01T00:00:00.000Z");
    for (const id of [
      "PMT-01a",
      "PMT-02a",
      "PMT-03a",
      "PMT-04a",
      "PMT-05a",
      "PMT-06b",
      "PMT-11a",
      "EVT-19",
      "EVT-20",
      "KNO-07",
      "KNO-09",
      "KNO-10a",
    ])
      expect(caseById(id)).toBeDefined();
    expect(
      SEMANTIC_CASES.filter((item: { repeat: number }) => item.repeat === 2)
        .length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("rejects illegal candidate references through the real parser", () => {
    expect(() =>
      parseLlmResponse(
        "event-analysis",
        JSON.stringify({
          results: [
            {
              action: "NEW_UPDATE",
              event_id: "NOT-A-CANDIDATE",
              title: "x",
              description: "x",
              confirmed_aliases: [],
            },
          ],
        }),
        { candidateEventIds: ["E-GPT"], eventIdByUpdateId: {} },
      ),
    ).toThrow(
      expect.objectContaining({ code: "LLM_OUTPUT_REFERENCE_INVALID" }),
    );
  });

  it("records failures safely without turning them into semantic passes", async () => {
    const item = caseById("PMT-01a");
    const raw: unknown[] = [];
    const outcome = await executeSemanticCases({
      calls: {
        routeProcessing: async () => {
          throw Object.assign(new Error("private endpoint response"), {
            code: "LLM_HTTP_ERROR",
            category: "http",
          });
        },
      },
      testCases: [item],
      onRaw: async (entry: unknown) => raw.push(entry),
    });
    expect(outcome.results[0]).toMatchObject({
      verdict: "ERROR",
      error: { code: "LLM_HTTP_ERROR" },
    });
    expect(raw).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain("private endpoint response");
  });
});
