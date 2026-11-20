import Database from "better-sqlite3";

import { initializeDatabase } from "../../src/database/schema.js";
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

export const publicationSourceLinkFixtureIds = {
  source: "publication-source-link-source",
  event: "publication-source-link-event",
  contentOnlyEvent: "publication-source-link-event-content-only",
  update: "publication-source-link-update",
  knowledge: "publication-source-link-knowledge",
  fallbackKnowledge: "publication-source-link-knowledge-fallback",
  contentOnlyKnowledge: "publication-source-link-knowledge-content-only",
} as const;

export const publicationSourceLinkFixtureUrls = {
  eventPriority: "https://event.example.test/priority",
  eventFallback: "https://event.example.test/fallback",
  eventContentOnly: "https://event.example.test/content-only",
  eventUpdate: "https://event.example.test/update-only",
  knowledgeSource: "https://knowledge.example.test/source",
  knowledgeFallback: "https://knowledge.example.test/fallback",
  knowledgeContentOnly: "https://knowledge.example.test/content-only",
} as const;

export function seedPublicationSourceLinkFixture(
  database: Database.Database,
): void {
  const seed = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO sources (id, name, type, url, cron, enabled)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        publicationSourceLinkFixtureIds.source,
        "Synthetic publication source",
        "RSS",
        "https://fixture.example.test/feed.xml",
        "0 * * * *",
        1,
      );

    const insertContent = database.prepare(
      `
        INSERT INTO contents (
          id, title, url, author, published_at, created_at, body, summary,
          language, completeness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const addContent = (id: string, url: string | null): void => {
      insertContent.run(
        id,
        `Synthetic content ${id}`,
        url,
        null,
        null,
        "2026-11-20T08:00:00.000+08:00",
        `Synthetic body for ${id}`,
        null,
        "en",
        "FULL",
      );
    };

    const insertSourceItem = database.prepare(
      `
        INSERT INTO source_items (
          id, source_id, external_id, url, title, published_at, discovered_at,
          content_id, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const addSourceItem = (
      id: string,
      contentId: string,
      url: string | null,
      discoveredAt: string,
    ): void => {
      insertSourceItem.run(
        id,
        publicationSourceLinkFixtureIds.source,
        null,
        url,
        null,
        null,
        discoveredAt,
        contentId,
        null,
      );
    };

    const insertEvent = database.prepare(
      `
        INSERT INTO events (
          id, title, entity_name, subject, scope, description, occurred_at,
          discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertEvent.run(
      publicationSourceLinkFixtureIds.event,
      "Synthetic evidence Event",
      "Synthetic entity",
      "Synthetic subject",
      "Synthetic scope",
      "Synthetic event description",
      null,
      "2026-11-20T08:00:00.000+08:00",
    );
    insertEvent.run(
      publicationSourceLinkFixtureIds.contentOnlyEvent,
      "Synthetic content-only Event",
      "Synthetic entity",
      "Synthetic subject",
      "Synthetic scope",
      "Synthetic content-only event description",
      null,
      "2026-11-20T08:00:00.000+08:00",
    );

    database
      .prepare(
        `
          INSERT INTO event_updates (
            id, event_id, title, description, occurred_at, discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        publicationSourceLinkFixtureIds.update,
        publicationSourceLinkFixtureIds.event,
        "Synthetic evidence Update",
        "Synthetic update description",
        null,
        "2026-11-20T09:00:00.000+08:00",
      );

    addContent(
      "publication-content-event-priority",
      "https://event.example.test/content-priority",
    );
    addContent(
      "publication-content-event-fallback",
      publicationSourceLinkFixtureUrls.eventFallback,
    );
    addContent("publication-content-event-empty", null);
    addContent(
      "publication-content-event-duplicate",
      "https://event.example.test/content-duplicate",
    );
    addContent("publication-content-event-javascript", null);
    addContent("publication-content-event-userinfo", null);
    addContent("publication-content-event-control", null);
    addContent(
      "publication-content-event-content-only",
      publicationSourceLinkFixtureUrls.eventContentOnly,
    );
    addContent(
      "publication-content-event-update",
      "https://event.example.test/content-update",
    );
    addContent(
      "publication-content-knowledge-source",
      "https://knowledge.example.test/content-source",
    );
    addContent(
      "publication-content-knowledge-fallback",
      publicationSourceLinkFixtureUrls.knowledgeFallback,
    );
    addContent(
      "publication-content-knowledge-content-only",
      publicationSourceLinkFixtureUrls.knowledgeContentOnly,
    );

    const insertKnowledge = database.prepare(
      `
        INSERT INTO knowledge (
          id, content_id, title, summary, category, findings_json, value
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    for (const [knowledgeId, contentId] of [
      [
        publicationSourceLinkFixtureIds.knowledge,
        "publication-content-knowledge-source",
      ],
      [
        publicationSourceLinkFixtureIds.fallbackKnowledge,
        "publication-content-knowledge-fallback",
      ],
      [
        publicationSourceLinkFixtureIds.contentOnlyKnowledge,
        "publication-content-knowledge-content-only",
      ],
    ] as const) {
      insertKnowledge.run(
        knowledgeId,
        contentId,
        "Synthetic evidence Knowledge",
        "Synthetic knowledge summary",
        "Insight",
        "[]",
        "Synthetic knowledge value",
      );
    }

    addSourceItem(
      "publication-source-item-event-priority",
      "publication-content-event-priority",
      `  ${publicationSourceLinkFixtureUrls.eventPriority}  `,
      "2026-11-20T09:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-fallback",
      "publication-content-event-fallback",
      "   ",
      "2026-11-20T10:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-empty",
      "publication-content-event-empty",
      "   ",
      "2026-11-20T11:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-duplicate",
      "publication-content-event-duplicate",
      publicationSourceLinkFixtureUrls.eventPriority,
      "2026-11-20T12:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-javascript",
      "publication-content-event-javascript",
      "javascript:alert(1)",
      "2026-11-20T13:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-userinfo",
      "publication-content-event-userinfo",
      "https://user:password@event.example.test/private",
      "2026-11-20T14:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-control",
      "publication-content-event-control",
      "https://event.example.test/control\nsynthetic",
      "2026-11-20T15:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-event-update",
      "publication-content-event-update",
      publicationSourceLinkFixtureUrls.eventUpdate,
      "2026-11-20T16:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-knowledge-source",
      "publication-content-knowledge-source",
      publicationSourceLinkFixtureUrls.knowledgeSource,
      "2026-11-20T09:00:00.000+08:00",
    );
    addSourceItem(
      "publication-source-item-knowledge-fallback",
      "publication-content-knowledge-fallback",
      "   ",
      "2026-11-20T10:00:00.000+08:00",
    );

    const insertEventLink = database.prepare(
      `
        INSERT INTO event_content_links (target_type, target_id, content_id)
        VALUES (?, ?, ?)
      `,
    );
    for (const [targetType, targetId, contentId] of [
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-priority",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-fallback",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-empty",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-duplicate",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-javascript",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-userinfo",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.event,
        "publication-content-event-control",
      ],
      [
        "EVENT",
        publicationSourceLinkFixtureIds.contentOnlyEvent,
        "publication-content-event-content-only",
      ],
      [
        "EVENT_UPDATE",
        publicationSourceLinkFixtureIds.update,
        "publication-content-event-update",
      ],
    ] as const) {
      insertEventLink.run(targetType, targetId, contentId);
    }
  });

  seed();
}

export function createPublicationSourceLinkFixtureDatabase(): Database.Database {
  const database = new Database(":memory:");

  try {
    initializeDatabase(database);
    seedPublicationSourceLinkFixture(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
