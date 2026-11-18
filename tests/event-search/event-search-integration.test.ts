import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import type { EventSearchResponse } from "../../src/llm/response-validators.js";
import {
  createEventSearch,
  EventSearchError,
  type EventSearchDependencies,
} from "../../src/event-search/index.js";
import { closeDatabase } from "../fixtures/database.js";
import {
  EVENT_SEARCH_CURRENT_CONTENT_ID,
  EVENT_SEARCH_FIXTURE_IDS,
  PRIVACY_SENTINELS,
  snapshotEventSearchDatabase,
  SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS,
  withEventSearchHarness,
  type EventSearchHarness,
} from "../fixtures/event-search.js";

type Clue = EventSearchResponse["clues"][number];

function clue(
  entityName: string,
  subject: string,
  searchTerms: readonly string[] = [],
): Clue {
  return {
    entity_name: entityName,
    subject,
    search_terms: [...searchTerms],
  };
}

function response(...clues: Clue[]): string {
  return JSON.stringify({ clues });
}

function parseObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected event search to fail");
}

function expectEventSearchError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(EventSearchError);
  expect(error).toMatchObject({
    name: "EventSearchError",
    code,
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");
  for (const sentinel of [
    PRIVACY_SENTINELS.contentId,
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
    expect(String(error)).not.toContain(sentinel);
  }
}

function expectLoggerWhitelist(harness: EventSearchHarness): void {
  const sensitiveValues = [
    PRIVACY_SENTINELS.raw,
    PRIVACY_SENTINELS.topic,
    PRIVACY_SENTINELS.history,
    PRIVACY_SENTINELS.token,
    PRIVACY_SENTINELS.prompt,
    PRIVACY_SENTINELS.model,
    PRIVACY_SENTINELS.sql,
    PRIVACY_SENTINELS.body,
    PRIVACY_SENTINELS.background,
  ];

  for (const entry of harness.logger.entries) {
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
    const serialized = JSON.stringify(entry);
    for (const sentinel of sensitiveValues) {
      expect(serialized).not.toContain(sentinel);
    }
  }
}

function eventContextStatementCount(harness: EventSearchHarness): number {
  return harness.observedDatabase.preparedSql.filter((sql) => {
    const normalized = sql.replace(/\s+/gu, " ");
    return (
      normalized.includes("FROM events WHERE id = ?") &&
      !normalized.includes("event_entity_aliases")
    );
  }).length;
}

describe("event search integration", () => {
  it("PMT-09 / PRIVACY / PUBLIC_SHAPE / READ_ONLY uses the public factory without writes or network", async () => {
    await withEventSearchHarness(
      [response(clue("Window Entity", "Window Subject"))],
      async (harness) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const fetchEntriesSpy = vi.spyOn(harness.adapter, "fetchEntries");
        const fetchContentSpy = vi.spyOn(harness.adapter, "fetchContent");

        try {
          const before = snapshotEventSearchDatabase(harness.rawDatabase);
          const service = createEventSearch(harness.dependencies);
          const result = await service.search(EVENT_SEARCH_CURRENT_CONTENT_ID);

          expect(result).toHaveProperty("candidates");
          expect(Object.keys(result)).toEqual(["candidates"]);
          expect(result.candidates.map(({ id }) => id)).toEqual([
            EVENT_SEARCH_FIXTURE_IDS.window,
          ]);
          const [candidate] = result.candidates;
          expect(Object.keys(candidate ?? {}).sort()).toEqual([
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
          expect(Object.keys(candidate?.updates[0] ?? {}).sort()).toEqual([
            "description",
            "discovered_at",
            "event_id",
            "id",
            "occurred_at",
            "title",
          ]);
          expect(candidate?.updates.map(({ id }) => id)).toEqual(
            Array.from(
              { length: 10 },
              (_, offset) =>
                `window-update-${String(offset + 3).padStart(2, "0")}`,
            ),
          );
          expect(candidate).not.toHaveProperty("score");
          expect(candidate).not.toHaveProperty("source");
          expect(candidate).not.toHaveProperty("clues");
          expect(result).not.toHaveProperty("clues");

          expect(harness.stubLlm.requests).toHaveLength(1);
          expect(harness.stubLlm.transactionStates).toEqual([false]);
          expect(harness.candidateRepository.calls).toHaveLength(1);
          expect(harness.candidateRepository.transactionStates).toEqual([
            false,
          ]);
          expect(harness.observedDatabase.transactionCalls).toBe(0);
          expect(new Set(harness.observedDatabase.transactionStates)).toEqual(
            new Set([false]),
          );
          expect(harness.observedDatabase.updateCalls).toEqual([
            expect.objectContaining({
              method: "all",
              parameters: [EVENT_SEARCH_FIXTURE_IDS.window, 10],
            }),
          ]);

          const request = harness.stubLlm.requests[0];
          expect(request?.systemContent).toContain(
            SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS,
          );
          expect(request?.systemContent).not.toContain(PRIVACY_SENTINELS.body);
          expect(request?.systemContent).not.toContain(
            PRIVACY_SENTINELS.background,
          );
          expect(await readdir(harness.promptDirectory)).toEqual([
            "event-search.md",
          ]);

          const userPayload = parseObject(request?.userContent ?? "");
          expect(Object.keys(userPayload)).toEqual(["task_data"]);
          expect(userPayload).not.toHaveProperty("user_context");
          const taskData = userPayload.task_data;
          expect(typeof taskData).toBe("object");
          expect(taskData).not.toBeNull();
          expect(
            Object.keys(taskData as Record<string, unknown>).sort(),
          ).toEqual([
            "author",
            "body",
            "completeness",
            "published_at",
            "summary",
            "title",
          ]);
          expect(taskData).toEqual({
            title: "Synthetic Content Title",
            body: `Synthetic Content Body ${PRIVACY_SENTINELS.body}`,
            summary: "Synthetic Content Summary",
            author: "Synthetic Author",
            published_at: "2026-11-18T09:30:00.000+08:00",
            completeness: "PARTIAL",
          });
          for (const sentinel of [
            PRIVACY_SENTINELS.raw,
            PRIVACY_SENTINELS.topic,
            PRIVACY_SENTINELS.history,
            PRIVACY_SENTINELS.token,
            EVENT_SEARCH_CURRENT_CONTENT_ID,
          ]) {
            expect(request?.userContent).not.toContain(sentinel);
          }

          expectLoggerWhitelist(harness);
          expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
            before,
          );
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(fetchEntriesSpy).not.toHaveBeenCalled();
          expect(fetchContentSpy).not.toHaveBeenCalled();

          closeDatabase(harness.rawDatabase);
          expect(harness.rawDatabase.open).toBe(false);
          const remainingFiles = await readdir(harness.rootDirectory);
          expect(
            remainingFiles.filter(
              (name) => name.endsWith("-wal") || name.endsWith("-shm"),
            ),
          ).toEqual([]);
        } finally {
          fetchSpy.mockRestore();
          fetchEntriesSpy.mockRestore();
          fetchContentSpy.mockRestore();
        }
      },
    );
  });

  it("MISSING / INVALID / ABORT does zero DB/LLM work before input gates and stops after cancellation", async () => {
    await withEventSearchHarness(
      [response(clue("Window Entity", "Window Subject"))],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const contentSpy = vi.spyOn(harness.contentRepository, "getById");
        const controller = new AbortController();
        controller.abort();
        const service = createEventSearch(harness.dependencies);

        await expect(service.search("missing-content-id")).resolves.toEqual({
          candidates: [],
        });
        const invalidError = await captureRejection(service.search("   "));
        expectEventSearchError(invalidError, "invalid_input");
        const abortError = await captureRejection(
          service.search(EVENT_SEARCH_CURRENT_CONTENT_ID, {
            signal: controller.signal,
          }),
        );
        expectEventSearchError(abortError, "aborted");

        expect(contentSpy).toHaveBeenCalledTimes(1);
        expect(harness.stubLlm.requests).toHaveLength(0);
        expect(harness.candidateRepository.calls).toHaveLength(0);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );

        const postCallController = new AbortController();
        const abortingCalls: EventSearchDependencies["typedLlmCalls"] = {
          async searchEvents(taskData, options) {
            const result =
              await harness.dependencies.typedLlmCalls.searchEvents(
                taskData,
                options,
              );
            postCallController.abort();
            return result;
          },
        };
        const postCallService = createEventSearch({
          ...harness.dependencies,
          typedLlmCalls: abortingCalls,
        });
        const postCallError = await captureRejection(
          postCallService.search(EVENT_SEARCH_CURRENT_CONTENT_ID, {
            signal: postCallController.signal,
          }),
        );
        expectEventSearchError(postCallError, "aborted");
        expect(harness.stubLlm.requests).toHaveLength(1);
        expect(harness.candidateRepository.calls).toHaveLength(0);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
      },
    );
  });

  it("EVT-06 keeps same-entity/different-subject clues separate through the real pipeline", async () => {
    await withEventSearchHarness(
      [
        response(
          clue("Shared Entity", "Shared Subject Alpha"),
          clue("Shared Entity", "Shared Subject Beta"),
        ),
      ],
      async (harness) => {
        const result = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(result.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.sharedA,
          EVENT_SEARCH_FIXTURE_IDS.sharedB,
        ]);
        expect(harness.candidateRepository.calls).toHaveLength(1);
        expect(harness.candidateRepository.calls[0]).toEqual([
          clue("Shared Entity", "Shared Subject Alpha"),
          clue("Shared Entity", "Shared Subject Beta"),
        ]);
        expect(harness.candidateRepository.transactionStates).toEqual([false]);
      },
    );
  });

  it("EVT-10 recalls ten-year-old Events by standard name, confirmed alias, and FTS", async () => {
    await withEventSearchHarness(
      [
        response(
          clue("Old Standard Entity", "No standard subject"),
          clue("Old Confirmed Alias", "No alias subject"),
          clue("No direct entity", "No direct subject", [
            "Old only indexed description",
          ]),
        ),
      ],
      async (harness) => {
        const result = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);
        const ids = result.candidates.map(({ id }) => id);

        expect(ids).toHaveLength(3);
        expect(new Set(ids)).toEqual(
          new Set([
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
            EVENT_SEARCH_FIXTURE_IDS.oldAlias,
            EVENT_SEARCH_FIXTURE_IDS.oldFts,
          ]),
        );
        expect(
          result.candidates.map(({ discovered_at }) => discovered_at).sort(),
        ).toEqual(
          [
            "2016-01-10T08:00:00.000+08:00",
            "2016-02-10T08:00:00.000+08:00",
            "2016-03-10T08:00:00.000+08:00",
          ].sort(),
        );
      },
    );
  });

  it("EVT-24 / DEDUPE isolates same-alias Events and collapses cross-route duplicate clues", async () => {
    await withEventSearchHarness(
      [
        response(clue("Shared Alias Text", "No alias subject")),
        response(
          clue("Dedupe Entity", "Dedupe Subject", ["Dedupe Search Term"]),
          clue("Dedupe Entity", "Dedupe Subject", ["Dedupe Search Term"]),
          clue("Dedupe Alias", "No alias subject", ["Dedupe Search Term"]),
        ),
      ],
      async (harness) => {
        const aliasResult = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 10,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(aliasResult.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
          EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
        ]);
        expect(
          aliasResult.candidates.map(({ updates }) =>
            updates.map(({ event_id }) => event_id),
          ),
        ).toEqual([
          [EVENT_SEARCH_FIXTURE_IDS.sameAliasB],
          [EVENT_SEARCH_FIXTURE_IDS.sameAliasA],
        ]);

        const dedupeService = createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        });
        const dedupeResult = await dedupeService.search(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(dedupeResult.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.dedupe,
        ]);
        expect(harness.candidateRepository.calls).toHaveLength(2);
        expect(harness.candidateRepository.calls[1]).toEqual([
          clue("Dedupe Entity", "Dedupe Subject", ["Dedupe Search Term"]),
          clue("Dedupe Alias", "No alias subject", ["Dedupe Search Term"]),
        ]);
      },
    );
  });

  it("EVT-11 / UPDATE_LIMIT applies 0/1/3/10/100 windows with time-and-ID ordering and old-to-new DTOs", async () => {
    const repeatedResponse = response(clue("Window Entity", "Window Subject"));
    await withEventSearchHarness(
      Array.from({ length: 5 }, () => repeatedResponse),
      async (harness) => {
        const expectedUpdates = new Map<number, readonly string[]>([
          [0, []],
          [1, ["window-update-12"]],
          [3, ["window-update-10", "window-update-11", "window-update-12"]],
          [
            10,
            Array.from(
              { length: 10 },
              (_, offset) =>
                `window-update-${String(offset + 3).padStart(2, "0")}`,
            ),
          ],
          [
            100,
            Array.from(
              { length: 12 },
              (_, offset) =>
                `window-update-${String(offset + 1).padStart(2, "0")}`,
            ),
          ],
        ]);
        const candidateIdOrder: string[][] = [];

        for (const maxUpdates of [0, 1, 3, 10, 100] as const) {
          const updateCallsBefore = harness.observedDatabase.updateCalls.length;
          const result = await createEventSearch({
            ...harness.dependencies,
            maxUpdates,
          }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);
          const [candidate] = result.candidates;
          const updateIds = candidate?.updates.map(({ id }) => id) ?? [];

          expect(candidate?.id).toBe(EVENT_SEARCH_FIXTURE_IDS.window);
          expect(updateIds).toEqual(expectedUpdates.get(maxUpdates));
          candidateIdOrder.push(result.candidates.map(({ id }) => id));

          const addedUpdateCalls =
            harness.observedDatabase.updateCalls.length - updateCallsBefore;
          if (maxUpdates === 0) {
            expect(addedUpdateCalls).toBe(0);
          } else {
            expect(addedUpdateCalls).toBe(1);
            expect(
              harness.observedDatabase.updateCalls.at(-1)?.parameters,
            ).toEqual([EVENT_SEARCH_FIXTURE_IDS.window, maxUpdates]);
          }
        }

        expect(candidateIdOrder).toEqual(
          Array.from({ length: 5 }, () => [EVENT_SEARCH_FIXTURE_IDS.window]),
        );
        expect(harness.stubLlm.requests).toHaveLength(5);
        expect(harness.stubLlm.transactionStates).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
        expect(harness.candidateRepository.transactionStates).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
        expect(new Set(harness.observedDatabase.transactionStates)).toEqual(
          new Set([false]),
        );
        expect(harness.observedDatabase.transactionCalls).toBe(0);
      },
    );
  });

  it("EVT-23 recalls the first Update by FTS without exposing it outside maxUpdates", async () => {
    const repeatedResponse = response(
      clue("No update entity", "No update subject", ["history deep clue"]),
    );
    await withEventSearchHarness(
      [repeatedResponse, repeatedResponse],
      async (harness) => {
        const defaultService = createEventSearch({
          ...harness.dependencies,
          maxUpdates: 10,
        });
        const zeroService = createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        });

        const defaultResult = await defaultService.search(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );
        const zeroResult = await zeroService.search(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );
        expect(harness.candidateRepository.lastHitCount).toBe(1);
        expect(defaultResult.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.window,
        ]);
        expect(zeroResult.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.window,
        ]);
        expect(
          defaultResult.candidates[0]?.updates.map(({ id }) => id),
        ).toEqual(
          Array.from(
            { length: 10 },
            (_, offset) =>
              `window-update-${String(offset + 3).padStart(2, "0")}`,
          ),
        );
        expect(
          defaultResult.candidates[0]?.updates.map(({ id }) => id),
        ).not.toContain("window-update-01");
        expect(zeroResult.candidates[0]?.updates).toEqual([]);
      },
    );
  });

  it("CANDIDATE_LIMIT recalls all 55 candidates before stable default/1/50 truncation", async () => {
    const repeatedResponse = response(
      clue("Limit Entity", "Limit Subject", ["limit recall clue"]),
    );
    await withEventSearchHarness(
      [repeatedResponse, repeatedResponse, repeatedResponse],
      async (harness) => {
        const expectedIds = (limit: number): string[] =>
          Array.from(
            { length: limit },
            (_, index) => `limit-event-${String(index).padStart(2, "0")}`,
          );

        const defaultResult = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);
        expect(harness.candidateRepository.lastHitCount).toBe(55);
        expect(defaultResult.candidates.map(({ id }) => id)).toEqual(
          expectedIds(10),
        );

        const oneResult = await createEventSearch({
          ...harness.dependencies,
          maxCandidates: 1,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);
        expect(harness.candidateRepository.lastHitCount).toBe(55);
        expect(oneResult.candidates.map(({ id }) => id)).toEqual(
          expectedIds(1),
        );

        const fiftyResult = await createEventSearch({
          ...harness.dependencies,
          maxCandidates: 50,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);
        expect(harness.candidateRepository.lastHitCount).toBe(55);
        expect(fiftyResult.candidates.map(({ id }) => id)).toEqual(
          expectedIds(50),
        );
        expect(harness.observedDatabase.updateCalls).toEqual([]);
        expect(harness.observedDatabase.transactionCalls).toBe(0);
      },
    );
  });

  it("RANK orders all hits by direct, clue count, FTS term count, discovered_at, then Event ID", async () => {
    await withEventSearchHarness(
      [
        response(
          clue("Rank Direct", "Rank Subject", [
            "rank clue alpha",
            "rank clue beta",
          ]),
          clue("Rank Alias Entity", "Rank Alias Subject", [
            "rank clue gamma",
            "rank clue delta",
          ]),
        ),
      ],
      async (harness) => {
        const result = await createEventSearch({
          ...harness.dependencies,
          maxCandidates: 50,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(result.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.rankDirectTwo,
          EVENT_SEARCH_FIXTURE_IDS.rankAliasOne,
          EVENT_SEARCH_FIXTURE_IDS.rankDirectOneNew,
          EVENT_SEARCH_FIXTURE_IDS.rankDirectOneOld,
          EVENT_SEARCH_FIXTURE_IDS.rankFtsClueTwo,
          EVENT_SEARCH_FIXTURE_IDS.rankFtsTermsTwo,
          EVENT_SEARCH_FIXTURE_IDS.rankFtsTieA,
          EVENT_SEARCH_FIXTURE_IDS.rankFtsTieZ,
        ]);
        expect(harness.candidateRepository.lastHitCount).toBe(8);
      },
    );
  });

  it("FTS_LITERAL parameterizes hostile phrases and leaves every business/FTS row unchanged", async () => {
    const literals = [
      'quote " literal',
      "bracket(value)",
      "colon:value",
      "star*",
      "NEAR",
      "' OR 1=1 --",
      PRIVACY_SENTINELS.sql,
    ];
    await withEventSearchHarness(
      [response(clue("No literal entity", "No literal subject", literals))],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const result = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 0,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(result.candidates.map(({ id }) => id)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.literal,
        ]);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        expect(harness.observedDatabase.transactionCalls).toBe(0);
        expect(harness.stubLlm.transactionStates).toEqual([false]);
        expect(harness.candidateRepository.transactionStates).toEqual([false]);
      },
    );
  });

  it("EVT-22 / EMPTY returns a successful empty result with no context query or write", async () => {
    await withEventSearchHarness(
      [
        response(
          clue("No candidate entity", "No candidate subject", [
            "No candidate term",
          ]),
        ),
      ],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const result = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 100,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(result).toEqual({ candidates: [] });
        expect(harness.candidateRepository.calls).toHaveLength(1);
        expect(harness.candidateRepository.lastHitCount).toBe(0);
        expect(eventContextStatementCount(harness)).toBe(0);
        expect(harness.observedDatabase.updateCalls).toEqual([]);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        expect(harness.observedDatabase.transactionCalls).toBe(0);
      },
    );
  });

  it("FTS orphan rows are counted but never become candidates or leak an Event ID/text in logs", async () => {
    await withEventSearchHarness(
      [
        response(
          clue("No orphan entity", "No orphan subject", ["Orphan recall clue"]),
        ),
      ],
      async (harness) => {
        harness.rawDatabase
          .prepare(
            "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
          )
          .run(EVENT_SEARCH_FIXTURE_IDS.orphan, "Orphan recall clue");
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const result = await createEventSearch({
          ...harness.dependencies,
          maxUpdates: 10,
        }).search(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(result).toEqual({ candidates: [] });
        expect(harness.candidateRepository.calls).toHaveLength(1);
        expect(harness.candidateRepository.lastHitCount).toBe(0);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        const searchLogs = harness.logger.entries.filter(
          ({ stage }) => stage === "search",
        );
        expect(searchLogs.length).toBeGreaterThan(0);
        expect(JSON.stringify(searchLogs)).not.toContain(
          EVENT_SEARCH_FIXTURE_IDS.orphan,
        );
        expect(JSON.stringify(searchLogs)).not.toContain("Orphan recall clue");
      },
    );
  });

  it("ERROR maps candidate and context failures to event_search_failed outside transactions", async () => {
    const runtimeError = () =>
      new Error(
        `${PRIVACY_SENTINELS.sql} ${PRIVACY_SENTINELS.token} ${PRIVACY_SENTINELS.model}`,
        { cause: new Error(PRIVACY_SENTINELS.prompt) },
      );

    await withEventSearchHarness(
      [response(clue("Window Entity", "Window Subject"))],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const candidateSearch = vi.fn(() => {
          throw runtimeError();
        });
        const candidateError = await captureRejection(
          createEventSearch({
            ...harness.dependencies,
            candidateRepository: { search: candidateSearch },
          }).search(EVENT_SEARCH_CURRENT_CONTENT_ID),
        );

        expectEventSearchError(candidateError, "event_search_failed");
        expect(candidateSearch).toHaveBeenCalledTimes(1);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        expect(
          harness.logger.entries.some(
            ({ stage, reason }) =>
              stage === "search" && reason === "event_search_failed",
          ),
        ).toBe(true);
      },
    );

    await withEventSearchHarness(
      [response(clue("Window Entity", "Window Subject"))],
      async (harness) => {
        const failingContextDatabase = new Proxy(
          harness.observedDatabase.database,
          {
            get(target, property, receiver) {
              if (property === "prepare") {
                return (sql: string): Database.Statement => {
                  const normalized = sql.replace(/\s+/gu, " ");
                  if (
                    normalized.includes("FROM events WHERE id = ?") &&
                    !normalized.includes("event_entity_aliases")
                  ) {
                    throw runtimeError();
                  }
                  return target.prepare(sql);
                };
              }

              const value = Reflect.get(target, property, receiver);
              return typeof value === "function" ? value.bind(target) : value;
            },
          },
        );
        const contextError = await captureRejection(
          createEventSearch({
            ...harness.dependencies,
            database: failingContextDatabase,
          }).search(EVENT_SEARCH_CURRENT_CONTENT_ID),
        );

        expectEventSearchError(contextError, "event_search_failed");
        expect(harness.candidateRepository.calls).toHaveLength(1);
        expect(harness.observedDatabase.transactionCalls).toBe(0);
        expect(new Set(harness.observedDatabase.transactionStates)).toEqual(
          new Set([false]),
        );
        expect(
          harness.logger.entries.some(
            ({ stage, reason }) =>
              stage === "context" && reason === "event_search_failed",
          ),
        ).toBe(true);
      },
    );
  });

  it.each([
    ["invalid JSON", `not-json ${PRIVACY_SENTINELS.model}`],
    [
      "missing field",
      JSON.stringify({
        clues: [{ entity_name: "Entity", subject: "Subject" }],
      }),
    ],
    [
      "extra field",
      JSON.stringify({
        clues: [],
        model_extra: PRIVACY_SENTINELS.model,
      }),
    ],
  ])(
    "PMT-15 maps real D02 %s failures to llm_failed with zero candidates/writes",
    async (_name, modelOutput) => {
      await withEventSearchHarness([modelOutput], async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        const error = await captureRejection(
          createEventSearch(harness.dependencies).search(
            EVENT_SEARCH_CURRENT_CONTENT_ID,
          ),
        );

        expectEventSearchError(error, "llm_failed");
        expect(harness.stubLlm.requests).toHaveLength(1);
        expect(harness.candidateRepository.calls).toHaveLength(0);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        expect(
          harness.logger.entries.some(
            ({ stage, reason }) =>
              stage === "extract" && reason === "llm_failed",
          ),
        ).toBe(true);
        expectLoggerWhitelist(harness);
      });
    },
  );

  it("ERROR maps a missing synthetic Prompt and closed SQLite reads without exposing internals", async () => {
    await withEventSearchHarness([], async (harness) => {
      await rm(path.join(harness.promptDirectory, "event-search.md"));
      const promptError = await captureRejection(
        createEventSearch(harness.dependencies).search(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        ),
      );
      expectEventSearchError(promptError, "llm_failed");
      expect(harness.stubLlm.requests).toHaveLength(0);
      expect(harness.candidateRepository.calls).toHaveLength(0);

      closeDatabase(harness.rawDatabase);
      const databaseError = await captureRejection(
        createEventSearch(harness.dependencies).search(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        ),
      );
      expectEventSearchError(databaseError, "event_search_failed");
      expect(harness.stubLlm.requests).toHaveLength(0);
      expect(harness.candidateRepository.calls).toHaveLength(0);
      expectLoggerWhitelist(harness);
    });
  });
});
