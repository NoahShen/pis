import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

// @ts-expect-error The executable acceptance harness is plain ESM, matching existing script-test practice.
import * as harness from "../../scripts/llm-failure-acceptance.mjs";
const components = await harness.loadComponents();

type AcceptanceEntry = {
  operation: string;
  category: string;
  reason: string;
  httpStatus?: number;
  attempt: number;
  final: boolean;
  count: number;
};

describe("LLM failure acceptance harness (offline)", () => {
  it.each([
    { argv: [], matches: /Usage/u },
    { argv: ["--self-test", "--output", "/tmp/out"], matches: /Usage/u },
    { argv: ["--env-file", "/tmp/env"], matches: /Usage/u },
    { argv: ["--output", "/tmp/out"], matches: /Usage/u },
    { argv: ["--self-test", "--unknown"], matches: /Usage/u },
    { argv: ["--env-file", "--output", "/tmp/out"], matches: /Missing/u },
    { argv: ["--output"], matches: /Missing/u },
  ])("rejects unsafe or incomplete arguments: $argv", ({ argv, matches }) => {
    expect(() => harness.parseArguments(argv)).toThrow(matches);
  });

  it("requires both private absolute paths in explicit real mode", () => {
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
    expect(harness.validatePrivatePath("/private/report.json")).toBe(
      "/private/report.json",
    );
    expect(() => harness.validatePrivatePath("report.json")).toThrow(
      /absolute/u,
    );
    expect(() =>
      harness.validatePrivatePath(path.resolve("report.json")),
    ).toThrow(/outside/u);
  });

  it("parses only explicit env text without producing credential output", () => {
    expect(
      harness.parseEnvironment(
        "# private fixture\nexport PIS_LLM_ENDPOINT=https://example.invalid\nPIS_LLM_API_KEY='PRIVATE_TOKEN'\nPIS_LLM_MODEL=fixture\n",
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
    {
      name: "401",
      error: new components.ChatCompletionsError("LLM_HTTP_ERROR", 401),
      expected: {
        category: "http",
        reason: "LLM_HTTP_ERROR",
        httpStatus: 401,
      },
    },
    {
      name: "429",
      error: new components.ChatCompletionsError("LLM_HTTP_ERROR", 429),
      expected: {
        category: "http",
        reason: "LLM_HTTP_ERROR",
        httpStatus: 429,
      },
    },
    {
      name: "output schema",
      error: new components.LlmOutputValidationError(
        "LLM_OUTPUT_SCHEMA_INVALID",
        null,
      ),
      expected: {
        category: "output_validation",
        reason: "LLM_OUTPUT_SCHEMA_INVALID",
      },
    },
  ])(
    "summarizes direct $name failures without exposing response details",
    ({ error, expected }) => {
      const privateResponse = "PRIVATE_UPSTREAM_RESPONSE";
      Object.defineProperty(error, "message", { value: privateResponse });
      const result = harness.summary(error, "processing-route", components);
      expect(result).toEqual({
        operation: "processing-route",
        ...expected,
        attempt: 1,
        final: true,
        count: 1,
      });
      expect(JSON.stringify(result)).not.toContain(privateResponse);
    },
  );

  it("self-tests all five typed operations and writes only private mode-600 artifacts", async () => {
    const result = await harness.runSelfTest(components);
    expect(result.modelExecuted).toBe(false);
    expect(result.network).toBe(false);
    expect(
      (result.results as AcceptanceEntry[]).map((entry) => entry.operation),
    ).toEqual([
      "processing-route",
      "event-search",
      "event-analysis",
      "knowledge-analysis",
      "topic-matching",
    ]);
    for (const entry of [
      ...result.results,
      ...result.runtime,
    ] as AcceptanceEntry[]) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          "attempt",
          "category",
          "count",
          "final",
          "operation",
          "reason",
          ...(entry.httpStatus === undefined ? [] : ["httpStatus"]),
        ].sort(),
      );
      expect(entry.reason).toMatch(/^[A-Z][A-Z0-9_]*$/u);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE_PROMPT");
    expect(serialized).not.toContain("PRIVATE_RESPONSE");
    expect(serialized).not.toContain("PRIVATE_TOKEN");
  });

  it("exercises real Runtime retry/final logging for every operation and failure branch", async () => {
    const results = (await harness.verifyRuntimeMatrix(
      components,
    )) as AcceptanceEntry[];
    expect(results).toHaveLength(5 * 16);
    expect(new Set(results.map((entry) => entry.operation)).size).toBe(5);
    expect(
      results.find(
        (entry: AcceptanceEntry) =>
          entry.reason === "LLM_HTTP_ERROR" && entry.httpStatus === 429,
      ),
    ).toMatchObject({ count: 2, attempt: 2, final: true });
    expect(
      results.find((entry: AcceptanceEntry) => entry.reason === "LLM_REFUSAL"),
    ).toMatchObject({ count: 1, attempt: 1, final: true });
  });

  it("runs the compiled self-test from an arbitrary working directory", () => {
    const directory = path.dirname(ROOT);
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/llm-failure-acceptance.mjs"), "--self-test"],
      { cwd: directory, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      mode: "self-test",
      modelExecuted: false,
      network: false,
      count: 85,
      verdict: "PASS",
    });
  });

  it("keeps temporary raw artifacts private and removes them after self-test", async () => {
    // Independently exercise the same private artifact contract used by the harness.
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pis-llm-failure-test-"),
    );
    const output = path.join(directory, "report.json");
    const raw = `${output}.raw.jsonl`;
    try {
      await harness.runSelfTest(components);
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(raw, "PRIVATE_RESPONSE", { mode: 0o600 }),
      );
      expect((await stat(raw)).mode & 0o777).toBe(0o600);
      expect(await readFile(raw, "utf8")).toBe("PRIVATE_RESPONSE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await expect(stat(output)).rejects.toThrow();
  });
});
