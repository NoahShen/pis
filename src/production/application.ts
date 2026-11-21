import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyListenOptions } from "fastify";

import { createSourceAdapterRegistry } from "../collection/adapter-registry.js";
import { createCollection } from "../collection/index.js";
import type { CollectionLogger } from "../collection/index.js";
import { createRssAdapter } from "../adapters/rss-adapter.js";
import type { SourceAdapter } from "../adapters/contracts.js";
import { buildApp } from "../app.js";
import { DEFAULT_DATABASE_PATH, type AppConfig } from "../config.js";
import {
  SqliteSourceRepository,
  type SourceRepository,
} from "../configuration/source-repository.js";
import {
  SqliteTopicRepository,
  type TopicRepository,
} from "../configuration/topic-repository.js";
import { openDatabase } from "../database/open-database.js";
import { initializeDatabase } from "../database/schema.js";
import { createEventAnalysis } from "../event-analysis/event-analysis.js";
import type { EventAnalysisLogger } from "../event-analysis/contracts.js";
import { SqliteEventRepository } from "../event-analysis/event-repository.js";
import {
  createEventSearch,
  type EventSearchLogger,
} from "../event-search/index.js";
import { SqliteEventCandidateRepository } from "../event-search/event-candidate-repository.js";
import { createKnowledgeAnalysis } from "../knowledge/knowledge.js";
import type { KnowledgeLogger } from "../knowledge/knowledge-logger.js";
import { SqliteKnowledgeRepository } from "../knowledge/knowledge-repository.js";
import { createTypedLlmCalls, type TypedLlmCalls } from "../llm/llm-calls.js";
import {
  createChatCompletionsClient,
  type TextCompletionClient,
} from "../llm/chat-completions-client.js";
import type { Logger } from "../logger.js";
import { CryptoIdGenerator } from "../id/crypto-id-generator.js";
import type { IdGenerator } from "../id/id-generator.js";
import { createProcessing } from "../processing/processing.js";
import type { ProcessingLogger } from "../processing/processing-logger.js";
import { SqliteContentRepository } from "../processing/content-repository.js";
import { SqliteProcessingSourceItemRepository } from "../processing/source-item-repository.js";
import { PromptRepository } from "../prompt/prompt-repository.js";
import { createPublication } from "../publication/publication.js";
import type {
  PublishedItemRepository as PublicationPublishedItemRepository,
  PublicationLogger,
} from "../publication/contracts.js";
import { SqlitePublishedItemRepository as SqlitePublicationPublishedItemRepository } from "../publication/published-item-repository.js";
import { SqlitePublicationTargetRepository } from "../publication/publication-target-repository.js";
import { SqlitePublicationSourceLinkRepository } from "../publication/source-link-repository.js";
import { createRuntime } from "../runtime/runtime.js";
import type {
  Runtime,
  RuntimeLogger,
  StageServices,
} from "../runtime/contracts.js";
import { createCronScheduler } from "../scheduler/cron-scheduler.js";
import type { CronScheduler } from "../scheduler/contracts.js";
import { SqliteSourceItemRepository } from "../collection/source-item-repository.js";
import { createTopicMatching } from "../topic-matching/topic-matching.js";
import type { TopicMatchingLogger } from "../topic-matching/topic-matching-logger.js";
import { SqliteTopicAssociationRepository } from "../topic-matching/topic-association-repository.js";
import { SqlitePublishedItemRepository as SqliteTopicPublishedItemRepository } from "../topic-matching/published-item-repository.js";
import { SqliteTopicMatchingTargetRepository } from "../topic-matching/topic-matching-target-repository.js";
import { SystemClock } from "../time/system-clock.js";
import type { Clock } from "../time/clock.js";
import {
  calibrateRssPublication,
  createLocalArtifactStore,
  createLocalRssSync,
  createPublishedItemSource,
  createRssFeedPublisher,
  createRssPublicationNotifier,
  createRssPagesPublisher,
  type LocalRssSyncService,
  type RssArtifactStore,
  type RssPublicationNotifier,
  type RssPublicationPublisher,
} from "../rss/index.js";

export type ClosableRssPublisher = RssPublicationPublisher & {
  close?: () => Promise<void>;
};

export type ProductionAssemblyDependencies<WithPages extends boolean = false> =
  {
    readonly database?: Database.Database;
    readonly clock?: Clock;
    readonly idGenerator?: IdGenerator;
    readonly textCompletionClient?: TextCompletionClient;
    readonly sourceAdapter?: SourceAdapter;
    readonly runtime?: Runtime;
    readonly scheduler?: CronScheduler;
  } & (WithPages extends true
    ? {
        readonly rssPages?: {
          readonly publisher?: ClosableRssPublisher;
          readonly notifier?: RssPublicationNotifier;
          readonly localSync?: LocalRssSyncService;
          readonly artifactStore?: RssArtifactStore;
          readonly drain?: () => Promise<void>;
        };
      }
    : Record<never, never>);

