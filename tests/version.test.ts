import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { APP_VERSION } from "../src/version.js";

describe("application version", () => {
  it("APP_VERSION matches package.json version", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(APP_VERSION).toBe(packageJson.version);
  });
});
