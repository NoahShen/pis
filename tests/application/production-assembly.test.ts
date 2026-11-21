import { existsSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as collectionModule from "../../src/collection/index.js";
import * as adapterRegistryModule from "../../src/collection/adapter-registry.js";
import * as sourceItemRepositoryModule from "../../src/collection/source-item-repository.js";
import * as sourceAdapterModule from "../../src/adapters/rss-adapter.js";
import * as sourceRepositoryModule from "../../src/configuration/source-repository.js";
import * as topicRepositoryModule from "../../src/configuration/topic-repository.js";
import * as databaseModule from "../../src/database/open-database.js";
import * as eventAnalysisModule from "../../src/event-analysis/event-analysis.js";
import * as eventRepositoryModule from "../../src/event-analysis/event-repository.js";
import * as eventSearchModule from "../../src/event-search/event-search.js";
import * as eventCandidateRepositoryModule from "../../src/event-search/event-candidate-repository.js";
import * as knowledgeModule from "../../src/knowledge/knowledge.js";
import * as knowledgeRepositoryModule from "../../src/knowledge/knowledge-repository.js";
import * as chatClientModule from "../../src/llm/chat-completions-client.js";
import * as llmCallsModule from "../../src/llm/llm-calls.js";
import { startServer } from "../../src/lifecycle.js";
import * as contentRepositoryModule from "../../src/processing/content-repository.js";
import * as processingModule from "../../src/processing/processing.js";
import * as processingSourceItemRepositoryModule from "../../src/processing/source-item-repository.js";
import * as productionModule from "../../src/production/application.js";
import * as promptModule from "../../src/prompt/prompt-repository.js";
import * as publicationModule from "../../src/publication/publication.js";
import * as publicationPublishedItemRepositoryModule from "../../src/publication/published-item-repository.js";
import * as publicationSourceLinkRepositoryModule from "../../src/publication/source-link-repository.js";
import * as publicationTargetRepositoryModule from "../../src/publication/publication-target-repository.js";
import * as runtimeModule from "../../src/runtime/runtime.js";
import * as schedulerModule from "../../src/scheduler/cron-scheduler.js";
import * as topicAssociationRepositoryModule from "../../src/topic-matching/topic-association-repository.js";
import * as topicMatchingModule from "../../src/topic-matching/topic-matching.js";
import * as topicMatchingPublishedItemRepositoryModule from "../../src/topic-matching/published-item-repository.js";
import * as topicMatchingTargetRepositoryModule from "../../src/topic-matching/topic-matching-target-repository.js";
import type { CronSchedulerOptions } from "../../src/scheduler/contracts.js";
import type {
  RuntimeDependencies,
  RuntimeTask,
} from "../../src/runtime/contracts.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger, FakeSignals } from "../fixtures/captured-logger.js";
import {
  createProductionDependencyProbes,
  productionTestDependencies,
  ProductionDatabaseProbe,
  ProductionRuntimeProbe,
  ProductionSchedulerProbe,
} from "../fixtures/production-assembly.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const CLOSE_ERROR = "Production cleanup failed";
const RUNTIME_START_ERROR = "Production runtime failed to start";
const SCHEDULER_START_ERROR = "Production scheduler failed to start";
const actualCreateCollection = collectionModule.createCollection;
const actualCreateProcessing = processingModule.createProcessing;
const actualCreateEventSearch = eventSearchModule.createEventSearch;
const actualCreateEventAnalysis = eventAnalysisModule.createEventAnalysis;
const actualCreateKnowledge = knowledgeModule.createKnowledgeAnalysis;
const actualCreateTopicMatching = topicMatchingModule.createTopicMatching;
const actualCreatePublication = publicationModule.createPublication;

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map((app) => app.close().catch(() => undefined)),
  );
  vi.restoreAllMocks();
});

async function tempConfig(
  directory: string,
  overrides: Partial<ReturnType<typeof appConfig>> = {},
) {
  return appConfig({
    apiToken: TEST_API_TOKEN,
    databasePath: path.join(directory, "production.sqlite"),
    ...overrides,
  });
}

