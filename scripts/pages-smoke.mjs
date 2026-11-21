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
  access,
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
const exampleDirectory = "example_feed";
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
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
  const seed = path.join(directory, "seed");
  git(["init", "--initial-branch=main", seed]);
  await writeFile(path.join(seed, "README.md"), "unknown file retained\n");
  git(["add", "README.md"], seed);
  git(
    [
      "-c",
      "user.name=Smoke",
      "-c",
      "user.email=smoke@localhost",
      "commit",
      "-m",
      "seed",
    ],
    seed,
  );
  git(["push", remote, "main"], seed);
  await writeFile(database, "do not touch");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const publisher = createRssPagesPublisher({
    repository: remote,
    branch: "main",
    workDirectory: work,
    publicOrigin: origin,
    publicDirectory: exampleDirectory,
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
  const legacyPublisher = createRssPagesPublisher({
    repository: remote,
    branch: "main",
    workDirectory: path.join(directory, "legacy-work"),
    publicOrigin: origin,
    verifier: async () => undefined,
  });
  try {
    await legacyPublisher.publish(fileSet("EVENT_UPDATES", "legacy"));
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
      publicDirectory: exampleDirectory,
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
    if (commits !== "4") throw new Error("expected one commit per publication");
    if (
      (await readFile(path.join(checkout, "README.md"), "utf8")) !==
      "unknown file retained\n"
    )
      throw new Error("unknown remote file changed");
    for (const key of [
      ".nojekyll",
      "event-updates.xml",
      "event-updates-pending.xml",
      "archive/event-updates-0001.xml",
    ]) {
      if (await exists(path.join(checkout, key)))
        throw new Error("legacy root asset retained");
    }
    if (
      (await readFile(
        path.join(checkout, exampleDirectory, "curated-content.xml"),
        "utf8",
      )) !== "curated-head"
    )
      throw new Error("other feed directory asset changed");
    console.log(
      "Pages smoke PASS: directory publication and root migration, two feeds, matching origin bytes, retained unknown/other-feed assets, independent database",
    );
  } finally {
    await publisher.close();
    await legacyPublisher.close();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
