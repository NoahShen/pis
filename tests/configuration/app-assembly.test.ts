import { existsSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import { assembleApp } from "../../src/configuration/app-assembly.js";
import { SqliteSourceRepository } from "../../src/configuration/source-repository.js";
import { SqliteTopicRepository } from "../../src/configuration/topic-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const API_TOKEN = "assembly-token";
const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  vi.restoreAllMocks();
});

function config(databasePath: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    apiToken: API_TOKEN,
    logLevel: "silent",
    databasePath,
  };
}

describe("app assembly", () => {
  it("creates missing database parent directories and reopens the same file", async () => {
    await withTempDirectory(async (directory) => {
      const databasePath = path.join(
        directory,
        "nested",
        "state",
        "pis.sqlite",
      );
      const first = await buildApp(config(databasePath), new CapturedLogger());
      openApps.push(first);

      expect(existsSync(databasePath)).toBe(true);
      const created = await first.inject({
        method: "POST",
        url: "/api/sources",
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          "content-type": "application/json",
        },
        payload: {
          name: "Persistent Source",
          type: "RSS",
          url: "https://persistent.example.test/feed.xml",
          cron: "0 * * * *",
        },
      });
      expect(created.statusCode).toBe(201);
      await first.close();
      openApps.splice(openApps.indexOf(first), 1);

      const second = await buildApp(config(databasePath), new CapturedLogger());
      openApps.push(second);
      const listed = await second.inject({
        method: "GET",
        url: "/api/sources",
        headers: { authorization: `Bearer ${API_TOKEN}` },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject({
        items: [{ id: created.json().id, name: "Persistent Source" }],
      });
    });
  });

  it("closes an owned database exactly once when Fastify closes", async () => {
    await withDatabasePath(async (databasePath) => {
      const closeSpy = vi.spyOn(Database.prototype, "close");
      const app = await buildApp(config(databasePath), new CapturedLogger());
      openApps.push(app);

      await app.ready();
      await app.close();
      openApps.splice(openApps.indexOf(app), 1);

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("closes an owned database once when a registered plugin fails during app.ready()", async () => {
    await withDatabasePath(async (databasePath) => {
      const closeSpy = vi.spyOn(Database.prototype, "close");
      const app = Fastify({ logger: false });
      openApps.push(app);
      app.register(async () => {
        throw new Error("asynchronous route registration failure");
      });
      assembleApp(app, config(databasePath));

      await expect(app.ready()).rejects.toThrow(
        "asynchronous route registration failure",
      );
      expect(closeSpy).toHaveBeenCalledTimes(1);

      await app.close().catch(() => undefined);
      openApps.splice(openApps.indexOf(app), 1);
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps injected repositories and their caller-owned database open", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);
      initializeDatabase(db);
      const ids = new SequenceIdGenerator(["source-1", "topic-1"]);
      const app = await buildApp(config(databasePath), new CapturedLogger(), {
        repositories: {
          source: new SqliteSourceRepository(db, ids),
          topic: new SqliteTopicRepository(db, ids),
        },
      });
      openApps.push(app);

      await app.ready();
      await app.close();
      openApps.splice(openApps.indexOf(app), 1);

      expect(db.open).toBe(true);
      closeDatabase(db);
    });
  });

  it("closes a newly opened database when schema initialization fails", async () => {
    await withDatabasePath(async (databasePath) => {
      const incompatible = new Database(databasePath);
      incompatible.exec(
        "CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL) STRICT",
      );
      incompatible.close();

      const closeSpy = vi.spyOn(Database.prototype, "close");
      expect(() =>
        buildApp(config(databasePath), new CapturedLogger()),
      ).toThrow();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
