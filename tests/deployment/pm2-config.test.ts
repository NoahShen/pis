import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);

describe("PM2 deployment configuration", () => {
  it("uses one forked node process and the compiled production entry", () => {
    const config = require("../../ecosystem.config.cjs");
    expect(config.apps).toHaveLength(1);
    const app = config.apps[0];
    expect(app).toMatchObject({
      name: "pis",
      script: "dist/server.js",
      cwd: root,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      wait_ready: false,
      kill_timeout: 6000,
    });
    expect(app.env).toBeUndefined();
    expect(app.args).toBeUndefined();
  });

  it("pins pm2 without changing the frozen toolchain", () => {
    const packageJson = require("../../package.json");
    expect(packageJson.dependencies.pm2).toBe("7.1.2");
    expect(packageJson.engines).toEqual({
      node: "26.13.1",
      npm: "11.20.0",
    });
    expect(existsSync(path.join(root, "node_modules/pm2/package.json"))).toBe(
      true,
    );
    const installed = require("pm2/package.json");
    expect(installed.version).toBe("7.1.2");
  });

  it("provides an isolated smoke entry and keeps Pages opt-in", () => {
    const result = spawnSync(
      process.execPath,
      ["--check", "scripts/pm2-smoke.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const packageJson = require("../../package.json");
    expect(packageJson.scripts["smoke:pm2"]).toBe("node scripts/pm2-smoke.mjs");
    const smoke = require("node:fs").readFileSync(
      path.join(root, "scripts/pm2-smoke.mjs"),
      "utf8",
    );
    expect(smoke).toContain('name.startsWith("RSS_PAGES_")');
    expect(smoke).toContain("DATABASE_PATH");
    expect(smoke).toContain("defaultDatabase");
  });
});
