import { afterEach, describe, expect, it } from "vitest";

import { createRestrictedRssTransport } from "../../src/adapters/http/restricted-client.js";
import { parseAdapterPolicy } from "../../src/adapters/options.js";
import { createRssAdapterWithDependencies } from "../../src/adapters/rss-adapter.internal.js";
import { HttpFixture } from "../fixtures/http-fixture.js";
import { sourceEntry } from "../fixtures/rss-content.js";

const fixture = new HttpFixture();
afterEach(async () => fixture.close());

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function adapterForFixture(
  policy: ReturnType<typeof parseAdapterPolicy>,
  onReaderCancelled?: () => void,
) {
  return createRssAdapterWithDependencies(
    { httpPolicy: policy },
    {
      restrictedTransportFactory(signal, requestPolicy) {
        return createRestrictedRssTransport({
          signal,
          policy: requestPolicy,
          resolver: fixture.resolver,
          dispatcherFactory: fixture.dispatcherFactory,
          tracker: {
            dispatcherCreated() {},
            readerCancelled() {
              onReaderCancelled?.();
            },
          },
        });
      },
    },
  );
}

function feedXml(articleUrl: string, title = "Fixture"): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><guid>${title}</guid><title>${title}</title><link>${articleUrl}</link><description>Fixture summary</description></item></channel></rss>`;
}

describe("RSS adapter restricted HTTP integration", () => {
  it("fetches a feed and its article through the production transport seam", async () => {
    await fixture.start();
    fixture
      .route("/feed", ({ response }) => {
        response.setHeader(
          "content-type",
          "application/rss+xml; charset=utf-8",
        );
        response.end(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><guid>one</guid><title>Story</title><link>${fixture.origin}/article</link><description>Fixture summary</description></item></channel></rss>`,
        );
      })
      .route("/article", ({ response }) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(
          "<!doctype html><html><body><article><p>This article contains enough readable fixture text to pass the configured extraction threshold without using any external network.</p></article></body></html>",
        );
      });
    const policy = parseAdapterPolicy({
      requestTimeoutMs: 2_000,
      articleMinTextChars: 40,
    });
    const adapter = createRssAdapterWithDependencies(
      { httpPolicy: policy },
      {
        restrictedTransportFactory(signal, requestPolicy) {
          return createRestrictedRssTransport({
            signal,
            policy: requestPolicy,
            resolver: fixture.resolver,
            dispatcherFactory: fixture.dispatcherFactory,
          });
        },
      },
    );
    const entries = await adapter.fetchEntries(
      { id: "fixture", type: "RSS", url: `${fixture.origin}/feed` },
      null,
    );
    expect(entries).toHaveLength(1);
    await expect(adapter.fetchContent(entries[0]!)).resolves.toMatchObject({
      article: { status: "SUCCESS", final_url: `${fixture.origin}/article` },
      acquired_via: "ARTICLE_EXTRACT",
    });
    await settle();
    expect(fixture.requests).toEqual(["/feed", "/article"]);
    expect(fixture.dispatcherAddresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(fixture.pinnedLookupResults).toEqual(fixture.dispatcherAddresses);
    expect(fixture.requestConnectionIds).toEqual([1, 2]);
    expect(fixture.dispatcherCloseStarted).toBe(2);
    expect(fixture.dispatchersClosed).toBe(2);
    expect(fixture.closeCompletedDispatchers.size).toBe(2);
    expect(fixture.dispatcherDestroyStarted).toBe(0);
    expect(fixture.dispatchersDestroyed).toBe(0);
    expect(fixture.destroyCompletedDispatchers.size).toBe(0);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.sockets.size).toBe(0);
    await expect(fixture.close()).resolves.toEqual({
      residualSockets: 0,
      residualDispatchers: 0,
      dispatcherCloseStarted: 2,
      dispatcherCloseFailed: 0,
      dispatchersClosed: 2,
      dispatcherDestroyStarted: 0,
      dispatcherDestroyFailed: 0,
      dispatchersDestroyed: 0,
      serverCloseStarted: 1,
      serverClosed: 1,
      serverCloseFailed: 0,
    });
    await expect(fixture.close()).resolves.toEqual({
      residualSockets: 0,
      residualDispatchers: 0,
      dispatcherCloseStarted: 0,
      dispatcherCloseFailed: 0,
      dispatchersClosed: 0,
      dispatcherDestroyStarted: 0,
      dispatcherDestroyFailed: 0,
      dispatchersDestroyed: 0,
      serverCloseStarted: 0,
      serverClosed: 0,
      serverCloseFailed: 0,
    });
  });

  it("isolates two sequential canceled hanging feeds while a later feed succeeds", async () => {
    await fixture.start();
    const laterUrl = `${fixture.origin}/feed-later`;
    fixture
      .route("/hang-one", ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.write("<rss><channel><title>Hanging one");
      })
      .route("/hang-two", ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.write("<rss><channel><title>Hanging two");
      })
      .route("/feed-later", ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.end(feedXml(laterUrl, "later"));
      });
    let cancelledReads = 0;
    const policy = parseAdapterPolicy({
      requestTimeoutMs: 2_000,
      articleMinTextChars: 40,
    });
    const adapter = adapterForFixture(policy, () => {
      cancelledReads += 1;
    });

    const startHangingFeed = async (path: string) => {
      const controller = new AbortController();
      const pending = adapter.fetchEntries(
        { id: `source-${path}`, type: "RSS", url: `${fixture.origin}${path}` },
        null,
        { signal: controller.signal },
      );
      await waitFor(
        () => fixture.requests.includes(path) && fixture.sockets.size === 1,
        `${path} to establish its connection`,
      );
      return { controller, pending };
    };

    const first = await startHangingFeed("/hang-one");
    const firstDispatcher = fixture.dispatchersCreatedInOrder[0];
    expect(firstDispatcher).toBeDefined();
    expect(fixture.dispatchersCreatedInOrder).toHaveLength(1);
    expect(fixture.dispatchers.size).toBe(1);
    expect(fixture.requestConnectionIds).toEqual([1]);
    expect(fixture.closeCompletedDispatchers.size).toBe(0);
    expect(fixture.destroyCompletedDispatchers.size).toBe(0);

    first.controller.abort();
    await expect(first.pending).rejects.toMatchObject({ reason: "aborted" });
    await waitFor(
      () =>
        fixture.destroyCompletedDispatchers.has(firstDispatcher!) &&
        fixture.sockets.size === 0,
      "only the first hanging dispatcher and socket to be destroyed",
    );
    expect(cancelledReads).toBe(1);
    expect(fixture.dispatchersCreatedInOrder).toHaveLength(1);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.closeCompletedDispatchers.size).toBe(0);

    const second = await startHangingFeed("/hang-two");
    const secondDispatcher = fixture.dispatchersCreatedInOrder[1];
    expect(secondDispatcher).toBeDefined();
    expect(secondDispatcher).not.toBe(firstDispatcher);
    expect(fixture.dispatchersCreatedInOrder).toHaveLength(2);
    expect(fixture.dispatchers.size).toBe(1);
    expect(fixture.requestConnectionIds).toEqual([1, 2]);
    expect(fixture.destroyCompletedDispatchers).toEqual(
      new Set([firstDispatcher]),
    );
    expect(fixture.closeCompletedDispatchers.size).toBe(0);

    second.controller.abort();
    await expect(second.pending).rejects.toMatchObject({ reason: "aborted" });
    await waitFor(
      () =>
        fixture.destroyCompletedDispatchers.has(secondDispatcher!) &&
        fixture.sockets.size === 0,
      "only the second hanging dispatcher and socket to be destroyed",
    );
    expect(cancelledReads).toBe(2);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.closeCompletedDispatchers.size).toBe(0);
    expect(fixture.destroyCompletedDispatchers).toEqual(
      new Set([firstDispatcher, secondDispatcher]),
    );

    await expect(
      adapter.fetchEntries({ id: "later", type: "RSS", url: laterUrl }, null),
    ).resolves.toHaveLength(1);
    const laterDispatcher = fixture.dispatchersCreatedInOrder[2];
    expect(laterDispatcher).toBeDefined();
    expect(laterDispatcher).not.toBe(secondDispatcher);
    await waitFor(
      () => fixture.closeCompletedDispatchers.has(laterDispatcher!),
      "the later successful dispatcher to close",
    );

    expect(cancelledReads).toBe(2);
    expect(fixture.dispatchersCreated).toBe(3);
    expect(fixture.dispatcherDestroyStarted).toBe(2);
    expect(fixture.dispatchersDestroyed).toBe(2);
    expect(fixture.dispatcherCloseStarted).toBe(1);
    expect(fixture.dispatchersClosed).toBe(1);
    expect(fixture.destroyCompletedDispatchers).toEqual(
      new Set([firstDispatcher, secondDispatcher]),
    );
    expect(fixture.closeCompletedDispatchers).toEqual(
      new Set([laterDispatcher]),
    );
    expect(fixture.requestConnectionIds).toEqual([1, 2, 3]);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.sockets.size).toBe(0);
  });

  it("keeps a parallel live feed healthy while the other hanging feed is canceled", async () => {
    await fixture.start();
    let finishLiveFeed: (() => void) | undefined;
    fixture
      .route("/parallel-hang", ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.write("<rss><channel><title>Hanging");
      })
      .route("/parallel-live", ({ response }) => {
        response.setHeader("content-type", "application/rss+xml");
        response.write(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><guid>live</guid><title>Live</title><link>${fixture.origin}/article</link><description>Fixture summary</description>`,
        );
        finishLiveFeed = () => response.end("</item></channel></rss>");
      });
    let cancelledReads = 0;
    const policy = parseAdapterPolicy({
      requestTimeoutMs: 2_000,
      articleMinTextChars: 40,
    });
    const adapter = adapterForFixture(policy, () => {
      cancelledReads += 1;
    });
    const source = (path: string) => ({
      id: `source-${path}`,
      type: "RSS" as const,
      url: `${fixture.origin}${path}`,
    });
    const hangingController = new AbortController();
    const hanging = adapter.fetchEntries(source("/parallel-hang"), null, {
      signal: hangingController.signal,
    });
    await waitFor(
      () =>
        fixture.requests.includes("/parallel-hang") &&
        fixture.dispatchersCreatedInOrder.length === 1,
      "the parallel hanging request",
    );

    const live = adapter.fetchEntries(source("/parallel-live"), null);
    await waitFor(
      () =>
        fixture.requests.includes("/parallel-live") &&
        fixture.dispatchersCreatedInOrder.length === 2 &&
        fixture.sockets.size === 2,
      "the parallel live request",
    );
    const hangingDispatcher = fixture.dispatchersCreatedInOrder[0];
    const liveDispatcher = fixture.dispatchersCreatedInOrder[1];
    expect(hangingDispatcher).toBeDefined();
    expect(liveDispatcher).toBeDefined();
    expect(liveDispatcher).not.toBe(hangingDispatcher);
    expect(fixture.requestConnectionIds).toEqual([1, 2]);
    expect(fixture.dispatchers).toEqual(
      new Set([hangingDispatcher, liveDispatcher]),
    );
    expect(fixture.destroyCompletedDispatchers.size).toBe(0);
    expect(fixture.closeCompletedDispatchers.size).toBe(0);

    hangingController.abort();
    await expect(hanging).rejects.toMatchObject({ reason: "aborted" });
    await waitFor(
      () =>
        fixture.destroyCompletedDispatchers.has(hangingDispatcher!) &&
        fixture.sockets.size === 1,
      "only the canceled parallel request to be destroyed",
    );
    expect(cancelledReads).toBe(1);
    expect(fixture.closeCompletedDispatchers.has(liveDispatcher!)).toBe(false);
    expect(fixture.destroyCompletedDispatchers.has(liveDispatcher!)).toBe(
      false,
    );
    expect(fixture.dispatchers.has(liveDispatcher!)).toBe(true);
    expect(fixture.dispatchers.size).toBe(1);
    expect(fixture.requestConnectionIds).toEqual([1, 2]);

    expect(finishLiveFeed).toBeTypeOf("function");
    finishLiveFeed!();
    await expect(live).resolves.toHaveLength(1);
    await waitFor(
      () => fixture.closeCompletedDispatchers.has(liveDispatcher!),
      "the live dispatcher to close normally",
    );

    expect(cancelledReads).toBe(1);
    expect(fixture.dispatchersCreated).toBe(2);
    expect(fixture.dispatcherDestroyStarted).toBe(1);
    expect(fixture.dispatchersDestroyed).toBe(1);
    expect(fixture.dispatcherCloseStarted).toBe(1);
    expect(fixture.dispatchersClosed).toBe(1);
    expect(fixture.destroyCompletedDispatchers).toEqual(
      new Set([hangingDispatcher]),
    );
    expect(fixture.closeCompletedDispatchers).toEqual(
      new Set([liveDispatcher]),
    );
    expect(fixture.requestConnectionIds).toEqual([1, 2]);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.sockets.size).toBe(0);
  });

  it.each([
    [
      "invalid redirect",
      "/article-invalid-redirect",
      "invalid_redirect",
      "FAILED",
      "closed",
      "http:/missing-authority",
    ],
    [
      "blocked redirect",
      "/article-blocked-redirect",
      "blocked_url",
      "BLOCKED",
      "closed",
      "http://localhost/blocked",
    ],
    [
      "byte limit",
      "/article-byte-limit",
      "response_too_large",
      "FAILED",
      "destroyed",
      null,
    ],
    [
      "unsupported MIME",
      "/article-mime",
      "unsupported_mime",
      "FAILED",
      "destroyed",
      null,
    ],
    ["timeout", "/article-timeout", "timeout", "FAILED", "destroyed", null],
  ] as const)(
    "returns the summary fallback for an article %s through the real transport",
    async (_case, path, reason, status, cleanup, location) => {
      await fixture.start();
      fixture.route(path, ({ response }) => {
        switch (reason) {
          case "invalid_redirect":
          case "blocked_url":
            if (location === null) throw new Error("redirect location missing");
            response.statusCode = 302;
            response.setHeader("location", location);
            response.end("redirect");
            return;
          case "response_too_large":
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.setHeader("content-length", "1025");
            response.end("x".repeat(1_025));
            return;
          case "unsupported_mime":
            response.setHeader("content-type", "text/plain");
            response.end("plain text");
            return;
          case "timeout":
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.write("<!doctype html><html><body>");
            return;
        }
      });
      const policy = parseAdapterPolicy({
        requestTimeoutMs: 100,
        articleMaxBytes: 1_024,
        articleMinTextChars: 40,
      });
      let cancelledReads = 0;
      const adapter = adapterForFixture(policy, () => {
        cancelledReads += 1;
      });
      const articleUrl = `${fixture.origin}${path}`;

      await expect(
        adapter.fetchContent(
          sourceEntry({
            url: articleUrl,
            summary: { value: "Fixture summary", format: "TEXT" },
          }),
        ),
      ).resolves.toMatchObject({
        body: "Fixture summary",
        summary: "Fixture summary",
        content_kind: "SUMMARY",
        acquired_via: "SOURCE_FALLBACK",
        completeness_basis: "PARTIAL_ONLY",
        article: {
          status,
          reason,
          final_url: articleUrl,
        },
      });
      if (cleanup === "closed") {
        await waitFor(
          () => fixture.dispatchersClosed === 1,
          "the failed redirect dispatcher to close",
        );
      } else {
        await waitFor(
          () => fixture.dispatchersDestroyed === 1,
          "the failed article response dispatcher to destroy",
        );
      }

      expect(cancelledReads).toBe(1);
      expect(fixture.dispatchersCreated).toBe(1);
      expect(fixture.dispatcherAddresses).toEqual([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(fixture.requests).toEqual([path]);
      expect(fixture.hosts).toEqual(["fixture.example.test"]);
      expect(fixture.connectServernames).toEqual(["fixture.example.test"]);
      expect(fixture.dispatchers.size).toBe(0);
      expect(fixture.requestConnectionIds).toEqual([1]);
      await waitFor(
        () => fixture.sockets.size === 0,
        "the failed article server socket to close",
      );
      expect(fixture.sockets.size).toBe(0);
      if (cleanup === "closed") {
        expect(fixture.dispatcherDestroyStarted).toBe(0);
        expect(fixture.closeCompletedDispatchers.size).toBe(1);
        expect(fixture.destroyCompletedDispatchers.size).toBe(0);
      } else {
        expect(fixture.dispatcherCloseStarted).toBe(0);
        expect(fixture.closeCompletedDispatchers.size).toBe(0);
        expect(fixture.destroyCompletedDispatchers.size).toBe(1);
      }
    },
  );

  it("fixture teardown fails when a socket and dispatcher are deliberately leaked", async () => {
    await fixture.start();
    fixture.route("/leak", ({ response }) => {
      response.setHeader("content-type", "application/rss+xml");
      response.write("<rss><channel>");
    });
    const dispatcher = fixture.dispatcherFactory({
      address: "93.184.216.34",
      family: 4,
    });
    const response = await globalThis.fetch(`${fixture.origin}/leak`, {
      dispatcher,
      [Symbol.for("undici.dispatcher")]: dispatcher,
    });
    expect(response.body).not.toBeNull();
    await waitFor(
      () => fixture.requests.includes("/leak") && fixture.sockets.size === 1,
      "the deliberately leaked connection",
    );

    await expect(fixture.close()).rejects.toThrow(
      /Fixture teardown found residual resources: sockets=1, dispatchers=1/,
    );
  });
});
