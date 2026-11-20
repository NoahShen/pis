import type { TopicTargetType } from "../topic-matching/contracts.js";

export type PublicationTargetType = TopicTargetType;

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
