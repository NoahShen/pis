import { describe, expect, it } from "vitest";

import type {
  PublicationContext,
  PublicationDependencies,
  PublicationDraft,
  PublicationFeed,
  PublicationLogEntry,
  PublicationLogger,
  PublicationRenderer,
  PublicationSourceLinkRepository,
  PublicationTargetRepository,
  PublicationTargetType,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
  PublishResult,
} from "../../src/publication/contracts.js";
import { PublicationError } from "../../src/publication/publication-errors.js";
import { logPublication } from "../../src/publication/publication-logger.js";
import { createPublication } from "../../src/publication/publication.js";
import { SqlitePublicationSourceLinkRepository } from "../../src/publication/source-link-repository.js";
import { SqlitePublicationTargetRepository } from "../../src/publication/publication-target-repository.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import { TemplatePublicationRenderer } from "../../src/publication/template-renderer.js";
import {
  CountingPublicationClock,
  CountingPublicationIdGenerator,
  publicationFixtureIds,
  readPublishedItemCount,
  withPublicationFixtureDatabase,
} from "../fixtures/publication.js";

class RecordingSourceRepository implements PublicationSourceLinkRepository {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  readonly #urls: readonly string[];
  readonly #database: PublicationDependencies["database"];

  constructor(
    database: PublicationDependencies["database"],
    urls: readonly string[] = [],
  ) {
    this.#database = database;
    this.#urls = urls;
  }

  listSourceUrls(
    _targetType: PublicationTargetType,
    _targetId: string,
  ): readonly string[] {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    return this.#urls;
  }
}

class RecordingRenderer implements PublicationRenderer {
  calls = 0;
  readonly transactionStates: boolean[] = [];
  readonly #database: PublicationDependencies["database"];

  constructor(database: PublicationDependencies["database"]) {
    this.#database = database;
  }

