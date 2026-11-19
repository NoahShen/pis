import type { Topic } from "../configuration/contracts.js";
import type { JsonObject, TypedLlmCalls } from "../llm/llm-calls.js";
import type {
  TopicMatchingReferences,
  TopicMatchingResponse,
} from "../llm/response-validators.js";

import type { TopicMatchingTarget } from "./contracts.js";
import {
  TopicMatchingError,
  isTopicMatchingAbort,
} from "./topic-matching-errors.js";

export type TopicMatchingTaskTopic = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
};

export type TopicMatchingTaskData = {
  readonly target: TopicMatchingTarget & JsonObject;
  readonly topics: TopicMatchingTaskTopic[];
};

export type TopicMatchingCalls = Pick<TypedLlmCalls, "matchTopics">;

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function snapshotTarget(
  target: TopicMatchingTarget,
): TopicMatchingTarget & JsonObject {
  switch (target.target_type) {
    case "EVENT":
      return {
        target_type: "EVENT",
        id: target.id,
        title: target.title,
        entity_name: target.entity_name,
        subject: target.subject,
        scope: target.scope,
        description: target.description,
        occurred_at: target.occurred_at,
      };
    case "EVENT_UPDATE":
      return {
        target_type: "EVENT_UPDATE",
        id: target.id,
        event_id: target.event_id,
        title: target.title,
        description: target.description,
        occurred_at: target.occurred_at,
        event: {
          id: target.event.id,
          title: target.event.title,
          entity_name: target.event.entity_name,
          subject: target.event.subject,
          scope: target.event.scope,
          description: target.event.description,
        },
      };
    case "KNOWLEDGE":
      return {
        target_type: "KNOWLEDGE",
        id: target.id,
        title: target.title,
        summary: target.summary,
        category: target.category,
        findings: target.findings.map((finding) => ({
          title: finding.title,
          description: finding.description,
        })),
        value: target.value,
      };
  }
}

export function buildTopicMatchingTaskData(
  target: TopicMatchingTarget,
  topics: readonly Topic[],
): TopicMatchingTaskData {
  return {
    target: snapshotTarget(target),
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      description: topic.description,
    })),
  };
}

export function buildTopicMatchingReferences(
  topics: readonly Topic[],
): TopicMatchingReferences {
  return {
    enabledTopicIds: topics.map(({ id }) => id),
  };
}

export async function callTopicMatching(
  taskData: TopicMatchingTaskData,
  references: TopicMatchingReferences,
  typedLlmCalls: TopicMatchingCalls,
  signal: AbortSignal | undefined,
): Promise<TopicMatchingResponse> {
  if (isSignalAborted(signal)) {
    throw new TopicMatchingError("aborted");
  }

  try {
    const response = await typedLlmCalls.matchTopics(taskData, references, {
      signal,
    });

    if (isSignalAborted(signal)) {
      throw new TopicMatchingError("aborted");
    }

    return response;
  } catch (error) {
    if (isSignalAborted(signal) || isTopicMatchingAbort(error)) {
      throw new TopicMatchingError("aborted");
    }

    throw new TopicMatchingError("llm_failed");
  }
}
