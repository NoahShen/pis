import { afterEach, describe, expect, it, vi } from "vitest";

import { createRssAdapter } from "../../src/adapters/rss-adapter.js";

const FEED_URL = "http://127.0.0.1/feed";
const FEED_BODY = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title><item><guid>one</guid><title>Loopback</title><link>http://127.0.0.1/article</link><description>Fixture summary</description></item></channel></rss>`;

const source = {
  id: "ssrf-debug",
  type: "RSS" as const,
  url: FEED_URL,
};

function feedResponse(): Response {
  return new Response(FEED_BODY, {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RSS SSRF debug option", () => {
  it.each([
    ["default", undefined],
    ["explicit true", true],
  ] as const)("keeps SSRF protection enabled for %s", async (_case, value) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(feedResponse());
    const adapter = createRssAdapter(
      value === undefined
        ? {}
        : {
            ssrfProtection: value,
          },
    );
    await expect(
      adapter.fetchEntries(
        { ...source, url: `${FEED_URL}?ssrfProtection=false` },
        null,
      ),
    ).rejects.toMatchObject({ reason: "blocked_url" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a validated loopback address only when ssrfProtection is false", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(feedResponse());
    const adapter = createRssAdapter({ ssrfProtection: false });

    await expect(adapter.fetchEntries(source, null)).resolves.toEqual([
      expect.objectContaining({ title: "Loopback", source_id: source.id }),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(String(input)).toBe(FEED_URL);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
  });
});
