import { describe, expect, it } from "vitest";

import {
  EVENT_ANALYSIS_REFERENCES,
  EVENT_ANALYSIS_RESPONSE,
  EVENT_ANALYSIS_RESULTS,
  EVENT_SEARCH_RESPONSE,
  KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE,
  KNOWLEDGE_ANALYSIS_RESPONSE,
  PROCESSING_ROUTE_RESPONSE,
  TOPIC_MATCHING_RESPONSE,
  TOPIC_MATCHING_REFERENCES,
} from "../fixtures/llm-responses.js";
import {
  LLM_OPERATIONS,
  type LlmOperation,
} from "../../src/prompt/prompt-repository.js";
import { summarizeLlmFailure } from "../../src/llm/failure-summary.js";
import {
  LlmOutputValidationError,
  getOutputJsonSchema,
  parseLlmResponse,
  type EventAnalysisResponse,
  type LlmOutputValidationErrorCode,
} from "../../src/llm/response-validators.js";

const [newEventResult, newUpdateResult, noIncrementResult] =
  EVENT_ANALYSIS_RESULTS;

const parseUnknown = parseLlmResponse as unknown as (
  operation: LlmOperation,
  content: string,
  references: unknown,
) => unknown;

function parseJson(
  operation: LlmOperation,
  value: unknown,
  references: unknown = {},
): unknown {
  return parseUnknown(operation, JSON.stringify(value), references);
}

function captureOutputError(callback: () => unknown): LlmOutputValidationError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(LlmOutputValidationError);
    return error as LlmOutputValidationError;
  }

  throw new Error("Expected LLM output validation to fail");
}

function expectOutputError(
  callback: () => unknown,
  code: LlmOutputValidationErrorCode,
  operation: LlmOperation,
): LlmOutputValidationError {
  const error = captureOutputError(callback);

  expect(error).toMatchObject({
    name: "LlmOutputValidationError",
    category: "output_validation",
    retryable: true,
    code,
    operation,
  });
  expect(String(error)).toBe(
    `LlmOutputValidationError: LLM output validation error: ${code}`,
  );
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("issues");
  expect(error).not.toHaveProperty("data");
  expect(error).not.toHaveProperty("path");
  expect(summarizeLlmFailure(error)).toEqual({
    operation,
    category: "output_validation",
    reason: code,
    retryable: true,
  });

  return error;
}

function expectNoLeak(
  error: LlmOutputValidationError,
  forbiddenValues: readonly string[],
): void {
  for (const forbiddenValue of forbiddenValues) {
    expect(String(error)).not.toContain(forbiddenValue);
    expect(error.message).not.toContain(forbiddenValue);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectObjectNodes(
  value: unknown,
  nodes: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectNodes(item, nodes);
    }
    return nodes;
  }

  if (!isRecord(value)) {
    return nodes;
  }

  if (value.type === "object") {
    nodes.push(value);
  }

  for (const child of Object.values(value)) {
    collectObjectNodes(child, nodes);
  }

  return nodes;
}

function collectValuesForKey(value: unknown, key: string): unknown[] {
  const matches: unknown[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      matches.push(...collectValuesForKey(item, key));
    }
    return matches;
  }

  if (!isRecord(value)) {
    return matches;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) {
      matches.push(entryValue);
    }
    matches.push(...collectValuesForKey(entryValue, key));
  }

  return matches;
}

function findBranch(
  schema: Record<string, unknown>,
  discriminant: string,
  value: string | boolean,
): Record<string, unknown> {
  const branch = collectObjectNodes(schema).find((node) => {
    const properties = node.properties;
    if (!isRecord(properties)) {
      return false;
    }

    const discriminantSchema = properties[discriminant];
    return isRecord(discriminantSchema) && discriminantSchema.const === value;
  });

  if (branch === undefined) {
    throw new Error(`Missing ${discriminant}=${String(value)} schema branch`);
  }

  return branch;
}

