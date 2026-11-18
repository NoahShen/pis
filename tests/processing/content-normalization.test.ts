import { describe, expect, it } from "vitest";

import {
  cleanHtmlValue,
  normalizeCleanText,
} from "../../src/adapters/content-cleaning.js";
import type {
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import {
  createRawDataSourceItemV1,
  serializeRawDataSourceItemV1,
} from "../../src/collection/raw-data.js";
import {
  normalizeRawDataSourceItem,
  type NormalizationResult,
  type NormalizedContentDraft,
} from "../../src/processing/content-normalization.js";

function createEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: "source-a",
    external_id: "guid-1",
    url: "https://fixture.example/article",
    title: "Fixture title",
    author: "Fixture author",
    published_at: "2026-11-18T09:00:00.000+08:00",
    full_body: { value: "<p>Original fixture body</p>", format: "HTML" },
    summary: { value: "Original fixture summary", format: "TEXT" },
    ...overrides,
  };
}

interface ContentOverrides {
  entry?: SourceEntry;
  body?: string | null;
  summary?: string | null;
  content_kind?: SourceContent["content_kind"];
}

function createContent(overrides: ContentOverrides = {}): SourceContent {
  return {
    schema_version: 1,
    entry: overrides.entry ?? createEntry(),
    body: overrides.body === undefined ? "Fixture body" : overrides.body,
    summary:
      overrides.summary === undefined ? "Fixture summary" : overrides.summary,
    content_kind: overrides.content_kind ?? "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
  };
}

function createRawText(content: SourceContent = createContent()): string {
  return serializeRawDataSourceItemV1(createRawDataSourceItemV1(content));
}

function expectUsable(result: NormalizationResult): NormalizedContentDraft {
  expect(result.usable).toBe(true);
  if (!result.usable) {
    throw new Error("Expected a usable normalization result");
  }
  return result.content;
}

function expectReason(
  result: NormalizationResult,
): Extract<NormalizationResult, { usable: false }>["reason"] {
  expect(result.usable).toBe(false);
  if (result.usable) {
    throw new Error("Expected an unusable normalization result");
  }
  return result.reason;
}

