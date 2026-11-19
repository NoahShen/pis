import type { KnowledgeCategory } from "../knowledge/knowledge-repository.js";

export type TopicTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

export interface TopicMatchingResult {
  readonly should_publish: boolean;
  readonly target_type: TopicTargetType;
  readonly target_id: string;
}

export interface TopicMatchingOptions {
  readonly signal?: AbortSignal;
}

export interface TopicMatchingService {
  match(
    targetType: TopicTargetType,
    targetId: string,
    options?: TopicMatchingOptions,
  ): Promise<TopicMatchingResult>;
}

export interface EventTopicTarget {
  readonly target_type: "EVENT";
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
}

export interface EventTopicBackground {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
}

export interface EventUpdateTopicTarget {
  readonly target_type: "EVENT_UPDATE";
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly event: EventTopicBackground;
}

export interface KnowledgeTopicFinding {
  readonly title: string;
  readonly description: string;
}

export interface KnowledgeTopicTarget {
  readonly target_type: "KNOWLEDGE";
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: KnowledgeCategory;
  readonly findings: readonly KnowledgeTopicFinding[];
  readonly value: string;
}

export type TopicMatchingTarget =
  EventTopicTarget | EventUpdateTopicTarget | KnowledgeTopicTarget;
