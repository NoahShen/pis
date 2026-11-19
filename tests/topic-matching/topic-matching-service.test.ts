import { readFile } from "node:fs/promises";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Topic } from "../../src/configuration/contracts.js";
import type { TopicMatchingResponse } from "../../src/llm/response-validators.js";
import * as publicTopicMatching from "../../src/topic-matching/index.js";
import {
  createTopicMatching,
  TopicMatchingError,
  type TopicMatchingDependencies,
  type TopicMatchingLogEntry,
  type TopicMatchingLogger,
  type TopicMatchingTarget,
  type TopicTargetType,
} from "../../src/topic-matching/index.js";
import {
  TOPIC_MATCHING_ERROR_MESSAGES,
  type TopicMatchingErrorCode,
} from "../../src/topic-matching/topic-matching-errors.js";
import {
  logTopicMatching,
  type TopicMatchingLogStage,
} from "../../src/topic-matching/topic-matching-logger.js";
import { persistTopicAssociations } from "../../src/topic-matching/topic-matching-persistence.js";
import {
  createTopicMatchingEnabledTopics,
  createTopicMatchingEventTarget,
  topicMatchingPromptSentinels,
  topicMatchingTopicIds,
} from "../fixtures/topic-matching.js";

vi.mock("../../src/topic-matching/topic-matching-persistence.js", () => ({
  persistTopicAssociations: vi.fn(),
}));

type GetTarget = TopicMatchingDependencies["targetRepository"]["getTarget"];
type GetEnabledTopics =
  TopicMatchingDependencies["topicRepository"]["listEnabled"];
type PublishedExists =
  TopicMatchingDependencies["publishedItemRepository"]["existsForTarget"];
type AssociationExists =
  TopicMatchingDependencies["associationRepository"]["existsForTarget"];
type MatchTopics = TopicMatchingDependencies["typedLlmCalls"]["matchTopics"];
type ClockNow = TopicMatchingDependencies["clock"]["now"];

const persistMock = vi.mocked(persistTopicAssociations);
const TARGET = createTopicMatchingEventTarget();
const TOPICS = createTopicMatchingEnabledTopics();
const EMPTY_RESPONSE: TopicMatchingResponse = { matched_topic_ids: [] };
const MATCHED_RESPONSE: TopicMatchingResponse = {
  matched_topic_ids: [topicMatchingTopicIds.alpha],
};
const FIXED_NOW = new Date("2026-11-19T05:00:00.000Z");
const PRIVATE_SENTINEL = "SERVICE_PRIVATE_SENTINEL";

type HarnessFailurePoint =
  "target" | "published" | "association" | "topics" | "match";

interface Harness {
  readonly dependencies: TopicMatchingDependencies;
  readonly calls: string[];
  readonly getTarget: ReturnType<typeof vi.fn<GetTarget>>;
  readonly getEnabledTopics: ReturnType<typeof vi.fn<GetEnabledTopics>>;
  readonly publishedExists: ReturnType<typeof vi.fn<PublishedExists>>;
  readonly associationExists: ReturnType<typeof vi.fn<AssociationExists>>;
  readonly matchTopics: ReturnType<typeof vi.fn<MatchTopics>>;
  readonly clockNow: ReturnType<typeof vi.fn<ClockNow>>;
  readonly logger: ReturnType<typeof vi.fn<TopicMatchingLogger>>;
  readonly database: Database.Database;
}

