import type Database from "better-sqlite3";
import { readdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { rebuildEventSearch } from "../../src/database/event-search.js";
import {
  EventAnalysisError,
  EVENT_ANALYSIS_ERROR_MESSAGES,
  type EventAnalysisErrorCode,
} from "../../src/event-analysis/event-analysis-errors.js";
import { createEventAnalysis } from "../../src/event-analysis/index.js";
import type { EventRepository } from "../../src/event-analysis/event-repository.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../../src/llm/response-validators.js";
import {
  countEventAnalysisRows,
  SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS,
  withEventAnalysisIntegrationHarness,
  type EventAnalysisIntegrationHarness,
} from "../fixtures/event-analysis.js";
import {
  EVENT_SEARCH_CURRENT_CONTENT_ID,
  EVENT_SEARCH_FIXTURE_IDS,
  PRIVACY_SENTINELS,
  snapshotEventSearchDatabase,
  SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS,
} from "../fixtures/event-search.js";

type NewEventDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_EVENT" }
>;
type NewUpdateDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NEW_UPDATE" }
>;
type NoIncrementDecision = Extract<
  EventAnalysisDecision,
  { readonly action: "NO_INCREMENT" }
>;

interface Clue {
  readonly entity_name: string;
  readonly subject: string;
  readonly search_terms: readonly string[];
}

interface EventSearchRow {
  readonly event_id: string;
  readonly search_text: string;
}

interface EventUpdateRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
}

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

function p02(clues: readonly Clue[]): string {
  return JSON.stringify({ clues });
}

function p03(results: readonly EventAnalysisDecision[]): string {
  return JSON.stringify({ results });
}

function newEvent(overrides: Partial<NewEventDecision> = {}): NewEventDecision {
  return {
    action: "NEW_EVENT",
    title: "New Regulatory Event",
    entity: { name: "Synthetic Regulatory Entity" },
    subject: "Synthetic Regulatory Subject",
    scope: "Synthetic Regulatory Scope",
    description: "Synthetic regulatory investigation",
    occurred_at: null,
    confirmed_aliases: [],
    ...overrides,
  };
}

function newUpdate(
  eventId: string,
  overrides: Partial<NewUpdateDecision> = {},
): NewUpdateDecision {
  return {
    action: "NEW_UPDATE",
    event_id: eventId,
    title: "Synthetic Regulatory Progression",
    description: "A new stage in the same regulatory storyline",
    occurred_at: null,
    confirmed_aliases: [],
    ...overrides,
  };
}

function noIncrement(
  eventId: string,
  eventUpdateId: string | null,
  aliases: readonly string[] = [],
): NoIncrementDecision {
  return {
    action: "NO_INCREMENT",
    event_id: eventId,
    event_update_id: eventUpdateId,
    confirmed_aliases: [...aliases],
  };
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

  throw new Error("Expected event analysis to fail");
}