export interface ProductionAssembly {
  readonly app: FastifyInstance;
  readonly runtime: Runtime;
  readonly scheduler: CronScheduler;
  readonly database: Database.Database;
}

const CLOSE_ERROR_MESSAGE = "Production cleanup failed";
const RUNTIME_START_ERROR_MESSAGE = "Production runtime failed to start";
const SCHEDULER_START_ERROR_MESSAGE = "Production scheduler failed to start";

class ProductionStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionStartupError";
  }
}

class ProductionCleanupError extends Error {
  constructor() {
    super(CLOSE_ERROR_MESSAGE);
    this.name = "ProductionCleanupError";
  }
}

function reportError(logger: Logger, operation: string, reason: string): void {
  try {
    logger.error({ operation, reason });
  } catch {
    // Logging failure must not block startup or cleanup.
  }
}

function reasonLogger(
  logger: Logger,
  operation: string,
): { log(metadata: { readonly reason?: string }): void } {
  return {
    log(metadata): void {
      if (metadata.reason !== undefined) {
        reportError(logger, operation, metadata.reason);
      }
    },
  };
}

function reasonCallback(
  logger: Logger,
  operation: string,
): (metadata: { readonly reason?: string }) => void {
  return (metadata): void => {
    if (metadata.reason !== undefined) {
      reportError(logger, operation, metadata.reason);
    }
  };
}

function openOwnedDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = openDatabase(databasePath);

  try {
    initializeDatabase(database);
    return database;
  } catch (error) {
    try {
      if (database.open) {
        database.close();
      }
    } catch {
      // Preserve the initialization failure.
    }
    throw error;
  }
}

function closeDatabase(database: Database.Database): void {
  if (database.open) {
    database.close();
  }
}

