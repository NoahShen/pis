import { describe, expect, it } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";
import type {
  PublicationContext,
  PublicationDependencies,
  PublicationDraft,
  PublicationFeed,
  PublicationRenderer,
  PublicationSourceLinkRepository,
  PublicationTargetType,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
} from "../../src/publication/contracts.js";
import { createPublication } from "../../src/publication/publication.js";
import { SqlitePublicationSourceLinkRepository } from "../../src/publication/source-link-repository.js";
import { SqlitePublicationTargetRepository } from "../../src/publication/publication-target-repository.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import { TemplatePublicationRenderer } from "../../src/publication/template-renderer.js";
import {
  ControllablePublishedItemRepository,
  CountingPublicationClock,
  CountingPublicationIdGenerator,
  publicationFixtureIds,
  publicationFixtureUrls,
  readPublishedItemCount,
  readPublishedItems,
  sortedKeys,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

class RecordingSourceRepository implements PublicationSourceLinkRepository {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  readonly #database: PublicationDependencies["database"];
  readonly #delegate: SqlitePublicationSourceLinkRepository;
  readonly #urls: readonly string[] | undefined;

  constructor(
    database: PublicationDependencies["database"],
    urls?: readonly string[],
  ) {
    this.#database = database;
    this.#delegate = new SqlitePublicationSourceLinkRepository(database);
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

class RecordingRenderer implements PublicationRenderer {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  nextDraft: PublicationDraft | undefined;
  readonly #database: PublicationDependencies["database"];

  constructor(database: PublicationDependencies["database"]) {
    this.#database = database;
  }

  render(context: PublicationContext): PublicationDraft {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    return this.nextDraft ?? new TemplatePublicationRenderer().render(context);
  }
}

interface Harness {
  readonly dependencies: PublicationDependencies;
  readonly source: RecordingSourceRepository;
  readonly renderer: RecordingRenderer;
  readonly clock: CountingPublicationClock;
  readonly ids: CountingPublicationIdGenerator;
  readonly published: PublishedItemRepository;
}

function createHarness(
  database: PublicationDependencies["database"],
  options: {
    readonly sourceUrls?: readonly string[];
    readonly published?: PublishedItemRepository;
  } = {},
): Harness {
  const source = new RecordingSourceRepository(database, options.sourceUrls);
  const renderer = new RecordingRenderer(database);
  const clock = new CountingPublicationClock(
    database,
    new Date("2026-11-20T12:34:56.789+08:00"),
  );
  const ids = new CountingPublicationIdGenerator(database, [
    "publication-persisted-event",
    "publication-persisted-update",
    "publication-persisted-knowledge",
    "publication-persisted-retry",
  ]);
  const published =
    options.published ?? new SqlitePublishedItemRepository(database);

  return {
    source,
    renderer,
    clock,
    ids,
    published,
    dependencies: {
      database,
      targetRepository: new SqlitePublicationTargetRepository(database),
      sourceLinkRepository: source,
      publishedItemRepository: published,
      renderer,
      clock,
      idGenerator: ids,
    },
  };
}

function publishedItem(
  id: string,
  targetType: PublicationTargetType,
  targetId: string,
  publishedAt: string,
): PublishedItemInsert {
  return {
    id,
    target_type: targetType,
    target_id: targetId,
    title: `Synthetic ${id} title`,
    summary: `Synthetic ${id} summary`,
    body: `<section><p>Synthetic ${id} body</p></section>`,
    published_at: publishedAt,
  };
}

describe("Publication target repository and DTOs", () => {
  it("TARGET_DTO maps Event, Update, and Knowledge to exactly the approved fields", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const repository = new SqlitePublicationTargetRepository(database);
        const event = repository.getContext(
          "EVENT",
          publicationFixtureIds.event,
        );
        const update = repository.getContext(
          "EVENT_UPDATE",
          publicationFixtureIds.update,
        );
        const knowledge = repository.getContext(
          "KNOWLEDGE",
          publicationFixtureIds.knowledge,
        );

        expect(event).not.toBeNull();
        if (event?.targetType !== "EVENT") {
          throw new Error("Expected an Event context");
        }
        expect(sortedKeys(event)).toEqual(
          ["event", "occurredAt", "targetType"].sort(),
        );
        expect(sortedKeys(event.event)).toEqual(
          [
            "description",
            "entityName",
            "id",
            "scope",
            "subject",
            "title",
          ].sort(),
        );

        expect(update).not.toBeNull();
        if (update?.targetType !== "EVENT_UPDATE") {
          throw new Error("Expected an Event Update context");
        }
        expect(sortedKeys(update)).toEqual(
          ["occurredAt", "parentEvent", "targetType", "update"].sort(),
        );
        expect(sortedKeys(update.update)).toEqual(
          ["description", "eventId", "id", "title"].sort(),
        );
        expect(sortedKeys(update.parentEvent)).toEqual(
          ["entityName", "id", "scope", "subject", "title"].sort(),
        );
        expect(update.parentEvent).not.toHaveProperty("description");
        expect(update.parentEvent).not.toHaveProperty("history");

        expect(knowledge).not.toBeNull();
        if (knowledge?.targetType !== "KNOWLEDGE") {
          throw new Error("Expected a Knowledge context");
        }
        expect(sortedKeys(knowledge)).toEqual(
          ["knowledge", "targetType"].sort(),
        );
        expect(sortedKeys(knowledge.knowledge)).toEqual(
          ["category", "findings", "id", "summary", "title", "value"].sort(),
        );
        expect(sortedKeys(knowledge.knowledge.findings[0]!)).toEqual(
          ["description", "title"].sort(),
        );
        expect(JSON.stringify([event, update, knowledge])).not.toMatch(
          /raw_data|findings_json|content_id|parent_description|history/,
        );
      },
      { knowledgeCategory: null },
    );
  });

  it("TARGET_DTO maps NULL category to null and rejects structurally malformed findings JSON", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const repository = new SqlitePublicationTargetRepository(database);
        const context = repository.getContext(
          "KNOWLEDGE",
          publicationFixtureIds.knowledge,
        );
        expect(context).toMatchObject({
          targetType: "KNOWLEDGE",
          knowledge: { category: null },
        });

        database
          .prepare("UPDATE knowledge SET findings_json = ? WHERE id = ?")
          .run("[1]", publicationFixtureIds.knowledge);
        expect(() =>
          repository.getContext("KNOWLEDGE", publicationFixtureIds.knowledge),
        ).toThrow("Malformed Publication knowledge findings JSON");
      },
      { knowledgeCategory: null },
    );
  });

  it("ASSOCIATION_GATE checks only target type/id and does not read Topic name or enabled", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const repository = new SqlitePublicationTargetRepository(database);
      expect(
        repository.hasAnyTopicAssociation("EVENT", publicationFixtureIds.event),
      ).toBe(true);

      database
        .prepare("UPDATE topics SET name = ?, enabled = 0")
        .run("SYNTHETIC_TOPIC_NAME_MUST_NOT_GATE_PUBLICATION");
      expect(
        repository.hasAnyTopicAssociation("EVENT", publicationFixtureIds.event),
      ).toBe(true);

      database
        .prepare(
          "DELETE FROM topic_associations WHERE target_type = ? AND target_id = ?",
        )
        .run("EVENT", publicationFixtureIds.event);
      expect(
        repository.hasAnyTopicAssociation("EVENT", publicationFixtureIds.event),
      ).toBe(false);
    });
  });
});

