import type {
  TopicMatchingDependencies,
  TopicMatchingFailureCode,
  TopicMatchingService,
  TopicTargetType,
} from "./contracts.js";
import {
  buildTopicMatchingReferences,
  buildTopicMatchingTaskData,
  callTopicMatching,
} from "./topic-matching-call.js";
import {
  isTopicMatchingAbort,
  TopicMatchingError,
} from "./topic-matching-errors.js";
import {
  logTopicMatching,
  type TopicMatchingLogger,
} from "./topic-matching-logger.js";
import { persistTopicAssociations } from "./topic-matching-persistence.js";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isValidTargetType(value: unknown): value is TopicTargetType {
  return value === "EVENT" || value === "EVENT_UPDATE" || value === "KNOWLEDGE";
}

function isValidTargetId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function dependencyFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: TopicMatchingFailureCode,
): TopicMatchingError {
  if (isSignalAborted(signal) || isTopicMatchingAbort(error)) {
    return new TopicMatchingError("aborted");
  }

  return new TopicMatchingError(fallback);
}

function throwAborted(
  logger: TopicMatchingLogger,
  targetType: TopicTargetType,
  targetId: string,
  stage: "check" | "match" | "persist",
  counts: {
    readonly enabledTopicCount?: number;
    readonly matchedTopicCount?: number;
  } = {},
): never {
  logTopicMatching(logger, {
    targetType,
    targetId,
    ...counts,
    stage,
    reason: "aborted",
  });
  throw new TopicMatchingError("aborted");
}

export function createTopicMatching(
  dependencies: TopicMatchingDependencies,
): TopicMatchingService {
  return {
    async match(targetType, targetId, options) {
      if (!isValidTargetType(targetType) || !isValidTargetId(targetId)) {
        logTopicMatching(dependencies.logger, {
          stage: "check",
          reason: "invalid_input",
        });
        throw new TopicMatchingError("invalid_input");
      }

      const signal = options?.signal;
      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "check");
      }

      let target;
      try {
        target = dependencies.targetRepository.getTarget(targetType, targetId);
      } catch (error) {
        const failure = dependencyFailure(
          error,
          signal,
          "topic_matching_failed",
        );
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "check");
      }
      if (target === null) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: "target_not_found",
        });
        throw new TopicMatchingError("target_not_found");
      }

      let published;
      try {
        published = dependencies.publishedItemRepository.existsForTarget(
          targetType,
          targetId,
        );
      } catch (error) {
        const failure = dependencyFailure(
          error,
          signal,
          "topic_matching_failed",
        );
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "check");
      }
      if (published) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
        });
        return {
          should_publish: false,
          target_type: targetType,
          target_id: targetId,
        };
      }

      let associated;
      try {
        associated = dependencies.associationRepository.existsForTarget(
          targetType,
          targetId,
        );
      } catch (error) {
        const failure = dependencyFailure(
          error,
          signal,
          "topic_matching_failed",
        );
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "check");
      }
      if (associated) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
        });
        return {
          should_publish: true,
          target_type: targetType,
          target_id: targetId,
        };
      }

      let topics;
      try {
        topics = dependencies.topicRepository.listEnabled();
      } catch (error) {
        const failure = dependencyFailure(
          error,
          signal,
          "topic_matching_failed",
        );
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "check");
      }
      const enabledTopicCount = topics.length;
      if (enabledTopicCount === 0) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          enabledTopicCount,
          stage: "check",
        });
        return {
          should_publish: false,
          target_type: targetType,
          target_id: targetId,
        };
      }

      const enabledTopicIds = topics.map(({ id }) => id);
      const taskData = buildTopicMatchingTaskData(target, topics);
      const references = buildTopicMatchingReferences(topics);
      let response;
      try {
        response = await callTopicMatching(
          taskData,
          references,
          dependencies.typedLlmCalls,
          signal,
        );
      } catch (error) {
        const failure = dependencyFailure(error, signal, "llm_failed");
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          enabledTopicCount,
          stage: "match",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "match", {
          enabledTopicCount,
        });
      }
      if (!Array.isArray(response.matched_topic_ids)) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          enabledTopicCount,
          stage: "match",
          reason: "llm_failed",
        });
        throw new TopicMatchingError("llm_failed");
      }

      const matchedTopicIds = response.matched_topic_ids;
      const matchedTopicCount = matchedTopicIds.length;
      if (matchedTopicCount === 0) {
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          enabledTopicCount,
          matchedTopicCount,
          stage: "match",
        });
        return {
          should_publish: false,
          target_type: targetType,
          target_id: targetId,
        };
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "match", {
          enabledTopicCount,
          matchedTopicCount,
        });
      }

      try {
        persistTopicAssociations(dependencies, {
          targetType,
          targetId,
          enabledTopicIds,
          matchedTopicIds,
        });
      } catch (error) {
        const failure = dependencyFailure(
          error,
          signal,
          "topic_matching_failed",
        );
        logTopicMatching(dependencies.logger, {
          targetType,
          targetId,
          enabledTopicCount,
          matchedTopicCount,
          stage: "persist",
          reason: failure.code,
        });
        throw failure;
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, targetType, targetId, "persist", {
          enabledTopicCount,
          matchedTopicCount,
        });
      }

      logTopicMatching(dependencies.logger, {
        targetType,
        targetId,
        enabledTopicCount,
        matchedTopicCount,
        stage: "persist",
      });
      return {
        should_publish: true,
        target_type: targetType,
        target_id: targetId,
      };
    },
  };
}
