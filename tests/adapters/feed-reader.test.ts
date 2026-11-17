import { describe, expect, it, vi } from "vitest";

import {
  sourceEntriesSchema,
  type AdapterCallOptions,
} from "../../src/adapters/contracts.js";
import { AdapterError } from "../../src/adapters/errors.js";
import {
  DEFAULT_ADAPTER_POLICY,
  parseAdapterPolicy,
} from "../../src/adapters/options.js";
import { createFeedReader } from "../../src/adapters/rss/feed-reader.js";
import {
  AcquisitionError,
  type RssTransport,
  type RssTransportDocument,
  type RssTransportRequest,
} from "../../src/adapters/transport.js";
import { RSS_FIXTURE_URL, rssFeed } from "../fixtures/rss-list.js";

const source = {
  id: "source-1",
  type: "RSS",
  url: RSS_FIXTURE_URL,
};

function documentWith(body: string): RssTransportDocument {
  return {
    finalUrl: RSS_FIXTURE_URL,
    body,
    receivedResponse: true,
  };
}

function transportReturning(
  document: RssTransportDocument,
  requests: RssTransportRequest[] = [],
): RssTransport {
  return {
    async fetch(request): Promise<RssTransportDocument> {
      requests.push(request);
      return document;
    },
  };
}

describe("injected RSS feed reader", () => {
  it("snapshots source before await and sends only the serializable request DTO", async () => {
    const finishes: Array<(document: RssTransportDocument) => void> = [];
    const requests: RssTransportRequest[] = [];
    const reader = createFeedReader({
      policy: parseAdapterPolicy({
        requestTimeoutMs: 1_000,
        feedMaxBytes: 4_096,
      }),
      transport: {
        fetch(request) {
          requests.push(request);
          return new Promise((resolve) => {
            finishes.push(resolve);
          });
        },
      },
    });
    const mutableSource = { ...source };
    const pending = reader.fetchEntries(mutableSource, null, {
      signal: new AbortController().signal,
    });

    mutableSource.id = "changed";
    mutableSource.type = "CHANGED";
    mutableSource.url = "https://changed.example.test/feed";
    finishes[0]?.(
      documentWith(
        rssFeed("<item><guid>one</guid><link>article</link></item>"),
      ),
    );

    const entries = await pending;
    expect(requests).toEqual([
      {
        kind: "feed",
        url: RSS_FIXTURE_URL,
        timeoutMs: 1_000,
        maxBytes: 4_096,
      },
    ]);
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "kind",
      "maxBytes",
      "timeoutMs",
      "url",
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        source_id: "source-1",
        external_id: "one",
        url: "https://feeds.example.test/article",
      }),
    ]);
  });

  it("preserves feed order and lastCollectedAt does not filter entries", async () => {
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: transportReturning(
        documentWith(
          rssFeed(`
            <item><guid>old</guid><pubDate>Sun, 15 Jun 2025 04:05:06 GMT</pubDate></item>
            <item><guid>new</guid><pubDate>Mon, 16 Jun 2025 04:05:06 GMT</pubDate></item>
          `),
        ),
      ),
    });

    const entries = await reader.fetchEntries(
      source,
      "2025-06-16T12:05:06.000+08:00",
    );
    expect(entries.map((entry) => entry.external_id)).toEqual(["old", "new"]);
    const repeated = await reader.fetchEntries(
      source,
      "2025-06-16T12:05:06.000+08:00",
    );
    expect(repeated).not.toBe(entries);
  });

  it("rejects a non-RSS source before invoking transport", async () => {
    const fetch = vi.fn<RssTransport["fetch"]>();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: { fetch },
    });

    await expect(
      reader.fetchEntries({ ...source, type: "ATOM" }, null),
    ).rejects.toMatchObject({
      name: "AdapterError",
      reason: "unsupported_source",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid source URL as invalid_source before transport", async () => {
    const fetch = vi.fn<RssTransport["fetch"]>();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: { fetch },
    });

    await expect(
      reader.fetchEntries({ ...source, url: "ftp://example.test/feed" }, null),
    ).rejects.toMatchObject({
      name: "AdapterError",
      reason: "invalid_source",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid source input and does not leak parser details", async () => {
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: transportReturning(documentWith("<rss><channel>")),
    });

    await expect(
      reader.fetchEntries({ ...source, id: " " }, null),
    ).rejects.toMatchObject({
      name: "AdapterError",
      reason: "invalid_source",
    });
    await expect(reader.fetchEntries(source, null)).rejects.toMatchObject({
      name: "AdapterError",
      reason: "invalid_feed",
      message: "The feed is invalid",
    });
  });

  it.each([
    "dns_failed",
    "timeout",
    "network_error",
    "http_status",
    "response_too_large",
  ] as const)(
    "maps acquisition reason %s without exposing internals",
    async (reason) => {
      const reader = createFeedReader({
        policy: DEFAULT_ADAPTER_POLICY,
        transport: {
          async fetch(): Promise<RssTransportDocument> {
            throw new AcquisitionError(reason, false, null);
          },
        },
      });

      const error = await reader
        .fetchEntries(source, null)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ reason });
      expect(error).not.toHaveProperty("finalUrl");
      expect(error).not.toHaveProperty("receivedResponse");
    },
  );

  it("maps synchronous acquisition errors and preserves synchronous adapter errors", async () => {
    const acquisitionReader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        fetch(): Promise<RssTransportDocument> {
          throw new AcquisitionError("timeout", false, null);
        },
      },
    });
    const adapterError = new AdapterError("invalid_feed");
    const adapterReader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        fetch(): Promise<RssTransportDocument> {
          throw adapterError;
        },
      },
    });

    await expect(
      acquisitionReader.fetchEntries(source, null),
    ).rejects.toMatchObject({ reason: "timeout" });
    await expect(adapterReader.fetchEntries(source, null)).rejects.toBe(
      adapterError,
    );
  });

  it.each(["synchronous", "asynchronous"] as const)(
    "rethrows unknown %s transport errors unchanged",
    async (mode) => {
      const programmerError = new SyntaxError("internal detail");
      const reader = createFeedReader({
        policy: DEFAULT_ADAPTER_POLICY,
        transport: {
          fetch(): Promise<RssTransportDocument> {
            if (mode === "synchronous") {
              throw programmerError;
            }
            return Promise.reject(programmerError);
          },
        },
      });

      await expect(reader.fetchEntries(source, null)).rejects.toBe(
        programmerError,
      );
    },
  );

  it("reads options.signal once and keeps the signal captured at invocation", async () => {
    const controller = new AbortController();
    const laterController = new AbortController();
    let reads = 0;
    const options = Object.defineProperty({}, "signal", {
      get() {
        reads += 1;
        return reads === 1 ? controller.signal : laterController.signal;
      },
    }) as AdapterCallOptions;
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        fetch: () => new Promise(() => undefined),
      },
    });

    const pending = reader.fetchEntries(source, null, options);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    expect(reads).toBe(1);
  });

  it("keeps abort authoritative when transport reports a different failure", async () => {
    const controller = new AbortController();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        async fetch(): Promise<RssTransportDocument> {
          controller.abort();
          throw new AcquisitionError("network_error", false, null);
        },
      },
    });

    await expect(
      reader.fetchEntries(source, null, { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "aborted" });
  });

  it.each(["pending", "later rejection"] as const)(
    "terminates when transport aborts before returning a %s promise",
    async (mode) => {
      const controller = new AbortController();
      let rejectRequest!: (reason?: unknown) => void;
      const reader = createFeedReader({
        policy: DEFAULT_ADAPTER_POLICY,
        transport: {
          fetch(): Promise<RssTransportDocument> {
            controller.abort();
            if (mode === "pending") {
              return new Promise(() => undefined);
            }
            return new Promise((_resolve, reject) => {
              rejectRequest = reject;
            });
          },
        },
      });

      await expect(
        reader.fetchEntries(source, null, { signal: controller.signal }),
      ).rejects.toMatchObject({ reason: "aborted" });

      if (mode === "later rejection") {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        try {
          rejectRequest(new Error("late transport rejection"));
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(unhandled).toEqual([]);
        } finally {
          process.removeListener("unhandledRejection", onUnhandled);
        }
      }
    },
  );

  it("does not start transport when abort becomes visible after listener registration", async () => {
    const controller = new AbortController();
    let abortedReads = 0;
    const signal = new Proxy(controller.signal, {
      get(target, property, receiver) {
        if (property === "aborted") {
          abortedReads += 1;
          return abortedReads >= 3;
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const transportFetch = vi.fn<RssTransport["fetch"]>();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: { fetch: transportFetch },
    });

    await expect(
      reader.fetchEntries(source, null, { signal }),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(abortedReads).toBeGreaterThanOrEqual(3);
    expect(transportFetch).not.toHaveBeenCalled();
  });

  it("rejects result schema failures and never closes the injected transport", async () => {
    const close = vi.fn();
    const parse = vi
      .spyOn(sourceEntriesSchema, "parse")
      .mockImplementationOnce(() => {
        throw new Error("schema failure");
      });
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        async fetch() {
          return {
            finalUrl: RSS_FIXTURE_URL,
            body: rssFeed("<item><guid>id</guid></item>"),
            receivedResponse: true,
          } as RssTransportDocument;
        },
        close,
      } as RssTransport,
    });

    await expect(reader.fetchEntries(source, null)).rejects.toThrow(
      "schema failure",
    );
    expect(parse).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it("pre-abort sends no request and in-flight abort rejects as aborted", async () => {
    const transportFetch = vi.fn<RssTransport["fetch"]>();
    const preAborted = new AbortController();
    preAborted.abort();
    const preAbortReader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: { fetch: transportFetch },
    });

    await expect(
      preAbortReader.fetchEntries(source, null, {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ reason: "aborted" });
    expect(transportFetch).not.toHaveBeenCalled();

    const controller = new AbortController();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        fetch: () => new Promise(() => undefined),
      },
    });
    const pending = reader.fetchEntries(source, null, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
  });

  it("checks cancellation again after transport completion before publishing entries", async () => {
    const controller = new AbortController();
    const reader = createFeedReader({
      policy: DEFAULT_ADAPTER_POLICY,
      transport: {
        async fetch() {
          controller.abort();
          return documentWith(
            rssFeed("<item><guid>id</guid><link>article</link></item>"),
          );
        },
      },
    });

    await expect(
      reader.fetchEntries(source, null, { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: "aborted" });
  });

  it("always rejects an over-limit feed without returning a partial list", async () => {
    const reader = createFeedReader({
      policy: parseAdapterPolicy({ maxFeedEntries: 1 }),
      transport: transportReturning(
        documentWith(
          rssFeed("<item><guid>one</guid></item><item><guid>two</guid></item>"),
        ),
      ),
    });

    await expect(reader.fetchEntries(source, null)).rejects.toMatchObject({
      reason: "feed_too_many_entries",
    });
  });
});
