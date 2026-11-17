import { describe, expect, it } from "vitest";

import { AdapterError } from "../../src/adapters/errors.js";
import { DEFAULT_ADAPTER_POLICY } from "../../src/adapters/options.js";
import { parseFeedEntries } from "../../src/adapters/rss/feed-parser.js";
import { atomFeed, RSS_FIXTURE_URL, rssFeed } from "../fixtures/rss-list.js";

function parse(xml: string, maxFeedEntries = 1_000) {
  return parseFeedEntries(xml, {
    finalUrl: RSS_FIXTURE_URL,
    policy: { ...DEFAULT_ADAPTER_POLICY, maxFeedEntries },
    sourceId: "source-1",
  });
}

function expectReason(call: () => unknown, reason: string): void {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected AdapterError(${reason})`);
}

describe("RSS 2.0 mapping", () => {
  it("maps identity, metadata, content, summary and author in document order", () => {
    const xml = rssFeed(`
      <item>
        <guid isPermaLink="false">  Case-Sensitive-GUID  </guid>
        <link>/first</link>
        <title>  First &amp; Best  </title>
        <author>alice@example.test</author>
        <dc:creator>bob</dc:creator>
        <pubDate>Sun, 15 Jun 2025 04:05:06 +0000</pubDate>
        <content:encoded><![CDATA[<p>Full &amp; body</p>]]></content:encoded>
        <description><![CDATA[<p>Summary</p>]]></description>
        <media:description>media summary</media:description>
      </item>
    `);
    expect(parse(xml)).toEqual([
      {
        source_id: "source-1",
        external_id: "Case-Sensitive-GUID",
        url: "https://feeds.example.test/first",
        title: "First & Best",
        author: "alice@example.test",
        published_at: "2025-06-15T12:05:06.000+08:00",
        full_body: { value: "<p>Full &amp; body</p>", format: "HTML" },
        summary: { value: "<p>Summary</p>", format: "HTML" },
      },
    ]);
  });

  it("uses dc:creator when RSS author is missing and dc:date only when pubDate is missing", () => {
    const xml = rssFeed(`
      <item><guid>id-1</guid><dc:creator>creator</dc:creator><dc:date>Sun, 15 Jun 2025 04:05:06 GMT</dc:date></item>
      <item><guid>id-2</guid><pubDate>not a date</pubDate><dc:date>Sun, 15 Jun 2025 04:05:06 GMT</dc:date></item>
    `);
    const entries = parse(xml);
    expect(entries[0]).toMatchObject({
      author: "creator",
      published_at: "2025-06-15T12:05:06.000+08:00",
    });
    expect(entries[1]?.published_at).toBeNull();
  });

  it("honors GUID permalink semantics and skips entries without either identity", () => {
    const xml = rssFeed(`
      <item><guid isPermaLink="true">/permalink</guid><title>yes</title></item>
      <item><guid isPermaLink="false">opaque-id</guid><link>relative</link></item>
      <item><guid isPermaLink="false">opaque-only</guid></item>
      <item><guid>https://other.example.test/item</guid></item>
      <item><title>no identity</title></item>
    `);
    const entries = parse(xml, 10);
    expect(entries).toHaveLength(4);
    expect(entries[0]?.url).toBe("https://feeds.example.test/permalink");
    expect(entries[1]?.url).toBe("https://feeds.example.test/relative");
    expect(entries[2]).toMatchObject({ external_id: "opaque-only", url: null });
    expect(entries[3]).toMatchObject({
      external_id: "https://other.example.test/item",
      url: "https://other.example.test/item",
      published_at: null,
    });
  });

  it("keeps first non-empty values and summary media fallback", () => {
    const xml = rssFeed(`
      <item>
        <guid>id</guid>
        <title></title><title> second title </title>
        <description> </description>
        <media:description>media title</media:description>
        <content:encoded></content:encoded>
        <content:encoded>second content</content:encoded>
      </item>
    `);
    expect(parse(xml)[0]).toMatchObject({
      title: "second title",
      summary: { value: "media title", format: "HTML" },
      full_body: { value: "second content", format: "HTML" },
    });
  });

  it("skips blank repeated GUID and date nodes but keeps an invalid first nonblank pubDate authoritative", () => {
    const entries = parse(
      rssFeed(`
        <item>
          <guid> </guid><guid>selected-id</guid>
          <pubDate> </pubDate><pubDate>Sun, 15 Jun 2025 04:05:06 GMT</pubDate>
        </item>
        <item>
          <guid>invalid-pubdate</guid>
          <pubDate> </pubDate><pubDate>not a date</pubDate>
          <dc:date>Mon, 16 Jun 2025 04:05:06 GMT</dc:date>
        </item>
        <item>
          <guid>fallback-dc-date</guid>
          <dc:date> </dc:date><dc:date>Tue, 17 Jun 2025 04:05:06 GMT</dc:date>
        </item>
      `),
    );
    expect(entries.map((entry) => entry.external_id)).toEqual([
      "selected-id",
      "invalid-pubdate",
      "fallback-dc-date",
    ]);
    expect(entries.map((entry) => entry.published_at)).toEqual([
      "2025-06-15T12:05:06.000+08:00",
      null,
      "2025-06-17T12:05:06.000+08:00",
    ]);
  });

  it("returns a legal empty list and preserves source order and duplicate GUIDs", () => {
    expect(parse(rssFeed(""))).toEqual([]);
    const entries = parse(
      rssFeed(
        "<item><guid>dup</guid></item><item><guid>other</guid></item><item><guid>dup</guid></item>",
      ),
    );
    expect(entries.map((entry) => entry.external_id)).toEqual([
      "dup",
      "other",
      "dup",
    ]);
  });
});

describe("Atom 1.0 mapping", () => {
  it("maps link, title, summary, author fallback, dates and inline content", () => {
    const xml = atomFeed(`
      <author><name>Feed Author</name></author>
      <entry>
        <id> atom-id </id>
        <title type="text">Title &amp; more</title>
        <link rel="self" href="https://wrong.test/self"/>
        <link rel="alternate" type="text/html" href="article"/>
        <published>2025-06-15T04:05:06.007Z</published>
        <updated>2025-06-16T04:05:06Z</updated>
        <summary type="html">&lt;b&gt;summary&lt;/b&gt;</summary>
        <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>hello <b>world</b></p></div></content>
      </entry>
    `);
    expect(parse(xml)).toEqual([
      {
        source_id: "source-1",
        external_id: "atom-id",
        url: "https://feeds.example.test/article",
        title: "Title & more",
        author: "Feed Author",
        published_at: "2025-06-15T12:05:06.007+08:00",
        full_body: {
          value: "<div><p>hello <b>world</b></p></div>",
          format: "HTML",
        },
        summary: { value: "<b>summary</b>", format: "HTML" },
      },
    ]);
  });

  it("falls back to updated only when published is absent and keeps invalid present dates null", () => {
    const xml = atomFeed(`
      <entry><id>first</id><updated>2025-06-16T04:05:06+08:00</updated></entry>
      <entry><id>second</id><published>2025-06-16T04:05:06</published><updated>2025-06-16T04:05:06Z</updated></entry>
    `);
    const entries = parse(xml);
    expect(entries[0]?.published_at).toBe("2025-06-16T04:05:06.000+08:00");
    expect(entries[1]?.published_at).toBeNull();
  });

  it("skips blank repeated ids and dates without crossing a nonblank date field", () => {
    const entries = parse(
      atomFeed(`
        <entry><id> </id><id>first</id><published></published><published>2025-06-15T04:05:06Z</published></entry>
        <entry><id>second</id><published>not a date</published><updated>2025-06-16T04:05:06Z</updated></entry>
        <entry><id>third</id><updated> </updated><updated>2025-06-17T04:05:06Z</updated></entry>
      `),
    );
    expect(entries.map((entry) => entry.external_id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(entries.map((entry) => entry.published_at)).toEqual([
      "2025-06-15T12:05:06.000+08:00",
      null,
      "2025-06-17T12:05:06.000+08:00",
    ]);
  });

  it("renders html and xhtml titles as plain visible text", () => {
    const entries = parse(
      atomFeed(`
        <entry><id>html</id><title type="html">&lt;b&gt;Hello&lt;/b&gt; &amp;amp; world</title></entry>
        <entry><id>xhtml</id><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <b>XHTML</b></p></div></title></entry>
      `),
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      "Hello & world",
      "Hello XHTML",
    ]);
  });

  it("applies XML then HTML decoding once for Atom titles and HTML bodies", () => {
    const entries = parse(
      atomFeed(`
        <entry>
          <id>escaped</id>
          <title type="html">Use &amp;lt;b&amp;gt; literally &amp;amp; more</title>
          <summary type="html">Summary &amp;lt;i&amp;gt;literal&amp;lt;/i&amp;gt; &amp;amp; more</summary>
          <content type="html">Body &amp;lt;u&amp;gt;literal&amp;lt;/u&amp;gt; &amp;amp; more</content>
        </entry>
        <entry>
          <id>cdata</id>
          <title type="html"><![CDATA[Use <b>markup</b> &amp; more]]></title>
          <summary type="html"><![CDATA[Summary <i>markup</i> &amp; more]]></summary>
          <content type="html"><![CDATA[Body <u>markup</u> &amp; more]]></content>
        </entry>
      `),
    );

    expect(entries[0]).toMatchObject({
      title: "Use <b> literally & more",
      summary: {
        value: "Summary &lt;i&gt;literal&lt;/i&gt; &amp; more",
        format: "HTML",
      },
      full_body: {
        value: "Body &lt;u&gt;literal&lt;/u&gt; &amp; more",
        format: "HTML",
      },
    });
    expect(entries[1]).toMatchObject({
      title: "Use markup & more",
      summary: {
        value: "Summary <i>markup</i> &amp; more",
        format: "HTML",
      },
      full_body: {
        value: "Body <u>markup</u> &amp; more",
        format: "HTML",
      },
    });
  });

  it("accepts arbitrary namespace prefixes by URI and ignores unsupported content types", () => {
    const xml = `<?xml version="1.0"?>
      <a:feed xmlns:a="http://www.w3.org/2005/Atom">
        <a:entry>
          <a:id>x</a:id>
          <a:link href="https://example.test/x"/>
          <a:content type="image/png">ignored</a:content>
          <a:content src="https://example.test/file">also ignored</a:content>
        </a:entry>
      </a:feed>`;
    expect(parse(xml)[0]).toMatchObject({
      external_id: "x",
      url: "https://example.test/x",
      full_body: null,
      title: null,
    });
  });

  it("skips unknown link/content types before the first supported value", () => {
    const xml = atomFeed(`
      <entry>
        <id>x</id>
        <link rel="enclosure" href="https://wrong.test/a"/>
        <link rel="alternate" type="application/pdf" href="https://wrong.test/b"/>
        <link rel="alternate" type="application/xhtml+xml" href="https://right.test/c"/>
        <content type="application/octet-stream">binary</content>
        <content type="text">Text body</content>
      </entry>
    `);
    expect(parse(xml)[0]).toMatchObject({
      url: "https://right.test/c",
      full_body: { value: "Text body", format: "TEXT" },
    });
  });

  it("serializes xhtml content as structural standard HTML", () => {
    const xml = atomFeed(`
      <entry>
        <id>x</id>
        <summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p><b>bold</b></p><p>x &lt; y</p></div></summary>
      </entry>
    `);
    const value = parse(xml)[0]?.summary?.value ?? "";
    expect(value).toBe("<div><p><b>bold</b></p><p>x &lt; y</p></div>");
    expect(value).not.toContain("xhtml:");
  });
});

describe("namespaces, bases and XML safety", () => {
  it("resolves xml:base inherited through feed, channel and item", () => {
    const xml = `<rss version="2.0" xml:base="https://root.test/a/"><channel xml:base="b/"><item xml:base="c/"><guid>id</guid><link>page</link></item></channel></rss>`;
    expect(parse(xml)[0]?.url).toBe("https://root.test/a/b/c/page");
  });

  it("resolves xml:base declared on RSS link, GUID fallback and Atom link nodes", () => {
    const rss = parse(
      rssFeed(`
        <item><guid>link-id</guid><link xml:base="https://link.test/base/">page</link></item>
        <item><guid isPermaLink="true" xml:base="https://guid.test/base/">/fallback</guid></item>
        <item><guid xml:base="https://guid-fallback.test/base/">fallback</guid></item>
      `),
    );
    const atom = parse(
      atomFeed(`
        <entry><id>atom-id</id><link xml:base="https://atom.test/base/" href="page"/></entry>
      `),
    );
    expect(rss.map((entry) => entry.url)).toEqual([
      "https://link.test/base/page",
      "https://guid.test/fallback",
      null,
    ]);
    expect(rss.map((entry) => entry.external_id)).toEqual([
      "link-id",
      "/fallback",
      "fallback",
    ]);
    expect(atom[0]?.url).toBe("https://atom.test/base/page");
  });

  it("keeps identity when a link node has an invalid xml:base", () => {
    const xml = rssFeed(
      '<item><guid>keep</guid><link xml:base="https://user:pass@example.test/">page</link></item>',
    );
    expect(parse(xml)[0]).toMatchObject({
      external_id: "keep",
      url: null,
    });
  });

  it("uses the transport final URL as the base and strips only default ports", () => {
    const xml = rssFeed(
      "<item><guid>id</guid><link>//example.test:443/path#fragment</link></item><item><guid>id2</guid><link>https://example.test:444/no</link></item>",
    );
    const entries = parse(xml);
    expect(entries[0]?.url).toBeNull();
    expect(entries[1]?.url).toBeNull();
  });

  it("keeps identity when one link is invalid and does not write final URL to source", () => {
    const xml = rssFeed(
      '<item xml:base="https://user:pass@example.test/"><guid>id</guid><link>x</link></item>',
    );
    expect(parse(xml)[0]).toMatchObject({ external_id: "id", url: null });
  });

  it("supports arbitrary prefixes for content, Dublin Core and Media RSS", () => {
    const xml = `<?xml version="1.0"?>
      <rss xmlns:x="http://purl.org/rss/1.0/modules/content/" xmlns:y="http://purl.org/dc/elements/1.1/" xmlns:z="http://search.yahoo.com/mrss/">
        <channel><item><guid>id</guid><y:creator>DC Author</y:creator><x:encoded>Full</x:encoded><z:description>Media Summary</z:description></item></channel>
      </rss>`;
    expect(parse(xml)[0]).toMatchObject({
      author: "DC Author",
      full_body: { value: "Full", format: "HTML" },
      summary: { value: "Media Summary", format: "HTML" },
    });
  });

  it("resolves namespace prefixes declared on the matched element", () => {
    const xml = `<rss><channel><item><guid>id</guid><x:creator xmlns:x="http://purl.org/dc/elements/1.1/">DC Author</x:creator><y:encoded xmlns:y="http://purl.org/rss/1.0/modules/content/">Full</y:encoded><z:description xmlns:z="http://search.yahoo.com/mrss/">Media Summary</z:description></item></channel></rss>`;
    expect(parse(xml)[0]).toMatchObject({
      author: "DC Author",
      full_body: { value: "Full", format: "HTML" },
      summary: { value: "Media Summary", format: "HTML" },
    });

    const atom = parse(
      `<feed xmlns="http://www.w3.org/2005/Atom"><a:entry xmlns:a="http://www.w3.org/2005/Atom"><a:id>atom-local-prefix</a:id><a:title>Local</a:title></a:entry></feed>`,
    );
    expect(atom[0]).toMatchObject({
      external_id: "atom-local-prefix",
      title: "Local",
    });
  });

  it("preserves CDATA and decodes predefined and numeric entities", () => {
    const xml = rssFeed(
      "<item><guid>id</guid><title><![CDATA[A & B]]> &#65;&#x42;</title><description>&lt;p&gt;x&lt;/p&gt;</description></item>",
    );
    expect(parse(xml)[0]).toMatchObject({
      title: "A & B AB",
      summary: { value: "<p>x</p>", format: "HTML" },
    });
  });

  it("decodes entities in URL values and rejects embedded control characters", () => {
    const entries = parse(
      rssFeed(`
        <item><guid>encoded</guid><link>https://example.test/a?x=1&amp;y=2</link></item>
        <item><guid>control</guid><link>https://example.test/a&#x000A;b</link></item>
      `),
    );
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://example.test/a?x=1&y=2",
      null,
    ]);

    const atom = parse(
      atomFeed(`
        <entry xml:base="https://example.test/a&amp;b/"><id>encoded-base</id><link href="page"/></entry>
      `),
    );
    expect(atom[0]?.url).toBe("https://example.test/a&b/page");
  });

  it("rejects DTD and entity declarations without resolving them", () => {
    expectReason(
      () => parse('<!DOCTYPE rss [<!ENTITY x "boom">]><rss><channel/></rss>'),
      "unsupported_feed",
    );
    expectReason(
      () => parse('<!ENTITY x "boom"><rss><channel/></rss>'),
      "unsupported_feed",
    );
  });

  it("rejects malformed XML, RSS 1.0/RDF, unknown roots, missing containers and JSON", () => {
    for (const xml of [
      "<rss><channel>",
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>',
      "<root/>",
      "<rss/>",
      "<feed/>",
      "{}",
    ]) {
      expectReason(
        () => parse(xml),
        xml.includes("rdf") ||
          xml.includes("root") ||
          xml.includes("feed") ||
          xml === "{}"
          ? "unsupported_feed"
          : "invalid_feed",
      );
    }
  });

  it("rejects an entire feed when item count exceeds maxFeedEntries", () => {
    const xml = rssFeed(
      "<item><guid>1</guid></item><item><guid>2</guid></item>",
    );
    expectReason(() => parse(xml, 1), "feed_too_many_entries");
  });

  it("rejects an entire feed when the fixed element count exceeds 100,000", () => {
    const xml = `<rss><channel><item><guid>id</guid>${"<x/>".repeat(100_000)}</item></channel></rss>`;
    expectReason(() => parse(xml), "invalid_feed");
  });
});

describe("strict URL and time normalization", () => {
  it("accepts RFC822 offsets, GMT and UTC", () => {
    const entries = parse(
      rssFeed(`
        <item><guid>a</guid><pubDate>Sun, 15 Jun 2025 04:05:06 +0800</pubDate></item>
        <item><guid>b</guid><pubDate>Sun, 15 Jun 2025 04:05:06 GMT</pubDate></item>
        <item><guid>c</guid><pubDate>Sun, 15 Jun 2025 04:05:06 UTC</pubDate></item>
        <item><guid>leap-day</guid><pubDate>Thu, 29 Feb 2024 04:05:06 +0800</pubDate></item>
        <item><guid>no-weekday-gmt</guid><pubDate>15 Jun 2025 04:05:06 GMT</pubDate></item>
        <item><guid>no-weekday-offset</guid><pubDate>15 Jun 2025 04:05:06 +0800</pubDate></item>
      `),
    );
    expect(entries.map((entry) => entry.published_at)).toEqual([
      "2025-06-15T04:05:06.000+08:00",
      "2025-06-15T12:05:06.000+08:00",
      "2025-06-15T12:05:06.000+08:00",
      "2024-02-29T04:05:06.000+08:00",
      "2025-06-15T12:05:06.000+08:00",
      "2025-06-15T04:05:06.000+08:00",
    ]);
  });

  it("returns null for RSS dates without an explicit offset or invalid dates", () => {
    const entries = parse(
      rssFeed(`
        <item><guid>a</guid><pubDate>Sun, 15 Jun 2025 04:05:06</pubDate></item>
        <item><guid>b</guid><pubDate>not a date</pubDate></item>
      `),
    );
    expect(entries.map((entry) => entry.published_at)).toEqual([null, null]);
  });

  it("accepts Atom RFC3339 Z/numeric offsets and rejects unzoned or invalid values", () => {
    const entries = parse(
      atomFeed(`
        <entry><id>a</id><published>2025-06-15T04:05:06Z</published></entry>
        <entry><id>b</id><published>2025-06-15T04:05:06+08:00</published></entry>
        <entry><id>c</id><published>2025-06-15T04:05:06</published></entry>
        <entry><id>d</id><published>2025-13-40T04:05:06Z</published></entry>
        <entry><id>leap-day</id><published>2024-02-29T04:05:06Z</published></entry>
      `),
    );
    expect(entries.map((entry) => entry.published_at)).toEqual([
      "2025-06-15T12:05:06.000+08:00",
      "2025-06-15T04:05:06.000+08:00",
      null,
      null,
      "2024-02-29T12:05:06.000+08:00",
    ]);
  });

  it("rejects impossible calendar, clock and offset components instead of normalizing them", () => {
    const rss = parse(
      rssFeed(`
        <item><guid>rss-non-leap</guid><pubDate>Sat, 29 Feb 2025 04:05:06 GMT</pubDate></item>
        <item><guid>rss-april-31</guid><pubDate>Thu, 31 Apr 2025 04:05:06 GMT</pubDate></item>
        <item><guid>rss-hour</guid><pubDate>Sun, 15 Jun 2025 24:05:06 GMT</pubDate></item>
        <item><guid>rss-minute</guid><pubDate>Sun, 15 Jun 2025 04:60:06 GMT</pubDate></item>
        <item><guid>rss-second</guid><pubDate>Sun, 15 Jun 2025 04:05:60 GMT</pubDate></item>
        <item><guid>rss-offset-hour</guid><pubDate>Sun, 15 Jun 2025 04:05:06 +2400</pubDate></item>
        <item><guid>rss-offset-minute</guid><pubDate>Sun, 15 Jun 2025 04:05:06 +0860</pubDate></item>
      `),
    );
    expect(rss.map((entry) => entry.external_id)).toEqual([
      "rss-non-leap",
      "rss-april-31",
      "rss-hour",
      "rss-minute",
      "rss-second",
      "rss-offset-hour",
      "rss-offset-minute",
    ]);
    expect(rss.map((entry) => entry.published_at)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);

    const atom = parse(
      atomFeed(`
        <entry><id>atom-published-non-leap</id><published>2025-02-29T04:05:06Z</published></entry>
        <entry><id>atom-updated-april-31</id><updated>2025-04-31T04:05:06Z</updated></entry>
        <entry><id>atom-published-hour</id><published>2025-06-15T24:05:06Z</published></entry>
        <entry><id>atom-updated-minute</id><updated>2025-06-15T04:60:06Z</updated></entry>
        <entry><id>atom-published-second</id><published>2025-06-15T04:05:60Z</published></entry>
        <entry><id>atom-updated-offset-hour</id><updated>2025-06-15T04:05:06+24:00</updated></entry>
        <entry><id>atom-published-offset-minute</id><published>2025-06-15T04:05:06+08:60</published></entry>
      `),
    );
    expect(atom.map((entry) => entry.external_id)).toEqual([
      "atom-published-non-leap",
      "atom-updated-april-31",
      "atom-published-hour",
      "atom-updated-minute",
      "atom-published-second",
      "atom-updated-offset-hour",
      "atom-published-offset-minute",
    ]);
    expect(atom.map((entry) => entry.published_at)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("produces the same output under a different machine timezone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    const newYork = parse(
      rssFeed(
        "<item><guid>a</guid><pubDate>Sun, 15 Jun 2025 04:05:06 GMT</pubDate></item>",
      ),
    )[0]?.published_at;
    process.env.TZ = "Asia/Tokyo";
    const tokyo = parse(
      rssFeed(
        "<item><guid>a</guid><pubDate>Sun, 15 Jun 2025 04:05:06 GMT</pubDate></item>",
      ),
    )[0]?.published_at;
    process.env.TZ = previous;
    expect(newYork).toBe(tokyo);
  });
});
