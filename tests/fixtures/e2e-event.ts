import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

import { createProductionAssembly } from "../../src/production/application.js";
import type {
  EventAnalysisResponse,
  EventSearchResponse,
} from "../../src/llm/response-validators.js";
import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import { appConfig, TEST_API_TOKEN } from "./app-config.js";
import { CapturedLogger } from "./captured-logger.js";
import {
  E2E_DEFAULT_DATABASE_PATH,
  RecordingPublisher,
} from "./e2e-pipeline.js";
import { FakeClock } from "./fake-clock.js";
import { HttpFixture } from "./http-fixture.js";
import { createProductionIntegrationSourceAdapter } from "./production-integration.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { withTempDirectory } from "./temp-directory.js";
import { articleHtml } from "./rss-content.js";
import { rssFeed } from "./rss-list.js";

export interface EventTurn {
  readonly search: EventSearchResponse;
  readonly analysis:
    | EventAnalysisResponse
    | ((candidateIds: readonly string[]) => EventAnalysisResponse);
  readonly matchTopics?: boolean;
}

export class EventE2eLlmStub implements TextCompletionClient {
  readonly operations: string[] = [];
  private readonly turns: EventTurn[];
  private matchTopics = true;

  constructor(
    turns: readonly EventTurn[],
    private readonly topicId: () => string,
  ) {
    this.turns = [...turns];
  }

  async complete(request: TextCompletionRequest): Promise<string> {
    const user = JSON.parse(request.userContent) as {
      task_data?: {
        target?: { target_type?: string };
        candidates?: unknown;
        url?: unknown;
      };
    };
    const target = user.task_data?.target;
    if (target !== undefined) {
      this.operations.push("topic-matching");
      return JSON.stringify({
        matched_topic_ids:
          this.matchTopics && this.topicId() !== "" ? [this.topicId()] : [],
      });
    }
    if (user.task_data?.candidates !== undefined) {
      this.operations.push("event-analysis");
      const turn = this.turns.shift();
      this.matchTopics = turn?.matchTopics ?? true;
      const candidates = (user.task_data?.candidates ?? []) as Array<{
        id: string;
      }>;
      const analysis =
        typeof turn?.analysis === "function"
          ? turn.analysis(candidates.map(({ id }) => id))
          : turn?.analysis;
      return JSON.stringify(analysis ?? { results: [] });
    }
    if (Object.prototype.hasOwnProperty.call(user.task_data, "url")) {
      this.operations.push("processing-route");
      return JSON.stringify({ routes: ["EVENT"] });
    }
    this.operations.push("event-search");
    return JSON.stringify(this.turns[0]?.search);
  }
}

export interface EventE2eHarness {
  readonly assembly: ReturnType<typeof createProductionAssembly>;
  readonly http: HttpFixture;
  readonly llm: EventE2eLlmStub;
  readonly logger: CapturedLogger;
  readonly publisher: RecordingPublisher;
  readonly databasePath: string;
  readonly sourceIds: string[];
  readonly topicId: string;
  readonly drainNotifications: () => Promise<void>;
  collect(sourceIndex?: number): Promise<void>;
  createTopic(): Promise<string>;
  close(): Promise<void>;
}

export interface EventE2eOptions {
  readonly name: string;
  readonly turns: readonly EventTurn[];
  readonly createTopicInitially?: boolean;
}

