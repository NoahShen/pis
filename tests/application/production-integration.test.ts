import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { createProductionAssembly } from "../../src/production/application.js";
import type { RuntimeTask } from "../../src/runtime/contracts.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { FakeClock } from "../fixtures/fake-clock.js";
import { HttpFixture } from "../fixtures/http-fixture.js";
import {
  configureProductionIntegrationRss,
  createProductionIntegrationSourceAdapter,
  ProductionIntegrationLlmStub,
  writeProductionIntegrationPrompts,
} from "../fixtures/production-integration.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const DEFAULT_DATABASE_PATH = path.resolve("data/pis.sqlite");

const ORIGINAL_TASK_IDS = [
  "D00-T01",
  "D00-T02",
  "D00-T03",
  "D00-T04",
  "D01-T01",
  "D01-T02",
  "D01-T03",
  "D01-T04",
  "D02-T01",
  "D02-T02",
  "D02-T03",
  "D02-T04",
  "D03-T01",
  "D03-T02",
  "D03-T03",
  "D04-T01",
  "D04-T02",
  "D04-T03",
  "D05-T01",
  "D05-T02",
  "D05-T03",
  "D05-T04",
  "D06-T01",
  "D06-T02",
  "D06-T03",
  "D06-T04",
  "D07-T01",
  "D07-T02",
  "D07-T03",
  "D07-T04",
  "D08-T01",
  "D08-T02",
  "D08-T03",
  "D08-T04",
  "D09-T01",
  "D09-T02",
  "D09-T03",
  "D09-T04",
  "D09-T05",
  "D10-T01",
  "D10-T02",
  "D10-T03",
  "D10-T04",
  "D11-T01",
  "D11-T02",
  "D11-T03",
  "D11-T04",
  "D12-T01",
  "D12-T02",
  "D12-T03",
  "D12-T04",
  "D13-T01",
  "D13-T02",
  "D13-T03",
  "D13-T04",
  "D14-T01",
  "D14-T02",
  "D14-T03",
  "D14-T04",
  "D15-T01",
  "D15-T02",
  "D15-T03",
  "D15-T04",
  "D15-T05",
  "D16-T01",
  "D16-T02",
  "D16-T03",
  "D16-T04",
  "D16-T05",
] as const;

interface ConfigurationResponse {
  readonly id: string;
}

interface SourceItemRow {
  readonly id: string;
}

interface ContentRow {
  readonly id: string;
}

interface KnowledgeRow {
  readonly id: string;
}

interface PublishedItemRow {
  readonly id: string;
  readonly target_type: "KNOWLEDGE";
  readonly target_id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly published_at: string;
}

function parseConfiguration(response: {
  readonly statusCode: number;
  json<T>(): T;
}): ConfigurationResponse {
  expect(response.statusCode).toBe(201);
  return response.json<ConfigurationResponse>();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPublishedItem(
  database: Database.Database,
): Promise<PublishedItemRow> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const row = database
      .prepare(
        `
          SELECT
            id, target_type, target_id, title, summary, body, published_at
          FROM published_items
          WHERE target_type = 'KNOWLEDGE'
          LIMIT 1
        `,
      )
      .get() as PublishedItemRow | undefined;
    if (row !== undefined) {
      return row;
    }
    await delay(10);
  }

  throw new Error("Timed out waiting for a persisted Published Item");
}

async function postJson(
  app: FastifyInstance,
  url: string,
  payload: object,
): Promise<ConfigurationResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: {
      authorization: `Bearer ${TEST_API_TOKEN}`,
      "content-type": "application/json",
    },
    payload: JSON.stringify(payload),
  });
  return parseConfiguration(response);
}

