import { existsSync } from "node:fs";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

import type { SourceAdapter } from "../../src/adapters/contracts.js";
import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import { createProductionAssembly } from "../../src/production/application.js";
import type {
  RssFeedFileSet,
  RssPublicationPublisher,
} from "../../src/rss/index.js";
import type { RuntimeTask } from "../../src/runtime/contracts.js";
import { appConfig, TEST_API_TOKEN } from "./app-config.js";
import { CapturedLogger } from "./captured-logger.js";
import { FakeClock } from "./fake-clock.js";
import { HttpFixture } from "./http-fixture.js";
import {
  configureProductionIntegrationRss,
  createProductionIntegrationSourceAdapter,
  writeProductionIntegrationPrompts,
  type ProductionLlmOperation,
} from "./production-integration.js";
import { SequenceIdGenerator } from "./sequence-id-generator.js";
import { withTempDirectory } from "./temp-directory.js";

export const E2E_DEFAULT_DATABASE_PATH = path.resolve("data/pis.sqlite");

export interface KnowledgeResponse {
  readonly valuable: boolean;
  readonly title?: string;
  readonly summary?: string;
  readonly category?: "Method";
  readonly findings?: readonly {
    readonly title: string;
    readonly description: string;
  }[];
  readonly value?: string;
}

export class E2eLlmStub implements TextCompletionClient {
  readonly operations: ProductionLlmOperation[] = [];
  routeAttempts = 0;

  constructor(
    private readonly knowledge: KnowledgeResponse,
    private readonly topicIds: () => readonly string[],
    private readonly routeFailure?: Error,
    private readonly onCall?: (operation: ProductionLlmOperation) => void,
  ) {}

  async complete(request: TextCompletionRequest): Promise<string> {
    const operation = classifyOperation(request.userContent);
    this.onCall?.(operation);
    this.operations.push(operation);

    if (operation === "processing-route") {
      this.routeAttempts += 1;
      if (this.routeAttempts === 1 && this.routeFailure !== undefined) {
        throw this.routeFailure;
      }
      return JSON.stringify({ routes: ["KNOWLEDGE"] });
    }
    if (operation === "knowledge-analysis") {
      return JSON.stringify(this.knowledge);
    }
    return JSON.stringify({ matched_topic_ids: this.topicIds() });
  }
}

function classifyOperation(userContent: string): ProductionLlmOperation {
  const user = JSON.parse(userContent) as {
    readonly user_context?: unknown;
    readonly task_data?: {
      readonly target?: { readonly target_type?: unknown };
    };
  };
  if (Object.prototype.hasOwnProperty.call(user, "user_context")) {
    return "knowledge-analysis";
  }
  if (user.task_data?.target?.target_type === "KNOWLEDGE") {
    return "topic-matching";
  }
  return "processing-route";
}

