import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import type { EventSearchResponse } from "../../src/llm/response-validators.js";
import type {
  EventCandidateClue,
  EventCandidateHit,
  EventCandidateRepository,
  EventCandidateSearchResult,
} from "../../src/event-search/event-candidate-repository.js";
import {
  createEventSearch,
  EventSearchError,
  type EventSearchDependencies,
  type EventSearchErrorCode,
  type EventSearchLogger,
} from "../../src/event-search/index.js";
import {
  logEventSearchSafely,
  type EventSearchLogMetadata,
} from "../../src/event-search/event-search-logger.js";
import {
  CapturedEventSearchLogger,
  createSyntheticContent,
  PRIVACY_SENTINELS,
} from "../fixtures/event-search.js";

type SearchEvents = EventSearchDependencies["typedLlmCalls"]["searchEvents"];
type CandidateSearch = EventCandidateRepository["search"];
type GetContent = EventSearchDependencies["contentRepository"]["getById"];

const CONTENT_ID = PRIVACY_SENTINELS.contentId;
const DEFAULT_RESPONSE: EventSearchResponse = { clues: [] };
const NORMAL_RESPONSE: EventSearchResponse = {
  clues: [
    {
      entity_name: "Synthetic Entity",
      subject: "Synthetic Subject",
      search_terms: ["synthetic term"],
    },
  ],
};

interface FakeContextDatabaseState {
  readonly database: Database.Database;
  readonly preparedSql: string[];
  readonly updateParameters: readonly (readonly unknown[])[];
  readonly eventReadIds: readonly string[];
}

