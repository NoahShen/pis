import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import type {
  EventAnalysisDependencies,
  EventAnalysisLogMetadata,
  EventAnalysisLogger,
  EventAnalysisResult,
} from "../../src/event-analysis/contracts.js";
import {
  EventAnalysisError,
  EVENT_ANALYSIS_ERROR_MESSAGES,
  isEventAnalysisAbort,
} from "../../src/event-analysis/event-analysis-errors.js";
import { logEventAnalysisSafely } from "../../src/event-analysis/event-analysis-logger.js";
import { createEventAnalysis } from "../../src/event-analysis/index.js";
import { SqliteEventRepository } from "../../src/event-analysis/event-repository.js";
import { withTransaction } from "../../src/database/transaction.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type {
  EventSearchErrorCode,
  EventSearchResult,
  EventSearchService,
} from "../../src/event-search/contracts.js";
import { EventSearchError } from "../../src/event-search/event-search-errors.js";
import type { TypedLlmCalls } from "../../src/llm/llm-calls.js";
import type {
  EventAnalysisResult as EventAnalysisDecision,
  EventAnalysisResponse,
} from "../../src/llm/response-validators.js";
import {
  countEventAnalysisRows,
  eventAnalysisFixtureIds,
  eventAnalysisFixtureRows,
  insertEventAnalysisContent,
  insertStoredEvent,
  snapshotEventAnalysisRows,
} from "../fixtures/event-analysis.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import {
  createSyntheticContent,
  PRIVACY_SENTINELS,
} from "../fixtures/event-search.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const FIXED_TIME = new Date("2026-11-19T01:30:00.000Z");

type AnalyzeEvents = Pick<TypedLlmCalls, "analyzeEvents">["analyzeEvents"];
type Search = EventSearchService["search"];
type NewEventDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_EVENT" }
>;
type NewUpdateDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_UPDATE" }
>;

interface ServiceHarness {
  readonly database: Database.Database;
  readonly dependencies: EventAnalysisDependencies;
  readonly search: ReturnType<typeof vi.fn<Search>>;
  readonly getById: ReturnType<
    typeof vi.fn<() => ReturnType<typeof createSyntheticContent> | null>
  >;
  readonly analyzeEvents: ReturnType<typeof vi.fn<AnalyzeEvents>>;
  readonly logger: CapturedAnalysisLogger;
  readonly events: string[];
  readonly transactionCalls: { value: number };
  readonly before: ReturnType<typeof snapshotEventAnalysisRows>;
  close(): void;
}

class CapturedAnalysisLogger implements EventAnalysisLogger {
  readonly entries: EventAnalysisLogMetadata[] = [];
  failure: "throw" | "reject" | undefined;

  log(metadata: EventAnalysisLogMetadata): void | PromiseLike<void> {
    this.entries.push({ ...metadata });

    if (this.failure === "throw") {
      throw new Error(PRIVACY_SENTINELS.token);
    }
    if (this.failure === "reject") {
      return Promise.reject(new Error(PRIVACY_SENTINELS.token));
    }
  }
}

function response(
  results: readonly EventAnalysisDecision[],
): EventAnalysisResponse {
  return { results: [...results] };
}

function newEvent(overrides: Partial<NewEventDecision> = {}): NewEventDecision {
  return {
    action: "NEW_EVENT",
    title: "Created Event",
    entity: { name: "Created Entity" },
    subject: "Created Subject",
    scope: "Created Scope",
    description: "Created Description",
    occurred_at: null,
    confirmed_aliases: [],
    ...overrides,
  };
}

function newUpdate(
  overrides: Partial<NewUpdateDecision> = {},
): NewUpdateDecision {
  return {
    action: "NEW_UPDATE",
    event_id: eventAnalysisFixtureIds.event,
    title: "Created Update",
    description: "Created Update Description",
    occurred_at: null,
    confirmed_aliases: [],
    ...overrides,
  };
}

