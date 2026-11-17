import { describe, expect, it } from "vitest";

import type { SourceEntry } from "../../src/adapters/contracts.js";
import {
  deduplicateSourceEntries,
  filterValidSourceEntries,
  getSourceItemIdentity,
  isObviousInvalidSourceEntry,
} from "../../src/collection/source-item-identity.js";

function createEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: "source-a",
    external_id: null,
    url: "https://fixture.example/items/default",
    title: "Default title",
    author: null,
    published_at: "2026-11-17T09:00:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

describe("Source Item identity", () => {
  it("COL-02/COL-17 uses only source and external_id when external_id exists", () => {
    const first = createEntry({
      external_id: "guid-1",
      url: "https://fixture.example/first",
      title: "First title",
      published_at: "2026-11-17T09:00:00.000+08:00",
    });
    const republished = createEntry({
      external_id: "guid-1",
      url: "https://fixture.example/changed",
      title: "Changed title",
      published_at: "2026-11-18T12:00:00.000+08:00",
    });

    expect(getSourceItemIdentity(first)).toEqual({
      kind: "external_id",
      source_id: "source-a",
      external_id: "guid-1",
    });
    expect(deduplicateSourceEntries([first, republished])).toEqual([first]);
  });

  it("COL-03/COL-04/COL-18 uses source, URL and exact published_at fallback", () => {
    const original = createEntry({
      url: "https://fixture.example/flexible",
      published_at: "2026-11-17T09:00:00.000+08:00",
    });
    const sameTime = createEntry({
      url: original.url,
      title: "Changed title",
      published_at: original.published_at,
    });
    const differentTime = createEntry({
      url: original.url,
      published_at: "2026-11-17T10:00:00.000+08:00",
    });
    const nullTime = createEntry({
      url: "https://fixture.example/undated",
      published_at: null,
    });
    const duplicateNullTime = createEntry({
      url: nullTime.url,
      title: "Changed undated title",
      published_at: null,
    });

    expect(getSourceItemIdentity(original)).toEqual({
      kind: "url_published_at",
      source_id: "source-a",
      url: original.url,
      published_at: original.published_at,
    });
    expect(deduplicateSourceEntries([original, sameTime])).toEqual([original]);
    expect(deduplicateSourceEntries([original, differentTime])).toEqual([
      original,
      differentTime,
    ]);
    expect(deduplicateSourceEntries([nullTime, duplicateNullTime])).toEqual([
      nullTime,
    ]);
  });

  it("COL-05 does not deduplicate identities across Sources", () => {
    const sourceA = createEntry({
      source_id: "source-a",
      external_id: "shared-guid",
      url: "https://fixture.example/shared",
    });
    const sourceB = createEntry({
      source_id: "source-b",
      external_id: "shared-guid",
      url: "https://fixture.example/shared",
    });
    const sourceAUrlOnly = createEntry({
      source_id: "source-a",
      url: "https://fixture.example/url-only",
    });
    const sourceBUrlOnly = createEntry({
      source_id: "source-b",
      url: "https://fixture.example/url-only",
    });

    expect(
      deduplicateSourceEntries([
        sourceA,
        sourceB,
        sourceAUrlOnly,
        sourceBUrlOnly,
      ]),
    ).toEqual([sourceA, sourceB, sourceAUrlOnly, sourceBUrlOnly]);
  });

  it("COL-07 keeps the first duplicate and preserves distinct input order", () => {
    const firstExternal = createEntry({ external_id: "guid-1" });
    const firstUrl = createEntry({
      url: "https://fixture.example/url-1",
      published_at: null,
    });
    const titleOnly = createEntry({
      external_id: null,
      url: null,
      title: "Title-only entry",
    });
    const duplicateExternal = createEntry({
      external_id: "guid-1",
      url: "https://fixture.example/changed",
      published_at: "2026-11-18T09:00:00.000+08:00",
    });
    const duplicateUrl = createEntry({
      url: firstUrl.url,
      published_at: null,
      title: "Changed URL fallback title",
    });
    const input = [
      firstExternal,
      firstUrl,
      titleOnly,
      duplicateExternal,
      duplicateUrl,
    ] as const;
    const snapshot = [...input];

    expect(deduplicateSourceEntries(input)).toEqual([
      firstExternal,
      firstUrl,
      titleOnly,
    ]);
    expect(input).toEqual(snapshot);
  });

  it("COL-13 skips completely empty metadata but accepts title-only entries", () => {
    const invalid = createEntry({
      external_id: null,
      url: null,
      title: null,
    });
    const titleOnlyFirst = createEntry({
      external_id: null,
      url: null,
      title: "First title-only entry",
    });
    const titleOnlySecond = createEntry({
      external_id: null,
      url: null,
      title: "Second title-only entry",
    });

    expect(isObviousInvalidSourceEntry(invalid)).toBe(true);
    expect(isObviousInvalidSourceEntry(titleOnlyFirst)).toBe(false);
    expect(filterValidSourceEntries([invalid, titleOnlyFirst])).toEqual([
      titleOnlyFirst,
    ]);
    expect(
      deduplicateSourceEntries(
        filterValidSourceEntries([invalid, titleOnlyFirst, titleOnlySecond]),
      ),
    ).toEqual([titleOnlyFirst, titleOnlySecond]);
  });
});
