import type { LlmFailureCategory } from "../llm/failure-summary.js";
import type { LlmOperation } from "../prompt/prompt-repository.js";
import type { CollectResult } from "../collection/contracts.js";
import type { EventAnalysisResult } from "../event-analysis/contracts.js";
import type { KnowledgeResult } from "../knowledge/contracts.js";
import type { ProcessResult } from "../processing/contracts.js";
import type {
  TopicMatchingResult,
  TopicTargetType,
} from "../topic-matching/contracts.js";

export type { CollectResult } from "../collection/contracts.js";
export type { EventAnalysisResult } from "../event-analysis/contracts.js";
export type { KnowledgeResult } from "../knowledge/contracts.js";
export type { ProcessResult } from "../processing/contracts.js";
export type { TopicMatchingResult } from "../topic-matching/contracts.js";

export type TargetType = TopicTargetType;

export type RuntimeTask =
  | { readonly type: "COLLECT"; readonly source_id: string }
  | { readonly type: "PROCESS"; readonly source_item_id: string }
  | { readonly type: "EVENT_ANALYSIS"; readonly content_id: string }
  | { readonly type: "KNOWLEDGE_ANALYSIS"; readonly content_id: string }
  | {
      readonly type: "TOPIC_MATCHING";
      readonly target_type: TargetType;
      readonly target_id: string;
    }
  | {
      readonly type: "PUBLISH";
      readonly target_type: TargetType;
      readonly target_id: string;
    };

export type RuntimeTaskType = RuntimeTask["type"];

export interface PublishResult {
  readonly published_item_id: string | null;
}

export interface StageServices {
  collect(
    sourceId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CollectResult>;
  process(
    sourceItemId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ProcessResult>;
  analyzeEvent(
    contentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EventAnalysisResult>;
  analyzeKnowledge(
    contentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<KnowledgeResult>;
  matchTopics(
    type: TargetType,
    id: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TopicMatchingResult>;
  publish(
    type: TargetType,
    id: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PublishResult>;
}

export interface RuntimeLogEntry {
  readonly taskType?: RuntimeTaskType;
  readonly taskId?: string;
  readonly stage?: RuntimeTaskType | "dispatch" | "shutdown";
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly queueSize?: number;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly operation?: LlmOperation | null;
  readonly category?: LlmFailureCategory;
  readonly httpStatus?: number;
  readonly retryable?: boolean;
  readonly final?: boolean;
}

export interface RuntimeLogger {
  log(entry: RuntimeLogEntry): void | PromiseLike<void>;
}

export interface RuntimeDependencies {
  readonly services: StageServices;
  /** Per-stage queue capacity. Defaults to 8. */
  readonly queueCapacity?: number;
  /** Stage attempts including the first attempt. Defaults to 2. */
  readonly maxAttempts?: number;
  /** Downstream enqueue attempts including the first attempt. Defaults to 2. */
  readonly dispatchAttempts?: number;
  /** Graceful shutdown budget in milliseconds. Defaults to 5000. */
  readonly shutdownTimeoutMs?: number;
  /** Maximum worker-exit wait after timeout abort. Defaults to 1000. */
  readonly shutdownGraceMs?: number;
  readonly logger?: RuntimeLogger;
}

export interface RuntimeShutdownOptions {
  /** Overrides RuntimeDependencies.shutdownTimeoutMs for this shutdown. */
  readonly timeoutMs?: number;
}

export interface Runtime {
  submit(task: RuntimeTask): Promise<void>;
  start(): Promise<void>;
  stopAccepting(): void;
  drain(): Promise<void>;
  shutdown(options?: RuntimeShutdownOptions): Promise<void>;
}
