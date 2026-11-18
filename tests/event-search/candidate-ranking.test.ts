import { describe, expect, it } from "vitest";

import { rankEventCandidates } from "../../src/event-search/candidate-ranking.js";
import type {
  EventCandidateClueEvidence,
  EventCandidateHit,
} from "../../src/event-search/event-candidate-repository.js";

interface EvidenceOptions {
  readonly directEntityHit?: boolean;
  readonly aliasHit?: boolean;
  readonly ftsMatchedTerms?: readonly string[];
}

interface HitOptions {
  readonly discoveredAt?: string;
  readonly firstClueIndex?: number;
  readonly clueEvidence?: readonly EventCandidateClueEvidence[];
}

function evidence(
  clueIndex: number,
  options: EvidenceOptions = {},
): EventCandidateClueEvidence {
  return {
    clueIndex,
    directEntityHit: options.directEntityHit ?? false,
    aliasHit: options.aliasHit ?? false,
    ftsMatchedTerms: options.ftsMatchedTerms ?? [],
  };
}

function hit(eventId: string, options: HitOptions = {}): EventCandidateHit {
  return {
    eventId,
    discoveredAt: options.discoveredAt ?? "2026-11-18T08:00:00.000+08:00",
    firstClueIndex: options.firstClueIndex ?? 0,
    clueEvidence: options.clueEvidence ?? [evidence(0)],
  };
}

function rankedIds(
  hits: readonly EventCandidateHit[],
  maxCandidates: number,
): string[] {
  return rankEventCandidates(hits, maxCandidates).map(({ eventId }) => eventId);
}

describe("rankEventCandidates", () => {
  it("RANK_DIRECT treats direct and alias evidence as the same priority above FTS-only hits", () => {
    const hits = [
      hit("0-fts", {
        clueEvidence: [evidence(0, { ftsMatchedTerms: ["fts"] })],
      }),
      hit("z-direct", {
        clueEvidence: [
          evidence(2, { directEntityHit: true, ftsMatchedTerms: ["fts"] }),
        ],
      }),
      hit("b-alias", {
        clueEvidence: [
          evidence(1, { aliasHit: true, ftsMatchedTerms: ["fts"] }),
        ],
      }),
    ];

    expect(rankedIds(hits, 10)).toEqual(["b-alias", "z-direct", "0-fts"]);
  });

  it("RANK_CLUE_COUNT prioritizes the larger distinct clue evidence set", () => {
    const hits = [
      hit("z-one-clue", {
        clueEvidence: [evidence(0, { ftsMatchedTerms: ["same"] })],
      }),
      hit("a-two-clues", {
        clueEvidence: [
          evidence(0, { ftsMatchedTerms: ["same"] }),
          evidence(1, { ftsMatchedTerms: ["same"] }),
        ],
      }),
    ];

    expect(rankedIds(hits, 10)).toEqual(["a-two-clues", "z-one-clue"]);
  });

  it("RANK_FTS_COUNT counts the cross-clue union without inflating duplicate terms", () => {
    const hits = [
      hit("a-repeated", {
        clueEvidence: [
          evidence(0, { ftsMatchedTerms: ["same"] }),
          evidence(1, { ftsMatchedTerms: ["same"] }),
        ],
      }),
      hit("z-distinct", {
        clueEvidence: [
          evidence(0, { ftsMatchedTerms: ["same", "alpha"] }),
          evidence(1, { ftsMatchedTerms: ["beta"] }),
        ],
      }),
    ];

    expect(rankedIds(hits, 10)).toEqual(["z-distinct", "a-repeated"]);
  });

  it("RANK_TIME_ID uses discoveredAt DESC, eventId BINARY ASC, and ignores firstClueIndex", () => {
    const sameTime = "2026-11-18T08:00:00.000+08:00";
    const hits = [
      hit("event-z", { discoveredAt: sameTime, firstClueIndex: 0 }),
      hit("event-a", { discoveredAt: sameTime, firstClueIndex: 99 }),
      hit("event-old", {
        discoveredAt: "2016-01-10T08:00:00.000+08:00",
        firstClueIndex: 0,
      }),
    ];

    expect(rankedIds(hits, 10)).toEqual(["event-a", "event-z", "event-old"]);
  });

  it("CANDIDATE_LIMIT fully orders all hits before slicing at 1, 10, and 50", () => {
    const hits = Array.from({ length: 51 }, (_, index) =>
      hit(`event-${String(index).padStart(2, "0")}`, {
        discoveredAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
      }),
    ).reverse();
    const originalOrder = hits.map(({ eventId }) => eventId);
    const fullyRanked = rankedIds(hits, hits.length);
    const expectedAtMost = (limit: number): string[] =>
      fullyRanked.slice(0, limit);

    expect(rankedIds(hits, 1)).toEqual(expectedAtMost(1));
    expect(rankedIds(hits, 10)).toEqual(expectedAtMost(10));
    expect(rankedIds(hits, 50)).toEqual(expectedAtMost(50));
    expect(rankedIds(hits, 1)).toEqual(["event-50"]);
    expect(rankedIds(hits, 10)).toEqual(
      Array.from(
        { length: 10 },
        (_, offset) => `event-${String(50 - offset).padStart(2, "0")}`,
      ),
    );
    expect(hits.map(({ eventId }) => eventId)).toEqual(originalOrder);
  });
});
