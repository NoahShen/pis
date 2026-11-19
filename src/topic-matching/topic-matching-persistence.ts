import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { Clock } from "../time/clock.js";
import { formatTimestamp } from "../time/format-time.js";

import type { TopicTargetType } from "./contracts.js";
import type { TopicAssociationRepository } from "./topic-association-repository.js";
import { TopicMatchingError } from "./topic-matching-errors.js";
import type { TopicMatchingTargetRepository } from "./topic-matching-target-repository.js";

export interface TopicMatchingPersistenceDependencies {
  readonly database: Database.Database;
  readonly targetRepository: TopicMatchingTargetRepository;
  readonly associationRepository: TopicAssociationRepository;
  readonly clock: Clock;
}

export interface TopicMatchingPersistenceInput {
  readonly targetType: TopicTargetType;
  readonly targetId: string;
  readonly enabledTopicIds: readonly string[];
  readonly matchedTopicIds: readonly string[];
}

export interface TopicMatchingPersistenceResult {
  readonly should_publish: true;
}

function orderedMatchedTopicIds(
  enabledTopicIds: readonly string[],
  matchedTopicIds: readonly string[],
): string[] {
  const matched = new Set(matchedTopicIds);
  return enabledTopicIds.filter((topicId) => matched.has(topicId));
}

export function persistTopicAssociations(
  dependencies: TopicMatchingPersistenceDependencies,
  input: TopicMatchingPersistenceInput,
): TopicMatchingPersistenceResult {
  return withTransaction(dependencies.database, () => {
    const target = dependencies.targetRepository.getTarget(
      input.targetType,
      input.targetId,
    );
    if (target === null) {
      throw new TopicMatchingError("target_not_found");
    }

    if (
      dependencies.associationRepository.existsForTarget(
        input.targetType,
        input.targetId,
      )
    ) {
      return { should_publish: true } as const;
    }

    const matchedAt = formatTimestamp(dependencies.clock.now());
    const topicIds = orderedMatchedTopicIds(
      input.enabledTopicIds,
      input.matchedTopicIds,
    );

    for (const topicId of topicIds) {
      dependencies.associationRepository.insertIfAbsent({
        topic_id: topicId,
        target_type: input.targetType,
        target_id: input.targetId,
        matched_at: matchedAt,
      });
    }

    return { should_publish: true } as const;
  });
}