describe("production integration", () => {
  it("ASM-05_INTEGRATION runs KNOWLEDGE through the default Runtime and Scheduler into one Published Item", async () => {
    expect(existsSync(DEFAULT_DATABASE_PATH)).toBe(false);
    const fixture = new HttpFixture();
    const transportController = new AbortController();
    const logger = new CapturedLogger();
    const runtimeTaskTrace: RuntimeTask[] = [];
    let sourceId = "";
    let topicId = "";
    let databasePath = "";

    await fixture.start();
    const sourceUrl = configureProductionIntegrationRss(fixture);
    const stub = new ProductionIntegrationLlmStub(
      () => topicId,
      (operation) => {
        if (operation === "processing-route") {
          const sourceItem = database()
            .prepare(
              "SELECT id FROM source_items ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as SourceItemRow;
          runtimeTaskTrace.push({
            type: "PROCESS",
            source_item_id: sourceItem.id,
          });
        } else if (operation === "knowledge-analysis") {
          const content = database()
            .prepare(
              "SELECT id FROM contents ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as ContentRow;
          runtimeTaskTrace.push({
            type: "KNOWLEDGE_ANALYSIS",
            content_id: content.id,
          });
        } else {
          const knowledge = database()
            .prepare(
              "SELECT id FROM knowledge ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as KnowledgeRow;
          runtimeTaskTrace.push({
            type: "TOPIC_MATCHING",
            target_type: "KNOWLEDGE",
            target_id: knowledge.id,
          });
        }
      },
    );
    const sourceAdapter = createProductionIntegrationSourceAdapter({
      fixture,
      signal: transportController.signal,
      onCollect: () => {
        runtimeTaskTrace.push({ type: "COLLECT", source_id: sourceId });
      },
    });

    function database(): Database.Database {
      return assembly.database;
    }

    let assembly: ReturnType<typeof createProductionAssembly>;
    try {
      await withTempDirectory(async (directory) => {
        databasePath = path.join(directory, "production-integration.sqlite");
        const promptsDirectory = await writeProductionIntegrationPrompts(
          path.join(directory, "prompts"),
        );
        const config = appConfig({
          databasePath,
          promptsDirectory,
          rssSsrfProtection: true,
        });
        assembly = createProductionAssembly(config, logger, {
          clock: new FakeClock(new Date("2026-11-20T00:00:00.000Z")),
          idGenerator: new SequenceIdGenerator([
            "integration-source",
            "integration-topic",
            "integration-source-item",
            "integration-content",
            "integration-knowledge",
            "integration-published-item",
          ]),
          textCompletionClient: stub,
          sourceAdapter,
        });

        try {
          await assembly.app.ready();
          const source = await postJson(assembly.app, "/api/sources", {
            name: "Production integration source",
            type: "RSS",
            url: sourceUrl,
            cron: "0 0 * * *",
            description: "Synthetic local production integration source",
          });
          sourceId = source.id;
          const topic = await postJson(assembly.app, "/api/topics", {
            name: "Production integration topic",
            description: "Synthetic production integration topic",
          });
          topicId = topic.id;

          await assembly.app.listen({ host: "127.0.0.1", port: 0 });
          expect(assembly.app.server.listening).toBe(true);
          await assembly.scheduler.trigger(sourceId);
          const published = await waitForPublishedItem(assembly.database);
          runtimeTaskTrace.push({
            type: "PUBLISH",
            target_type: "KNOWLEDGE",
            target_id: published.target_id,
          });

          const sourceItem = assembly.database
            .prepare(
              "SELECT id FROM source_items ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as SourceItemRow;
          const content = assembly.database
            .prepare(
              "SELECT id FROM contents ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as ContentRow;
          const knowledge = assembly.database
            .prepare(
              "SELECT id FROM knowledge ORDER BY id COLLATE BINARY LIMIT 1",
            )
            .get() as KnowledgeRow;

          expect(runtimeTaskTrace).toStrictEqual([
            { type: "COLLECT", source_id: "integration-source" },
            { type: "PROCESS", source_item_id: "integration-source-item" },
            {
              type: "KNOWLEDGE_ANALYSIS",
              content_id: "integration-content",
            },
            {
              type: "TOPIC_MATCHING",
              target_type: "KNOWLEDGE",
              target_id: "integration-knowledge",
            },
            {
              type: "PUBLISH",
              target_type: "KNOWLEDGE",
              target_id: "integration-knowledge",
            },
          ]);
          expect(stub.operations).toEqual([
            "processing-route",
            "knowledge-analysis",
            "topic-matching",
          ]);
          expect(sourceItem.id).toBe("integration-source-item");
          expect(content.id).toBe("integration-content");
          expect(knowledge.id).toBe("integration-knowledge");
          expect(fixture.requests).toEqual([
            "/production-integration-feed",
            "/production-integration-article",
          ]);
          expect(fixture.pinnedLookupResults).toHaveLength(2);

          expect(published).toMatchObject({
            id: "integration-published-item",
            target_type: "KNOWLEDGE",
            target_id: "integration-knowledge",
            title: "Production integration Knowledge",
            summary:
              "A deterministic Knowledge result from the production chain.",
          });
          expect(published.body).toContain("Integrated finding");
          expect(published.published_at).toMatch(/\+08:00$/);
          expect(
            assembly.database
              .prepare("SELECT COUNT(*) AS count FROM event_content_links")
              .get(),
          ).toEqual({ count: 0 });
          expect(
            assembly.database
              .prepare("SELECT COUNT(*) AS count FROM topic_associations")
              .get(),
          ).toEqual({ count: 1 });
          expect(
            assembly.database
              .prepare("SELECT COUNT(*) AS count FROM published_items")
              .get(),
          ).toEqual({ count: 1 });
          expect(
            assembly.database
              .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_published_items_feed'",
              )
              .get(),
          ).toEqual({ name: "idx_published_items_feed" });
        } finally {
          await assembly.app.close();
          expect(assembly.database.open).toBe(false);
        }
      });

      expect(existsSync(databasePath)).toBe(false);
      expect(existsSync(DEFAULT_DATABASE_PATH)).toBe(false);
      expect(logger.errorEntries).toEqual([]);
    } finally {
      transportController.abort();
      await fixture.close();
    }
  });

  it("ASM-07_DOCS keeps the three authority indexes synchronized and all 69 original task IDs stable", async () => {
    const projectDevelopment = await readFile(
      "docs/project-development.md",
      "utf8",
    );
    const implementationPlan = await readFile(
      "docs/PIS_V1_开发实施计划与任务拆分_v0.1.md",
      "utf8",
    );
    const technicalDesign = await readFile(
      "docs/PIS_技术实现设计_v1.0.md",
      "utf8",
    );
    const readme = await readFile("README.md", "utf8");

    for (const index of [
      projectDevelopment,
      implementationPlan,
      technicalDesign,
    ]) {
      expect(index).toContain("D11A");
    }

    const discoveredTaskIds = [
      ...implementationPlan.matchAll(/\bD(?:0[0-9]|1[0-6])-T[0-9]{2}\b/g),
    ].map((match) => match[0]);
    const uniqueTaskIds = [...new Set(discoveredTaskIds)].sort();
    expect(uniqueTaskIds).toHaveLength(69);
    expect(uniqueTaskIds).toEqual([...ORIGINAL_TASK_IDS].sort());

    expect(projectDevelopment).toMatch(/18 个里程碑/u);
    expect(projectDevelopment).toMatch(/69 个/u);
    expect(projectDevelopment).toMatch(/D11A.*D12.*前置/u);
    expect(implementationPlan).toMatch(/D11A.*D00～D11.*D15.*D12/u);
    expect(technicalDesign).toMatch(/\| `D11A`[^\n]*\| 4 \|/u);

    for (const environmentVariable of [
      "API_TOKEN",
      "HOST",
      "PORT",
      "LOG_LEVEL",
      "DATABASE_PATH",
      "PIS_LLM_ENDPOINT",
      "PIS_LLM_API_KEY",
      "PIS_LLM_MODEL",
      "PROMPTS_DIR",
      "RSS_SSRF_PROTECTION",
      "CRON_TIMEZONE",
    ]) {
      expect(readme).toContain(`\`${environmentVariable}\``);
    }
    expect(readme).toMatch(/RSS_SSRF_PROTECTION[\s\S]*默认[^\n]*true/u);
    expect(readme).toMatch(/RSS_SSRF_PROTECTION=false[\s\S]*警告/u);
    expect(readme).toMatch(/zstd[\s\S]*解压后大小上限/u);
    expect(readme).toMatch(/D11A[\s\S]*D12[\s\S]*未实现/u);
  });
});
