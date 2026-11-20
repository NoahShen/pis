import type {
  PublicationContext,
  PublicationEvent,
  PublicationEventSummary,
  PublicationFinding,
  PublicationKnowledge,
  PublicationUpdate,
} from "../../src/publication/contracts.js";

export const publicationEventFixture: PublicationEvent = {
  id: "publication-event-synthetic",
  title: "Synthetic Event Title",
  entityName: "Synthetic Event Entity",
  subject: "Synthetic Event Subject",
  scope: "Synthetic Event Scope",
  description: "Synthetic Event Description",
};

export const publicationUpdateFixture: PublicationUpdate = {
  id: "publication-update-synthetic",
  eventId: publicationEventFixture.id,
  title: "Synthetic Update Title",
  description: "Synthetic Update Description",
};

export const publicationParentEventFixture: PublicationEventSummary = {
  id: publicationEventFixture.id,
  title: publicationEventFixture.title,
  entityName: publicationEventFixture.entityName,
  subject: publicationEventFixture.subject,
  scope: publicationEventFixture.scope,
};

export const publicationFindingFixtures: readonly PublicationFinding[] = [
  {
    title: "Synthetic Finding One",
    description: "Synthetic finding one description",
  },
  {
    title: "Synthetic Finding Two",
    description: "Synthetic finding two description",
  },
];

export const publicationKnowledgeFixture: PublicationKnowledge = {
  id: "publication-knowledge-synthetic",
  title: "Synthetic Knowledge Title",
  summary: "Synthetic Knowledge Summary",
  category: "Insight",
  findings: publicationFindingFixtures,
  value: "Synthetic Knowledge Value",
};

export type PublicationEventContext = Extract<
  PublicationContext,
  { readonly targetType: "EVENT" }
>;
export type PublicationUpdateContext = Extract<
  PublicationContext,
  { readonly targetType: "EVENT_UPDATE" }
>;
export type PublicationKnowledgeContext = Extract<
  PublicationContext,
  { readonly targetType: "KNOWLEDGE" }
>;

export function createPublicationEventContext(
  overrides: Partial<PublicationEvent> = {},
  occurredAt: string | null = "2026-11-20T08:00:00.000+08:00",
): PublicationEventContext {
  return {
    targetType: "EVENT",
    event: { ...publicationEventFixture, ...overrides },
    occurredAt,
  };
}

export interface PublicationUpdateContextOptions {
  readonly update?: Partial<PublicationUpdate>;
  readonly parentEvent?: Partial<PublicationEventSummary>;
  readonly occurredAt?: string | null;
}

export function createPublicationUpdateContext(
  options: PublicationUpdateContextOptions = {},
): PublicationUpdateContext {
  return {
    targetType: "EVENT_UPDATE",
    update: { ...publicationUpdateFixture, ...options.update },
    parentEvent: { ...publicationParentEventFixture, ...options.parentEvent },
    occurredAt:
      options.occurredAt === undefined
        ? "2026-11-20T09:00:00.000+08:00"
        : options.occurredAt,
  };
}

export interface PublicationKnowledgeContextOptions {
  readonly knowledge?: Partial<Omit<PublicationKnowledge, "findings">>;
  readonly findings?: readonly PublicationFinding[];
}

export function createPublicationKnowledgeContext(
  options: PublicationKnowledgeContextOptions = {},
): PublicationKnowledgeContext {
  return {
    targetType: "KNOWLEDGE",
    knowledge: {
      ...publicationKnowledgeFixture,
      ...options.knowledge,
      findings: options.findings ?? publicationKnowledgeFixture.findings,
    },
  };
}

export function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}
