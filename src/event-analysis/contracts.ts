import type Database from "better-sqlite3";

import type { EventSearchReason } from "../event-search/contracts.js";
import type { EventSearchService } from "../event-search/contracts.js";
import type { IdGenerator } from "../id/id-generator.js";
import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { ContentRepository } from "../processing/content-repository.js";
import type { Clock } from "../time/clock.js";

import type { EventRepository } from "./event-repository.js";
import type { EventAnalysisErrorCode } from "./event-analysis-errors.js";

export type EventTargetType = "EVENT" | "EVENT_UPDATE";

export interface EventAnalysisTarget {
  target_type: EventTargetType;
  target_id: string;
}

export interface EventAnalysisResult {
  new_targets: EventAnalysisTarget[];
}

export interface EventAnalysisOptions {
  readonly signal?: AbortSignal;
}

export interface EventAnalysisService {
  analyze(
    contentId: string,
    options?: EventAnalysisOptions,
  ): Promise<EventAnalysisResult>;
}

export type EventAnalysisContent = {
  readonly title: string;
  readonly body: string;
  readonly summary: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly completeness: "FULL" | "PARTIAL";
};

export type EventAnalysisCandidateUpdate = {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
};

export type EventAnalysisCandidate = {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
  readonly updates: EventAnalysisCandidateUpdate[];
};

export type EventAnalysisLogStage = "check" | "search" | "analyze" | "persist";

export type EventAnalysisLogReason = EventAnalysisErrorCode | EventSearchReason;

export interface EventAnalysisLogMetadata {
  readonly contentId?: string;
  readonly candidateCount?: number;
  readonly resultCount?: number;
  readonly newTargetCount?: number;
  readonly stage: EventAnalysisLogStage;
  readonly reason?: EventAnalysisLogReason;
}

export interface EventAnalysisLogger {
  log(metadata: EventAnalysisLogMetadata): void | PromiseLike<void>;
}

export interface EventAnalysisDependencies {
  readonly database: Database.Database;
  readonly contentRepository: Pick<ContentRepository, "getById">;
  readonly eventSearch: EventSearchService;
  readonly typedLlmCalls: Pick<TypedLlmCalls, "analyzeEvents">;
  readonly eventRepository: EventRepository;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: EventAnalysisLogger;
}
