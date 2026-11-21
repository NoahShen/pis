import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createProductionAssembly } from "../../src/production/application.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import {
  createProductionDependencyProbes,
  productionTestDependencies,
} from "../fixtures/production-assembly.js";
import { seedRetrieval } from "../fixtures/retrieval.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

describe("retrieval production integration", () => {
  it("queries the same injected production database without starting collection", async () => {
    const { withRetrievalFixture } = await import("../fixtures/retrieval.js");
    await withRetrievalFixture(async ({ db, databasePath }) => {
      const probes = createProductionDependencyProbes();
      const assembly = createProductionAssembly(
        appConfig({ databasePath }),
        new CapturedLogger(),
        { ...productionTestDependencies(probes), database: db },
      );

      try {
        await assembly.app.ready();
        const response = await assembly.app.inject({
          method: "GET",
          url: "/api/published-items/published-1",
          headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          id: "published-1",
          target: { id: "event-1" },
          topics: [{ id: "topic-1" }],
        });
        expect(probes.runtime.submitted).toEqual([]);
        expect(probes.scheduler.startCalls).toBe(0);
        expect(db.open).toBe(true);
      } finally {
        await assembly.app.close();
      }

      expect(db.open).toBe(false);
    });
  });

  it("queries a temporary copy through a query_only production connection", async () => {
    await withTempDirectory(async (directory) => {
      const originalPath = path.join(directory, "original.sqlite");
      const copyPath = path.join(directory, "isolated-copy.sqlite");
      const original = new Database(originalPath);
      const { initializeDatabase } =
        await import("../../src/database/schema.js");
      initializeDatabase(original);
      seedRetrieval(original);
      original.pragma("wal_checkpoint(TRUNCATE)");
      original.close();
      const originalBytes = readFileSync(originalPath);
      copyFileSync(originalPath, copyPath);

      const queryOnly = new Database(copyPath);
      queryOnly.pragma("query_only = ON");
      const probes = createProductionDependencyProbes();
      const assembly = createProductionAssembly(
        appConfig({ databasePath: copyPath }),
        new CapturedLogger(),
        { ...productionTestDependencies(probes), database: queryOnly },
      );
      try {
        await assembly.app.ready();
        for (const url of [
          "/api/topics/topic-1/items",
          "/api/events",
          "/api/events/event-1",
          "/api/events/event-1/updates",
          "/api/event-updates/update-1",
          "/api/knowledge",
          "/api/knowledge/knowledge-1",
          "/api/contents/content-1",
          "/api/published-items",
          "/api/published-items/published-1",
        ]) {
          const response = await assembly.app.inject({
            method: "GET",
            url,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          });
          expect(response.statusCode, url).toBe(200);
        }
        expect(probes.runtime.submitted).toEqual([]);
        expect(probes.scheduler.startCalls).toBe(0);
      } finally {
        await assembly.app.close();
      }

      expect(queryOnly.open).toBe(false);
      expect(readFileSync(originalPath)).toEqual(originalBytes);
      expect(readFileSync(copyPath)).toEqual(originalBytes);
    });
  });
});
