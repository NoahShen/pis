import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNoneSourceContent } from "../../src/collection/raw-data.js";
import type { SourceItemRecord } from "../../src/collection/source-item-repository.js";
import type {
  ProcessResult,
  ProcessingDependencies,
} from "../../src/processing/contracts.js";
import type {
  ContentDraft,
  ContentRecord,
} from "../../src/processing/content-repository.js";
import {
  ProcessingError,
  type ProcessingErrorCode,
} from "../../src/processing/processing-errors.js";
import { createProcessing } from "../../src/processing/processing.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import {
  CapturedProcessingLogger,
  createProcessingEntry,
  createProcessingRawData,
  createStubTypedLlmCalls,
} from "../fixtures/processing.js";

const openDatabases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const db = new Database(":memory:");
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  while (openDatabases.length > 0) {
    const db = openDatabases.pop();
    if (db?.open === true) {
      db.close();
    }
  }
});

function createSourceItem(
  overrides: Partial<SourceItemRecord> = {},
): SourceItemRecord {
  return {
    id: "source-item-processing-1",
    source_id: "source-processing-1",
    external_id: "external-processing-1",
    url: "https://processing.example.test/item",
    title: "Synthetic Processing Item",
    published_at: "2026-11-18T08:00:00.000+08:00",
    discovered_at: "2026-11-18T08:05:00.000+08:00",
    content_id: null,
    raw_data: JSON.stringify(createProcessingRawData()),
    ...overrides,
  };
}

function createContent(overrides: Partial<ContentRecord> = {}): ContentRecord {
  return {
    id: "existing-processing-content",
    title: "Existing Processing Content",
    url: "https://processing.example.test/existing",
    author: "Synthetic Author",
    published_at: "2026-11-18T07:00:00.000+08:00",
    created_at: "2026-11-18T08:10:00.000+08:00",
    body: "Existing committed body",
    summary: null,
    language: null,
    completeness: "FULL",
    ...overrides,
  };
}

interface ServiceHarness {
  readonly dependencies: ProcessingDependencies;
  readonly getSourceItem: ReturnType<typeof vi.fn>;
  readonly getContent: ReturnType<typeof vi.fn>;
  readonly insertContent: ReturnType<typeof vi.fn>;
  readonly setContentId: ReturnType<typeof vi.fn>;
  readonly routeProcessing: ReturnType<typeof vi.fn>;
  readonly logger: CapturedProcessingLogger;
}

function createServiceHarness(
  sourceItem: SourceItemRecord | null,
  content: ContentRecord | null = null,
  route: ProcessingDependencies["typedLlmCalls"]["routeProcessing"] = async () => ({
    routes: ["EVENT"],
  }),
): ServiceHarness {
  const getSourceItem = vi.fn(() => sourceItem);
  const getContent = vi.fn(() => content);
  const insertContent = vi.fn((draft: ContentDraft) => ({
    id: "inserted-content",
    ...draft,
  }));
  const setContentId = vi.fn((id: string, contentId: string) => {
    if (sourceItem === null) {
      throw new Error("Fixture Source Item is missing");
    }
    return { ...sourceItem, id, content_id: contentId };
  });
  const routeProcessing = vi.fn(route);
  const logger = new CapturedProcessingLogger();
  const dependencies: ProcessingDependencies = {
    database: createDatabase(),
    sourceItemRepository: { getById: getSourceItem, setContentId },
    contentRepository: { getById: getContent, insert: insertContent },
    typedLlmCalls: createStubTypedLlmCalls(routeProcessing),
    clock: new FakeClock(new Date("2026-11-18T09:00:00.000+08:00")),
    logger,
  };

  return {
    dependencies,
    getSourceItem,
    getContent,
    insertContent,
    setContentId,
    routeProcessing,
    logger,
  };
}

async function captureProcessingError(
  operation: Promise<ProcessResult>,
): Promise<ProcessingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    if (error instanceof ProcessingError) {
      return error;
    }
  }

  throw new Error("Expected Processing to fail");
}

function expectSafeError(
  error: ProcessingError,
  code: ProcessingErrorCode,
): void {
  expect(error.code).toBe(code);
  expect(error.message).toBe(
    {
      invalid_input: "Invalid processing input",
      aborted: "Processing was aborted",
      processing_failed: "Processing failed",
      llm_failed: "LLM processing failed",
    }[code],
  );
  expect(error).not.toHaveProperty("cause");
  expect(String(error)).not.toContain("SQLITE_PRIVATE_SENTINEL");
}

