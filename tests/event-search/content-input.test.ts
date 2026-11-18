import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  loadEventSearchTaskData,
  type EventSearchTaskData,
} from "../../src/event-search/content-input.js";
import { callEventSearch } from "../../src/event-search/event-search-call.js";
import { createTypedLlmCalls } from "../../src/llm/llm-calls.js";
import type { EventSearchResponse } from "../../src/llm/response-validators.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type {
  ContentRecord,
  ContentRepository,
} from "../../src/processing/content-repository.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT_ID_SENTINEL = "content-id-sentinel";
const RAW_PAYLOAD_SENTINEL = "private-raw-payload-sentinel";
const HTML_SENTINEL = "<article>private-html-sentinel</article>";
const TOPIC_SENTINEL = "private-topic-sentinel";
const HISTORY_SENTINEL = "private-history-sentinel";
const TOKEN_SENTINEL = "private-token-sentinel";
const URL_SENTINEL = "https://private-url-sentinel.example.test/article";
const CREATED_AT_SENTINEL = "2026-11-18T10:00:00.000+08:00";

type ExtendedContentRecord = ContentRecord & {
  readonly raw_payload: string;
  readonly html_fragment: string;
  readonly related_topics: readonly string[];
  readonly historical_events: readonly string[];
  readonly private_token: string;
};

const EVENT_SEARCH_RESPONSE: EventSearchResponse = {
  clues: [
    {
      entity_name: "Synthetic Entity",
      subject: "Synthetic Subject",
      search_terms: ["synthetic-term"],
    },
  ],
};

function createContent(
  overrides: Partial<ExtendedContentRecord> = {},
): ExtendedContentRecord {
  return {
    id: CONTENT_ID_SENTINEL,
    title: "Synthetic event search title",
    url: URL_SENTINEL,
    author: "Synthetic Author",
    published_at: "2026-11-18T09:30:00.000+08:00",
    created_at: CREATED_AT_SENTINEL,
    body: "Synthetic event search body",
    summary: "Synthetic event search summary",
    language: null,
    completeness: "FULL",
    raw_payload: RAW_PAYLOAD_SENTINEL,
    html_fragment: HTML_SENTINEL,
    related_topics: [TOPIC_SENTINEL],
    historical_events: [HISTORY_SENTINEL],
    private_token: TOKEN_SENTINEL,
    ...overrides,
  };
}

function createReader(
  contentById: Readonly<Record<string, ContentRecord | null>>,
): {
  readonly repository: Pick<ContentRepository, "getById">;
  readonly getById: ReturnType<typeof vi.fn>;
} {
  const getById = vi.fn(
    (contentId: string): ContentRecord | null => contentById[contentId] ?? null,
  );

  return { repository: { getById }, getById };
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function expectObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object value");
  }
  return value as Record<string, unknown>;
}