describe("SqlitePublishedItemRepository", () => {
  it("PUBLISHED_REPO reads and writes exactly seven columns and requires an active transaction", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const repository = new SqlitePublishedItemRepository(database);
      const item = publishedItem(
        "publication-repo-event",
        "EVENT",
        "publication-repo-target-event",
        "2026-11-20T12:00:00.000+08:00",
      );

      expect(() => repository.insert(item)).toThrow(
        "Published Item writes require an active transaction",
      );

      const inserted = withTransaction(database, () => repository.insert(item));
      expect(sortedKeys(inserted)).toEqual(
        [
          "body",
          "id",
          "published_at",
          "summary",
          "target_id",
          "target_type",
          "title",
        ].sort(),
      );
      expect(inserted).toEqual(item);
      expect(repository.findByTarget("EVENT", item.target_id)).toEqual(item);
      expect(readPublishedItems(database)).toHaveLength(1);
    });
  });

  it("PUBLISHED_REPO enforces target uniqueness without upserting or replacing the original row", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const repository = new SqlitePublishedItemRepository(database);
      const first = publishedItem(
        "publication-repo-unique-first",
        "EVENT",
        "publication-repo-unique-target",
        "2026-11-20T12:00:00.000+08:00",
      );
      const conflicting = publishedItem(
        "publication-repo-unique-second",
        "EVENT",
        first.target_id,
        "2026-11-20T13:00:00.000+08:00",
      );

      withTransaction(database, () => repository.insert(first));
      expect(() =>
        withTransaction(database, () => repository.insert(conflicting)),
      ).toThrow();

      expect(repository.findByTarget("EVENT", first.target_id)).toEqual(first);
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("PUBLISHED_REPO listForFeed is read-only and ordered by published_at DESC, id DESC", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const repository = new SqlitePublishedItemRepository(database);
      const eventOlder = publishedItem(
        "publication-feed-event-a",
        "EVENT",
        "publication-feed-target-event-a",
        "2026-11-20T10:00:00.000+08:00",
      );
      const eventTieA = publishedItem(
        "publication-feed-event-b",
        "EVENT",
        "publication-feed-target-event-b",
        "2026-11-20T12:00:00.000+08:00",
      );
      const updateTieB = publishedItem(
        "publication-feed-event-c",
        "EVENT_UPDATE",
        "publication-feed-target-update",
        "2026-11-20T12:00:00.000+08:00",
      );
      const knowledge = publishedItem(
        "publication-feed-knowledge",
        "KNOWLEDGE",
        "publication-feed-target-knowledge",
        "2026-11-20T11:00:00.000+08:00",
      );

      withTransaction(database, () => {
        for (const item of [eventOlder, eventTieA, updateTieB, knowledge]) {
          repository.insert(item);
        }
      });

      expect(repository.listForFeed("EVENT").map(({ id }) => id)).toEqual([
        updateTieB.id,
        eventTieA.id,
        eventOlder.id,
      ]);
      expect(repository.listForFeed("KNOWLEDGE").map(({ id }) => id)).toEqual([
        knowledge.id,
      ]);
      expect(readPublishedItemCount(database)).toBe(4);
      expect(readPublishedItems(database)).toHaveLength(4);
    });
  });
});

