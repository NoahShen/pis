import Database from "better-sqlite3";
import path from "node:path";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import type {
  PublicationContext,
  PublicationDependencies,
  PublicationDraft,
  PublicationFeed,
  PublicationEvent,
  PublicationEventSummary,
  PublicationFinding,
  PublicationKnowledge,
  PublicationLogger,
  PublicationNotifier,
  PublicationRenderer,
  PublicationService,
  PublicationSourceLinkRepository,
  PublicationTargetRepository,
  PublicationTargetType,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
  PublicationUpdate,
} from "../../src/publication/contracts.js";
import { createPublication } from "../../src/publication/publication.js";
import { SqlitePublicationSourceLinkRepository } from "../../src/publication/source-link-repository.js";
import { SqlitePublicationTargetRepository } from "../../src/publication/publication-target-repository.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import { TemplatePublicationRenderer } from "../../src/publication/template-renderer.js";
import type { Clock } from "../../src/time/clock.js";
import type { IdGenerator } from "../../src/id/id-generator.js";
import { closeDatabase, withDatabasePath } from "./database.js";

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

export const publicationFixtureIds = {
  source: "publication-target-source",
  eventContent: "publication-target-content-event",
  updateContent: "publication-target-content-update",
  knowledgeContent: "publication-target-content-knowledge",
  eventSourceItem: "publication-target-source-item-event",
  updateSourceItem: "publication-target-source-item-update",
  knowledgeSourceItem: "publication-target-source-item-knowledge",
  event: "publication-target-event",
  update: "publication-target-update",
  knowledge: "publication-target-knowledge",
  topicAlpha: "publication-target-topic-alpha",
  topicBeta: "publication-target-topic-beta",
} as const;

export const publicationFixtureUrls = {
  event: "https://publication.example.test/event",
  update: "https://publication.example.test/update",
  knowledge: "https://publication.example.test/knowledge",
} as const;

export interface PublicationFixtureSeedOptions {
  readonly eventAssociations?: 0 | 1 | 2;
  readonly updateAssociations?: 0 | 1 | 2;
  readonly knowledgeAssociations?: 0 | 1 | 2;
  readonly includeEventUrl?: boolean;
  readonly includeUpdateUrl?: boolean;
  readonly includeKnowledgeUrl?: boolean;
  readonly knowledgeCategory?: string | null;
}

