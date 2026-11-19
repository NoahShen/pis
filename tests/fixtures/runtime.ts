import { expect } from "vitest";

import type { EventAnalysisTarget } from "../../src/event-analysis/contracts.js";
import type {
  CollectResult,
  EventAnalysisResult,
  KnowledgeResult,
  ProcessResult,
  PublishResult,
  RuntimeTask,
  RuntimeTaskType,
  TargetType,
  TopicMatchingResult,
} from "../../src/runtime/contracts.js";

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
