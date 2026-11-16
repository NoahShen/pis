import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runConfigurationSmoke } from "./configuration-smoke.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(projectRoot, "dist", "server.js");
const forcedExitEntry = path.join(
  projectRoot,
  "tests",
  "fixtures",
  "forced-exit-entry.mjs",
);
const pendingListenEntry = path.join(
  projectRoot,
  "tests",
  "fixtures",
  "pending-listen-entry.mjs",
);

const STARTUP_TIMEOUT_MS = 5_000;
const NORMAL_EXIT_TIMEOUT_MS = 3_000;
const FORCED_EXIT_TIMEOUT_MS = 7_000;
const REQUEST_TIMEOUT_MS = 2_000;
const CLEANUP_TIMEOUT_MS = 1_000;

const API_TOKEN = `smoke-token-${process.pid}`;
const QUERY_SENTINEL = `smoke-query-${process.pid}`;
const BODY_SENTINEL = `smoke-body-${process.pid}`;
const COOKIE_SENTINEL = `smoke-cookie-${process.pid}`;
const RSS_SENTINEL = `https://smoke-rss-${process.pid}.example/private`;
const SENSITIVE_SENTINELS = [
  API_TOKEN,
  QUERY_SENTINEL,
  BODY_SENTINEL,
  COOKIE_SENTINEL,
  RSS_SENTINEL,
];