function expectError(
  error: unknown,
  code: EventAnalysisErrorCode,
): asserts error is EventAnalysisError {
  expect(error).toBeInstanceOf(EventAnalysisError);
  expect(error).toMatchObject({
    name: "EventAnalysisError",
    code,
    message: EVENT_ANALYSIS_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");
  for (const sentinel of Object.values(PRIVACY_SENTINELS)) {
    expect(String(error)).not.toContain(sentinel);
  }
}

function p02Request(harness: EventAnalysisIntegrationHarness) {
  return harness.stubLlm.requests.find(({ systemContent }) =>
    systemContent.includes(SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS),
  );
}

function p03Request(harness: EventAnalysisIntegrationHarness) {
  return harness.stubLlm.requests.find(({ systemContent }) =>
    systemContent.includes(SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS),
  );
}

function eventSearchRows(
  database: Database.Database,
  eventId: string,
): EventSearchRow[] {
  return database
    .prepare<[string], EventSearchRow>(
      `
        SELECT event_id, search_text
        FROM event_search
        WHERE event_id = ?
        ORDER BY event_id COLLATE BINARY
      `,
    )
    .all(eventId);
}

function eventUpdates(
  database: Database.Database,
  eventId: string,
): EventUpdateRow[] {
  return database
    .prepare<[string], EventUpdateRow>(
      `
        SELECT id, event_id, title, description
        FROM event_updates
        WHERE event_id = ?
        ORDER BY discovered_at ASC, id COLLATE BINARY ASC
      `,
    )
    .all(eventId);
}

function matchingEventIds(database: Database.Database, term: string): string[] {
  return database
    .prepare<[string], { readonly event_id: string }>(
      `
        SELECT event_id
        FROM event_search
        WHERE event_search MATCH ?
        ORDER BY event_id COLLATE BINARY
      `,
    )
    .all(term)
    .map(({ event_id }) => event_id);
}

function expectProbeSplit(harness: EventAnalysisIntegrationHarness): void {
  expect(
    harness.stubLlm.transactionStates.every((state) => state === false),
  ).toBe(true);
  expect(harness.rawDatabase.inTransaction).toBe(false);
}

function replaceEventRepositoryMethod(
  harness: EventAnalysisIntegrationHarness,
  method: "insertUpdate",
  implementation: EventRepository["insertUpdate"],
): EventRepository {
  return new Proxy(harness.dependencies.eventRepository, {
    get(target, property, receiver) {
      if (property === method) {
        return implementation;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("event analysis integration", () => {
  it("MISSING_CONTENT / EVT-21 / EVT-05 use real D08 reasons and stop with zero writes", async () => {
    await withEventAnalysisIntegrationHarness([], async (harness) => {
      const before = snapshotEventSearchDatabase(harness.rawDatabase);
      let contentReads = 0;
      const originalGetById = harness.contentRepository.getById.bind(
        harness.contentRepository,
      );
      const getById = vi
        .spyOn(harness.contentRepository, "getById")
        .mockImplementation((id) => {
          contentReads += 1;
          return originalGetById(id);
        });
      const result = await createEventAnalysis(harness.dependencies).analyze(
        "missing-content-d09-t05",
      );

      expect(result).toEqual({ new_targets: [] });
      expect(harness.counts).toMatchObject({ search: 1, p02: 0, p03: 0 });
      expect(contentReads).toBe(1);
      expect(harness.observedDatabase.transactionCalls).toBe(0);
      expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(before);
      getById.mockRestore();
    });

    await withEventAnalysisIntegrationHarness([p02([])], async (harness) => {
      const before = snapshotEventSearchDatabase(harness.rawDatabase);
      let contentReads = 0;
      const originalGetById = harness.contentRepository.getById.bind(
        harness.contentRepository,
      );
      const getById = vi
        .spyOn(harness.contentRepository, "getById")
        .mockImplementation((id) => {
          contentReads += 1;
          return originalGetById(id);
        });
      const result = await createEventAnalysis(harness.dependencies).analyze(
        EVENT_SEARCH_CURRENT_CONTENT_ID,
      );

      expect(result).toEqual({ new_targets: [] });
      expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 0 });
      expect(contentReads).toBe(1);
      expect(harness.observedDatabase.transactionCalls).toBe(0);
      expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(before);
      getById.mockRestore();
    });
  });

  it("EVT-22 / PRIVACY / PMT-09 / ATOMIC / PUBLIC_SHAPE analyzes no_candidates with real D02 and SQLite", async () => {
    const alias = "Synthetic Confirmed Alias";
    await withEventAnalysisIntegrationHarness(
      [
        p02([
          clue("No Candidate Entity", "No Candidate Subject", [
            "No Candidate Search Term",
          ]),
        ]),
        p03([newEvent({ confirmed_aliases: [alias] })]),
      ],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        let contentReads = 0;
        const originalGetById = harness.contentRepository.getById.bind(
          harness.contentRepository,
        );
        const getById = vi
          .spyOn(harness.contentRepository, "getById")
          .mockImplementation((id) => {
            contentReads += 1;
            expect(harness.rawDatabase.inTransaction).toBe(false);
            return originalGetById(id);
          });
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const fetchEntriesSpy = vi.spyOn(harness.adapter, "fetchEntries");
        const fetchContentSpy = vi.spyOn(harness.adapter, "fetchContent");

        try {
          const result = await createEventAnalysis(
            harness.dependencies,
          ).analyze(EVENT_SEARCH_CURRENT_CONTENT_ID);
          const target = result.new_targets[0];
          expect(Object.keys(result)).toEqual(["new_targets"]);
          expect(target).toEqual({
            target_type: "EVENT",
            target_id: "event-created-t05-a",
          });
          expect(Object.keys(target ?? {}).sort()).toEqual([
            "target_id",
            "target_type",
          ]);
          expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
          expect(contentReads).toBe(2);
          expectProbeSplit(harness);
          expect(harness.repositoryTransactionStates.length).toBeGreaterThan(0);
          expect(
            harness.repositoryTransactionStates.every((state) => state),
          ).toBe(true);
          expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([
            true,
            true,
          ]);

          const event = harness.rawDatabase
            .prepare<
              [string],
              { readonly id: string; readonly discovered_at: string }
            >("SELECT id, discovered_at FROM events WHERE id = ?")
            .get(target?.target_id ?? "");
          expect(event?.discovered_at).toBe("2026-11-19T09:30:00.000+08:00");
          expect(
            harness.rawDatabase
              .prepare<[string], { readonly count: number }>(
                "SELECT count(*) AS count FROM event_updates WHERE event_id = ?",
              )
              .get(target?.target_id ?? "")?.count,
          ).toBe(0);
          expect(
            eventUpdates(harness.rawDatabase, target?.target_id ?? ""),
          ).toEqual([]);
          expect(
            harness.rawDatabase
              .prepare<[string, string], { readonly content_id: string }>(
                `
                  SELECT content_id
                  FROM event_content_links
                  WHERE target_type = 'EVENT' AND target_id = ? AND content_id = ?
                `,
              )
              .get(target?.target_id ?? "", EVENT_SEARCH_CURRENT_CONTENT_ID),
          ).toEqual({ content_id: EVENT_SEARCH_CURRENT_CONTENT_ID });
          expect(
            eventSearchRows(harness.rawDatabase, target?.target_id ?? ""),
          ).toHaveLength(1);
          expect(
            eventSearchRows(harness.rawDatabase, target?.target_id ?? "")[0]
              ?.search_text,
          ).toContain(alias);

          expect(harness.stubLlm.requests).toHaveLength(2);
          const first = p02Request(harness);
          const second = p03Request(harness);
          expect(first?.systemContent).toContain(
            SYNTHETIC_EVENT_SEARCH_INSTRUCTIONS,
          );
          expect(second?.systemContent).toContain(
            SYNTHETIC_EVENT_ANALYSIS_INSTRUCTIONS,
          );
          for (const sentinel of [
            PRIVACY_SENTINELS.body,
            PRIVACY_SENTINELS.background,
            PRIVACY_SENTINELS.token,
          ]) {
            expect(first?.systemContent).not.toContain(sentinel);
            expect(second?.systemContent).not.toContain(sentinel);
          }
          expect(await readdir(harness.promptDirectory)).toEqual([
            "event-analysis.md",
            "event-search.md",
          ]);

          const userPayload = parseObject(second?.userContent ?? "");
          expect(Object.keys(userPayload)).toEqual(["task_data"]);
          expect(userPayload).not.toHaveProperty("user_context");
          const taskData = userPayload.task_data as Record<string, unknown>;
          expect(Object.keys(taskData).sort()).toEqual([
            "candidates",
            "content",
          ]);
          expect(taskData.candidates).toEqual([]);
          expect(taskData.content).toEqual({
            title: "Synthetic Content Title",
            body: `Synthetic Content Body ${PRIVACY_SENTINELS.body}`,
            summary: "Synthetic Content Summary",
            author: "Synthetic Author",
            published_at: "2026-11-18T09:30:00.000+08:00",
            completeness: "PARTIAL",
          });
          for (const forbidden of [
            PRIVACY_SENTINELS.contentId,
            PRIVACY_SENTINELS.raw,
            PRIVACY_SENTINELS.topic,
            PRIVACY_SENTINELS.history,
            PRIVACY_SENTINELS.token,
            "user_context",
            "clues",
            "reason",
            "search_terms",
          ]) {
            expect(second?.userContent).not.toContain(forbidden);
          }
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(fetchEntriesSpy).not.toHaveBeenCalled();
          expect(fetchContentSpy).not.toHaveBeenCalled();
          expect(snapshotEventSearchDatabase(harness.rawDatabase)).not.toEqual(
            before,
          );
        } finally {
          fetchSpy.mockRestore();
          fetchEntriesSpy.mockRestore();
          fetchContentSpy.mockRestore();
          getById.mockRestore();
        }

        if (harness.rawDatabase.open) {
          harness.rawDatabase.close();
        }
        expect(harness.rawDatabase.open).toBe(false);
        const remaining = await readdir(harness.rootDirectory);
        expect(
          remaining.filter(
            (name) => name.endsWith("-wal") || name.endsWith("-shm"),
          ),
        ).toEqual([]);
      },
    );
  });

  it("EVT-02 / EVT-08/09 / EVT-10 / E2E-14_ANALYSIS reuses a ten-year Event and creates one Update with evidence and FTS", async () => {
    const alias = "Ten Year Latest Alias";
    await withEventAnalysisIntegrationHarness(
      [
        p02([clue("Old Standard Entity", "Old Standard Subject")]),
        p03([
          newUpdate(EVENT_SEARCH_FIXTURE_IDS.oldStandard, {
            title: "New Ten-Year Regulatory Investigation",
            description: "The same company subject and scope progress",
            confirmed_aliases: [alias],
          }),
        ]),
      ],
      async (harness) => {
        const beforeSearchRows = eventSearchRows(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.oldStandard,
        );
        const beforeUpdates = eventUpdates(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.oldStandard,
        );
        const getById = vi.spyOn(harness.contentRepository, "getById");
        const result = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(result.new_targets).toEqual([
          {
            target_type: "EVENT_UPDATE",
            target_id: "event-created-t05-a",
          },
        ]);
        expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
        expect(getById).toHaveBeenCalledTimes(2);
        expectProbeSplit(harness);
        expect(
          harness.repositoryTransactionStates.every((state) => state),
        ).toBe(true);
        expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([
          true,
          true,
        ]);
        expect(
          harness.rawDatabase
            .prepare<[string], { readonly discovered_at: string }>(
              "SELECT discovered_at FROM events WHERE id = ?",
            )
            .get(EVENT_SEARCH_FIXTURE_IDS.oldStandard)?.discovered_at,
        ).toBe("2016-01-10T08:00:00.000+08:00");
        expect(
          eventUpdates(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          ),
        ).toHaveLength(beforeUpdates.length + 1);
        expect(
          eventUpdates(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          ).at(-1),
        ).toMatchObject({
          id: "event-created-t05-a",
          title: "New Ten-Year Regulatory Investigation",
          description: "The same company subject and scope progress",
        });
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly content_id: string }>(
              `
                SELECT content_id
                FROM event_content_links
                WHERE target_type = 'EVENT_UPDATE' AND target_id = ? AND content_id = ?
              `,
            )
            .get("event-created-t05-a", EVENT_SEARCH_CURRENT_CONTENT_ID),
        ).toEqual({ content_id: EVENT_SEARCH_CURRENT_CONTENT_ID });
        expect(
          eventSearchRows(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          )[0]?.search_text,
        ).toContain(alias);
        expect(
          eventSearchRows(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          )[0]?.search_text,
        ).toContain(beforeSearchRows[0]?.search_text ?? "");
        expect(
          matchingEventIds(harness.rawDatabase, "Old Standard Entity"),
        ).toContain(EVENT_SEARCH_FIXTURE_IDS.oldStandard);
        expect(matchingEventIds(harness.rawDatabase, alias)).toContain(
          EVENT_SEARCH_FIXTURE_IDS.oldStandard,
        );

        const p03Payload = parseObject(p03Request(harness)?.userContent ?? "");
        const p03TaskData = p03Payload.task_data as {
          candidates: Array<Record<string, unknown>>;
        };
        expect(p03TaskData.candidates[0]).toMatchObject({
          id: EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          updates: [],
        });
        const beforeRebuild = eventSearchRows(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.oldStandard,
        );
        rebuildEventSearch(harness.rawDatabase);
        expect(
          eventSearchRows(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.oldStandard,
          ),
        ).toEqual(beforeRebuild);
        expect(
          matchingEventIds(harness.rawDatabase, "Old Standard Entity"),
        ).toContain(EVENT_SEARCH_FIXTURE_IDS.oldStandard);
        expect(matchingEventIds(harness.rawDatabase, alias)).toContain(
          EVENT_SEARCH_FIXTURE_IDS.oldStandard,
        );
      },
    );
  });

  it("EVT-11 / EVT-23 recalls deep history but gives P-03 only the latest ten Updates without clues or search terms", async () => {
    const privateSearchTerm = "history deep clue";
    await withEventAnalysisIntegrationHarness(
      [
        p02([
          clue("No Update Entity", "No Update Subject", [privateSearchTerm]),
        ]),
        p03([newUpdate(EVENT_SEARCH_FIXTURE_IDS.window)]),
      ],
      async (harness) => {
        const result = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(result.new_targets[0]?.target_type).toBe("EVENT_UPDATE");
        expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
        const payload = parseObject(p03Request(harness)?.userContent ?? "");
        const taskData = payload.task_data as {
          candidates: Array<{
            id: string;
            updates: Array<Record<string, unknown>>;
          }>;
        };
        expect(taskData.candidates).toHaveLength(1);
        expect(taskData.candidates[0]?.id).toBe(
          EVENT_SEARCH_FIXTURE_IDS.window,
        );
        expect(taskData.candidates[0]?.updates.map(({ id }) => id)).toEqual(
          Array.from(
            { length: 10 },
            (_, offset) =>
              `window-update-${String(offset + 3).padStart(2, "0")}`,
          ),
        );
        expect(taskData.candidates[0]?.updates).not.toContainEqual(
          expect.objectContaining({ id: "window-update-01" }),
        );
        expect(p03Request(harness)?.userContent).not.toContain(
          privateSearchTerm,
        );
        expect(p03Request(harness)?.userContent).not.toContain("clues");
        expect(p03Request(harness)?.userContent).not.toContain("search_terms");
        expectProbeSplit(harness);
      },
    );
  });

  it("EVT-17 replay reuses the original Update and returns no target while keeping one Evidence and one FTS row", async () => {
    const replayResponse = p03([
      newUpdate(EVENT_SEARCH_FIXTURE_IDS.window, {
        title: "Window Replay Progression",
        description: "Window Replay Progression Description",
        confirmed_aliases: ["Window Replay Alias"],
      }),
    ]);
    await withEventAnalysisIntegrationHarness(
      [
        p02([clue("Window Entity", "Window Subject")]),
        replayResponse,
        p02([clue("Window Entity", "Window Subject")]),
        replayResponse,
      ],
      async (harness) => {
        const beforeWindowUpdates = eventUpdates(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.window,
        );
        const fresh = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );
        const replayed = await createEventAnalysis(
          harness.dependencies,
        ).analyze(EVENT_SEARCH_CURRENT_CONTENT_ID);

        expect(fresh.new_targets).toHaveLength(1);
        expect(fresh.new_targets[0]?.target_type).toBe("EVENT_UPDATE");
        expect(replayed).toEqual({ new_targets: [] });
        expect(harness.counts).toMatchObject({ search: 2, p02: 2, p03: 2 });
        expect(
          eventUpdates(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.window,
          ).filter((update) => update.title === "Window Replay Progression"),
        ).toHaveLength(1);
        expect(
          eventUpdates(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.window,
          ).slice(0, beforeWindowUpdates.length),
        ).toEqual(beforeWindowUpdates);
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly count: number }>(
              `
                SELECT count(*) AS count
                FROM event_content_links
                WHERE target_type = 'EVENT_UPDATE' AND target_id = ? AND content_id = ?
              `,
            )
            .get(
              fresh.new_targets[0]?.target_id ?? "",
              EVENT_SEARCH_CURRENT_CONTENT_ID,
            )?.count,
        ).toBeGreaterThan(0);
        expect(
          eventSearchRows(harness.rawDatabase, EVENT_SEARCH_FIXTURE_IDS.window),
        ).toHaveLength(1);
        expect(harness.rawDatabase.inTransaction).toBe(false);
      },
    );
  });

  it("EVT-06/07 persists multiple Events and Actions in one outer transaction with ordered targets", async () => {
    await withEventAnalysisIntegrationHarness(
      [
        p02([
          clue("Shared Entity", "Shared Subject Alpha"),
          clue("Old Standard Entity", "Old Standard Subject"),
        ]),
        p03([
          newEvent({ title: "Distinct New Storyline" }),
          newUpdate(EVENT_SEARCH_FIXTURE_IDS.sharedA, {
            title: "Shared Event Progression",
          }),
        ]),
      ],
      async (harness) => {
        const result = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(result.new_targets).toEqual([
          {
            target_type: "EVENT",
            target_id: "event-created-t05-a",
          },
          {
            target_type: "EVENT_UPDATE",
            target_id: "event-update-created-t05-a",
          },
        ]);
        expect(harness.observedDatabase.transactionCalls).toBe(3);
        expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([
          true,
          true,
          true,
          true,
        ]);
        expect(
          eventUpdates(harness.rawDatabase, EVENT_SEARCH_FIXTURE_IDS.sharedA),
        ).toHaveLength(1);
        expect(
          harness.rawDatabase
            .prepare<[string], { readonly count: number }>(
              "SELECT count(*) AS count FROM events WHERE title = ?",
            )
            .get("Distinct New Storyline")?.count,
        ).toBe(1);
        expectProbeSplit(harness);
      },
    );
  });

  it("EVT-03/04 NO_INCREMENT links the specified Update or Event only, with no target and no FTS text change", async () => {
    await withEventAnalysisIntegrationHarness(
      [
        p02([clue("Window Entity", "Window Subject")]),
        p03([noIncrement(EVENT_SEARCH_FIXTURE_IDS.window, "window-update-12")]),
        p02([clue("Old Standard Entity", "Old Standard Subject")]),
        p03([noIncrement(EVENT_SEARCH_FIXTURE_IDS.oldStandard, null)]),
      ],
      async (harness) => {
        const beforeFts = snapshotEventSearchDatabase(harness.rawDatabase);
        const first = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );
        const second = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(first).toEqual({ new_targets: [] });
        expect(second).toEqual({ new_targets: [] });
        expect(harness.counts).toMatchObject({ search: 2, p02: 2, p03: 2 });
        expect(harness.observedDatabase.transactionCalls).toBe(2);
        expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([]);
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly count: number }>(
              `
                SELECT count(*) AS count
                FROM event_content_links
                WHERE target_type = 'EVENT_UPDATE' AND target_id = ? AND content_id = ?
              `,
            )
            .get("window-update-12", EVENT_SEARCH_CURRENT_CONTENT_ID)?.count,
        ).toBe(1);
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly count: number }>(
              `
                SELECT count(*) AS count
                FROM event_content_links
                WHERE target_type = 'EVENT' AND target_id = ? AND content_id = ?
              `,
            )
            .get(
              EVENT_SEARCH_FIXTURE_IDS.oldStandard,
              EVENT_SEARCH_CURRENT_CONTENT_ID,
            )?.count,
        ).toBe(1);
        expect(
          snapshotEventSearchDatabase(harness.rawDatabase).event_search,
        ).toEqual(beforeFts.event_search);
      },
    );
  });

  it("EVT-12/13/14 / EVT-24 stores only confirmed aliases with current Content evidence and refreshes only that Event", async () => {
    const newAlias = "Only Alpha Confirmed Alias";
    const searchTerm = "P02 Search Term Must Not Persist";
    await withEventAnalysisIntegrationHarness(
      [
        p02([clue("Shared Alias Text", "No alias subject", [searchTerm])]),
        p03([
          noIncrement(
            EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
            "same-alias-update-a",
            [newAlias, newAlias, "Shared Alias Text"],
          ),
        ]),
      ],
      async (harness) => {
        const beforeA = eventSearchRows(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
        );
        const beforeB = eventSearchRows(
          harness.rawDatabase,
          EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
        );
        const result = await createEventAnalysis(harness.dependencies).analyze(
          EVENT_SEARCH_CURRENT_CONTENT_ID,
        );

        expect(result).toEqual({ new_targets: [] });
        expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly content_id: string }>(
              `
                SELECT content_id
                FROM event_entity_aliases
                WHERE event_id = ? AND alias = ?
              `,
            )
            .get(EVENT_SEARCH_FIXTURE_IDS.sameAliasA, newAlias),
        ).toEqual({ content_id: EVENT_SEARCH_CURRENT_CONTENT_ID });
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly count: number }>(
              `
                SELECT count(*) AS count
                FROM event_entity_aliases
                WHERE event_id = ? AND alias = ?
              `,
            )
            .get(EVENT_SEARCH_FIXTURE_IDS.sameAliasB, newAlias)?.count,
        ).toBe(0);
        expect(
          harness.rawDatabase
            .prepare<[string, string], { readonly content_id: string }>(
              `
                SELECT content_id
                FROM event_entity_aliases
                WHERE event_id = ? AND alias = ?
              `,
            )
            .get(EVENT_SEARCH_FIXTURE_IDS.sameAliasA, "Shared Alias Text"),
        ).toEqual({ content_id: "content-alias-same-a" });
        expect(
          harness.rawDatabase
            .prepare<[string], { readonly count: number }>(
              "SELECT count(*) AS count FROM event_entity_aliases WHERE alias LIKE ?",
            )
            .get(`%${searchTerm}%`)?.count,
        ).toBe(0);
        expect(
          eventSearchRows(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
          )[0]?.search_text,
        ).toContain(newAlias);
        expect(matchingEventIds(harness.rawDatabase, newAlias)).toEqual([
          EVENT_SEARCH_FIXTURE_IDS.sameAliasA,
        ]);
        expect(
          eventSearchRows(
            harness.rawDatabase,
            EVENT_SEARCH_FIXTURE_IDS.sameAliasB,
          ),
        ).toEqual(beforeB);
        expect(beforeA).toHaveLength(1);
        expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([
          true,
          true,
        ]);
      },
    );
  });

  it.each([
    [
      "NEW_EVENT self-authored ID",
      p02([clue("Window Entity", "Window Subject")]),
      JSON.stringify({
        results: [{ ...newEvent(), event_id: "model-authored-event" }],
      }),
    ],
    [
      "missing required field",
      p02([clue("Window Entity", "Window Subject")]),
      JSON.stringify({
        results: [
          { action: "NEW_UPDATE", event_id: EVENT_SEARCH_FIXTURE_IDS.window },
        ],
      }),
    ],
    [
      "extra result field",
      p02([clue("Window Entity", "Window Subject")]),
      JSON.stringify({
        results: [
          { ...newEvent(), private_model_output: PRIVACY_SENTINELS.model },
        ],
      }),
    ],
    [
      "wrong field type",
      p02([clue("Window Entity", "Window Subject")]),
      JSON.stringify({
        results: [{ ...newEvent(), occurred_at: 42 }],
      }),
    ],
    [
      "illegal enum",
      p02([clue("Window Entity", "Window Subject")]),
      JSON.stringify({ results: [{ ...newEvent(), action: "MERGE" }] }),
    ],
    [
      "candidate-external Event",
      p02([clue("Window Entity", "Window Subject")]),
      p03([newUpdate("event-outside-candidates")]),
    ],
    [
      "Update owned by another Event",
      p02([clue("Shared Alias Text", "No alias subject")]),
      p03([
        noIncrement(EVENT_SEARCH_FIXTURE_IDS.sameAliasA, "same-alias-update-b"),
      ]),
    ],
    [
      "conflicting Actions",
      p02([clue("Window Entity", "Window Subject")]),
      p03([
        newUpdate(EVENT_SEARCH_FIXTURE_IDS.window),
        noIncrement(EVENT_SEARCH_FIXTURE_IDS.window, null),
      ]),
    ],
  ] as const)(
    "EVT-15 / PMT-14/15 rejects %s as llm_failed before writes",
    async (_name, p02Output, p03Output) => {
      await withEventAnalysisIntegrationHarness(
        [p02Output, p03Output],
        async (harness) => {
          const before = snapshotEventSearchDatabase(harness.rawDatabase);
          const error = await captureRejection(
            createEventAnalysis(harness.dependencies).analyze(
              EVENT_SEARCH_CURRENT_CONTENT_ID,
            ),
          );

          expectError(error, "llm_failed");
          expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
          expect(harness.observedDatabase.transactionCalls).toBe(0);
          expect(harness.rawDatabase.inTransaction).toBe(false);
          expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
            before,
          );
          expectProbeSplit(harness);
        },
      );
    },
  );

  it("EVT-16 rolls back all prior Event, Update, Evidence, alias, and FTS work on a later write failure", async () => {
    await withEventAnalysisIntegrationHarness(
      [
        p02([
          clue("Window Entity", "Window Subject"),
          clue("Old Standard Entity", "Old Standard Subject"),
        ]),
        p03([
          newUpdate(EVENT_SEARCH_FIXTURE_IDS.window, {
            title: "Rollback First Update",
            confirmed_aliases: ["Rollback Alias"],
          }),
          newUpdate(EVENT_SEARCH_FIXTURE_IDS.oldStandard, {
            title: "Rollback Failing Update",
          }),
        ]),
      ],
      async (harness) => {
        const before = snapshotEventSearchDatabase(harness.rawDatabase);
        let insertCount = 0;
        const failingRepository = replaceEventRepositoryMethod(
          harness,
          "insertUpdate",
          (record) => {
            insertCount += 1;
            if (insertCount === 2) {
              throw new Error(PRIVACY_SENTINELS.sql);
            }
            return harness.dependencies.eventRepository.insertUpdate(record);
          },
        );
        const error = await captureRejection(
          createEventAnalysis({
            ...harness.dependencies,
            eventRepository: failingRepository,
          }).analyze(EVENT_SEARCH_CURRENT_CONTENT_ID),
        );

        expectError(error, "event_analysis_failed");
        expect(harness.counts).toMatchObject({ search: 1, p02: 1, p03: 1 });
        expect(harness.observedDatabase.transactionCalls).toBe(1);
        expect(harness.rawDatabase.inTransaction).toBe(false);
        expect(snapshotEventSearchDatabase(harness.rawDatabase)).toEqual(
          before,
        );
        expect(harness.observedDatabase.ftsWriteTransactionStates).toEqual([]);
      },
    );
  });
});