export function createProductionAssembly(
  config: AppConfig,
  logger: Logger,
  dependencies: ProductionAssemblyDependencies<true> = {},
): ProductionAssembly {
  if (config.rssSsrfProtection === false) {
    logger.error({
      operation: "rss",
      reason: "rss_ssrf_protection_disabled",
    });
  }

  const injectedDatabase = dependencies.database;
  const database =
    injectedDatabase ??
    openOwnedDatabase(resolve(config.databasePath ?? DEFAULT_DATABASE_PATH));

  try {
    const clock = dependencies.clock ?? new SystemClock();
    const idGenerator = dependencies.idGenerator ?? new CryptoIdGenerator();
    const promptRepository = new PromptRepository(config.promptsDirectory);
    const completionClient =
      dependencies.textCompletionClient ??
      createChatCompletionsClient({
        endpoint: config.llmEndpoint,
        apiKey: config.llmApiKey,
        model: config.llmModel,
      });
    const typedLlmCalls: TypedLlmCalls = createTypedLlmCalls({
      prompts: promptRepository,
      completionClient,
    });

    const sourceRepository: SourceRepository = new SqliteSourceRepository(
      database,
      idGenerator,
    );
    const topicRepository: TopicRepository = new SqliteTopicRepository(
      database,
      idGenerator,
    );
    const sourceItemRepository = new SqliteSourceItemRepository(
      database,
      idGenerator,
    );
    const processingSourceItemRepository =
      new SqliteProcessingSourceItemRepository(database);
    const contentRepository = new SqliteContentRepository(
      database,
      idGenerator,
    );
    const knowledgeRepository = new SqliteKnowledgeRepository(database);
    const eventRepository = new SqliteEventRepository(database);
    const eventCandidateRepository = new SqliteEventCandidateRepository(
      database,
    );
    const topicAssociationRepository = new SqliteTopicAssociationRepository(
      database,
    );
    const topicPublishedItemRepository = new SqliteTopicPublishedItemRepository(
      database,
    );
    const publicationPublishedItemRepository: PublicationPublishedItemRepository =
      new SqlitePublicationPublishedItemRepository(database);
    const publicationTargetRepository = new SqlitePublicationTargetRepository(
      database,
    );
    const publicationSourceLinkRepository =
      new SqlitePublicationSourceLinkRepository(database);

    const sourceAdapter =
      dependencies.sourceAdapter ??
      createRssAdapter({ ssrfProtection: config.rssSsrfProtection });
    const adapterRegistry = createSourceAdapterRegistry(
      new Map<string, SourceAdapter>([["RSS", sourceAdapter]]),
    );

    const collectionLogger: CollectionLogger = reasonLogger(
      logger,
      "collection",
    );
    const processingLogger: ProcessingLogger = reasonLogger(
      logger,
      "processing",
    );
    const eventSearchLogger: EventSearchLogger = reasonLogger(
      logger,
      "event_search",
    );
    const eventAnalysisLogger: EventAnalysisLogger = reasonLogger(
      logger,
      "event_analysis",
    );
    const knowledgeLogger: KnowledgeLogger = reasonCallback(
      logger,
      "knowledge",
    );
    const topicMatchingLogger: TopicMatchingLogger = reasonCallback(
      logger,
      "topic_matching",
    );
    const publicationLogger: PublicationLogger = reasonCallback(
      logger,
      "publication",
    );
    const runtimeLogger: RuntimeLogger = reasonLogger(logger, "runtime");

    const collection = createCollection({
      database,
      sourceRepository,
      sourceItemRepository,
      adapters: adapterRegistry,
      clock,
      logger: collectionLogger,
    });
    const processing = createProcessing({
      database,
      sourceItemRepository: processingSourceItemRepository,
      contentRepository,
      typedLlmCalls,
      clock,
      logger: processingLogger,
    });
    const eventSearch = createEventSearch({
      database,
      contentRepository,
      candidateRepository: eventCandidateRepository,
      typedLlmCalls,
      logger: eventSearchLogger,
    });
    const eventAnalysis = createEventAnalysis({
      database,
      contentRepository,
      eventSearch,
      typedLlmCalls,
      eventRepository,
      clock,
      idGenerator,
      logger: eventAnalysisLogger,
    });
    const knowledge = createKnowledgeAnalysis({
      database,
      contentRepository,
      knowledgeRepository,
      typedLlmCalls,
      idGenerator,
      logger: knowledgeLogger,
    });
    const topicMatching = createTopicMatching({
      database,
      targetRepository: new SqliteTopicMatchingTargetRepository(database),
      topicRepository,
      associationRepository: topicAssociationRepository,
      publishedItemRepository: topicPublishedItemRepository,
      typedLlmCalls,
      clock,
      logger: topicMatchingLogger,
    });
    const pagesPublisher =
      config.rssPages === undefined
        ? dependencies.rssPages?.publisher
        : (dependencies.rssPages?.publisher ??
          createRssPagesPublisher({
            repository: config.rssPages.repository,
            branch: config.rssPages.branch,
            workDirectory: config.rssPages.workDirectory,
            publicOrigin: config.rssPages.publicOrigin,
            publicDirectory: config.rssPages.publicDirectory,
            timeoutMs: config.rssPages.publishTimeoutMs,
            pollIntervalMs: config.rssPages.pollIntervalMs,
          }));
    const rssStore =
      dependencies.rssPages?.artifactStore ??
      (config.rssPages === undefined
        ? undefined
        : createLocalArtifactStore(
            resolve(config.rssPages.workDirectory, "staging"),
          ));
    const rssSync =
      dependencies.rssPages?.localSync ??
      (config.rssPages === undefined
        ? undefined
        : createLocalRssSync({
            reader: createPublishedItemSource(
              publicationPublishedItemRepository,
            ),
            outputDirectory: resolve(config.rssPages.workDirectory, "staging"),
          }));
    const rssNotifier =
      dependencies.rssPages?.notifier ??
      (pagesPublisher !== undefined &&
      rssStore !== undefined &&
      rssSync !== undefined
        ? createRssPublicationNotifier(
            createRssFeedPublisher({
              sync: rssSync,
              store: rssStore,
              publisher: pagesPublisher,
            }),
          )
        : undefined);
    const pendingRssNotifications = new Set<Promise<void>>();
    const trackedRssNotifier: RssPublicationNotifier | undefined =
      rssNotifier === undefined
        ? undefined
        : {
            notify(feed) {
              const pending = rssNotifier.notify(feed);
              pendingRssNotifications.add(pending);
              void pending
                .finally(() => pendingRssNotifications.delete(pending))
                .catch(() => undefined);
              return pending;
            },
          };
    const drainRssNotifications = async (): Promise<void> => {
      while (pendingRssNotifications.size > 0)
        await Promise.allSettled([...pendingRssNotifications]);
    };
    const publication = createPublication({
      database,
      targetRepository: publicationTargetRepository,
      sourceLinkRepository: publicationSourceLinkRepository,
      publishedItemRepository: publicationPublishedItemRepository,
      clock,
      idGenerator,
      logger: publicationLogger,
      notify:
        trackedRssNotifier === undefined
          ? undefined
          : {
              notify: (feed) =>
                trackedRssNotifier.notify(
                  feed === "EVENT" ? "EVENT_UPDATES" : "CURATED_CONTENT",
                ),
            },
    });

    const services: StageServices = {
      collect(sourceId, options) {
        return collection.collect(sourceId, options);
      },
      process(sourceItemId, options) {
        return processing.process(sourceItemId, options);
      },
      analyzeEvent(contentId, options) {
        return eventAnalysis.analyze(contentId, options);
      },
      analyzeKnowledge(contentId, options) {
        return knowledge.analyze(contentId, options);
      },
      matchTopics(type, id, options) {
        return topicMatching.match(type, id, options);
      },
      publish(type, id, options) {
        return publication.publish(type, id, options);
      },
    };

    const runtime =
      dependencies.runtime ??
      createRuntime({
        services,
        logger: runtimeLogger,
      });
    const scheduler =
      dependencies.scheduler ??
      createCronScheduler({
        timezone: config.cronTimezone,
        sources: sourceRepository,
        submit(task) {
          return runtime.submit(task);
        },
      });

    const app = buildApp(config, logger, {
      repositories: {
        source: sourceRepository,
        topic: topicRepository,
      },
    });

    let cleanupFailed = false;
    let databaseClosed = false;
    let schedulerStartFailure: Error | undefined;
    let runtimeStarted: Promise<void> | undefined;
    let schedulerStarted: Promise<void> | undefined;
    let preCloseCompleted: Promise<void> | undefined;
    let closeCompleted: Promise<void> | undefined;

    const noteFailure = (operation: string, reason: string): void => {
      cleanupFailed = true;
      reportError(logger, operation, reason);
    };

    app.addHook("onReady", async () => {
      runtimeStarted ??= (async () => {
        try {
          await runtime.start();
          if (trackedRssNotifier !== undefined)
            await calibrateRssPublication(trackedRssNotifier);
        } catch {
          noteFailure("runtime", "start_error");
          throw new ProductionStartupError(RUNTIME_START_ERROR_MESSAGE);
        }
      })();
      await runtimeStarted;
    });

    app.addHook("onListen", async () => {
      schedulerStarted ??= (async () => {
        try {
          await scheduler.start();
        } catch {
          schedulerStartFailure = new ProductionStartupError(
            SCHEDULER_START_ERROR_MESSAGE,
          );
          noteFailure("scheduler", "start_error");
          throw schedulerStartFailure;
        }
      })();
      await schedulerStarted;
    });

    type FastifyListenCallback = (error: Error | null, address: string) => void;
    const startListening = app.listen.bind(app) as (
      options?: FastifyListenOptions,
    ) => Promise<string>;
    app.listen = ((
      optionsOrCallback?: FastifyListenOptions | FastifyListenCallback,
      maybeCallback?: FastifyListenCallback,
    ): Promise<string> | void => {
      const options =
        typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
      const callback =
        typeof optionsOrCallback === "function"
          ? optionsOrCallback
          : maybeCallback;
      const pending = startListening(options).then((address) => {
        if (schedulerStartFailure !== undefined) {
          throw schedulerStartFailure;
        }
        return address;
      });

      if (callback === undefined) {
        return pending;
      }

      void pending.then(
        (address) => callback(null, address),
        (error: unknown) => {
          callback(
            error instanceof Error
              ? error
              : new ProductionStartupError(SCHEDULER_START_ERROR_MESSAGE),
            "",
          );
        },
      );
    }) as typeof app.listen;

    app.addHook("preClose", async () => {
      preCloseCompleted ??= (async () => {
        try {
          scheduler.stop();
        } catch {
          noteFailure("scheduler", "stop_error");
        }

        try {
          await runtime.shutdown();
          await (dependencies.rssPages?.drain?.() ?? drainRssNotifications());
          await pagesPublisher?.close?.();
        } catch {
          noteFailure("runtime", "shutdown_error");
        }
      })();
      await preCloseCompleted;
    });

    app.addHook("onClose", async () => {
      closeCompleted ??= (async () => {
        if (!databaseClosed) {
          databaseClosed = true;
          try {
            closeDatabase(database);
          } catch {
            noteFailure("database", "close_error");
          }
        }

        if (cleanupFailed) {
          throw new ProductionCleanupError();
        }
      })();
      await closeCompleted;
    });

    return { app, runtime, scheduler, database };
  } catch (error) {
    try {
      closeDatabase(database);
    } catch {
      // Preserve the assembly failure.
    }
    throw error;
  }
}

export function buildProductionApp(
  config: AppConfig,
  logger: Logger,
): FastifyInstance {
  return createProductionAssembly(config, logger).app;
}
