import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { XMLValidator } from "fast-xml-parser";

import type { RssArtifactStore } from "./contracts.js";
import { RssError } from "./contracts.js";

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAlreadyPresent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function invalidArtifactKey(): never {
  throw new RssError("invalid_artifact_key");
}

function unsafeArtifactPath(): never {
  throw new RssError("unsafe_path");
}

function artifactWriteFailed(): never {
  throw new RssError("artifact_write_failed");
}

function isCanonicalSegment(segment: string): boolean {
  return segment.length > 0 && SEGMENT_PATTERN.test(segment);
}

function validateArtifactKey(key: string): readonly string[] {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.includes("?") ||
    key.includes("#") ||
    path.posix.isAbsolute(key) ||
    path.posix.normalize(key) !== key
  ) {
    return invalidArtifactKey();
  }

  const segments = key.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !isCanonicalSegment(segment)) ||
    !segments.at(-1)?.endsWith(".xml") ||
    segments.at(-1) === ".xml"
  ) {
    return invalidArtifactKey();
  }
  return segments;
}

function validateListPrefix(prefix: string): void {
  if (typeof prefix !== "string") {
    return invalidArtifactKey();
  }
  if (prefix === "") {
    return;
  }
  if (
    prefix.startsWith("/") ||
    prefix.includes("\\") ||
    prefix.includes("\0") ||
    prefix.includes("?") ||
    prefix.includes("#") ||
    path.posix.isAbsolute(prefix) ||
    path.posix.normalize(prefix) !== prefix
  ) {
    return invalidArtifactKey();
  }

  const withoutTrailingSlash = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : prefix;
  const segments = withoutTrailingSlash.split("/");
  if (
    withoutTrailingSlash.length === 0 ||
    segments.some((segment) => !isCanonicalSegment(segment))
  ) {
    return invalidArtifactKey();
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function assertValidXml(bytes: Uint8Array): void {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      /<!DOCTYPE|<!ENTITY/iu.test(text) ||
      XMLValidator.validate(text) !== true
    ) {
      return artifactWriteFailed();
    }
  } catch (error) {
    if (error instanceof RssError) {
      throw error;
    }
    return artifactWriteFailed();
  }
}

async function bestEffortDirectorySync(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is a durability enhancement and is not portable.
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}

class LocalArtifactStore implements RssArtifactStore {
  readonly #rootPath: string;

  constructor(rootDirectory: string) {
    if (
      typeof rootDirectory !== "string" ||
      rootDirectory.length === 0 ||
      rootDirectory.includes("\0")
    ) {
      throw new RssError("invalid_input");
    }
    this.#rootPath = path.resolve(rootDirectory);
  }

  async #canonicalRoot(create: boolean): Promise<string | null> {
    if (create) {
      try {
        await mkdir(this.#rootPath, { recursive: true, mode: 0o700 });
      } catch {
        return artifactWriteFailed();
      }
    }

    try {
      const rootStats = await stat(this.#rootPath);
      if (!rootStats.isDirectory()) {
        return unsafeArtifactPath();
      }
      return await realpath(this.#rootPath);
    } catch (error) {
      if (!create && isNotFound(error)) {
        return null;
      }
      if (error instanceof RssError) {
        throw error;
      }
      return artifactWriteFailed();
    }
  }

  async #existingDirectory(
    root: string,
    segments: readonly string[],
  ): Promise<string | null> {
    let current = root;
    for (const segment of segments) {
      const candidate = path.join(current, segment);
      let candidateStats;
      try {
        candidateStats = await lstat(candidate);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        return artifactWriteFailed();
      }
      if (candidateStats.isSymbolicLink() || !candidateStats.isDirectory()) {
        return unsafeArtifactPath();
      }

      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch {
        return artifactWriteFailed();
      }
      if (!isWithin(root, canonical)) {
        return unsafeArtifactPath();
      }
      current = canonical;
    }
    return current;
  }

  async #ensureDirectory(
    root: string,
    segments: readonly string[],
  ): Promise<string> {
    let current = root;
    for (const segment of segments) {
      const candidate = path.join(current, segment);
      let candidateStats;
      try {
        candidateStats = await lstat(candidate);
      } catch (error) {
        if (!isNotFound(error)) {
          return artifactWriteFailed();
        }
        try {
          await mkdir(candidate, { mode: 0o700 });
        } catch (mkdirError) {
          if (!isAlreadyPresent(mkdirError)) {
            return artifactWriteFailed();
          }
        }
        try {
          candidateStats = await lstat(candidate);
        } catch {
          return artifactWriteFailed();
        }
      }
      if (candidateStats.isSymbolicLink() || !candidateStats.isDirectory()) {
        return unsafeArtifactPath();
      }

      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch {
        return artifactWriteFailed();
      }
      if (!isWithin(root, canonical)) {
        return unsafeArtifactPath();
      }
      current = canonical;
    }
    return current;
  }