export function seedPublicationFixtureDatabase(
  database: Database.Database,
  options: PublicationFixtureSeedOptions = {},
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
        publicationFixtureIds.source,
        "Synthetic publication target source",
        "RSS",
        "https://publication.example.test/feed.xml",
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
        `Synthetic publication content ${id}`,
        url,
        null,
        null,
        "2026-11-20T08:00:00.000+08:00",
        `Synthetic publication body for ${id}`,
        `Synthetic publication summary for ${id}`,
        "en",
        "FULL",
      );
    };
    addContent(
      publicationFixtureIds.eventContent,
      options.includeEventUrl === true ? publicationFixtureUrls.event : null,
    );
    addContent(
      publicationFixtureIds.updateContent,
      options.includeUpdateUrl === true ? publicationFixtureUrls.update : null,
    );
    addContent(
      publicationFixtureIds.knowledgeContent,
      options.includeKnowledgeUrl === true
        ? publicationFixtureUrls.knowledge
        : null,
    );

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
        publicationFixtureIds.source,
        null,
        url,
        null,
        null,
        discoveredAt,
        contentId,
        null,
      );
    };
    addSourceItem(
      publicationFixtureIds.eventSourceItem,
      publicationFixtureIds.eventContent,
      options.includeEventUrl === true ? publicationFixtureUrls.event : null,
      "2026-11-20T08:00:00.000+08:00",
    );
    addSourceItem(
      publicationFixtureIds.updateSourceItem,
      publicationFixtureIds.updateContent,
      options.includeUpdateUrl === true ? publicationFixtureUrls.update : null,
      "2026-11-20T09:00:00.000+08:00",
    );
    addSourceItem(
      publicationFixtureIds.knowledgeSourceItem,
      publicationFixtureIds.knowledgeContent,
      options.includeKnowledgeUrl === true
        ? publicationFixtureUrls.knowledge
        : null,
      "2026-11-20T10:00:00.000+08:00",
    );

    database
      .prepare(
        `
          INSERT INTO events (
            id, title, entity_name, subject, scope, description, occurred_at,
            discovered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        publicationFixtureIds.event,
        "Synthetic Gate Event Title",
        "Synthetic Gate Event Entity",
        "Synthetic Gate Event Subject",
        "Synthetic Gate Event Scope",
        "Synthetic Gate Event Description",
        "2026-11-20T08:30:00.000+08:00",
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
        publicationFixtureIds.update,
        publicationFixtureIds.event,
        "Synthetic Gate Update Title",
        "Synthetic Gate Update Description",
        "2026-11-20T09:30:00.000+08:00",
        "2026-11-20T09:00:00.000+08:00",
      );
    database
      .prepare(
        `
          INSERT INTO knowledge (
            id, content_id, title, summary, category, findings_json, value
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        publicationFixtureIds.knowledge,
        publicationFixtureIds.knowledgeContent,
        "Synthetic Gate Knowledge Title",
        "Synthetic Gate Knowledge Summary",
        options.knowledgeCategory === undefined
          ? "Method"
          : options.knowledgeCategory,
        JSON.stringify([
          {
            title: "Synthetic Gate Finding",
            description: "Synthetic Gate Finding Description",
          },
        ]),
        "Synthetic Gate Knowledge Value",
      );

    const insertTopic = database.prepare(
      `
        INSERT INTO topics (id, name, description, enabled)
        VALUES (?, ?, ?, ?)
      `,
    );
    insertTopic.run(
      publicationFixtureIds.topicAlpha,
      "Synthetic Gate Alpha Topic",
      "Synthetic Gate Alpha Topic Description",
      1,
    );
    insertTopic.run(
      publicationFixtureIds.topicBeta,
      "Synthetic Gate Beta Topic",
      "Synthetic Gate Beta Topic Description",
      1,
    );

    const insertEvidence = database.prepare(
      `
        INSERT INTO event_content_links (target_type, target_id, content_id)
        VALUES (?, ?, ?)
      `,
    );
    insertEvidence.run(
      "EVENT",
      publicationFixtureIds.event,
      publicationFixtureIds.eventContent,
    );
    insertEvidence.run(
      "EVENT_UPDATE",
      publicationFixtureIds.update,
      publicationFixtureIds.updateContent,
    );

    const insertAssociation = database.prepare(
      `
        INSERT INTO topic_associations (
          topic_id, target_type, target_id, matched_at
        ) VALUES (?, ?, ?, ?)
      `,
    );
    const addAssociations = (
      targetType: "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE",
      targetId: string,
      count: number,
    ): void => {
      for (const topicId of [
        publicationFixtureIds.topicAlpha,
        publicationFixtureIds.topicBeta,
      ].slice(0, count)) {
        insertAssociation.run(
          topicId,
          targetType,
          targetId,
          "2026-11-20T11:00:00.000+08:00",
        );
      }
    };
    addAssociations(
      "EVENT",
      publicationFixtureIds.event,
      options.eventAssociations ?? 1,
    );
    addAssociations(
      "EVENT_UPDATE",
      publicationFixtureIds.update,
      options.updateAssociations ?? 1,
    );
    addAssociations(
      "KNOWLEDGE",
      publicationFixtureIds.knowledge,
      options.knowledgeAssociations ?? 1,
    );
  });

  seed();
}

export async function withPublicationFixtureDatabase<T>(
  callback: (database: Database.Database) => T | Promise<T>,
  options: PublicationFixtureSeedOptions = {},
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const database = openDatabase(path.join(databasePath));
    try {
      initializeDatabase(database);
      seedPublicationFixtureDatabase(database, options);
      return await callback(database);
    } finally {
      closeDatabase(database);
    }
  });
}

export function readPublishedItemCount(database: Database.Database): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM published_items")
    .get() as { readonly count: number };
  return row.count;
}

export function readPublishedItems(
  database: Database.Database,
): readonly PublishedItem[] {
  return database
    .prepare<[], PublishedItem>(
      "SELECT id, target_type, target_id, title, summary, body, published_at FROM published_items",
    )
    .all();
}

export class CountingPublicationClock implements Clock {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  trace: string[] | undefined = undefined;
  readonly #initialTime: Date;
  readonly #database: Database.Database;

  constructor(database: Database.Database, initialTime: Date) {
    this.#database = database;
    this.#initialTime = initialTime;
  }

  now(): Date {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    this.trace?.push("clock");
    return new Date(this.#initialTime.getTime());
  }
}

export class CountingPublicationIdGenerator implements IdGenerator {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  trace: string[] | undefined = undefined;
  readonly #values: readonly string[];
  readonly #database: Database.Database;

  constructor(database: Database.Database, values: readonly string[]) {
    this.#database = database;
    this.#values = values;
  }

