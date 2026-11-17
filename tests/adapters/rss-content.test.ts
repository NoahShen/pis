import { describe, expect, it } from "vitest";

import type { SourceAdapter } from "../../src/adapters/contracts.js";
import { AdapterError } from "../../src/adapters/errors.js";
import {
  cleanSourceText,
  cleanTextValue,
} from "../../src/adapters/content-cleaning.js";
import { parseAdapterPolicy } from "../../src/adapters/options.js";
import { createRssAdapter } from "../../src/adapters/rss-adapter.js";
import { createRssAdapterWithDependencies } from "../../src/adapters/rss-adapter.internal.js";
import {
  AcquisitionError,
  type RssTransport,
  type RssTransportDocument,
  type RssTransportRequest,
} from "../../src/adapters/transport.js";
import {
  ARTICLE_URL,
  articleHtml,
  sourceEntry,
} from "../fixtures/rss-content.js";

const policy = parseAdapterPolicy({
  requestTimeoutMs: 100,
  articleMinTextChars: 80,
});
const highThresholdPolicy = parseAdapterPolicy({
  requestTimeoutMs: 100,
  articleMinTextChars: 1000,
});
const restrictedExcerpt =
  "This is a financial report excerpt with facts about company revenue and market activity. ";
const restrictedExcerptHtml = `<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><main><article><p>${restrictedExcerpt.repeat(3)}</p></article></main></body></html>`;
const restrictedWhitespaceHtml =
  '<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}</script></head><body><main><article><p>   </p></article></main></body></html>';

function document(body: string, finalUrl = ARTICLE_URL): RssTransportDocument {
  return { finalUrl, body, receivedResponse: true };
}