describe("Publication persistence and transaction behavior", () => {
  it("PUB-07_NO_URL creates a readable snapshot without a source section or placeholder URL", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createHarness(database);
      const result = await createPublication(harness.dependencies).publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      const item = new SqlitePublishedItemRepository(database).findByTarget(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(result).toEqual({
        published_item_id: "publication-persisted-event",
        already_published: false,
      });
      expect(item?.body.trim().length).toBeGreaterThan(0);
      expect(item?.body).not.toContain("来源");
      expect(item?.body).not.toMatch(/<a\b|href=|https?:\/\//);
    });
  });

  it("PUB-10_VALIDATE rejects each blank required field before transaction, clock, ID, or insert", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createHarness(database);
      const service = createPublication(harness.dependencies);

      for (const draft of [
        { title: "   ", summary: "valid summary", body: "<p>valid</p>" },
        { title: "valid title", summary: "\n", body: "<p>valid</p>" },
        { title: "valid title", summary: "valid summary", body: " \t " },
      ] satisfies PublicationDraft[]) {
        harness.renderer.nextDraft = draft;
        await expect(
          service.publish("EVENT", publicationFixtureIds.event),
        ).rejects.toMatchObject({ code: "publication_failed" });
      }

      expect(readPublishedItemCount(database)).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("TX_SYNC_ONLY calls source and renderer outside the transaction, then clock/ID/insert inside, with no post-state leak", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const realRepository = new SqlitePublishedItemRepository(database);
      const published = new ControllablePublishedItemRepository(
        realRepository,
        database,
      );
      const harness = createHarness(database, { published });
      const loggerTransactionStates: boolean[] = [];
      let notifierCalls = 0;
      const service = createPublication({
        ...harness.dependencies,
        logger: () => {
          loggerTransactionStates.push(database.inTransaction);
        },
        notify: {
          notify(): void {
            notifierCalls += 1;
          },
        },
      });
      const result = await service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(result.already_published).toBe(false);
      expect(harness.source.transactionStates).toEqual([false]);
      expect(harness.renderer.transactionStates).toEqual([false]);
      expect(harness.clock.transactionStates).toEqual([true]);
      expect(harness.ids.transactionStates).toEqual([true]);
      expect(published.insertTransactionStates).toEqual([true]);
      expect(published.findCalls).toBe(2);
      expect(loggerTransactionStates.length).toBeGreaterThan(0);
      expect(loggerTransactionStates.every((state) => state === false)).toBe(
        true,
      );
      expect(notifierCalls).toBe(0);
      expect(database.inTransaction).toBe(false);
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("TX_ROLLBACK rolls back an insert-time failure and restores inTransaction=false", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const realRepository = new SqlitePublishedItemRepository(database);
      const published = new ControllablePublishedItemRepository(
        realRepository,
        database,
      );
      published.failNextInsertAfterWrite = true;
      const harness = createHarness(database, { published });
      const service = createPublication(harness.dependencies);

      await expect(
        service.publish("EVENT", publicationFixtureIds.event),
      ).rejects.toMatchObject({ code: "publication_failed" });

      expect(readPublishedItemCount(database)).toBe(0);
      expect(harness.clock.calls).toBe(1);
      expect(harness.ids.calls).toBe(1);
      expect(published.insertCalls).toBe(1);
      expect(database.inTransaction).toBe(false);

      await expect(
        service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toMatchObject({
        published_item_id: "publication-persisted-update",
        already_published: false,
      });
      expect(readPublishedItemCount(database)).toBe(1);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("PUB-04_MULTI_TOPIC produces one snapshot regardless of multiple Topic Associations", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createHarness(database);
        const service = createPublication(harness.dependencies);
        const first = await service.publish(
          "EVENT",
          publicationFixtureIds.event,
        );
        const second = await service.publish(
          "EVENT",
          publicationFixtureIds.event,
        );

        expect(first).toEqual({
          published_item_id: "publication-persisted-event",
          already_published: false,
        });
        expect(second).toEqual({
          published_item_id: first.published_item_id,
          already_published: true,
        });
        expect(readPublishedItemCount(database)).toBe(1);
        expect(harness.renderer.calls).toBe(1);
        expect(harness.source.calls).toBe(1);
        expect(harness.clock.calls).toBe(1);
        expect(harness.ids.calls).toBe(1);
      },
      { eventAssociations: 2 },
    );
  });

  it("PUB-05_REPEAT and PUB-12_FAST_REUSE return the original snapshot without any reread work", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createHarness(database);
      const service = createPublication(harness.dependencies);
      const original = await service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      const initial = new SqlitePublishedItemRepository(database).findByTarget(
        "EVENT",
        publicationFixtureIds.event,
      );

      database
        .prepare("UPDATE events SET title = ?, description = ? WHERE id = ?")
        .run(
          "SYNTHETIC_CHANGED_EVENT_TITLE",
          "SYNTHETIC_CHANGED_EVENT_DESCRIPTION",
          publicationFixtureIds.event,
        );
      database
        .prepare(
          `
            INSERT INTO topic_associations (
              topic_id, target_type, target_id, matched_at
            ) VALUES (?, ?, ?, ?)
          `,
        )
        .run(
          publicationFixtureIds.topicBeta,
          "EVENT",
          publicationFixtureIds.event,
          "2026-11-20T13:00:00.000+08:00",
        );

      const repeated = await service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );
      const after = new SqlitePublishedItemRepository(database).findByTarget(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(original).toEqual({
        published_item_id: "publication-persisted-event",
        already_published: false,
      });
      expect(repeated).toEqual({
        published_item_id: "publication-persisted-event",
        already_published: true,
      });
      expect(after).toEqual(initial);
      expect(harness.renderer.calls).toBe(1);
      expect(harness.source.calls).toBe(1);
      expect(harness.clock.calls).toBe(1);
      expect(harness.ids.calls).toBe(1);
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("PUB-05_TX_UNIQUE rechecks uniqueness inside the transaction and skips clock, ID, and insert", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const realRepository = new SqlitePublishedItemRepository(database);
      const published = new ControllablePublishedItemRepository(
        realRepository,
        database,
      );
      const injectedExisting: PublishedItem = {
        ...publishedItem(
          "publication-transaction-winner",
          "EVENT",
          publicationFixtureIds.event,
          "2026-11-20T12:00:00.000+08:00",
        ),
      };
      published.transactionFindResult = injectedExisting;
      const harness = createHarness(database, { published });

      const result = await createPublication(harness.dependencies).publish(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(result).toEqual({
        published_item_id: "publication-transaction-winner",
        already_published: true,
      });
      expect(published.findCalls).toBe(2);
      expect(published.insertCalls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
      expect(harness.renderer.calls).toBe(1);
      expect(harness.source.calls).toBe(1);
      expect(readPublishedItemCount(database)).toBe(0);
      expect(database.inTransaction).toBe(false);
    });
  });

  it("DB-13_BUSINESS_GUARD proves direct SQL permits a polymorphic orphan while the service rejects it without another row", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const orphan = publishedItem(
        "publication-direct-orphan",
        "EVENT",
        "publication-missing-event",
        "2026-11-20T12:00:00.000+08:00",
      );
      withTransaction(database, () => {
        new SqlitePublishedItemRepository(database).insert(orphan);
      });
      expect(readPublishedItemCount(database)).toBe(1);

      const harness = createHarness(database);
      const result = await createPublication(harness.dependencies).publish(
        "EVENT",
        "publication-other-missing-event",
      );

      expect(result).toEqual({
        published_item_id: null,
        already_published: false,
      });
      expect(readPublishedItemCount(database)).toBe(1);
      expect(harness.source.calls).toBe(0);
      expect(harness.renderer.calls).toBe(0);
    });
  });

  it("THREE_KIND_GATE creates one Event, one Update, and one Knowledge snapshot using their exact source evidence", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createHarness(database);
        const service = createPublication(harness.dependencies);

        const event = await service.publish(
          "EVENT",
          publicationFixtureIds.event,
        );
        const update = await service.publish(
          "EVENT_UPDATE",
          publicationFixtureIds.update,
        );
        const knowledge = await service.publish(
          "KNOWLEDGE",
          publicationFixtureIds.knowledge,
        );

        expect(event.published_item_id).toBe("publication-persisted-event");
        expect(update.published_item_id).toBe("publication-persisted-update");
        expect(knowledge.published_item_id).toBe(
          "publication-persisted-knowledge",
        );
        expect(readPublishedItemCount(database)).toBe(3);
        const rows = readPublishedItems(database);
        expect(rows.every(({ body }) => body.trim().length > 0)).toBe(true);
        expect(rows.map(({ body }) => body).join("\n")).not.toContain(
          "raw_data",
        );

        const updateBody = rows.find(
          ({ id }) => id === "publication-persisted-update",
        )?.body;
        expect(updateBody).toContain(publicationFixtureUrls.update);
        expect(updateBody).not.toContain(publicationFixtureUrls.event);
        expect(harness.renderer.transactionStates).toEqual([
          false,
          false,
          false,
        ]);
        expect(harness.source.transactionStates).toEqual([false, false, false]);
      },
      { includeUpdateUrl: true },
    );
  });
});
