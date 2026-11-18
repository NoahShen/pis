import { describe, expect, it, vi } from "vitest";

import type { JsonObject, TypedLlmCalls } from "../../src/llm/llm-calls.js";
import { parseLlmResponse } from "../../src/llm/response-validators.js";
import {
  routeCommittedContent,
  type CommittedContentSnapshot,
  type ProcessingRoute,
  type RouteProcessingCall,
} from "../../src/processing/content-router.js";
import {
  ProcessingError,
  PROCESSING_ERROR_CODES,
  type ProcessingErrorCode,
} from "../../src/processing/processing-errors.js";
import type {
  ProcessingLogMetadata,
  ProcessingLogger,
} from "../../src/processing/processing-logger.js";

class CapturedProcessingLogger implements ProcessingLogger {
  readonly entries: ProcessingLogMetadata[] = [];

  log(metadata: ProcessingLogMetadata): void {
    this.entries.push(metadata);
  }
}

function createContent(
  overrides: Partial<CommittedContentSnapshot> = {},
): CommittedContentSnapshot {
  return {
    id: "content-processing-1",
    title: "Synthetic processing title",
    body: "Synthetic processing body",
    summary: "Synthetic processing summary",
    completeness: "FULL",
    url: "https://processing.example.test/item",
    author: "Synthetic Author",
    published_at: "2026-11-18T08:00:00.000+08:00",
    ...overrides,
  };
}

function createTypedCall(
  implementation: RouteProcessingCall["routeProcessing"],
): RouteProcessingCall {
  return { routeProcessing: implementation };
}

async function expectProcessingError(
  operation: Promise<unknown>,
  code: ProcessingErrorCode,
): Promise<ProcessingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    const processingError = error as ProcessingError;
    expect(processingError.code).toBe(code);
    expect(processingError.message).toBe(
      {
        invalid_input: "Invalid processing input",
        aborted: "Processing was aborted",
        processing_failed: "Processing failed",
        llm_failed: "LLM processing failed",
      }[code],
    );
    expect(processingError).not.toHaveProperty("cause");
    return processingError;
  }

  throw new Error("Expected processing to fail");
}

describe("ProcessingError and ProcessingLogger contracts", () => {
  it("defines exactly four stable, safe error codes", () => {
    expect(PROCESSING_ERROR_CODES).toEqual([
      "invalid_input",
      "aborted",
      "processing_failed",
      "llm_failed",
    ]);

    for (const code of PROCESSING_ERROR_CODES) {
      const error = new ProcessingError(code);
      expect(error.name).toBe("ProcessingError");
      expect(error.code).toBe(code);
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("SQL");
      expect(String(error)).not.toContain("Zod");
      expect(String(error)).not.toContain("Prompt");
    }
  });
});