function lateVisibleAbortSignal(abortedOnRead: number): {
  signal: AbortSignal;
  abortedReads: () => number;
} {
  const controller = new AbortController();
  let reads = 0;
  const signal = new Proxy(controller.signal, {
    get(target, property, receiver) {
      if (property === "aborted") {
        reads += 1;
        return reads >= abortedOnRead;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { signal, abortedReads: () => reads };
}

async function observeNoUnhandledRejection(
  operation: () => Promise<void>,
): Promise<void> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await operation();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
}

function adapterFor(transport: RssTransport, httpPolicy = policy) {
  return createRssAdapter({ transport, httpPolicy });
}

describe("RSS fetchContent decision table", () => {
  it("cleans source HTML summaries and empty full fields", () => {
    expect(
      cleanSourceText({ value: "<p>Only source summary.</p>", format: "HTML" }),
    ).toBe("Only source summary.");
    expect(cleanTextValue("raw text")).toBe("raw text");
    expect(cleanSourceText({ value: "<p></p>", format: "HTML" })).toBeNull();
  });

  it("uses a source full field directly without DNS or article I/O", async () => {
    let calls = 0;
    const adapter = adapterFor({
      async fetch() {
        calls += 1;
        throw new Error("should not run");
      },
    });
    const content = await adapter.fetchContent(
      sourceEntry({
        full_body: {
          value: "<p>Short but declared &amp; full.</p>",
          format: "HTML",
        },
        summary: { value: "<p>Source summary.</p>", format: "HTML" },
      }),
    );
    expect(calls).toBe(0);
    expect(content).toMatchObject({
      body: "Short but declared & full.",
      summary: "Source summary.",
      content_kind: "FULL_BODY",
      acquired_via: "SOURCE_FULL_FIELD",
      completeness_basis: "SOURCE_DECLARED",
      article: { status: "NOT_REQUESTED", reason: null, final_url: null },
    });
  });

  it("uses long source full text without fetching or treating its description as full text", async () => {
    const requests: RssTransportRequest[] = [];
    const adapter = adapterFor({
      async fetch(request) {
        requests.push(request);
        return document(articleHtml());
      },
    });
    const trueFullBody = "Declared full body. ".repeat(100);
    const longContent = await adapter.fetchContent(
      sourceEntry({
        full_body: { value: trueFullBody, format: "TEXT" },
        summary: {
          value: "Long description summary. ".repeat(20),
          format: "TEXT",
        },
      }),
    );

    expect(longContent).toMatchObject({
      body: trueFullBody.trim(),
      content_kind: "FULL_BODY",
      acquired_via: "SOURCE_FULL_FIELD",
      completeness_basis: "SOURCE_DECLARED",
      article: { status: "NOT_REQUESTED", reason: null, final_url: null },
    });
    expect(requests).toEqual([]);

    const description = "Long description only. ".repeat(100);
    const descriptionOnly = await adapter.fetchContent(
      sourceEntry({ summary: { value: description, format: "TEXT" } }),
    );
    expect(requests).toEqual([
      {
        kind: "article",
        url: ARTICLE_URL,
        timeoutMs: 100,
        maxBytes: 5_242_880,
      },
    ]);
    expect(descriptionOnly).toMatchObject({
      summary: description.trim(),
      content_kind: "FULL_BODY",
      acquired_via: "ARTICLE_EXTRACT",
      completeness_basis: "ARTICLE_EXTRACTED",
    });
  });

  it("treats an empty full field as missing and fetches the article", async () => {
    const requests: RssTransportRequest[] = [];
    const adapter = adapterFor({
      async fetch(request) {
        requests.push(request);
        return document(articleHtml());
      },
    });
    const content = await adapter.fetchContent(
      sourceEntry({ full_body: { value: "<img src='x'>", format: "HTML" } }),
    );
    expect(requests).toEqual([
      {
        kind: "article",
        url: ARTICLE_URL,
        timeoutMs: 100,
        maxBytes: 5_242_880,
      },
    ]);
    expect(content).toMatchObject({
      content_kind: "FULL_BODY",
      acquired_via: "ARTICLE_EXTRACT",
      completeness_basis: "ARTICLE_EXTRACTED",
      article: { status: "SUCCESS", reason: null, final_url: ARTICLE_URL },
    });
  });

  it("extracts clean paragraphs, preserves source summary and records final URL", async () => {
    const finalUrl = "https://redirected.example.test/final";
    const adapter = adapterFor({
      async fetch() {
        return document(articleHtml(), finalUrl);
      },
    });
    const content = await adapter.fetchContent(
      sourceEntry({
        summary: { value: "<p>Only source summary.</p>", format: "HTML" },
      }),
    );
    expect(content.body).toContain("A complete paragraph");
    expect(content.body).toContain("\n");
    expect(content.summary).toBe("Only source summary.");
    expect(content.article.final_url).toBe(finalUrl);
  });

  it.each([
    ["blocked_url", "BLOCKED", false, null],
    ["blocked_url", "BLOCKED", true, ARTICLE_URL],
    ["dns_failed", "FAILED", false, null],
    ["dns_failed", "FAILED", true, ARTICLE_URL],
    ["network_error", "FAILED", false, null],
    ["network_error", "FAILED", true, ARTICLE_URL],
    ["timeout", "FAILED", false, null],
    ["timeout", "FAILED", true, ARTICLE_URL],
    ["http_status", "FAILED", true, ARTICLE_URL],
    ["redirect_limit", "FAILED", true, ARTICLE_URL],
    ["invalid_redirect", "FAILED", true, ARTICLE_URL],
    ["unsupported_mime", "FAILED", true, ARTICLE_URL],
    ["unsupported_encoding", "FAILED", true, ARTICLE_URL],
    ["response_too_large", "FAILED", true, ARTICLE_URL],
  ] as const)(
    "maps %s with receivedResponse=%s to a summary fallback",
    async (reason, status, receivedResponse, finalUrl) => {
      const adapter = adapterFor({
        async fetch() {
          throw new AcquisitionError(reason, receivedResponse, finalUrl);
        },
      });
      const content = await adapter.fetchContent(
        sourceEntry({ summary: { value: "Fallback summary", format: "TEXT" } }),
      );
      expect(content).toMatchObject({
        body: "Fallback summary",
        summary: "Fallback summary",
        content_kind: "SUMMARY",
        acquired_via: "SOURCE_FALLBACK",
        completeness_basis: "PARTIAL_ONLY",
        article: { status, reason, final_url: finalUrl },
      });
    },
  );

  it("returns a valid NONE result when a failed request has no summary", async () => {
    const adapter = adapterFor({
      async fetch() {
        throw new AcquisitionError("http_status", true, ARTICLE_URL);
      },
    });
    expect(await adapter.fetchContent(sourceEntry())).toMatchObject({
      body: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "http_status",
        final_url: ARTICLE_URL,
      },
    });
  });

  it.each(["204", "205"] as const)(
    "maps an article %s response equivalent to extraction_failed",
    async () => {
      const adapter = adapterFor({
        async fetch() {
          throw new AcquisitionError("extraction_failed", true, ARTICLE_URL);
        },
      });

      await expect(
        adapter.fetchContent(
          sourceEntry({
            summary: { value: "Empty article fallback", format: "TEXT" },
          }),
        ),
      ).resolves.toMatchObject({
        body: "Empty article fallback",
        content_kind: "SUMMARY",
        acquired_via: "SOURCE_FALLBACK",
        completeness_basis: "PARTIAL_ONLY",
        article: {
          status: "FAILED",
          reason: "extraction_failed",
          final_url: ARTICLE_URL,
        },
      });
      await expect(adapter.fetchContent(sourceEntry())).resolves.toMatchObject({
        body: null,
        content_kind: "NONE",
        acquired_via: "NONE",
        completeness_basis: "NO_CONTENT",
        article: {
          status: "FAILED",
          reason: "extraction_failed",
          final_url: ARTICLE_URL,
        },
      });
    },
  );

  it("returns extraction_failed for short or unavailable Readability output", async () => {
    for (const options of [{ short: true }, { unreadable: true }]) {
      const adapter = adapterFor({
        async fetch() {
          return document(articleHtml(options));
        },
      });
      expect(await adapter.fetchContent(sourceEntry())).toMatchObject({
        content_kind: "NONE",
        article: {
          status: "FAILED",
          reason: "extraction_failed",
          final_url: ARTICLE_URL,
        },
      });
    }
  });

  it("does not request an article when URL is absent", async () => {
    let calls = 0;
    const adapter = adapterFor({
      async fetch() {
        calls += 1;
        return document(articleHtml());
      },
    });
    expect(
      await adapter.fetchContent(
        sourceEntry({
          url: null,
          summary: { value: "Summary only", format: "TEXT" },
        }),
      ),
    ).toMatchObject({
      body: "Summary only",
      content_kind: "SUMMARY",
      article: {
        status: "NOT_REQUESTED",
        reason: "no_article_url",
        final_url: null,
      },
    });
    expect(calls).toBe(0);
  });

  it.each(["json-ld", "json-ld-object", "itemprop"] as const)(
    "never upgrades structured paywall signal %s to FULL_BODY",
    async (signal) => {
      const html = articleHtml({ restricted: true, signal });
      const withSummary = adapterFor({
        async fetch() {
          return document(html);
        },
      });
      const withoutSummary = adapterFor({
        async fetch() {
          return document(html);
        },
      });

      expect(
        await withSummary.fetchContent(
          sourceEntry({
            summary: { value: "Restricted summary", format: "TEXT" },
          }),
        ),
      ).toMatchObject({
        body: "Restricted summary",
        content_kind: "SUMMARY",
        acquired_via: "SOURCE_FALLBACK",
        article: { status: "FAILED", reason: "restricted_content" },
      });
      expect(await withoutSummary.fetchContent(sourceEntry())).toMatchObject({
        content_kind: "FRAGMENT",
        acquired_via: "ARTICLE_EXTRACT",
        completeness_basis: "PARTIAL_ONLY",
        article: { status: "FAILED", reason: "restricted_content" },
      });
    },
  );

  it("returns NONE for an empty restricted fragment", async () => {
    const adapter = adapterFor(
      {
        async fetch() {
          return document(restrictedWhitespaceHtml);
        },
      },
      highThresholdPolicy,
    );
    expect(await adapter.fetchContent(sourceEntry())).toMatchObject({
      body: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "restricted_content",
        final_url: ARTICLE_URL,
      },
    });
  });

  it("returns a nonempty restricted fragment below the normal body threshold", async () => {
    const adapter = adapterFor(
      {
        async fetch() {
          return document(restrictedExcerptHtml);
        },
      },
      highThresholdPolicy,
    );
    const content = await adapter.fetchContent(sourceEntry({ summary: null }));

    expect(content).toMatchObject({
      content_kind: "FRAGMENT",
      acquired_via: "ARTICLE_EXTRACT",
      completeness_basis: "PARTIAL_ONLY",
      article: {
        status: "FAILED",
        reason: "restricted_content",
        final_url: ARTICLE_URL,
      },
    });
    expect(content.body).toContain("financial report excerpt");
  });

  it("prefers a source summary to a below-threshold restricted fragment", async () => {
    const adapter = adapterFor(
      {
        async fetch() {
          return document(restrictedExcerptHtml);
        },
      },
      highThresholdPolicy,
    );
    const content = await adapter.fetchContent(
      sourceEntry({
        summary: { value: "Restricted summary", format: "TEXT" },
      }),
    );

    expect(content).toMatchObject({
      body: "Restricted summary",
      content_kind: "SUMMARY",
      acquired_via: "SOURCE_FALLBACK",
      completeness_basis: "PARTIAL_ONLY",
      article: {
        status: "FAILED",
        reason: "restricted_content",
        final_url: ARTICLE_URL,
      },
    });
  });

  it("keeps the body threshold for short non-restricted extraction", async () => {
    const adapter = adapterFor(
      {
        async fetch() {
          return document(articleHtml({ short: true }));
        },
      },
      highThresholdPolicy,
    );

    expect(
      await adapter.fetchContent(sourceEntry({ summary: null })),
    ).toMatchObject({
      body: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "extraction_failed",
        final_url: ARTICLE_URL,
      },
    });
  });

  it("ignores an invalid JSON-LD restriction and returns extracted content", async () => {
    const adapter = adapterFor({
      async fetch() {
        return document(articleHtml({ restricted: true, signal: "invalid" }));
      },
    });
    expect(await adapter.fetchContent(sourceEntry())).toMatchObject({
      content_kind: "FULL_BODY",
      article: {
        status: "SUCCESS",
        reason: null,
        final_url: ARTICLE_URL,
      },
    });
  });

  it("keeps extraction_failed short text out of FRAGMENT and falls back to the summary", async () => {
    const adapter = adapterFor({
      async fetch() {
        return document(articleHtml({ short: true }));
      },
    });
    expect(
      await adapter.fetchContent(
        sourceEntry({
          summary: { value: "Short extraction summary", format: "TEXT" },
        }),
      ),
    ).toMatchObject({
      body: "Short extraction summary",
      content_kind: "SUMMARY",
      acquired_via: "SOURCE_FALLBACK",
      completeness_basis: "PARTIAL_ONLY",
      article: {
        status: "FAILED",
        reason: "extraction_failed",
        final_url: ARTICLE_URL,
      },
    });
  });
});

