import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(projectRoot, "dist", "server.js");
const promptsDirectory = path.join(projectRoot, "config", "prompts");

const STARTUP_TIMEOUT_MS = 8_000;
const EXIT_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 2_000;
const CLEANUP_TIMEOUT_MS = 1_000;

const API_TOKEN = `production-smoke-api-token-${process.pid}`;
const LLM_ENDPOINT = `http://127.0.0.1:9/production-smoke-llm-${process.pid}`;
const LLM_API_KEY = `production-smoke-llm-key-${process.pid}`;
const LLM_MODEL = `production-smoke-llm-model-${process.pid}`;
const QUERY_SENTINEL = `production-smoke-query-${process.pid}`;
const BODY_SENTINEL = `production-smoke-body-${process.pid}`;
const COOKIE_SENTINEL = `production-smoke-cookie-${process.pid}`;
const RSS_SENTINEL = `https://production-smoke-rss-${process.pid}.example/private`;
const SENSITIVE_SENTINELS = [
  API_TOKEN,
  LLM_ENDPOINT,
  LLM_API_KEY,
  QUERY_SENTINEL,
  BODY_SENTINEL,
  COOKIE_SENTINEL,
  RSS_SENTINEL,
];
const EXPECTED_TABLES = [
  "contents",
  "event_content_links",
  "event_entity_aliases",
  "event_search",
  "event_updates",
  "events",
  "knowledge",
  "published_items",
  "source_items",
  "sources",
  "topic_associations",
  "topics",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Production smoke verification failed: ${message}`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function outputFor(state) {
  return `stdout:\n${state.stdout || "<empty>"}\nstderr:\n${state.stderr || "<empty>"}`;
}

function jsonLines(output) {
  const entries = [];

  for (const line of output.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    try {
      entries.push(JSON.parse(line));
    } catch {
      // Non-JSON diagnostics remain in the captured output for assertions.
    }
  }

  return entries;
}

function spawnServer(databasePath) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      API_TOKEN,
      LOG_LEVEL: "info",
      HOST: "127.0.0.1",
      PORT: "0",
      DATABASE_PATH: databasePath,
      PIS_LLM_ENDPOINT: LLM_ENDPOINT,
      PIS_LLM_API_KEY: LLM_API_KEY,
      PIS_LLM_MODEL: LLM_MODEL,
      PROMPTS_DIR: promptsDirectory,
      RSS_SSRF_PROTECTION: "true",
      CRON_TIMEZONE: "Asia/Shanghai",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    child,
    stdout: "",
    stderr: "",
    launchError: undefined,
    exit: undefined,
    exitPromise: undefined,
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    state.stderr += chunk;
  });
  state.exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      state.launchError = error;
      resolve({ code: null, signal: null });
    });
    child.once("close", (code, signal) => {
      state.exit = { code, signal };
      resolve(state.exit);
    });
  });

  return state;
}

async function waitForReady(state) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (state.launchError !== undefined) {
      throw state.launchError;
    }

    const ready = jsonLines(state.stdout).find(
      (entry) => entry?.event === "ready",
    );
    if (ready !== undefined) {
      assert(
        ready.pid === state.child.pid,
        "ready log pid did not match the child process",
      );
      assert(
        ready.host === "127.0.0.1",
        "ready log did not contain the expected loopback host",
      );
      assert(
        Number.isInteger(ready.port) && ready.port > 0,
        "ready log did not contain an assigned port",
      );
      return ready;
    }

    if (state.exit !== undefined) {
      throw new Error(`server exited before readiness\n${outputFor(state)}`);
    }
    await delay(20);
  }

  throw new Error(
    `server did not become ready within ${STARTUP_TIMEOUT_MS}ms\n${outputFor(state)}`,
  );
}

async function waitForExit(state) {
  if (state.exit !== undefined) {
    return state.exit;
  }

  let timer;
  try {
    return await Promise.race([
      state.exitPromise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `server did not exit within ${EXIT_TIMEOUT_MS}ms\n${outputFor(state)}`,
            ),
          );
        }, EXIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function terminateAfterFailure(state) {
  if (state === undefined || state.exit !== undefined) {
    return;
  }

  state.child.kill("SIGKILL");
  try {
    await Promise.race([
      state.exitPromise,
      new Promise((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
    ]);
  } catch {
    // Preserve the original failure.
  }
}

async function fetchWithTimeout(url, options) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function exerciseHttp(port) {
  const health = await fetchWithTimeout(
    `http://127.0.0.1:${port}/health?query=${QUERY_SENTINEL}`,
    {
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        cookie: `session=${COOKIE_SENTINEL}`,
        "x-rss-url": RSS_SENTINEL,
      },
    },
  );
  assert(health.status === 200, `health returned HTTP ${health.status}`);
  assert(
    (health.headers.get("content-type") ?? "").includes("application/json"),
    "health response was not JSON",
  );
  assert(
    JSON.stringify(await health.json()) === JSON.stringify({ status: "ok" }),
    "health response body was not exactly {status:ok}",
  );

  const unregistered = await fetchWithTimeout(
    `http://127.0.0.1:${port}/unregistered?query=${QUERY_SENTINEL}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        cookie: `session=${COOKIE_SENTINEL}`,
        "content-type": "text/plain",
        "x-rss-url": RSS_SENTINEL,
      },
      body: BODY_SENTINEL,
    },
  );
  assert(
    unregistered.status === 404,
    `unregistered request returned HTTP ${unregistered.status}`,
  );
}

async function assertPortReleased(port) {
  const probe = createServer();

  try {
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    throw new Error(
      `Production smoke verification failed: port was not released: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await new Promise((resolve) => {
      if (!probe.listening) {
        resolve();
        return;
      }
      probe.close(() => resolve());
    });
  }
}

