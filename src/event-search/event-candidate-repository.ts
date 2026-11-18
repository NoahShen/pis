import type Database from "better-sqlite3";

import { toFtsPhrase } from "./fts-phrase.js";

export interface EventCandidateClue {
  readonly entity_name: string;
  readonly subject: string;
  readonly search_terms: readonly string[];
}

export interface EventCandidateClueEvidence {
  readonly clueIndex: number;
  readonly directEntityHit: boolean;
  readonly aliasHit: boolean;
  readonly ftsMatchedTerms: readonly string[];
}

export interface EventCandidateHit {
  readonly eventId: string;
  readonly discoveredAt: string;
  readonly firstClueIndex: number;
  readonly clueEvidence: readonly EventCandidateClueEvidence[];
}

export interface EventCandidateSearchResult {
  readonly hits: readonly EventCandidateHit[];
  readonly ignoredIndexRows: number;
}

export interface EventCandidateRepository {
  search(clues: readonly EventCandidateClue[]): EventCandidateSearchResult;
}

interface EventRow {
  readonly id: string;
  readonly discovered_at: string;
}

interface FtsRow {
  readonly index_row_id: number;
  readonly matched_event_id: string | null;
  readonly discovered_at: string | null;
}

interface MutableClueEvidence {
  readonly clueIndex: number;
  directEntityHit: boolean;
  aliasHit: boolean;
  readonly ftsMatchedTerms: string[];
}

interface MutableHit {
  readonly eventId: string;
  readonly discoveredAt: string;
  firstClueIndex: number;
  readonly clueEvidence: MutableClueEvidence[];
}

const DIRECT_ENTITY_SQL = `
  SELECT id, discovered_at
  FROM events
  WHERE entity_name = ? COLLATE BINARY
`;

const ALIAS_SQL = `
  SELECT events.id, events.discovered_at
  FROM event_entity_aliases
  JOIN events ON events.id = event_entity_aliases.event_id
  WHERE event_entity_aliases.alias = ? COLLATE BINARY
`;

// The left join preserves orphan FTS rows so they can be counted safely while
// still ensuring only real Events enter the candidate hits.
const FTS_SQL = `
  SELECT
    event_search.rowid AS index_row_id,
    events.id AS matched_event_id,
    events.discovered_at AS discovered_at
  FROM event_search
  LEFT JOIN events ON events.id = event_search.event_id
  WHERE event_search MATCH ?
`;

function ftsTermsForClue(clue: EventCandidateClue): readonly string[] {
  const terms = [clue.entity_name, clue.subject, ...clue.search_terms].filter(
    (term) => term.trim().length > 0,
  );

  return [...new Set(terms)];
}

function getClueEvidence(
  hit: MutableHit,
  clueIndex: number,
): MutableClueEvidence {
  const existing = hit.clueEvidence.find(
    (evidence) => evidence.clueIndex === clueIndex,
  );
  if (existing !== undefined) {
    return existing;
  }

  const evidence: MutableClueEvidence = {
    clueIndex,
    directEntityHit: false,
    aliasHit: false,
    ftsMatchedTerms: [],
  };
  hit.clueEvidence.push(evidence);
  return evidence;
}

export class SqliteEventCandidateRepository implements EventCandidateRepository {
  constructor(private readonly database: Database.Database) {}

  search(clues: readonly EventCandidateClue[]): EventCandidateSearchResult {
    if (clues.length === 0) {
      return { hits: [], ignoredIndexRows: 0 };
    }

    const hitsByEventId = new Map<string, MutableHit>();
    const ignoredIndexRowIds = new Set<number>();
    const directStatement = this.database.prepare<[string], EventRow>(
      DIRECT_ENTITY_SQL,
    );
    const aliasStatement = this.database.prepare<[string], EventRow>(ALIAS_SQL);
    const ftsStatement = this.database.prepare<[string], FtsRow>(FTS_SQL);

    const getHit = (
      eventId: string,
      discoveredAt: string,
      clueIndex: number,
    ): MutableHit => {
      const existing = hitsByEventId.get(eventId);
      if (existing !== undefined) {
        if (clueIndex < existing.firstClueIndex) {
          existing.firstClueIndex = clueIndex;
        }
        return existing;
      }

      const hit: MutableHit = {
        eventId,
        discoveredAt,
        firstClueIndex: clueIndex,
        clueEvidence: [],
      };
      hitsByEventId.set(eventId, hit);
      return hit;
    };

    for (const [clueIndex, clue] of clues.entries()) {
      for (const row of directStatement.all(clue.entity_name)) {
        const hit = getHit(row.id, row.discovered_at, clueIndex);
        getClueEvidence(hit, clueIndex).directEntityHit = true;
      }

      for (const row of aliasStatement.all(clue.entity_name)) {
        const hit = getHit(row.id, row.discovered_at, clueIndex);
        getClueEvidence(hit, clueIndex).aliasHit = true;
      }

      for (const term of ftsTermsForClue(clue)) {
        for (const row of ftsStatement.all(toFtsPhrase(term))) {
          if (row.matched_event_id === null || row.discovered_at === null) {
            ignoredIndexRowIds.add(row.index_row_id);
            continue;
          }

          const hit = getHit(
            row.matched_event_id,
            row.discovered_at,
            clueIndex,
          );
          const evidence = getClueEvidence(hit, clueIndex);
          if (!evidence.ftsMatchedTerms.includes(term)) {
            evidence.ftsMatchedTerms.push(term);
          }
        }
      }
    }

    return {
      hits: [...hitsByEventId.values()],
      ignoredIndexRows: ignoredIndexRowIds.size,
    };
  }
}
