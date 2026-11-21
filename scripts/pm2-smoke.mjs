import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pm2 = path.join(root, "node_modules", "pm2", "bin", "pm2");
const config = path.join(root, "ecosystem.config.cjs");
const application = "pis";
const commandTimeout = 12_000;
const token = `pm2-smoke-token-${process.pid}`;
const key = `pm2-smoke-key-${process.pid}`;
const model = `pm2-smoke-model-${process.pid}`;
const sentinels = [token, key, model];
const pagesVariables = Object.keys(process.env).filter((name) =>
  name.startsWith("RSS_PAGES_"),
);
const defaultDatabase = path.join(root, "data", "pis.sqlite");

function assert(condition, message) {
  if (!condition) throw new Error(`PM2 smoke failed: ${message}`);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function signal(pid, signalName) {
  try {
    process.kill(pid, signalName);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function terminatePids(pids) {
  const remaining = [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
  );
  for (const signalName of ["SIGTERM", "SIGKILL"]) {
    for (const pid of remaining) if (alive(pid)) signal(pid, signalName);
    const deadline = Date.now() + 2_000;
    while (remaining.some(alive) && Date.now() < deadline) await delay(25);
    if (!remaining.some(alive)) return;
  }
  assert(!remaining.some(alive), "owned processes did not exit after SIGKILL");
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, message, milliseconds = 12_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`PM2 smoke failed: ${message}`);
}

async function portIsFree(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

async function readLogs(directory) {
  const names = await readdir(directory, { recursive: true });
  let output = "";
  for (const name of names) {
    const file = path.join(directory, name);
    if (existsSync(file) && (await stat(file)).isFile()) {
      output += await readFile(file, "utf8");
    }
  }
  return output;
}

let directory;
let succeeded = false;
let env;
const ownedPids = new Set();

function runOwned(argumentsList, timeout = commandTimeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(argumentsList[0], argumentsList.slice(1), {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    ownedPids.add(child.pid);
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ownedPids.delete(child.pid);
      if (error !== undefined) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      signal(-child.pid, "SIGKILL");
      signal(child.pid, "SIGKILL");
      finish(undefined, new Error("PM2 smoke failed: owned command timed out"));
    }, timeout);
    child.once("error", (error) => finish(undefined, error));
    child.once("close", (code, signalName) => {
      finish({ code, signal: signalName, stdout, stderr });
    });
  });
}

async function requirePm2(argumentsList) {
  const result = await runOwned([process.execPath, pm2, ...argumentsList]);
  assert(
    result.code === 0,
    `${argumentsList[0]} exited ${String(result.code)} (${String(result.signal)})`,
  );
  return result;
}

async function discoverOwnedProcesses() {
  const daemonPidFile = path.join(env.PM2_HOME, "pm2.pid");
  if (existsSync(daemonPidFile)) {
    const pid = Number((await readFile(daemonPidFile, "utf8")).trim());
    if (Number.isInteger(pid)) ownedPids.add(pid);
  }
  const result = await runOwned(["/bin/ps", "-axo", "pid=,command="]);
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match && match[2].includes(env.PM2_HOME)) {
      ownedPids.add(Number(match[1]));
    }
  }
}

async function clean() {
  if (env === undefined) return;
  // The daemon cannot own process cleanup: pm2 kill may hang on Node 26.
  await discoverOwnedProcesses();
  await terminatePids([...ownedPids]);
}

try {
  assert(existsSync(path.join(root, "dist", "server.js")), "build first");
  assert(!existsSync(defaultDatabase), "default database already exists");
  directory = await mkdtemp(path.join(os.tmpdir(), "pis-pm2-smoke-"));
  const port = await allocatePort();
  env = {
    PATH: process.env.PATH,
    HOME: path.join(directory, "home"),
    PM2_HOME: path.join(directory, "pm2-home"),
    PM2_DISABLE_COLORS: "true",
    PM2_NO_AUTODUMP: "true",
    PM2_NO_INTERACTION: "true",
    API_TOKEN: token,
    LOG_LEVEL: "info",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: path.join(directory, "isolated.sqlite"),
    PIS_LLM_ENDPOINT: `http://127.0.0.1:9/pm2-smoke-${process.pid}`,
    PIS_LLM_API_KEY: key,
    PIS_LLM_MODEL: model,
    PROMPTS_DIR: path.join(root, "config", "prompts"),
    RSS_SSRF_PROTECTION: "true",
    CRON_TIMEZONE: "Asia/Shanghai",
  };
  for (const name of pagesVariables) {
    assert(env[name] === undefined, `Pages variable was not cleared: ${name}`);
  }

  await requirePm2(["start", config, "--only", application]);
  await waitFor(async () => {
    const result = await requirePm2(["jlist"]);
    const processInfo = JSON.parse(result.stdout).find(
      (item) => item.name === application,
    );
    assert(processInfo !== undefined, "application was absent from jlist");
    assert(
      !["errored", "stopped"].includes(processInfo.pm2_env?.status),
      `application status ${String(processInfo.pm2_env?.status)}`,
    );
    return processInfo.pm2_env?.status === "online";
  }, "process did not become online");

  let health;
  await waitFor(async () => {
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_000),
      });
      return health.status === 200;
    } catch {
      return false;
    }
  }, "Fastify did not listen after PM2 online");
  assert(
    JSON.stringify(await health.json()) === JSON.stringify({ status: "ok" }),
    "health body was not {status:ok}",
  );
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2_000),
  });
  assert(unauthorized.status === 401, "unauthenticated health was not 401");

  await requirePm2(["restart", application, "--update-env"]);
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_000),
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }, "process did not serve health after restart");
  await requirePm2(["stop", application]);
  await waitFor(() => portIsFree(port), "port was not released after stop");
  await requirePm2(["delete", application]);

  const logs = await readLogs(directory);
  for (const sentinel of sentinels) {
    assert(!logs.includes(sentinel), "logs contained a sensitive sentinel");
  }
  await clean();
  await rm(directory, { recursive: true, force: true });
  assert(!existsSync(defaultDatabase), "default database was touched");
  succeeded = true;
  console.log(
    "PM2 smoke PASS: isolated DB/port/Pages env, authenticated health, restart, stop, port release, safe logs, exact PID cleanup.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (directory !== undefined) {
    console.error(`PM2 smoke private diagnostics: ${directory}`);
  }
  process.exitCode = 1;
} finally {
  await clean();
  if (succeeded && directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
  }
}
