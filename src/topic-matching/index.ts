export { createTopicMatching } from "./topic-matching.js";
export { TopicMatchingError } from "./topic-matching-errors.js";

export type {
  EventTopicBackground,
  EventTopicTarget,
  EventUpdateTopicTarget,
  KnowledgeTopicFinding,
  KnowledgeTopicTarget,
  TopicMatchingCalls,
  TopicMatchingDependencies,
  TopicMatchingFailureCode,
  TopicMatchingOptions,
  TopicMatchingPublishedItemRepository,
  TopicMatchingResult,
  TopicMatchingService,
  TopicMatchingTarget,
  TopicMatchingTopicRepository,
  TopicTargetType,
} from "./contracts.js";
export type { TopicMatchingErrorCode } from "./topic-matching-errors.js";
export type {
  TopicMatchingLogEntry,
  TopicMatchingLogger,
  TopicMatchingLogStage,
} from "./topic-matching-logger.js";