function fail(message) {
  throw new Error(`Smoke verification failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function createSmokeDatabase(label) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `pis-${label}-`));
  return {
    path: path.join(directory, "pis.sqlite"),
    directory,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function outputFor(state) {
  return `stdout:\n${state.stdout || "<empty>"}\nstderr:\n${state.stderr || "<empty>"}`;
}

function spawnCaptured(entry, environment) {
  const child = spawn(process.execPath, [entry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      LOG_LEVEL: "info",
      ...environment,
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

function jsonLines(output) {
  const entries = [];

  for (const line of output.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    try {
      entries.push(JSON.parse(line));
    } catch {
      // Child diagnostics remain available in the failure output.
    }
  }

  return entries;
}

function findEntry(entries, predicate) {
  return entries.find(predicate);
}

async function waitForExit(state, timeoutMs, label) {
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
            new Error(`${label} exceeded ${timeoutMs}ms\n${outputFor(state)}`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(state) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (state.launchError !== undefined) {
      throw state.launchError;
    }

    const ready = findEntry(
      jsonLines(state.stdout),
      (entry) => entry?.event === "ready",
    );
    if (ready !== undefined) {
      assert(
        ready.pid === state.child.pid,
        `ready pid ${String(ready.pid)} did not match child pid ${String(state.child.pid)}`,
      );
      assert(
        Number.isInteger(ready.port) && ready.port > 0,
        `ready log did not contain an OS-assigned port: ${JSON.stringify(ready)}`,
      );
      return ready;
    }

    if (state.exit !== undefined) {
      fail(`server exited before readiness\n${outputFor(state)}`);
    }

    await delay(20);
  }

  fail(
    `server did not become ready within ${STARTUP_TIMEOUT_MS}ms\n${outputFor(state)}`,
  );
}

async function waitForEvent(state, event, label) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (state.launchError !== undefined) {
      throw state.launchError;
    }

    const entry = findEntry(
      jsonLines(state.stdout),
      (candidate) => candidate?.event === event,
    );
    if (entry !== undefined) {
      assert(
        entry.pid === state.child.pid,
        `${event} pid ${String(entry.pid)} did not match child pid ${String(state.child.pid)}`,
      );
      return entry;
    }

    if (state.exit !== undefined) {
      fail(`${label} exited before ${event}\n${outputFor(state)}`);
    }

    await delay(20);
  }

  fail(
    `${label} did not emit ${event} within ${STARTUP_TIMEOUT_MS}ms\n${outputFor(state)}`,
  );
}

async function terminateAfterFailure(state) {
  if (state === undefined || state.exit !== undefined) {
    return;
  }

  state.child.kill("SIGKILL");
  try {
    await waitForExit(state, CLEANUP_TIMEOUT_MS, "forced cleanup");
  } catch {
    // Preserve the original failure; never count cleanup as a successful run.
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

  const missing = await fetchWithTimeout(
    `http://127.0.0.1:${port}/feeds/probe?query=${QUERY_SENTINEL}`,
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
    missing.status === 404,
    `unregistered path returned HTTP ${missing.status}`,
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
    fail(
      `port ${port} was not released: ${error instanceof Error ? error.message : String(error)}`,
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

function assertNoSensitiveOutput(state) {
  const output = `${state.stdout}\n${state.stderr}`;
  for (const sentinel of SENSITIVE_SENTINELS) {
    assert(
      !output.includes(sentinel),
      `captured output contained sensitive sentinel ${sentinel}`,
    );
  }
}

async function runSignalScenario(signal) {
  let state;
  let database;

  try {
    database = await createSmokeDatabase(`smoke-${signal.toLowerCase()}`);
    state = spawnCaptured(serverEntry, {
      API_TOKEN,
      DATABASE_PATH: database.path,
    });
    const ready = await waitForReady(state);
    await exerciseHttp(ready.port);
    assert(state.child.kill(signal), `could not send ${signal}`);

    const exit = await waitForExit(
      state,
      NORMAL_EXIT_TIMEOUT_MS,
      `${signal} shutdown`,
    );
    assert(
      exit.code === 0,
      `${signal} exit code was ${String(exit.code)} (${String(exit.signal)})`,
    );
    assert(
      exit.signal === null,
      `${signal} terminated with signal ${exit.signal}`,
    );
    await assertPortReleased(ready.port);

    const shutdown = findEntry(
      jsonLines(state.stdout),
      (entry) => entry?.event === "shutdown",
    );
    assert(
      shutdown !== undefined,
      `${signal} smoke did not capture a shutdown event`,
    );
    assert(
      shutdown.outcome === "closed" && shutdown.forced === false,
      `${signal} smoke captured an unexpected shutdown event: ${JSON.stringify(shutdown)}`,
    );
    assertNoSensitiveOutput(state);
    console.log(
      `Smoke passed: ${signal} exited 0, released port ${ready.port}, and emitted no sensitive output`,
    );
  } finally {
    await terminateAfterFailure(state);
    if (database !== undefined) {
      await rm(database.directory, { force: true, recursive: true });
    }
  }
}

async function runListenFailureScenario() {
  const blocker = createServer();
  let state;
  let database;

  try {
    await new Promise((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    assert(
      address !== null && typeof address !== "string",
      "could not acquire a loopback port",
    );

    database = await createSmokeDatabase("smoke-listen-failure");
    state = spawnCaptured(serverEntry, {
      API_TOKEN,
      DATABASE_PATH: database.path,
      PORT: String(address.port),
    });
    const exit = await waitForExit(
      state,
      NORMAL_EXIT_TIMEOUT_MS,
      "listen-failure exit",
    );
    assert(
      exit.code === 1,
      `listen-failure exit code was ${String(exit.code)} (${String(exit.signal)})`,
    );
    assert(
      exit.signal === null,
      `listen failure terminated with signal ${exit.signal}`,
    );

    const entries = jsonLines(state.stdout);
    assert(
      findEntry(entries, (entry) => entry?.event === "ready") === undefined,
      "listen failure emitted a false ready event",
    );
    const error = findEntry(
      entries,
      (entry) => entry?.event === "error" && entry?.operation === "listen",
    );
    assert(
      error?.reason === "listen_error",
      "listen failure did not emit listen_error metadata",
    );
    assertNoSensitiveOutput(state);
    console.log(
      "Smoke passed: occupied port produced a bounded nonzero listen failure",
    );
  } finally {
    await terminateAfterFailure(state);
    await new Promise((resolve) => blocker.close(() => resolve()));
    if (database !== undefined) {
      await rm(database.directory, { force: true, recursive: true });
    }
  }
}

async function runForcedExitScenario() {
  let state;
  let database;

  try {
    database = await createSmokeDatabase("smoke-forced-exit");
    state = spawnCaptured(forcedExitEntry, {
      API_TOKEN,
      DATABASE_PATH: database.path,
    });
    const exit = await waitForExit(
      state,
      FORCED_EXIT_TIMEOUT_MS,
      "forced-exit child",
    );
    assert(
      exit.code === 1,
      `forced-exit child exited with ${String(exit.code)} (${String(exit.signal)})`,
    );
    assert(
      exit.signal === null,
      `forced-exit child was not self-terminated: ${exit.signal}`,
    );

    const shutdown = findEntry(
      jsonLines(state.stdout),
      (entry) => entry?.event === "shutdown",
    );
    assert(
      shutdown?.outcome === "timeout" && shutdown?.forced === true,
      `forced-exit child did not log a forced timeout: ${JSON.stringify(shutdown)}`,
    );
    assertNoSensitiveOutput(state);
    console.log(
      "Smoke passed: hanging close reached the 5s budget and exited 1 without external kill",
    );
  } finally {
    await terminateAfterFailure(state);
    if (database !== undefined) {
      await rm(database.directory, { force: true, recursive: true });
    }
  }
}

async function runPendingListenScenario() {
  let state;
  let database;

  try {
    database = await createSmokeDatabase("smoke-pending-listen");
    state = spawnCaptured(pendingListenEntry, {
      API_TOKEN,
      DATABASE_PATH: database.path,
    });
    await waitForEvent(state, "pending-listen", "pending-listen child");
    assert(state.child.kill("SIGTERM"), "could not send SIGTERM");
    await waitForEvent(state, "late-listening", "pending-listen child");
    await waitForEvent(state, "late-closed", "pending-listen child");

    const exit = await waitForExit(
      state,
      NORMAL_EXIT_TIMEOUT_MS,
      "pending-listen shutdown",
    );
    assert(
      exit.code === 0,
      `pending-listen exit code was ${String(exit.code)} (${String(exit.signal)})`,
    );
    assert(
      exit.signal === null,
      `pending-listen terminated with signal ${exit.signal}`,
    );

    const entries = jsonLines(state.stdout);
    assert(
      findEntry(entries, (entry) => entry?.event === "ready") === undefined,
      "pending-listen emitted a false ready event",
    );
    assert(
      findEntry(
        entries,
        (entry) => entry?.event === "error" && entry?.operation === "listen",
      ) === undefined,
      "pending-listen changed shutdown into a listen failure",
    );
    const shutdown = findEntry(entries, (entry) => entry?.event === "shutdown");
    assert(
      shutdown?.outcome === "closed" && shutdown?.forced === false,
      `pending-listen captured an unexpected shutdown: ${JSON.stringify(shutdown)}`,
    );
    assert(
      findEntry(entries, (entry) => entry?.event === "late-listening") !==
        undefined,
      "pending-listen did not establish its delayed listening resource",
    );
    assert(
      findEntry(entries, (entry) => entry?.event === "late-closed") !==
        undefined,
      "pending-listen did not close its delayed listening resource",
    );
    assertNoSensitiveOutput(state);
    console.log(
      "Smoke passed: signal before listen settled exited 0, emitted no false ready, and closed the late resource",
    );
  } finally {
    await terminateAfterFailure(state);
    if (database !== undefined) {
      await rm(database.directory, { force: true, recursive: true });
    }
  }
}

try {
  await runSignalScenario("SIGINT");
  await runSignalScenario("SIGTERM");
  await runListenFailureScenario();
  await runForcedExitScenario();
  await runPendingListenScenario();
  await runConfigurationSmoke();
  console.log("Smoke verification passed.");
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