  render(context: PublicationContext): PublicationDraft {
    this.calls += 1;
    this.transactionStates.push(this.#database.inTransaction);
    return new TemplatePublicationRenderer().render(context);
  }
}

interface DatabaseAccessCounts {
  find: number;
  context: number;
  association: number;
  source: number;
  insert: number;
  list: number;
}

function createZeroAccessDependencies(
  database: PublicationDependencies["database"],
): {
  readonly dependencies: PublicationDependencies;
  readonly counts: DatabaseAccessCounts;
} {
  const counts: DatabaseAccessCounts = {
    find: 0,
    context: 0,
    association: 0,
    source: 0,
    insert: 0,
    list: 0,
  };
  const targetRepository: PublicationTargetRepository = {
    getContext(): PublicationContext | null {
      counts.context += 1;
      throw new Error("Unexpected target repository access");
    },
    hasAnyTopicAssociation(): boolean {
      counts.association += 1;
      throw new Error("Unexpected target association access");
    },
  };
  const sourceLinkRepository: PublicationSourceLinkRepository = {
    listSourceUrls(): readonly string[] {
      counts.source += 1;
      throw new Error("Unexpected source link access");
    },
  };
  const publishedItemRepository: PublishedItemRepository = {
    findByTarget(): PublishedItem | null {
      counts.find += 1;
      throw new Error("Unexpected Published Item read");
    },
    insert(_item: PublishedItemInsert): PublishedItem {
      counts.insert += 1;
      throw new Error("Unexpected Published Item write");
    },
    listForFeed(_feed: PublicationFeed): readonly PublishedItem[] {
      counts.list += 1;
      throw new Error("Unexpected Published Item feed read");
    },
  };

  return {
    counts,
    dependencies: {
      database,
      targetRepository,
      sourceLinkRepository,
      publishedItemRepository,
      clock: new CountingPublicationClock(
        database,
        new Date("2026-11-20T12:00:00.000+08:00"),
      ),
      idGenerator: new CountingPublicationIdGenerator(database, [
        "unused-publication-id",
      ]),
    },
  };
}

function createRealDependencies(
  database: PublicationDependencies["database"],
  options: {
    readonly sourceUrls?: readonly string[];
    readonly maxSourceLinks?: number;
  } = {},
): {
  readonly dependencies: PublicationDependencies;
  readonly source: RecordingSourceRepository;
  readonly renderer: RecordingRenderer;
  readonly clock: CountingPublicationClock;
  readonly ids: CountingPublicationIdGenerator;
} {
  const source = new RecordingSourceRepository(database, options.sourceUrls);
  const renderer = new RecordingRenderer(database);
  const clock = new CountingPublicationClock(
    database,
    new Date("2026-11-20T12:34:56.789+08:00"),
  );
  const ids = new CountingPublicationIdGenerator(database, [
    "publication-created-event",
    "publication-created-event-repeat",
  ]);

  return {
    source,
    renderer,
    clock,
    ids,
    dependencies: {
      database,
      targetRepository: new SqlitePublicationTargetRepository(database),
      sourceLinkRepository: source,
      publishedItemRepository: new SqlitePublishedItemRepository(database),
      renderer,
      clock,
      idGenerator: ids,
      maxSourceLinks: options.maxSourceLinks,
    },
  };
}

describe("Publication gate", () => {
  it("PUB-02_NO_ASSOCIATION returns an empty result without rendering or reading source links", async () => {
    await withPublicationFixtureDatabase(
      async (database) => {
        const harness = createRealDependencies(database);
        const service = createPublication(harness.dependencies);

        const result = await service.publish(
          "EVENT",
          publicationFixtureIds.event,
        );

        expect(result).toEqual({
          published_item_id: null,
          already_published: false,
        });
        expect(readPublishedItemCount(database)).toBe(0);
        expect(harness.source.calls).toBe(0);
        expect(harness.renderer.calls).toBe(0);
        expect(harness.clock.calls).toBe(0);
        expect(harness.ids.calls).toBe(0);
      },
      {
        eventAssociations: 0,
        updateAssociations: 0,
        knowledgeAssociations: 0,
      },
    );
  });

  it("PUB-03_MISSING_TARGET returns empty for all three target types with no snapshot", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createRealDependencies(database);
      const service = createPublication(harness.dependencies);

      for (const targetType of [
        "EVENT",
        "EVENT_UPDATE",
        "KNOWLEDGE",
      ] as const) {
        await expect(
          service.publish(targetType, `${targetType}-missing`),
        ).resolves.toEqual({
          published_item_id: null,
          already_published: false,
        });
      }

      expect(readPublishedItemCount(database)).toBe(0);
      expect(harness.source.calls).toBe(0);
      expect(harness.renderer.calls).toBe(0);
      expect(harness.clock.calls).toBe(0);
      expect(harness.ids.calls).toBe(0);
    });
  });

  it("PUB-03_INVALID_INPUT rejects invalid type, blank ID, and pre-abort before any DB access", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const zero = createZeroAccessDependencies(database);
      const service = createPublication(zero.dependencies);

      await expect(
        service.publish("UNKNOWN" as PublicationTargetType, "target"),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(service.publish("EVENT", "   ")).rejects.toMatchObject({
        code: "invalid_input",
      });

      const controller = new AbortController();
      controller.abort();
      await expect(
        service.publish("EVENT", publicationFixtureIds.event, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: "aborted" });

      expect(zero.counts).toEqual({
        find: 0,
        context: 0,
        association: 0,
        source: 0,
        insert: 0,
        list: 0,
      });
    });
  });

  it("MAX_LINKS_CONFIG rejects invalid values at construction and accepts 1, 20, and the default 5", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      for (const maxSourceLinks of [0, 21, Number.NaN, 1.5]) {
        const zero = createZeroAccessDependencies(database);
        expect(() =>
          createPublication({ ...zero.dependencies, maxSourceLinks }),
        ).toThrow(PublicationError);
        expect(zero.counts).toEqual({
          find: 0,
          context: 0,
          association: 0,
          source: 0,
          insert: 0,
          list: 0,
        });
      }

      for (const maxSourceLinks of [1, 20]) {
        const zero = createZeroAccessDependencies(database);
        expect(() =>
          createPublication({ ...zero.dependencies, maxSourceLinks }),
        ).not.toThrow();
      }

      const urls = Array.from(
        { length: 7 },
        (_, index) => `https://publication.example.test/link-${index + 1}`,
      );
      const harness = createRealDependencies(database, { sourceUrls: urls });
      const service = createPublication(harness.dependencies);
      const result = await service.publish(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(result.already_published).toBe(false);
      const item = new SqlitePublishedItemRepository(database).findByTarget(
        "EVENT",
        publicationFixtureIds.event,
      );
      expect(item?.body.match(/<li>/g)).toHaveLength(5);
    });
  });

  it("DEPENDENCY_ERRORS normalize abort-like errors to aborted and other failures to publication_failed", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const zero = createZeroAccessDependencies(database);
      for (const abortLikeError of [
        { name: "AbortError" },
        { code: "ABORT_ERR" },
        { code: "LLM_CANCELLED" },
        { code: "aborted" },
      ]) {
        const abortLike: PublishedItemRepository = {
          findByTarget(): PublishedItem | null {
            throw abortLikeError;
          },
          insert(): PublishedItem {
            throw new Error("unexpected");
          },
          listForFeed(): readonly PublishedItem[] {
            return [];
          },
        };
        const aborted = createPublication({
          ...zero.dependencies,
          publishedItemRepository: abortLike,
        });
        await expect(aborted.publish("EVENT", "target")).rejects.toMatchObject({
          code: "aborted",
          message: "Publication was aborted",
        });
      }

      const failedRepo: PublishedItemRepository = {
        findByTarget(): PublishedItem | null {
          throw new Error("SYNTHETIC_SQL_ERROR_WITH_PRIVATE_DETAIL");
        },
        insert(): PublishedItem {
          throw new Error("unexpected");
        },
        listForFeed(): readonly PublishedItem[] {
          return [];
        },
      };
      const failed = createPublication({
        ...zero.dependencies,
        publishedItemRepository: failedRepo,
      });
      const error = await failed
        .publish("EVENT", "target")
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PublicationError);
      expect(error).toMatchObject({
        code: "publication_failed",
        message: "Publication operation failed",
      });
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain(
        "SYNTHETIC_SQL_ERROR_WITH_PRIVATE_DETAIL",
      );
    });
  });

  it("LOGGER_BEST_EFFORT exposes only whitelisted fields and swallows sync or async failures", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const entries: PublicationLogEntry[] = [];
      const synchronousLogger: PublicationLogger = (entry) => {
        entries.push(entry);
        throw new Error("synthetic sync logger failure");
      };

      logPublication(synchronousLogger, {
        targetType: "EVENT",
        targetId: "safe-target-id",
        stage: "check",
        reason: "publication_failed",
        sourceLinkCount: 2,
        publishedItemId: "safe-item-id",
        durationMs: 4,
        title: "SYNTHETIC_TITLE_MUST_NOT_LEAK",
        body: "SYNTHETIC_BODY_MUST_NOT_LEAK",
        url: "https://private.example.test/SYNTHETIC_URL_MUST_NOT_LEAK",
      } as PublicationLogEntry);
      expect(entries).toEqual([
        {
          targetType: "EVENT",
          targetId: "safe-target-id",
          stage: "check",
          reason: "publication_failed",
          sourceLinkCount: 2,
          publishedItemId: "safe-item-id",
          durationMs: 4,
        },
      ]);

      const asynchronousLogger: PublicationLogger = async () => {
        throw new Error("synthetic async logger failure");
      };
      expect(() =>
        logPublication(asynchronousLogger, { stage: "render" }),
      ).not.toThrow();

      const harness = createRealDependencies(database);
      const service = createPublication({
        ...harness.dependencies,
        logger: synchronousLogger,
      });
      await expect(
        service.publish("EVENT", publicationFixtureIds.event),
      ).resolves.toMatchObject({ already_published: false });
      expect(readPublishedItemCount(database)).toBe(1);
    });
  });

  it("PUBLISH_RESULT has only the approved runtime fields", async () => {
    await withPublicationFixtureDatabase(async (database) => {
      const harness = createRealDependencies(database);
      const result = await createPublication(harness.dependencies).publish(
        "EVENT",
        publicationFixtureIds.event,
      );

      expect(Object.keys(result).sort()).toEqual(
        ["already_published", "published_item_id"].sort(),
      );
      expect(result satisfies PublishResult).toEqual({
        published_item_id: "publication-created-event",
        already_published: false,
      });
    });
  });
});
