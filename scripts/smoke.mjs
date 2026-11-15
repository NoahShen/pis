import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
            new Error(
              `${label} exceeded ${timeoutMs}ms\n${outputFor(state)}`,
            ),
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

  fail(`server did not become ready within ${STARTUP_TIMEOUT_MS}ms\n${outputFor(state)}`);
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
  const health = await fetchWithTimeout(`http://127.0.0.1:${port}/health?query=${QUERY_SENTINEL}`, {
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      cookie: `session=${COOKIE_SENTINEL}`,
      "x-rss-url": RSS_SENTINEL,
    },
  });
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
  assert(missing.status === 404, `unregistered path returned HTTP ${missing.status}`);
}

async function assertPortReleased(port) {
  const probe = createServer();

  try {
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    fail(`port ${port} was not released: ${error instanceof Error ? error.message : String(error)}`);
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
    assert(!output.includes(sentinel), `captured output contained sensitive sentinel ${sentinel}`);
  }
}

async function runSignalScenario(signal) {
  let state;

  try {
    state = spawnCaptured(serverEntry, { API_TOKEN });
    const ready = await waitForReady(state);
    await exerciseHttp(ready.port);
    assert(state.child.kill(signal), `could not send ${signal}`);

    const exit = await waitForExit(state, NORMAL_EXIT_TIMEOUT_MS, `${signal} shutdown`);
    assert(exit.code === 0, `${signal} exit code was ${String(exit.code)} (${String(exit.signal)})`);
    assert(exit.signal === null, `${signal} terminated with signal ${exit.signal}`);
    await assertPortReleased(ready.port);

    const shutdown = findEntry(
      jsonLines(state.stdout),
      (entry) => entry?.event === "shutdown",
    );
    assert(shutdown !== undefined, `${signal} smoke did not capture a shutdown event`);
    assert(
      shutdown.outcome === "closed" && shutdown.forced === false,
      `${signal} smoke captured an unexpected shutdown event: ${JSON.stringify(shutdown)}`,
    );
    assertNoSensitiveOutput(state);
    console.log(`Smoke passed: ${signal} exited 0, released port ${ready.port}, and emitted no sensitive output`);
  } finally {
    await terminateAfterFailure(state);
  }
}

async function runListenFailureScenario() {
  const blocker = createServer();
  let state;

  try {
    await new Promise((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    assert(address !== null && typeof address !== "string", "could not acquire a loopback port");

    state = spawnCaptured(serverEntry, {
      API_TOKEN,
      PORT: String(address.port),
    });
    const exit = await waitForExit(
      state,
      NORMAL_EXIT_TIMEOUT_MS,
      "listen-failure exit",
    );
    assert(exit.code === 1, `listen-failure exit code was ${String(exit.code)} (${String(exit.signal)})`);
    assert(exit.signal === null, `listen failure terminated with signal ${exit.signal}`);

    const entries = jsonLines(state.stdout);
    assert(
      findEntry(entries, (entry) => entry?.event === "ready") === undefined,
      "listen failure emitted a false ready event",
    );
    const error = findEntry(
      entries,
      (entry) => entry?.event === "error" && entry?.operation === "listen",
    );
    assert(error?.reason === "listen_error", "listen failure did not emit listen_error metadata");
    assertNoSensitiveOutput(state);
    console.log("Smoke passed: occupied port produced a bounded nonzero listen failure");
  } finally {
    await terminateAfterFailure(state);
    await new Promise((resolve) => blocker.close(() => resolve()));
  }
}

async function runForcedExitScenario() {
  let state;

  try {
    state = spawnCaptured(forcedExitEntry, { API_TOKEN });
    const exit = await waitForExit(
      state,
      FORCED_EXIT_TIMEOUT_MS,
      "forced-exit child",
    );
    assert(exit.code === 1, `forced-exit child exited with ${String(exit.code)} (${String(exit.signal)})`);
    assert(exit.signal === null, `forced-exit child was not self-terminated: ${exit.signal}`);

    const shutdown = findEntry(
      jsonLines(state.stdout),
      (entry) => entry?.event === "shutdown",
    );
    assert(
      shutdown?.outcome === "timeout" && shutdown?.forced === true,
      `forced-exit child did not log a forced timeout: ${JSON.stringify(shutdown)}`,
    );
    assertNoSensitiveOutput(state);
    console.log("Smoke passed: hanging close reached the 5s budget and exited 1 without external kill");
  } finally {
    await terminateAfterFailure(state);
  }
}

try {
  await runSignalScenario("SIGINT");
  await runSignalScenario("SIGTERM");
  await runListenFailureScenario();
  await runForcedExitScenario();
  console.log("Smoke verification passed.");
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
