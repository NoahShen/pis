import type Database from "better-sqlite3";

import type { TopicRepository } from "../configuration/topic-repository.js";
import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { Clock } from "../time/clock.js";
import type { KnowledgeCategory } from "../knowledge/knowledge-repository.js";

import type { PublishedItemRepository } from "./published-item-repository.js";
import type { TopicAssociationRepository } from "./topic-association-repository.js";
import type { TopicMatchingErrorCode } from "./topic-matching-errors.js";
import type { TopicMatchingLogger } from "./topic-matching-logger.js";
import type { TopicMatchingTargetRepository } from "./topic-matching-target-repository.js";

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

export type TopicMatchingCalls = Pick<TypedLlmCalls, "matchTopics">;

export type TopicMatchingTopicRepository = Pick<TopicRepository, "listEnabled">;

export type TopicMatchingPublishedItemRepository = Pick<
  PublishedItemRepository,
  "existsForTarget"
>;

export interface TopicMatchingDependencies {
  readonly database: Database.Database;
  readonly targetRepository: TopicMatchingTargetRepository;
  readonly topicRepository: TopicMatchingTopicRepository;
  readonly associationRepository: TopicAssociationRepository;
  readonly publishedItemRepository: TopicMatchingPublishedItemRepository;
  readonly typedLlmCalls: TopicMatchingCalls;
  readonly clock: Clock;
  readonly logger: TopicMatchingLogger;
}

export type TopicMatchingFailureCode = Exclude<
  TopicMatchingErrorCode,
  "invalid_input" | "aborted"
>;

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