  async #safeFinalStats(
    root: string,
    finalPath: string,
  ): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    let finalStats;
    try {
      finalStats = await lstat(finalPath);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      return artifactWriteFailed();
    }
    if (finalStats.isSymbolicLink() || !finalStats.isFile()) {
      return unsafeArtifactPath();
    }
    try {
      const canonical = await realpath(finalPath);
      if (!isWithin(root, canonical)) {
        return unsafeArtifactPath();
      }
    } catch {
      return artifactWriteFailed();
    }
    return finalStats;
  }

  async list(prefix: string): Promise<readonly string[]> {
    validateListPrefix(prefix);
    const root = await this.#canonicalRoot(false);
    if (root === null) {
      return Object.freeze([]);
    }

    const keys: string[] = [];
    const visit = async (directory: string, relativeDirectory: string) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isNotFound(error)) {
          return;
        }
        return artifactWriteFailed();
      }

      for (const entry of entries) {
        const childPath = path.join(directory, entry.name);
        const relativeKey = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        let childStats;
        try {
          childStats = await lstat(childPath);
        } catch {
          return artifactWriteFailed();
        }
        if (childStats.isSymbolicLink()) {
          return unsafeArtifactPath();
        }

        if (childStats.isDirectory()) {
          let childRealPath: string;
          try {
            childRealPath = await realpath(childPath);
          } catch {
            return artifactWriteFailed();
          }
          if (!isWithin(root, childRealPath)) {
            return unsafeArtifactPath();
          }
          await visit(childRealPath, relativeKey);
          continue;
        }

        if (!childStats.isFile() || !relativeKey.startsWith(prefix)) {
          continue;
        }
        try {
          validateArtifactKey(relativeKey);
        } catch {
          continue;
        }
        keys.push(relativeKey);
      }
    };

    await visit(root, "");
    keys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.freeze(keys);
  }

  async read(key: string): Promise<Uint8Array | null> {
    const segments = validateArtifactKey(key);
    const root = await this.#canonicalRoot(false);
    if (root === null) {
      return null;
    }
    const directory = await this.#existingDirectory(
      root,
      segments.slice(0, -1),
    );
    if (directory === null) {
      return null;
    }
    const finalPath = path.join(directory, segments.at(-1)!);
    const finalStats = await this.#safeFinalStats(root, finalPath);
    if (finalStats === null) {
      return null;
    }

    try {
      return new Uint8Array(await readFile(finalPath));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      return artifactWriteFailed();
    }
  }

  async write(
    key: string,
    bytes: Uint8Array,
    options: { readonly onlyIfAbsent?: boolean } = {},
  ): Promise<void> {
    const segments = validateArtifactKey(key);
    if (!(bytes instanceof Uint8Array)) {
      return artifactWriteFailed();
    }

    const root = await this.#canonicalRoot(true);
    if (root === null) {
      return artifactWriteFailed();
    }
    const directory = await this.#ensureDirectory(root, segments.slice(0, -1));
    const finalName = segments.at(-1)!;
    const finalPath = path.join(directory, finalName);
    const existing = await this.#safeFinalStats(root, finalPath);
    if (existing !== null && options.onlyIfAbsent === true) {
      throw new RssError("artifact_exists");
    }

    const temporaryPath = path.join(
      directory,
      `.${finalName}.${randomUUID()}.tmp`,
    );
    let temporaryHandle;
    let published = false;
    try {
      try {
        temporaryHandle = await open(temporaryPath, "wx", 0o600);
        await temporaryHandle.writeFile(bytes);
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle?.close().catch(() => undefined);
      }

      const reread = new Uint8Array(await readFile(temporaryPath));
      if (!equalBytes(bytes, reread)) {
        return artifactWriteFailed();
      }
      assertValidXml(reread);

      if (options.onlyIfAbsent === true) {
        try {
          await link(temporaryPath, finalPath);
        } catch (error) {
          if (isAlreadyPresent(error)) {
            throw new RssError("artifact_exists");
          }
          return artifactWriteFailed();
        }
        published = true;
        await unlink(temporaryPath);
      } else {
        await rename(temporaryPath, finalPath);
        published = true;
      }
      await bestEffortDirectorySync(directory);
    } catch (error) {
      if (error instanceof RssError) {
        throw error;
      }
      return artifactWriteFailed();
    } finally {
      if (
        !published ||
        (await lstat(temporaryPath).catch(() => null)) !== null
      ) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }
}

export function createLocalArtifactStore(
  rootDirectory: string,
): RssArtifactStore {
  return new LocalArtifactStore(rootDirectory);
}
