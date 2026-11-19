import type Database from "better-sqlite3";

import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { ContentRepository } from "../processing/content-repository.js";

import type { EventCandidateRepository } from "./event-candidate-repository.js";
import type { EventSearchLogger } from "./event-search-logger.js";

export type { EventSearchErrorCode } from "./event-search-errors.js";
export type {
  EventSearchLogger,
  EventSearchLogMetadata,
  EventSearchLogReason,
  EventSearchLogStage,
} from "./event-search-logger.js";

export interface EventSearchOptions {
  readonly signal?: AbortSignal;
}

export type EventSearchReason =
  "missing_content" | "empty_clues" | "no_candidates" | "candidates";

export interface EventSearchResult {
  candidates: EventCandidate[];
  readonly reason?: EventSearchReason;
}

export interface EventSearchService {
  search(
    contentId: string,
    options?: EventSearchOptions,
  ): Promise<EventSearchResult>;
}

export interface EventCandidate {
  id: string;
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
  updates: EventCandidateUpdate[];
}

export interface EventCandidateUpdate {
  id: string;
  event_id: string;
  title: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
}

type EventSearchContentReader = Pick<ContentRepository, "getById">;
type EventSearchCalls = Pick<TypedLlmCalls, "searchEvents">;

export interface EventSearchDependencies {
  readonly database: Database.Database;
  readonly contentRepository: EventSearchContentReader;
  readonly candidateRepository: EventCandidateRepository;
  readonly typedLlmCalls: EventSearchCalls;
  readonly logger: EventSearchLogger;
  readonly maxCandidates?: number;
  readonly maxUpdates?: number;
}
