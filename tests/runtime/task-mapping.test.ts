import { describe, expect, it } from "vitest";

import {
  mapResultToDownstreamTasks,
  runtimeTaskId,
} from "../../src/runtime/index.js";
import {
  createAllRuntimeTasks,
  createCollectResult,
  createCollectTask,
  createEventAnalysisResult,
  createEventAnalysisTask,
  createKnowledgeAnalysisTask,
  createKnowledgeResult,
  createProcessResult,
  createProcessTask,
  createPublishResult,
  createPublishTask,
  createTopicMatchingResult,
  createTopicMatchingTask,
  expectFlatIdOnlyTask,
  expectedRuntimeTaskTypes,
  runtimeTaskTypeCoverage,
} from "../fixtures/runtime.js";

describe("runtime task contracts and pure downstream mapping", () => {
  it("TASK_UNION declares exactly six flat task variants", () => {
    expect(Object.keys(runtimeTaskTypeCoverage)).toHaveLength(6);
    expect(Object.keys(runtimeTaskTypeCoverage).sort()).toEqual(
      Array.from(expectedRuntimeTaskTypes).sort(),
    );

    const tasks = createAllRuntimeTasks();
    expect(tasks.map((task) => task.type)).toEqual(
      Array.from(expectedRuntimeTaskTypes),
    );
    expect(new Set(tasks.map((task) => task.type)).size).toBe(6);

    for (const task of tasks) {
      expectFlatIdOnlyTask(task);
    }
  });

  it("RUN-01_MAP returns the exact successor for every task result", () => {
    expect(
      mapResultToDownstreamTasks(
        createCollectTask("source-1"),
        createCollectResult(["source-item-2", "source-item-1"]),
      ),
    ).toEqual([
      { type: "PROCESS", source_item_id: "source-item-2" },
      { type: "PROCESS", source_item_id: "source-item-1" },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createProcessTask("source-item-1"),
        createProcessResult("content-1", ["KNOWLEDGE", "EVENT"]),
      ),
    ).toEqual([
      { type: "EVENT_ANALYSIS", content_id: "content-1" },
      { type: "KNOWLEDGE_ANALYSIS", content_id: "content-1" },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createEventAnalysisTask("content-1"),
        createEventAnalysisResult([
          { target_type: "EVENT_UPDATE", target_id: "event-update-1" },
          { target_type: "EVENT", target_id: "event-1" },
        ]),
      ),
    ).toEqual([
      {
        type: "TOPIC_MATCHING",
        target_type: "EVENT_UPDATE",
        target_id: "event-update-1",
      },
      {
        type: "TOPIC_MATCHING",
        target_type: "EVENT",
        target_id: "event-1",
      },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createKnowledgeAnalysisTask("content-1"),
        createKnowledgeResult("knowledge-1"),
      ),
    ).toEqual([
      {
        type: "TOPIC_MATCHING",
        target_type: "KNOWLEDGE",
        target_id: "knowledge-1",
      },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createTopicMatchingTask("EVENT_UPDATE", "event-update-1"),
        createTopicMatchingResult(true, "KNOWLEDGE", "untrusted-result-target"),
      ),
    ).toEqual([
      {
        type: "PUBLISH",
        target_type: "EVENT_UPDATE",
        target_id: "event-update-1",
      },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createPublishTask("EVENT", "event-1"),
        createPublishResult(),
      ),
    ).toEqual([]);
  });

  it("RUN-02_MAP treats empty results as successful empty mappings", () => {
    expect(
      mapResultToDownstreamTasks(createCollectTask(), createCollectResult([])),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createProcessTask(),
        createProcessResult(null, ["EVENT", "KNOWLEDGE"]),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createProcessTask(),
        createProcessResult("content-1", []),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createEventAnalysisTask(),
        createEventAnalysisResult([]),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createKnowledgeAnalysisTask(),
        createKnowledgeResult(null),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createTopicMatchingTask(),
        createTopicMatchingResult(false),
      ),
    ).toEqual([]);
  });

  it("RUN-12_MAP keeps EVENT and KNOWLEDGE independent with fixed order and route deduplication", () => {
    expect(
      mapResultToDownstreamTasks(
        createProcessTask(),
        createProcessResult("content-dual", [
          "KNOWLEDGE",
          "EVENT",
          "KNOWLEDGE",
          "EVENT",
        ]),
      ),
    ).toEqual([
      { type: "EVENT_ANALYSIS", content_id: "content-dual" },
      { type: "KNOWLEDGE_ANALYSIS", content_id: "content-dual" },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createProcessTask(),
        createProcessResult("content-knowledge", ["KNOWLEDGE", "KNOWLEDGE"]),
      ),
    ).toEqual([
      { type: "KNOWLEDGE_ANALYSIS", content_id: "content-knowledge" },
    ]);
  });

  it("PUBLISH_TERMINAL never creates another task", () => {
    expect(
      mapResultToDownstreamTasks(
        createPublishTask("KNOWLEDGE", "knowledge-1"),
        createPublishResult("published-1"),
      ),
    ).toEqual([]);
  });

  it("BLANK_IDS filters empty and whitespace-only IDs without throwing", () => {
    expect(
      mapResultToDownstreamTasks(
        createCollectTask(),
        createCollectResult(["", " ", "source-item-1", "\t", "source-item-2"]),
      ),
    ).toEqual([
      { type: "PROCESS", source_item_id: "source-item-1" },
      { type: "PROCESS", source_item_id: "source-item-2" },
    ]);

    expect(
      mapResultToDownstreamTasks(
        createProcessTask(),
        createProcessResult("   ", ["EVENT", "KNOWLEDGE"]),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createEventAnalysisTask(),
        createEventAnalysisResult([
          { target_type: "EVENT", target_id: "" },
          { target_type: "EVENT_UPDATE", target_id: " " },
          { target_type: "EVENT", target_id: "event-1" },
        ]),
      ),
    ).toEqual([
      {
        type: "TOPIC_MATCHING",
        target_type: "EVENT",
        target_id: "event-1",
      },
    ]);
    expect(
      mapResultToDownstreamTasks(
        createKnowledgeAnalysisTask(),
        createKnowledgeResult("  "),
      ),
    ).toEqual([]);
    expect(
      mapResultToDownstreamTasks(
        createTopicMatchingTask("EVENT", " "),
        createTopicMatchingResult(true),
      ),
    ).toEqual([]);
  });

  it("PURE_DETERMINISTIC returns deep-equal independent mappings for identical inputs", () => {
    const task = createProcessTask("source-item-deterministic");
    const result = createProcessResult("content-deterministic", [
      "KNOWLEDGE",
      "EVENT",
    ]);
    const first = mapResultToDownstreamTasks(task, result);
    const second = mapResultToDownstreamTasks(task, result);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("ID_ONLY serializes only task type and business IDs and derives stable task IDs", () => {
    const expectedIds = [
      "source-1",
      "source-item-1",
      "content-1",
      "content-1",
      "target-update-1",
      "target-knowledge-1",
    ];

    createAllRuntimeTasks().forEach((task, index) => {
      expectFlatIdOnlyTask(task);
      expect(JSON.parse(JSON.stringify(task))).toEqual(task);
      expect(runtimeTaskId(task)).toBe(expectedIds[index]);
    });
  });
});