export interface PublishedVersion {
  readonly feed: RssFeedFileSet["feed"];
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export class RecordingPublisher implements RssPublicationPublisher {
  readonly versions: PublishedVersion[] = [];

  async publish(files: RssFeedFileSet) {
    const snapshot = Object.fromEntries(
      files.files.map(({ key, bytes }) => [key, new Uint8Array(bytes)]),
    );
    this.versions.push({ feed: files.feed, files: snapshot });
    return {
      feed: files.feed,
      version: `e2e-version-${this.versions.length}`,
      verified: true,
    };
  }
}

export interface E2eHarnessOptions {
  readonly name: string;
  readonly knowledge: KnowledgeResponse;
  readonly disabledTopic?: boolean;
  readonly noEnabledTopic?: boolean;
  readonly matchTopics?: boolean;
  readonly articleFailure?: boolean;
  readonly routeFailure?: Error;
}

export interface E2eHarness {
  readonly assembly: ReturnType<typeof createProductionAssembly>;
  readonly http: HttpFixture;
  readonly logger: CapturedLogger;
  readonly llm: E2eLlmStub;
  readonly publisher: RecordingPublisher;
  readonly runtimeTrace: RuntimeTask[];
  readonly databasePath: string;
  readonly sourceId: string;
  readonly topicId: string;
  run(): Promise<void>;
  close(): Promise<void>;
}

export async function createKnowledgeE2eHarness(
  directory: string,
  options: E2eHarnessOptions,
): Promise<E2eHarness> {
  expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
  const http = new HttpFixture();
  const transport = new AbortController();
  const logger = new CapturedLogger();
  const publisher = new RecordingPublisher();
  const runtimeTrace: RuntimeTask[] = [];
  const databasePath = path.join(directory, `${options.name}.sqlite`);
  const prefix = options.name;
  let sourceId = "";
  let topicId = "";

  await http.start();
  const sourceUrl = configureProductionIntegrationRss(http);
  if (options.articleFailure === true) {
    http.route("/production-integration-article", ({ response }) => {
      response.statusCode = 503;
      response.end("synthetic article failure");
    });
  }
  const llm = new E2eLlmStub(
    options.knowledge,
    () => (options.matchTopics === false ? [] : [topicId]),
    options.routeFailure,
    (operation) => {
      const db = assembly.database;
      if (operation === "processing-route") {
        const row = db
          .prepare("SELECT id FROM source_items ORDER BY id LIMIT 1")
          .get() as { id: string };
        runtimeTrace.push({ type: "PROCESS", source_item_id: row.id });
      } else if (operation === "knowledge-analysis") {
        const row = db
          .prepare("SELECT id FROM contents ORDER BY id LIMIT 1")
          .get() as { id: string };
        runtimeTrace.push({ type: "KNOWLEDGE_ANALYSIS", content_id: row.id });
      } else {
        const row = db
          .prepare("SELECT id FROM knowledge ORDER BY id LIMIT 1")
          .get() as { id: string };
        runtimeTrace.push({
          type: "TOPIC_MATCHING",
          target_type: "KNOWLEDGE",
          target_id: row.id,
        });
      }
    },
  );
  const sourceAdapter: SourceAdapter = createProductionIntegrationSourceAdapter(
    {
      fixture: http,
      signal: transport.signal,
      onCollect: () =>
        runtimeTrace.push({ type: "COLLECT", source_id: sourceId }),
    },
  );
  const promptsDirectory = await writeProductionIntegrationPrompts(
    path.join(directory, `${prefix}-prompts`),
  );
  const assembly = createProductionAssembly(
    appConfig({
      databasePath,
      promptsDirectory,
      rssSsrfProtection: true,
      rssPages: {
        repository: "git@example.test:e2e/unused.git",
        branch: "main",
        workDirectory: path.join(directory, `${prefix}-rss`),
        publicOrigin: "https://example.test",
        publicDirectory: "",
        publishTimeoutMs: 5_000,
        pollIntervalMs: 100,
      },
    }),
    {
      error(metadata) {
        logger.error(metadata);
      },
      ready(metadata) {
        logger.ready(metadata);
      },
      shutdown(metadata) {
        logger.shutdown(metadata);
      },
      request(metadata) {
        logger.request(metadata);
      },
      flush() {
        return logger.flush();
      },
    },
    {
      clock: new FakeClock(new Date("2026-11-20T00:00:00.000Z")),
      idGenerator: new SequenceIdGenerator([
        `${prefix}-source`,
        ...(options.noEnabledTopic === true ? [] : [`${prefix}-topic`]),
        `${prefix}-source-item`,
        `${prefix}-content`,
        `${prefix}-knowledge`,
        `${prefix}-published-item`,
      ]),
      textCompletionClient: llm,
      sourceAdapter,
      rssPages: { publisher },
    },
  );

  let closed = false;
  return {
    assembly,
    http,
    logger,
    llm,
    publisher,
    runtimeTrace,
    databasePath,
    get sourceId() {
      return sourceId;
    },
    get topicId() {
      return topicId;
    },
    async run() {
      await assembly.app.ready();
      const source = await postConfiguration(assembly.app, "/api/sources", {
        name: "E2E source",
        type: "RSS",
        url: sourceUrl,
        cron: "0 0 * * *",
        description: "Synthetic local E2E source",
      });
      sourceId = source.id;
      if (options.noEnabledTopic !== true) {
        const topic = await postConfiguration(assembly.app, "/api/topics", {
          name: "E2E topic",
          description: "Synthetic local E2E topic",
          ...(options.disabledTopic === true ? { enabled: false } : {}),
        });
        topicId = topic.id;
      }
      await assembly.app.listen({ host: "127.0.0.1", port: 0 });
      await assembly.scheduler.trigger(sourceId);
      await assembly.runtime.drain();
      const published = assembly.database
        .prepare(
          "SELECT target_id FROM published_items WHERE target_type = 'KNOWLEDGE'",
        )
        .get() as { target_id: string } | undefined;
      if (
        options.knowledge.valuable &&
        runtimeTrace.at(-1)?.type === "KNOWLEDGE_ANALYSIS"
      ) {
        const knowledge = assembly.database
          .prepare("SELECT id FROM knowledge")
          .get() as { id: string };
        runtimeTrace.push({
          type: "TOPIC_MATCHING",
          target_type: "KNOWLEDGE",
          target_id: knowledge.id,
        });
      }
      if (published !== undefined) {
        runtimeTrace.push({
          type: "PUBLISH",
          target_type: "KNOWLEDGE",
          target_id: published.target_id,
        });
      }
      if (
        options.knowledge.valuable &&
        options.matchTopics !== false &&
        !options.disabledTopic &&
        !options.noEnabledTopic
      ) {
        const deadline = Date.now() + 5_000;
        while (publisher.versions.length < 3 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(publisher.versions).toHaveLength(3);
      }
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
): Promise<{ readonly id: string }> {
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
  return response.json<{ id: string }>();
}

export async function withKnowledgeE2eHarness(
  options: E2eHarnessOptions,
  test: (harness: E2eHarness) => Promise<void>,
): Promise<void> {
  await withTempDirectory(async (directory) => {
    const harness = await createKnowledgeE2eHarness(directory, options);
    try {
      await test(harness);
    } finally {
      await harness.close();
    }
  });
  expect(existsSync(E2E_DEFAULT_DATABASE_PATH)).toBe(false);
}

export function countRows(
  database: ReturnType<typeof createProductionAssembly>["database"],
  table: string,
): number {
  const allowed = new Set([
    "source_items",
    "contents",
    "knowledge",
    "topic_associations",
    "published_items",
    "events",
    "event_updates",
    "event_content_links",
  ]);
  if (!allowed.has(table)) throw new Error("Unexpected E2E table");
  return (
    database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}