const openDatabases: Database.Database[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database?.open === true) {
      database.close();
    }
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function createHarness(
  options: {
    readonly target?: TopicMatchingTarget | null;
    readonly published?: boolean;
    readonly associated?: boolean;
    readonly topics?: readonly Topic[];
    readonly response?: TopicMatchingResponse;
    readonly failAt?: HarnessFailurePoint;
    readonly failure?: unknown;
    readonly logger?: TopicMatchingLogger;
  } = {},
): Harness {
  const database = new Database(":memory:");
  openDatabases.push(database);
  const calls: string[] = [];
  const target = options.target === undefined ? TARGET : options.target;
  const topics = options.topics ?? TOPICS;
  const response = options.response ?? MATCHED_RESPONSE;

  const maybeFail = (point: HarnessFailurePoint): void => {
    if (options.failAt === point) {
      throw options.failure ?? new Error(PRIVATE_SENTINEL);
    }
  };

  const getTarget = vi.fn<GetTarget>(() => {
    calls.push("target");
    maybeFail("target");
    return target;
  });
  const publishedExists = vi.fn<PublishedExists>(() => {
    calls.push("published");
    maybeFail("published");
    return options.published ?? false;
  });
  const associationExists = vi.fn<AssociationExists>(() => {
    calls.push("association");
    maybeFail("association");
    return options.associated ?? false;
  });
  const getEnabledTopics = vi.fn<GetEnabledTopics>(() => {
    calls.push("topics");
    maybeFail("topics");
    return [...topics];
  });
  const matchTopics = vi.fn<MatchTopics>(async () => {
    calls.push("match");
    maybeFail("match");
    return response;
  });
  const clockNow = vi.fn<ClockNow>(() => FIXED_NOW);
  const logger = vi.fn<TopicMatchingLogger>(options.logger);

  persistMock.mockImplementation(() => {
    calls.push("persist");
    return { should_publish: true };
  });

  return {
    dependencies: {
      database,
      targetRepository: { getTarget },
      topicRepository: { listEnabled: getEnabledTopics },
      associationRepository: {
        existsForTarget: associationExists,
        get: vi.fn(),
        insertIfAbsent: vi.fn(),
      },
      publishedItemRepository: { existsForTarget: publishedExists },
      typedLlmCalls: { matchTopics },
      clock: { now: clockNow },
      logger,
    },
    calls,
    getTarget,
    getEnabledTopics,
    publishedExists,
    associationExists,
    matchTopics,
    clockNow,
    logger,
    database,
  };
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
  expect(JSON.stringify(error)).not.toContain(PRIVATE_SENTINEL);
}

function expectNoDataAccess(harness: Harness): void {
  expect(harness.getTarget).not.toHaveBeenCalled();
  expect(harness.publishedExists).not.toHaveBeenCalled();
  expect(harness.associationExists).not.toHaveBeenCalled();
  expect(harness.getEnabledTopics).not.toHaveBeenCalled();
  expect(harness.matchTopics).not.toHaveBeenCalled();
  expect(persistMock).not.toHaveBeenCalled();
  expect(harness.clockNow).not.toHaveBeenCalled();
}

