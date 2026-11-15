import type { LlmOperation } from "../prompt/prompt-repository.js";
import type { PromptRepository } from "../prompt/prompt-repository.js";

import type { TextCompletionClient } from "./chat-completions-client.js";
import {
  getOutputJsonSchema,
  parseLlmResponse,
  type EventAnalysisReferences,
  type EventAnalysisResponse,
  type EventSearchResponse,
  type KnowledgeAnalysisResponse,
  type LlmReferenceContextByOperation,
  type LlmResponseByOperation,
  type ProcessingRouteResponse,
  type TopicMatchingReferences,
  type TopicMatchingResponse,
} from "./response-validators.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface LlmCallOptions {
  readonly signal?: AbortSignal;
}

export interface TypedLlmCalls {
  routeProcessing(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<ProcessingRouteResponse>;
  searchEvents(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<EventSearchResponse>;
  analyzeEvents(
    taskData: JsonObject,
    references: EventAnalysisReferences,
    options?: LlmCallOptions,
  ): Promise<EventAnalysisResponse>;
  analyzeKnowledge(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<KnowledgeAnalysisResponse>;
  matchTopics(
    taskData: JsonObject,
    references: TopicMatchingReferences,
    options?: LlmCallOptions,
  ): Promise<TopicMatchingResponse>;
}

export interface TypedLlmCallDependencies {
  readonly prompts: Pick<PromptRepository, "load">;
  readonly completionClient: TextCompletionClient;
}

const INSTRUCTIONS_LABEL = "## Function Instructions";
const OUTPUT_SCHEMA_LABEL = "## Output JSON Schema";

function composeSystemContent(
  operation: LlmOperation,
  instructions: string,
): string {
  return [
    INSTRUCTIONS_LABEL,
    instructions,
    OUTPUT_SCHEMA_LABEL,
    getOutputJsonSchema(operation),
  ].join("\n\n");
}

function composeTaskData(taskData: JsonObject): string {
  return JSON.stringify({ task_data: taskData });
}

function composeKnowledgeData(
  taskData: JsonObject,
  userContext: string | null,
): string {
  return JSON.stringify({
    task_data: taskData,
    user_context: userContext,
  });
}

function cloneForCall<T>(value: T): T {
  return structuredClone(value);
}

export function createTypedLlmCalls(
  dependencies: TypedLlmCallDependencies,
): TypedLlmCalls {
  async function call<K extends LlmOperation>(
    operation: K,
    taskDataSnapshot: JsonObject,
    referencesSnapshot: LlmReferenceContextByOperation[K],
    signal: AbortSignal | undefined,
  ): Promise<LlmResponseByOperation[K]> {
    const prompt = await dependencies.prompts.load(operation);
    const systemContent = composeSystemContent(operation, prompt.instructions);
    const userContent =
      operation === "knowledge-analysis"
        ? composeKnowledgeData(taskDataSnapshot, prompt.userContext)
        : composeTaskData(taskDataSnapshot);
    const content = await dependencies.completionClient.complete({
      systemContent,
      userContent,
      ...(signal === undefined ? {} : { signal }),
    });

    return parseLlmResponse(operation, content, referencesSnapshot);
  }

  return {
    async routeProcessing(taskData, options) {
      const taskDataSnapshot = cloneForCall(taskData);
      const signal = options?.signal;
      return call("processing-route", taskDataSnapshot, {}, signal);
    },

    async searchEvents(taskData, options) {
      const taskDataSnapshot = cloneForCall(taskData);
      const signal = options?.signal;
      return call("event-search", taskDataSnapshot, {}, signal);
    },

    async analyzeEvents(taskData, references, options) {
      const taskDataSnapshot = cloneForCall(taskData);
      const referencesSnapshot = cloneForCall(references);
      const signal = options?.signal;
      return call(
        "event-analysis",
        taskDataSnapshot,
        referencesSnapshot,
        signal,
      );
    },

    async analyzeKnowledge(taskData, options) {
      const taskDataSnapshot = cloneForCall(taskData);
      const signal = options?.signal;
      return call("knowledge-analysis", taskDataSnapshot, {}, signal);
    },

    async matchTopics(taskData, references, options) {
      const taskDataSnapshot = cloneForCall(taskData);
      const referencesSnapshot = cloneForCall(references);
      const signal = options?.signal;
      return call(
        "topic-matching",
        taskDataSnapshot,
        referencesSnapshot,
        signal,
      );
    },
  };
}
