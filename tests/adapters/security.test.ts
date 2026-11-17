import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const restrictedClient = new URL(
  "../../src/adapters/http/restricted-client.ts",
  import.meta.url,
);
const addressPolicy = new URL(
  "../../src/adapters/http/address-policy.ts",
  import.meta.url,
);
const publicAdapter = new URL(
  "../../src/adapters/rss-adapter.ts",
  import.meta.url,
);

describe("restricted HTTP security invariants", () => {
  it("uses exact undici dispatchers and no global mutation or proxy environment", async () => {
    const source = await readFile(restrictedClient, "utf8");
    expect(source).toContain('from "undici"');
    expect(source).toContain("instanceof Dispatcher");
    expect(source).not.toMatch(
      /setGlobalDispatcher|getGlobalDispatcher|ProxyAgent|EnvHttpProxyAgent/,
    );
    expect(source).not.toMatch(/process\.env\.(?:HTTP|HTTPS|NO)_PROXY/i);
    expect(source).not.toMatch(/\bany\b/);
  });

  it("pins one validated address and rejects redirect downgrade", async () => {
    const source = await readFile(restrictedClient, "utf8");
    const policy = await readFile(addressPolicy, "utf8");
    expect(source).toContain("createPinnedLookup(address)");
    expect(source).toContain('currentUrl.protocol === "https:"');
    expect(source).toContain('nextUrl.protocol === "http:"');
    expect(policy).toContain("isIPv4MappedAddress");
    expect(policy).toContain("MAX_RESOLVED_ADDRESSES = 32");
  });

  it("keeps restricted internals out of the public adapter export", async () => {
    const publicSource = await readFile(publicAdapter, "utf8");
    expect(publicSource).not.toMatch(/export \* from "\.\/http\//);
    expect(publicSource).toContain("createRestrictedRssTransport");
  });
});
