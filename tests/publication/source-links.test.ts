import { describe, expect, it } from "vitest";

import {
  appendSourceLinks,
  collectSourceLinks,
  normalizeHttpUrl,
} from "../../src/publication/source-links.js";

describe("publication source links", () => {
  it("PUB-06_NORMALIZE_DEDUPE normalizes equivalently, deduplicates, and preserves first order", () => {
    const first = normalizeHttpUrl("  HTTPS://Example.TEST:443/a/../b  ");
    const second = normalizeHttpUrl("https://example.test/b");
    const third = normalizeHttpUrl("https://example.test/second");
    const urls = Object.freeze([
      "  HTTPS://Example.TEST:443/a/../b  ",
      "https://example.test/b",
      "not a url",
      "https://example.test/second",
      "https://example.test/b",
    ]);
    const before = [...urls];

    expect(first).toBe("https://example.test/b");
    expect(second).toBe(first);
    expect(third).toBe("https://example.test/second");
    expect(collectSourceLinks(urls, 5)).toEqual([
      "https://example.test/b",
      "https://example.test/second",
    ]);
    expect(collectSourceLinks(urls, 1)).toEqual(["https://example.test/b"]);
    expect(urls).toEqual(before);

    for (const max of [0, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => collectSourceLinks(urls, max)).toThrow(RangeError);
    }
  });

  it("PUB-06_APPEND appends one source section with one escaped link per item", () => {
    const body = "<p>Existing body</p>";
    const links = ["https://example.test/one", "https://example.test/two?x=1"];
    const result = appendSourceLinks(body, links);

    expect(result).toBe(
      `${body}<section><h2>来源</h2><ul>` +
        '<li><a href="https://example.test/one">https://example.test/one</a></li>' +
        '<li><a href="https://example.test/two?x=1">https://example.test/two?x=1</a></li>' +
        "</ul></section>",
    );
    expect(result.match(/<section>/g)).toHaveLength(1);
    expect(result.match(/<li>/g)).toHaveLength(2);
    expect(result.match(/<a /g)).toHaveLength(2);
  });

  it("PUB-07_EMPTY leaves the body byte-for-byte unchanged without a source section", () => {
    const body = "<section>\n<p>Body remains unchanged.</p>\n</section>";

    expect(appendSourceLinks(body, [])).toBe(body);
    expect(appendSourceLinks(body, [])).not.toContain("来源");
    expect(collectSourceLinks([], 5)).toEqual([]);
  });

  it("PUB-08_PROTOCOLS rejects non-http(s), relative, and malformed URLs", () => {
    const invalid = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///tmp/synthetic.txt",
      "ftp://example.test/file",
      "/relative/path",
      "//example.test/path",
      "https://",
    ];

    for (const value of invalid) {
      expect(normalizeHttpUrl(value)).toBeNull();
    }
    expect(collectSourceLinks(invalid, 20)).toEqual([]);
  });

  it("PUB-08_USERINFO_CONTROL rejects userinfo, malformed hosts, and control characters", () => {
    const invalid = [
      "https://user@example.test/path",
      "https://user:password@example.test/path",
      "https://",
      "https://example.test/path\u0000tail",
      "https://example.test/path\u001ftail",
      "https://example.test/path\ntail",
      "https://example.test/path\rtail",
      "https://example.test/path\ttail",
      "https://example.test/path\u007ftail",
    ];

    for (const value of invalid) {
      expect(normalizeHttpUrl(value)).toBeNull();
    }
    expect(normalizeHttpUrl("  https://example.test/path  ")).toBe(
      "https://example.test/path",
    );
    expect(normalizeHttpUrl(42)).toBeNull();
    expect(normalizeHttpUrl(null)).toBeNull();
    expect(normalizeHttpUrl(undefined)).toBeNull();
  });

  it("PUB-08_NO_BLOCK drops every bad link without failing or adding a block", () => {
    const body = "<p>Publishable body</p>";
    const links = collectSourceLinks(
      ["javascript:alert(1)", "https://user:secret@example.test/private", ""],
      5,
    );

    expect(Array.isArray(links)).toBe(true);
    expect(links).toEqual([]);
    expect(appendSourceLinks(body, links)).toBe(body);
    expect(appendSourceLinks(body, links)).not.toContain("<section>");
  });

  it("PUB-13_URL_ESCAPE safely encodes href and link text without attribute injection", () => {
    const body = "<p>Body</p>";
    const link =
      "https://escape.example.test/a?x=<tag>&q=\"quoted\"&apos='single'&next=two";
    const escaped =
      "https://escape.example.test/a?x=&lt;tag&gt;&amp;q=&quot;quoted&quot;&amp;apos=&#39;single&#39;&amp;next=two";
    const result = appendSourceLinks(body, [link]);

    expect(result).toBe(
      `${body}<section><h2>来源</h2><ul><li><a href="${escaped}">${escaped}</a></li></ul></section>`,
    );
    expect(result).not.toContain('q="quoted"');
    expect(result).not.toContain("<tag>");
    expect(result).toContain("&quot;");
    expect(result).toContain("&lt;tag&gt;");
    expect(result).toContain("&amp;");
  });
});
