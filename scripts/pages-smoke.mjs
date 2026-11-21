import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRssPagesPublisher,
  createRssPagesVerifier,
} from "../dist/rss/index.js";

const directory = await mkdtemp(path.join(tmpdir(), "pis-pages-smoke-"));
const remote = path.join(directory, "remote.git");
const work = path.join(directory, "work");
const publicDirectory = path.join(directory, "public");
const database = path.join(directory, "database.sqlite");
const git = (args, cwd = directory) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) throw new Error("Local Pages smoke git failed");
};
const server = createServer((request, response) => {
  void readFile(
    path.join(publicDirectory, decodeURIComponent(request.url.slice(1))),
  ).then(
    (bytes) => response.writeHead(200).end(bytes),
    () => response.writeHead(404).end(),
  );
});
try {
  git(["init", "--bare", "--initial-branch=main", remote]);
  await writeFile(database, "do not touch");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const publisher = createRssPagesPublisher({
    repository: remote,
    branch: "main",
    workDirectory: work,
    publicOrigin: origin,
    timeoutMs: 5_000,
    pollIntervalMs: 10,
    verifier: async () => undefined,
  });
  const fileSet = (feed, marker) => ({
    feed,
    files: [
      { key: ".nojekyll", bytes: new Uint8Array() },
      {
        key: `${feed === "EVENT_UPDATES" ? "event-updates" : "curated-content"}.xml`,
        bytes: new TextEncoder().encode(`${marker}-head`),
      },
      {
        key: `${feed === "EVENT_UPDATES" ? "event-updates" : "curated-content"}-pending.xml`,
        bytes: new TextEncoder().encode(`${marker}-pending`),
      },
      {
        key: `archive/${feed === "EVENT_UPDATES" ? "event-updates" : "curated-content"}-0001.xml`,
        bytes: new TextEncoder().encode(`${marker}-archive`),
      },
    ],
  });
  try {
    await publisher.publish(fileSet("EVENT_UPDATES", "events"));
    await publisher.publish(fileSet("CURATED_CONTENT", "curated"));
    const checkout = path.join(directory, "checkout");
    git(["clone", remote, checkout]);
    await cp(checkout, publicDirectory, { recursive: true });
    await rm(path.join(publicDirectory, ".git"), {
      recursive: true,
      force: true,
    });
    const verify = createRssPagesVerifier({
      publicOrigin: origin,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
    });
    for (const feed of ["EVENT_UPDATES", "CURATED_CONTENT"])
      await verify(
        fileSet(feed, feed === "EVENT_UPDATES" ? "events" : "curated").files,
      );
    if ((await readFile(database, "utf8")) !== "do not touch")
      throw new Error("database changed");
    const commits = spawnSync("git", ["rev-list", "--count", "main"], {
      cwd: checkout,
      encoding: "utf8",
    }).stdout.trim();
    if (commits !== "2") throw new Error("expected one commit per feed");
    console.log(
      "Pages smoke PASS: two feeds, head/pending/archive/.nojekyll, matching origin bytes, independent database",
    );
  } finally {
    await publisher.close();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
