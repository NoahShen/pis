import { describe, expect, it, vi } from "vitest";

import type {
  EventCandidate,
  EventCandidateUpdate,
} from "../../src/event-search/contracts.js";
import {
  buildEventAnalysisReferences,
  buildEventAnalysisTaskData,
  loadEventAnalysisContent,
} from "../../src/event-analysis/content-input.js";
import {
  createSyntheticContent,
  PRIVACY_SENTINELS,
} from "../fixtures/event-search.js";

type CandidateWithExtras = EventCandidate & {
  readonly clues: readonly string[];
  readonly score: number;
  readonly source: string;
  readonly reason: string;
  readonly search_terms: readonly string[];
};

type UpdateWithExtras = EventCandidateUpdate & {
  readonly clues: readonly string[];
  readonly score: number;
  readonly source: string;
};

function candidate(
  id: string,
  updateIds: readonly string[],
): CandidateWithExtras {
  return {
    id,
    title: `${id} title`,
    entity_name: `${id} entity`,
    subject: `${id} subject`,
    scope: `${id} scope`,
    description: `${id} description`,
    occurred_at: null,
    discovered_at: "2026-11-19T08:00:00.000+08:00",
    updates: updateIds.map((updateId): UpdateWithExtras => ({
      id: updateId,
      event_id: id,
      title: `${updateId} title`,
      description: `${updateId} description`,
      occurred_at: "2026-11-19T09:00:00.000+08:00",
      discovered_at: "2026-11-19T09:01:00.000+08:00",
      clues: [PRIVACY_SENTINELS.history],
      score: 99,
      source: PRIVACY_SENTINELS.raw,
    })),
    clues: [PRIVACY_SENTINELS.history],
    score: 42,
    source: PRIVACY_SENTINELS.raw,
    reason: "candidates",
    search_terms: [PRIVACY_SENTINELS.topic],
  };
}

describe("event analysis content input", () => {
  it("TASK_DATA / PRIVACY loads one Content and projects exactly six fields", () => {
    const content = createSyntheticContent();
    const getById = vi.fn(() => content);

    const projected = loadEventAnalysisContent(
      { getById },
      PRIVACY_SENTINELS.contentId,
    );

    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith(PRIVACY_SENTINELS.contentId);
    expect(projected).toEqual({
      title: "Synthetic Content Title",
      body: `Synthetic Content Body ${PRIVACY_SENTINELS.body}`,
      summary: "Synthetic Content Summary",
      author: "Synthetic Author",
      published_at: "2026-11-18T09:30:00.000+08:00",
      completeness: "PARTIAL",
    });
    expect(Object.keys(projected ?? {}).sort()).toEqual([
      "author",
      "body",
      "completeness",
      "published_at",
      "summary",
      "title",
    ]);

    const serialized = JSON.stringify(projected);
    for (const sentinel of [
      PRIVACY_SENTINELS.contentId,
      PRIVACY_SENTINELS.raw,
      PRIVACY_SENTINELS.topic,
      PRIVACY_SENTINELS.history,
      PRIVACY_SENTINELS.token,
      "https://synthetic-content.example.test/article",
      "created_at",
      "language",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("MISSING returns null after exactly one Content read", () => {
    const getById = vi.fn(() => null);

    expect(
      loadEventAnalysisContent({ getById }, "missing-content-id"),
    ).toBeNull();
    expect(getById).toHaveBeenCalledTimes(1);
    expect(getById).toHaveBeenCalledWith("missing-content-id");
  });

  it("TASK_DATA / CANDIDATE_PROJECTION rebuilds only the approved Content and candidate DTO fields", () => {
    const sourceCandidate = candidate("event-b", ["update-b-1"]);
    const taskData = buildEventAnalysisTaskData(
      {
        ...createSyntheticContent(),
      },
      [sourceCandidate],
    );

    expect(Object.keys(taskData)).toEqual(["content", "candidates"]);
    expect(Object.keys(taskData.content).sort()).toEqual([
      "author",
      "body",
      "completeness",
      "published_at",
      "summary",
      "title",
    ]);
    expect(Object.keys(taskData.candidates[0] ?? {}).sort()).toEqual([
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
    expect(
      Object.keys(taskData.candidates[0]?.updates[0] ?? {}).sort(),
    ).toEqual([
      "description",
      "discovered_at",
      "event_id",
      "id",
      "occurred_at",
      "title",
    ]);

    const serialized = JSON.stringify(taskData);
    for (const forbidden of [
      "clues",
      "score",
      "source",
      "search_terms",
      "reason",
      "user_context",
      "topics",
      "knowledge",
      "raw_data",
      PRIVACY_SENTINELS.contentId,
      PRIVACY_SENTINELS.raw,
      PRIVACY_SENTINELS.topic,
      PRIVACY_SENTINELS.history,
      PRIVACY_SENTINELS.token,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("REFERENCES preserves candidate order, maps Updates to their Event, and excludes D08 metadata", () => {
    const candidates = [
      candidate("event-b", ["update-b-2", "update-b-1"]),
      candidate("event-a", ["update-a-1"]),
    ];

    const references = buildEventAnalysisReferences(candidates);

    expect(references).toEqual({
      candidateEventIds: ["event-b", "event-a"],
      eventIdByUpdateId: {
        "update-b-2": "event-b",
        "update-b-1": "event-b",
        "update-a-1": "event-a",
      },
    });
    expect(Object.keys(references.eventIdByUpdateId)).toEqual([
      "update-b-2",
      "update-b-1",
      "update-a-1",
    ]);
  });

  it("REFERENCES snapshots candidate values before later caller mutation", () => {
    const candidates = [candidate("event-original", ["update-original"])];
    const taskData = buildEventAnalysisTaskData(
      {
        title: "Original content",
        body: "Original body",
        summary: null,
        author: null,
        published_at: null,
        completeness: "FULL",
      },
      candidates,
    );
    const references = buildEventAnalysisReferences(candidates);

    candidates[0]!.id = "event-mutated";
    candidates[0]!.updates[0]!.id = "update-mutated";
    candidates[0]!.updates.push({
      id: "update-added",
      event_id: "event-mutated",
      title: "Added update",
      description: "Added update description",
      occurred_at: null,
      discovered_at: "2026-11-19T10:00:00.000+08:00",
    });

    expect(taskData.candidates[0]?.id).toBe("event-original");
    expect(taskData.candidates[0]?.updates.map(({ id }) => id)).toEqual([
      "update-original",
    ]);
    expect(references).toEqual({
      candidateEventIds: ["event-original"],
      eventIdByUpdateId: { "update-original": "event-original" },
    });
  });
});
