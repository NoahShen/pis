import { z } from "zod";

import type { LlmOperation } from "../prompt/prompt-repository.js";

export interface ProcessingRouteResponse {
  readonly routes: Array<"EVENT" | "KNOWLEDGE">;
}

export interface EventSearchResponse {
  readonly clues: Array<{
    readonly entity_name: string;
    readonly subject: string;
    readonly search_terms: string[];
  }>;
}

export type EventAnalysisResult =
  | {
      readonly action: "NEW_EVENT";
      readonly title: string;
      readonly entity: { readonly name: string };
      readonly subject: string;
      readonly scope: string;
      readonly description: string;
      readonly occurred_at?: string | null;
      readonly confirmed_aliases: string[];
    }
  | {
      readonly action: "NEW_UPDATE";
      readonly event_id: string;
      readonly title: string;
      readonly description: string;
      readonly occurred_at?: string | null;
      readonly confirmed_aliases: string[];
    }
  | {
      readonly action: "NO_INCREMENT";
      readonly event_id: string;
      readonly event_update_id: string | null;
      readonly confirmed_aliases: string[];
    };

export interface EventAnalysisResponse {
  readonly results: EventAnalysisResult[];
}

export type KnowledgeAnalysisResponse =
  | { readonly valuable: false }
  | {
      readonly valuable: true;
      readonly title: string;
      readonly summary: string;
      readonly category?:
        "Insight" | "Experience" | "Method" | "Resource" | null;
      readonly findings: Array<{
        readonly title: string;
        readonly description: string;
      }>;
      readonly value: string;
    };

export interface TopicMatchingResponse {
  readonly matched_topic_ids: string[];
}

export interface EventAnalysisReferences {
  readonly candidateEventIds: readonly string[];
  readonly eventIdByUpdateId: Readonly<Record<string, string>>;
}

export interface TopicMatchingReferences {
  readonly enabledTopicIds: readonly string[];
}

export type LlmResponseByOperation = {
  "processing-route": ProcessingRouteResponse;
  "event-search": EventSearchResponse;
  "event-analysis": EventAnalysisResponse;
  "knowledge-analysis": KnowledgeAnalysisResponse;
  "topic-matching": TopicMatchingResponse;
};

export type LlmReferenceContextByOperation = {
  "processing-route": Record<never, never>;
  "event-search": Record<never, never>;
  "event-analysis": EventAnalysisReferences;
  "knowledge-analysis": Record<never, never>;
  "topic-matching": TopicMatchingReferences;
};

export type LlmOutputValidationErrorCode =
  | "LLM_OUTPUT_JSON_INVALID"
  | "LLM_OUTPUT_SCHEMA_INVALID"
  | "LLM_OUTPUT_REFERENCE_INVALID"
  | "LLM_OUTPUT_CONFLICT";

export class LlmOutputValidationError extends Error {
  readonly category = "output_validation";
  readonly retryable = true;
  readonly code: LlmOutputValidationErrorCode;
  readonly operation: LlmOperation | null;

  constructor(
    code: LlmOutputValidationErrorCode,
    operation: LlmOperation | null,
  ) {
    super(`LLM output validation error: ${code}`);
    this.name = "LlmOutputValidationError";
    this.code = code;
    this.operation = operation;
  }
}

const nonBlankString = z.string().regex(/\S/u);
const occurredAt = z.iso.datetime({ offset: true });

const processingRouteResponseSchema = z.strictObject({
  routes: z.array(z.enum(["EVENT", "KNOWLEDGE"])),
});

const eventSearchResponseSchema = z.strictObject({
  clues: z.array(
    z.strictObject({
      entity_name: nonBlankString,
      subject: nonBlankString,
      search_terms: z.array(nonBlankString),
    }),
  ),
});

const newEventSchema = z.strictObject({
  action: z.literal("NEW_EVENT"),
  title: nonBlankString,
  entity: z.strictObject({
    name: nonBlankString,
  }),
  subject: nonBlankString,
  scope: nonBlankString,
  description: nonBlankString,
  occurred_at: occurredAt.nullable().optional(),
  confirmed_aliases: z.array(nonBlankString),
});

const newUpdateSchema = z.strictObject({
  action: z.literal("NEW_UPDATE"),
  event_id: nonBlankString,
  title: nonBlankString,
  description: nonBlankString,
  occurred_at: occurredAt.nullable().optional(),
  confirmed_aliases: z.array(nonBlankString),
});

const noIncrementSchema = z.strictObject({
  action: z.literal("NO_INCREMENT"),
  event_id: nonBlankString,
  event_update_id: nonBlankString.nullable(),
  confirmed_aliases: z.array(nonBlankString),
});

const eventAnalysisResponseSchema = z.strictObject({
  results: z.array(
    z.discriminatedUnion("action", [
      newEventSchema,
      newUpdateSchema,
      noIncrementSchema,
    ]),
  ),
});

const knowledgeAnalysisResponseSchema = z.discriminatedUnion("valuable", [
  z.strictObject({
    valuable: z.literal(false),
  }),
  z.strictObject({
    valuable: z.literal(true),
    title: nonBlankString,
    summary: nonBlankString,
    category: z
      .enum(["Insight", "Experience", "Method", "Resource"])
      .nullable()
      .optional(),
    findings: z.array(
      z.strictObject({
        title: nonBlankString,
        description: nonBlankString,
      }),
    ),
    value: nonBlankString,
  }),
]);

const topicMatchingResponseSchema = z.strictObject({
  matched_topic_ids: z.array(nonBlankString),
});

type OutputSchemaByOperation = {
  readonly [K in LlmOperation]: z.ZodType<LlmResponseByOperation[K]>;
};

