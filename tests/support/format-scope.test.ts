import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { withTempDirectory } from "../fixtures/temp-directory.js";

// @ts-expect-error The executable formatter is plain ESM and outside the TypeScript graph.
import * as formatScope from "../../scripts/format.mjs";

const { FormatScopeError, collectFormatTargets } = formatScope;

async function withProject<T>(
  files: readonly string[],
  callback: (projectRoot: string) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory(async (directory) => {
    for (const relativePath of files) {
      const absolutePath = path.join(directory, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "formatted");
    }

    return callback(directory);
  });
}

describe("format scope", () => {
  it("format target list contains only explicit engineering paths", async () => {
    await withProject(
      [
        "src/nested/value.ts",
        "tests/fixture.mjs",
        "scripts/tool.mjs",
        ".github/workflows/ci.yml",
        "package.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "tsconfig.test.json",
        "vitest.config.ts",
        "README.md",
        "docs/ignored.md",
        "package-lock.json",
      ],
      async (projectRoot) => {
        const targets = await collectFormatTargets({ projectRoot });

        expect(targets).toEqual([
          ".github/workflows/ci.yml",
          "package.json",
          "README.md",
          "scripts/tool.mjs",
          "src/nested/value.ts",
          "tests/fixture.mjs",
          "tsconfig.build.json",
          "tsconfig.json",
          "tsconfig.test.json",
          "vitest.config.ts",
        ]);
        expect(targets).not.toContain("docs/ignored.md");
        expect(targets).not.toContain("package-lock.json");
      },
    );
  });

  it("format target collection rejects empty and out-of-scope paths", async () => {
    await withProject(["src/value.ts"], async (projectRoot) => {
      for (const targetPaths of [
        [],
        ["docs/plan.md"],
        ["../outside.ts"],
        [""],
      ]) {
        await expect(
          collectFormatTargets({ projectRoot, targetPaths }),
        ).rejects.toBeInstanceOf(FormatScopeError);
      }
    });
  });

  it("format target collection rejects missing paths and symbolic links", async () => {
    await withProject(["src/value.ts"], async (projectRoot) => {
      await expect(
        collectFormatTargets({ projectRoot, targetPaths: ["src/missing.ts"] }),
      ).rejects.toThrow("does not exist");

      await symlink("value.ts", path.join(projectRoot, "src/link.ts"));
      await expect(
        collectFormatTargets({ projectRoot, targetPaths: ["src/link.ts"] }),
      ).rejects.toThrow("symbolic link");
    });
  });
});