interface ContextEventRow {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface ContextUpdateRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface ContextDatabaseData {
  readonly events: readonly ContextEventRow[];
  readonly updates?: readonly ContextUpdateRow[];
}

function unusedDatabase(): Database.Database {
  return {} as Database.Database;
}

function hit(
  eventId: string,
  options: {
    readonly discoveredAt?: string;
    readonly clueIndex?: number;
    readonly directEntityHit?: boolean;
    readonly aliasHit?: boolean;
    readonly ftsMatchedTerms?: readonly string[];
  } = {},
): EventCandidateHit {
  return {
    eventId,
    discoveredAt: options.discoveredAt ?? "2026-11-18T08:00:00.000+08:00",
    firstClueIndex: options.clueIndex ?? 0,
    clueEvidence: [
      {
        clueIndex: options.clueIndex ?? 0,
        directEntityHit: options.directEntityHit ?? false,
        aliasHit: options.aliasHit ?? false,
        ftsMatchedTerms: options.ftsMatchedTerms ?? [],
      },
    ],
  };
}

function contextDatabase(data: ContextDatabaseData): FakeContextDatabaseState {
  const preparedSql: string[] = [];
  const updateParameters: (readonly unknown[])[] = [];
  const eventReadIds: string[] = [];

  const database = {
    inTransaction: false,
    prepare(sql: string) {
      preparedSql.push(sql);
      if (sql.includes("FROM events")) {
        return {
          get(eventId: string): ContextEventRow | undefined {
            eventReadIds.push(eventId);
            return data.events.find((event) => event.id === eventId);
          },
        };
      }
      if (sql.includes("FROM event_updates")) {
        return {
          all(eventId: string, limit: number): ContextUpdateRow[] {
            updateParameters.push([eventId, limit]);
            return (data.updates ?? [])
              .filter((update) => update.event_id === eventId)
              .slice(0, limit);
          },
        };
      }
      throw new Error(`unexpected synthetic SQL ${PRIVACY_SENTINELS.sql}`);
    },
    transaction() {
      throw new Error("unexpected transaction");
    },
  } as unknown as Database.Database;

  return { database, preparedSql, updateParameters, eventReadIds };
}

function eventRow(eventId: string): ContextEventRow {
  return {
    id: eventId,
    title: `${eventId} title`,
    entity_name: `${eventId} entity`,
    subject: `${eventId} subject`,
    scope: `${eventId} scope`,
    description: `${eventId} description`,
    occurred_at: null,
    discovered_at: "2026-11-18T08:00:00.000+08:00",
  };
}

function updateRow(eventId: string, id: string): ContextUpdateRow {
  return {
    id,
    event_id: eventId,
    title: `${id} title`,
    description: `${id} description`,
    occurred_at: null,
    discovered_at: "2026-11-18T09:00:00.000+08:00",
  };
}

interface DependencyOverrides {
  readonly database?: Database.Database;
  readonly contentRepository?: EventSearchDependencies["contentRepository"];
  readonly candidateRepository?: EventCandidateRepository;
  readonly typedLlmCalls?: EventSearchDependencies["typedLlmCalls"];
  readonly logger?: EventSearchLogger;
  readonly maxCandidates?: number;
  readonly maxUpdates?: number;
}

function dependencies(
  overrides: DependencyOverrides = {},
): EventSearchDependencies {
  return {
    database: overrides.database ?? unusedDatabase(),
    contentRepository: overrides.contentRepository ?? {
      getById: () => createSyntheticContent(),
    },
    candidateRepository: overrides.candidateRepository ?? {
      search: () => ({ hits: [], ignoredIndexRows: 0 }),
    },
    typedLlmCalls: overrides.typedLlmCalls ?? {
      searchEvents: async () => DEFAULT_RESPONSE,
    },
    logger: overrides.logger ?? new CapturedEventSearchLogger(),
    ...(overrides.maxCandidates === undefined
      ? {}
      : { maxCandidates: overrides.maxCandidates }),
    ...(overrides.maxUpdates === undefined
      ? {}
      : { maxUpdates: overrides.maxUpdates }),
  };
}

function searchEvents(
  implementation: SearchEvents = async () => NORMAL_RESPONSE,
): ReturnType<typeof vi.fn<SearchEvents>> {
  return vi.fn<SearchEvents>(implementation);
}

function candidateRepository(
  implementation: CandidateSearch = () => ({
    hits: [],
    ignoredIndexRows: 0,
  }),
): {
  readonly repository: EventCandidateRepository;
  readonly search: ReturnType<typeof vi.fn<CandidateSearch>>;
} {
  const search = vi.fn<CandidateSearch>(implementation);
  return { repository: { search }, search };
}

function contentReader(
  implementation: GetContent = () => createSyntheticContent(),
): {
  readonly repository: EventSearchDependencies["contentRepository"];
  readonly getById: ReturnType<typeof vi.fn<GetContent>>;
} {
  const getById = vi.fn<GetContent>(implementation);
  return { repository: { getById }, getById };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected event search to fail");
}

function expectEventSearchError(
  error: unknown,
  code: EventSearchErrorCode,
): asserts error is EventSearchError {
  expect(error).toBeInstanceOf(EventSearchError);
  expect(error).toMatchObject({
    name: "EventSearchError",
    code,
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");
  for (const value of Object.values(PRIVACY_SENTINELS)) {
    expect(String(error)).not.toContain(value);
  }
}

function sensitiveError(): Error {
  return new Error(
    `${PRIVACY_SENTINELS.model} ${PRIVACY_SENTINELS.prompt} ${PRIVACY_SENTINELS.sql}`,
    { cause: new Error(PRIVACY_SENTINELS.token) },
  );
}

describe("createEventSearch configuration", () => {
  it.each([
    ["zero", 0],
    ["above maximum", 51],
    ["fraction", 1.5],
    ["non-number", "10"],
  ])("CANDIDATE_LIMIT rejects %s synchronously", (_name, value) => {
    expect(() =>
      createEventSearch(
        dependencies({ maxCandidates: value as unknown as number }),
      ),
    ).toThrowError(
      new RangeError("maxCandidates must be an integer from 1 to 50"),
    );
  });

  it.each([
    ["negative", -1],
    ["above maximum", 101],
    ["fraction", 1.5],
    ["non-number", "10"],
  ])("UPDATE_LIMIT rejects %s synchronously", (_name, value) => {
    expect(() =>
      createEventSearch(
        dependencies({ maxUpdates: value as unknown as number }),
      ),
    ).toThrowError(
      new RangeError("maxUpdates must be an integer from 0 to 100"),
    );
  });

  it("CANDIDATE_LIMIT defaults to 10 and UPDATE_LIMIT defaults to 10", async () => {
    const hits = Array.from({ length: 12 }, (_, index) =>
      hit(`event-${String(index).padStart(2, "0")}`),
    );
    const candidate = candidateRepository(() => ({
      hits,
      ignoredIndexRows: 0,
    }));
    const context = contextDatabase({
      events: hits.map(({ eventId }) => eventRow(eventId)),
      updates: [],
    });

    const result = await createEventSearch(
      dependencies({
        database: context.database,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: candidate.repository,
      }),
    ).search(CONTENT_ID);

    expect(result.candidates).toHaveLength(10);
    expect(context.updateParameters).toHaveLength(10);
    expect(new Set(context.updateParameters.map(([, limit]) => limit))).toEqual(
      new Set([10]),
    );
  });

  it("RUNTIME_EXPORTS exposes only factory and error as runtime values", async () => {
    const module = await import("../../src/event-search/index.js");

    expect(Object.keys(module).sort()).toEqual([
      "EventSearchError",
      "createEventSearch",
    ]);
  });
});

describe("event search service orchestration", () => {
  it.each([
    ["whitespace", "   "],
    ["non-string", 42],
  ])(
    "MISSING/INVALID rejects %s before Content or LLM",
    async (_name, value) => {
      const content = contentReader();
      const typed = searchEvents();
      const candidate = candidateRepository();
      const error = await captureRejection(
        createEventSearch(
          dependencies({
            contentRepository: content.repository,
            typedLlmCalls: { searchEvents: typed },
            candidateRepository: candidate.repository,
          }),
        ).search(value as unknown as string),
      );

      expectEventSearchError(error, "invalid_input");
      expect(content.getById).not.toHaveBeenCalled();
      expect(typed).not.toHaveBeenCalled();
      expect(candidate.search).not.toHaveBeenCalled();
    },
  );

  it("MISSING/ABORT pre-abort returns aborted before Content or LLM", async () => {
    const controller = new AbortController();
    controller.abort();
    const content = contentReader();
    const typed = searchEvents();
    const candidate = candidateRepository();

    const error = await captureRejection(
      createEventSearch(
        dependencies({
          contentRepository: content.repository,
          typedLlmCalls: { searchEvents: typed },
          candidateRepository: candidate.repository,
        }),
      ).search(CONTENT_ID, { signal: controller.signal }),
    );

    expectEventSearchError(error, "aborted");
    expect(content.getById).not.toHaveBeenCalled();
    expect(typed).not.toHaveBeenCalled();
    expect(candidate.search).not.toHaveBeenCalled();
  });

  it("MISSING reads Content once, skips LLM/candidates, and returns empty", async () => {
    const content = contentReader(() => null);
    const typed = searchEvents();
    const candidate = candidateRepository();

    await expect(
      createEventSearch(
        dependencies({
          contentRepository: content.repository,
          typedLlmCalls: { searchEvents: typed },
          candidateRepository: candidate.repository,
        }),
      ).search(CONTENT_ID),
    ).resolves.toEqual({ candidates: [] });

    expect(content.getById).toHaveBeenCalledTimes(1);
    expect(typed).not.toHaveBeenCalled();
    expect(candidate.search).not.toHaveBeenCalled();
  });

  it("EVT-21 calls the LLM exactly once and candidates zero times for empty clues", async () => {
    const content = contentReader();
    const typed = searchEvents(async () => ({ clues: [] }));
    const candidate = candidateRepository();

    await expect(
      createEventSearch(
        dependencies({
          contentRepository: content.repository,
          typedLlmCalls: { searchEvents: typed },
          candidateRepository: candidate.repository,
        }),
      ).search(CONTENT_ID),
    ).resolves.toEqual({ candidates: [] });

    expect(content.getById).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledTimes(1);
    expect(candidate.search).not.toHaveBeenCalled();
  });

  it("EVT-22 / CALL_COUNT calls the LLM and candidate repository once when clues have no matches", async () => {
    const typed = searchEvents();
    const candidate = candidateRepository();

    await expect(
      createEventSearch(
        dependencies({
          typedLlmCalls: { searchEvents: typed },
          candidateRepository: candidate.repository,
        }),
      ).search(CONTENT_ID),
    ).resolves.toEqual({ candidates: [] });

    expect(typed).toHaveBeenCalledTimes(1);
    expect(candidate.search).toHaveBeenCalledTimes(1);
  });

  it("DEDUPE compares only exact clue fields, preserves order, and does not merge subjects", async () => {
    const clues: EventSearchResponse["clues"] = [
      {
        entity_name: "Entity",
        subject: "Subject One",
        search_terms: ["alpha", "beta"],
      },
      {
        entity_name: "Entity",
        subject: "Subject One",
        search_terms: ["alpha", "beta"],
      },
      {
        entity_name: "Entity",
        subject: "Subject Two",
        search_terms: ["alpha", "beta"],
      },
      {
        entity_name: " Entity ",
        subject: "Subject One",
        search_terms: ["alpha", "beta"],
      },
      {
        entity_name: "Entity",
        subject: "Subject One",
        search_terms: ["beta", "alpha"],
      },
      {
        entity_name: "Entity",
        subject: "Subject One",
        search_terms: ["alpha", "beta "],
      },
    ];
    const candidate = candidateRepository();

    await createEventSearch(
      dependencies({
        typedLlmCalls: { searchEvents: searchEvents(async () => ({ clues })) },
        candidateRepository: candidate.repository,
      }),
    ).search(CONTENT_ID);

    expect(candidate.search).toHaveBeenCalledTimes(1);
    expect(candidate.search.mock.calls[0]?.[0]).toEqual([
      clues[0],
      clues[2],
      clues[3],
      clues[4],
      clues[5],
    ]);
  });

  it("RANK/CONTEXT applies maxCandidates before context and passes maxUpdates", async () => {
    const hits = [
      hit("event-b", { directEntityHit: true }),
      hit("event-a", { directEntityHit: true }),
      hit("event-c", { directEntityHit: true }),
    ];
    const candidate = candidateRepository(() => ({
      hits,
      ignoredIndexRows: 0,
    }));
    const context = contextDatabase({
      events: hits.map(({ eventId }) => eventRow(eventId)),
      updates: [
        updateRow("event-a", "update-a-1"),
        updateRow("event-a", "update-a-2"),
      ],
    });

    const result = await createEventSearch(
      dependencies({
        database: context.database,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: candidate.repository,
        maxCandidates: 2,
        maxUpdates: 7,
      }),
    ).search(CONTENT_ID);

    expect(result.candidates.map(({ id }) => id)).toEqual([
      "event-a",
      "event-b",
    ]);
    expect(context.eventReadIds).toEqual(["event-a", "event-b"]);
    expect(context.updateParameters).toEqual([
      ["event-a", 7],
      ["event-b", 7],
    ]);
  });

  it("CONFIG_ISOLATION keeps maxCandidates and maxUpdates independent per instance", async () => {
    const hits = [hit("event-a"), hit("event-b"), hit("event-c")];
    const context = contextDatabase({
      events: hits.map(({ eventId }) => eventRow(eventId)),
      updates: [],
    });
    const firstCandidate = candidateRepository(() => ({
      hits,
      ignoredIndexRows: 0,
    }));
    const secondCandidate = candidateRepository(() => ({
      hits,
      ignoredIndexRows: 0,
    }));
    const first = createEventSearch(
      dependencies({
        database: context.database,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: firstCandidate.repository,
        maxCandidates: 1,
        maxUpdates: 0,
      }),
    );
    const second = createEventSearch(
      dependencies({
        database: context.database,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: secondCandidate.repository,
        maxCandidates: 3,
        maxUpdates: 3,
      }),
    );

    const firstResult = await first.search(CONTENT_ID);
    const firstUpdateParametersAfterCall = [...context.updateParameters];
    const secondResult = await second.search(CONTENT_ID);

    expect(firstResult.candidates.map(({ id }) => id)).toEqual(["event-a"]);
    expect(secondResult.candidates.map(({ id }) => id)).toEqual([
      "event-a",
      "event-b",
      "event-c",
    ]);
    expect(firstUpdateParametersAfterCall).toEqual([]);
    expect(context.updateParameters).toEqual([
      ["event-a", 3],
      ["event-b", 3],
      ["event-c", 3],
    ]);
  });

  it("ERROR maps Content, candidate, and context failures safely", async () => {
    const contentFailure = contentReader(() => {
      throw sensitiveError();
    });
    const contentError = await captureRejection(
      createEventSearch(
        dependencies({ contentRepository: contentFailure.repository }),
      ).search(CONTENT_ID),
    );
    expectEventSearchError(contentError, "event_search_failed");

    const candidateFailure = candidateRepository(() => {
      throw sensitiveError();
    });
    const candidateError = await captureRejection(
      createEventSearch(
        dependencies({
          typedLlmCalls: { searchEvents: searchEvents() },
          candidateRepository: candidateFailure.repository,
        }),
      ).search(CONTENT_ID),
    );
    expectEventSearchError(candidateError, "event_search_failed");

    const failingContext = {
      inTransaction: false,
      prepare() {
        throw sensitiveError();
      },
    } as unknown as Database.Database;
    const contextError = await captureRejection(
      createEventSearch(
        dependencies({
          database: failingContext,
          typedLlmCalls: { searchEvents: searchEvents() },
          candidateRepository: candidateRepository(() => ({
            hits: [hit("event-a")],
            ignoredIndexRows: 0,
          })).repository,
        }),
      ).search(CONTENT_ID),
    );
    expectEventSearchError(contextError, "event_search_failed");
  });

  it.each([
    [
      "Prompt failure",
      Object.assign(new Error(PRIVACY_SENTINELS.prompt), {
        name: "PromptConfigurationError",
      }),
    ],
    [
      "Schema failure",
      Object.assign(new Error(PRIVACY_SENTINELS.model), {
        name: "LlmOutputValidationError",
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      }),
    ],
    ["JSON failure", new SyntaxError(`bad ${PRIVACY_SENTINELS.model}`)],
  ])(
    "ERROR maps %s to llm_failed without candidate calls",
    async (_name, reason) => {
      const typed = searchEvents(() => Promise.reject(reason));
      const candidate = candidateRepository();
      const error = await captureRejection(
        createEventSearch(
          dependencies({
            typedLlmCalls: { searchEvents: typed },
            candidateRepository: candidate.repository,
          }),
        ).search(CONTENT_ID),
      );

      expectEventSearchError(error, "llm_failed");
      expect(typed).toHaveBeenCalledTimes(1);
      expect(candidate.search).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "Content read",
      () => {
        const controller = new AbortController();
        const content = contentReader(() => {
          controller.abort();
          return createSyntheticContent();
        });
        return createEventSearch(
          dependencies({ contentRepository: content.repository }),
        ).search(CONTENT_ID, { signal: controller.signal });
      },
    ],
    [
      "LLM return",
      () => {
        const controller = new AbortController();
        const typed = searchEvents(async () => {
          controller.abort();
          return NORMAL_RESPONSE;
        });
        return createEventSearch(
          dependencies({ typedLlmCalls: { searchEvents: typed } }),
        ).search(CONTENT_ID, { signal: controller.signal });
      },
    ],
    [
      "candidate throw",
      () => {
        const controller = new AbortController();
        const candidate = candidateRepository(() => {
          controller.abort();
          throw sensitiveError();
        });
        return createEventSearch(
          dependencies({
            typedLlmCalls: { searchEvents: searchEvents() },
            candidateRepository: candidate.repository,
          }),
        ).search(CONTENT_ID, { signal: controller.signal });
      },
    ],
  ])("ABORT gives signal priority after %s", async (_name, start) => {
    const error = await captureRejection(start());
    expectEventSearchError(error, "aborted");
  });

  it("LOGGER whitelist rebuilds metadata and drops arbitrary fields/invalid enums", () => {
    const logger = new CapturedEventSearchLogger();
    const metadata = {
      contentId: CONTENT_ID,
      candidateCount: 2,
      clueCount: 1,
      stage: "search",
      reason: "event_search_failed",
      eventId: "private-event-id",
      title: "private-candidate-title",
      text: "private-text",
    } as EventSearchLogMetadata & Record<string, unknown>;

    logEventSearchSafely(logger, metadata);
    logEventSearchSafely(logger, {
      contentId: CONTENT_ID,
      stage: "invalid-stage",
      reason: "invalid-reason",
    } as unknown as EventSearchLogMetadata);

    expect(logger.entries[0]).toEqual({
      contentId: CONTENT_ID,
      candidateCount: 2,
      clueCount: 1,
      stage: "search",
      reason: "event_search_failed",
    });
    expect(Object.keys(logger.entries[0] ?? {}).sort()).toEqual([
      "candidateCount",
      "clueCount",
      "contentId",
      "reason",
      "stage",
    ]);
    expect(logger.entries[1]).toEqual({ contentId: CONTENT_ID });
  });

  it("LOGGER ignored index rows emits only safe search-stage metadata", async () => {
    const logger = new CapturedEventSearchLogger();

    await createEventSearch(
      dependencies({
        logger,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: candidateRepository(() => ({
          hits: [],
          ignoredIndexRows: 2,
        })).repository,
      }),
    ).search(CONTENT_ID);

    const ignoredEntry = logger.entries.find(({ stage }) => stage === "search");
    expect(ignoredEntry).toBeDefined();
    expect(ignoredEntry).not.toHaveProperty("eventId");
    expect(ignoredEntry).not.toHaveProperty("text");
    for (const entry of logger.entries) {
      expect(
        Object.keys(entry).every((key) =>
          [
            "contentId",
            "candidateCount",
            "clueCount",
            "stage",
            "reason",
          ].includes(key),
        ),
      ).toBe(true);
    }
  });

  it.each(["throw", "reject"] as const)(
    "LOGGER %s failure does not change a successful result",
    async (failure) => {
      const logger = new CapturedEventSearchLogger();
      logger.failure = failure;

      await expect(
        createEventSearch(
          dependencies({
            logger,
            typedLlmCalls: { searchEvents: searchEvents() },
            candidateRepository: candidateRepository().repository,
          }),
        ).search(CONTENT_ID),
      ).resolves.toEqual({ candidates: [] });
      await Promise.resolve();
      expect(logger.entries.length).toBeGreaterThan(0);
    },
  );

  it.each(["throw", "reject"] as const)(
    "LOGGER %s failure does not change a business error",
    async (failure) => {
      const logger = new CapturedEventSearchLogger();
      logger.failure = failure;
      const typed = searchEvents(() => Promise.reject(sensitiveError()));
      const error = await captureRejection(
        createEventSearch(
          dependencies({
            logger,
            typedLlmCalls: { searchEvents: typed },
          }),
        ).search(CONTENT_ID),
      );

      expectEventSearchError(error, "llm_failed");
      await Promise.resolve();
      expect(logger.entries.length).toBeGreaterThan(0);
    },
  );

  it("PUBLIC_SHAPE returns only candidates with exact Event/Update fields", async () => {
    const context = contextDatabase({
      events: [eventRow("event-public")],
      updates: [updateRow("event-public", "update-public")],
    });
    const result = await createEventSearch(
      dependencies({
        database: context.database,
        typedLlmCalls: { searchEvents: searchEvents() },
        candidateRepository: candidateRepository(() => ({
          hits: [hit("event-public", { directEntityHit: true })],
          ignoredIndexRows: 0,
        })).repository,
        maxUpdates: 1,
      }),
    ).search(CONTENT_ID);

    expect(Object.keys(result)).toEqual(["candidates"]);
    expect(Object.keys(result.candidates[0] ?? {}).sort()).toEqual([
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
    expect(Object.keys(result.candidates[0]?.updates[0] ?? {}).sort()).toEqual([
      "description",
      "discovered_at",
      "event_id",
      "id",
      "occurred_at",
      "title",
    ]);
    expect(result).not.toHaveProperty("clues");
    expect(result.candidates[0]).not.toHaveProperty("score");
    expect(result.candidates[0]).not.toHaveProperty("source");
    expect(result.candidates[0]).not.toHaveProperty("clues");
  });
});

describe("event search public dependency boundary", () => {
  it("Dependencies contains exactly database/content/candidate/calls/logger and two options", () => {
    expect(
      Object.keys(dependencies({ maxCandidates: 10, maxUpdates: 10 })).sort(),
    ).toEqual([
      "candidateRepository",
      "contentRepository",
      "database",
      "logger",
      "maxCandidates",
      "maxUpdates",
      "typedLlmCalls",
    ]);
  });
});