function getPropertySchema(
  branch: Record<string, unknown>,
  property: string,
): Record<string, unknown> {
  const properties = branch.properties;
  if (!isRecord(properties) || !isRecord(properties[property])) {
    throw new Error(`Missing ${property} property schema`);
  }

  return properties[property];
}

function containsNullType(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsNullType);
  }

  if (!isRecord(value)) {
    return value === null;
  }

  if (value.type === "null") {
    return true;
  }
  if (
    Array.isArray(value.type) &&
    value.type.some((entry) => entry === "null")
  ) {
    return true;
  }

  return Object.values(value).some(containsNullType);
}

describe("parseLlmResponse", () => {
  it("parseLlmResponse accepts every strict response shape", () => {
    expect(parseJson("processing-route", PROCESSING_ROUTE_RESPONSE)).toEqual(
      PROCESSING_ROUTE_RESPONSE,
    );
    expect(parseJson("event-search", EVENT_SEARCH_RESPONSE)).toEqual(
      EVENT_SEARCH_RESPONSE,
    );
    expect(
      parseJson(
        "event-analysis",
        EVENT_ANALYSIS_RESPONSE,
        EVENT_ANALYSIS_REFERENCES,
      ),
    ).toEqual(EVENT_ANALYSIS_RESPONSE);
    expect(
      parseJson("knowledge-analysis", KNOWLEDGE_ANALYSIS_RESPONSE),
    ).toEqual(KNOWLEDGE_ANALYSIS_RESPONSE);
    expect(
      parseJson(
        "topic-matching",
        TOPIC_MATCHING_RESPONSE,
        TOPIC_MATCHING_REFERENCES,
      ),
    ).toEqual(TOPIC_MATCHING_RESPONSE);
  });

  it("parseLlmResponse accepts every valid empty and negative business result", () => {
    const unclassifiedKnowledge = {
      valuable: true,
      title: "Synthetic empty findings",
      summary: "A legal knowledge result with no findings.",
      category: null,
      findings: [],
      value: "Synthetic value without findings.",
    };
    const categoryOmitted = {
      valuable: true,
      title: "Synthetic omitted category",
      summary: "A legal knowledge result with an omitted category.",
      findings: [],
      value: "Synthetic value with an omitted category.",
    };
    const eventReferences = {
      candidateEventIds: ["event-synthetic-1"],
      eventIdByUpdateId: {
        "update-synthetic-1": "event-synthetic-1",
      },
    };

    expect(parseJson("processing-route", { routes: [] })).toEqual({
      routes: [],
    });
    expect(parseJson("event-search", { clues: [] })).toEqual({ clues: [] });
    expect(
      parseJson(
        "event-analysis",
        { results: [] },
        { candidateEventIds: [], eventIdByUpdateId: {} },
      ),
    ).toEqual({ results: [] });
    expect(
      parseJson("knowledge-analysis", KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE),
    ).toEqual(KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE);
    expect(parseJson("knowledge-analysis", unclassifiedKnowledge)).toEqual(
      unclassifiedKnowledge,
    );
    expect(parseJson("knowledge-analysis", categoryOmitted)).toEqual(
      categoryOmitted,
    );
    expect(
      parseJson(
        "topic-matching",
        { matched_topic_ids: [] },
        { enabledTopicIds: [] },
      ),
    ).toEqual({ matched_topic_ids: [] });

    expect(
      parseJson(
        "event-analysis",
        {
          results: [
            {
              ...noIncrementResult,
              event_id: "event-synthetic-1",
              event_update_id: null,
            },
            {
              ...noIncrementResult,
              event_id: "event-synthetic-1",
              event_update_id: "update-synthetic-1",
            },
            newEventResult,
            { ...newEventResult, title: "Synthetic second new event" },
          ],
        },
        eventReferences,
      ),
    ).toMatchObject({
      results: [
        { action: "NO_INCREMENT", event_update_id: null },
        { action: "NO_INCREMENT", event_update_id: "update-synthetic-1" },
        { action: "NEW_EVENT" },
        { action: "NEW_EVENT" },
      ],
    });
  });

  it("strict schemas reject additional missing mistyped and enum fields at every level", () => {
    const strictCases: Array<{
      readonly name: string;
      readonly operation: LlmOperation;
      readonly value: unknown;
      readonly references?: unknown;
    }> = [
      {
        name: "processing route outer additional field",
        operation: "processing-route",
        value: { ...PROCESSING_ROUTE_RESPONSE, extra: "sentinel-route" },
      },
      {
        name: "processing route missing routes",
        operation: "processing-route",
        value: {},
      },
      {
        name: "processing route invalid enum",
        operation: "processing-route",
        value: { routes: ["OTHER"] },
      },
      {
        name: "processing route mistyped routes",
        operation: "processing-route",
        value: { routes: "EVENT" },
      },
      {
        name: "event search outer additional field",
        operation: "event-search",
        value: { ...EVENT_SEARCH_RESPONSE, extra: "sentinel-search" },
      },
      {
        name: "event search clue additional field",
        operation: "event-search",
        value: {
          clues: [
            { ...EVENT_SEARCH_RESPONSE.clues[0], extra: "sentinel-clue" },
          ],
        },
      },
      {
        name: "event search missing entity name",
        operation: "event-search",
        value: {
          clues: [
            {
              subject: "Synthetic subject",
              search_terms: ["synthetic term"],
            },
          ],
        },
      },
      {
        name: "event search mistyped search terms",
        operation: "event-search",
        value: {
          clues: [
            {
              ...EVENT_SEARCH_RESPONSE.clues[0],
              search_terms: "synthetic term",
            },
          ],
        },
      },
      {
        name: "event search blank entity name",
        operation: "event-search",
        value: {
          clues: [{ ...EVENT_SEARCH_RESPONSE.clues[0], entity_name: " \t" }],
        },
      },
      {
        name: "event search blank subject",
        operation: "event-search",
        value: {
          clues: [{ ...EVENT_SEARCH_RESPONSE.clues[0], subject: "\n" }],
        },
      },
      {
        name: "event search blank term",
        operation: "event-search",
        value: {
          clues: [{ ...EVENT_SEARCH_RESPONSE.clues[0], search_terms: ["  "] }],
        },
      },
      {
        name: "event analysis outer additional field",
        operation: "event-analysis",
        value: { ...EVENT_ANALYSIS_RESPONSE, extra: "sentinel-event" },
        references: EVENT_ANALYSIS_REFERENCES,
      },
      {
        name: "event analysis entity additional field",
        operation: "event-analysis",
        value: {
          results: [
            {
              ...newEventResult,
              entity: { ...newEventResult.entity, extra: "sentinel-entity" },
            },
          ],
        },
      },
      {
        name: "event analysis missing branch field",
        operation: "event-analysis",
        value: {
          results: [
            {
              action: "NEW_EVENT",
              title: "Synthetic missing scope",
              entity: { name: "Synthetic Entity" },
              subject: "Synthetic subject",
              description: "Synthetic description",
              confirmed_aliases: [],
            },
          ],
        },
      },
      {
        name: "event analysis mistyped branch field",
        operation: "event-analysis",
        value: {
          results: [{ ...newEventResult, title: 42 }],
        },
      },
      {
        name: "event analysis missing aliases",
        operation: "event-analysis",
        value: {
          results: [
            {
              action: "NEW_EVENT",
              title: "Synthetic missing aliases",
              entity: { name: "Synthetic Entity" },
              subject: "Synthetic subject",
              scope: "Synthetic scope",
              description: "Synthetic description",
            },
          ],
        },
      },
      {
        name: "event analysis blank alias",
        operation: "event-analysis",
        value: {
          results: [{ ...newEventResult, confirmed_aliases: [" \t"] }],
        },
      },
      {
        name: "knowledge false additional field",
        operation: "knowledge-analysis",
        value: {
          ...KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE,
          title: "Sentinel forbidden title",
        },
      },
      {
        name: "knowledge true outer additional field",
        operation: "knowledge-analysis",
        value: { ...KNOWLEDGE_ANALYSIS_RESPONSE, extra: "sentinel-knowledge" },
      },
      {
        name: "knowledge finding additional field",
        operation: "knowledge-analysis",
        value: {
          ...KNOWLEDGE_ANALYSIS_RESPONSE,
          findings: [
            {
              ...KNOWLEDGE_ANALYSIS_RESPONSE.findings[0],
              extra: "sentinel-finding",
            },
          ],
        },
      },
      {
        name: "knowledge missing value",
        operation: "knowledge-analysis",
        value: {
          valuable: true,
          title: "Synthetic missing value",
          summary: "Synthetic summary",
          findings: [],
        },
      },
      {
        name: "knowledge invalid category",
        operation: "knowledge-analysis",
        value: { ...KNOWLEDGE_ANALYSIS_RESPONSE, category: "Other" },
      },
      {
        name: "knowledge blank summary",
        operation: "knowledge-analysis",
        value: { ...KNOWLEDGE_ANALYSIS_RESPONSE, summary: " \n" },
      },
      {
        name: "knowledge blank finding title",
        operation: "knowledge-analysis",
        value: {
          ...KNOWLEDGE_ANALYSIS_RESPONSE,
          findings: [
            {
              ...KNOWLEDGE_ANALYSIS_RESPONSE.findings[0],
              title: "\t ",
            },
          ],
        },
      },
      {
        name: "topic matching outer additional field",
        operation: "topic-matching",
        value: { ...TOPIC_MATCHING_RESPONSE, extra: "sentinel-topic" },
        references: TOPIC_MATCHING_REFERENCES,
      },
      {
        name: "topic matching missing ids",
        operation: "topic-matching",
        value: {},
      },
      {
        name: "topic matching mistyped ids",
        operation: "topic-matching",
        value: { matched_topic_ids: [42] },
      },
      {
        name: "topic matching blank id",
        operation: "topic-matching",
        value: { matched_topic_ids: [" \n"] },
      },
    ];

    for (const strictCase of strictCases) {
      const error = expectOutputError(
        () =>
          parseJson(
            strictCase.operation,
            strictCase.value,
            strictCase.references,
          ),
        "LLM_OUTPUT_SCHEMA_INVALID",
        strictCase.operation,
      );
      expectNoLeak(error, [
        "sentinel-route",
        "sentinel-search",
        "sentinel-clue",
        "sentinel-event",
        "sentinel-entity",
        "sentinel-knowledge",
        "sentinel-finding",
        "sentinel-topic",
        "/private/",
      ]);
      expect(error, strictCase.name).toBeInstanceOf(LlmOutputValidationError);
    }
  });

  it("event analysis rejects invalid branches unknown events and wrong update ownership", () => {
    const updateReferences = {
      candidateEventIds: ["event-synthetic-1", "event-synthetic-2"],
      eventIdByUpdateId: {
        "update-synthetic-2": "event-synthetic-2",
      },
    };
    const cases: Array<{
      readonly name: string;
      readonly result: Record<string, unknown>;
      readonly references?: unknown;
      readonly code: LlmOutputValidationErrorCode;
    }> = [
      {
        name: "new event generated event id",
        result: { ...newEventResult, event_id: "event-forbidden" },
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      },
      {
        name: "new event generated update id",
        result: { ...newEventResult, event_update_id: "update-forbidden" },
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      },
      {
        name: "new update generated update id",
        result: { ...newUpdateResult, event_update_id: "update-forbidden" },
        references: updateReferences,
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      },
      {
        name: "no increment generated title",
        result: {
          ...noIncrementResult,
          event_id: "event-synthetic-1",
          title: "Forbidden new fact",
        },
        references: updateReferences,
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      },
      {
        name: "no increment missing update id",
        result: {
          action: "NO_INCREMENT",
          event_id: "event-synthetic-1",
          confirmed_aliases: [],
        },
        references: updateReferences,
        code: "LLM_OUTPUT_SCHEMA_INVALID",
      },
      {
        name: "unknown new update event",
        result: {
          ...newUpdateResult,
          event_id: "unknown-event-sentinel",
        },
        references: updateReferences,
        code: "LLM_OUTPUT_REFERENCE_INVALID",
      },
      {
        name: "unknown no increment event",
        result: {
          ...noIncrementResult,
          event_id: "unknown-event-sentinel",
          event_update_id: null,
        },
        references: updateReferences,
        code: "LLM_OUTPUT_REFERENCE_INVALID",
      },
      {
        name: "unknown update id",
        result: {
          ...noIncrementResult,
          event_id: "event-synthetic-1",
          event_update_id: "unknown-update-sentinel",
        },
        references: updateReferences,
        code: "LLM_OUTPUT_REFERENCE_INVALID",
      },
      {
        name: "wrong update ownership",
        result: {
          ...noIncrementResult,
          event_id: "event-synthetic-1",
          event_update_id: "update-synthetic-2",
        },
        references: updateReferences,
        code: "LLM_OUTPUT_REFERENCE_INVALID",
      },
    ];

    for (const testCase of cases) {
      const error = expectOutputError(
        () =>
          parseJson(
            "event-analysis",
            { results: [testCase.result] },
            testCase.references ?? updateReferences,
          ),
        testCase.code,
        "event-analysis",
      );
      expectNoLeak(error, [
        "event-forbidden",
        "update-forbidden",
        "unknown-event-sentinel",
        "unknown-update-sentinel",
        testCase.name,
      ]);
    }
  });

  it("event analysis rejects contradictory and duplicate update decisions", () => {
    const references = {
      candidateEventIds: ["event-synthetic-1"],
      eventIdByUpdateId: {
        "update-synthetic-1": "event-synthetic-1",
      },
    };
    const update = { ...newUpdateResult, event_id: "event-synthetic-1" };
    const noIncrement = {
      ...noIncrementResult,
      event_id: "event-synthetic-1",
      event_update_id: null,
    };
    const conflictingResponses = [
      [update, noIncrement],
      [noIncrement, update],
      [update, update],
    ];

    for (const results of conflictingResponses) {
      const error = expectOutputError(
        () => parseJson("event-analysis", { results }, references),
        "LLM_OUTPUT_CONFLICT",
        "event-analysis",
      );
      expectNoLeak(error, ["event-synthetic-1", "Synthetic status update"]);
    }

    expect(
      parseJson(
        "event-analysis",
        {
          results: [
            noIncrement,
            { ...noIncrement, event_update_id: "update-synthetic-1" },
          ],
        },
        references,
      ),
    ).toMatchObject({
      results: [
        { action: "NO_INCREMENT", event_update_id: null },
        {
          action: "NO_INCREMENT",
          event_update_id: "update-synthetic-1",
        },
      ],
    });
  });

  it("reference-backed topic matching rejects unknown topics before stable deduplication", () => {
    const references = {
      enabledTopicIds: ["topic-a", "topic-b", "topic-c"],
    };

    expect(
      parseJson(
        "topic-matching",
        {
          matched_topic_ids: [
            "topic-b",
            "topic-a",
            "topic-b",
            "topic-c",
            "topic-a",
          ],
        },
        references,
      ),
    ).toEqual({
      matched_topic_ids: ["topic-b", "topic-a", "topic-c"],
    });

    const error = expectOutputError(
      () =>
        parseJson(
          "topic-matching",
          {
            matched_topic_ids: [
              "topic-a",
              "unknown-topic-sentinel",
              "unknown-topic-sentinel",
            ],
          },
          references,
        ),
      "LLM_OUTPUT_REFERENCE_INVALID",
      "topic-matching",
    );
    expectNoLeak(error, ["topic-a", "unknown-topic-sentinel"]);
  });

  it("occurred_at requires an explicit timezone and returns the original text", () => {
    const validValues = [
      "2024-02-29T23:59:59Z",
      "2024-02-29T23:59:59.123456+08:00",
      "2026-12-31T18:30:00-05:30",
    ];

    for (const occurredAt of validValues) {
      const response = parseJson("event-analysis", {
        results: [{ ...newEventResult, occurred_at: occurredAt }],
      }) as EventAnalysisResponse;
      expect(response.results[0]?.action).toBe("NEW_EVENT");
      expect(
        response.results[0]?.action === "NEW_EVENT"
          ? response.results[0].occurred_at
          : undefined,
      ).toBe(occurredAt);
    }

    for (const occurredAt of [
      "2024-02-29T23:59:59",
      "2023-02-29T23:59:59Z",
      "2024-02-29T24:00:00Z",
      "2024-02-29T23:59:59+24:00",
      "2024-02-29",
      "not-a-timestamp-sentinel",
    ]) {
      const error = expectOutputError(
        () =>
          parseJson("event-analysis", {
            results: [{ ...newEventResult, occurred_at: occurredAt }],
          }),
        "LLM_OUTPUT_SCHEMA_INVALID",
        "event-analysis",
      );
      expectNoLeak(error, [occurredAt]);
    }

    expect(
      parseJson("event-analysis", {
        results: [{ ...newEventResult, occurred_at: null }],
      }),
    ).toMatchObject({
      results: [{ action: "NEW_EVENT", occurred_at: null }],
    });
  });

  it("parseLlmResponse rejects fenced explained partial and invalid JSON before schema validation", () => {
    const sentinel = "private-model-sentinel";
    const validJson = JSON.stringify(PROCESSING_ROUTE_RESPONSE);
    const invalidContents = [
      `${sentinel}\n${validJson}`,
      `${validJson}\n${sentinel}`,
      `\`\`\`json\n${validJson}\n\`\`\``,
      '{"routes":[',
      "",
      `${validJson},`,
    ];

    for (const content of invalidContents) {
      const error = expectOutputError(
        () => parseUnknown("processing-route", content, {}),
        "LLM_OUTPUT_JSON_INVALID",
        "processing-route",
      );
      expectNoLeak(error, [sentinel, "/private/", "routes"]);
    }

    const schemaError = expectOutputError(
      () => parseUnknown("processing-route", "null", {}),
      "LLM_OUTPUT_SCHEMA_INVALID",
      "processing-route",
    );
    expectNoLeak(schemaError, [sentinel, "/private/", "routes"]);
  });

  it("parseLlmResponse preserves stable first occurrence while deduplicating only allowed arrays", () => {
    expect(
      parseJson("processing-route", {
        routes: ["KNOWLEDGE", "EVENT", "KNOWLEDGE", "EVENT"],
      }),
    ).toEqual({ routes: ["KNOWLEDGE", "EVENT"] });

    const searchResponse = {
      clues: [
        {
          entity_name: "Synthetic Entity",
          subject: "Synthetic subject",
          search_terms: [" term ", "term", " term "],
        },
      ],
    };
    expect(parseJson("event-search", searchResponse)).toEqual(searchResponse);

    expect(
      parseJson(
        "event-analysis",
        {
          results: [
            {
              ...newEventResult,
              confirmed_aliases: ["Alias B", "Alias A", "Alias B", "Alias A"],
            },
          ],
        },
        EVENT_ANALYSIS_REFERENCES,
      ),
    ).toMatchObject({
      results: [{ confirmed_aliases: ["Alias B", "Alias A"] }],
    });
  });

  it("generated output schemas forbid additional properties in every object", () => {
    const expectedObjectCounts: Record<LlmOperation, number> = {
      "processing-route": 1,
      "event-search": 2,
      "event-analysis": 5,
      "knowledge-analysis": 3,
      "topic-matching": 1,
    };

    for (const operation of LLM_OPERATIONS) {
      const schemaText = getOutputJsonSchema(operation);
      expect(schemaText).toBe(getOutputJsonSchema(operation));
      const parsedSchema = JSON.parse(schemaText) as unknown;
      expect(isRecord(parsedSchema)).toBe(true);

      const objectNodes = collectObjectNodes(parsedSchema);
      expect(objectNodes, operation).toHaveLength(
        expectedObjectCounts[operation],
      );
      for (const objectNode of objectNodes) {
        expect(objectNode.additionalProperties, operation).toBe(false);
      }
    }

    const eventSchemaText = getOutputJsonSchema("event-analysis");
    const eventSchema = JSON.parse(eventSchemaText) as Record<string, unknown>;
    const eventActionConstants = collectValuesForKey(eventSchema, "const");
    expect(eventActionConstants).toEqual(
      expect.arrayContaining(["NEW_EVENT", "NEW_UPDATE", "NO_INCREMENT"]),
    );

    const newEventBranch = findBranch(eventSchema, "action", "NEW_EVENT");
    const newUpdateBranch = findBranch(eventSchema, "action", "NEW_UPDATE");
    const noIncrementBranch = findBranch(eventSchema, "action", "NO_INCREMENT");
    const newEventRequired = newEventBranch.required;
    const newUpdateRequired = newUpdateBranch.required;
    const noIncrementRequired = noIncrementBranch.required;

    expect(newEventRequired).toEqual(
      expect.arrayContaining([
        "action",
        "title",
        "entity",
        "subject",
        "scope",
        "description",
        "confirmed_aliases",
      ]),
    );
    expect(newEventRequired).not.toContain("occurred_at");
    expect(newEventBranch).not.toHaveProperty("event_id");
    expect(newUpdateRequired).toEqual(
      expect.arrayContaining([
        "action",
        "event_id",
        "title",
        "description",
        "confirmed_aliases",
      ]),
    );
    expect(newUpdateRequired).not.toContain("occurred_at");
    expect(newUpdateRequired).not.toContain("event_update_id");
    expect(noIncrementRequired).toEqual(
      expect.arrayContaining([
        "action",
        "event_id",
        "event_update_id",
        "confirmed_aliases",
      ]),
    );
    expect(
      containsNullType(getPropertySchema(newEventBranch, "occurred_at")),
    ).toBe(true);

    const knowledgeSchemaText = getOutputJsonSchema("knowledge-analysis");
    const knowledgeSchema = JSON.parse(knowledgeSchemaText) as Record<
      string,
      unknown
    >;
    const knowledgeConstants = collectValuesForKey(knowledgeSchema, "const");
    expect(knowledgeConstants).toEqual(expect.arrayContaining([true, false]));

    const valuableFalseBranch = findBranch(knowledgeSchema, "valuable", false);
    const valuableTrueBranch = findBranch(knowledgeSchema, "valuable", true);
    expect(valuableFalseBranch.required).toEqual(["valuable"]);
    expect(Object.keys(valuableFalseBranch.properties as object)).toEqual([
      "valuable",
    ]);
    expect(valuableTrueBranch.required).toEqual(
      expect.arrayContaining([
        "valuable",
        "title",
        "summary",
        "findings",
        "value",
      ]),
    );
    expect(valuableTrueBranch.required).not.toContain("category");
    expect(
      containsNullType(getPropertySchema(valuableTrueBranch, "category")),
    ).toBe(true);

    const enumArrays = collectValuesForKey(knowledgeSchema, "enum").filter(
      (value): value is unknown[] => Array.isArray(value),
    );
    expect(enumArrays).toContainEqual([
      "Insight",
      "Experience",
      "Method",
      "Resource",
    ]);

    const routeSchema = JSON.parse(
      getOutputJsonSchema("processing-route"),
    ) as Record<string, unknown>;
    const routeEnums = collectValuesForKey(routeSchema, "enum").filter(
      (value): value is unknown[] => Array.isArray(value),
    );
    expect(routeEnums).toContainEqual(["EVENT", "KNOWLEDGE"]);
  });
});
