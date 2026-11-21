import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RssFeedKind, RssFeedFileSet } from "../../src/rss/index.js";
import { getRssFeed } from "../../src/rss/index.js";

export interface PagesFixture {
  readonly directory: string;
  readonly repository: string;
  readonly origin: string;
  readonly workDirectory: string;
  readonly publicDirectory: string;
  readonly server: Server;
  publishPublic(): Promise<void>;
  close(): Promise<void>;
}

export async function createPagesFixture(): Promise<PagesFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "pis-pages-test-"));
  const repository = path.join(directory, "remote.git");
  const publicDirectory = path.join(directory, "public");
  const seed = path.join(directory, "seed");
  const run = (args: string[], cwd = directory): void => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.status !== 0) throw new Error("git fixture failed");
  };
  run(["init", "--bare", "--initial-branch=main", repository]);
  run(["init", "--initial-branch=main", seed]);
  await writeFile(path.join(seed, "README.md"), "not public\n");
  run(["add", "README.md"], seed);
  run(
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@localhost",
      "commit",
      "-m",
      "seed",
    ],
    seed,
  );
  run(["push", repository, "main"], seed);
  let port = 0;
  const server = createServer((request, response) => {
    if (request.url?.includes("?") || request.url === "/redirect.xml") {
      response.writeHead(302, { location: "http://127.0.0.1/private" }).end();
      return;
    }
    const key = decodeURIComponent(request.url?.slice(1) ?? "");
    if (key.includes("..") || key.includes("\\")) {
      response.writeHead(400).end();
      return;
    }
    void readFile(path.join(publicDirectory, key)).then(
      (bytes) => {
        response.writeHead(200, { "content-length": bytes.length }).end(bytes);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("server failed");
  port = address.port;
  const fixture: PagesFixture = {
    directory,
    repository,
    origin: `http://127.0.0.1:${port}`,
    workDirectory: path.join(directory, "work"),
    publicDirectory,
    server,
    async publishPublic() {
      const checkout = path.join(directory, "checkout");
      await rm(checkout, { recursive: true, force: true });
      run(["clone", repository, checkout]);
      await rm(publicDirectory, { recursive: true, force: true });
      run(["checkout", "--", "."], checkout);
      const { cp } = await import("node:fs/promises");
      await cp(checkout, publicDirectory, { recursive: true });
      await rm(path.join(publicDirectory, ".git"), {
        recursive: true,
        force: true,
      });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
  return fixture;
}

export function pagesFileSet(
  feed: RssFeedKind,
  marker: string,
  archive = true,
): RssFeedFileSet {
  const definition = getRssFeed(feed);
  const bytes = (text: string) => new TextEncoder().encode(text);
  return {
    feed,
    files: [
      { key: definition.headKey, bytes: bytes(`${marker}-head`) },
      { key: definition.pendingKey, bytes: bytes(`${marker}-pending`) },
      ...(archive
        ? [
            {
              key: `archive/${definition.archiveFilePrefix}-0001.xml`,
              bytes: bytes(`${marker}-archive`),
            },
          ]
        : []),
      { key: ".nojekyll", bytes: new Uint8Array() },
    ],
  };
}
