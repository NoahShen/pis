import { readdir } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Topic } from "../../src/configuration/contracts.js";
import {
  createTypedLlmCalls,
  type TypedLlmCalls,
} from "../../src/llm/llm-calls.js";
import { PromptRepository } from "../../src/prompt/prompt-repository.js";
import { createTopicMatching } from "../../src/topic-matching/index.js";
import type {
  TopicMatchingCalls,
  TopicMatchingDependencies,
  TopicMatchingTarget,
} from "../../src/topic-matching/contracts.js";
import {
  TOPIC_MATCHING_ERROR_MESSAGES,
  TopicMatchingError,
  type TopicMatchingErrorCode,
} from "../../src/topic-matching/topic-matching-errors.js";
import type {
  TopicMatchingLogEntry,
  TopicMatchingLogger,
} from "../../src/topic-matching/topic-matching-logger.js";
import type {
  TopicMatchingReferences,
  TopicMatchingResponse,
} from "../../src/llm/response-validators.js";
import { StubLLM, type StubLlmResult } from "../fixtures/stub-llm.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";
import {
  CountingFakeClock,
  TOPIC_MATCHING_BUSINESS_TABLES,
  createTopicMatchingDisabledTopic,
  createTopicMatchingEnabledTopics,
  createTopicMatchingSqliteHarness,
  insertStoredEvent,
  insertStoredEventUpdate,
  insertStoredKnowledge,
  insertStoredPublishedItem,
  insertStoredTopicAssociation,
  insertStoredTopics,
  insertTopicMatchingContent,
  listStoredTopicAssociations,
  probeTopicMatchingDatabase,
  snapshotTopicMatchingRows,
  topicMatchingEventRow,
  topicMatchingFixtureIds,
  topicMatchingKnowledgeRow,
  topicMatchingPromptSentinels,
  topicMatchingTopicIds,
  topicMatchingUpdateRow,
  withTopicMatchingDatabase,
  writeTopicMatchingPromptFixture,
  type StoredPublishedItemRow,
  type TopicMatchingDatabaseProbe,
  type TopicMatchingDatabaseProbeOptions,
  type TopicMatchingSqliteHarness,
} from "../fixtures/topic-matching.js";

type MatchTopics = TopicMatchingDependencies["typedLlmCalls"]["matchTopics"];
type TopicMatchingSnapshot = ReturnType<typeof snapshotTopicMatchingRows>;

const FIXED_NOW = new Date("2026-11-19T05:00:00.000Z");
const EXPECTED_MATCHED_AT = "2026-11-19T13:00:00.000+08:00";
const ALPHA = topicMatchingTopicIds.alpha;
const ZULU = topicMatchingTopicIds.zulu;
const DISABLED = topicMatchingTopicIds.disabled;

const PUBLISHED_ITEM: StoredPublishedItemRow = {
  id: "topic-matching-integration-published",
  target_type: "EVENT",
  target_id: topicMatchingEventRow.id,
  title: "Synthetic Published Title",
  summary: "Synthetic Published Summary",
  body: "Synthetic Published Body",
  published_at: "2026-11-19T12:00:00.000+08:00",
};

interface IntegrationHarness extends TopicMatchingSqliteHarness {
  readonly database: Database.Database;
  readonly rawDatabase: Database.Database;
  readonly service: ReturnType<typeof createTopicMatching>;
  readonly stub: StubLLM;
  readonly clock: CountingFakeClock;
  readonly loggerEntries: readonly TopicMatchingLogEntry[];
  readonly p05TransactionStates: readonly boolean[];
  readonly taskDataSnapshots: readonly unknown[];
  readonly referenceSnapshots: readonly TopicMatchingReferences[];
  readonly databaseProbe: TopicMatchingDatabaseProbe | undefined;
}

