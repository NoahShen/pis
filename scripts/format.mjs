import {
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const DIRECTORY_TARGETS = ["src", "tests", "scripts", ".github"];
const FILE_TARGETS = [
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.test.json",
  "vitest.config.ts",
  "README.md",
];
const DEFAULT_TARGET_PATHS = [...DIRECTORY_TARGETS, ...FILE_TARGETS];

export class FormatScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormatScopeError";
  }
}

/** @param {string} value */
function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

/** @param {string} parent @param {string} candidate */
function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** @param {string} relativePath */
function isAllowedRelativePath(relativePath) {
  return (
    FILE_TARGETS.includes(relativePath) ||
    DIRECTORY_TARGETS.some(
      (directory) =>
        relativePath === directory || relativePath.startsWith(`${directory}/`),
    )
  );
}

/** @param {string} absolutePath @param {string} relativePath */
async function assertNoSymbolicLink(absolutePath, relativePath) {
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new FormatScopeError(
      `Format target must not be a symbolic link: ${relativePath}`,
    );
  }

  return stats;
}

/**
 * @param {string} rootDirectory
 * @param {string} relativeTarget
 * @param {Set<string>} files
 */
async function collectFiles(rootDirectory, relativeTarget, files) {
  const normalizedTarget = toPosixPath(relativeTarget);
  if (!isAllowedRelativePath(normalizedTarget)) {
    throw new FormatScopeError(
      `Format target is out of scope: ${normalizedTarget}`,
    );
  }

  const absoluteTarget = path.resolve(rootDirectory, normalizedTarget);
  if (!isWithin(rootDirectory, absoluteTarget)) {
    throw new FormatScopeError(
      `Format target escapes the project root: ${normalizedTarget}`,
    );
  }

  const resolvedRelativeTarget = toPosixPath(
    path.relative(rootDirectory, absoluteTarget),
  );
  if (!isAllowedRelativePath(resolvedRelativeTarget)) {
    throw new FormatScopeError(
      `Format target is out of scope: ${normalizedTarget}`,
    );
  }

  let stats;
  try {
    stats = await assertNoSymbolicLink(absoluteTarget, normalizedTarget);
  } catch (error) {
    if (error instanceof FormatScopeError) {
      throw error;
    }

    throw new FormatScopeError(
      `Format target does not exist: ${normalizedTarget}`,
    );
  }

  if (stats.isFile()) {
    files.add(normalizedTarget);
    return;
  }

  if (!stats.isDirectory()) {
    throw new FormatScopeError(
      `Format target must be a regular file or directory: ${normalizedTarget}`,
    );
  }

  const entries = await readdir(absoluteTarget, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    await collectFiles(
      rootDirectory,
      `${normalizedTarget}/${entry.name}`,
      files,
    );
  }
}

/**
 * @param {{
 *   projectRoot?: string;
 *   targetPaths?: readonly string[];
 * }} options
 * @returns {Promise<string[]>}
 */
export async function collectFormatTargets({
  projectRoot = DEFAULT_PROJECT_ROOT,
  targetPaths = DEFAULT_TARGET_PATHS,
} = {}) {
  if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
    throw new FormatScopeError(
      "At least one explicit format target is required",
    );
  }

  let canonicalRoot;
  try {
    const rootStats = await assertNoSymbolicLink(projectRoot, ".");
    if (!rootStats.isDirectory()) {
      throw new FormatScopeError("Project root must be a directory");
    }
    canonicalRoot = await realpath(projectRoot);
  } catch (error) {
    if (error instanceof FormatScopeError) {
      throw error;
    }

    throw new FormatScopeError("Project root does not exist");
  }

  const files = new Set();
  for (const targetPath of targetPaths) {
    if (typeof targetPath !== "string" || targetPath.length === 0) {
      throw new FormatScopeError("Format targets must be non-empty strings");
    }

    await collectFiles(canonicalRoot, targetPath, files);
  }

  if (files.size === 0) {
    throw new FormatScopeError("No format targets were found");
  }

  return [...files].sort((left, right) => left.localeCompare(right, "en"));
}

/** @param {string[]} argumentsList */
function parseMode(argumentsList) {
  if (argumentsList.length !== 1) {
    throw new FormatScopeError(
      "Specify exactly one of --check, --write, or --list",
    );
  }

  const [argument] = argumentsList;
  const mode = argument?.slice(2);
  if (mode !== "check" && mode !== "write" && mode !== "list") {
    throw new FormatScopeError(`Unknown format mode: ${String(argument)}`);
  }

  return mode;
}

async function run() {
  const mode = parseMode(process.argv.slice(2));
  const targets = await collectFormatTargets();

  if (mode === "list") {
    for (const target of targets) {
      console.log(target);
    }
    return;
  }

  const unformatted = [];
  for (const relativePath of targets) {
    const absolutePath = path.join(DEFAULT_PROJECT_ROOT, relativePath);
    const source = await readFile(absolutePath, "utf8");

    if (mode === "check") {
      if (!(await prettier.check(source, { filepath: absolutePath }))) {
        unformatted.push(relativePath);
      }
      continue;
    }

    const formatted = await prettier.format(source, { filepath: absolutePath });
    if (formatted !== source) {
      await writeFile(absolutePath, formatted, "utf8");
    }
  }

  if (mode === "check" && unformatted.length > 0) {
    throw new FormatScopeError(
      `Formatting check failed:\n${unformatted.map((file) => `- ${file}`).join("\n")}`,
    );
  }

  console.log(
    mode === "check"
      ? `Formatting check passed for ${targets.length} files.`
      : `Formatted ${targets.length} files.`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  try {
    await run();
  } catch (error) {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  }
}
