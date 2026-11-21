import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";

import type { EventAnalysisResponse } from "../../src/llm/response-validators.js";
import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import { createProductionAssembly } from "../../src/production/application.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import {
  createLocalArtifactStore,
  createLocalRssSync,
  createPublishedItemSource,
  createRssFeedPublisher,
  type RssArtifactStore,
  type RssFeedKind,
} from "../../src/rss/index.js";
import { appConfig, TEST_API_TOKEN } from "./app-config.js";
import { CapturedLogger } from "./captured-logger.js";
import {
  E2E_DEFAULT_DATABASE_PATH,
  RecordingPublisher,
  type KnowledgeResponse,
} from "./e2e-pipeline.js";
import { FakeClock } from "./fake-clock.js";
import { HttpFixture } from "./http-fixture.js";
import { createProductionIntegrationSourceAdapter } from "./production-integration.js";
import {
  seedRssDatabasePublishedItems,
  withRssDatabase,
} from "./rss-database.js";
import { articleHtml } from "./rss-content.js";
import { rssFeed } from "./rss-list.js";
import { withTempDirectory } from "./temp-directory.js";

export interface CrossPathTurn {
  readonly analysis:
    | EventAnalysisResponse
    | ((candidateIds: readonly string[]) => EventAnalysisResponse);
}

export interface CrossPathOptions {
  readonly name: string;
  readonly route: "EVENT" | "KNOWLEDGE" | "BOTH";
  readonly topicCount?: number;
  readonly eventTurns?: readonly CrossPathTurn[];
  readonly knowledgeTurns?: readonly KnowledgeResponse[];
  readonly matchTopics?: boolean;
}

class CrossPathLlmStub implements TextCompletionClient {
  readonly operations: string[] = [];
  private readonly eventTurns: readonly CrossPathTurn[];
  private readonly knowledgeTurns: readonly KnowledgeResponse[];
  private eventTurn = 0;
  private knowledgeTurn = 0;

  constructor(
    private readonly options: CrossPathOptions,
    private readonly topicIds: () => readonly string[],
  ) {
    this.eventTurns = options.eventTurns ?? [];
    this.knowledgeTurns = options.knowledgeTurns ?? [];
  }

  async complete(request: TextCompletionRequest): Promise<string> {
    const user = JSON.parse(request.userContent) as {
      user_context?: unknown;
      task_data?: {
        target?: { target_type?: string };
        candidates?: Array<{ id: string }>;
        url?: unknown;
      };
    };
    if (user.task_data?.target !== undefined) {
      this.operations.push("topic-matching");
      return JSON.stringify({
        matched_topic_ids:
          this.options.matchTopics === false ? [] : this.topicIds(),
      });
    }
    if (Object.prototype.hasOwnProperty.call(user, "user_context")) {
      this.operations.push("knowledge-analysis");
      const response = this.knowledgeTurns[this.knowledgeTurn];
      this.knowledgeTurn += 1;
      return JSON.stringify(response ?? { valuable: false });
    }
    if (user.task_data?.candidates !== undefined) {
      this.operations.push("event-analysis");
      const turn = this.eventTurns[this.eventTurn];
      this.eventTurn += 1;
      if (turn === undefined) return JSON.stringify({ results: [] });
      const analysis =
        typeof turn.analysis === "function"
          ? turn.analysis(user.task_data.candidates.map(({ id }) => id))
          : turn.analysis;
      return JSON.stringify(analysis);
    }
    if (Object.prototype.hasOwnProperty.call(user.task_data, "url")) {
      this.operations.push("processing-route");
      return JSON.stringify({
        routes:
          this.options.route === "BOTH"
            ? ["EVENT", "KNOWLEDGE"]
            : [this.options.route],
      });
    }
    this.operations.push("event-search");
    return JSON.stringify({
      clues: [
        {
          entity_name: "Cross Path Regulator",
          subject: "Investigation",
          search_terms: ["Cross Path Event"],
        },
      ],
    });
  }
}

export interface CrossPathHarness {
  readonly assembly: ReturnType<typeof createProductionAssembly>;
  readonly llm: CrossPathLlmStub;
  readonly publisher: RecordingPublisher;
  readonly sourceId: string;
  readonly topicIds: readonly string[];
  setEntry(guid: string, title: string, body?: string): void;
  collect(): Promise<void>;
  close(): Promise<void>;
}