function assertDatabaseSchema(databasePath) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const tables = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE 'event_search_%'
          ORDER BY name
        `,
      )
      .all()
      .map((row) => row.name);
    assert(
      JSON.stringify(tables) === JSON.stringify(EXPECTED_TABLES),
      "temporary database did not contain the frozen schema",
    );

    const sourceCount = database
      .prepare("SELECT COUNT(*) AS count FROM sources")
      .get().count;
    const publishedCount = database
      .prepare("SELECT COUNT(*) AS count FROM published_items")
      .get().count;
    assert(
      sourceCount === 0 && publishedCount === 0,
      "production smoke unexpectedly wrote business rows",
    );
  } finally {
    database.close();
  }
}

function assertNoSensitiveOutput(state) {
  const output = `${state.stdout}\n${state.stderr}`;
  for (const [index, sentinel] of SENSITIVE_SENTINELS.entries()) {
    assert(
      !output.includes(sentinel),
      `captured output contained sensitive sentinel ${index + 1}`,
    );
  }
}

async function removeTemporaryDatabase(directory, databasePath) {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
  await rm(directory, { recursive: true, force: true });
  assert(!existsSync(databasePath), "temporary database was not removed");
}

let state;
let temporaryDirectory;
let databasePath;

try {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "pis-production-smoke-"),
  );
  databasePath = path.join(temporaryDirectory, "pis.sqlite");
  assert(
    !existsSync(path.join(projectRoot, "data", "pis.sqlite")),
    "default database existed before the production smoke",
  );

  state = spawnServer(databasePath);
  const ready = await waitForReady(state);
  await exerciseHttp(ready.port);
  assert(state.child.kill("SIGTERM"), "could not send SIGTERM to the server");

  const exit = await waitForExit(state);
  assert(
    exit.code === 0,
    `SIGTERM exit code was ${String(exit.code)} (${String(exit.signal)})`,
  );
  assert(exit.signal === null, `SIGTERM signal was ${String(exit.signal)}`);

  await assertPortReleased(ready.port);
  assertDatabaseSchema(databasePath);
  assertNoSensitiveOutput(state);
  await removeTemporaryDatabase(temporaryDirectory, databasePath);
  assert(
    !existsSync(path.join(projectRoot, "data", "pis.sqlite")),
    "production smoke touched the default database",
  );

  console.log(
    "Production smoke passed: ready, authenticated health, SIGTERM exit 0, schema, port release, temporary cleanup, and sensitive output negative assertions.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
} finally {
  await terminateAfterFailure(state);
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