interface IntegrationOptions {
  readonly modelOutputs?: readonly StubLlmResult[];
  readonly includeUserContext?: boolean;
  readonly topicIds?: readonly string[];
  readonly probe?: TopicMatchingDatabaseProbeOptions;
  readonly beforeP05?: (context: {
    readonly taskData: unknown;
    readonly references: TopicMatchingReferences;
    readonly topicRepository: TopicMatchingSqliteHarness["topicRepository"];
  }) => void | Promise<void>;
  readonly afterClose?: (databasePath: string) => void | Promise<void>;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

function p05Output(topicIds: readonly string[]): string {
  return JSON.stringify({ matched_topic_ids: topicIds });
}

function seedAllTargets(database: Database.Database): void {
  insertTopicMatchingContent(database, topicMatchingFixtureIds.content);
  insertStoredEvent(database);
  insertStoredEventUpdate(database);
  insertStoredKnowledge(database);
}

function snapshotOnlyAssociationsChanged(
  before: TopicMatchingSnapshot,
  after: TopicMatchingSnapshot,
): void {
  for (const table of TOPIC_MATCHING_BUSINESS_TABLES) {
    if (table !== "topic_associations") {
      expect(after[table]).toEqual(before[table]);
    }
  }
}

function expectUnchanged(
  before: TopicMatchingSnapshot,
  after: TopicMatchingSnapshot,
): void {
  expect(after).toEqual(before);
}

async function captureMatchingError(
  operation: Promise<unknown>,
): Promise<TopicMatchingError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(TopicMatchingError);
    if (error instanceof TopicMatchingError) {
      return error;
    }
  }

  throw new Error("Expected topic matching to fail");
}

function expectSafeError(
  error: TopicMatchingError,
  code: TopicMatchingErrorCode,
  forbiddenValues: readonly string[],
): void {
  expect(error).toMatchObject({
    name: "TopicMatchingError",
    code,
    message: TOPIC_MATCHING_ERROR_MESSAGES[code],
  });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("prompt");
  expect(error).not.toHaveProperty("token");

  for (const forbidden of forbiddenValues) {
    expect(error.message).not.toContain(forbidden);
    expect(JSON.stringify(error)).not.toContain(forbidden);
  }
}

