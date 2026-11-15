import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_NODE = "26.13.1";
const EXPECTED_NPM = "11.20.0";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function fail(message) {
  throw new Error(`Toolchain verification failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} must be ${expected}; found ${String(actual)}`);
  }
}

function readNpmVersion() {
  const nodeDirectory = path.dirname(process.execPath);
  const npmCliPath =
    process.platform === "win32"
      ? path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js")
      : path.resolve(
          nodeDirectory,
          "..",
          "lib",
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        );
  const result = spawnSync(process.execPath, [npmCliPath, "--version"], {
    encoding: "utf8",
  });

  if (result.error) {
    fail(`could not run npm from ${npmCliPath}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = result.stderr.trim() || `exit status ${result.status}`;
    fail(`npm from ${npmCliPath} failed: ${details}`);
  }

  return { path: npmCliPath, version: result.stdout.trim() };
}

const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8"),
);
const nvmVersion = (
  await readFile(path.join(projectRoot, ".nvmrc"), "utf8")
).trim();
const nodeVersionFile = (
  await readFile(path.join(projectRoot, ".node-version"), "utf8")
).trim();

assertEqual(process.versions.node, EXPECTED_NODE, "runtime Node version");

const npm = readNpmVersion();
assertEqual(npm.version, EXPECTED_NPM, "runtime npm version");

assertEqual(packageJson.type, "module", "package.json type");
assertEqual(packageJson.engines?.node, EXPECTED_NODE, "engines.node");
assertEqual(packageJson.engines?.npm, EXPECTED_NPM, "engines.npm");
assertEqual(
  packageJson.devEngines?.runtime?.name,
  "node",
  "devEngines.runtime.name",
);
assertEqual(
  packageJson.devEngines?.runtime?.version,
  EXPECTED_NODE,
  "devEngines.runtime.version",
);
assertEqual(
  packageJson.devEngines?.runtime?.onFail,
  "error",
  "devEngines.runtime.onFail",
);
assertEqual(
  packageJson.devEngines?.packageManager?.name,
  "npm",
  "devEngines.packageManager.name",
);
assertEqual(
  packageJson.devEngines?.packageManager?.version,
  EXPECTED_NPM,
  "devEngines.packageManager.version",
);
assertEqual(
  packageJson.devEngines?.packageManager?.onFail,
  "error",
  "devEngines.packageManager.onFail",
);
assertEqual(
  packageJson.packageManager,
  `npm@${EXPECTED_NPM}`,
  "packageManager",
);
assertEqual(nvmVersion, EXPECTED_NODE, ".nvmrc");
assertEqual(nodeVersionFile, EXPECTED_NODE, ".node-version");

console.log(`Node ${process.versions.node}: ${process.execPath}`);
console.log(`npm ${npm.version}: ${npm.path}`);
console.log("Project toolchain constraints verified.");
