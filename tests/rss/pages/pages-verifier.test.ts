import { describe, expect, it } from "vitest";
import {
  createRssPagesVerifier,
  RssPublisherError,
} from "../../../src/rss/index.js";
import { loadConfig } from "../../../src/config.js";

const REQUIRED_ENV = {
  API_TOKEN: "test",
  PIS_LLM_ENDPOINT: "https://llm.test",
  PIS_LLM_API_KEY: "test",
  PIS_LLM_MODEL: "test",
};

const files = [
  { key: "event-updates.xml", bytes: new TextEncoder().encode("public") },
];

describe("RSS Pages verifier", () => {
  it("loads the default project Pages path and normalizes trailing slashes", () => {
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
      }).rssPages?.publicOrigin,
    ).toBe("https://noahshen.github.io/pis_publish");
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
        RSS_PAGES_PUBLIC_ORIGIN: "https://noahshen.github.io/pis_publish/",
      }).rssPages?.publicOrigin,
    ).toBe("https://noahshen.github.io/pis_publish");
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
        RSS_PAGES_PUBLIC_DIRECTORY: "example_feed",
      }).rssPages,
    ).toMatchObject({ publicDirectory: "example_feed" });
    expect(
      loadConfig({
        ...REQUIRED_ENV,
        RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
      }).rssPages?.publicDirectory,
    ).toBe("");
    for (const publicOrigin of [
      "https://user@example.test/pis_publish",
      "https://example.test/pis_publish?secret",
      "https://example.test/pis_publish#secret",
    ]) {
      expect(() =>
        loadConfig({
          ...REQUIRED_ENV,
          RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
          RSS_PAGES_PUBLIC_ORIGIN: publicOrigin,
        }),
      ).toThrow();
    }
  });
  it("accepts only an empty or safe single public directory", () => {
    const pagesEnvironment = {
      ...REQUIRED_ENV,
      RSS_PAGES_REPOSITORY: "git@github.com:NoahShen/pis_publish.git",
    };
    for (const publicDirectory of ["", "a", "A_1-test", "a".repeat(128)]) {
      expect(
        loadConfig({
          ...pagesEnvironment,
          RSS_PAGES_PUBLIC_DIRECTORY: publicDirectory,
        }).rssPages?.publicDirectory,
      ).toBe(publicDirectory);
    }
    for (const publicDirectory of [
      "nested/path",
      "bad.path",
      "bad path",
      ".",
      "..",
      "a".repeat(129),
    ]) {
      expect(() =>
        loadConfig({
          ...pagesEnvironment,
          RSS_PAGES_PUBLIC_DIRECTORY: publicDirectory,
        }),
      ).toThrowError(/RSS_PAGES_PUBLIC_DIRECTORY/u);
    }
  });

  it("matches bounded anonymous origin bytes without secrets", async () => {
    const requests: RequestInit[] = [];
    const verify = createRssPagesVerifier({
      publicOrigin: "https://example.test",
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      fetch: async (_url, init) => {
        requests.push(init!);
        return new Response("public", { status: 200 });
      },
    });
    await verify(files);
    expect(requests[0]?.redirect).toBe("error");
    expect(requests[0]?.headers).not.toHaveProperty("authorization");
  });

  it("uses the same fixed public directory for every URL", async () => {
    const urls: string[] = [];
    const verify = createRssPagesVerifier({
      publicOrigin: "https://example.test/project",
      publicDirectory: "example_feed",
      fetch: async (url) => {
        urls.push(String(url));
        return new Response("public");
      },
    });
    await verify(files);
    expect(urls).toEqual([
      "https://example.test/project/example_feed/event-updates.xml",
    ]);
  });

  it("retries status failures and eventually reports timeout", async () => {
    const verify = createRssPagesVerifier({
      publicOrigin: "https://example.test",
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      fetch: async () => new Response("missing", { status: 404 }),
    });
    await expect(verify(files)).rejects.toMatchObject({
      code: "timeout",
    } satisfies Partial<RssPublisherError>);
  });

  it("rejects redirects and oversized responses", async () => {
    const redirected = createRssPagesVerifier({
      publicOrigin: "https://example.test",
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      fetch: async () => {
        throw new TypeError("redirect");
      },
    });
    await expect(redirected(files)).rejects.toMatchObject({ code: "timeout" });
    const bounded = createRssPagesVerifier({
      publicOrigin: "https://example.test",
      timeoutMs: 1_000,
      fetch: async () =>
        new Response("too large", { headers: { "content-length": "100" } }),
    });
    await expect(bounded(files)).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects non-publication paths", async () => {
    const verify = createRssPagesVerifier({
      publicOrigin: "https://example.test",
      fetch: async () => new Response(""),
    });
    await expect(
      verify([{ key: ".env", bytes: new Uint8Array() }]),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