function parseTaskData(userContent: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(userContent);
  expect(typeof parsed).toBe("object");
  expect(parsed).not.toBeNull();
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

async function withIntegrationHarness<T>(
  options: IntegrationOptions,
  callback: (harness: IntegrationHarness) => T | Promise<T>,
): Promise<T> {
  return withTopicMatchingDatabase(
    (rawDatabase) =>
      withTempDirectory(async (promptDirectory) => {
        await writeTopicMatchingPromptFixture(promptDirectory, {
          includeUserContext: options.includeUserContext,
        });

        const probe = options.probe
          ? probeTopicMatchingDatabase(rawDatabase, options.probe)
          : undefined;
        const database = probe?.database ?? rawDatabase;
        const stub = new StubLLM(options.modelOutputs ?? []);
        const typedCalls = createTypedLlmCalls({
          prompts: new PromptRepository(promptDirectory),
          completionClient: stub,
        });
        const p05TransactionStates: boolean[] = [];
        const taskDataSnapshots: unknown[] = [];
        const referenceSnapshots: TopicMatchingReferences[] = [];
        let repositories: TopicMatchingSqliteHarness;

        const matchTopics: MatchTopics = async (
          taskData,
          references,
          callOptions,
        ) => {
          p05TransactionStates.push(rawDatabase.inTransaction);
          taskDataSnapshots.push(taskData);
          referenceSnapshots.push({
            enabledTopicIds: [...references.enabledTopicIds],
          });
          await options.beforeP05?.({
            taskData,
            references,
            topicRepository: repositories.topicRepository,
          });
          return typedCalls.matchTopics(taskData, references, callOptions);
        };

        const typedLlmCalls: TopicMatchingCalls = { matchTopics };
        const clock = new CountingFakeClock(FIXED_NOW);
        const loggerEntries: TopicMatchingLogEntry[] = [];
        const logger: TopicMatchingLogger = (entry) => {
          loggerEntries.push(entry);
        };

        repositories = createTopicMatchingSqliteHarness({
          database,
          typedLlmCalls,
          clock,
          logger,
          topicIds: options.topicIds,
        });
        const service = createTopicMatching(repositories.dependencies);

        return callback({
          ...repositories,
          database,
          rawDatabase,
          service,
          stub,
          clock,
          loggerEntries,
          p05TransactionStates,
          taskDataSnapshots,
          referenceSnapshots,
          databaseProbe: probe,
        });
      }),
    options.afterClose,
  );
}

function assertNoPrivateLogValues(
  loggerEntries: readonly TopicMatchingLogEntry[],
  target: TopicMatchingTarget,
  topics: readonly Topic[],
): void {
  const serialized = JSON.stringify(loggerEntries);
  const targetValues =
    target.target_type === "KNOWLEDGE"
      ? [
          target.title,
          target.summary,
          target.value,
          ...target.findings.flatMap(({ title, description }) => [
            title,
            description,
          ]),
        ]
      : [target.title, target.description];
  const forbidden = [
    ...targetValues,
    ...topics.flatMap(({ name, description }) => [name, description]),
    topicMatchingPromptSentinels.instructions,
    topicMatchingPromptSentinels.userContext,
    topicMatchingPromptSentinels.modelOutput,
    topicMatchingPromptSentinels.token,
  ];

  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}

describe("topic matching real SQLite outcome matrix", () => {
  it("TOP-01 / PMT-09 / PRIVACY writes one Event association, returns one true, and keeps P-05 user JSON minimal", async () => {
    await withIntegrationHarness(
      {
        modelOutputs: [p05Output([ALPHA])],
        includeUserContext: true,
        probe: {},
      },
      async (harness) => {
        const topics = createTopicMatchingEnabledTopics().slice(0, 1);
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, topics);
        const before = snapshotTopicMatchingRows(harness.rawDatabase);
        const adapter = {
          fetchEntries: vi.fn(),
          fetchContent: vi.fn(),
        };

        const result = await harness.service.match(
          "EVENT",
          topicMatchingEventRow.id,
        );

        expect(result).toStrictEqual({
          should_publish: true,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
        });
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(harness.stub.requests).toHaveLength(1);
        expect(harness.clock.calls).toBe(1);
        expect(harness.p05TransactionStates).toEqual([false]);
        expect(
          harness.databaseProbe?.associationInsertTransactionStates,
        ).toEqual([true]);
        expect(
          harness.databaseProbe?.associationReadbackTransactionStates,
        ).toEqual([true]);
        expect(harness.databaseProbe?.immediateTransactionCount).toBe(1);

        const request = harness.stub.requests[0];
        expect(request).toBeDefined();
        const user = parseTaskData(request?.userContent ?? "");
        expect(Object.keys(user)).toEqual(["task_data"]);
        expect(user).not.toHaveProperty("user_context");
        const taskData = user.task_data as Record<string, unknown>;
        expect(Object.keys(taskData).sort()).toEqual(["target", "topics"]);
        expect(taskData).not.toHaveProperty("user_context");
        expect(taskData).not.toHaveProperty("raw_data");
        expect(taskData).not.toHaveProperty("url");
        expect(request?.userContent).not.toContain(
          topicMatchingPromptSentinels.userContext,
        );
        expect(request?.userContent).not.toContain(
          topicMatchingPromptSentinels.token,
        );
        expect(request?.userContent).not.toContain(
          `Body for ${topicMatchingFixtureIds.content}`,
        );

        expect(adapter.fetchEntries).not.toHaveBeenCalled();
        expect(adapter.fetchContent).not.toHaveBeenCalled();
        const after = snapshotTopicMatchingRows(harness.rawDatabase);
        snapshotOnlyAssociationsChanged(before, after);
        expect(after.published_items).toEqual(before.published_items);
        expect(harness.database.inTransaction).toBe(false);
        assertNoPrivateLogValues(
          harness.loggerEntries,
          {
            target_type: "EVENT",
            id: topicMatchingEventRow.id,
            title: topicMatchingEventRow.title,
            entity_name: topicMatchingEventRow.entity_name,
            subject: topicMatchingEventRow.subject,
            scope: topicMatchingEventRow.scope,
            description: topicMatchingEventRow.description,
            occurred_at: topicMatchingEventRow.occurred_at,
          },
          topics,
        );
      },
    );
  });

  it("TOP-02 writes two UPDATE associations in D03 BINARY order with one matched_at and one true", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([ZULU, ALPHA])] },
      async (harness) => {
        const topics = createTopicMatchingEnabledTopics();
        insertStoredEvent(harness.rawDatabase);
        insertStoredEventUpdate(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, [topics[1], topics[0]]);
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        const result = await harness.service.match(
          "EVENT_UPDATE",
          topicMatchingUpdateRow.id,
        );

        expect(result).toStrictEqual({
          should_publish: true,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
        });
        expect(harness.referenceSnapshots).toEqual([
          { enabledTopicIds: [ALPHA, ZULU] },
        ]);
        const taskData = harness.taskDataSnapshots[0] as {
          readonly topics: readonly { readonly id: string }[];
        };
        expect(taskData.topics.map(({ id }) => id)).toEqual([ALPHA, ZULU]);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT_UPDATE",
            target_id: topicMatchingUpdateRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
          {
            topic_id: ZULU,
            target_type: "EVENT_UPDATE",
            target_id: topicMatchingUpdateRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(harness.clock.calls).toBe(1);
        expect(harness.stub.requests).toHaveLength(1);
        snapshotOnlyAssociationsChanged(
          before,
          snapshotTopicMatchingRows(harness.rawDatabase),
        );
      },
    );
  });

  it("TOP-03 keeps the target and writes nothing for an empty P-05 result", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([])] },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(
          harness.rawDatabase,
          createTopicMatchingEnabledTopics(),
        );
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toStrictEqual({
          should_publish: false,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
        });

        expect(harness.stub.requests).toHaveLength(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([]);
        expect(harness.clock.calls).toBe(0);
        expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
      },
    );
  });

  it("TOP-04 skips P-05 when only disabled Topics exist", async () => {
    await withIntegrationHarness({ modelOutputs: [] }, async (harness) => {
      insertStoredEvent(harness.rawDatabase);
      insertStoredTopics(harness.rawDatabase, [
        createTopicMatchingDisabledTopic(),
      ]);
      const before = snapshotTopicMatchingRows(harness.rawDatabase);

      await expect(
        harness.service.match("EVENT", topicMatchingEventRow.id),
      ).resolves.toStrictEqual({
        should_publish: false,
        target_type: "EVENT",
        target_id: topicMatchingEventRow.id,
      });

      expect(harness.stub.requests).toHaveLength(0);
      expect(harness.clock.calls).toBe(0);
      expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
      expect(harness.loggerEntries).toContainEqual({
        targetType: "EVENT",
        targetId: topicMatchingEventRow.id,
        enabledTopicCount: 0,
        stage: "check",
      });
    });
  });

  it("TOP-05 rejects a disabled Topic reference through real D02 with zero writes", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([DISABLED])] },
      async (harness) => {
        const topics = [
          createTopicMatchingEnabledTopics()[0],
          createTopicMatchingDisabledTopic(),
        ];
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, topics);
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        const error = await captureMatchingError(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        );

        expectSafeError(error, "llm_failed", [
          topics[0]?.name ?? "",
          topics[0]?.description ?? "",
          topicMatchingPromptSentinels.instructions,
          topicMatchingPromptSentinels.token,
        ]);
        expect(harness.stub.requests).toHaveLength(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([]);
        expect(harness.clock.calls).toBe(0);
        expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
      },
    );
  });

  it("TOP-07 reuses an existing Published Item with zero LLM and zero writes", async () => {
    await withIntegrationHarness({ modelOutputs: [] }, async (harness) => {
      insertStoredEvent(harness.rawDatabase);
      insertStoredTopics(
        harness.rawDatabase,
        createTopicMatchingEnabledTopics(),
      );
      insertStoredPublishedItem(harness.rawDatabase, PUBLISHED_ITEM);
      const before = snapshotTopicMatchingRows(harness.rawDatabase);

      await expect(
        harness.service.match("EVENT", topicMatchingEventRow.id),
      ).resolves.toStrictEqual({
        should_publish: false,
        target_type: "EVENT",
        target_id: topicMatchingEventRow.id,
      });

      expect(harness.stub.requests).toHaveLength(0);
      expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([]);
      expect(harness.clock.calls).toBe(0);
      expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
    });
  });
});

