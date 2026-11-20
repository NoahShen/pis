import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
  zstdCompressSync,
} from "node:zlib";
import { getEventListeners } from "node:events";

import { afterEach, describe, expect, it } from "vitest";
import { Agent, Dispatcher } from "undici";

import {
  canonicalizeRestrictedUrl,
  createPinnedLookup,
  resolveRestrictedAddress,
  validateResolvedAddress,
} from "../../src/adapters/http/address-policy.js";
import {
  decodeResponseBody,
  validateContentEncoding,
  validateContentType,
} from "../../src/adapters/http/encoding.js";
import { createRestrictedRssTransport } from "../../src/adapters/http/restricted-client.js";
import { parseAdapterPolicy } from "../../src/adapters/options.js";
import * as publicAdapterApi from "../../src/adapters/rss-adapter.js";
import { AcquisitionError } from "../../src/adapters/transport.js";
import { HttpFixture } from "../fixtures/http-fixture.js";

const fixture = new HttpFixture();
const policy = parseAdapterPolicy({ requestTimeoutMs: 2_000, maxRedirects: 2 });

afterEach(async () => {
  await settle();
  await fixture.close();
});

function acquisitionReason(error: unknown): string | undefined {
  return error instanceof AcquisitionError ? error.reason : undefined;
}

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

function watchUnhandledRejections(): { stop: () => number } {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  process.on("unhandledRejection", listener);
  return {
    stop() {
      process.off("unhandledRejection", listener);
      return count;
    },
  };
}

class CloseFailingDispatcher extends Dispatcher {
  closeCalls = 0;
  destroyCalls = 0;

  override dispatch(): boolean {
    return false;
  }

  override async close(): Promise<void> {
    this.closeCalls += 1;
    throw new Error("close failed");
  }

  override async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }
}

class HangingCloseDispatcher extends Dispatcher {
  closeCalls = 0;
  destroyCalls = 0;

  override dispatch(): boolean {
    return false;
  }

  override close(): Promise<void> {
    this.closeCalls += 1;
    return new Promise(() => {});
  }

  override async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }
}

