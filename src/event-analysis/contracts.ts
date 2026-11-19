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
