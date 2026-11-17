import { z } from "zod";

import {
  adapterReasons,
  sourceContentSchema,
  sourceEntrySchema,
  type AdapterReason,
  type SourceContent,
  type SourceEntry,
} from "../adapters/contracts.js";

const schemaVersion = 1 as const;
const nonBlankString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

export interface RawDataSourceItemV1 {
  schema_version: 1;
  entry: SourceEntry;
  content: {
    body: string | null;
    summary: string | null;
    content_kind: SourceContent["content_kind"];
    acquired_via: SourceContent["acquired_via"];
    completeness_basis: SourceContent["completeness_basis"];
    article: SourceContent["article"];
  };
}

const rawContentSchema = z
  .object({
    body: nonBlankString.nullable(),
    summary: nonBlankString.nullable(),
    content_kind: z.enum(["FULL_BODY", "SUMMARY", "FRAGMENT", "NONE"]),
    acquired_via: z.enum([
      "SOURCE_FULL_FIELD",
      "ARTICLE_EXTRACT",
      "SOURCE_FALLBACK",
      "NONE",
    ]),
    completeness_basis: z.enum([
      "SOURCE_DECLARED",
      "ARTICLE_EXTRACTED",
      "PARTIAL_ONLY",
      "NO_CONTENT",
    ]),
    article: z
      .object({
        status: z.enum(["NOT_REQUESTED", "SUCCESS", "FAILED", "BLOCKED"]),
        reason: z.enum(adapterReasons).nullable(),
        final_url: nonBlankString.nullable(),
      })
      .strict(),
  })
  .strict();

export const rawDataSourceItemV1Schema = z
  .object({
    schema_version: z.literal(schemaVersion),
    entry: sourceEntrySchema,
    content: rawContentSchema,
  })
  .strict();

function jsonCompatibilityError(): TypeError {
  return new TypeError("raw_data must be JSON-serializable");
}

function assertJsonCompatible(
  value: unknown,
  ancestors = new WeakSet<object>(),
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw jsonCompatibilityError();
    }
    return;
  }

  if (typeof value !== "object") {
    throw jsonCompatibilityError();
  }

  if (ancestors.has(value)) {
    throw jsonCompatibilityError();
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === "length") {
        continue;
      }
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)) {
        throw jsonCompatibilityError();
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        throw jsonCompatibilityError();
      }
      assertJsonCompatible(descriptor.value, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw jsonCompatibilityError();
  }

  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw jsonCompatibilityError();
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw jsonCompatibilityError();
    }
    assertJsonCompatible(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export function createRawDataSourceItemV1(
  content: SourceContent,
): RawDataSourceItemV1 {
  assertJsonCompatible(content);
  const parsedContent = sourceContentSchema.parse(content);

  const rawData = rawDataSourceItemV1Schema.parse({
    schema_version: schemaVersion,
    entry: parsedContent.entry,
    content: {
      body: parsedContent.body,
      summary: parsedContent.summary,
      content_kind: parsedContent.content_kind,
      acquired_via: parsedContent.acquired_via,
      completeness_basis: parsedContent.completeness_basis,
      article: parsedContent.article,
    },
  });
  assertJsonCompatible(rawData);
  return rawData;
}

export function serializeRawDataSourceItemV1(
  value: RawDataSourceItemV1,
): string {
  assertJsonCompatible(value);
  const parsed = rawDataSourceItemV1Schema.parse(value);
  const text = JSON.stringify(parsed);
  const roundTripped: unknown = JSON.parse(text);
  rawDataSourceItemV1Schema.parse(roundTripped);
  return text;
}

export function parseRawDataSourceItemV1(text: string): RawDataSourceItemV1 {
  const parsed: unknown = JSON.parse(text);
  return rawDataSourceItemV1Schema.parse(parsed);
}

export function createNoneSourceContent(
  entry: SourceEntry,
  reason: Exclude<AdapterReason, "aborted">,
): SourceContent {
  return sourceContentSchema.parse({
    schema_version: schemaVersion,
    entry,
    body: null,
    summary: null,
    content_kind: "NONE",
    acquired_via: "NONE",
    completeness_basis: "NO_CONTENT",
    article: {
      status: "FAILED",
      reason,
      final_url: null,
    },
  });
}