function candidate() {
  return {
    id: eventAnalysisFixtureIds.event,
    title: eventAnalysisFixtureRows.event.title,
    entity_name: eventAnalysisFixtureRows.event.entity_name,
    subject: eventAnalysisFixtureRows.event.subject,
    scope: eventAnalysisFixtureRows.event.scope,
    description: eventAnalysisFixtureRows.event.description,
    occurred_at: eventAnalysisFixtureRows.event.occurred_at,
    discovered_at: eventAnalysisFixtureRows.event.discovered_at,
    updates: [],
  };
}

function createHarness(): ServiceHarness {
  const rawDatabase = new Database(":memory:");
  initializeDatabase(rawDatabase);
  insertEventAnalysisContent(rawDatabase, PRIVACY_SENTINELS.contentId);
  insertStoredEvent(rawDatabase);
  const transactionCalls = { value: 0 };
  const events: string[] = [];
  const database = new Proxy(rawDatabase, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (operation: () => unknown) => {
          if (!target.inTransaction) {
            transactionCalls.value += 1;
            events.push("persist");
          }
          return target.transaction(operation);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const content = createSyntheticContent();
  const getById = vi.fn(() => {
    events.push("content");
    return content;
  });
  const search = vi.fn<Search>(async () => {
    events.push("search");
    return { candidates: [], reason: "no_candidates" };
  });
  const analyzeEvents = vi.fn<AnalyzeEvents>(async () => {
    events.push("analyze");
    return response([newEvent()]);
  });
  const logger = new CapturedAnalysisLogger();
  const eventRepository = new SqliteEventRepository(database);
  const dependencies: EventAnalysisDependencies = {
    database,
    contentRepository: { getById },
    eventSearch: { search },
    typedLlmCalls: { analyzeEvents },
    eventRepository,
    clock: new FakeClock(FIXED_TIME),
    idGenerator: new SequenceIdGenerator([
      "event-service-created",
      "event-update-service-created",
    ]),
    logger,
  };

  return {
    database,
    dependencies,
    search,
    getById,
    analyzeEvents,
    logger,
    events,
    transactionCalls,
    before: snapshotEventAnalysisRows(rawDatabase),
    close() {
      if (rawDatabase.open) {
        rawDatabase.close();
      }
    },
  };
}

async function withHarness<T>(
  callback: (harness: ServiceHarness) => T | Promise<T>,
): Promise<T> {
  const harness = createHarness();
  try {
    return await callback(harness);
  } finally {
    harness.close();
  }
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected event analysis to fail");
}

function expectError(
  error: unknown,
  code: keyof typeof EVENT_ANALYSIS_ERROR_MESSAGES,
): void {
  expect(error).toBeInstanceOf(EventAnalysisError);
  expect(error).toMatchObject({
    name: "EventAnalysisError",
    code,
    message: EVENT_ANALYSIS_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  for (const sentinel of Object.values(PRIVACY_SENTINELS)) {
    expect(String(error)).not.toContain(sentinel);
  }
}

function inconsistentSearchResults(): readonly [string, unknown][] {
  const existing = candidate();
  return [
    ["missing reason/empty", { candidates: [] }],
    ["missing reason/nonempty", { candidates: [existing] }],
    ["candidates/empty", { candidates: [], reason: "candidates" }],
    [
      "no_candidates/nonempty",
      { candidates: [existing], reason: "no_candidates" },
    ],
    [
      "missing_content/nonempty",
      { candidates: [existing], reason: "missing_content" },
    ],
    ["empty_clues/nonempty", { candidates: [existing], reason: "empty_clues" }],
    ["unknown reason", { candidates: [], reason: "unknown" }],
  ];
}

function overrideEventRepository(
  harness: ServiceHarness,
  overrides: Partial<EventAnalysisDependencies["eventRepository"]>,
): EventAnalysisDependencies["eventRepository"] {
  return new Proxy(harness.dependencies.eventRepository, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property as keyof typeof overrides];
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("event analysis service", () => {
  it.each([
    ["EVT-21", { candidates: [], reason: "empty_clues" }],
    ["MISSING_CONTENT", { candidates: [], reason: "missing_content" }],
  ] satisfies readonly (readonly [string, EventSearchResult])[])(
    "%s stops after D08 without Content, P-03, or writes",
    async (_case, result) => {
      await withHarness(async (harness) => {
        harness.search.mockResolvedValue(result);
        const service = createEventAnalysis(harness.dependencies);

        await expect(
          service.analyze(PRIVACY_SENTINELS.contentId),
        ).resolves.toEqual({
          new_targets: [],
        });

        expect(harness.search).toHaveBeenCalledTimes(1);
        expect(harness.search).toHaveBeenCalledWith(
          PRIVACY_SENTINELS.contentId,
          {
            signal: undefined,
          },
        );
        expect(harness.getById).not.toHaveBeenCalled();
        expect(harness.analyzeEvents).not.toHaveBeenCalled();
        expect(harness.transactionCalls.value).toBe(0);
        expect(snapshotEventAnalysisRows(harness.database)).toEqual(
          harness.before,
        );
        expect(harness.logger.entries).toContainEqual(
          expect.objectContaining({ reason: result.reason, stage: "search" }),
        );
      });
    },
  );

  it.each(inconsistentSearchResults())(
    "REASON_CONSISTENCY rejects %s without a second search or any downstream call",
    async (_case, result) => {
      await withHarness(async (harness) => {
        harness.search.mockResolvedValue(result as EventSearchResult);
        const error = await captureRejection(
          createEventAnalysis(harness.dependencies).analyze(
            PRIVACY_SENTINELS.contentId,
          ),
        );

        expectError(error, "event_analysis_failed");
        expect(harness.search).toHaveBeenCalledTimes(1);
        expect(harness.getById).not.toHaveBeenCalled();
        expect(harness.analyzeEvents).not.toHaveBeenCalled();
        expect(harness.transactionCalls.value).toBe(0);
        expect(snapshotEventAnalysisRows(harness.database)).toEqual(
          harness.before,
        );
      });
    },
  );

  it("EVT-22 / CALL_ORDER uses no_candidates once, reads current Content once, and persists a NEW_EVENT target", async () => {
    await withHarness(async (harness) => {
      const service = createEventAnalysis(harness.dependencies);
      const result = await service.analyze(PRIVACY_SENTINELS.contentId);

      expect(result).toStrictEqual({
        new_targets: [
          { target_type: "EVENT", target_id: "event-service-created" },
        ],
      } satisfies EventAnalysisResult);
      expect(Object.keys(result)).toEqual(["new_targets"]);
      expect(Object.keys(result.new_targets[0] ?? {}).sort()).toEqual([
        "target_id",
        "target_type",
      ]);
      expect(harness.events).toEqual([
        "search",
        "content",
        "analyze",
        "persist",
      ]);
      expect(harness.search).toHaveBeenCalledTimes(1);
      expect(harness.getById).toHaveBeenCalledTimes(1);
      expect(harness.analyzeEvents).toHaveBeenCalledTimes(1);
      expect(harness.analyzeEvents).toHaveBeenCalledWith(
        {
          content: {
            title: "Synthetic Content Title",
            body: `Synthetic Content Body ${PRIVACY_SENTINELS.body}`,
            summary: "Synthetic Content Summary",
            author: "Synthetic Author",
            published_at: "2026-11-18T09:30:00.000+08:00",
            completeness: "PARTIAL",
          },
          candidates: [],
        },
        { candidateEventIds: [], eventIdByUpdateId: {} },
        { signal: undefined },
      );
      expect(harness.transactionCalls.value).toBe(1);
      expect(harness.database.inTransaction).toBe(false);
      expect(countEventAnalysisRows(harness.database, "events")).toBe(2);
      expect(countEventAnalysisRows(harness.database, "event_updates")).toBe(0);
      expect(
        countEventAnalysisRows(harness.database, "event_content_links"),
      ).toBe(1);
      expect(countEventAnalysisRows(harness.database, "event_search")).toBe(1);
      expect(harness.logger.entries).toContainEqual({
        contentId: PRIVACY_SENTINELS.contentId,
        candidateCount: 0,
        stage: "search",
        reason: "no_candidates",
      });
      expect(harness.logger.entries).toContainEqual({
        contentId: PRIVACY_SENTINELS.contentId,
        candidateCount: 0,
        resultCount: 1,
        stage: "analyze",
      });
      expect(harness.logger.entries).toContainEqual({
        contentId: PRIVACY_SENTINELS.contentId,
        newTargetCount: 1,
        stage: "persist",
      });
      for (const entry of harness.logger.entries) {
        expect(
          Object.keys(entry).every((key) =>
            [
              "contentId",
              "candidateCount",
              "resultCount",
              "newTargetCount",
              "stage",
              "reason",
            ].includes(key),
          ),
        ).toBe(true);
        expect(JSON.stringify(entry)).not.toContain("event-service-created");
        for (const sentinel of [
          PRIVACY_SENTINELS.raw,
          PRIVACY_SENTINELS.topic,
          PRIVACY_SENTINELS.history,
          PRIVACY_SENTINELS.token,
          PRIVACY_SENTINELS.prompt,
          PRIVACY_SENTINELS.model,
          PRIVACY_SENTINELS.sql,
          PRIVACY_SENTINELS.body,
          PRIVACY_SENTINELS.background,
        ]) {
          expect(JSON.stringify(entry)).not.toContain(sentinel);
        }
      }
    });
  });

  it("EVT-05 accepts P-03 results=[] as success with no transaction or business write", async () => {
    await withHarness(async (harness) => {
      harness.search.mockResolvedValue({
        candidates: [candidate()],
        reason: "candidates",
      });
      harness.analyzeEvents.mockResolvedValue(response([]));

      await expect(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
        ),
      ).resolves.toEqual({ new_targets: [] });

      expect(harness.search).toHaveBeenCalledTimes(1);
      expect(harness.getById).toHaveBeenCalledTimes(1);
      expect(harness.analyzeEvents).toHaveBeenCalledTimes(1);
      expect(harness.transactionCalls.value).toBe(0);
      expect(snapshotEventAnalysisRows(harness.database)).toEqual(
        harness.before,
      );
    });
  });

  it("ERROR_MAP preserves or maps every D08 error code and unknown failures without P-03", async () => {
    const cases: readonly {
      readonly code: EventSearchErrorCode | "unknown";
      readonly expected: keyof typeof EVENT_ANALYSIS_ERROR_MESSAGES;
    }[] = [
      { code: "invalid_input", expected: "invalid_input" },
      { code: "aborted", expected: "aborted" },
      { code: "llm_failed", expected: "llm_failed" },
      { code: "event_search_failed", expected: "event_analysis_failed" },
      { code: "unknown", expected: "event_analysis_failed" },
    ];

    for (const entry of cases) {
      await withHarness(async (harness) => {
        harness.search.mockRejectedValue(
          entry.code === "unknown"
            ? new Error(
                `${PRIVACY_SENTINELS.model} ${PRIVACY_SENTINELS.prompt}`,
              )
            : new EventSearchError(entry.code),
        );
        const error = await captureRejection(
          createEventAnalysis(harness.dependencies).analyze(
            PRIVACY_SENTINELS.contentId,
          ),
        );

        expectError(error, entry.expected);
        expect(harness.search).toHaveBeenCalledTimes(1);
        expect(harness.getById).not.toHaveBeenCalled();
        expect(harness.analyzeEvents).not.toHaveBeenCalled();
        expect(harness.transactionCalls.value).toBe(0);
      });
    }
  });

  it("ERROR_MAP maps Content missing/failure, P-03 failure, and persistence/FTS failure safely", async () => {
    await withHarness(async (harness) => {
      harness.search.mockResolvedValue({
        candidates: [],
        reason: "no_candidates",
      });
      harness.getById.mockReturnValueOnce(null);
      let error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
        ),
      );
      expectError(error, "event_analysis_failed");
      expect(harness.analyzeEvents).not.toHaveBeenCalled();

      harness.getById.mockImplementationOnce(() => {
        throw new Error(PRIVACY_SENTINELS.sql);
      });
      error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
        ),
      );
      expectError(error, "event_analysis_failed");

      harness.analyzeEvents.mockRejectedValueOnce(
        new Error(`${PRIVACY_SENTINELS.model} ${PRIVACY_SENTINELS.token}`),
      );
      error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
        ),
      );
      expectError(error, "llm_failed");

      const writeFailure = new Error(PRIVACY_SENTINELS.sql);
      const failingWriteRepository = overrideEventRepository(harness, {
        insertEvent() {
          throw writeFailure;
        },
      });
      error = await captureRejection(
        createEventAnalysis({
          ...harness.dependencies,
          eventRepository: failingWriteRepository,
        }).analyze(PRIVACY_SENTINELS.contentId),
      );
      expectError(error, "event_analysis_failed");
      expect(harness.database.inTransaction).toBe(false);

      const failingReadbackRepository = overrideEventRepository(harness, {
        getEventSearchText() {
          return null;
        },
      });
      error = await captureRejection(
        createEventAnalysis({
          ...harness.dependencies,
          eventRepository: failingReadbackRepository,
        }).analyze(PRIVACY_SENTINELS.contentId),
      );
      expectError(error, "event_analysis_failed");
      expect(harness.database.inTransaction).toBe(false);
    });
  });

  it("ERROR_MAP gives an already-aborted signal priority over unknown D08 errors", async () => {
    await withHarness(async (harness) => {
      const controller = new AbortController();
      harness.search.mockImplementationOnce(async () => {
        controller.abort();
        throw new Error(PRIVACY_SENTINELS.model);
      });
      const error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
          { signal: controller.signal },
        ),
      );

      expectError(error, "aborted");
      expect(harness.search).toHaveBeenCalledTimes(1);
      expect(harness.transactionCalls.value).toBe(0);
    });
  });

  it("LOGGER runtime-whitelists fields and swallows throw/reject without changing success", async () => {
    await withHarness(async (harness) => {
      const hostileMetadata = {
        contentId: PRIVACY_SENTINELS.contentId,
        candidateCount: 2,
        resultCount: 1,
        newTargetCount: 1,
        stage: "analyze",
        reason: "candidates",
        eventId: eventAnalysisFixtureIds.event,
        alias: "PRIVATE_ALIAS_SENTINEL",
        body: PRIVACY_SENTINELS.body,
        prompt: PRIVACY_SENTINELS.prompt,
        token: PRIVACY_SENTINELS.token,
      } as EventAnalysisDependencies["logger"] extends {
        log(metadata: infer M): unknown;
      }
        ? M
        : never;
      logEventAnalysisSafely(harness.logger, hostileMetadata);
      expect(Object.keys(harness.logger.entries[0] ?? {}).sort()).toEqual([
        "candidateCount",
        "contentId",
        "newTargetCount",
        "reason",
        "resultCount",
        "stage",
      ]);
      expect(JSON.stringify(harness.logger.entries[0])).not.toContain(
        "PRIVATE_ALIAS_SENTINEL",
      );

      for (const failure of ["throw", "reject"] as const) {
        harness.logger.failure = failure;
        const result = await createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
        );
        expect(result.new_targets).toHaveLength(1);
        expect(result.new_targets[0]?.target_type).toBe("EVENT");
      }
    });
  });

  it("PUBLIC_SHAPE exposes only factory and error at runtime", async () => {
    const module = await import("../../src/event-analysis/index.js");
    expect(Object.keys(module).sort()).toEqual([
      "EventAnalysisError",
      "createEventAnalysis",
    ]);
  });

  it("ABORT rejects invalid input before D08 and pre-abort before all dependencies", async () => {
    await withHarness(async (harness) => {
      const invalidError = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze("   "),
      );
      expectError(invalidError, "invalid_input");
      expect(harness.search).not.toHaveBeenCalled();

      const controller = new AbortController();
      controller.abort();
      const abortError = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
          { signal: controller.signal },
        ),
      );
      expectError(abortError, "aborted");
      expect(harness.search).not.toHaveBeenCalled();
      expect(harness.getById).not.toHaveBeenCalled();
      expect(harness.analyzeEvents).not.toHaveBeenCalled();
      expect(harness.transactionCalls.value).toBe(0);
    });
  });

  it("ABORT after D08, Content, or P-03 return prevents persistence and preserves cancellation priority", async () => {
    await withHarness(async (harness) => {
      const afterSearch = new AbortController();
      harness.search.mockImplementationOnce(async () => {
        afterSearch.abort();
        return { candidates: [candidate()], reason: "candidates" };
      });
      let error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
          { signal: afterSearch.signal },
        ),
      );
      expectError(error, "aborted");
      expect(harness.getById).not.toHaveBeenCalled();
      expect(harness.analyzeEvents).not.toHaveBeenCalled();

      const afterContent = new AbortController();
      harness.search.mockResolvedValueOnce({
        candidates: [candidate()],
        reason: "candidates",
      });
      harness.getById.mockImplementationOnce(() => {
        afterContent.abort();
        return createSyntheticContent();
      });
      error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
          { signal: afterContent.signal },
        ),
      );
      expectError(error, "aborted");
      expect(harness.analyzeEvents).not.toHaveBeenCalled();

      const afterAnalyze = new AbortController();
      harness.search.mockResolvedValueOnce({
        candidates: [candidate()],
        reason: "candidates",
      });
      harness.analyzeEvents.mockImplementationOnce(async () => {
        afterAnalyze.abort();
        return response([newUpdate()]);
      });
      error = await captureRejection(
        createEventAnalysis(harness.dependencies).analyze(
          PRIVACY_SENTINELS.contentId,
          { signal: afterAnalyze.signal },
        ),
      );
      expectError(error, "aborted");
      expect(harness.transactionCalls.value).toBe(0);
    });
  });

  it("ABORT recognizes all three abort shapes through the shared public error helper", () => {
    for (const failure of [
      Object.assign(new Error(PRIVACY_SENTINELS.model), {
        name: "AbortError",
      }),
      Object.assign(new Error(PRIVACY_SENTINELS.model), {
        code: "ABORT_ERR",
      }),
      Object.assign(new Error(PRIVACY_SENTINELS.model), {
        code: "LLM_CANCELLED",
      }),
    ]) {
      expect(isEventAnalysisAbort(failure)).toBe(true);
    }
  });

  it("persistence uses the injected repository, clock, ID generator, and one synchronous transaction", async () => {
    await withHarness(async (harness) => {
      harness.search.mockResolvedValue({
        candidates: [candidate()],
        reason: "candidates",
      });
      harness.analyzeEvents.mockResolvedValue(response([newUpdate()]));
      const result = await createEventAnalysis(harness.dependencies).analyze(
        PRIVACY_SENTINELS.contentId,
      );

      expect(result.new_targets).toEqual([
        {
          target_type: "EVENT_UPDATE",
          target_id: "event-service-created",
        },
      ]);
      expect(harness.transactionCalls.value).toBe(1);
      expect(harness.database.inTransaction).toBe(false);
      expect(
        harness.database
          .prepare("SELECT discovered_at FROM events WHERE id = ?")
          .get("event-service-created"),
      ).toBeUndefined();
      expect(
        harness.database.prepare("SELECT id FROM event_updates").get(),
      ).toEqual({
        id: "event-service-created",
      });
      const writeWithinTransaction = vi.fn();
      withTransaction(harness.database, () => {
        writeWithinTransaction(harness.database.inTransaction);
      });
      expect(writeWithinTransaction).toHaveBeenCalledWith(true);
      expect(harness.database.inTransaction).toBe(false);
    });
  });
});