  next(): string {
    const value = this.#values[this.calls];
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    this.trace?.push("id");

    if (value === undefined) {
      throw new Error("Synthetic publication ID sequence exhausted");
    }

    return value;
  }
}

export class ControllablePublishedItemRepository implements PublishedItemRepository {
  failNextInsertAfterWrite = false;
  transactionFindResult: PublishedItem | null | undefined = undefined;
  externalFindResult: PublishedItem | null | undefined = undefined;
  findCalls = 0;
  insertCalls = 0;
  readonly insertTransactionStates: boolean[] = [];
  trace: string[] | undefined = undefined;
  readonly #delegate: PublishedItemRepository;
  readonly #database: Database.Database;

  constructor(delegate: PublishedItemRepository, database: Database.Database) {
    this.#delegate = delegate;
    this.#database = database;
  }

  findByTarget(
    targetType: PublishedItem["target_type"],
    targetId: string,
  ): PublishedItem | null {
    this.findCalls += 1;
    this.trace?.push("find");
    if (
      this.#database.inTransaction &&
      this.transactionFindResult !== undefined
    ) {
      return this.transactionFindResult;
    }
    if (
      this.#database.inTransaction === false &&
      this.externalFindResult !== undefined
    ) {
      return this.externalFindResult;
    }

    return this.#delegate.findByTarget(targetType, targetId);
  }

  insert(item: PublishedItemInsert): PublishedItem {
    this.insertCalls += 1;
    this.trace?.push("insert");
    this.insertTransactionStates.push(this.#database.inTransaction);
    const inserted = this.#delegate.insert(item);
    if (this.failNextInsertAfterWrite) {
      this.failNextInsertAfterWrite = false;
      throw new Error("Synthetic Published Item insert failure");
    }

    return inserted;
  }

  listForFeed(feed: PublicationFeed): readonly PublishedItem[] {
    return this.#delegate.listForFeed(feed);
  }
}

export class ControllablePublicationTargetRepository implements PublicationTargetRepository {
  contextCalls = 0;
  associationCalls = 0;
  readonly contextTransactionStates: boolean[] = [];
  readonly associationTransactionStates: boolean[] = [];
  transactionContext: PublicationContext | null | undefined = undefined;
  transactionAssociation: boolean | undefined = undefined;
  trace: string[] | undefined = undefined;
  readonly #delegate: PublicationTargetRepository;
  readonly #database: Database.Database;

  constructor(
    delegate: PublicationTargetRepository,
    database: Database.Database,
  ) {
    this.#delegate = delegate;
    this.#database = database;
  }

  getContext(
    targetType: PublicationTargetType,
    targetId: string,
  ): PublicationContext | null {
    this.contextCalls += 1;
    this.trace?.push("context");
    this.contextTransactionStates.push(this.#database.inTransaction);
    if (this.#database.inTransaction && this.transactionContext !== undefined) {
      return this.transactionContext;
    }

    return this.#delegate.getContext(targetType, targetId);
  }

  hasAnyTopicAssociation(
    targetType: PublicationTargetType,
    targetId: string,
  ): boolean {
    this.associationCalls += 1;
    this.trace?.push("association");
    this.associationTransactionStates.push(this.#database.inTransaction);
    if (
      this.#database.inTransaction &&
      this.transactionAssociation !== undefined
    ) {
      return this.transactionAssociation;
    }

    return this.#delegate.hasAnyTopicAssociation(targetType, targetId);
  }
}

export class CountingPublicationSourceLinkRepository implements PublicationSourceLinkRepository {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  readonly #delegate: PublicationSourceLinkRepository;
  readonly #database: Database.Database;
  readonly #urls: readonly string[] | undefined;

  constructor(
    delegate: PublicationSourceLinkRepository,
    database: Database.Database,
    urls?: readonly string[],
  ) {
    this.#delegate = delegate;
    this.#database = database;
    this.#urls = urls;
  }

  listSourceUrls(
    targetType: PublicationTargetType,
    targetId: string,
  ): readonly string[] {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    return this.#urls ?? this.#delegate.listSourceUrls(targetType, targetId);
  }
}

export class CountingPublicationRenderer implements PublicationRenderer {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  nextDraft: PublicationDraft | undefined = undefined;
  readonly #database: Database.Database;
  readonly #delegate: PublicationRenderer;

  constructor(
    database: Database.Database,
    delegate = new TemplatePublicationRenderer(),
  ) {
    this.#database = database;
    this.#delegate = delegate;
  }

  render(context: PublicationContext): PublicationDraft {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    return this.nextDraft ?? this.#delegate.render(context);
  }
}

export type PublicationNotifierMode =
  "sync" | "async" | "throw" | "reject" | "deferred";

interface NotifierWaiter {
  readonly target: number;
  readonly resolve: () => void;
}

export class ControllablePublicationNotifier implements PublicationNotifier {
  readonly feeds: PublicationFeed[] = [];
  readonly transactionStates: boolean[] = [];
  readonly #database: Database.Database;
  readonly #mode: PublicationNotifierMode;
  readonly #waiters: NotifierWaiter[] = [];
  #deferredPromise: Promise<void> | undefined;
  #resolveDeferred: (() => void) | undefined;

  constructor(
    database: Database.Database,
    mode: PublicationNotifierMode = "sync",
  ) {
    this.#database = database;
    this.#mode = mode;
  }

  get calls(): number {
    return this.feeds.length;
  }

  notify(feed: PublicationFeed): void | Promise<void> {
    this.feeds.push(feed);
    this.transactionStates.push(this.#database.inTransaction);
    for (let index = this.#waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.#waiters[index]!;
      if (this.feeds.length >= waiter.target) {
        this.#waiters.splice(index, 1);
        waiter.resolve();
      }
    }

    if (this.#mode === "sync" || this.#mode === "async") {
      return this.#mode === "async" ? Promise.resolve() : undefined;
    }
    if (this.#mode === "throw") {
      throw new Error("Synthetic synchronous notification failure");
    }
    if (this.#mode === "reject") {
      return Promise.reject(
        new Error("Synthetic asynchronous notification failure"),
      );
    }

    this.#deferredPromise ??= new Promise<void>((resolve) => {
      this.#resolveDeferred = resolve;
    });
    return this.#deferredPromise;
  }

  waitForCalls(target = 1): Promise<void> {
    if (this.feeds.length >= target) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.#waiters.push({ target, resolve });
    });
  }

