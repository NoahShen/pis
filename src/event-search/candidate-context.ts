import type Database from "better-sqlite3";

import type { EventCandidateHit } from "./event-candidate-repository.js";
import { EventSearchError } from "./event-search-errors.js";

export interface EventCandidateContextUpdate {
  id: string;
  event_id: string;
  title: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
}

export interface EventCandidateContext {
  id: string;
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
  updates: EventCandidateContextUpdate[];
}

interface EventRow {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

interface EventUpdateRow {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

const EVENT_CONTEXT_SQL = `
  SELECT
    id,
    title,
    entity_name,
    subject,
    scope,
    description,
    occurred_at,
    discovered_at
  FROM events
  WHERE id = ?
`;

const EVENT_HISTORY_CONTEXT_SQL = `
  SELECT
    id,
    event_id,
    title,
    description,
    occurred_at,
    discovered_at
  FROM event_updates
  WHERE event_id = ? ORDER BY discovered_at DESC, id DESC LIMIT ?
`;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new EventSearchError("aborted");
  }
}

function projectEvent(row: EventRow): Omit<EventCandidateContext, "updates"> {
  return {
    id: row.id,
    title: row.title,
    entity_name: row.entity_name,
    subject: row.subject,
    scope: row.scope,
    description: row.description,
    occurred_at: row.occurred_at,
    discovered_at: row.discovered_at,
  };
}

function projectUpdate(row: EventUpdateRow): EventCandidateContextUpdate {
  return {
    id: row.id,
    event_id: row.event_id,
    title: row.title,
    description: row.description,
    occurred_at: row.occurred_at,
    discovered_at: row.discovered_at,
  };
}

export function loadEventCandidateContexts(
  database: Database.Database,
  rankedHits: readonly EventCandidateHit[],
  maxUpdates: number,
  signal?: AbortSignal,
): EventCandidateContext[] {
  throwIfAborted(signal);
  if (rankedHits.length === 0) {
    return [];
  }

  const eventStatement = database.prepare<[string], EventRow>(
    EVENT_CONTEXT_SQL,
  );
  const updateStatement =
    maxUpdates > 0
      ? database.prepare<[string, number], EventUpdateRow>(
          EVENT_HISTORY_CONTEXT_SQL,
        )
      : undefined;
  const candidates: EventCandidateContext[] = [];

  for (const hit of rankedHits) {
    throwIfAborted(signal);
    const event = eventStatement.get(hit.eventId);
    throwIfAborted(signal);

    if (event === undefined) {
      continue;
    }

    let updates: EventCandidateContextUpdate[] = [];
    if (updateStatement !== undefined) {
      throwIfAborted(signal);
      const rows = updateStatement.all(hit.eventId, maxUpdates);
      throwIfAborted(signal);
      updates = rows.reverse().map(projectUpdate);
    }

    candidates.push({ ...projectEvent(event), updates });
  }

  return candidates;
}
