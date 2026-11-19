import type {
  CollectResult,
  EventAnalysisResult,
  KnowledgeResult,
  ProcessResult,
  PublishResult,
  RuntimeTask,
  TopicMatchingResult,
} from "./contracts.js";

type CollectTask = Extract<RuntimeTask, { readonly type: "COLLECT" }>;
type ProcessTask = Extract<RuntimeTask, { readonly type: "PROCESS" }>;
type EventAnalysisTask = Extract<
  RuntimeTask,
  { readonly type: "EVENT_ANALYSIS" }
>;
type KnowledgeAnalysisTask = Extract<
  RuntimeTask,
  { readonly type: "KNOWLEDGE_ANALYSIS" }
>;
type TopicMatchingTask = Extract<
  RuntimeTask,
  { readonly type: "TOPIC_MATCHING" }
>;
type PublishTask = Extract<RuntimeTask, { readonly type: "PUBLISH" }>;
type RuntimeResult =
  | CollectResult
  | ProcessResult
  | EventAnalysisResult
  | KnowledgeResult
  | TopicMatchingResult
  | PublishResult;

function isNonBlankId(id: string): boolean {
  return id.trim().length > 0;
}

function mapCollectResult(result: CollectResult): ProcessTask[] {
  const tasks: ProcessTask[] = [];

  for (const sourceItemId of result.new_source_item_ids) {
    if (isNonBlankId(sourceItemId)) {
      tasks.push({ type: "PROCESS", source_item_id: sourceItemId });
    }
  }

  return tasks;
}

function mapProcessResult(result: ProcessResult): RuntimeTask[] {
  if (result.content_id === null || !isNonBlankId(result.content_id)) {
    return [];
  }

  const tasks: RuntimeTask[] = [];

  if (result.routes.includes("EVENT")) {
    tasks.push({ type: "EVENT_ANALYSIS", content_id: result.content_id });
  }

  if (result.routes.includes("KNOWLEDGE")) {
    tasks.push({ type: "KNOWLEDGE_ANALYSIS", content_id: result.content_id });
  }

  return tasks;
}

function mapEventAnalysisResult(
  result: EventAnalysisResult,
): TopicMatchingTask[] {
  const tasks: TopicMatchingTask[] = [];

  for (const target of result.new_targets) {
    if (isNonBlankId(target.target_id)) {
      tasks.push({
        type: "TOPIC_MATCHING",
        target_type: target.target_type,
        target_id: target.target_id,
      });
    }
  }

  return tasks;
}

function mapKnowledgeResult(result: KnowledgeResult): TopicMatchingTask[] {
  if (result.knowledge_id === null || !isNonBlankId(result.knowledge_id)) {
    return [];
  }

  return [
    {
      type: "TOPIC_MATCHING",
      target_type: "KNOWLEDGE",
      target_id: result.knowledge_id,
    },
  ];
}

function mapTopicMatchingResult(
  task: TopicMatchingTask,
  result: TopicMatchingResult,
): PublishTask[] {
  if (!result.should_publish || !isNonBlankId(task.target_id)) {
    return [];
  }

  return [
    {
      type: "PUBLISH",
      target_type: task.target_type,
      target_id: task.target_id,
    },
  ];
}

export function mapResultToDownstreamTasks(
  task: CollectTask,
  result: CollectResult,
): ProcessTask[];
export function mapResultToDownstreamTasks(
  task: ProcessTask,
  result: ProcessResult,
): RuntimeTask[];
export function mapResultToDownstreamTasks(
  task: EventAnalysisTask,
  result: EventAnalysisResult,
): TopicMatchingTask[];
export function mapResultToDownstreamTasks(
  task: KnowledgeAnalysisTask,
  result: KnowledgeResult,
): TopicMatchingTask[];
export function mapResultToDownstreamTasks(
  task: TopicMatchingTask,
  result: TopicMatchingResult,
): PublishTask[];
export function mapResultToDownstreamTasks(
  task: PublishTask,
  result: PublishResult,
): RuntimeTask[];
export function mapResultToDownstreamTasks(
  task: RuntimeTask,
  result: RuntimeResult,
): RuntimeTask[];
export function mapResultToDownstreamTasks(
  task: RuntimeTask,
  result: RuntimeResult,
): RuntimeTask[] {
  switch (task.type) {
    case "COLLECT":
      return mapCollectResult(result as CollectResult);
    case "PROCESS":
      return mapProcessResult(result as ProcessResult);
    case "EVENT_ANALYSIS":
      return mapEventAnalysisResult(result as EventAnalysisResult);
    case "KNOWLEDGE_ANALYSIS":
      return mapKnowledgeResult(result as KnowledgeResult);
    case "TOPIC_MATCHING":
      return mapTopicMatchingResult(task, result as TopicMatchingResult);
    case "PUBLISH":
      return [];
  }
}

export function runtimeTaskId(task: RuntimeTask): string {
  switch (task.type) {
    case "COLLECT":
      return task.source_id;
    case "PROCESS":
      return task.source_item_id;
    case "EVENT_ANALYSIS":
    case "KNOWLEDGE_ANALYSIS":
      return task.content_id;
    case "TOPIC_MATCHING":
    case "PUBLISH":
      return task.target_id;
  }
}
