import { describe, expect, it } from "vitest";

import { createProductionAssembly } from "../../src/production/application.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import {
  createProductionDependencyProbes,
  productionTestDependencies,
} from "../fixtures/production-assembly.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

describe("retrieval production integration", () => {
  it("queries the same injected production database without starting collection", async () => {
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
});
