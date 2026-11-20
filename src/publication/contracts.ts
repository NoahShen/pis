import type Database from "better-sqlite3";

import type { IdGenerator } from "../id/id-generator.js";
import type { TopicTargetType } from "../topic-matching/contracts.js";
import type { Clock } from "../time/clock.js";

export type PublicationTargetType = TopicTargetType;

export type PublicationErrorCode =
  "invalid_input" | "aborted" | "publication_failed";

export interface PublishResult {
  readonly published_item_id: string | null;
  readonly already_published: boolean;
}

export interface PublicationService {
  publish(
    targetType: PublicationTargetType,
    targetId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PublishResult>;
}

export interface PublicationEvent {
  readonly id: string;
  readonly title: string;
  readonly entityName: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
}

export interface PublicationEventSummary {
  readonly id: string;
  readonly title: string;
  readonly entityName: string;
  readonly subject: string;
  readonly scope: string;
}

export interface PublicationUpdate {
  readonly id: string;
  readonly eventId: string;
  readonly title: string;
  readonly description: string;
}

export interface PublicationFinding {
  readonly title: string;
  readonly description: string;
}

export interface PublicationKnowledge {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string | null;
  readonly findings: ReadonlyArray<PublicationFinding>;
  readonly value: string;
}

export type PublicationContext =
  | {
      readonly targetType: "EVENT";
      readonly event: PublicationEvent;
      readonly occurredAt: string | null;
    }
  | {
      readonly targetType: "EVENT_UPDATE";
      readonly update: PublicationUpdate;
      readonly parentEvent: PublicationEventSummary;
      readonly occurredAt: string | null;
    }
  | {
      readonly targetType: "KNOWLEDGE";
      readonly knowledge: PublicationKnowledge;
    };

export interface PublicationDraft {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

export interface PublicationRenderer {
  render(context: PublicationContext): PublicationDraft;
}

export interface PublicationSourceLinkRepository {
  listSourceUrls(
    targetType: PublicationTargetType,
    targetId: string,
  ): readonly string[];
}

export interface PublishedItem {
  readonly id: string;
  readonly target_type: PublicationTargetType;
  readonly target_id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly published_at: string;
}

export interface PublishedItemInsert extends PublishedItem {}

export type PublicationFeed = "EVENT" | "KNOWLEDGE";

export interface PublishedItemRepository {
  findByTarget(
    targetType: PublicationTargetType,
    targetId: string,
  ): PublishedItem | null;
  insert(item: PublishedItemInsert): PublishedItem;
  listForFeed(feed: PublicationFeed): readonly PublishedItem[];
}

export interface PublicationTargetRepository {
  getContext(
    targetType: PublicationTargetType,
    targetId: string,
  ): PublicationContext | null;
  hasAnyTopicAssociation(
    targetType: PublicationTargetType,
    targetId: string,
  ): boolean;
}

export interface PublicationNotifier {
  notify(feed: PublicationFeed): void | Promise<void>;
}

export type PublicationLogStage = "check" | "render" | "persist" | "notify";

export type PublicationLogReason = PublicationErrorCode | "notify_failed";

export interface PublicationLogEntry {
  readonly targetType?: PublicationTargetType;
  readonly targetId?: string;
  readonly stage: PublicationLogStage;
  readonly reason?: PublicationLogReason;
  readonly sourceLinkCount?: number;
  readonly publishedItemId?: string;
  readonly durationMs?: number;
}

export type PublicationLogger = (
  entry: PublicationLogEntry,
) => void | Promise<void>;

export interface PublicationDependencies {
  readonly database: Database.Database;
  readonly targetRepository: PublicationTargetRepository;
  readonly sourceLinkRepository: PublicationSourceLinkRepository;
  readonly publishedItemRepository: PublishedItemRepository;
  readonly renderer?: PublicationRenderer;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger?: PublicationLogger;
  readonly notify?: PublicationNotifier;
  readonly maxSourceLinks?: number;
}
