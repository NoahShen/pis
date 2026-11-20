import { describe, expect, it } from "vitest";

import { extractPublishedItemSourceLink } from "../../src/rss/index.js";
import { RSS_SOURCE_URLS, sourceSection } from "../fixtures/rss.js";

describe("Published Item source link extraction", () => {
  it("RSS-06/07_SOURCE_SECTION uses only the D11 source section and its first valid anchor", () => {
    const body = [
      '<p><a href="https://body.example.test/not-source">Body link</a></p>',
      sourceSection(RSS_SOURCE_URLS.first),
    ].join("");

    expect(extractPublishedItemSourceLink(body)).toBe(RSS_SOURCE_URLS.first);
  });

  it("decodes HTML entities before applying the D11 HTTP(S) normalization", () => {
    const body = sourceSection("https://source.example.test/entity?a=1&b=2");

    expect(extractPublishedItemSourceLink(body)).toBe(
      "https://source.example.test/entity?a=1&b=2",
    );
  });

  it("skips invalid anchors in document order and returns the first valid HTTP(S) URL", () => {
    const body = sourceSection(
      "javascript:alert(1)",
      "https://user:secret@source.example.test/private",
      "/relative/source",
      "  https://source.example.test/valid  ",
      RSS_SOURCE_URLS.second,
    );

    expect(extractPublishedItemSourceLink(body)).toBe(
      "https://source.example.test/valid",
    );
  });

  it("ignores links outside a source section and h2 elements not directly in a section", () => {
    const bodies = [
      '<p><a href="https://body.example.test/only">Only body link</a></p>',
      `<section><h2>其他来源</h2><a href="${RSS_SOURCE_URLS.first}">no</a></section>`,
      `<section><div><h2>来源</h2></div><a href="${RSS_SOURCE_URLS.first}">no</a></section>`,
      `<section><h2>来源证据</h2><a href="${RSS_SOURCE_URLS.first}">no</a></section>`,
    ];

    for (const body of bodies) {
      expect(extractPublishedItemSourceLink(body)).toBeNull();
    }
    expect(
      extractPublishedItemSourceLink("<p>No source section</p>"),
    ).toBeNull();
    expect(extractPublishedItemSourceLink("")).toBeNull();
  });

  it("RSS-07_SNAPSHOT keeps a stable source result when unrelated body evidence differs", () => {
    const source = sourceSection(RSS_SOURCE_URLS.second);
    const firstSnapshot = [
      '<p><a href="https://old.example.test/evidence">Old evidence</a></p>',
      source,
    ].join("");
    const secondSnapshot = [
      '<p><a href="https://new.example.test/evidence">New evidence</a></p>',
      source,
    ].join("");

    const first = extractPublishedItemSourceLink(firstSnapshot);
    const repeated = extractPublishedItemSourceLink(firstSnapshot);
    const laterEvidence = extractPublishedItemSourceLink(secondSnapshot);

    expect(first).toBe(RSS_SOURCE_URLS.second);
    expect(repeated).toBe(first);
    expect(laterEvidence).toBe(first);
  });
});
