import { existsSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { withTempDirectory } from "../fixtures/temp-directory.js";

describe("withTempDirectory", () => {
  it("withTempDirectory cleans after callback success", async () => {
    const directories: string[] = [];

    const syncResult = await withTempDirectory((directory) => {
      directories.push(directory);
      writeFileSync(path.join(directory, "sync.txt"), "sync");
      return "sync-result";
    });

    expect(syncResult).toBe("sync-result");

    const asyncResult = await withTempDirectory(async (directory) => {
      directories.push(directory);
      await writeFile(path.join(directory, "async.txt"), "async");
      return 42;
    });

    expect(asyncResult).toBe(42);
    expect(directories).toHaveLength(2);
    expect(directories[0]).not.toBe(directories[1]);

    for (const directory of directories) {
      expect(existsSync(directory)).toBe(false);
    }
  });

  it("withTempDirectory cleans after callback failure and rethrows", async () => {
    let asyncFailureDirectory = "";
    const asyncFailure = new Error("async callback failure");

    await expect(
      withTempDirectory(async (directory) => {
        asyncFailureDirectory = directory;
        await writeFile(path.join(directory, "async-failure.txt"), "failure");
        throw asyncFailure;
      }),
    ).rejects.toBe(asyncFailure);

    expect(asyncFailureDirectory).not.toBe("");
    expect(existsSync(asyncFailureDirectory)).toBe(false);

    let syncFailureDirectory = "";
    const syncFailure = new Error("sync callback failure");

    await expect(
      withTempDirectory((directory) => {
        syncFailureDirectory = directory;
        throw syncFailure;
      }),
    ).rejects.toBe(syncFailure);

    expect(syncFailureDirectory).not.toBe("");
    expect(existsSync(syncFailureDirectory)).toBe(false);
  });
});