describe("topic matching Update independence and snapshot semantics", () => {
  it("TOP-08 does not inherit a parent Event association for an empty Update match", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([])] },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredEventUpdate(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, [
          createTopicMatchingEnabledTopics()[0],
        ]);
        insertStoredTopicAssociation(harness.rawDatabase, {
          topic_id: ALPHA,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: "2026-11-19T12:00:00.000+08:00",
        });
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        await expect(
          harness.service.match("EVENT_UPDATE", topicMatchingUpdateRow.id),
        ).resolves.toStrictEqual({
          should_publish: false,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
        });

        expect(harness.stub.requests).toHaveLength(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: "2026-11-19T12:00:00.000+08:00",
          },
        ]);
        expect(harness.clock.calls).toBe(0);
        expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
      },
    );
  });

  it("TOP-09 writes only the Update's own matched Topic, not the parent Event Topic", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([ZULU])] },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredEventUpdate(harness.rawDatabase);
        insertStoredTopics(
          harness.rawDatabase,
          createTopicMatchingEnabledTopics(),
        );
        insertStoredTopicAssociation(harness.rawDatabase, {
          topic_id: ALPHA,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: "2026-11-19T12:00:00.000+08:00",
        });

        await expect(
          harness.service.match("EVENT_UPDATE", topicMatchingUpdateRow.id),
        ).resolves.toStrictEqual({
          should_publish: true,
          target_type: "EVENT_UPDATE",
          target_id: topicMatchingUpdateRow.id,
        });

        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: "2026-11-19T12:00:00.000+08:00",
          },
          {
            topic_id: ZULU,
            target_type: "EVENT_UPDATE",
            target_id: topicMatchingUpdateRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(
          listStoredTopicAssociations(harness.rawDatabase).some(
            (association) =>
              association.target_type === "EVENT_UPDATE" &&
              association.topic_id === ALPHA,
          ),
        ).toBe(false);
        expect(harness.clock.calls).toBe(1);
      },
    );
  });

  it("TOP-10 completes from the original snapshot after a real D03 disable/rename during P-05", async () => {
    await withIntegrationHarness(
      {
        modelOutputs: [p05Output([ALPHA])],
        beforeP05: async ({ topicRepository }) => {
          await Promise.resolve();
          topicRepository.update(ALPHA, {
            enabled: false,
            name: "Renamed During P-05",
            description: "Renamed description during P-05",
          });
        },
      },
      async (harness) => {
        const originalTopics = createTopicMatchingEnabledTopics().slice(0, 1);
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, originalTopics);
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toStrictEqual({
          should_publish: true,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
        });

        const taskData = harness.taskDataSnapshots[0] as {
          readonly topics: readonly {
            readonly id: string;
            readonly name: string;
            readonly description: string;
          }[];
        };
        expect(taskData.topics).toEqual([
          {
            id: ALPHA,
            name: originalTopics[0]?.name,
            description: originalTopics[0]?.description,
          },
        ]);
        expect(harness.referenceSnapshots).toEqual([
          { enabledTopicIds: [ALPHA] },
        ]);
        expect(harness.p05TransactionStates).toEqual([false]);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(harness.topicRepository.getById(ALPHA)).toMatchObject({
          enabled: false,
          name: "Renamed During P-05",
          description: "Renamed description during P-05",
        });
        expect(harness.clock.calls).toBe(1);

        const after = snapshotTopicMatchingRows(harness.rawDatabase);
        for (const table of TOPIC_MATCHING_BUSINESS_TABLES) {
          if (table !== "topics" && table !== "topic_associations") {
            expect(after[table]).toEqual(before[table]);
          }
        }
      },
    );
  });

  it("TOP-11 does not trigger automatic matching when a Topic is created or modified", async () => {
    await withIntegrationHarness(
      { modelOutputs: [], topicIds: ["topic-matching-auto-created"] },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, [
          createTopicMatchingEnabledTopics()[0],
        ]);
        insertStoredTopicAssociation(harness.rawDatabase, {
          topic_id: ALPHA,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
          matched_at: "2026-11-19T12:00:00.000+08:00",
        });
        insertStoredPublishedItem(harness.rawDatabase, PUBLISHED_ITEM);
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        harness.topicRepository.create({
          name: "Auto-created Topic",
          description: "Created without matching",
          enabled: true,
        });
        harness.topicRepository.update(ALPHA, {
          enabled: false,
          name: "Modified without matching",
        });

        expect(harness.stub.requests).toHaveLength(0);
        const after = snapshotTopicMatchingRows(harness.rawDatabase);
        expect(after.topic_associations).toEqual(before.topic_associations);
        expect(after.published_items).toEqual(before.published_items);
        expect(after.topics).not.toEqual(before.topics);
      },
    );
  });

  it("TOP-16 keeps historical associations after disable and reuses true with no second P-05", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([ALPHA])] },
      async (harness) => {
        const topics = createTopicMatchingEnabledTopics().slice(0, 1);
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, topics);

        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toMatchObject({ should_publish: true });
        const historicAssociations = listStoredTopicAssociations(
          harness.rawDatabase,
        );

        harness.topicRepository.update(ALPHA, { enabled: false });
        const afterDisable = snapshotTopicMatchingRows(harness.rawDatabase);
        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toStrictEqual({
          should_publish: true,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
        });

        expect(harness.stub.requests).toHaveLength(1);
        expect(harness.clock.calls).toBe(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual(
          historicAssociations,
        );
        const afterRepeat = snapshotTopicMatchingRows(harness.rawDatabase);
        expect(afterRepeat.topic_associations).toEqual(
          afterDisable.topic_associations,
        );
        expect(afterRepeat.published_items).toEqual(
          afterDisable.published_items,
        );
      },
    );
  });
});

