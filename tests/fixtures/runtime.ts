import type Database from "better-sqlite3";
import { expect } from "vitest";

import { initializeDatabase } from "../../src/database/schema.js";
import { openDatabase } from "../../src/database/open-database.js";
import { withTransaction } from "../../src/database/transaction.js";
import type { EventAnalysisTarget } from "../../src/event-analysis/contracts.js";
import type {
  CollectResult,
  EventAnalysisResult,
  KnowledgeResult,
  ProcessResult,
  PublishResult,
  RuntimeTask,
  RuntimeTaskType,
  StageServices,
  TargetType,
  TopicMatchingResult,
} from "../../src/runtime/contracts.js";
import { closeDatabase, withDatabasePath } from "./database.js";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export interface RuntimeErrorLike extends Error {
  readonly code: string;
}

export function createRuntimeError(
  code: string,
  name = "RuntimeFixtureError",
): RuntimeErrorLike {
  const error = new Error("private runtime failure detail");
  error.name = name;
  return Object.assign(error, { code });
}

export function createEmptyStageServices(): StageServices {
  return {
    async collect() {
      return createCollectResult();
    },
    async process() {
      return createProcessResult(null);
    },
    async analyzeEvent() {
      return createEventAnalysisResult();
    },
    async analyzeKnowledge() {
      return createKnowledgeResult();
    },
    async matchTopics() {
      return createTopicMatchingResult(false);
    },
    async publish() {
      return createPublishResult();
    },
  };
}

export interface RuntimeSqliteProbe {
  readonly database: Database.Database;
  insertSource(
    id: string,
    options?: { readonly enabled?: boolean; readonly cron?: string },
  ): void;
  readSourceIds(): string[];
  readUserTableNames(): string[];
  readPublishedItemCount(): number;
}

export async function withRuntimeSqliteProbe<T>(
  callback: (probe: RuntimeSqliteProbe) => T | Promise<T>,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const database = openDatabase(databasePath);
    initializeDatabase(database);

    try {
      return await callback({
        database,
        insertSource(
          id: string,
          options: { readonly enabled?: boolean; readonly cron?: string } = {},
        ): void {
          withTransaction(database, () => {
            database
              .prepare(
                "INSERT INTO sources (id, name, type, url, cron, enabled) VALUES (?, ?, ?, ?, ?, ?)",
              )
              .run(
                id,
                `Source ${id}`,
                "rss",
                `https://example.test/${id}`,
                options.cron ?? "0 * * * *",
                (options.enabled ?? true) ? 1 : 0,
              );
          });
        },
        readSourceIds(): string[] {
          const rows = database
            .prepare("SELECT id FROM sources ORDER BY id")
            .all() as Array<{ readonly id: string }>;
          return rows.map((row) => row.id);
        },
        readUserTableNames(): string[] {
          const rows = database
            .prepare(
              `
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY name
              `,
            )
            .all() as Array<{ readonly name: string }>;
          return rows.map((row) => row.name);
        },
        readPublishedItemCount(): number {
          const row = database
            .prepare("SELECT COUNT(*) AS count FROM published_items")
            .get() as { readonly count: number };
          return row.count;
        },
      });
    } finally {
      closeDatabase(database);
    }
  });
}

export async function waitForCondition(
  predicate: () => boolean,
  maxTurns = 50,
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error("condition was not met within the allowed microtask turns");
}

export const expectedRuntimeTaskTypes = [
  "COLLECT",
  "PROCESS",
  "EVENT_ANALYSIS",
  "KNOWLEDGE_ANALYSIS",
  "TOPIC_MATCHING",
  "PUBLISH",
] as const;

export const runtimeTaskTypeCoverage = {
  COLLECT: true,
  PROCESS: true,
  EVENT_ANALYSIS: true,
  KNOWLEDGE_ANALYSIS: true,
  TOPIC_MATCHING: true,
  PUBLISH: true,
} as const satisfies Record<RuntimeTaskType, true>;

export function createCollectTask(sourceId = "source-1"): RuntimeTask {
  return { type: "COLLECT", source_id: sourceId };
}

export function createProcessTask(sourceItemId = "source-item-1"): RuntimeTask {
  return { type: "PROCESS", source_item_id: sourceItemId };
}

export function createEventAnalysisTask(contentId = "content-1"): RuntimeTask {
  return { type: "EVENT_ANALYSIS", content_id: contentId };
}

export function createKnowledgeAnalysisTask(
  contentId = "content-1",
): RuntimeTask {
  return { type: "KNOWLEDGE_ANALYSIS", content_id: contentId };
}

export function createTopicMatchingTask(
  targetType: TargetType = "EVENT",
  targetId = "target-1",
): RuntimeTask {
  return {
    type: "TOPIC_MATCHING",
    target_type: targetType,
    target_id: targetId,
  };
}

export function createPublishTask(
  targetType: TargetType = "EVENT",
  targetId = "target-1",
): RuntimeTask {
  return {
    type: "PUBLISH",
    target_type: targetType,
    target_id: targetId,
  };
}

export function createAllRuntimeTasks(): RuntimeTask[] {
  return [
    createCollectTask(),
    createProcessTask(),
    createEventAnalysisTask(),
    createKnowledgeAnalysisTask(),
    createTopicMatchingTask("EVENT_UPDATE", "target-update-1"),
    createPublishTask("KNOWLEDGE", "target-knowledge-1"),
  ];
}

export function createCollectResult(
  sourceItemIds: readonly string[] = [],
): CollectResult {
  return { new_source_item_ids: Array.from(sourceItemIds) };
}

export function createProcessResult(
  contentId: string | null = "content-1",
  routes: readonly ProcessResult["routes"][number][] = [],
): ProcessResult {
  return { content_id: contentId, routes: Array.from(routes) };
}

export function createEventAnalysisResult(
  targets: readonly EventAnalysisTarget[] = [],
): EventAnalysisResult {
  const copiedTargets: EventAnalysisTarget[] = [];

  for (const target of targets) {
    copiedTargets.push({
      target_type: target.target_type,
      target_id: target.target_id,
    });
  }

  return { new_targets: copiedTargets };
}

export function createKnowledgeResult(
  knowledgeId: string | null = null,
): KnowledgeResult {
  return { knowledge_id: knowledgeId };
}

export function createTopicMatchingResult(
  shouldPublish: boolean,
  targetType: TargetType = "EVENT",
  targetId = "target-1",
): TopicMatchingResult {
  return {
    should_publish: shouldPublish,
    target_type: targetType,
    target_id: targetId,
  };
}

export function createPublishResult(
  publishedItemId = "published-item-1",
): PublishResult {
  return { published_item_id: publishedItemId };
}

export function expectFlatIdOnlyTask(task: RuntimeTask): void {
  const keys = Object.keys(task).sort();
  let expectedKeys: string[];

  switch (task.type) {
    case "COLLECT":
      expectedKeys = ["source_id", "type"];
      break;
    case "PROCESS":
      expectedKeys = ["source_item_id", "type"];
      break;
    case "EVENT_ANALYSIS":
    case "KNOWLEDGE_ANALYSIS":
      expectedKeys = ["content_id", "type"];
      break;
    case "TOPIC_MATCHING":
    case "PUBLISH":
      expectedKeys = ["target_id", "target_type", "type"];
      break;
  }

  expect(keys).toEqual(expectedKeys.sort());
  expect(Object.values(task).every((value) => typeof value === "string")).toBe(
    true,
  );
}