describe("topic matching service entry and reuse boundaries", () => {
  it.each([
    ["unknown target type", "SOURCE", "target-valid"],
    ["empty target id", "EVENT", ""],
    ["blank target id", "EVENT", "   "],
    ["non-string target id", "EVENT", 42],
  ])(
    "INVALID_INPUT rejects %s before every dependency",
    async (_label, targetType, targetId) => {
      const harness = createHarness();
      const service = createTopicMatching(harness.dependencies);

      const error = await captureMatchingError(
        service.match(targetType as TopicTargetType, targetId as string),
      );

      expectSafeError(error, "invalid_input");
      expectNoDataAccess(harness);
      expect(harness.logger).toHaveBeenLastCalledWith({
        stage: "check",
        reason: "invalid_input",
      });
    },
  );

  it("PRE_ABORT rejects an aborted signal before target access", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();
    const service = createTopicMatching(harness.dependencies);

    const error = await captureMatchingError(
      service.match("EVENT", TARGET.id, { signal: controller.signal }),
    );

    expectSafeError(error, "aborted");
    expectNoDataAccess(harness);
    expect(harness.logger).toHaveBeenLastCalledWith({
      targetType: "EVENT",
      targetId: TARGET.id,
      stage: "check",
      reason: "aborted",
    });
  });

  it.each(["EVENT", "EVENT_UPDATE", "KNOWLEDGE"] as const)(
    "TOP-15 returns target_not_found for a missing %s target before LLM access",
    async (targetType) => {
      const harness = createHarness({ target: null });
      const service = createTopicMatching(harness.dependencies);

      const error = await captureMatchingError(
        service.match(targetType, "missing-target"),
      );

      expectSafeError(error, "target_not_found");
      expect(harness.getTarget).toHaveBeenCalledTimes(1);
      expect(harness.publishedExists).not.toHaveBeenCalled();
      expect(harness.associationExists).not.toHaveBeenCalled();
      expect(harness.getEnabledTopics).not.toHaveBeenCalled();
      expect(harness.matchTopics).not.toHaveBeenCalled();
      expect(persistMock).not.toHaveBeenCalled();
      expect(harness.clockNow).not.toHaveBeenCalled();
    },
  );

  it("TOP-07 reuses a Published Item with an exact false result and no LLM", async () => {
    const harness = createHarness({ published: true });
    const service = createTopicMatching(harness.dependencies);

    await expect(service.match("EVENT", TARGET.id)).resolves.toStrictEqual({
      should_publish: false,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    expect(harness.calls).toEqual(["target", "published"]);
    expect(harness.getEnabledTopics).not.toHaveBeenCalled();
    expect(harness.matchTopics).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
  });

  it("TOP-06_LOCAL reuses any existing Association with true and no LLM", async () => {
    const harness = createHarness({ associated: true });
    const service = createTopicMatching(harness.dependencies);

    await expect(service.match("EVENT", TARGET.id)).resolves.toStrictEqual({
      should_publish: true,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    expect(harness.calls).toEqual(["target", "published", "association"]);
    expect(harness.getEnabledTopics).not.toHaveBeenCalled();
    expect(harness.matchTopics).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
  });

  it("TOP-04 returns false for an empty enabled Topic snapshot without P-05", async () => {
    const harness = createHarness({ topics: [] });
    const service = createTopicMatching(harness.dependencies);

    await expect(service.match("EVENT", TARGET.id)).resolves.toStrictEqual({
      should_publish: false,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    expect(harness.matchTopics).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
    expect(harness.logger).toHaveBeenLastCalledWith({
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicCount: 0,
      stage: "check",
    });
  });
});

describe("topic matching P-05 and persistence orchestration", () => {
  it("TOP-01/02 follows the fixed dependency order and persists once", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    const service = createTopicMatching(harness.dependencies);

    await expect(
      service.match("EVENT", TARGET.id, { signal: controller.signal }),
    ).resolves.toStrictEqual({
      should_publish: true,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    expect(harness.calls).toEqual([
      "target",
      "published",
      "association",
      "topics",
      "match",
      "persist",
    ]);
    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(harness.matchTopics).toHaveBeenCalledWith(
      expect.objectContaining({
        target: TARGET,
        topics: TOPICS.map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
      }),
      {
        enabledTopicIds: [
          topicMatchingTopicIds.alpha,
          topicMatchingTopicIds.zulu,
        ],
      },
      { signal: controller.signal },
    );
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(harness.dependencies, {
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicIds: [
        topicMatchingTopicIds.alpha,
        topicMatchingTopicIds.zulu,
      ],
      matchedTopicIds: MATCHED_RESPONSE.matched_topic_ids,
    });
    expect(harness.clockNow).not.toHaveBeenCalled();
  });

  it("TOP-03 returns false after exactly one empty P-05 result and no persistence", async () => {
    const harness = createHarness({ response: EMPTY_RESPONSE });
    const service = createTopicMatching(harness.dependencies);

    await expect(service.match("EVENT", TARGET.id)).resolves.toStrictEqual({
      should_publish: false,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
    expect(harness.logger).toHaveBeenLastCalledWith({
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicCount: 2,
      matchedTopicCount: 0,
      stage: "match",
    });
  });

  it.each(["target", "published", "association", "topics"] as const)(
    "ERROR_MAP maps a %s repository failure to topic_matching_failed without cause",
    async (failAt) => {
      const harness = createHarness({
        failAt,
        failure: Object.assign(new Error(PRIVATE_SENTINEL), {
          cause: new Error(PRIVATE_SENTINEL),
        }),
      });
      const service = createTopicMatching(harness.dependencies);

      const error = await captureMatchingError(
        service.match("EVENT", TARGET.id),
      );

      expectSafeError(error, "topic_matching_failed");
      expect(harness.matchTopics).not.toHaveBeenCalled();
      expect(persistMock).not.toHaveBeenCalled();
      expect(harness.clockNow).not.toHaveBeenCalled();
    },
  );

  it("ERROR_MAP maps an ordinary P-05 failure to llm_failed and preserves no cause", async () => {
    const harness = createHarness({
      failAt: "match",
      failure: Object.assign(new Error(PRIVATE_SENTINEL), {
        cause: new Error(PRIVATE_SENTINEL),
      }),
    });
    const service = createTopicMatching(harness.dependencies);

    const error = await captureMatchingError(service.match("EVENT", TARGET.id));

    expectSafeError(error, "llm_failed");
    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
    expect(harness.logger).toHaveBeenLastCalledWith({
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicCount: 2,
      stage: "match",
      reason: "llm_failed",
    });
  });

  it("ERROR_MAP gives safe cancellation priority over P-05 failure", async () => {
    const harness = createHarness({
      failAt: "match",
      failure: Object.assign(new Error(PRIVATE_SENTINEL), {
        name: "AbortError",
        cause: new Error(PRIVATE_SENTINEL),
      }),
    });
    const service = createTopicMatching(harness.dependencies);

    const error = await captureMatchingError(service.match("EVENT", TARGET.id));

    expectSafeError(error, "aborted");
    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
  });

  it("ERROR_MAP maps persistence failures to topic_matching_failed", async () => {
    const harness = createHarness();
    persistMock.mockImplementationOnce(() => {
      throw new Error(PRIVATE_SENTINEL);
    });
    const service = createTopicMatching(harness.dependencies);

    const error = await captureMatchingError(service.match("EVENT", TARGET.id));

    expectSafeError(error, "topic_matching_failed");
    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledTimes(1);
  });

  it("ABORT_AFTER_LLM does not enter persistence when P-05 returns after cancellation", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    let resolveResponse!: (response: TopicMatchingResponse) => void;
    harness.matchTopics.mockImplementationOnce(
      () =>
        new Promise<TopicMatchingResponse>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const service = createTopicMatching(harness.dependencies);
    const operation = service.match("EVENT", TARGET.id, {
      signal: controller.signal,
    });

    controller.abort();
    resolveResponse(MATCHED_RESPONSE);
    const error = await captureMatchingError(operation);

    expectSafeError(error, "aborted");
    expect(harness.matchTopics).toHaveBeenCalledTimes(1);
    expect(persistMock).not.toHaveBeenCalled();
    expect(harness.clockNow).not.toHaveBeenCalled();
  });
});

describe("topic matching logging and public boundary", () => {
  it("LOGGER emits only the six-field whitelist and contains no private payload", async () => {
    const harness = createHarness();
    const service = createTopicMatching(harness.dependencies);

    await service.match("EVENT", TARGET.id);

    expect(harness.logger).toHaveBeenCalled();
    const allowedKeys = new Set([
      "targetType",
      "targetId",
      "enabledTopicCount",
      "matchedTopicCount",
      "stage",
      "reason",
    ]);
    const allowedStages = new Set<TopicMatchingLogStage>([
      "check",
      "match",
      "persist",
    ]);
    const allowedReasons = new Set(Object.keys(TOPIC_MATCHING_ERROR_MESSAGES));
    const loggerJson = JSON.stringify(harness.logger.mock.calls);

    for (const [entry] of harness.logger.mock.calls) {
      for (const key of Object.keys(entry)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
      expect(allowedStages.has(entry.stage)).toBe(true);
      if (entry.reason !== undefined) {
        expect(allowedReasons.has(entry.reason)).toBe(true);
      }
    }

    for (const forbidden of [
      TARGET.title,
      TARGET.description,
      TOPICS[0]?.name,
      TOPICS[0]?.description,
      topicMatchingPromptSentinels.instructions,
      topicMatchingPromptSentinels.userContext,
      topicMatchingPromptSentinels.modelOutput,
      topicMatchingPromptSentinels.token,
      PRIVATE_SENTINEL,
    ]) {
      expect(loggerJson).not.toContain(forbidden);
    }
  });

  it("LOGGER strips runtime extra fields before invoking the sink", () => {
    const logger = vi.fn<TopicMatchingLogger>();
    const unsafeEntry = {
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicCount: 2,
      matchedTopicCount: 1,
      stage: "persist",
      reason: "topic_matching_failed",
      topicName: TOPICS[0]?.name,
      prompt: PRIVATE_SENTINEL,
      token: PRIVATE_SENTINEL,
    } as unknown as TopicMatchingLogEntry;

    logTopicMatching(logger, unsafeEntry);

    expect(logger).toHaveBeenCalledWith({
      targetType: "EVENT",
      targetId: TARGET.id,
      enabledTopicCount: 2,
      matchedTopicCount: 1,
      stage: "persist",
      reason: "topic_matching_failed",
    });
  });

  it("LOGGER sync throws and async rejections never alter success or stable errors", async () => {
    const throwingHarness = createHarness({
      logger: () => {
        throw new Error(PRIVATE_SENTINEL);
      },
    });
    await expect(
      createTopicMatching(throwingHarness.dependencies).match(
        "EVENT",
        TARGET.id,
      ),
    ).resolves.toStrictEqual({
      should_publish: true,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    const rejectingHarness = createHarness({
      logger: async () => {
        throw new Error(PRIVATE_SENTINEL);
      },
    });
    await expect(
      createTopicMatching(rejectingHarness.dependencies).match(
        "EVENT",
        TARGET.id,
      ),
    ).resolves.toStrictEqual({
      should_publish: true,
      target_type: "EVENT",
      target_id: TARGET.id,
    });

    const failingHarness = createHarness({
      response: EMPTY_RESPONSE,
      logger: () => {
        throw new Error(PRIVATE_SENTINEL);
      },
    });
    await expect(
      createTopicMatching(failingHarness.dependencies).match(
        "EVENT",
        TARGET.id,
      ),
    ).resolves.toStrictEqual({
      should_publish: false,
      target_type: "EVENT",
      target_id: TARGET.id,
    });
  });

  it("PUBLIC_SHAPE exports only runtime factory and error while keeping DTOs type-only", async () => {
    expect(Object.keys(publicTopicMatching).sort()).toEqual([
      "TopicMatchingError",
      "createTopicMatching",
    ]);

    const source = await readFile(
      new URL("../../src/topic-matching/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/export\s+type\s+\{/);
    expect(source).not.toMatch(/topic-association-repository\.js/);
    expect(source).not.toMatch(/topic-matching-persistence\.js/);
  });

  it("DEPENDENCY_SHAPE exposes only the approved collaborators and matchTopics", async () => {
    const harness = createHarness();
    expect(Object.keys(harness.dependencies).sort()).toEqual([
      "associationRepository",
      "clock",
      "database",
      "logger",
      "publishedItemRepository",
      "targetRepository",
      "topicRepository",
      "typedLlmCalls",
    ]);

    const [contractsSource, serviceSource] = await Promise.all([
      readFile(
        new URL("../../src/topic-matching/contracts.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../src/topic-matching/topic-matching.ts", import.meta.url),
        "utf8",
      ),
    ]);
    expect(contractsSource).toMatch(/Pick<TypedLlmCalls, "matchTopics">/);
    for (const source of [contractsSource, serviceSource]) {
      expect(source).not.toMatch(
        /\b(?:IdGenerator|Runtime|PromptRepository|Adapter)\b/,
      );
      expect(source).not.toMatch(
        /\b(?:routeProcessing|searchEvents|analyzeEvents|analyzeKnowledge)\b/,
      );
    }
  });
});