describe("topic matching Knowledge, strict output, and mutation boundaries", () => {
  it("TOP-14 sends exact Knowledge context and writes one Knowledge association", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([ALPHA])] },
      async (harness) => {
        const topics = createTopicMatchingEnabledTopics().slice(0, 1);
        insertTopicMatchingContent(
          harness.rawDatabase,
          topicMatchingFixtureIds.content,
        );
        const knowledge = {
          ...topicMatchingKnowledgeRow,
          category: null,
        } as const;
        insertStoredKnowledge(harness.rawDatabase, knowledge);
        insertStoredTopics(harness.rawDatabase, topics);

        await expect(
          harness.service.match("KNOWLEDGE", topicMatchingKnowledgeRow.id),
        ).resolves.toStrictEqual({
          should_publish: true,
          target_type: "KNOWLEDGE",
          target_id: topicMatchingKnowledgeRow.id,
        });

        const request = harness.stub.requests[0];
        const user = parseTaskData(request?.userContent ?? "");
        const taskData = user.task_data as {
          readonly target: Record<string, unknown>;
          readonly topics: readonly Record<string, unknown>[];
        };
        expect(taskData.target).toEqual({
          target_type: "KNOWLEDGE",
          id: topicMatchingKnowledgeRow.id,
          title: topicMatchingKnowledgeRow.title,
          summary: topicMatchingKnowledgeRow.summary,
          category: null,
          findings: topicMatchingKnowledgeRow.findings,
          value: topicMatchingKnowledgeRow.value,
        });
        expect(taskData.target).not.toHaveProperty("content_id");
        expect(request?.userContent).not.toContain(
          topicMatchingFixtureIds.content,
        );
        expect(request?.userContent).not.toContain(
          `Body for ${topicMatchingFixtureIds.content}`,
        );
        expect(request?.userContent).not.toContain(
          topicMatchingPromptSentinels.token,
        );
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "KNOWLEDGE",
            target_id: topicMatchingKnowledgeRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
      },
    );
  });

  it("TOP-12 lets D02 remove a duplicate matched ID so only one association is written", async () => {
    await withIntegrationHarness(
      { modelOutputs: [p05Output([ALPHA, ALPHA])] },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(
          harness.rawDatabase,
          createTopicMatchingEnabledTopics(),
        );

        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toStrictEqual({
          should_publish: true,
          target_type: "EVENT",
          target_id: topicMatchingEventRow.id,
        });

        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(harness.clock.calls).toBe(1);
      },
    );
  });

  it.each(["EVENT", "EVENT_UPDATE", "KNOWLEDGE"] as const)(
    "TOP-15 returns target_not_found for a missing real SQLite %s target",
    async (targetType) => {
      await withIntegrationHarness({ modelOutputs: [] }, async (harness) => {
        seedAllTargets(harness.rawDatabase);
        insertStoredTopics(
          harness.rawDatabase,
          createTopicMatchingEnabledTopics(),
        );
        const before = snapshotTopicMatchingRows(harness.rawDatabase);

        const error = await captureMatchingError(
          harness.service.match(targetType, "missing-real-target"),
        );

        expectSafeError(error, "target_not_found", [
          topicMatchingPromptSentinels.instructions,
          topicMatchingPromptSentinels.token,
        ]);
        expect(harness.stub.requests).toHaveLength(0);
        expect(harness.clock.calls).toBe(0);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([]);
        expectUnchanged(before, snapshotTopicMatchingRows(harness.rawDatabase));
      });
    },
  );

  it.each([
    ["non-JSON", topicMatchingPromptSentinels.modelOutput],
    ["missing field", JSON.stringify({})],
    ["extra field", JSON.stringify({ matched_topic_ids: [], extra: true })],
    ["wrong type", JSON.stringify({ matched_topic_ids: ALPHA })],
    ["disabled reference", JSON.stringify({ matched_topic_ids: [DISABLED] })],
  ])(
    "PMT-07 rejects %s through real D02, preserves every table, and keeps privacy",
    async (_label, output) => {
      await withIntegrationHarness(
        { modelOutputs: [output] },
        async (harness) => {
          const topics = [
            createTopicMatchingEnabledTopics()[0],
            createTopicMatchingDisabledTopic(),
          ];
          insertStoredEvent(harness.rawDatabase);
          insertStoredTopics(harness.rawDatabase, topics);
          const before = snapshotTopicMatchingRows(harness.rawDatabase);

          const error = await captureMatchingError(
            harness.service.match("EVENT", topicMatchingEventRow.id),
          );

          expectSafeError(error, "llm_failed", [
            topicMatchingEventRow.title,
            topicMatchingEventRow.description,
            topics[0]?.name ?? "",
            topics[0]?.description ?? "",
            topicMatchingPromptSentinels.instructions,
            topicMatchingPromptSentinels.modelOutput,
            topicMatchingPromptSentinels.token,
          ]);
          expect(harness.stub.requests).toHaveLength(1);
          expect(harness.clock.calls).toBe(0);
          expectUnchanged(
            before,
            snapshotTopicMatchingRows(harness.rawDatabase),
          );
          assertNoPrivateLogValues(
            harness.loggerEntries,
            {
              target_type: "EVENT",
              id: topicMatchingEventRow.id,
              title: topicMatchingEventRow.title,
              entity_name: topicMatchingEventRow.entity_name,
              subject: topicMatchingEventRow.subject,
              scope: topicMatchingEventRow.scope,
              description: topicMatchingEventRow.description,
              occurred_at: topicMatchingEventRow.occurred_at,
            },
            topics,
          );
        },
      );
    },
  );

  it("ABORT_AFTER_COMMIT returns stable aborted after the association has committed", async () => {
    const controller = new AbortController();
    await withIntegrationHarness(
      {
        modelOutputs: [p05Output([ALPHA])],
        probe: {
          onInsert: () => controller.abort(),
        },
      },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, [
          createTopicMatchingEnabledTopics()[0],
        ]);

        const error = await captureMatchingError(
          harness.service.match("EVENT", topicMatchingEventRow.id, {
            signal: controller.signal,
          }),
        );

        expectSafeError(error, "aborted", [
          topicMatchingPromptSentinels.instructions,
          topicMatchingPromptSentinels.token,
        ]);
        expect(harness.stub.requests).toHaveLength(1);
        expect(harness.clock.calls).toBe(1);
        expect(harness.p05TransactionStates).toEqual([false]);
        expect(
          harness.databaseProbe?.associationInsertTransactionStates,
        ).toEqual([true]);
        expect(
          harness.databaseProbe?.associationReadbackTransactionStates,
        ).toEqual([true]);
        expect(harness.databaseProbe?.immediateTransactionCount).toBe(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([
          {
            topic_id: ALPHA,
            target_type: "EVENT",
            target_id: topicMatchingEventRow.id,
            matched_at: EXPECTED_MATCHED_AT,
          },
        ]);
        expect(harness.database.inTransaction).toBe(false);
        expect(harness.loggerEntries).toContainEqual({
          targetType: "EVENT",
          targetId: topicMatchingEventRow.id,
          enabledTopicCount: 1,
          matchedTopicCount: 1,
          stage: "persist",
          reason: "aborted",
        });
      },
    );
  });
});

