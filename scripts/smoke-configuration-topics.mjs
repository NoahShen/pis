import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(projectRoot, "dist", "server.js");
const STARTUP_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 2_000;
const EXIT_TIMEOUT_MS = 3_000;
const API_TOKEN = `topic-configuration-smoke-token-${process.pid}`;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnServer(databasePath) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      API_TOKEN,
      DATABASE_PATH: databasePath,
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    child,
    stdout: "",
    stderr: "",
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
    child.once("error", () => resolve({ code: null, signal: null }));
    child.once("close", (code, signal) => {
      state.exit = { code, signal };
      resolve(state.exit);
    });
  });

  return state;
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
      // Preserve non-JSON diagnostics for failure reporting.
    }
  }
  return entries;
}

async function waitForReady(state) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = jsonLines(state.stdout).find(
      (entry) => entry?.event === "ready",
    );
    if (ready !== undefined) {
      assert.equal(ready.pid, state.child.pid);
      assert.ok(Number.isInteger(ready.port) && ready.port > 0);
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
          reject(new Error(`server did not exit\n${outputFor(state)}`));
        }, EXIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopServer(state) {
  assert.ok(state.child.kill("SIGTERM"), "could not send SIGTERM");
  const exit = await waitForExit(state);
  assert.equal(exit.code, 0, outputFor(state));
  assert.equal(exit.signal, null, outputFor(state));
}

async function terminateAfterFailure(state) {
  if (state === undefined || state.exit !== undefined) {
    return;
  }

  state.child.kill("SIGKILL");
  try {
    await waitForExit(state);
  } catch {
    // Preserve the original smoke failure.
  }
}

async function request(port, pathName, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathName}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export default async function runTopicPersistenceSmoke() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pis-configuration-topics-"),
  );
  const databasePath = path.join(directory, "pis.sqlite");
  const topicInput = {
    name: "  Persisted smoke topic  ",
    description: "  Persisted smoke topic description.  ",
    enabled: true,
  };
  let first;
  let second;

  try {
    first = spawnServer(databasePath);
    const firstReady = await waitForReady(first);
    const createResponse = await request(firstReady.port, "/api/topics", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(topicInput),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.name, topicInput.name);
    assert.equal(created.description, topicInput.description);
    assert.equal(created.enabled, true);
    assert.ok(typeof created.id === "string" && created.id.length > 0);
    await stopServer(first);
    first = undefined;

    second = spawnServer(databasePath);
    const secondReady = await waitForReady(second);
    const getResponse = await request(
      secondReady.port,
      `/api/topics/${encodeURIComponent(created.id)}`,
      { headers: { authorization: `Bearer ${API_TOKEN}` } },
    );
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), created);

    const listResponse = await request(secondReady.port, "/api/topics", {
      headers: { authorization: `Bearer ${API_TOKEN}` },
    });
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), { items: [created] });
    await stopServer(second);
    second = undefined;

    console.log("Smoke passed: Topic configuration persisted across restart");
  } finally {
    await terminateAfterFailure(first);
    await terminateAfterFailure(second);
    await rm(directory, { force: true, recursive: true });
  }
}