describe("routeCommittedContent", () => {
  it("PRO-07 maps one typed-call failure to llm_failed without retry or committed rollback", async () => {
    const logger = new CapturedProcessingLogger();
    const signal = new AbortController().signal;
    let committed = false;
    let observedCommitted = false;
    const underlyingMessage = "SQL JSON Zod private model output";
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => {
        observedCommitted = committed;
        throw new Error(underlyingMessage);
      },
    );

    committed = true;
    const error = await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        logger,
        signal,
      ),
      "llm_failed",
    );

    expect(observedCommitted).toBe(true);
    expect(routeProcessing).toHaveBeenCalledTimes(1);
    expect(error.message).toBe("LLM processing failed");
    expect(error.message).not.toContain(underlyingMessage);
    expect(error).not.toHaveProperty("cause");
    expect(logger.entries).toEqual([
      {
        contentId: "content-processing-1",
        stage: "route",
        reason: "llm_failed",
      },
    ]);
  });

  it.each([
    ["EVENT", ["EVENT"], 1],
    ["KNOWLEDGE", ["KNOWLEDGE"], 1],
    ["BOTH", ["EVENT", "KNOWLEDGE"], 2],
    ["empty", [], 0],
  ] as const)(
    "PRO-08 accepts fixed %s routing with %i route(s)",
    async (_caseName, returnedRoutes, expectedCount) => {
      const logger = new CapturedProcessingLogger();
      const content = createContent();
      const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
        async () => ({ routes: [...returnedRoutes] }),
      );

      const result = await routeCommittedContent(
        content,
        createTypedCall(routeProcessing),
        logger,
        new AbortController().signal,
      );

      expect(result.routes).toEqual(returnedRoutes);
      expect(result.routes).toHaveLength(expectedCount);
      expect(routeProcessing).toHaveBeenCalledTimes(1);
      expect(logger.entries).toEqual([
        {
          contentId: content.id,
          stage: "route",
          routeCount: expectedCount,
        },
      ]);
    },
  );

  it("PRO-10 deduplicates legal routes in first-seen order", async () => {
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => ({ routes: ["KNOWLEDGE", "EVENT", "KNOWLEDGE"] }),
    );

    const result = await routeCommittedContent(
      createContent(),
      createTypedCall(routeProcessing),
      new CapturedProcessingLogger(),
      new AbortController().signal,
    );

    expect(result.routes).toEqual(["KNOWLEDGE", "EVENT"]);
    expect(routeProcessing).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown enum", { routes: ["EVENT", "UNKNOWN"] }],
    ["extra field", { routes: ["EVENT"], extra: "route-sentinel" }],
  ])("PRO-10 maps D02 %s rejection to llm_failed", async (_caseName, value) => {
    const logger = new CapturedProcessingLogger();
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () =>
        parseLlmResponse("processing-route", JSON.stringify(value), {}),
    );

    const error = await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        logger,
        new AbortController().signal,
      ),
      "llm_failed",
    );

    expect(routeProcessing).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain("UNKNOWN");
    expect(error.message).not.toContain("route-sentinel");
    expect(logger.entries).toEqual([
      {
        contentId: "content-processing-1",
        stage: "route",
        reason: "llm_failed",
      },
    ]);
  });

  it("PRO-12 preserves the PARTIAL summary-backed snapshot", async () => {
    const body = "Only the acquired summary is available";
    const summary = "Only the acquired summary is available";
    const content = createContent({
      body,
      summary,
      completeness: "PARTIAL",
    });
    const logger = new CapturedProcessingLogger();
    let capturedTaskData: JsonObject | undefined;
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async (taskData) => {
        capturedTaskData = taskData;
        return { routes: [] };
      },
    );

    await routeCommittedContent(
      content,
      createTypedCall(routeProcessing),
      logger,
      new AbortController().signal,
    );

    expect(capturedTaskData).toEqual({
      title: "Synthetic processing title",
      body,
      summary,
      completeness: "PARTIAL",
      url: "https://processing.example.test/item",
      author: "Synthetic Author",
      published_at: "2026-11-18T08:00:00.000+08:00",
    });
    expect(Object.keys(capturedTaskData ?? {})).toEqual([
      "title",
      "body",
      "summary",
      "completeness",
      "url",
      "author",
      "published_at",
    ]);
    expect(capturedTaskData?.body).toBe(capturedTaskData?.summary);
    expect(JSON.stringify(logger.entries)).not.toContain(body);
    expect(JSON.stringify(logger.entries)).not.toContain(summary);
  });

  it("excludes private content fields from task data and logs", async () => {
    const privateFields = {
      ...createContent({
        body: "Body sentinel remains allowed for the routing body",
      }),
      raw_data: "RAW_DATA_SENTINEL",
      prompt: "PROMPT_SENTINEL",
      token: "TOKEN_SENTINEL",
    };
    const logger = new CapturedProcessingLogger();
    let serializedTaskData = "";
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async (taskData) => {
        serializedTaskData = JSON.stringify(taskData);
        return { routes: ["EVENT"] };
      },
    );

    await routeCommittedContent(
      privateFields,
      createTypedCall(routeProcessing),
      logger,
      new AbortController().signal,
    );

    expect(serializedTaskData).not.toContain("RAW_DATA_SENTINEL");
    expect(serializedTaskData).not.toContain("PROMPT_SENTINEL");
    expect(serializedTaskData).not.toContain("TOKEN_SENTINEL");
    expect(serializedTaskData).not.toContain("content_id");
    expect(serializedTaskData).not.toContain("content-processing-1");
    expect(JSON.stringify(logger.entries)).not.toContain(
      "Body sentinel remains allowed for the routing body",
    );
    expect(JSON.stringify(logger.entries)).not.toContain(
      "Synthetic processing summary",
    );
  });

  it("does not call the typed route before the committed handoff marker", async () => {
    let committed = false;
    let observedCommitted = false;
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => {
        observedCommitted = committed;
        return { routes: ["EVENT"] };
      },
    );

    committed = true;
    await routeCommittedContent(
      createContent(),
      createTypedCall(routeProcessing),
      new CapturedProcessingLogger(),
      new AbortController().signal,
    );

    expect(observedCommitted).toBe(true);
  });

  it("pre-abort throws aborted without calling the typed route", async () => {
    const controller = new AbortController();
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => ({ routes: ["EVENT"] }),
    );
    controller.abort();

    const error = await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        new CapturedProcessingLogger(),
        controller.signal,
      ),
      "aborted",
    );

    expect(routeProcessing).not.toHaveBeenCalled();
    expect(error.message).toBe("Processing was aborted");
  });

  it("passes the original signal and maps routing AbortError to aborted", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const logger = new CapturedProcessingLogger();
    let observedSignal: AbortSignal | undefined;
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async (_taskData, options) => {
        observedSignal = options?.signal;
        controller.abort();
        throw new DOMException("private cancellation cause", "AbortError");
      },
    );

    const error = await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        logger,
        signal,
      ),
      "aborted",
    );

    expect(observedSignal).toBe(signal);
    expect(routeProcessing).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain("private cancellation cause");
    expect(logger.entries).toEqual([
      {
        contentId: "content-processing-1",
        stage: "route",
        reason: "aborted",
      },
    ]);
  });

  it("recognizes an AbortError even when the signal is not marked aborted", async () => {
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => {
        throw new DOMException("private cancellation cause", "AbortError");
      },
    );

    await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        new CapturedProcessingLogger(),
        new AbortController().signal,
      ),
      "aborted",
    );
  });

  it("maps cancellation observed after the typed call resolves to aborted", async () => {
    const controller = new AbortController();
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async () => {
        controller.abort();
        return { routes: ["EVENT"] };
      },
    );

    await expectProcessingError(
      routeCommittedContent(
        createContent(),
        createTypedCall(routeProcessing),
        new CapturedProcessingLogger(),
        controller.signal,
      ),
      "aborted",
    );
  });

  it("uses a Pick-compatible typed-call stub with only routeProcessing", async () => {
    const routeProcessing = vi.fn<RouteProcessingCall["routeProcessing"]>(
      async (_taskData, options) => {
        expect(options).toBeDefined();
        return { routes: [] };
      },
    );
    const typedLlmCalls: Pick<TypedLlmCalls, "routeProcessing"> = {
      routeProcessing,
    };

    await expect(
      routeCommittedContent(
        createContent(),
        typedLlmCalls,
        new CapturedProcessingLogger(),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ routes: [] });
    expect(Object.keys(typedLlmCalls)).toEqual(["routeProcessing"]);
  });
});