describe("restricted URL and address policy", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2002::1",
    "::ffff:127.0.0.1",
  ])("rejects special address %s", (address) => {
    expect(() => validateResolvedAddress(address)).toThrow(AcquisitionError);
  });

  it("accepts public IPv4 and IPv6 addresses", () => {
    expect(validateResolvedAddress("93.184.216.34")).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    expect(validateResolvedAddress("2606:4700:4700::1111").family).toBe(6);
  });

  it("canonicalizes private numeric URLs and rejects unsafe URL syntax", async () => {
    await expect(
      resolveRestrictedAddress(new URL("http://0x7f000001/")),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    await expect(
      resolveRestrictedAddress(new URL("http://127.1/")),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    expect(() => canonicalizeRestrictedUrl("http://user@8.8.8.8/")).toThrow();
    expect(() => canonicalizeRestrictedUrl("http://8.8.8.8/#x")).toThrow();
    expect(() => canonicalizeRestrictedUrl("http://8.8.8.8:8080/")).toThrow();
    expect(() => canonicalizeRestrictedUrl("http://localhost/")).toThrow();
    expect(() => canonicalizeRestrictedUrl("http://foo.localhost/")).toThrow();
  });

  it.each([
    ["NUL", "http://8.8.8.8/\u0000"],
    ["TAB", "http://8.8.8.8/\t"],
    ["LF", "http://8.8.8.8/\n"],
    ["DEL", "http://8.8.8.8/\u007f"],
  ])("rejects raw %s control characters before URL parsing", (_name, url) => {
    expect(() => canonicalizeRestrictedUrl(url)).toThrow(AcquisitionError);
  });

  it.each([
    "http://user:pass@8.8.8.8/",
    "http://8.8.8.8/#fragment",
    "http://8.8.8.8/#",
    "http://8.8.8.8:8080/",
    "http://localhost/",
    "http://localhost./",
    "http://foo.localhost/",
    "http://foo.localhost./",
  ])("rejects unsafe canonical URL %s", (url) => {
    expect(() => canonicalizeRestrictedUrl(url)).toThrow(AcquisitionError);
  });

  it.each([
    ["four slashes with userinfo", "http:////@8.8.8.8/"],
    ["five slashes with userinfo", "http://///@8.8.8.8/"],
    ["empty authority", "http:///8.8.8.8/"],
    ["backslash authority separator", "http:\\\\@8.8.8.8/"],
  ])("rejects nonstandard raw %s", (_case, url) => {
    expect(() => canonicalizeRestrictedUrl(url)).toThrow(AcquisitionError);
  });

  it.each([
    "2001::1",
    "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff",
    "3fff::1",
    "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
    "240.0.0.0",
    "255.255.255.255",
    "4000::1",
  ])("blocks special-range boundary %s", (address) => {
    expect(() => validateResolvedAddress(address)).toThrow(AcquisitionError);
  });

  it.each(["8.8.8.8", "223.255.255.255", "2000::1", "3fff:1000::1"])(
    "accepts public boundary %s",
    (address) => {
      expect(() => validateResolvedAddress(address)).not.toThrow();
    },
  );

  it("allows only explicitly relaxable special ranges when private addresses are enabled", () => {
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "2001:db8::1",
      "3fff::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(() =>
        validateResolvedAddress(address, undefined, true),
      ).not.toThrow();
    }
    for (const address of [
      "224.0.0.1",
      "255.255.255.255",
      "ff02::1",
      "2001::1",
      "2002::1",
      "4000::1",
    ]) {
      expect(() => validateResolvedAddress(address, undefined, true)).toThrow(
        AcquisitionError,
      );
    }
  });

  it("retains syntax, family, and DNS result-count limits when private addresses are enabled", async () => {
    expect(() => validateResolvedAddress("not-an-ip", undefined, true)).toThrow(
      AcquisitionError,
    );
    expect(() => validateResolvedAddress("127.0.0.1", 6, true)).toThrow(
      AcquisitionError,
    );
    await expect(
      resolveRestrictedAddress(
        new URL("http://fixture.example.test"),
        async () => [
          { address: "127.0.0.1", family: 4 },
          { address: "not-an-ip", family: 4 },
        ],
        true,
      ),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    await expect(
      resolveRestrictedAddress(
        new URL("http://fixture.example.test"),
        async () =>
          Array.from({ length: 33 }, () => ({
            address: "127.0.0.1",
            family: 4,
          })),
        true,
      ),
    ).rejects.toMatchObject({ reason: "blocked_url" });
  });

  it("normalizes an IPv4-mapped public address without treating it as IPv6", () => {
    expect(validateResolvedAddress("::ffff:8.8.8.8")).toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    expect(validateResolvedAddress("::ffff:8.8.8.8", 6)).toEqual({
      address: "8.8.8.8",
      family: 4,
    });
    expect(() => validateResolvedAddress("::ffff:10.0.0.1", 6)).toThrow(
      AcquisitionError,
    );
    expect(() => validateResolvedAddress("::ffff:127.0.0.1", 4)).toThrow(
      AcquisitionError,
    );
  });

  it("rejects empty, oversized, and mixed DNS answers before a connection", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    await expect(
      resolveRestrictedAddress(
        new URL("http://fixture.example.test"),
        resolver,
      ),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    await expect(
      resolveRestrictedAddress(
        new URL("http://fixture.example.test"),
        async () =>
          Array.from({ length: 33 }, () => ({
            address: "93.184.216.34",
            family: 4,
          })),
      ),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    await expect(
      resolveRestrictedAddress(
        new URL("http://fixture.example.test"),
        async () => [],
      ),
    ).rejects.toMatchObject({ reason: "dns_failed" });
  });

  it("pin lookup returns only the validated address", async () => {
    const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
    const result = await new Promise<unknown>((resolve, reject) => {
      lookup("fixture.example.test", { all: true }, (error, address) => {
        if (error !== null) reject(error);
        else resolve(address);
      });
    });
    expect(result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("uses one validated DNS answer during a real connection despite a hostile rebinding answer", async () => {
    await fixture.start();
    fixture.route("/pinned", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.end("<rss/>");
    });
    let resolverCalls = 0;
    let dispatchersCreated = 0;
    let dispatchersClosed = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: async () => {
        resolverCalls += 1;
        if (resolverCalls > 1) {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        return [{ address: "93.184.216.34", family: 4 }];
      },
      connector: fixture.connector,
      tracker: {
        dispatcherCreated: () => {
          dispatchersCreated += 1;
        },
        dispatcherClosed: () => {
          dispatchersClosed += 1;
        },
      },
    });

    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/pinned`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ body: "<rss/>" });
    await waitFor(
      () => dispatchersClosed === 1 && fixture.sockets.size === 0,
      "the pinned dispatcher and fixture socket to close",
    );

    expect(resolverCalls).toBe(1);
    expect(dispatchersCreated).toBe(1);
    expect(dispatchersClosed).toBe(1);
    expect(fixture.dispatchersCreated).toBe(0);
    expect(fixture.productionConnectorCalls).toEqual([
      {
        hostname: fixture.host,
        host: fixture.host,
        protocol: "http:",
        port: "80",
        servername: undefined,
      },
    ]);
    expect(fixture.pinnedLookupResults).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(fixture.hosts).toEqual([fixture.host]);
    expect(fixture.connectServernames).toEqual([]);
    expect(fixture.requestConnectionIds).toEqual([1]);
    expect(fixture.sockets.size).toBe(0);
  });

  it("preserves HTTPS host and SNI while using the production pinned connector path", async () => {
    let resolverCalls = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: async () => {
        resolverCalls += 1;
        return [{ address: "93.184.216.34", family: 4 }];
      },
      connector: (options, callback) => {
        fixture.productionConnectorCalls.push({
          hostname: options.hostname,
          host: options.host,
          protocol: options.protocol,
          port: options.port,
          servername: options.servername,
        });
        if (typeof options.lookup !== "function") {
          callback(
            new Error("The production dispatcher lost its pinned lookup"),
            null,
          );
          return;
        }
        options.lookup(options.hostname, { all: true }, (error, resolved) => {
          if (error !== null || !Array.isArray(resolved)) {
            callback(error ?? new Error("HTTPS pinned lookup failed"), null);
            return;
          }
          fixture.pinnedLookupResults.push(...resolved);
          callback(new Error("HTTPS fixture stops before TLS"), null);
        });
      },
    });

    await expect(
      transport.fetch({
        kind: "feed",
        url: `https://${fixture.host}/pinned`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "network_error" });
    expect(resolverCalls).toBe(1);
    expect(fixture.productionConnectorCalls).toEqual([
      {
        hostname: fixture.host,
        host: fixture.host,
        protocol: "https:",
        port: "443",
        servername: fixture.host,
      },
    ]);
    expect(fixture.pinnedLookupResults).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(fixture.requests).toEqual([]);
  });
});

describe("restricted native fetch transport", () => {
  it("passes an exact undici dispatcher through native fetch", async () => {
    await fixture.start();
    fixture.route("/probe", ({ response }) => {
      response.end("ok");
    });
    const dispatcher = fixture.dispatcherFactory({
      address: "93.184.216.34",
      family: 4,
    });
    try {
      const response = await globalThis
        .fetch(`${fixture.origin}/probe`, {
          dispatcher,
          [Symbol.for("undici.dispatcher")]: dispatcher,
        })
        .catch((error: unknown) => {
          throw new Error(
            `native fetch probe failed after ${fixture.requests.join(",")}`,
            { cause: error },
          );
        });
      await expect(response.text()).resolves.toBe("ok");
    } finally {
      await dispatcher.destroy();
    }
  });

  it("performs a real fixture request and closes its owned dispatcher", async () => {
    await fixture.start();
    fixture.route("/ok", ({ response }) => {
      response.setHeader("content-type", "application/xml; charset=utf-8");
      response.end("<rss/>");
    });
    const caller = new AbortController();
    const transport = createRestrictedRssTransport({
      signal: caller.signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      tracker: { dispatcherCreated() {} },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/ok`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({
      body: "<rss/>",
      finalUrl: `${fixture.origin}/ok`,
    });
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("rejects a loopback resolver by default and connects to the real fixture only when enabled", async () => {
    await fixture.start();
    fixture.route("/loopback", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.end("<rss>loopback</rss>");
    });
    const resolver = async (): Promise<
      readonly { address: string; family: number }[]
    > => [{ address: "127.0.0.1", family: 4 }];
    let dispatchersCreated = 0;
    const dispatcherFactory = (address: {
      address: string;
      family: number;
    }) => {
      dispatchersCreated += 1;
      return fixture.dispatcherFactory(address);
    };
    const protectedTransport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver,
      dispatcherFactory,
    });
    await expect(
      protectedTransport.fetch({
        kind: "feed",
        url: `${fixture.origin}/loopback`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    expect(dispatchersCreated).toBe(0);
    expect(fixture.requests).toEqual([]);

    const relaxedTransport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver,
      dispatcherFactory,
      allowPrivateAddresses: true,
    });
    await expect(
      relaxedTransport.fetch({
        kind: "feed",
        url: `${fixture.origin}/loopback`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ body: "<rss>loopback</rss>" });
    await waitFor(
      () => fixture.dispatchersClosed === 1 && fixture.sockets.size === 0,
      "the relaxed loopback dispatcher and socket to close",
    );
    expect(dispatchersCreated).toBe(1);
    expect(fixture.dispatcherAddresses).toEqual([
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(fixture.requests).toEqual(["/loopback"]);
  });

  it("continues to use public unicast addresses when private addresses are enabled", async () => {
    await fixture.start();
    fixture.route("/relaxed-public", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.end("<rss>public</rss>");
    });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      allowPrivateAddresses: true,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/relaxed-public`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ body: "<rss>public</rss>" });
    await waitFor(
      () => fixture.dispatchersClosed === 1 && fixture.sockets.size === 0,
      "the relaxed public dispatcher and socket to close",
    );
    expect(fixture.dispatcherAddresses).toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(fixture.requests).toEqual(["/relaxed-public"]);
  });

  it("keeps URL and localhost restrictions when private addresses are enabled", async () => {
    let lookups = 0;
    let dispatchers = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      allowPrivateAddresses: true,
      resolver: async () => {
        lookups += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
      dispatcherFactory: () => {
        dispatchers += 1;
        return new Agent();
      },
      fetch: async () => {
        throw new Error("unsafe URL reached fetch");
      },
    });
    for (const url of [
      "http://localhost/",
      "https://localhost./",
      "http://user:secret@127.0.0.1/",
      "http://127.0.0.1:8080/",
      "ftp://127.0.0.1/",
      "http://127.0.0.1/#fragment",
    ]) {
      await expect(
        transport.fetch({
          kind: "feed",
          url,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason: "blocked_url" });
    }
    expect(lookups).toBe(0);
    expect(dispatchers).toBe(0);
  });

  it("retains timeout and caller cancellation when private addresses are enabled", async () => {
    await fixture.start();
    fixture
      .route("/relaxed-timeout", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.write("<rss>");
      })
      .route("/relaxed-cancel", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.write("<rss>");
      });
    let cancelled = 0;
    const transportFor = (controller: AbortController) =>
      createRestrictedRssTransport({
        signal: controller.signal,
        policy,
        allowPrivateAddresses: true,
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
        dispatcherFactory: fixture.dispatcherFactory,
        tracker: {
          dispatcherCreated() {},
          readerCancelled() {
            cancelled += 1;
          },
        },
      });

    await expect(
      transportFor(new AbortController()).fetch({
        kind: "feed",
        url: `${fixture.origin}/relaxed-timeout`,
        timeoutMs: 50,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: true });
    await waitFor(
      () => fixture.dispatchersDestroyed === 1 && fixture.sockets.size === 0,
      "the relaxed timeout dispatcher and socket to clean up",
    );
    expect(cancelled).toBe(1);

    const controller = new AbortController();
    const pending = transportFor(controller).fetch({
      kind: "feed",
      url: `${fixture.origin}/relaxed-cancel`,
      timeoutMs: 2_000,
      maxBytes: 1_024,
    });
    await waitFor(
      () =>
        fixture.requests.includes("/relaxed-cancel") &&
        fixture.dispatchers.size === 1,
      "the relaxed cancellable request",
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      reason: "aborted",
      receivedResponse: true,
    });
    await waitFor(
      () =>
        cancelled === 2 &&
        fixture.dispatchersDestroyed === 2 &&
        fixture.sockets.size === 0,
      "the relaxed canceled reader and dispatcher to clean up",
    );
    expect(cancelled).toBe(2);
    expect(fixture.dispatcherDestroyStarted).toBe(2);
    expect(fixture.dispatchersDestroyed).toBe(2);
    expect(fixture.dispatchers.size).toBe(0);
  });

  it("revalidates relaxed redirect targets at every hop", async () => {
    await fixture.start();
    fixture
      .route("/start-relaxed", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "http://other.example.test/end-relaxed");
        response.end("redirect");
      })
      .route("/end-relaxed", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.end("<rss>redirected</rss>");
      });
    let resolverCalls = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      allowPrivateAddresses: true,
      resolver: async () => {
        resolverCalls += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/start-relaxed`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({
      body: "<rss>redirected</rss>",
      finalUrl: "http://other.example.test/end-relaxed",
    });
    await settle();
    expect(resolverCalls).toBe(2);
    expect(fixture.dispatcherAddresses).toEqual([
      { address: "127.0.0.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(fixture.requests).toEqual(["/start-relaxed", "/end-relaxed"]);
    expect(fixture.dispatchersClosed).toBe(2);
  });

  it("still rejects unsafe redirect targets when private addresses are enabled", async () => {
    await fixture.start();
    fixture.route("/unsafe-relaxed", ({ response }) => {
      response.statusCode = 302;
      response.setHeader("location", "http://localhost/blocked");
      response.end("redirect");
    });
    let resolverCalls = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      allowPrivateAddresses: true,
      resolver: async () => {
        resolverCalls += 1;
        return [{ address: "127.0.0.1", family: 4 }];
      },
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/unsafe-relaxed`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "blocked_url", receivedResponse: true });
    await settle();
    expect(resolverCalls).toBe(1);
    expect(fixture.requests).toEqual(["/unsafe-relaxed"]);
    expect(fixture.dispatchersClosed).toBe(1);
  });

  it("follows relative redirects and enforces decompressed byte limits", async () => {
    const expanded = "x".repeat(2_048);
    await fixture.start();
    fixture
      .route("/start", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/gzip");
        response.end("redirect");
      })
      .route("/gzip", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.setHeader("content-encoding", "gzip");
        response.end(gzipSync(expanded));
      });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/gzip`,
        timeoutMs: 2_000,
        maxBytes: 5_000,
      }),
    ).resolves.toMatchObject({ body: expanded });
    expect(fixture.requests).toEqual(["/gzip"]);
  });

  it("rejects an oversized plain response before reading it", async () => {
    const large = "x".repeat(2_048);
    await fixture.start();
    fixture.route("/large", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.setHeader("content-length", String(large.length));
      response.end(large);
    });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/large`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      reason: "response_too_large",
      receivedResponse: true,
    });
  });

  it.each([
    ["below actual", "0", true],
    ["equal to actual", "6", true],
    ["above the limit", "7", false],
    ["forged huge", "999999", false],
    ["invalid", "not-a-number", true],
    ["negative", "-1", true],
  ] as const)(
    "handles Content-Length %s without trusting it as the body size",
    async (_case, contentLength, accepted) => {
      let cancelled = 0;
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
        tracker: {
          dispatcherCreated() {},
          readerCancelled() {
            cancelled += 1;
          },
        },
        fetch: async () =>
          new Response("<rss/>", {
            headers: {
              "content-type": "application/xml",
              "content-length": contentLength,
            },
          }),
      });
      const result = transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/content-length",
        timeoutMs: 2_000,
        maxBytes: 6,
      });
      if (accepted) {
        await expect(result).resolves.toMatchObject({ body: "<rss/>" });
        expect(cancelled).toBe(0);
      } else {
        await expect(result).rejects.toMatchObject({
          reason: "response_too_large",
        });
        expect(cancelled).toBe(1);
      }
    },
  );

  it.each([
    [1_023, 1_024, true],
    [1_024, 1_024, true],
    [1_025, 1_024, false],
  ] as const)(
    "enforces decompressed byte boundaries (body=%d, limit=%d)",
    async (bodyLength, limit, accepted) => {
      const body = "x".repeat(bodyLength);
      await fixture.start();
      fixture.route("/boundary", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.end(body);
      });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
      });
      const result = transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/boundary`,
        timeoutMs: 2_000,
        maxBytes: limit,
      });
      if (accepted) {
        await expect(result).resolves.toMatchObject({ body });
      } else {
        await expect(result).rejects.toMatchObject({
          reason: "response_too_large",
        });
      }
    },
  );

  it.each([
    ["gzip", gzipSync],
    ["x-gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
    ["zstd", zstdCompressSync],
  ] as const)(
    "accepts supported %s content encoding",
    async (encoding, encode) => {
      await fixture.start();
      fixture.route("/encoded", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.setHeader("content-encoding", encoding);
        response.end(encode("<rss/>"));
      });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/encoded`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).resolves.toMatchObject({ body: "<rss/>" });
    },
  );

  it.each(
    (
      [
        ["gzip", gzipSync],
        ["x-gzip", gzipSync],
        ["deflate", deflateSync],
        ["br", brotliCompressSync],
        ["zstd", zstdCompressSync],
      ] as const
    ).flatMap(([encoding, encode]) =>
      [1_023, 1_024, 1_025].map(
        (bodyLength) => [encoding, encode, bodyLength] as const,
      ),
    ),
  )(
    "enforces %s native-decompressed length %d against limit 1024",
    async (encoding, encode, bodyLength) => {
      const body = "x".repeat(bodyLength);
      const compressed = encode(body);
      expect(compressed.byteLength).toBeLessThan(1_024);
      let cancelled = 0;
      await fixture.start();
      fixture.route(`/native-${encoding}-${bodyLength}`, ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.setHeader("content-encoding", encoding);
        response.setHeader("content-length", String(compressed.byteLength));
        response.end(compressed);
      });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
        tracker: {
          dispatcherCreated() {},
          readerCancelled() {
            cancelled += 1;
          },
        },
      });
      const result = transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/native-${encoding}-${bodyLength}`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      });
      const accepted = bodyLength <= 1_024;
      if (accepted) {
        await expect(result).resolves.toMatchObject({ body });
        await waitFor(
          () => fixture.dispatchersClosed === 1 && fixture.sockets.size === 0,
          `${encoding} dispatcher and socket close`,
        );
      } else {
        await expect(result).rejects.toMatchObject({
          reason: "response_too_large",
        });
        await waitFor(
          () =>
            fixture.dispatchersDestroyed === 1 && fixture.sockets.size === 0,
          `${encoding} dispatcher and socket destroy`,
        );
      }

      const dispatcher = fixture.dispatchersCreatedInOrder[0];
      expect(dispatcher).toBeDefined();
      expect(fixture.dispatchersCreated).toBe(1);
      expect(cancelled).toBe(accepted ? 0 : 1);
      expect(fixture.requestConnectionIds).toEqual([1]);
      expect(fixture.dispatchers.size).toBe(0);
      expect(fixture.sockets.size).toBe(0);
      if (accepted) {
        expect(fixture.closeCompletedDispatchers).toEqual(
          new Set([dispatcher]),
        );
        expect(fixture.destroyCompletedDispatchers.size).toBe(0);
      } else {
        expect(fixture.closeCompletedDispatchers.size).toBe(0);
        expect(fixture.destroyCompletedDispatchers).toEqual(
          new Set([dispatcher]),
        );
      }
    },
  );

  it("rejects a high-expansion native gzip payload after decompression", async () => {
    const expanded = "x".repeat(64 * 1_024);
    const compressed = gzipSync(expanded);
    expect(compressed.byteLength).toBeLessThan(1_024);
    await fixture.start();
    fixture.route("/high-expansion", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.setHeader("content-encoding", "gzip");
      response.setHeader("content-length", String(compressed.byteLength));
      response.end(compressed);
    });
    let cancelled = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      tracker: {
        dispatcherCreated() {},
        readerCancelled() {
          cancelled += 1;
        },
      },
    });

    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/high-expansion`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "response_too_large" });
    await waitFor(
      () => fixture.dispatchersDestroyed === 1,
      "high-expansion dispatcher destroy",
    );
    expect(cancelled).toBe(1);
    expect(fixture.dispatchersCreated).toBe(1);
    expect(fixture.dispatcherDestroyStarted).toBe(1);
    expect(fixture.closeCompletedDispatchers.size).toBe(0);
    expect(fixture.destroyCompletedDispatchers.size).toBe(1);
    expect(fixture.dispatchers.size).toBe(0);
    expect(fixture.sockets.size).toBe(0);
  });

  it("rejects a native zstd payload by decompressed length and cleans up exactly once", async () => {
    const expanded = "<rss>" + "x".repeat(64 * 1_024) + "</rss>";
    const compressed = zstdCompressSync(expanded);
    expect(compressed.byteLength).toBeLessThan(1_024);
    const responseHeaders = Object.freeze({
      "content-type": "application/xml",
      "content-encoding": "zstd",
      "content-length": String(compressed.byteLength),
    });
    await fixture.start();
    fixture.route("/native-zstd-overflow", ({ response }) => {
      for (const [name, value] of Object.entries(responseHeaders)) {
        response.setHeader(name, value);
      }
      response.end(compressed);
    });
    let cancelled = 0;
    let destroyed = 0;
    let observedEncoding: string | null = null;
    let observedLength: string | null = null;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      fetch: async (input, init) => {
        const response = await globalThis.fetch(input, init);
        observedEncoding = response.headers.get("content-encoding");
        observedLength = response.headers.get("content-length");
        return response;
      },
      tracker: {
        dispatcherCreated() {},
        dispatcherDestroyed() {
          destroyed += 1;
        },
        readerCancelled() {
          cancelled += 1;
        },
      },
    });

    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/native-zstd-overflow`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      reason: "response_too_large",
      receivedResponse: true,
    });
    await waitFor(
      () =>
        cancelled === 1 &&
        destroyed === 1 &&
        fixture.dispatchersDestroyed === 1 &&
        fixture.sockets.size === 0,
      "the zstd overflow reader and dispatcher to clean up once",
    );
    expect(Number(responseHeaders["content-length"])).toBe(
      compressed.byteLength,
    );
    expect(observedEncoding).toBe("zstd");
    expect(observedLength).toBe(String(compressed.byteLength));
    expect(new TextEncoder().encode(expanded).byteLength).toBeGreaterThan(
      1_024,
    );
    expect(cancelled).toBe(1);
    expect(destroyed).toBe(1);
    expect(fixture.dispatchersCreated).toBe(1);
    expect(fixture.dispatcherDestroyStarted).toBe(1);
    expect(fixture.dispatchersDestroyed).toBe(1);
    expect(fixture.dispatcherCloseStarted).toBe(0);
    expect(fixture.dispatchers.size).toBe(0);
  });

  it.each(["unknown", "compress", "zstd, gzip", "gzip,zstd"])(
    "rejects unsupported or multi-value content encoding %s",
    (encoding) => {
      expect(() => validateContentEncoding(encoding)).toThrow(AcquisitionError);
    },
  );

  it("accepts a single native zstd content encoding label", () => {
    expect(() => validateContentEncoding("zstd")).not.toThrow();
    expect(() => validateContentEncoding(" ZSTD ")).not.toThrow();
  });

  it.each([
    ["application/rss+xml", "feed", true],
    ["application/atom+xml", "feed", true],
    ["application/xml", "feed", true],
    ["text/xml", "feed", true],
    ["text/html", "feed", false],
    ["text/html", "article", true],
    ["application/xhtml+xml", "article", true],
    ["text/plain", "article", false],
  ] as const)("validates MIME %s for %s", (mime, kind, accepted) => {
    const check = (): void => validateContentType(mime, kind);
    if (accepted) expect(check).not.toThrow();
    else expect(check).toThrow(AcquisitionError);
  });

  it("rejects missing feed and article MIME types", () => {
    expect(() => validateContentType(null, "feed")).toThrow(AcquisitionError);
    expect(() => validateContentType(null, "article")).toThrow(
      AcquisitionError,
    );
  });

  it("cancels a streaming response as soon as its byte budget is exceeded", async () => {
    await fixture.start();
    fixture.route("/stream", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.write("<rss>");
      response.write("x".repeat(2_048));
      response.end("</rss>");
    });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/stream`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      reason: "response_too_large",
      receivedResponse: true,
    });
  });

  it("bounds an endless response with no Content-Length and cancels exactly once", async () => {
    await fixture.start();
    fixture.route("/endless", ({ response }) => {
      response.setHeader("content-type", "application/xml");
      response.write("x".repeat(100));
      const timer = setInterval(() => response.write("x".repeat(100)), 5);
      response.once("close", () => clearInterval(timer));
    });
    let cancelled = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      tracker: {
        dispatcherCreated() {},
        readerCancelled() {
          cancelled += 1;
        },
      },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/endless`,
        timeoutMs: 2_000,
        maxBytes: 256,
      }),
    ).rejects.toMatchObject({ reason: "response_too_large" });
    await settle();
    expect(cancelled).toBe(1);
    expect(fixture.dispatchersDestroyed).toBe(1);
    expect(fixture.sockets.size).toBe(0);
  });

  it.each([
    [
      "unsupported MIME",
      () => new Response("body", { headers: { "content-type": "text/plain" } }),
      "unsupported_mime",
      "destroyed",
    ],
    [
      "unsupported encoding",
      () =>
        new Response("body", {
          headers: {
            "content-type": "application/xml",
            "content-encoding": "compress",
          },
        }),
      "unsupported_encoding",
      "destroyed",
    ],
    [
      "HTTP status",
      () =>
        new Response("body", {
          status: 500,
          headers: { "content-type": "application/xml" },
        }),
      "http_status",
      "destroyed",
    ],
    [
      "invalid redirect",
      () => new Response("body", { status: 302 }),
      "invalid_redirect",
      "closed",
    ],
    [
      "declared overlength",
      () =>
        new Response("body", {
          headers: {
            "content-type": "application/xml",
            "content-length": "100",
          },
        }),
      "response_too_large",
      "destroyed",
    ],
    [
      "streamed overlength",
      () =>
        new Response("body", {
          headers: { "content-type": "application/xml" },
        }),
      "response_too_large",
      "destroyed",
    ],
  ] as const)(
    "cancels the response reader exactly once for %s",
    async (_case, response, reason, cleanup) => {
      let cancelled = 0;
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
        tracker: {
          dispatcherCreated() {},
          readerCancelled() {
            cancelled += 1;
          },
        },
        fetch: async () => response(),
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: "http://fixture.example.test/reject",
          timeoutMs: 2_000,
          maxBytes: 3,
        }),
      ).rejects.toMatchObject({ reason });
      await settle();
      expect(cancelled).toBe(1);
      expect(fixture.dispatchersClosed).toBe(cleanup === "closed" ? 1 : 0);
      expect(fixture.dispatchersDestroyed).toBe(
        cleanup === "destroyed" ? 1 : 0,
      );
    },
  );

  it("maps HTTP errors, MIME, encoding, and caller aborts safely", async () => {
    await fixture.start();
    fixture
      .route("/404", ({ response }) => {
        response.statusCode = 404;
        response.setHeader("content-type", "application/xml");
        response.end("missing");
      })
      .route("/mime", ({ response }) => {
        response.end("x");
      })
      .route("/encoding", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.setHeader("content-encoding", "compress");
        response.end("x");
      });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    for (const [path, reason] of [
      ["/404", "http_status"],
      ["/mime", "unsupported_mime"],
      ["/encoding", "unsupported_encoding"],
    ] as const) {
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}${path}`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toSatisfy(
        (error: unknown) => acquisitionReason(error) === reason,
      );
    }
  });

  it.each([
    [204, "feed", "invalid_feed"],
    [205, "feed", "invalid_feed"],
    [204, "article", "extraction_failed"],
    [205, "article", "extraction_failed"],
  ] as const)(
    "maps status %d for a %s response",
    async (status, kind, reason) => {
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
        fetch: async () => new Response(null, { status }),
      });
      await expect(
        transport.fetch({
          kind,
          url: "http://fixture.example.test/no-content",
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason, receivedResponse: true });
    },
  );

  it.each([301, 302, 303, 307, 308])(
    "follows and closes both dispatchers for a %s redirect",
    async (status) => {
      await fixture.start();
      fixture
        .route("/start", ({ response }) => {
          response.statusCode = status;
          response.setHeader(
            "location",
            "http://other.fixture.example.test/end",
          );
          response.end("redirect");
        })
        .route("/end", ({ response }) => {
          response.setHeader("content-type", "application/xml");
          response.end("<rss/>");
        });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/start`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).resolves.toMatchObject({
        finalUrl: "http://other.fixture.example.test/end",
      });
      await settle();
      expect(fixture.dispatchersCreated).toBe(2);
      expect(fixture.dispatchersClosed).toBe(2);
      expect(fixture.dispatchersDestroyed).toBe(0);
      expect(fixture.dispatchers.size).toBe(0);
      expect(fixture.sockets.size).toBe(0);
      expect(fixture.hosts).toEqual([
        "fixture.example.test",
        "other.fixture.example.test",
      ]);
      expect(fixture.connectServernames).toEqual([
        "fixture.example.test",
        "other.fixture.example.test",
      ]);
    },
  );

  it.each([null, "", "   "])(
    "rejects missing or blank redirect location %j after body cancel",
    async (location) => {
      await fixture.start();
      fixture.route("/bad", ({ response }) => {
        response.statusCode = 302;
        if (location !== null) response.setHeader("location", location);
        response.end("redirect");
      });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/bad`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason: "invalid_redirect" });
      await settle();
      expect(fixture.dispatchersCreated).toBe(1);
      expect(fixture.dispatchersClosed).toBe(1);
      expect(fixture.dispatchersDestroyed).toBe(0);
    },
  );

  it.each([
    ["localhost", "http://localhost/blocked"],
    ["dot localhost", "http://public.localhost/blocked"],
    ["userinfo", "http://user:secret@public.example.test/blocked"],
    ["empty userinfo", "http://@public.example.test/"],
    ["network-path userinfo", "//@public.example.test/"],
    ["triple-slash empty authority", "///@public.example.test/"],
    ["quad-slash empty authority", "////@public.example.test/"],
    ["five-slash empty authority", "/////@public.example.test/"],
    ["quad-slash host without userinfo", "////public.example.test/"],
    ["non-default port", "http://public.example.test:8443/blocked"],
  ] as const)(
    "preserves blocked_url for a %s redirect target before resolving or connecting",
    async (_case, location) => {
      await fixture.start();
      fixture.route("/blocked-target", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", location);
        response.end("redirect");
      });
      let lookups = 0;
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: async () => {
          lookups += 1;
          return fixture.resolver();
        },
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/blocked-target`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({
        reason: "blocked_url",
        receivedResponse: true,
        finalUrl: `${fixture.origin}/blocked-target`,
      });
      await settle();
      expect(lookups).toBe(1);
      expect(fixture.requests).toEqual(["/blocked-target"]);
      expect(fixture.dispatchersCreated).toBe(1);
      expect(fixture.dispatcherAddresses).toEqual([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(fixture.requestConnectionIds).toEqual([1]);
      expect(fixture.dispatchersClosed).toBe(1);
      expect(fixture.dispatchersDestroyed).toBe(0);
      expect(fixture.dispatchers.size).toBe(0);
      expect(fixture.sockets.size).toBe(0);
    },
  );

  it.each([
    ["tab control", "http://public.example.test/a\tb"],
    ["missing authority", "http:/missing-authority"],
    ["malformed IPv6 authority", "http://["],
    ["invalid port", "http://public.example.test:bad/"],
  ] as const)(
    "keeps malformed %s redirect locations as invalid_redirect",
    async (_case, location) => {
      await fixture.start();
      fixture.route("/malformed-location", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", location);
        response.end("redirect");
      });
      let lookups = 0;
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: async () => {
          lookups += 1;
          return fixture.resolver();
        },
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/malformed-location`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({
        reason: "invalid_redirect",
        receivedResponse: true,
        finalUrl: `${fixture.origin}/malformed-location`,
      });
      await settle();
      expect(lookups).toBe(1);
      expect(fixture.requests).toEqual(["/malformed-location"]);
      expect(fixture.dispatchersCreated).toBe(1);
      expect(fixture.requestConnectionIds).toEqual([1]);
      expect(fixture.dispatchers.size).toBe(0);
      expect(fixture.sockets.size).toBe(0);
    },
  );

  it("rejects HTTPS-to-HTTP redirects before resolving the downgrade target", async () => {
    let factories = 0;
    let fetches = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: () => {
        factories += 1;
        return new Agent();
      },
      fetch: async () => {
        fetches += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "http://downgrade.example.test/" },
        });
      },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "https://fixture.example.test/start",
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      reason: "invalid_redirect",
      receivedResponse: true,
      finalUrl: "https://fixture.example.test/start",
    });
    expect(factories).toBe(1);
    expect(fetches).toBe(1);
  });

  it("allows exactly the configured redirect count and rejects the next", async () => {
    await fixture.start();
    fixture
      .route("/r0", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/r1");
        response.end();
      })
      .route("/r1", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/ok");
        response.end();
      })
      .route("/r2", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/r3");
        response.end();
      })
      .route("/r3", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/too-far");
        response.end();
      })
      .route("/bad0", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/bad1");
        response.end();
      })
      .route("/bad1", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/bad2");
        response.end();
      })
      .route("/bad2", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/bad3");
        response.end();
      })
      .route("/bad3", ({ response }) => {
        response.statusCode = 302;
        response.setHeader("location", "/too-far");
        response.end();
      })
      .route("/too-far", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.end("<rss/>");
      })
      .route("/ok", ({ response }) => {
        response.setHeader("content-type", "application/xml");
        response.end("<rss/>");
      });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/r0`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ finalUrl: `${fixture.origin}/ok` });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/bad0`,
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "redirect_limit" });
    expect(fixture.requests).not.toContain("/too-far");
  });

  it.each([
    [400, false, "http_status"],
    [500, false, "http_status"],
    [200, true, "http_status"],
    [204, false, "invalid_feed"],
    [205, false, "invalid_feed"],
  ] as const)(
    "cancels and destroys response status %s with Content-Range=%s",
    async (status, contentRange, reason) => {
      await fixture.start();
      fixture.route("/failure", ({ response }) => {
        response.statusCode = status;
        if (contentRange) response.setHeader("content-range", "bytes 0-1/2");
        response.setHeader("content-type", "application/xml");
        response.end("failure");
      });
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: fixture.dispatcherFactory,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: `${fixture.origin}/failure`,
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason });
      await settle();
      expect(fixture.dispatchersDestroyed).toBe(1);
      expect(fixture.dispatchersClosed).toBe(0);
      expect(fixture.sockets.size).toBe(0);
    },
  );

  it.each([
    [bomWindowsXml(), "feed"],
    [bomMetaWindowsHtml(), "article"],
    [new Uint8Array([0xc3, 0x28]), "feed"],
  ] as const)("fatal-decodes declarations and invalid UTF-8", (bytes, kind) => {
    expect(() => decodeResponseBody(bytes, kind, null)).toThrow(
      AcquisitionError,
    );
  });

  it("rejects unsupported HTTP, XML, and HTML character declarations", () => {
    expect(() =>
      decodeResponseBody(
        new TextEncoder().encode("<rss/>"),
        "feed",
        "windows-1252",
      ),
    ).toThrow(AcquisitionError);
    expect(() =>
      decodeResponseBody(
        new TextEncoder().encode(
          '<?xml version="1.0" encoding="windows-1252"?><rss/>',
        ),
        "feed",
        null,
      ),
    ).toThrow(AcquisitionError);
    expect(() =>
      decodeResponseBody(
        new TextEncoder().encode('<meta charset="windows-1252"><p>x</p>'),
        "article",
        null,
      ),
    ).toThrow(AcquisitionError);
  });

  it("honors US-ASCII declarations and rejects non-ASCII bytes", () => {
    expect(() =>
      decodeResponseBody(
        new TextEncoder().encode(
          '<?xml version="1.0" encoding="US-ASCII"?><rss/>',
        ),
        "feed",
        null,
      ),
    ).not.toThrow();
    expect(() =>
      decodeResponseBody(
        new Uint8Array([
          ...new TextEncoder().encode(
            '<?xml version="1.0" encoding="US-ASCII"?><rss>',
          ),
          0xc3,
          0xa9,
        ]),
        "feed",
        null,
      ),
    ).toThrow(AcquisitionError);
    expect(() =>
      decodeResponseBody(new Uint8Array([0x80]), "feed", "us-ascii"),
    ).toThrow(AcquisitionError);
  });

  it.each([
    ["HTTP", "feed", "us-ascii", "<rss>é</rss>"],
    [
      "XML",
      "feed",
      null,
      '<?xml version="1.0" encoding="US-ASCII"?><rss>é</rss>',
    ],
    ["HTML", "article", null, '<meta charset="US-ASCII"><p>é</p>'],
  ] as const)(
    "keeps the %s ASCII declaration active across a UTF-8 BOM",
    (_case, kind, charset, text) => {
      expect(() => decodeResponseBody(utf8Bom(text), kind, charset)).toThrow(
        expect.objectContaining({ reason: "unsupported_encoding" }),
      );
    },
  );

  it("does not reject a valid multibyte character crossing the HTML probe boundary", () => {
    const prefix = new Uint8Array(1_023).fill(0x61);
    const suffix = new TextEncoder().encode("é</body></html>");
    const body = new Uint8Array(prefix.length + suffix.length);
    body.set(prefix);
    body.set(suffix, prefix.length);
    expect(decodeResponseBody(body, "article", null)).toContain("é");
  });

  it("rejects a public/private mixed DNS answer before dispatcher creation", async () => {
    let factories = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      dispatcherFactory: () => {
        factories += 1;
        return new Agent();
      },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/",
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    expect(factories).toBe(0);
  });

  it("destroys once when dispatcher close rejects without an unhandled rejection", async () => {
    const unhandled = watchUnhandledRejections();
    const dispatcher = new CloseFailingDispatcher();
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: () => dispatcher,
      fetch: async () =>
        new Response("<rss/>", {
          headers: { "content-type": "application/xml" },
        }),
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/ok",
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ body: "<rss/>" });
    await settle();
    expect(unhandled.stop()).toBe(0);
    expect(dispatcher.closeCalls).toBe(1);
    expect(dispatcher.destroyCalls).toBe(1);
  });

  it("bounds a hanging dispatcher close with one destroy", async () => {
    const dispatcher = new HangingCloseDispatcher();
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: () => dispatcher,
      fetch: async () =>
        new Response("<rss/>", {
          headers: { "content-type": "application/xml" },
        }),
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/ok",
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).resolves.toMatchObject({ body: "<rss/>" });
    expect(dispatcher.closeCalls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(dispatcher.destroyCalls).toBe(1);
  });

  it("does not schedule the next lookup when caller aborts during redirect cleanup", async () => {
    const controller = new AbortController();
    let cancelStarted!: () => void;
    const cancelling = new Promise<void>((resolve) => {
      cancelStarted = resolve;
    });
    let releaseCancel!: () => void;
    const cancelFinished = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let dispatcher: CloseFailingDispatcher | undefined;
    const dispatcherFactory = (): Dispatcher => {
      const current = new CloseFailingDispatcher();
      current.close = async () => {
        current.closeCalls += 1;
      };
      current.destroy = async () => {
        current.destroyCalls += 1;
      };
      dispatcher = current;
      return current;
    };
    let lookups = 0;
    const transport = createRestrictedRssTransport({
      signal: controller.signal,
      policy,
      resolver: async () => {
        lookups += 1;
        return [{ address: "93.184.216.34", family: 4 }];
      },
      dispatcherFactory,
      tracker: {
        dispatcherCreated() {},
        readerCancelled() {
          cancelStarted();
        },
      },
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => cancelFinished,
          }),
          {
            status: 302,
            headers: { location: "/next" },
          },
        ),
    });
    const pending = transport.fetch({
      kind: "feed",
      url: "http://fixture.example.test/redirect",
      timeoutMs: 2_000,
      maxBytes: 1_024,
    });
    await cancelling;
    controller.abort();
    await Promise.resolve();
    releaseCancel();
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    expect(dispatcher).toBeDefined();
    expect(dispatcher?.closeCalls).toBe(1);
    expect(dispatcher?.destroyCalls).toBe(0);
    expect(lookups).toBe(1);
  });

  it.each(["dispatch", "close", "destroy"])(
    "rejects a Dispatcher instance without %s before native fetch",
    async (method) => {
      const malformed = Object.create(Dispatcher.prototype) as Dispatcher;
      malformed.dispatch = () => true;
      (malformed as unknown as Record<string, unknown>)[method] = undefined;
      const transport = createRestrictedRssTransport({
        signal: new AbortController().signal,
        policy,
        resolver: fixture.resolver,
        dispatcherFactory: () => malformed,
      });
      await expect(
        transport.fetch({
          kind: "feed",
          url: "http://fixture.example.test/",
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason: "network_error" });
    },
  );

  it("times out a fetch implementation that ignores the abort signal", async () => {
    const dispatcher = new CloseFailingDispatcher();
    dispatcher.close = async () => {
      dispatcher.closeCalls += 1;
    };
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: () => dispatcher,
      fetch: async () => new Promise<Response>(() => {}),
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/",
        timeoutMs: 50,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: false });
    await settle();
    expect(dispatcher.destroyCalls).toBe(1);
  });

  it("applies one deadline across a slow redirect chain and body read", async () => {
    await fixture.start();
    fixture
      .route("/slow-redirect", async ({ response }) => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        response.statusCode = 302;
        response.setHeader("location", "/slow-body");
        response.end();
      })
      .route("/slow-body", async ({ response }) => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        response.setHeader("content-type", "application/xml");
        response.end("<rss/>");
      });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/slow-redirect`,
        timeoutMs: 150,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: true });
    expect(fixture.requests).toEqual(["/slow-redirect", "/slow-body"]);
  });

  it("honors caller abort while a response body is streaming", async () => {
    const controller = new AbortController();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const transport = createRestrictedRssTransport({
      signal: controller.signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              bodyController = streamController;
            },
          }),
          { headers: { "content-type": "application/xml" } },
        ),
    });
    const pending = transport.fetch({
      kind: "feed",
      url: `${fixture.origin}/abort-body`,
      timeoutMs: 2_000,
      maxBytes: 1_024,
    });
    while (bodyController === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      reason: "aborted",
      receivedResponse: true,
    });
    await settle();
    expect(fixture.dispatchersDestroyed).toBe(1);
  });

  it("rejects an already-aborted caller before DNS or dispatcher creation", async () => {
    let lookups = 0;
    let factories = 0;
    const controller = new AbortController();
    controller.abort();
    const transport = createRestrictedRssTransport({
      signal: controller.signal,
      policy,
      resolver: async () => {
        lookups += 1;
        return [{ address: "8.8.8.8", family: 4 }];
      },
      dispatcherFactory: () => {
        factories += 1;
        return new CloseFailingDispatcher();
      },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/",
        timeoutMs: 2_000,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "aborted", receivedResponse: false });
    expect(lookups).toBe(0);
    expect(factories).toBe(0);
  });

  it.each(["pending", "reject"] as const)(
    "consumes both signal races after a synchronous abort with a %s lookup",
    async (lookupResult) => {
      const unhandled = watchUnhandledRejections();
      const controller = new AbortController();
      let factories = 0;
      const transport = createRestrictedRssTransport({
        signal: controller.signal,
        policy,
        resolver: () => {
          controller.abort();
          if (lookupResult === "reject") {
            return Promise.reject(new Error("late lookup rejection"));
          }
          return new Promise<never>(() => {});
        },
        dispatcherFactory: () => {
          factories += 1;
          return new Agent();
        },
      });

      await expect(
        transport.fetch({
          kind: "feed",
          url: "http://fixture.example.test/sync-abort",
          timeoutMs: 2_000,
          maxBytes: 1_024,
        }),
      ).rejects.toMatchObject({ reason: "aborted", receivedResponse: false });
      await settle();
      expect(unhandled.stop()).toBe(0);
      expect(factories).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    },
  );

  it("times out a hung DNS lookup without creating a dispatcher", async () => {
    let factories = 0;
    let lookups = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: () => {
        lookups += 1;
        return new Promise(() => {});
      },
      dispatcherFactory: () => {
        factories += 1;
        return new CloseFailingDispatcher();
      },
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/",
        timeoutMs: 30,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: false });
    expect(lookups).toBe(1);
    expect(factories).toBe(0);
  });

  it("contains a late DNS rejection after the total deadline", async () => {
    let settled = 0;
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        settled += 1;
        throw new Error("late DNS failure");
      },
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: "http://fixture.example.test/",
        timeoutMs: 30,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(settled).toBe(1);
  });

  it("tears down a socket whose response arrives after the deadline", async () => {
    await fixture.start();
    fixture.route("/late", async ({ response }) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      response.setHeader("content-type", "application/xml");
      response.end("<rss/>");
    });
    const transport = createRestrictedRssTransport({
      signal: new AbortController().signal,
      policy,
      resolver: fixture.resolver,
      dispatcherFactory: fixture.dispatcherFactory,
    });
    await expect(
      transport.fetch({
        kind: "feed",
        url: `${fixture.origin}/late`,
        timeoutMs: 30,
        maxBytes: 1_024,
      }),
    ).rejects.toMatchObject({ reason: "timeout", receivedResponse: false });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fixture.dispatchersDestroyed).toBe(1);
    expect(fixture.sockets.size).toBe(0);
  });

  it("does not expose restricted client seams through the public adapter module", () => {
    expect(Object.keys(publicAdapterApi).sort()).toEqual(["createRssAdapter"]);
  });
});

function utf8Bom(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(encoded.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  return bytes;
}

function bomWindowsXml(): Uint8Array {
  return new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode(
      '<?xml version="1.0" encoding="windows-1252"?><rss/>',
    ),
  ]);
}

function bomMetaWindowsHtml(): Uint8Array {
  return new Uint8Array([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode('<meta charset="windows-1252"><p>x</p>'),
  ]);
}
