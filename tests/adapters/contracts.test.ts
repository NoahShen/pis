import { describe, expect, it } from "vitest";

import {
  adapterReasons,
  adapterSourceSchema,
  sourceContentSchema,
  sourceEntrySchema,
  sourceTextSchema,
  type AdapterReason,
  type AdapterSource,
  type SourceAdapter,
  type SourceEntry,
} from "../../src/adapters/contracts.js";
import {
  DEFAULT_ADAPTER_POLICY,
  parseAdapterPolicy,
} from "../../src/adapters/options.js";
import { AdapterError } from "../../src/adapters/errors.js";
import { AcquisitionError } from "../../src/adapters/transport.js";

const entry: SourceEntry = {
  source_id: "source-1",
  external_id: "guid-1",
  url: "https://example.test/article",
  title: "Title",
  author: "Author",
  published_at: "2026-01-01T08:00:00.000+08:00",
  full_body: { value: "<p>body</p>", format: "HTML" },
  summary: { value: "summary", format: "TEXT" },
};

const content = {
  schema_version: 1 as const,
  entry,
  body: "<p>body</p>",
  summary: "summary",
  content_kind: "FULL_BODY" as const,
  acquired_via: "SOURCE_FULL_FIELD" as const,
  completeness_basis: "SOURCE_DECLARED" as const,
  article: {
    status: "NOT_REQUESTED" as const,
    reason: null,
    final_url: null,
  },
};

describe("adapter contracts", () => {
  it("accepts valid source, entry, text and content values", () => {
    expect(
      adapterSourceSchema.parse({
        id: "source-1",
        type: "RSS",
        url: "https://example.test/feed.xml",
      }),
    ).toEqual({
      id: "source-1",
      type: "RSS",
      url: "https://example.test/feed.xml",
    });
    expect(sourceTextSchema.parse({ value: "x", format: "TEXT" })).toEqual({
      value: "x",
      format: "TEXT",
    });
    expect(sourceEntrySchema.parse(entry)).toEqual(entry);
    expect(sourceContentSchema.parse(content)).toEqual(content);
  });

  it("rejects unknown fields, undefined, blank values and invalid enums", () => {
    expect(() => sourceEntrySchema.parse({ ...entry, extra: true })).toThrow();
    expect(() =>
      sourceEntrySchema.parse({ ...entry, title: undefined }),
    ).toThrow();
    expect(() =>
      sourceTextSchema.parse({ value: " ", format: "TEXT" }),
    ).toThrow();
    expect(() =>
      sourceContentSchema.parse({
        ...content,
        article: { ...content.article, reason: "unknown" },
      }),
    ).toThrow();
    expect(() =>
      sourceContentSchema.parse({ ...content, schema_version: 2 }),
    ).toThrow();
    expect(sourceContentSchema.parse(content)).not.toBe(content);
  });

  it("round-trips through JSON without undefined, NaN or cycles", () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(content));
    expect(sourceContentSchema.parse(roundTripped)).toEqual(content);
    expect(JSON.stringify(content)).not.toContain("undefined");
    expect(JSON.stringify(content)).not.toContain("NaN");
  });

  it("is consumable through a synthetic non-RSS SourceAdapter", async () => {
    const adapter: SourceAdapter = {
      async fetchEntries(source: AdapterSource): Promise<SourceEntry[]> {
        return [{ ...entry, source_id: source.id }];
      },
      async fetchContent(): Promise<typeof content> {
        return content;
      },
    };
    const source = {
      id: "generic-source",
      type: "SYNTHETIC",
      url: "https://example.test/feed",
    };
    expect(await adapter.fetchEntries(source, null)).toEqual([
      { ...entry, source_id: source.id },
    ]);
    expect(await adapter.fetchContent(entry)).toEqual(content);
  });
});

describe("adapter policy", () => {
  it("freezes all six exact defaults", () => {
    expect(DEFAULT_ADAPTER_POLICY).toEqual({
      requestTimeoutMs: 15_000,
      maxRedirects: 3,
      feedMaxBytes: 2_097_152,
      articleMaxBytes: 5_242_880,
      maxFeedEntries: 1_000,
      articleMinTextChars: 80,
    });
    expect(Object.isFrozen(DEFAULT_ADAPTER_POLICY)).toBe(true);
  });

  it.each([
    ["requestTimeoutMs", 99],
    ["requestTimeoutMs", 120_001],
    ["maxRedirects", -1],
    ["maxRedirects", 6],
    ["feedMaxBytes", 1_023],
    ["feedMaxBytes", 8_388_609],
    ["articleMaxBytes", 1_023],
    ["articleMaxBytes", 16_777_217],
    ["maxFeedEntries", 0],
    ["maxFeedEntries", 10_001],
    ["articleMinTextChars", 0],
    ["articleMinTextChars", 1_001],
  ])("rejects out-of-range %s=%s", (key, value) => {
    expect(() => parseAdapterPolicy({ [key]: value })).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, "1000", null, true])(
    "rejects non-integer policy value %j",
    (value) => {
      expect(() => parseAdapterPolicy({ maxFeedEntries: value })).toThrow();
    },
  );

  it("rejects unknown keys and preserves explicit boundaries", () => {
    expect(() => parseAdapterPolicy({ unknown: 1 })).toThrow();
    expect(
      parseAdapterPolicy({
        requestTimeoutMs: 100,
        maxRedirects: 0,
        feedMaxBytes: 1_024,
        articleMaxBytes: 1_024,
        maxFeedEntries: 1,
        articleMinTextChars: 1,
      }),
    ).toEqual({
      requestTimeoutMs: 100,
      maxRedirects: 0,
      feedMaxBytes: 1_024,
      articleMaxBytes: 1_024,
      maxFeedEntries: 1,
      articleMinTextChars: 1,
    });
  });
});

describe("adapter errors", () => {
  it("contains exactly the 19 fixed reasons", () => {
    expect(adapterReasons).toEqual([
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
    ]);
  });

  it.each(adapterReasons)(
    "uses a fixed safe message for %s",
    (reason: AdapterReason) => {
      const error = new AdapterError(reason);
      expect(error.name).toBe("AdapterError");
      expect(error.reason).toBe(reason);
      expect(error.message).not.toContain("http");
      expect(error).not.toHaveProperty("cause");
    },
  );

  it("requires a final URL when an acquisition received a response", () => {
    const error = new AcquisitionError(
      "http_status",
      true,
      "https://example.test/",
    );
    expect(error.reason).toBe("http_status");
    expect(error.receivedResponse).toBe(true);
    expect(error.finalUrl).toBe("https://example.test/");
    expect(() => new AcquisitionError("http_status", true, null)).toThrow(
      RangeError,
    );
  });
});
