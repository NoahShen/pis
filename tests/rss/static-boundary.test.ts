import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import {
  RSS_FEEDS,
  createLocalRssSync,
  createPublishedItemSource,
} from "../../src/rss/index.js";
import { buildApp } from "../../src/app.js";
import type { ConfigurationRepositories } from "../../src/configuration/app-assembly.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import {
  buildRssEventFeedItems,
  seedRssDatabasePublishedItems,
  withRssDatabase,
} from "../fixtures/rss-database.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;

const unusedRepositories: ConfigurationRepositories = {
  source: {
    create: () => {
      throw new Error("not used");
    },
    getById: () => null,
    list: () => [],
    listEnabled: () => [],
    update: () => null,
  },
  topic: {
    create: () => {
      throw new Error("not used");
    },
    getById: () => null,
    list: () => [],
    listEnabled: () => [],
    update: () => null,
  },
};

interface StaticServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function startStaticServer(
  root: string,
  secretSegment: string,
): Promise<StaticServer> {
  const resolvedRoot = path.resolve(root);
  const failure = (response: import("node:http").ServerResponse): void => {
    response.statusCode = 404;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("not found");
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const prefix = `/${secretSegment}/`;
    if (!pathname.startsWith(prefix)) {
      failure(response);
      return;
    }

    const relative = pathname.slice(prefix.length);
    if (
      relative.length === 0 ||
      relative.startsWith("/") ||
      path.isAbsolute(relative) ||
      relative.split("/").some((segment) => segment === "..")
    ) {
      failure(response);
      return;
    }

    const filePath = path.join(resolvedRoot, relative);
    if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      failure(response);
      return;
    }

    readFile(filePath)
      .then((bytes) => {
        response.statusCode = 200;
        response.setHeader(
          "content-type",
          "application/rss+xml; charset=utf-8",
        );
        response.end(bytes);
      })
      .catch(() => failure(response));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function syncEventFeed(outputDirectory: string): Promise<void> {
  await withRssDatabase(async (database) => {
    seedRssDatabasePublishedItems(database, buildRssEventFeedItems(1, 3));
    const reader = createPublishedItemSource(
      new SqlitePublishedItemRepository(database),
    );
    await createLocalRssSync({ reader, outputDirectory }).sync("EVENT_UPDATES");
  });
}

describe("RSS static boundary", () => {
  it("serves XML under a secret segment without a Feed Token and keeps 404 semantics", async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = path.join(directory, "feeds", "output");
      const secretSegment = `rss-${randomUUID()}`;
      await syncEventFeed(outputDirectory);

      const server = await startStaticServer(outputDirectory, secretSegment);
      try {
        const correct = await fetch(
          `${server.origin}/${secretSegment}/${EVENT_FEED.headKey}`,
        );
        expect(correct.status).toBe(200);
        expect((await correct.text()).startsWith("<?xml")).toBe(true);

        const wrongSecret = await fetch(
          `${server.origin}/rss-wrong/${EVENT_FEED.headKey}`,
        );
        expect(wrongSecret.status).toBe(404);

        const missingSegment = await fetch(
          `${server.origin}/${EVENT_FEED.headKey}`,
        );
        expect(missingSegment.status).toBe(404);

        const missingFile = await fetch(
          `${server.origin}/${secretSegment}/missing.xml`,
        );
        expect(missingFile.status).toBe(404);

        // An Authorization header does not change static path semantics.
        const withBearer = await fetch(
          `${server.origin}/${secretSegment}/${EVENT_FEED.headKey}`,
          {
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          },
        );
        expect(withBearer.status).toBe(200);

        const wrongWithBearer = await fetch(
          `${server.origin}/rss-wrong/${EVENT_FEED.headKey}`,
          {
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          },
        );
        expect(wrongWithBearer.status).toBe(404);

        for (const response of [
          wrongSecret,
          missingSegment,
          missingFile,
          wrongWithBearer,
        ]) {
          const body = await response.text();
          expect(body).not.toContain(secretSegment);
          expect(body).not.toContain(outputDirectory);
          expect(body).not.toContain("SELECT");
          expect(body).not.toContain("at ");
        }
      } finally {
        await server.close();
      }
    });
  });

  it("does not let static keys and API Bearer substitute for each other", async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = path.join(directory, "feeds", "output");
      const secretSegment = `rss-${randomUUID()}`;
      const app = await buildApp(
        appConfig({ apiToken: TEST_API_TOKEN }),
        new CapturedLogger(),
        { repositories: unusedRepositories },
      );

      try {
        await syncEventFeed(outputDirectory);
        const server = await startStaticServer(outputDirectory, secretSegment);
        try {
          const authorized = await app.inject({
            method: "GET",
            url: "/health",
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          });
          expect(authorized.statusCode).toBe(200);

          const noBearer = await app.inject({ method: "GET", url: "/health" });
          expect(noBearer.statusCode).toBe(401);

          const wrongBearer = await app.inject({
            method: "GET",
            url: "/health",
            headers: { authorization: `Bearer ${secretSegment}` },
          });
          expect(wrongBearer.statusCode).toBe(401);

          // API Bearer does not substitute for the static path segment.
          const apiBearerOnStatic = await fetch(
            `${server.origin}/${EVENT_FEED.headKey}`,
            {
              headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
            },
          );
          expect(apiBearerOnStatic.status).toBe(404);

          // The correct static key remains readable without any Bearer.
          const staticOk = await fetch(
            `${server.origin}/${secretSegment}/${EVENT_FEED.headKey}`,
          );
          expect(staticOk.status).toBe(200);
        } finally {
          await server.close();
        }
      } finally {
        await app.close();
      }
    });
  });
});
