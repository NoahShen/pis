import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import type {
  AdapterReason,
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import { AdapterError } from "../../src/adapters/errors.js";
import {
  createNoneSourceContent,
  createRawDataSourceItemV1,
  parseRawDataSourceItemV1,
  rawDataSourceItemV1Schema,
  serializeRawDataSourceItemV1,
} from "../../src/collection/raw-data.js";

function createEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: "source-a",
    external_id: "guid-1",
    url: "https://fixture.example/article?edition=daily",
    title: "Fixture title",
    author: "Fixture author",
    published_at: "2026-11-17T09:00:00.000+08:00",
    full_body: { value: "<p>Fixture body</p>", format: "HTML" },
    summary: { value: "Fixture summary", format: "TEXT" },
    ...overrides,
  };
}

function createContent(
  entry = createEntry(),
  overrides: Partial<SourceContent> = {},
): SourceContent {
  return {
    schema_version: 1,
    entry,
    body: "Fixture body",
    summary: "Fixture summary",
    content_kind: "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
    ...overrides,
  };
}

describe("raw_data v1", () => {
  it("constructs the strict envelope, preserves entry/content evidence, and round-trips", () => {
    const content = createContent(createEntry(), {
      body: "Extracted body",
      summary: "Source summary",
      content_kind: "SUMMARY",
      acquired_via: "SOURCE_FALLBACK",
      completeness_basis: "PARTIAL_ONLY",
      article: {
        status: "FAILED",
        reason: "extraction_failed",
        final_url: "https://fixture.example/final?ok=1",
      },
    });

    const rawData = createRawDataSourceItemV1(content);
    expect(rawData).toEqual({
      schema_version: 1,
      entry: content.entry,
      content: {
        body: content.body,
        summary: content.summary,
        content_kind: content.content_kind,
        acquired_via: content.acquired_via,
        completeness_basis: content.completeness_basis,
        article: content.article,
      },
    });

    const text = serializeRawDataSourceItemV1(rawData);
    expect(parseRawDataSourceItemV1(text)).toEqual(rawData);
    expect(
      (JSON.parse(text) as { schema_version: unknown }).schema_version,
    ).toBe(1);
  });

  it("accepts body null and the fixed NONE evidence shape", () => {
    const noneContent = createNoneSourceContent(createEntry(), "network_error");
    const rawData = createRawDataSourceItemV1(noneContent);

    expect(noneContent).toMatchObject({
      body: null,
      summary: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "network_error",
        final_url: null,
      },
    });
    expect(rawData.content).toEqual({
      body: null,
      summary: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "network_error",
        final_url: null,
      },
    });
  });

  it("builds a valid NONE result from a single non-abort AdapterError", () => {
    const failure = new AdapterError("timeout");
    const reason = failure.reason as Exclude<AdapterReason, "aborted">;
    const content = createNoneSourceContent(createEntry(), reason);
    const rawData = createRawDataSourceItemV1(content);

    expect(rawData.content.article).toEqual({
      status: "FAILED",
      reason: "timeout",
      final_url: null,
    });
    expect(rawData.content.body).toBeNull();
    expect(rawData.content.summary).toBeNull();
  });

  it("rejects unknown fields and invalid schema versions at every strict boundary", () => {
    const rawData = createRawDataSourceItemV1(createContent());

    expect(
      rawDataSourceItemV1Schema.safeParse({ ...rawData, extra: true }).success,
    ).toBe(false);
    expect(
      rawDataSourceItemV1Schema.safeParse({
        ...rawData,
        content: { ...rawData.content, extra: true },
      }).success,
    ).toBe(false);
    expect(
      rawDataSourceItemV1Schema.safeParse({
        ...rawData,
        content: {
          ...rawData.content,
          article: { ...rawData.content.article, extra: true },
        },
      }).success,
    ).toBe(false);
    expect(
      rawDataSourceItemV1Schema.safeParse({ ...rawData, schema_version: 2 })
        .success,
    ).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["function", () => "not data"],
    ["symbol", Symbol("not data")],
    ["NaN", Number.NaN],
    ["Buffer", Buffer.from("not data")],
    ["Error", new Error("not data")],
    ["Response", new Response("not data")],
  ])("rejects %s values before serialization", (_label, value) => {
    const invalid = {
      ...createContent(),
      body: value,
    } as unknown as SourceContent;

    expect(() => createRawDataSourceItemV1(invalid)).toThrow(TypeError);
  });

  it("rejects a DOM shape, symbol keys, and cyclic objects", () => {
    const { document } = parseHTML("<main><p>DOM body</p></main>");
    const domContent = {
      ...createContent(),
      body: document.querySelector("main"),
    } as unknown as SourceContent;
    expect(() => createRawDataSourceItemV1(domContent)).toThrow(TypeError);

    const symbolKeyed = Object.assign({}, createContent(), {
      [Symbol("hidden")]: "not allowed",
    }) as unknown as SourceContent;
    expect(() => createRawDataSourceItemV1(symbolKeyed)).toThrow(TypeError);

    const cyclic: Record<string, unknown> = { ...createContent() };
    cyclic.self = cyclic;
    expect(() =>
      createRawDataSourceItemV1(cyclic as unknown as SourceContent),
    ).toThrow(TypeError);
  });
});