describe("event search content input", () => {
  it("TASK_DATA / PRIVACY projects exactly six fields without private Content data", () => {
    const content = createContent();
    const { repository, getById } = createReader({ [content.id]: content });

    const taskData = loadEventSearchTaskData(repository, content.id);

    expect(taskData).toEqual({
      title: content.title,
      body: content.body,
      summary: content.summary,
      author: content.author,
      published_at: content.published_at,
      completeness: content.completeness,
    });
    expect(Object.keys(taskData ?? {}).sort()).toEqual([
      "author",
      "body",
      "completeness",
      "published_at",
      "summary",
      "title",
    ]);
    for (const forbiddenField of [
      "id",
      "url",
      "created_at",
      "language",
      "raw_payload",
      "html_fragment",
      "related_topics",
      "historical_events",
      "private_token",
    ]) {
      expect(taskData).not.toHaveProperty(forbiddenField);
    }

    const serialized = JSON.stringify(taskData);
    for (const forbiddenValue of [
      CONTENT_ID_SENTINEL,
      URL_SENTINEL,
      CREATED_AT_SENTINEL,
      RAW_PAYLOAD_SENTINEL,
      HTML_SENTINEL,
      TOPIC_SENTINEL,
      HISTORY_SENTINEL,
      TOKEN_SENTINEL,
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }

    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith(content.id);
  });

  it("CONTENT_READ reads only the current ID exactly once and returns null when missing", () => {
    const missingId = "missing-content-id";
    const another = createContent({ id: "another-content-id" });
    const { repository, getById } = createReader({
      [missingId]: null,
      [another.id]: another,
    });

    expect(loadEventSearchTaskData(repository, missingId)).toBeNull();
    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith(missingId);
  });

  it("CONTENT_READ propagates a projection read failure unchanged for upper-layer mapping", () => {
    const readFailure = new Error("Synthetic Content read failure");
    const getById = vi.fn(() => {
      throw readFailure;
    });

    expect(() =>
      loadEventSearchTaskData({ getById }, "failing-content-id"),
    ).toThrow(readFailure);
    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith("failing-content-id");
  });

  it("VALUE_SHAPES preserves nullable values and both completeness states", () => {
    const full = createContent({
      id: "full-content-id",
      summary: "Full summary",
      author: null,
      published_at: null,
      completeness: "FULL",
    });
    const partial = createContent({
      id: "partial-content-id",
      summary: null,
      author: "Partial Author",
      published_at: "2026-11-18T08:00:00.000+08:00",
      completeness: "PARTIAL",
    });
    const { repository } = createReader({
      [full.id]: full,
      [partial.id]: partial,
    });

    expect(loadEventSearchTaskData(repository, full.id)).toEqual({
      title: full.title,
      body: full.body,
      summary: "Full summary",
      author: null,
      published_at: null,
      completeness: "FULL",
    });
    expect(loadEventSearchTaskData(repository, partial.id)).toEqual({
      title: partial.title,
      body: partial.body,
      summary: null,
      author: "Partial Author",
      published_at: "2026-11-18T08:00:00.000+08:00",
      completeness: "PARTIAL",
    });
  });

  it("is stateless across repeated and different Content projections", () => {
    const firstContent = createContent({
      id: "first-content-id",
      body: "First body",
    });
    const secondContent = createContent({
      id: "second-content-id",
      body: "Second body",
      completeness: "PARTIAL",
    });
    const { repository, getById } = createReader({
      [firstContent.id]: firstContent,
      [secondContent.id]: secondContent,
    });

    const first = loadEventSearchTaskData(repository, firstContent.id);
    const repeated = loadEventSearchTaskData(repository, firstContent.id);
    const second = loadEventSearchTaskData(repository, secondContent.id);

    expect(repeated).toEqual(first);
    expect(repeated).not.toBe(first);
    expect(second).not.toEqual(first);
    expect(second).toMatchObject({
      title: secondContent.title,
      body: "Second body",
      completeness: "PARTIAL",
    });
    expect(getById.mock.calls).toEqual([
      [firstContent.id],
      [firstContent.id],
      [secondContent.id],
    ]);
  });

  it("PMT-09 uses only a synthetic event-search Prompt and sends task_data without user_context", async () => {
    await withTempDirectory(async (promptsDirectory) => {
      const instructionsSentinel = "event-search-instructions-sentinel";
      await writeFile(
        path.join(promptsDirectory, "event-search.md"),
        `# Synthetic event search\n${instructionsSentinel}\n`,
        "utf8",
      );

      expect(await readdir(promptsDirectory)).toEqual(["event-search.md"]);

      const content = createContent();
      const { repository } = createReader({ [content.id]: content });
      const taskData = loadEventSearchTaskData(repository, content.id);
      if (taskData === null) {
        throw new Error("Expected a synthetic Content projection");
      }

      const stub = new StubLLM([JSON.stringify(EVENT_SEARCH_RESPONSE)]);
      const calls = createTypedLlmCalls({
        prompts: new PromptRepository(promptsDirectory),
        completionClient: stub,
      });
      await expect(
        callEventSearch(taskData, calls, undefined),
      ).resolves.toEqual(EVENT_SEARCH_RESPONSE);

      expect(stub.requests).toHaveLength(1);
      const request = stub.requests[0];
      expect(request).toBeDefined();
      expect(request?.systemContent).toContain(instructionsSentinel);
      expect(request?.systemContent).not.toContain(content.body);

      const userPayload = parseObject(request?.userContent ?? "");
      expect(Object.keys(userPayload)).toEqual(["task_data"]);
      expect(userPayload).not.toHaveProperty("user_context");
      expect(request?.userContent).not.toContain(instructionsSentinel);

      const projectedTaskData = expectObject(userPayload.task_data);
      expect(projectedTaskData).toEqual(taskData);
      expect(Object.keys(projectedTaskData).sort()).toEqual([
        "author",
        "body",
        "completeness",
        "published_at",
        "summary",
        "title",
      ]);

      const serializedTaskData = JSON.stringify(projectedTaskData);
      for (const forbiddenValue of [
        CONTENT_ID_SENTINEL,
        RAW_PAYLOAD_SENTINEL,
        HTML_SENTINEL,
        TOPIC_SENTINEL,
        HISTORY_SENTINEL,
        TOKEN_SENTINEL,
      ]) {
        expect(request?.userContent).not.toContain(forbiddenValue);
        expect(serializedTaskData).not.toContain(forbiddenValue);
      }
    });
  });

  it("STRUCTURE keeps production input modules inside the read-only P-02 boundary", async () => {
    const productionPaths = [
      "src/event-search/content-input.ts",
      "src/event-search/event-search-errors.ts",
      "src/event-search/event-search-call.ts",
    ];

    for (const relativePath of productionPaths) {
      const source = await readFile(
        path.join(PROJECT_ROOT, relativePath),
        "utf8",
      );

      expect(source).not.toMatch(
        /better-sqlite3|database\/|adapters\/|collection\/|knowledge\/|topics?\b|historical|raw_data|event_candidate|candidate-ranking|candidate-context/iu,
      );
      expect(source).not.toMatch(
        /\bfetch\s*\(|\.(?:prepare|exec|run|insert|update|delete)\s*\(/iu,
      );
      expect(source).not.toMatch(
        /\b(?:routeProcessing|analyzeEvents|analyzeKnowledge|matchTopics)\s*\(/u,
      );
    }
  });
});