  resolveDeferred(): void {
    this.#resolveDeferred?.();
  }
}

export const publicationP0FixtureIds = [
  "publication-p0-event",
  "publication-p0-update",
  "publication-p0-knowledge",
  "publication-p0-event-repeat",
  "publication-p0-update-repeat",
  "publication-p0-knowledge-repeat",
] as const;

export interface PublicationP0HarnessOptions {
  readonly sourceUrls?: readonly string[];
  readonly notifierMode?: PublicationNotifierMode;
  readonly logger?: PublicationLogger;
  readonly ids?: readonly string[];
}

export interface PublicationP0Harness {
  readonly dependencies: PublicationDependencies;
  readonly service: PublicationService;
  readonly target: ControllablePublicationTargetRepository;
  readonly source: CountingPublicationSourceLinkRepository;
  readonly renderer: CountingPublicationRenderer;
  readonly published: ControllablePublishedItemRepository;
  readonly clock: CountingPublicationClock;
  readonly ids: CountingPublicationIdGenerator;
  readonly notifier: ControllablePublicationNotifier;
  readonly trace: string[];
}

export function createPublicationP0Harness(
  database: Database.Database,
  options: PublicationP0HarnessOptions = {},
): PublicationP0Harness {
  const target = new ControllablePublicationTargetRepository(
    new SqlitePublicationTargetRepository(database),
    database,
  );
  const source = new CountingPublicationSourceLinkRepository(
    new SqlitePublicationSourceLinkRepository(database),
    database,
    options.sourceUrls,
  );
  const renderer = new CountingPublicationRenderer(database);
  const published = new ControllablePublishedItemRepository(
    new SqlitePublishedItemRepository(database),
    database,
  );
  const clock = new CountingPublicationClock(
    database,
    new Date("2026-11-20T12:34:56.789+08:00"),
  );
  const ids = new CountingPublicationIdGenerator(
    database,
    options.ids ?? publicationP0FixtureIds,
  );
  const notifier = new ControllablePublicationNotifier(
    database,
    options.notifierMode,
  );
  const trace: string[] = [];
  target.trace = trace;
  published.trace = trace;
  clock.trace = trace;
  ids.trace = trace;
  const dependencies: PublicationDependencies = {
    database,
    targetRepository: target,
    sourceLinkRepository: source,
    publishedItemRepository: published,
    renderer,
    clock,
    idGenerator: ids,
    logger: options.logger,
    notify: notifier,
  };

  return {
    dependencies,
    service: createPublication(dependencies),
    target,
    source,
    renderer,
    published,
    clock,
    ids,
    notifier,
    trace,
  };
}

export function flushPublicationTasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
