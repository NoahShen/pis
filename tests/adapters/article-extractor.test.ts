import { describe, expect, it } from "vitest";

import {
  extractArticle,
  hasRestrictedContentSignal,
} from "../../src/adapters/article-extractor.js";
import { parseHtmlDocument } from "../../src/adapters/dom-boundary.js";
import { ARTICLE_URL, articleHtml } from "../fixtures/rss-content.js";

describe("linkedom + Readability article extraction", () => {
  it("extracts real multi-paragraph content and removes navigation/scripts", () => {
    const extracted = extractArticle(articleHtml(), ARTICLE_URL, 80);
    expect(extracted.restricted).toBe(false);
    expect(extracted.text).toContain("Fixture story");
    expect(extracted.text).toContain("A complete paragraph");
    expect(extracted.text).toContain("A second paragraph");
    expect(extracted.text).not.toContain("Navigation links");
    expect(extracted.text).not.toContain("globalThis.mutated");
    expect((globalThis as { mutated?: boolean }).mutated).toBeUndefined();
  });

  it("enforces code-point length and rejects null/short extraction", () => {
    expect(
      extractArticle(articleHtml({ short: true }), ARTICLE_URL, 80),
    ).toEqual({ restricted: false, text: null });
    const emoji = `<html><body><article><h1>Title</h1><p>${"😀".repeat(81)}</p></article></body></html>`;
    expect(extractArticle(emoji, ARTICLE_URL, 80).text).toContain("😀");
  });

  it("rejects null Readability output and a non-DOM parser boundary", () => {
    expect(
      extractArticle(articleHtml({ unreadable: true }), ARTICLE_URL, 80),
    ).toEqual({ restricted: false, text: null });
    expect(() => parseHtmlDocument("<p>text</p>")).not.toThrow();
  });

  it("detects JSON-LD object, graph item and DOM itemprop restrictions before script removal", () => {
    expect(hasRestrictedContentSignal(articleHtml({ restricted: true }))).toBe(
      true,
    );
    expect(
      hasRestrictedContentSignal(
        articleHtml({ restricted: true, signal: "itemprop" }),
      ),
    ).toBe(true);
    expect(
      extractArticle(articleHtml({ restricted: true }), ARTICLE_URL, 80),
    ).toMatchObject({ restricted: true });
    expect(
      extractArticle(
        articleHtml({ restricted: true, signal: "invalid" }),
        ARTICLE_URL,
        80,
      ),
    ).toMatchObject({ restricted: false });
  });
});
