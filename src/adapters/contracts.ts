import { z } from "zod";

export const adapterReasons = [
  "unsupported_source",
  "invalid_source",
  "unsupported_feed",
  "invalid_feed",
  "blocked_url",
  "dns_failed",
  "network_error",
  "timeout",
  "aborted",
  "http_status",
  "redirect_limit",
  "invalid_redirect",
  "unsupported_mime",
  "unsupported_encoding",
  "response_too_large",
  "feed_too_many_entries",
  "extraction_failed",
  "restricted_content",
  "no_article_url",
] as const;

export type AdapterReason = (typeof adapterReasons)[number];

export interface AdapterSource {
  id: string;
  type: string;
  url: string;
}

export interface AdapterCallOptions {
  signal?: AbortSignal;
}

export interface SourceText {
  value: string;
  format: "TEXT" | "HTML";
}

export interface SourceEntry {
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null;
  full_body: SourceText | null;
  summary: SourceText | null;
}

export interface SourceContent {
  schema_version: 1;
  entry: SourceEntry;
  body: string | null;
  summary: string | null;
  content_kind: "FULL_BODY" | "SUMMARY" | "FRAGMENT" | "NONE";
  acquired_via:
    "SOURCE_FULL_FIELD" | "ARTICLE_EXTRACT" | "SOURCE_FALLBACK" | "NONE";
  completeness_basis:
    "SOURCE_DECLARED" | "ARTICLE_EXTRACTED" | "PARTIAL_ONLY" | "NO_CONTENT";
  article: {
    status: "NOT_REQUESTED" | "SUCCESS" | "FAILED" | "BLOCKED";
    reason: AdapterReason | null;
    final_url: string | null;
  };
}

export interface SourceAdapter {
  fetchEntries(
    source: AdapterSource,
    lastCollectedAt: string | null,
    options?: AdapterCallOptions,
  ): Promise<SourceEntry[]>;
  fetchContent(
    entry: SourceEntry,
    options?: AdapterCallOptions,
  ): Promise<SourceContent>;
}

export function snapshotAdapterSource(source: AdapterSource): AdapterSource {
  const parsed = adapterSourceSchema.parse(source);
  return Object.freeze({ id: parsed.id, type: parsed.type, url: parsed.url });
}

export function snapshotSourceEntry(entry: SourceEntry): SourceEntry {
  const parsed = sourceEntrySchema.parse(entry);
  return Object.freeze({
    source_id: parsed.source_id,
    external_id: parsed.external_id,
    url: parsed.url,
    title: parsed.title,
    author: parsed.author,
    published_at: parsed.published_at,
    full_body:
      parsed.full_body === null
        ? null
        : Object.freeze({
            value: parsed.full_body.value,
            format: parsed.full_body.format,
          }),
    summary:
      parsed.summary === null
        ? null
        : Object.freeze({
            value: parsed.summary.value,
            format: parsed.summary.format,
          }),
  });
}

const nonBlankString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

export const adapterSourceSchema = z
  .object({
    id: nonBlankString,
    type: nonBlankString,
    url: nonBlankString,
  })
  .strict();

export const sourceTextSchema = z
  .object({
    value: nonBlankString,
    format: z.enum(["TEXT", "HTML"]),
  })
  .strict();

export const sourceEntrySchema = z
  .object({
    source_id: nonBlankString,
    external_id: nonBlankString.nullable(),
    url: nonBlankString.nullable(),
    title: nonBlankString.nullable(),
    author: nonBlankString.nullable(),
    published_at: nonBlankString.nullable(),
    full_body: sourceTextSchema.nullable(),
    summary: sourceTextSchema.nullable(),
  })
  .strict();

export const sourceEntriesSchema = z.array(sourceEntrySchema);

export const sourceContentSchema = z
  .object({
    schema_version: z.literal(1),
    entry: sourceEntrySchema,
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
