import type { EventCandidateHit } from "./event-candidate-repository.js";

interface RankedHit {
  readonly hit: EventCandidateHit;
  readonly directHit: boolean;
  readonly clueCount: number;
  readonly ftsTermCount: number;
}

function compareBinary(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareRankedHits(left: RankedHit, right: RankedHit): number {
  if (left.directHit !== right.directHit) {
    return left.directHit ? -1 : 1;
  }

  if (left.clueCount !== right.clueCount) {
    return right.clueCount - left.clueCount;
  }

  if (left.ftsTermCount !== right.ftsTermCount) {
    return right.ftsTermCount - left.ftsTermCount;
  }

  const discoveredComparison = compareBinary(
    right.hit.discoveredAt,
    left.hit.discoveredAt,
  );
  if (discoveredComparison !== 0) {
    return discoveredComparison;
  }

  return compareBinary(left.hit.eventId, right.hit.eventId);
}

export function rankEventCandidates(
  hits: readonly EventCandidateHit[],
  maxCandidates: number,
): EventCandidateHit[] {
  const ranked = hits
    .map((hit): RankedHit => {
      const uniqueFtsTerms = new Set<string>();
      for (const evidence of hit.clueEvidence) {
        for (const term of evidence.ftsMatchedTerms) {
          uniqueFtsTerms.add(term);
        }
      }

      return {
        hit,
        directHit: hit.clueEvidence.some(
          (evidence) => evidence.directEntityHit || evidence.aliasHit,
        ),
        clueCount: hit.clueEvidence.length,
        ftsTermCount: uniqueFtsTerms.size,
      };
    })
    .sort(compareRankedHits)
    .map(({ hit }) => hit);

  return ranked.slice(0, maxCandidates);
}