describe("createProcessing service contract", () => {
  it.each(["", "   ", "\n\t"])(
    "rejects invalid Source Item ID %j before repository and LLM access",
    async (sourceItemId) => {
      const harness = createServiceHarness(createSourceItem());
      const service = createProcessing(harness.dependencies);

      const error = await captureProcessingError(service.process(sourceItemId));

      expectSafeError(error, "invalid_input");
      expect(harness.getSourceItem).not.toHaveBeenCalled();
      expect(harness.getContent).not.toHaveBeenCalled();
      expect(harness.insertContent).not.toHaveBeenCalled();
      expect(harness.routeProcessing).not.toHaveBeenCalled();
    },
  );

  it("returns the empty result before repository access for a pre-aborted signal", async () => {
    const harness = createServiceHarness(createSourceItem());
    const service = createProcessing(harness.dependencies);
    const controller = new AbortController();
    controller.abort();

    const error = await captureProcessingError(
      service.process("source-item-processing-1", {
        signal: controller.signal,
      }),
    );

    expectSafeError(error, "aborted");
    expect(harness.getSourceItem).not.toHaveBeenCalled();
    expect(harness.getContent).not.toHaveBeenCalled();
    expect(harness.insertContent).not.toHaveBeenCalled();
    expect(harness.routeProcessing).not.toHaveBeenCalled();
  });

  it.each([
    ["missing Source Item", null, null],
    ["null raw_data", createSourceItem({ raw_data: null }), null],
    [
      "NONE content",
      createSourceItem({
        raw_data: JSON.stringify(
          createProcessingRawData(
            {},
            createNoneSourceContent(createProcessingEntry(), "timeout"),
          ),
        ),
      }),
      null,
    ],
  ])(
    "returns the strict empty result with no writes or LLM for %s",
    async (_caseName, sourceItem, content) => {
      const harness = createServiceHarness(sourceItem, content);
      const service = createProcessing(harness.dependencies);

      await expect(
        service.process("source-item-processing-1"),
      ).resolves.toStrictEqual({ content_id: null, routes: [] });
      expect(harness.getSourceItem).toHaveBeenCalledTimes(1);
      expect(harness.getContent).not.toHaveBeenCalled();
      expect(harness.insertContent).not.toHaveBeenCalled();
      expect(harness.setContentId).not.toHaveBeenCalled();
      expect(harness.routeProcessing).not.toHaveBeenCalled();
    },
  );

  it("reuses an existing content_id directly without parsing raw_data or writing", async () => {
    const existing = createContent();
    const harness = createServiceHarness(
      createSourceItem({
        content_id: existing.id,
        raw_data: "not valid JSON and must not be parsed",
      }),
      existing,
      async () => ({ routes: ["KNOWLEDGE", "EVENT"] }),
    );
    const service = createProcessing(harness.dependencies);

    await expect(
      service.process("source-item-processing-1"),
    ).resolves.toStrictEqual({
      content_id: existing.id,
      routes: ["KNOWLEDGE", "EVENT"],
    });
    expect(harness.getContent).toHaveBeenCalledWith(existing.id);
    expect(harness.insertContent).not.toHaveBeenCalled();
    expect(harness.setContentId).not.toHaveBeenCalled();
    expect(harness.routeProcessing).toHaveBeenCalledTimes(1);
  });

  it("maps a dangling content association to safe processing_failed without routing", async () => {
    const harness = createServiceHarness(
      createSourceItem({ content_id: "missing-content" }),
      null,
    );
    const service = createProcessing(harness.dependencies);

    const error = await captureProcessingError(
      service.process("source-item-processing-1"),
    );

    expectSafeError(error, "processing_failed");
    expect(harness.insertContent).not.toHaveBeenCalled();
    expect(harness.setContentId).not.toHaveBeenCalled();
    expect(harness.routeProcessing).not.toHaveBeenCalled();
  });

  it("maps repository failures to processing_failed without retaining private details", async () => {
    const harness = createServiceHarness(createSourceItem());
    harness.getSourceItem.mockImplementationOnce(() => {
      throw new Error("SQLITE_PRIVATE_SENTINEL SQL JSON Zod Prompt");
    });
    const service = createProcessing(harness.dependencies);

    const error = await captureProcessingError(
      service.process("source-item-processing-1"),
    );

    expectSafeError(error, "processing_failed");
    expect(harness.routeProcessing).not.toHaveBeenCalled();
  });

  it("maps a transaction-phase repository failure to processing_failed", async () => {
    const harness = createServiceHarness(createSourceItem());
    harness.getSourceItem
      .mockImplementationOnce(() => createSourceItem())
      .mockImplementationOnce(() => {
        throw new Error("SQLITE_PRIVATE_SENTINEL transaction failure");
      });
    const service = createProcessing(harness.dependencies);

    const error = await captureProcessingError(
      service.process("source-item-processing-1"),
    );

    expectSafeError(error, "processing_failed");
    expect(harness.insertContent).not.toHaveBeenCalled();
    expect(harness.routeProcessing).not.toHaveBeenCalled();
  });

  it("creates independent factories without shared per-call state", async () => {
    const first = createServiceHarness(
      createSourceItem({ content_id: "shared-content" }),
      createContent({ id: "shared-content" }),
      async () => ({ routes: ["EVENT"] }),
    );
    const second = createServiceHarness(
      createSourceItem({ content_id: "shared-content" }),
      createContent({ id: "shared-content" }),
      async () => ({ routes: ["KNOWLEDGE"] }),
    );

    const [firstResult, secondResult] = await Promise.all([
      createProcessing(first.dependencies).process("source-item-processing-1"),
      createProcessing(second.dependencies).process("source-item-processing-1"),
    ]);

    expect(firstResult).toStrictEqual({
      content_id: "shared-content",
      routes: ["EVENT"],
    });
    expect(secondResult).toStrictEqual({
      content_id: "shared-content",
      routes: ["KNOWLEDGE"],
    });
    expect(first.routeProcessing).toHaveBeenCalledTimes(1);
    expect(second.routeProcessing).toHaveBeenCalledTimes(1);
  });
});