const OUTPUT_SCHEMAS = {
  "processing-route": processingRouteResponseSchema,
  "event-search": eventSearchResponseSchema,
  "event-analysis": eventAnalysisResponseSchema,
  "knowledge-analysis": knowledgeAnalysisResponseSchema,
  "topic-matching": topicMatchingResponseSchema,
} satisfies OutputSchemaByOperation;

function isLlmOperation(value: string): value is LlmOperation {
  return Object.prototype.hasOwnProperty.call(OUTPUT_SCHEMAS, value);
}

function getSchema<K extends LlmOperation>(
  operation: K,
): OutputSchemaByOperation[K] {
  if (!isLlmOperation(operation)) {
    throw new LlmOutputValidationError("LLM_OUTPUT_SCHEMA_INVALID", null);
  }

  return OUTPUT_SCHEMAS[operation];
}

function uniqueInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function dedupeAliases(result: EventAnalysisResult): EventAnalysisResult {
  return {
    ...result,
    confirmed_aliases: uniqueInOrder(result.confirmed_aliases),
  };
}

function validateEventReferences(
  response: EventAnalysisResponse,
  references: EventAnalysisReferences,
): void {
  const candidateEventIds = new Set(references.candidateEventIds);

  for (const result of response.results) {
    if (result.action === "NEW_EVENT") {
      continue;
    }

    if (!candidateEventIds.has(result.event_id)) {
      throw new LlmOutputValidationError(
        "LLM_OUTPUT_REFERENCE_INVALID",
        "event-analysis",
      );
    }

    if (result.action !== "NO_INCREMENT" || result.event_update_id === null) {
      continue;
    }

    const updateId = result.event_update_id;
    if (
      !Object.prototype.hasOwnProperty.call(
        references.eventIdByUpdateId,
        updateId,
      )
    ) {
      throw new LlmOutputValidationError(
        "LLM_OUTPUT_REFERENCE_INVALID",
        "event-analysis",
      );
    }

    if (references.eventIdByUpdateId[updateId] !== result.event_id) {
      throw new LlmOutputValidationError(
        "LLM_OUTPUT_REFERENCE_INVALID",
        "event-analysis",
      );
    }
  }
}

function validateEventConflicts(response: EventAnalysisResponse): void {
  const eventsWithNewUpdates = new Set<string>();
  const eventsWithNoIncrements = new Set<string>();

  for (const result of response.results) {
    if (result.action === "NEW_EVENT") {
      continue;
    }

    if (result.action === "NEW_UPDATE") {
      if (
        eventsWithNewUpdates.has(result.event_id) ||
        eventsWithNoIncrements.has(result.event_id)
      ) {
        throw new LlmOutputValidationError(
          "LLM_OUTPUT_CONFLICT",
          "event-analysis",
        );
      }

      eventsWithNewUpdates.add(result.event_id);
      continue;
    }

    if (eventsWithNewUpdates.has(result.event_id)) {
      throw new LlmOutputValidationError(
        "LLM_OUTPUT_CONFLICT",
        "event-analysis",
      );
    }

    eventsWithNoIncrements.add(result.event_id);
  }
}

function normalizeEventAnalysis(
  response: EventAnalysisResponse,
  references: EventAnalysisReferences,
): EventAnalysisResponse {
  const normalized = {
    results: response.results.map(dedupeAliases),
  };

  validateEventReferences(normalized, references);
  validateEventConflicts(normalized);

  return normalized;
}

function normalizeTopicMatching(
  response: TopicMatchingResponse,
  references: TopicMatchingReferences,
): TopicMatchingResponse {
  const matchedTopicIds = uniqueInOrder(response.matched_topic_ids);
  const enabledTopicIds = new Set(references.enabledTopicIds);

  for (const topicId of matchedTopicIds) {
    if (!enabledTopicIds.has(topicId)) {
      throw new LlmOutputValidationError(
        "LLM_OUTPUT_REFERENCE_INVALID",
        "topic-matching",
      );
    }
  }

  return { matched_topic_ids: matchedTopicIds };
}

function parseJson(operation: LlmOperation, content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new LlmOutputValidationError("LLM_OUTPUT_JSON_INVALID", operation);
  }
}

function parseByOperation(
  operation: LlmOperation,
  content: string,
  references: LlmReferenceContextByOperation[LlmOperation],
): LlmResponseByOperation[LlmOperation] {
  const json = parseJson(operation, content);
  const result = getSchema(operation).safeParse(json);

  if (!result.success) {
    throw new LlmOutputValidationError("LLM_OUTPUT_SCHEMA_INVALID", operation);
  }

  switch (operation) {
    case "processing-route": {
      const response = result.data as ProcessingRouteResponse;
      return { routes: uniqueInOrder(response.routes) };
    }
    case "event-search":
      return result.data as EventSearchResponse;
    case "event-analysis":
      return normalizeEventAnalysis(
        result.data as EventAnalysisResponse,
        references as EventAnalysisReferences,
      );
    case "knowledge-analysis":
      return result.data as KnowledgeAnalysisResponse;
    case "topic-matching":
      return normalizeTopicMatching(
        result.data as TopicMatchingResponse,
        references as TopicMatchingReferences,
      );
  }
}

export function parseLlmResponse<K extends LlmOperation>(
  operation: K,
  content: string,
  references: LlmReferenceContextByOperation[K],
): LlmResponseByOperation[K] {
  return parseByOperation(
    operation,
    content,
    references,
  ) as LlmResponseByOperation[K];
}

export function getOutputJsonSchema(operation: LlmOperation): string {
  const schema = getSchema(operation);
  return JSON.stringify(z.toJSONSchema(schema, { io: "output" }));
}