async function authJsonRequest(
  app: FastifyInstance,
  method: "POST" | "GET",
  url: string,
  payload?: string | object,
) {
  return await app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${TEST_API_TOKEN}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

function captureLifecycle(
  runtime: ProductionRuntimeProbe,
  scheduler: ProductionSchedulerProbe,
  database: ProductionDatabaseProbe,
): string[] {
  const events: string[] = [];
  vi.spyOn(runtime, "start").mockImplementation(async () => {
    runtime.startCalls += 1;
    events.push("runtime.start");
  });
  vi.spyOn(runtime, "shutdown").mockImplementation(async () => {
    runtime.shutdownCalls += 1;
    events.push("runtime.shutdown");
    if (runtime.shutdownError !== undefined) {
      throw runtime.shutdownError;
    }
  });
  vi.spyOn(scheduler, "start").mockImplementation(() => {
    scheduler.startCalls += 1;
    events.push("scheduler.start");
    if (scheduler.startError !== undefined) {
      throw scheduler.startError;
    }
  });
  vi.spyOn(scheduler, "stop").mockImplementation(() => {
    scheduler.stopCalls += 1;
    events.push("scheduler.stop");
    if (scheduler.stopError !== undefined) {
      throw scheduler.stopError;
    }
  });
  vi.spyOn(database, "close").mockImplementation(() => {
    events.push("db.close");
    database.closeCalls += 1;
    if (database.closeError !== undefined) {
      throw database.closeError;
    }
    database.open = false;
  });
  return events;
}

describe("production assembly", () => {
  it("opens and initializes SQLite once, builds shared singletons, wires all six stages and configuration APIs", async () => {
    await withTempDirectory(async (directory) => {
      const openSpy = vi.spyOn(databaseModule, "openDatabase");
      const initializeSpy = vi.spyOn(
        await import("../../src/database/schema.js"),
        "initializeDatabase",
      );
      const promptSpy = vi.spyOn(promptModule, "PromptRepository");
      const chatClientSpy = vi.spyOn(
        chatClientModule,
        "createChatCompletionsClient",
      );
      const typedCallsSpy = vi.spyOn(llmCallsModule, "createTypedLlmCalls");
      const rssAdapterSpy = vi.spyOn(sourceAdapterModule, "createRssAdapter");
      const adapterRegistrySpy = vi.spyOn(
        adapterRegistryModule,
        "createSourceAdapterRegistry",
      );
      const sourceRepositorySpy = vi.spyOn(
        sourceRepositoryModule,
        "SqliteSourceRepository",
      );
      const topicRepositorySpy = vi.spyOn(
        topicRepositoryModule,
        "SqliteTopicRepository",
      );
      const sourceItemRepositorySpy = vi.spyOn(
        sourceItemRepositoryModule,
        "SqliteSourceItemRepository",
      );
      const contentRepositorySpy = vi.spyOn(
        contentRepositoryModule,
        "SqliteContentRepository",
      );
      const knowledgeRepositorySpy = vi.spyOn(
        knowledgeRepositoryModule,
        "SqliteKnowledgeRepository",
      );
      const eventRepositorySpy = vi.spyOn(
        eventRepositoryModule,
        "SqliteEventRepository",
      );
      const candidateRepositorySpy = vi.spyOn(
        eventCandidateRepositoryModule,
        "SqliteEventCandidateRepository",
      );
      const associationRepositorySpy = vi.spyOn(
        topicAssociationRepositoryModule,
        "SqliteTopicAssociationRepository",
      );
      const topicPublishedRepositorySpy = vi.spyOn(
        topicMatchingPublishedItemRepositoryModule,
        "SqlitePublishedItemRepository",
      );
      const topicMatchingTargetRepositorySpy = vi.spyOn(
        topicMatchingTargetRepositoryModule,
        "SqliteTopicMatchingTargetRepository",
      );
      const publicationPublishedRepositorySpy = vi.spyOn(
        publicationPublishedItemRepositoryModule,
        "SqlitePublishedItemRepository",
      );
      const publicationTargetRepositorySpy = vi.spyOn(
        publicationTargetRepositoryModule,
        "SqlitePublicationTargetRepository",
      );
      const publicationSourceLinkRepositorySpy = vi.spyOn(
        publicationSourceLinkRepositoryModule,
        "SqlitePublicationSourceLinkRepository",
      );
      const collectMethod = vi.fn();
      const collectionSpy = vi
        .spyOn(collectionModule, "createCollection")
        .mockImplementation((dependencies) => {
          const service = actualCreateCollection(dependencies);
          collectMethod.mockImplementation((sourceId, options) =>
            service.collect(sourceId, options),
          );
          return { collect: collectMethod };
        });
      const processMethod = vi.fn();
      const processingSpy = vi
        .spyOn(processingModule, "createProcessing")
        .mockImplementation((dependencies) => {
          const service = actualCreateProcessing(dependencies);
          processMethod.mockImplementation((sourceItemId, options) =>
            service.process(sourceItemId, options),
          );
          return { process: processMethod };
        });
      const searchMethod = vi.fn();
      const eventSearchSpy = vi
        .spyOn(eventSearchModule, "createEventSearch")
        .mockImplementation((dependencies) => {
          const service = actualCreateEventSearch(dependencies);
          searchMethod.mockImplementation((contentId, options) =>
            service.search(contentId, options),
          );
          return { search: searchMethod };
        });
      const analyzeEventMethod = vi.fn();
      const eventAnalysisSpy = vi
        .spyOn(eventAnalysisModule, "createEventAnalysis")
        .mockImplementation((dependencies) => {
          const service = actualCreateEventAnalysis(dependencies);
          analyzeEventMethod.mockImplementation((contentId, options) =>
            service.analyze(contentId, options),
          );
          return { analyze: analyzeEventMethod };
        });
      const analyzeKnowledgeMethod = vi.fn();
      const knowledgeSpy = vi
        .spyOn(knowledgeModule, "createKnowledgeAnalysis")
        .mockImplementation((dependencies) => {
          const service = actualCreateKnowledge(dependencies);
          analyzeKnowledgeMethod.mockImplementation((contentId, options) =>
            service.analyze(contentId, options),
          );
          return { analyze: analyzeKnowledgeMethod };
        });
      const matchTopicsMethod = vi.fn();
      const topicMatchingSpy = vi
        .spyOn(topicMatchingModule, "createTopicMatching")
        .mockImplementation((dependencies) => {
          const service = actualCreateTopicMatching(dependencies);
          matchTopicsMethod.mockImplementation((type, id, options) =>
            service.match(type, id, options),
          );
          return { match: matchTopicsMethod };
        });
      const publishMethod = vi.fn();
      const publicationSpy = vi
        .spyOn(publicationModule, "createPublication")
        .mockImplementation((dependencies) => {
          const service = actualCreatePublication(dependencies);
          publishMethod.mockImplementation((type, id, options) =>
            service.publish(type, id, options),
          );
          return { publish: publishMethod };
        });
      const runtimeSpy = vi.spyOn(runtimeModule, "createRuntime");
      const schedulerSpy = vi.spyOn(schedulerModule, "createCronScheduler");
      const logger = new CapturedLogger();
      const config = await tempConfig(directory);

      const assembly = productionModule.createProductionAssembly(
        config,
        logger,
      );
      openApps.push(assembly.app);

      expect(openSpy).toHaveBeenCalledExactlyOnceWith(config.databasePath);
      expect(initializeSpy).toHaveBeenCalledExactlyOnceWith(assembly.database);
      expect(existsSync(config.databasePath as string)).toBe(true);

      const promptRepository = promptSpy.mock.instances[0];
      const completionClient = chatClientSpy.mock.results[0]?.value;
      const typedLlmCalls = typedCallsSpy.mock.results[0]?.value;
      expect(promptSpy).toHaveBeenCalledExactlyOnceWith(
        config.promptsDirectory,
      );
      expect(chatClientSpy).toHaveBeenCalledExactlyOnceWith({
        endpoint: config.llmEndpoint,
        apiKey: config.llmApiKey,
        model: config.llmModel,
      });
      expect(typedCallsSpy).toHaveBeenCalledExactlyOnceWith({
        prompts: promptRepository,
        completionClient,
      });
      expect(typedLlmCalls).toMatchObject({
        routeProcessing: expect.any(Function),
        searchEvents: expect.any(Function),
        analyzeEvents: expect.any(Function),
        analyzeKnowledge: expect.any(Function),
        matchTopics: expect.any(Function),
      });
      expect(rssAdapterSpy).toHaveBeenCalledExactlyOnceWith({
        ssrfProtection: true,
      });
      const sourceAdapter = rssAdapterSpy.mock.results[0]?.value;
      const adapterRegistry = adapterRegistrySpy.mock.results[0]?.value;
      expect(adapterRegistrySpy).toHaveBeenCalledOnce();
      expect(adapterRegistry?.get("RSS")).toBe(sourceAdapter);

      const sourceRepository = sourceRepositorySpy.mock.instances[0];
      const topicRepository = topicRepositorySpy.mock.instances[0];
      const sourceItemRepository = sourceItemRepositorySpy.mock.instances[0];
      const contentRepository = contentRepositorySpy.mock.instances[0];
      const knowledgeRepository = knowledgeRepositorySpy.mock.instances[0];
      const eventRepository = eventRepositorySpy.mock.instances[0];
      const candidateRepository = candidateRepositorySpy.mock.instances[0];
      const associationRepository = associationRepositorySpy.mock.instances[0];
      const topicPublishedRepository =
        topicPublishedRepositorySpy.mock.instances[0];
      const topicMatchingTargetRepository =
        topicMatchingTargetRepositorySpy.mock.instances[0];
      const publicationPublishedRepository =
        publicationPublishedRepositorySpy.mock.instances[0];
      const publicationTargetRepository =
        publicationTargetRepositorySpy.mock.instances[0];
      const publicationSourceLinkRepository =
        publicationSourceLinkRepositorySpy.mock.instances[0];

      expect(sourceRepositorySpy).toHaveBeenCalledOnce();
      expect(topicRepositorySpy).toHaveBeenCalledOnce();
      expect(sourceItemRepositorySpy).toHaveBeenCalledOnce();
      expect(contentRepositorySpy).toHaveBeenCalledOnce();
      expect(knowledgeRepositorySpy).toHaveBeenCalledOnce();
      expect(eventRepositorySpy).toHaveBeenCalledOnce();
      expect(candidateRepositorySpy).toHaveBeenCalledOnce();
      expect(associationRepositorySpy).toHaveBeenCalledOnce();
      expect(topicPublishedRepositorySpy).toHaveBeenCalledOnce();
      expect(topicMatchingTargetRepositorySpy).toHaveBeenCalledOnce();
      expect(publicationPublishedRepositorySpy).toHaveBeenCalledOnce();
      expect(publicationTargetRepositorySpy).toHaveBeenCalledOnce();
      expect(publicationSourceLinkRepositorySpy).toHaveBeenCalledOnce();

      const idGenerator = sourceRepositorySpy.mock.calls[0]?.[1];
      expect(topicRepositorySpy.mock.calls[0]?.[1]).toBe(idGenerator);
      expect(sourceItemRepositorySpy.mock.calls[0]?.[1]).toBe(idGenerator);
      expect(contentRepositorySpy.mock.calls[0]?.[1]).toBe(idGenerator);
      for (const repositorySpy of [
        knowledgeRepositorySpy,
        eventRepositorySpy,
        candidateRepositorySpy,
        associationRepositorySpy,
        topicPublishedRepositorySpy,
        topicMatchingTargetRepositorySpy,
        publicationPublishedRepositorySpy,
        publicationTargetRepositorySpy,
        publicationSourceLinkRepositorySpy,
      ]) {
        expect(repositorySpy.mock.calls[0]?.[0]).toBe(assembly.database);
      }

      const collectionDependencies = collectionSpy.mock.calls[0]?.[0];
      expect(collectionDependencies).toMatchObject({
        database: assembly.database,
        sourceRepository,
        sourceItemRepository,
      });
      expect(processingSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        contentRepository,
        typedLlmCalls,
      });
      expect(eventSearchSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        contentRepository,
        candidateRepository,
        typedLlmCalls,
      });
      expect(eventAnalysisSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        contentRepository,
        eventRepository,
        typedLlmCalls,
        idGenerator,
      });
      expect(knowledgeSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        contentRepository,
        knowledgeRepository,
        typedLlmCalls,
        idGenerator,
      });
      expect(topicMatchingSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        targetRepository: topicMatchingTargetRepository,
        topicRepository,
        associationRepository,
        publishedItemRepository: topicPublishedRepository,
        typedLlmCalls,
      });
      expect(publicationSpy.mock.calls[0]?.[0]).toMatchObject({
        database: assembly.database,
        targetRepository: publicationTargetRepository,
        sourceLinkRepository: publicationSourceLinkRepository,
        publishedItemRepository: publicationPublishedRepository,
        idGenerator,
      });
      const clock = collectionDependencies.clock;
      expect(processingSpy.mock.calls[0]?.[0].clock).toBe(clock);
      expect(eventAnalysisSpy.mock.calls[0]?.[0].clock).toBe(clock);
      expect(topicMatchingSpy.mock.calls[0]?.[0].clock).toBe(clock);
      expect(publicationSpy.mock.calls[0]?.[0].clock).toBe(clock);

      expect(runtimeSpy).toHaveBeenCalledOnce();
      expect(schedulerSpy).toHaveBeenCalledOnce();
      expect(Object.keys(assembly).sort()).toEqual([
        "app",
        "database",
        "runtime",
        "scheduler",
      ]);
      const runtimeDependencies = runtimeSpy.mock
        .calls[0]?.[0] as RuntimeDependencies;
      const services = runtimeDependencies.services;
      expect(Object.keys(services).sort()).toEqual([
        "analyzeEvent",
        "analyzeKnowledge",
        "collect",
        "matchTopics",
        "process",
        "publish",
      ]);
      expect(runtimeDependencies).not.toHaveProperty("queueCapacity");
      expect(runtimeDependencies).not.toHaveProperty("maxAttempts");
      expect(runtimeDependencies).not.toHaveProperty("dispatchAttempts");
      expect(runtimeDependencies).not.toHaveProperty("shutdownTimeoutMs");
      expect(runtimeDependencies).not.toHaveProperty("shutdownGraceMs");

      const schedulerOptions = schedulerSpy.mock
        .calls[0]?.[0] as CronSchedulerOptions;
      expect(schedulerOptions.timezone).toBe(config.cronTimezone);
      expect(schedulerOptions.sources).toBe(sourceRepository);
      const runtimeSubmitSpy = vi.spyOn(assembly.runtime, "submit");
      const task: RuntimeTask = { type: "COLLECT", source_id: "source-1" };
      await schedulerOptions.submit(task);
      expect(runtimeSubmitSpy).toHaveBeenCalledExactlyOnceWith(task);

      const signal = new AbortController().signal;
      await services.collect("missing-source", { signal });
      await services.process("missing-source-item", { signal });
      await services.analyzeEvent("missing-content", { signal });
      await services.analyzeKnowledge("missing-content", { signal });
      await expect(
        services.matchTopics("EVENT", "missing-target", { signal }),
      ).rejects.toMatchObject({ code: "target_not_found" });
      await services.publish("EVENT", "missing-target", { signal });
      expect(collectMethod).toHaveBeenCalledExactlyOnceWith("missing-source", {
        signal,
      });
      expect(processMethod).toHaveBeenCalledExactlyOnceWith(
        "missing-source-item",
        { signal },
      );
      expect(analyzeEventMethod).toHaveBeenCalledExactlyOnceWith(
        "missing-content",
        { signal },
      );
      expect(searchMethod).toHaveBeenCalledExactlyOnceWith("missing-content", {
        signal,
      });
      expect(analyzeKnowledgeMethod).toHaveBeenCalledExactlyOnceWith(
        "missing-content",
        { signal },
      );
      expect(matchTopicsMethod).toHaveBeenCalledExactlyOnceWith(
        "EVENT",
        "missing-target",
        { signal },
      );
      expect(publishMethod).toHaveBeenCalledExactlyOnceWith(
        "EVENT",
        "missing-target",
        { signal },
      );

      const sourceCreated = await authJsonRequest(
        assembly.app,
        "POST",
        "/api/sources",
        {
          name: "Production Source",
          type: "RSS",
          url: "https://example.test/feed.xml",
          cron: "0 * * * *",
        },
      );
      expect(sourceCreated.statusCode).toBe(201);
      const sourceListed = await authJsonRequest(
        assembly.app,
        "GET",
        "/api/sources",
      );
      expect(sourceListed.statusCode).toBe(200);
      expect(sourceListed.json()).toMatchObject({
        items: [{ name: "Production Source" }],
      });

      const topicCreated = await authJsonRequest(
        assembly.app,
        "POST",
        "/api/topics",
        {
          name: "Production Topic",
          description: "Configuration API topic",
        },
      );
      expect(topicCreated.statusCode).toBe(201);
      const topicListed = await authJsonRequest(
        assembly.app,
        "GET",
        "/api/topics",
      );
      expect(topicListed.statusCode).toBe(200);
      expect(topicListed.json()).toMatchObject({
        items: [{ name: "Production Topic" }],
      });

      await assembly.app.close();
      openApps.splice(openApps.indexOf(assembly.app), 1);
    });
  });

  it("does not create a second runtime when all six services are assembled", async () => {
    const probes = createProductionDependencyProbes();
    const runtimeSpy = vi.spyOn(runtimeModule, "createRuntime");
    const logger = new CapturedLogger();
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      logger,
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    expect(runtimeSpy).not.toHaveBeenCalled();
    expect(assembly.runtime).toBe(probes.runtime);

    await assembly.app.close();
    openApps.splice(openApps.indexOf(assembly.app), 1);
  });

  it("emits the safe SSRF warning exactly once only when protection is disabled", async () => {
    const disabledLogger = new CapturedLogger();
    const disabledProbes = createProductionDependencyProbes();
    const disabledConfig = appConfig({
      rssSsrfProtection: false,
      llmApiKey: "warning-secret-sentinel",
      llmEndpoint: "https://warning-endpoint-sentinel.example.test/v1",
    });
    const disabled = productionModule.createProductionAssembly(
      disabledConfig,
      disabledLogger,
      productionTestDependencies(disabledProbes),
    );
    openApps.push(disabled.app);

    expect(disabledLogger.errorEntries).toEqual([
      { operation: "rss", reason: "rss_ssrf_protection_disabled" },
    ]);
    const logged = JSON.stringify(disabledLogger.errorEntries);
    for (const sentinel of [
      "warning-secret-sentinel",
      "warning-endpoint-sentinel",
      "127.0.0.1",
      "authorization",
      "header",
    ]) {
      expect(logged).not.toContain(sentinel);
    }

    const enabledLogger = new CapturedLogger();
    const enabledProbes = createProductionDependencyProbes();
    const enabled = productionModule.createProductionAssembly(
      appConfig({ rssSsrfProtection: true }),
      enabledLogger,
      productionTestDependencies(enabledProbes),
    );
    openApps.push(enabled.app);

    expect(enabledLogger.errorEntries).toEqual([]);

    await disabled.app.close();
    await enabled.app.close();
    openApps.splice(openApps.indexOf(disabled.app), 1);
    openApps.splice(openApps.indexOf(enabled.app), 1);
    expect(disabledProbes.database.closeCalls).toBe(1);
    expect(enabledProbes.database.closeCalls).toBe(1);
    expect(disabledLogger.errorEntries).toEqual([
      { operation: "rss", reason: "rss_ssrf_protection_disabled" },
    ]);
    expect(enabledLogger.errorEntries).toEqual([]);
  });

  it("does not truncate Pages calibration after Fastify's former default hook timeout", async () => {
    const probes = createProductionDependencyProbes();
    const events = captureLifecycle(
      probes.runtime,
      probes.scheduler,
      probes.database,
    );
    const notify = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 10_001)),
    );
    const closePublisher = vi.fn(async () => undefined);
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      new CapturedLogger(),
      {
        ...productionTestDependencies(probes),
        rssPages: {
          notifier: { notify },
          publisher: { publish: vi.fn(), close: closePublisher },
        },
      },
    );
    openApps.push(assembly.app);

    expect(assembly.app.initialConfig.pluginTimeout).toBe(0);
    vi.useFakeTimers();
    try {
      const ready = assembly.app.ready();
      await vi.advanceTimersByTimeAsync(20_002);
      await expect(ready).resolves.toBe(assembly.app);
      expect(notify).toHaveBeenCalledTimes(2);
      await assembly.app.close();
      openApps.splice(openApps.indexOf(assembly.app), 1);
    } finally {
      vi.useRealTimers();
    }

    expect(events).toEqual([
      "runtime.start",
      "scheduler.stop",
      "runtime.shutdown",
      "db.close",
    ]);
    expect(closePublisher).toHaveBeenCalledOnce();
  });

  it("cleans up when Pages calibration fails", async () => {
    const probes = createProductionDependencyProbes();
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      new CapturedLogger(),
      {
        ...productionTestDependencies(probes),
        rssPages: {
          notifier: { notify: vi.fn().mockRejectedValue(new Error("private")) },
          publisher: { publish: vi.fn(), close: vi.fn(async () => undefined) },
        },
      },
    );
    openApps.push(assembly.app);

    await expect(assembly.app.ready()).rejects.toThrow(RUNTIME_START_ERROR);
    await expect(assembly.app.close()).rejects.toThrow(CLOSE_ERROR);
    openApps.splice(openApps.indexOf(assembly.app), 1);
    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
  });

  it("runs ready/listen/close in the required order and makes close idempotent", async () => {
    const probes = createProductionDependencyProbes();
    const events = captureLifecycle(
      probes.runtime,
      probes.scheduler,
      probes.database,
    );

    const assembly = productionModule.createProductionAssembly(
      appConfig({ host: "127.0.0.1", port: 0 }),
      new CapturedLogger(),
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    const originalClose = assembly.app.server.close.bind(assembly.app.server);
    assembly.app.server.close = ((callback?: (error?: Error) => void) => {
      events.push("http.close");
      return originalClose(callback);
    }) as typeof assembly.app.server.close;

    await assembly.app.listen({ host: "127.0.0.1", port: 0 });
    await assembly.app.close();
    await assembly.app.close();
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(events).toEqual([
      "runtime.start",
      "scheduler.start",
      "scheduler.stop",
      "runtime.shutdown",
      "http.close",
      "db.close",
    ]);
    expect(probes.runtime.startCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.scheduler.startCalls).toBe(1);
    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
  });

  it("closes a database opened before a later assembly factory failure", async () => {
    await withTempDirectory(async (directory) => {
      const closeSpy = vi.spyOn(Database.prototype, "close");
      vi.spyOn(collectionModule, "createCollection").mockImplementation(() => {
        throw new Error("assembly construction detail");
      });

      expect(() =>
        productionModule.createProductionAssembly(
          appConfig({
            databasePath: path.join(directory, "production.sqlite"),
          }),
          new CapturedLogger(),
        ),
      ).toThrow("assembly construction detail");
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("runs scheduler stop, runtime shutdown and DB close when ready fails", async () => {
    const probes = createProductionDependencyProbes();
    probes.runtime.startError = new Error("private ready detail");
    const logger = new CapturedLogger();
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      logger,
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    await expect(assembly.app.ready()).rejects.toThrow(RUNTIME_START_ERROR);
    await expect(assembly.app.close()).rejects.toThrow(CLOSE_ERROR);
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(probes.runtime.startCalls).toBe(1);
    expect(probes.scheduler.startCalls).toBe(0);
    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "runtime", reason: "start_error" },
    ]);
  });

  it("uses the same cleanup when listening fails before scheduler startup", async () => {
    const probes = createProductionDependencyProbes();
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const assembly = productionModule.createProductionAssembly(
      appConfig({ host: "127.0.0.1", port: 0 }),
      logger,
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);
    assembly.app.listen = async () => {
      throw new Error("private listen detail");
    };

    const server = startServer({
      app: assembly.app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });

    await expect(server.ready).rejects.toThrow("Server failed to listen");
    await expect(server.completed).resolves.toMatchObject({
      code: 1,
      reason: "listen_error",
    });
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(probes.runtime.startCalls).toBe(0);
    expect(probes.scheduler.startCalls).toBe(0);
    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
  });

  it("continues cleanup and reports a stable close error when scheduler startup fails", async () => {
    const probes = createProductionDependencyProbes();
    probes.scheduler.startError = new Error("private scheduler startup detail");
    const assembly = productionModule.createProductionAssembly(
      appConfig({ host: "127.0.0.1", port: 0 }),
      new CapturedLogger(),
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    await expect(
      assembly.app.listen({ host: "127.0.0.1", port: 0 }),
    ).rejects.toThrow(SCHEDULER_START_ERROR);
    await expect(assembly.app.close()).rejects.toThrow(CLOSE_ERROR);
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(probes.runtime.startCalls).toBe(1);
    expect(probes.scheduler.startCalls).toBe(1);
    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
  });

  it("continues later cleanup when scheduler stop and runtime shutdown both fail", async () => {
    const probes = createProductionDependencyProbes();
    probes.scheduler.stopError = new Error("private scheduler stop detail");
    probes.runtime.shutdownError = new Error("private runtime shutdown detail");
    const logger = new CapturedLogger();
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      logger,
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    await assembly.app.ready();
    await expect(assembly.app.close()).rejects.toThrow(CLOSE_ERROR);
    await expect(assembly.app.close()).resolves.toBeUndefined();
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "scheduler", reason: "stop_error" },
      { operation: "runtime", reason: "shutdown_error" },
    ]);
  });

  it("reports DB close failure after HTTP/runtime/scheduler cleanup without repeating close", async () => {
    const probes = createProductionDependencyProbes();
    probes.database.closeError = new Error("private database close detail");
    const logger = new CapturedLogger();
    const assembly = productionModule.createProductionAssembly(
      appConfig(),
      logger,
      productionTestDependencies(probes),
    );
    openApps.push(assembly.app);

    await assembly.app.ready();
    await expect(assembly.app.close()).rejects.toThrow(CLOSE_ERROR);
    await expect(assembly.app.close()).resolves.toBeUndefined();
    openApps.splice(openApps.indexOf(assembly.app), 1);

    expect(probes.scheduler.stopCalls).toBe(1);
    expect(probes.runtime.shutdownCalls).toBe(1);
    expect(probes.database.closeCalls).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "database", reason: "close_error" },
    ]);
  });

  it("keeps the lightweight buildApp path free of LLM and Runtime construction", async () => {
    const runtimeSpy = vi.spyOn(runtimeModule, "createRuntime");
    const chatClientSpy = vi.spyOn(
      chatClientModule,
      "createChatCompletionsClient",
    );
    const { buildApp } = await import("../../src/app.js");
    const lightweight = buildApp(appConfig(), new CapturedLogger(), {
      repositories: {
        source: new sourceRepositoryModule.SqliteSourceRepository(
          new ProductionDatabaseProbe().asDatabase(),
          { next: () => "unused" },
        ),
        topic: new topicRepositoryModule.SqliteTopicRepository(
          new ProductionDatabaseProbe().asDatabase(),
          { next: () => "unused" },
        ),
      },
    });

    expect(lightweight).toBeDefined();
    expect(runtimeSpy).not.toHaveBeenCalled();
    expect(chatClientSpy).not.toHaveBeenCalled();
    await lightweight.close();
  });
});