describe("topic matching ATOMIC integration", () => {
  it("ATOMIC keeps P-05 outside the transaction and all writes/readbacks inside it", async () => {
    await withIntegrationHarness(
      {
        modelOutputs: [p05Output([ALPHA, ZULU])],
        probe: {},
      },
      async (harness) => {
        const topics = createTopicMatchingEnabledTopics();
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, topics);

        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toMatchObject({ should_publish: true });

        expect(harness.p05TransactionStates).toEqual([false]);
        expect(
          harness.databaseProbe?.associationInsertTransactionStates,
        ).toEqual([true, true]);
        expect(
          harness.databaseProbe?.associationReadbackTransactionStates,
        ).toEqual([true, true]);
        expect(harness.database.inTransaction).toBe(false);
        expect(harness.databaseProbe?.immediateTransactionCount).toBe(1);
        expect(listStoredTopicAssociations(harness.rawDatabase)).toHaveLength(
          2,
        );
      },
    );
  });

  it.each([
    ["second insert", { failInsertAt: 2 }, 2, 1],
    ["first readback", { failReadAt: 1 }, 1, 1],
  ] as const)(
    "ATOMIC rolls back every row after a %s failure",
    async (_label, probeOptions, expectedInserts, expectedReadbacks) => {
      await withIntegrationHarness(
        {
          modelOutputs: [p05Output([ALPHA, ZULU])],
          probe: probeOptions,
        },
        async (harness) => {
          const topics = createTopicMatchingEnabledTopics();
          insertStoredEvent(harness.rawDatabase);
          insertStoredTopics(harness.rawDatabase, topics);
          const before = snapshotTopicMatchingRows(harness.rawDatabase);
          const error = await captureMatchingError(
            harness.service.match("EVENT", topicMatchingEventRow.id),
          );

          expectSafeError(error, "topic_matching_failed", [
            topicMatchingPromptSentinels.instructions,
            topicMatchingPromptSentinels.token,
          ]);
          expect(harness.stub.requests).toHaveLength(1);
          expect(harness.clock.calls).toBe(1);
          expect(harness.p05TransactionStates).toEqual([false]);
          expect(
            harness.databaseProbe?.associationInsertTransactionStates,
          ).toHaveLength(expectedInserts);
          expect(
            harness.databaseProbe?.associationInsertTransactionStates,
          ).toEqual(Array.from({ length: expectedInserts }, () => true));
          expect(
            harness.databaseProbe?.associationReadbackTransactionStates,
          ).toHaveLength(expectedReadbacks);
          expect(
            harness.databaseProbe?.associationReadbackTransactionStates,
          ).toEqual(Array.from({ length: expectedReadbacks }, () => true));
          expect(listStoredTopicAssociations(harness.rawDatabase)).toEqual([]);
          expectUnchanged(
            before,
            snapshotTopicMatchingRows(harness.rawDatabase),
          );
          expect(harness.database.inTransaction).toBe(false);
          expect(harness.databaseProbe?.immediateTransactionCount).toBe(1);
        },
      );
    },
  );

  it("RESOURCE_CLEANUP closes SQLite without leaving WAL or SHM files", async () => {
    let closedDirectoryFiles: readonly string[] = [];
    await withIntegrationHarness(
      {
        modelOutputs: [p05Output([ALPHA])],
        afterClose: async (databasePath) => {
          closedDirectoryFiles = await readdir(path.dirname(databasePath));
        },
      },
      async (harness) => {
        insertStoredEvent(harness.rawDatabase);
        insertStoredTopics(harness.rawDatabase, [
          createTopicMatchingEnabledTopics()[0],
        ]);
        await expect(
          harness.service.match("EVENT", topicMatchingEventRow.id),
        ).resolves.toMatchObject({ should_publish: true });
      },
    );

    expect(closedDirectoryFiles).toContain("database.sqlite");
    expect(closedDirectoryFiles.some((file) => file.endsWith("-wal"))).toBe(
      false,
    );
    expect(closedDirectoryFiles.some((file) => file.endsWith("-shm"))).toBe(
      false,
    );
  });
});