describe("RSS adapter cancellation and boundaries", () => {
  it("propagates caller abort and ignores a later article rejection", async () => {
    let rejectLate!: (error: unknown) => void;
    const adapter = adapterFor({
      fetch() {
        return new Promise((_resolve, reject) => {
          rejectLate = reject;
        });
      },
    });
    const controller = new AbortController();
    const pending = adapter.fetchContent(sourceEntry(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    rejectLate(new Error("late rejection is consumed"));
    await Promise.resolve();
  });

  it("reuses the late article abort rejection without starting transport", async () => {
    const { signal, abortedReads } = lateVisibleAbortSignal(4);
    let transportCalls = 0;
    const adapter = adapterFor({
      async fetch() {
        transportCalls += 1;
        return document(articleHtml());
      },
    });

    await observeNoUnhandledRejection(async () => {
      const error: unknown = await adapter
        .fetchContent(sourceEntry(), { signal })
        .catch((caught: unknown) => caught);
      expect(error).toEqual(new AdapterError("aborted"));
      expect(error).toMatchObject({
        reason: "aborted",
        message: "The operation was aborted",
      });
    });

    expect(abortedReads()).toBe(5);
    expect(transportCalls).toBe(0);
  });

  it("reuses the late feed abort rejection without starting transport", async () => {
    const { signal, abortedReads } = lateVisibleAbortSignal(3);
    let transportCalls = 0;
    const adapter = adapterFor({
      async fetch() {
        transportCalls += 1;
        return document(
          '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>F</title><item><guid>one</guid><link>story</link></item></channel></rss>',
        );
      },
    });

    await observeNoUnhandledRejection(async () => {
      const error: unknown = await adapter
        .fetchEntries(
          { id: "s", type: "RSS", url: "https://feeds.example.test/feed" },
          null,
          { signal },
        )
        .catch((caught: unknown) => caught);
      expect(error).toEqual(new AdapterError("aborted"));
      expect(error).toMatchObject({
        reason: "aborted",
        message: "The operation was aborted",
      });
    });

    expect(abortedReads()).toBe(3);
    expect(transportCalls).toBe(0);
  });

  it("does not swallow programmer or feed-class errors as fallback", async () => {
    const programmer = adapterFor({
      async fetch() {
        throw new TypeError("internal fault");
      },
    });
    await expect(programmer.fetchContent(sourceEntry())).rejects.toBeInstanceOf(
      TypeError,
    );

    const unsupported = adapterFor({
      async fetch() {
        throw new AcquisitionError("invalid_feed", false, null);
      },
    });
    await expect(unsupported.fetchContent(sourceEntry())).rejects.toMatchObject(
      {
        reason: "invalid_feed",
      },
    );
  });

  it("snapshots entry and nested source text before awaiting transport", async () => {
    let resolveTransport!: (value: RssTransportDocument) => void;
    const requests: RssTransportRequest[] = [];
    const adapter = adapterFor({
      fetch(request) {
        requests.push(request);
        return new Promise((resolve) => {
          resolveTransport = resolve;
        });
      },
    });
    const fullBody = { value: "<p></p>", format: "HTML" as const };
    const summary = { value: "Original summary", format: "TEXT" as const };
    const entry = sourceEntry({ full_body: fullBody, summary });
    const pending = adapter.fetchContent(entry);

    entry.url = "https://changed.example.test/story";
    fullBody.value = "<p>Changed full body</p>";
    summary.value = "Changed summary";
    resolveTransport(document(articleHtml()));
    const content = await pending;

    expect(requests).toEqual([
      {
        kind: "article",
        url: ARTICLE_URL,
        timeoutMs: 100,
        maxBytes: 5_242_880,
      },
    ]);
    expect(content.entry.url).toBe(ARTICLE_URL);
    expect(content.entry.full_body).toEqual({
      value: "<p></p>",
      format: "HTML",
    });
    expect(content.entry.summary).toEqual({
      value: "Original summary",
      format: "TEXT",
    });
    expect(content.summary).toBe("Original summary");
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });

  it("rejects a pre-aborted call before touching the transport", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const adapter = adapterFor({
      async fetch() {
        calls += 1;
        return document(articleHtml());
      },
    });
    await expect(
      adapter.fetchContent(sourceEntry(), { signal: controller.signal }),
    ).rejects.toEqual(new AdapterError("aborted"));
    expect(calls).toBe(0);
  });

  it("keeps concurrent cancellation isolated and allows a later request", async () => {
    const resolvers: Array<(value: RssTransportDocument) => void> = [];
    const adapter = adapterFor({
      fetch() {
        return new Promise((resolve) => resolvers.push(resolve));
      },
    });
    const firstController = new AbortController();
    const first = adapter.fetchContent(sourceEntry(), {
      signal: firstController.signal,
    });
    const second = adapter.fetchContent(sourceEntry());
    firstController.abort();
    await expect(first).rejects.toMatchObject({ reason: "aborted" });
    resolvers[0]?.(document(articleHtml({ short: true })));
    resolvers[1]?.(document(articleHtml()));
    await expect(second).resolves.toMatchObject({
      content_kind: "FULL_BODY",
      article: { status: "SUCCESS" },
    });

    const later = adapterFor({
      async fetch() {
        return document(articleHtml());
      },
    });
    await expect(later.fetchContent(sourceEntry())).resolves.toMatchObject({
      content_kind: "FULL_BODY",
    });
  });

  it("allows the same adapter to succeed after an aborted call", async () => {
    let rejectFirst!: (error: unknown) => void;
    let calls = 0;
    const adapter = adapterFor({
      fetch() {
        calls += 1;
        if (calls === 1) {
          return new Promise((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return Promise.resolve(document(articleHtml()));
      },
    });
    const controller = new AbortController();
    const pending = adapter.fetchContent(sourceEntry(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    rejectFirst(new Error("late failure is consumed"));

    await expect(adapter.fetchContent(sourceEntry())).resolves.toMatchObject({
      content_kind: "FULL_BODY",
      article: { status: "SUCCESS" },
    });
  });

  it("falls back for an article timeout without aborting the adapter call", async () => {
    const adapter = adapterFor({
      async fetch() {
        throw new AcquisitionError("timeout", false, null);
      },
    });
    await expect(
      adapter.fetchContent(
        sourceEntry({ summary: { value: "Timeout fallback", format: "TEXT" } }),
      ),
    ).resolves.toMatchObject({
      body: "Timeout fallback",
      content_kind: "SUMMARY",
      article: { status: "FAILED", reason: "timeout", final_url: null },
    });
  });

  it("accepts a synthetic non-RSS SourceAdapter result as a consumer boundary", async () => {
    const synthetic = (async () => ({
      schema_version: 1 as const,
      entry: sourceEntry({ source_id: "synthetic" }),
      body: "Synthetic body",
      summary: null,
      content_kind: "FULL_BODY" as const,
      acquired_via: "ARTICLE_EXTRACT" as const,
      completeness_basis: "ARTICLE_EXTRACTED" as const,
      article: { status: "SUCCESS" as const, reason: null, final_url: null },
    })) satisfies SourceAdapter["fetchContent"];

    await expect(synthetic()).resolves.toMatchObject({
      body: "Synthetic body",
      content_kind: "FULL_BODY",
    });
  });

  it("delegates fetchEntries and defaults to an injected transport requirement", async () => {
    const adapter = adapterFor({
      async fetch() {
        return document(
          '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>F</title><item><guid>one</guid><link>story</link></item></channel></rss>',
        );
      },
    });
    await expect(
      adapter.fetchEntries(
        { id: "s", type: "RSS", url: "https://feeds.example.test/feed" },
        null,
      ),
    ).resolves.toHaveLength(1);
    const invalidOptions = {} as unknown as Parameters<
      typeof createRssAdapter
    >[0];
    expect(() => createRssAdapter(invalidOptions)).toThrow(TypeError);
  });

  it.each(["204", "205"] as const)(
    "rejects a feed %s response equivalent without article fallback",
    async () => {
      const adapter = adapterFor({
        async fetch() {
          throw new AcquisitionError("invalid_feed", false, null);
        },
      });

      await expect(
        adapter.fetchEntries(
          { id: "s", type: "RSS", url: "https://feeds.example.test/feed" },
          null,
        ),
      ).rejects.toMatchObject({
        name: "AdapterError",
        reason: "invalid_feed",
        message: "The feed is invalid",
      });
    },
  );

  it("does not expose known transport URLs or underlying messages", async () => {
    const feedUrl = "https://private.example.test/feed-sentinel";
    const detailSentinel = "underlying-feed-detail-sentinel";
    const adapter = adapterFor({
      async fetch() {
        const error = new AcquisitionError("invalid_feed", false, null);
        error.message = `${feedUrl} ${detailSentinel}`;
        throw error;
      },
    });
    const rejection = adapter.fetchEntries(
      { id: "s", type: "RSS", url: feedUrl },
      null,
    );

    await expect(rejection).rejects.toEqual(new AdapterError("invalid_feed"));
    const error: unknown = await rejection.catch((caught: unknown) => caught);
    expect(error).not.toHaveProperty("finalUrl");
    expect(error).not.toHaveProperty("receivedResponse");
    expect(String(error)).not.toContain(feedUrl);
    expect(String(error)).not.toContain(detailSentinel);
  });

  it("uses a restricted-signal factory only when no transport is injected", async () => {
    let receivedSignal: AbortSignal | undefined;
    const adapter = createRssAdapterWithDependencies(
      { httpPolicy: policy },
      {
        restrictedTransportFactory(signal) {
          receivedSignal = signal;
          return {
            async fetch() {
              return document(articleHtml());
            },
          };
        },
      },
    );
    await expect(adapter.fetchContent(sourceEntry())).resolves.toBeInstanceOf(
      Object,
    );
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("gives feed and article factory transports fresh internal signals", async () => {
    const signals: AbortSignal[] = [];
    const adapter = createRssAdapterWithDependencies(
      { httpPolicy: policy },
      {
        restrictedTransportFactory(signal) {
          signals.push(signal);
          return {
            async fetch(request) {
              return request.kind === "feed"
                ? document(
                    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>F</title><item><guid>one</guid><link>story</link></item></channel></rss>',
                  )
                : document(articleHtml());
            },
          };
        },
      },
    );
    const caller = new AbortController();

    await adapter.fetchEntries(
      { id: "s", type: "RSS", url: "https://feeds.example.test/feed" },
      null,
      { signal: caller.signal },
    );
    await adapter.fetchContent(sourceEntry(), { signal: caller.signal });

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(caller.signal);
    expect(signals[1]).not.toBe(caller.signal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("relays caller abort only to the matching factory transport", async () => {
    const signals: AbortSignal[] = [];
    const adapter = createRssAdapterWithDependencies(
      { httpPolicy: policy },
      {
        restrictedTransportFactory(signal) {
          signals.push(signal);
          return { fetch: () => new Promise(() => undefined) };
        },
      },
    );
    const controller = new AbortController();
    const pending = adapter.fetchEntries(
      { id: "s", type: "RSS", url: "https://feeds.example.test/feed" },
      null,
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });
});