export async function createEventE2eHarness(
  directory: string,
  options: EventE2eOptions,
): Promise<EventE2eHarness> {
  expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
  const http = new HttpFixture();
  const logger = new CapturedLogger();
  const publisher = new RecordingPublisher();
  const sourceIds: string[] = [];
  let topicId = "";
  const prefix = options.name;
  await http.start();
  const firstPublishes = options.createTopicInitially !== false;
  let generatedId = 0;
  const ids = new SequenceIdGenerator([
    `${prefix}-source-1`,
    `${prefix}-source-2`,
    `${prefix}-source-item-1`,
    `${prefix}-content-1`,
    `${prefix}-event`,
    ...(firstPublishes ? [`${prefix}-published-event`] : []),
    `${prefix}-source-item-2`,
    `${prefix}-content-2`,
    `${prefix}-update-1`,
    `${prefix}-published-update-1`,
  ]);
  const llm = new EventE2eLlmStub(options.turns, () => topicId);
  const transport = new AbortController();
  const sourceAdapter = createProductionIntegrationSourceAdapter({
    fixture: http,
    signal: transport.signal,
    onCollect: () => undefined,
  });
  const databasePath = path.join(directory, `${prefix}.sqlite`);
  const promptsDirectory = path.join(directory, "prompts");
  await mkdir(promptsDirectory, { recursive: true });
  await Promise.all(
    [
      "processing-route",
      "event-search",
      "event-analysis",
      "knowledge-analysis",
      "topic-matching",
    ].map((name) =>
      writeFile(
        path.join(promptsDirectory, `${name}.md`),
        `# Synthetic ${name}\n`,
      ),
    ),
  );
  await writeFile(
    path.join(promptsDirectory, "user-context.md"),
    "Synthetic test context.\n",
  );
  const assembly = createProductionAssembly(
    appConfig({
      databasePath,
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
          try {
            return ids.next();
          } catch {
            generatedId += 1;
            return `${prefix}-generated-${generatedId}`;
          }
        },
      },
      textCompletionClient: llm,
      sourceAdapter,
      rssPages: { publisher },
    },
  );
  let closed = false;

  const drainNotifications = async (): Promise<void> => {
    await publisher.waitForVersions(
      2 +
        (
          assembly.database
            .prepare("SELECT COUNT(*) AS count FROM published_items")
            .get() as { count: number }
        ).count,
    );
  };
  const collect = async (index = 0): Promise<void> => {
    await assembly.scheduler.trigger(sourceIds[index] ?? "");
    await assembly.runtime.drain();
    await drainNotifications();
  };

  await assembly.app.ready();
  for (let index = 0; index < 2; index += 1) {
    const feedPath = `/${prefix}-feed-${index}`;
    const articlePath = `/${prefix}-article-${index}`;
    http
      .route(feedPath, ({ response }) => {
        response.setHeader(
          "content-type",
          "application/rss+xml; charset=utf-8",
        );
        response.end(
          rssFeed(
            `<item><guid>${prefix}-entry-${index}</guid><title>Event source ${index}</title><link>${http.origin}${articlePath}</link><description>Deterministic event source.</description></item>`,
          ),
        );
      })
      .route(articlePath, ({ response }) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(articleHtml());
      });
    sourceIds.push(
      await postConfiguration(assembly.app, "/api/sources", {
        name: `Event source ${index}`,
        type: "RSS",
        url: `${http.origin}${feedPath}`,
        cron: "0 0 * * *",
        description: "Local Event E2E source",
      }),
    );
  }
  await assembly.app.ready();
  await assembly.app.listen({ host: "127.0.0.1", port: 0 });
  if (options.createTopicInitially !== false) {
    topicId = await postConfiguration(assembly.app, "/api/topics", {
      name: "Event E2E topic",
      description: "Deterministic Event E2E topic",
    });
  }

  return {
    assembly,
    http,
    llm,
    logger,
    publisher,
    databasePath,
    sourceIds,
    drainNotifications,
    get topicId() {
      return topicId;
    },
    collect,
    async createTopic() {
      if (topicId !== "") return topicId;
      topicId = await postConfiguration(assembly.app, "/api/topics", {
        name: "Event E2E topic",
        description: "Deterministic Event E2E topic",
      });
      return topicId;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await assembly.app.close();
        expect(assembly.database.open).toBe(false);
        expect(existsSync(databasePath)).toBe(true);
        expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
      } finally {
        transport.abort();
        await http.close();
      }
    },
  };
}

async function postConfiguration(
  app: FastifyInstance,
  url: string,
  payload: object,
): Promise<string> {
  const response = await app.inject({
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
}

export async function withEventE2eHarness(
  options: EventE2eOptions,
  test: (harness: EventE2eHarness) => Promise<void>,
): Promise<void> {
  await withTempDirectory(async (directory) => {
    const harness = await createEventE2eHarness(directory, options);
    try {
      await test(harness);
    } finally {
      await harness.close();
    }
  });
}
