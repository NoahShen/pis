import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatCompletionsError } from "../../src/llm/chat-completions-client.js";
import { summarizeLlmFailure } from "../../src/llm/failure-summary.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import {
  resolveLlmOperationPolicies,
  streamingConfigForOperation,
  waitForRetryDelay,
} from "../../src/llm/operation-policy.js";
import { createStreamingChatCompletionsClient } from "../../src/llm/streaming-chat-completions-client.js";

// @ts-expect-error The executable acceptance harness is plain ESM, matching existing script-test practice.
import * as harness from "../../scripts/llm-streaming-acceptance.mjs";

const components = {
  ChatCompletionsError,
  createTypedLlmCalls,
  createStreamingChatCompletionsClient,
  resolveLlmOperationPolicies,
  streamingConfigForOperation,
  waitForRetryDelay,
  summarizeLlmFailure,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

type SafeResult = {
  check?: string;
  operation: string;
  category: string;
  reason: string;
  outcome: string;
  attempts: number;
  durationMs: number;
  firstByteMs: number | null;
  firstContentMs: number | null;
  streamStates: string[];
};

describe("LLM streaming acceptance harness (offline)", () => {
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

  it("requires absolute paths outside the repository for real mode", () => {
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

  it("parses explicit env text without emitting credentials", () => {
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

  it("self-tests five real typed-call paths, SSE, timeout, cancellation, and retry", async () => {
    const report = await harness.runSelfTest(components);
    expect(report).toMatchObject({
      mode: "self-test",
      modelExecuted: false,
      network: false,
    });
    const operations = report.operations.slice(0, 5) as SafeResult[];
    expect(operations.map((entry) => entry.operation)).toEqual([
      "processing-route",
      "event-search",
      "event-analysis",
      "knowledge-analysis",
      "topic-matching",
    ]);
    for (const result of operations) {
      expect(result).toMatchObject({
        outcome: "success",
        category: "success",
        reason: "LLM_CALL_SUCCEEDED",
        attempts: 1,
      });
      expect(result.firstByteMs).toEqual(expect.any(Number));
      expect(result.firstContentMs).toEqual(expect.any(Number));
      expect(result.streamStates).toContain("stream_done");
    }
    const checks = new Map(
      (report.operations as SafeResult[]).map((result) => [
        result.check,
        result,
      ]),
    );
    expect(checks.get("retry")).toMatchObject({
      outcome: "success",
      attempts: 2,
    });
    expect(checks.get("first_byte-timeout")?.reason).toBe(
      "LLM_FIRST_BYTE_TIMEOUT",
    );
    expect(checks.get("idle-timeout")?.reason).toBe("LLM_STREAM_IDLE_TIMEOUT");
    expect(checks.get("total-timeout")?.reason).toBe("LLM_TIMEOUT_LOCAL");
    expect(checks.get("cancellation")?.reason).toBe("LLM_CANCELLED");
    expect(report.summary).toMatchObject({
      count: 10,
      succeeded: 6,
      failed: 4,
    });
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "PRIVATE_ABORT_DETAIL",
      "PRIVATE_TOKEN",
      "synthetic-not-a-secret",
      "synthetic-not-a-model",
      "synthetic.invalid",
      "A synthetic engineering note",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("writes reports mode 600 and stores only the safe allowlist", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pis-llm-streaming-report-test-"),
    );
    const output = path.join(directory, "report.json");
    const privateSentinel = "PRIVATE_SENTINEL";
    try {
      await harness.writePrivateJson(output, {
        mode: "self-test",
        modelExecuted: false,
        network: false,
        operations: [],
        summary: { count: 0 },
      });
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      const report = JSON.parse(await readFile(output, "utf8"));
      expect(report).not.toHaveProperty("raw");
      expect(JSON.stringify(report)).not.toContain(privateSentinel);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await expect(stat(output)).rejects.toThrow();
  });

  it("keeps real-mode raw SSE private while emitting only safe reports", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pis-llm-streaming-real-path-test-"),
    );
    const output = path.join(directory, "report.json");
    const responses = [
      { routes: ["EVENT"] },
      { clues: [] },
      { results: [] },
      { valuable: false },
      { matched_topic_ids: [] },
    ];
    let requestCount = 0;
    const rawSentinel = "PRIVATE_RAW_SSE_SENTINEL";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const payload = JSON.stringify({
          choices: [
            { delta: { content: JSON.stringify(responses[requestCount++]) } },
          ],
        });
        return new Response(
          `data: ${payload}\n\ndata: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n: ${rawSentinel}\n\n`,
          { status: 200 },
        );
      }),
    );
    try {
      const report = await harness.executeReal(
        components,
        {
          PIS_LLM_ENDPOINT: "https://synthetic.invalid/v1/chat/completions",
          PIS_LLM_API_KEY: "PRIVATE_REAL_PATH_KEY",
          PIS_LLM_MODEL: "PRIVATE_REAL_PATH_MODEL",
        },
        output,
      );
      expect(requestCount).toBe(5);
      expect(report.operations).toHaveLength(5);
      for (const result of report.operations as SafeResult[]) {
        expect(result).toMatchObject({ attempts: 1, outcome: "success" });
        expect(result.firstByteMs).toEqual(expect.any(Number));
        expect(result.firstContentMs).toEqual(expect.any(Number));
      }
      const serialized = JSON.stringify(report);
      for (const forbidden of [
        rawSentinel,
        "PRIVATE_REAL_PATH_KEY",
        "PRIVATE_REAL_PATH_MODEL",
        "synthetic.invalid",
      ])
        expect(serialized).not.toContain(forbidden);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect((await stat(`${output}.raw.sse.jsonl`)).mode & 0o777).toBe(0o600);
      expect(await readFile(`${output}.raw.sse.jsonl`, "utf8")).toContain(
        rawSentinel,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps synthetic DTO reference data aligned with all real typed-call contracts", () => {
    expect(Object.keys(harness.SYNTHETIC_TASKS)).toEqual([
      "processing-route",
      "event-search",
      "event-analysis",
      "knowledge-analysis",
      "topic-matching",
    ]);
    expect(harness.SYNTHETIC_TASKS["event-analysis"].content_id).toBe(
      "synthetic-content",
    );
    expect(harness.SYNTHETIC_TASKS["topic-matching"].enabled_topics).toEqual([
      { topic_id: "synthetic-topic", name: "Synthetic engineering" },
    ]);
  });
});