describe("normalizeRawDataSourceItem", () => {
  it("PRO-01 preserves full-body text and order with FULL completeness", () => {
    const content = expectUsable(
      normalizeRawDataSourceItem(
        createRawText(
          createContent({
            body: "  First paragraph\r\n\r\nSecond\tparagraph\nThird paragraph  ",
          }),
        ),
      ),
    );

    expect(content).toEqual({
      title: "Fixture title",
      url: "https://fixture.example/article",
      author: "Fixture author",
      published_at: "2026-11-18T09:00:00.000+08:00",
      body: "First paragraph\nSecond paragraph\nThird paragraph",
      summary: "Fixture summary",
      language: null,
      completeness: "FULL",
    });
  });

  it.each([
    ["SUMMARY", "Summary-backed body", "Summary metadata"],
    ["FRAGMENT", "  Fragment body\r\nsecond line  ", null],
  ] as const)(
    "PRO-02 maps %s content with a body to PARTIAL",
    (contentKind, body, summary) => {
      const content = expectUsable(
        normalizeRawDataSourceItem(
          createRawText(
            createContent({
              content_kind: contentKind,
              body,
              summary,
            }),
          ),
        ),
      );

      expect(content.completeness).toBe("PARTIAL");
      expect(content.body).toBe(normalizeCleanText(body));
      expect(content.summary).toBe(
        summary === null ? null : normalizeCleanText(summary),
      );
    },
  );

  it("PRO-02 uses only the actual summary as body when a partial item has no body", () => {
    const summary = "  Only the acquired summary <kept>  ";
    const content = expectUsable(
      normalizeRawDataSourceItem(
        createRawText(
          createContent({
            content_kind: "SUMMARY",
            body: null,
            summary,
          }),
        ),
      ),
    );

    expect(content.completeness).toBe("PARTIAL");
    expect(content.body).toBe("Only the acquired summary <kept>");
    expect(content.summary).toBe("Only the acquired summary <kept>");
  });

  it("PRO-03 maps NONE content to content_unavailable without leaking details", () => {
    const result = normalizeRawDataSourceItem(
      createRawText(
        createContent({
          content_kind: "NONE",
          body: "Evidence that must not be used",
          summary: "Summary that must not be used",
        }),
      ),
    );

    expect(result).toEqual({
      usable: false,
      reason: "content_unavailable",
    });
  });

  it("PRO-03 maps malformed JSON to a safe raw_data_invalid reason", () => {
    const result = normalizeRawDataSourceItem('{"schema_version":1');

    expect(result).toEqual({
      usable: false,
      reason: "raw_data_invalid",
    });
  });

  it("PRO-03 rejects strict-schema violations with raw_data_invalid", () => {
    const rawData = createRawDataSourceItemV1(createContent());
    const invalidRawData = JSON.stringify({ ...rawData, unexpected: true });
    const result = normalizeRawDataSourceItem(invalidRawData);

    expect(result).toEqual({
      usable: false,
      reason: "raw_data_invalid",
    });
  });

  it("PRO-03 maps a missing title to title_missing", () => {
    const result = normalizeRawDataSourceItem(
      createRawText(createContent({ entry: createEntry({ title: null }) })),
    );

    expect(result).toEqual({
      usable: false,
      reason: "title_missing",
    });
  });

  it("PRO-03 maps empty body and summary to content_unavailable", () => {
    const result = normalizeRawDataSourceItem(
      createRawText(
        createContent({
          content_kind: "FRAGMENT",
          body: null,
          summary: null,
        }),
      ),
    );

    expect(result).toEqual({
      usable: false,
      reason: "content_unavailable",
    });
  });

  it("PRO-11 preserves sentinel angle brackets, Unicode, and emoji while normalizing whitespace", () => {
    const rawBody =
      "  alpha <algorithm>  \r\n\r\nList<T>\tand <Foo/> 😀 中文  \n\n  final  ";
    const content = expectUsable(
      normalizeRawDataSourceItem(
        createRawText(
          createContent({
            entry: createEntry({ title: "  Title <T>\r\n " }),
            body: rawBody,
          }),
        ),
      ),
    );

    expect(content.title).toBe("Title <T>");
    expect(content.body).toBe(
      "alpha <algorithm>\nList<T> and <Foo/> 😀 中文\nfinal",
    );
    expect(content.body).toBe(normalizeCleanText(rawBody));
    expect(content.body).toContain("<algorithm>");
    expect(content.body).toContain("List<T>");
    expect(content.body).toContain("<Foo/>");
  });

  it("PRO-11 negative control proves HTML cleaning loses sentinel text", () => {
    const sentinelText =
      "alpha <algorithm> List<T> and <Foo/> remain literal text";
    const cleanedAsHtml = cleanHtmlValue(sentinelText);

    expect(cleanedAsHtml).not.toBe(sentinelText);
    expect(cleanedAsHtml).not.toContain("<algorithm>");
    expect(cleanedAsHtml).not.toContain("List<T>");
    expect(cleanedAsHtml).not.toContain("<Foo/>");
  });

  it("PRO-12 keeps PARTIAL completeness and routing-ready body/summary for summary-only content", () => {
    const content = expectUsable(
      normalizeRawDataSourceItem(
        createRawText(
          createContent({
            content_kind: "SUMMARY",
            body: null,
            summary: "Source-provided summary",
          }),
        ),
      ),
    );

    expect(content).toMatchObject({
      body: "Source-provided summary",
      summary: "Source-provided summary",
      completeness: "PARTIAL",
    });
  });

  it("keeps missing url, author, and published_at as null", () => {
    const content = expectUsable(
      normalizeRawDataSourceItem(
        createRawText(
          createContent({
            entry: createEntry({
              url: null,
              author: null,
              published_at: null,
            }),
          }),
        ),
      ),
    );

    expect(content.url).toBeNull();
    expect(content.author).toBeNull();
    expect(content.published_at).toBeNull();
  });

  it("accepts a D05 v1 serialized round-trip sample", () => {
    const rawData = createRawDataSourceItemV1(createContent());
    const roundTripped = serializeRawDataSourceItemV1(rawData);
    const content = expectUsable(normalizeRawDataSourceItem(roundTripped));

    expect(content.title).toBe(rawData.entry.title);
    expect(content.body).toBe(rawData.content.body);
    expect(content.summary).toBe(rawData.content.summary);
  });

  it("returns deterministic, independent output objects for identical input", () => {
    const rawData = createRawText();
    const first = expectUsable(normalizeRawDataSourceItem(rawData));
    const second = expectUsable(normalizeRawDataSourceItem(rawData));

    expect(second).toEqual(first);
    expect(second).not.toBe(first);

    Object.assign(first, { title: "Mutation isolated to first result" });
    expect(second.title).toBe("Fixture title");
  });

  it("does not throw or expose parser details for invalid input", () => {
    let result: NormalizationResult | undefined;

    expect(() => {
      result = normalizeRawDataSourceItem("not json");
    }).not.toThrow();
    expect(result).toEqual({
      usable: false,
      reason: "raw_data_invalid",
    });
    expect(expectReason(result as NormalizationResult)).toBe(
      "raw_data_invalid",
    );
  });
});
