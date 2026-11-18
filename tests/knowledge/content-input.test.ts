import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createTypedLlmCalls,
  type JsonObject,
} from "../../src/llm/llm-calls.js";
import { loadKnowledgeTaskData } from "../../src/knowledge/content-input.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import type {
  ContentRecord,
  ContentRepository,
} from "../../src/processing/content-repository.js";
import { KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE } from "../fixtures/llm-responses.js";
import { StubLLM } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT_ID_SENTINEL = "content-id-sentinel";
const RAW_DATA_SENTINEL = "raw-data-sentinel";
const HTML_SENTINEL = "<article>html-sentinel</article>";
const TOPIC_SENTINEL = "topic-sentinel";
const HISTORY_KNOWLEDGE_SENTINEL = "history-knowledge-sentinel";
const URL_SENTINEL = "https://url-sentinel.example.test/article";
const CREATED_AT_SENTINEL = "2026-11-18T10:00:00.000+08:00";

type ContentRecordWithForbiddenData = ContentRecord & {
  readonly raw_data: string;
  readonly html: string;
  readonly topics: readonly string[];
  readonly history_knowledge: readonly string[];
};

function createContent(
  overrides: Partial<ContentRecord> = {},
): ContentRecordWithForbiddenData {
  return {
    id: CONTENT_ID_SENTINEL,
    title: "Synthetic knowledge title",
    url: URL_SENTINEL,
    author: "Synthetic Author",
    published_at: "2026-11-18T09:30:00.000+08:00",
    created_at: CREATED_AT_SENTINEL,
    body: "Synthetic knowledge body",
    summary: "Synthetic knowledge summary",
    language: null,
    completeness: "FULL",
    raw_data: RAW_DATA_SENTINEL,
    html: HTML_SENTINEL,
    topics: [TOPIC_SENTINEL],
    history_knowledge: [HISTORY_KNOWLEDGE_SENTINEL],
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
  expect(parsed).toEqual(expect.any(Object));
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

function expectObject(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

describe("knowledge content input", () => {
  it("KNO-06 / TASK_DATA projects exactly the six Content fields without forbidden data", () => {
    const content = createContent();
    const { repository, getById } = createReader({ [content.id]: content });

    const taskData = loadKnowledgeTaskData(repository, content.id);

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
    expect(taskData).not.toHaveProperty("content_id");
    expect(taskData).not.toHaveProperty("id");
    expect(taskData).not.toHaveProperty("url");
    expect(taskData).not.toHaveProperty("created_at");
    expect(taskData).not.toHaveProperty("language");

    const serialized = JSON.stringify(taskData);
    for (const forbiddenValue of [
      RAW_DATA_SENTINEL,
      HTML_SENTINEL,
      TOPIC_SENTINEL,
      HISTORY_KNOWLEDGE_SENTINEL,
      URL_SENTINEL,
      CREATED_AT_SENTINEL,
      CONTENT_ID_SENTINEL,
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }

    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith(content.id);
  });

  it("CONTENT_READ returns null for a missing Content without reading another Content", () => {
    const missingId = "missing-content-id";
    const another = createContent({ id: "another-content-id" });
    const { repository, getById } = createReader({
      [missingId]: null,
      [another.id]: another,
    });

    expect(loadKnowledgeTaskData(repository, missingId)).toBeNull();
    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith(missingId);
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

    expect(loadKnowledgeTaskData(repository, full.id)).toEqual({
      title: full.title,
      body: full.body,
      summary: "Full summary",
      author: null,
      published_at: null,
      completeness: "FULL",
    });
    expect(loadKnowledgeTaskData(repository, partial.id)).toEqual({
      title: partial.title,
      body: partial.body,
      summary: null,
      author: "Partial Author",
      published_at: "2026-11-18T08:00:00.000+08:00",
      completeness: "PARTIAL",
    });
  });

  it("is stateless across repeated and different Content calls", () => {
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

    const first = loadKnowledgeTaskData(repository, firstContent.id);
    const repeated = loadKnowledgeTaskData(repository, firstContent.id);
    const second = loadKnowledgeTaskData(repository, secondContent.id);

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

  it("PROMPT_SOURCE sends both synthetic Prompt sources and exact task_data through D02", async () => {
    await withTempDirectory(async (promptsDirectory) => {
      const instructionsSentinel = "knowledge-instructions-sentinel";
      const userContextSentinel = "user-context-sentinel";
      await writeFile(
        path.join(promptsDirectory, "knowledge-analysis.md"),
        `# Synthetic analysis\n${instructionsSentinel}\n`,
        "utf8",
      );
      await writeFile(
        path.join(promptsDirectory, "user-context.md"),
        `# Synthetic context\n${userContextSentinel}\n`,
        "utf8",
      );

      expect((await readdir(promptsDirectory)).sort()).toEqual([
        "knowledge-analysis.md",
        "user-context.md",
      ]);

      const content = createContent();
      const { repository } = createReader({ [content.id]: content });
      const taskData = loadKnowledgeTaskData(repository, content.id);
      if (taskData === null) {
        throw new Error("Expected synthetic Content projection");
      }

      const stub = new StubLLM([
        JSON.stringify(KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE),
      ]);
      const calls = createTypedLlmCalls({
        prompts: new PromptRepository(promptsDirectory),
        completionClient: stub,
      });
      const llmTaskData: JsonObject = taskData;

      await expect(calls.analyzeKnowledge(llmTaskData)).resolves.toEqual(
        KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE,
      );

      expect(stub.requests).toHaveLength(1);
      const request = stub.requests[0];
      expect(request).toBeDefined();
      expect(request?.systemContent).toContain(instructionsSentinel);
      expect(request?.systemContent).not.toContain(userContextSentinel);
      for (const taskDataValue of [
        taskData.title,
        taskData.body,
        taskData.summary,
        taskData.author,
        taskData.published_at,
        taskData.completeness,
      ]) {
        if (taskDataValue !== null) {
          expect(request?.systemContent).not.toContain(taskDataValue);
        }
      }

      const userPayload = parseObject(request?.userContent ?? "");
      expect(Object.keys(userPayload).sort()).toEqual([
        "task_data",
        "user_context",
      ]);
      expect(userPayload.user_context).toBe(
        `# Synthetic context\n${userContextSentinel}\n`,
      );
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
        RAW_DATA_SENTINEL,
        HTML_SENTINEL,
        TOPIC_SENTINEL,
        HISTORY_KNOWLEDGE_SENTINEL,
        CONTENT_ID_SENTINEL,
      ]) {
        expect(serializedTaskData).not.toContain(forbiddenValue);
      }
      expect(request?.userContent).not.toContain(RAW_DATA_SENTINEL);
      expect(request?.userContent).not.toContain(HTML_SENTINEL);
      expect(request?.userContent).not.toContain(TOPIC_SENTINEL);
      expect(request?.userContent).not.toContain(HISTORY_KNOWLEDGE_SENTINEL);
    });
  });

  it("production input module has no LLM, Prompt, database, HTTP, or Topic dependency", async () => {
    const source = await readFile(
      path.join(PROJECT_ROOT, "src/knowledge/content-input.ts"),
      "utf8",
    );

    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:llm|prompt|database|adapters|collection|topics?)/u,
    );
    expect(source).not.toMatch(
      /\bfetch\s*\(|\.(?:prepare|run|insert)\s*\(|analyzeKnowledge\s*\(|matchTopics\s*\(/u,
    );
  });
});