export async function withCrossPathHarness(
  options: CrossPathOptions,
  test: (harness: CrossPathHarness) => Promise<void>,
): Promise<void> {
  expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
  await withTempDirectory(async (directory) => {
    const http = new HttpFixture();
    const transport = new AbortController();
    const logger = new CapturedLogger();
    const publisher = new RecordingPublisher();
    const topicIds: string[] = [];
    let sourceId = "";
    let guid = `${options.name}-guid-1`;
    let title = "Original cross-path entry";
    let body = "Original cross-path article body.";
    let generatedId = 0;
    let currentApp: ReturnType<typeof createProductionAssembly>["app"];
    const postConfiguration = async (
      url: string,
      payload: object,
    ): Promise<string> => {
      const response = await currentApp.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${TEST_API_TOKEN}`,
          "content-type": "application/json",
        },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>().id;
    };
    await http.start();
    const feedPath = `/${options.name}-feed`;
    const articlePath = `/${options.name}-article`;
    http
      .route(feedPath, ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.end(
          rssFeed(
            `<item><guid>${guid}</guid><title>${title}</title><link>${http.origin}${articlePath}</link><description>${body}</description></item>`,
          ),
        );
      })
      .route(articlePath, ({ response }) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(articleHtml());
      });
    const promptsDirectory = path.join(directory, "prompts");
    await mkdir(promptsDirectory, { recursive: true });
    await Promise.all(
      [
        "processing-route",
        "event-search",
        "event-analysis",
        "knowledge-analysis",
        "topic-matching",
        "user-context",
      ].map((name) =>
        writeFile(
          path.join(promptsDirectory, `${name}.md`),
          `Synthetic ${name} instructions.\n`,
        ),
      ),
    );
    const llm = new CrossPathLlmStub(options, () => topicIds);
    const assembly = createProductionAssembly(
      appConfig({
        databasePath: path.join(directory, "history.sqlite"),
        promptsDirectory,
        rssPages: {
          repository: "git@example.test:e2e/unused.git",
          branch: "main",
          workDirectory: path.join(directory, "rss"),
          publicOrigin: "https://example.test",
          publicDirectory: "",
          publishTimeoutMs: 5_000,
          pollIntervalMs: 100,
        },
      }),
      logger,
      {
        clock: new FakeClock(new Date("2026-11-20T00:00:00.000Z")),
        idGenerator: {
          next() {
            generatedId += 1;
            return `${options.name}-${generatedId}`;
          },
        },
        textCompletionClient: llm,
        sourceAdapter: createProductionIntegrationSourceAdapter({
          fixture: http,
          signal: transport.signal,
          onCollect: () => undefined,
        }),
        rssPages: { publisher },
      },
    );
    currentApp = assembly.app;
    const close = async (): Promise<void> => {
      try {
        await assembly.app.close();
      } finally {
        transport.abort();
        await http.close();
      }
    };
    try {
      await assembly.app.ready();
      sourceId = await postConfiguration("/api/sources", {
        name: "Cross-path source",
        type: "RSS",
        url: `${http.origin}${feedPath}`,
        cron: "0 0 * * *",
      });
      for (let index = 0; index < (options.topicCount ?? 1); index += 1) {
        topicIds.push(
          await postConfiguration("/api/topics", {
            name: `Cross-path topic ${index}`,
            description: `Cross-path topic ${index}`,
          }),
        );
      }
      await assembly.app.listen({ host: "127.0.0.1", port: 0 });
      const harness: CrossPathHarness = {
        assembly,
        llm,
        publisher,
        get sourceId() {
          return sourceId;
        },
        topicIds,
        setEntry(nextGuid, nextTitle, nextBody = body) {
          guid = nextGuid;
          title = nextTitle;
          body = nextBody;
        },
        async collect() {
          await assembly.scheduler.trigger(sourceId);
          await assembly.runtime.drain();
          const published = assembly.database
            .prepare("SELECT COUNT(*) AS count FROM published_items")
            .get() as { count: number };
          await publisher.waitForVersions(2 + published.count);
        },
        close,
      };
      await test(harness);
    } finally {
      await close();
    }
  });
  expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
}

export interface HistoryHarness {
  readonly directory: string;
  readonly store: RssArtifactStore;
  readonly publisher: RecordingPublisher;
  publish(feed: RssFeedKind): Promise<void>;
}

export async function withPublishedHistory(
  items: Readonly<Record<RssFeedKind, readonly PublishedItem[]>>,
  test: (harness: HistoryHarness) => Promise<void>,
): Promise<void> {
  await withTempDirectory(async (directory) => {
    await withRssDatabase(async (database) => {
      seedRssDatabasePublishedItems(database, [
        ...items.EVENT_UPDATES,
        ...items.CURATED_CONTENT,
      ]);
      const store = createLocalArtifactStore(directory);
      const sync = createLocalRssSync({
        reader: createPublishedItemSource(
          new SqlitePublishedItemRepository(database),
        ),
        outputDirectory: directory,
      });
      const publisher = new RecordingPublisher();
      const publishFeed = createRssFeedPublisher({ sync, store, publisher });
      await test({
        directory,
        store,
        publisher,
        publish: async (feed) => {
          await publishFeed(feed);
          await publisher.drain();
        },
      });
    });
  });
}
