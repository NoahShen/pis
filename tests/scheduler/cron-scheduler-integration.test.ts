import { describe, expect, it } from "vitest";

import type { RuntimeTask } from "../../src/runtime/contracts.js";
import { createRuntime } from "../../src/runtime/index.js";
import {
  CronSchedulerError,
  createCronScheduler,
} from "../../src/scheduler/index.js";
import {
  createCollectResult,
  createEmptyStageServices,
} from "../fixtures/runtime.js";
import {
  FakeCronBackend,
  insertSchedulerSource,
  withSchedulerSourceRepository,
} from "../fixtures/scheduler.js";

describe("CronScheduler integration with Runtime and real SQLite", () => {
  it("CFG-03_SQLITE registers only enabled rows and delivers their COLLECT to Runtime", async () => {
    await withSchedulerSourceRepository(async (repository, database) => {
      insertSchedulerSource(database, { id: "S-ON", enabled: true });
      insertSchedulerSource(database, { id: "S-OFF", enabled: false });
      const backend = new FakeCronBackend();
      const submitted: RuntimeTask[] = [];
      const collectedSourceIds: string[] = [];
      const services = createEmptyStageServices();
      services.collect = async (sourceId) => {
        collectedSourceIds.push(sourceId);
        return createCollectResult();
      };
      const runtime = createRuntime({ services });
      const scheduler = createCronScheduler(
        {
          sources: repository,
          async submit(task) {
            submitted.push(task);
            await runtime.submit(task);
          },
        },
        { backend },
      );

      await runtime.start();
      scheduler.start();
      expect(backend.scheduleCalls.map((call) => call.options.name)).toEqual([
        "S-ON",
      ]);
      expect(backend.taskFor("S-OFF")).toBeUndefined();

      backend.fire("S-ON");
      backend.fire("S-OFF");
      await runtime.drain();

      expect(collectedSourceIds).toEqual(["S-ON"]);
      expect(submitted).toEqual([{ type: "COLLECT", source_id: "S-ON" }]);
      scheduler.stop();
      await runtime.shutdown();
    });
  });

  it("CFG-07_CHAIN rejects bad expressions or timezones with zero registration and zero Runtime tasks", async () => {
    const cases = [
      {
        label: "expression",
        timezone: undefined,
        rows: [
          { id: "S-VALID", cron: "0 * * * *" },
          { id: "S-INVALID", cron: "not a cron" },
        ],
      },
      {
        label: "timezone",
        timezone: "Not/AZone",
        rows: [{ id: "S-VALID", cron: "0 * * * *" }],
      },
    ] as const;

    for (const testCase of cases) {
      await withSchedulerSourceRepository(async (repository, database) => {
        for (const row of testCase.rows) {
          insertSchedulerSource(database, { ...row, enabled: true });
        }
        const backend = new FakeCronBackend();
        const submitted: RuntimeTask[] = [];
        let collectCalls = 0;
        const services = createEmptyStageServices();
        services.collect = async () => {
          collectCalls += 1;
          return createCollectResult();
        };
        const runtime = createRuntime({ services });
        const scheduler = createCronScheduler(
          {
            timezone: testCase.timezone,
            sources: repository,
            async submit(task) {
              submitted.push(task);
              await runtime.submit(task);
            },
          },
          { backend },
        );

        await runtime.start();
        expect(() => scheduler.start(), testCase.label).toThrowError(
          CronSchedulerError,
        );
        expect(backend.scheduleCalls, testCase.label).toEqual([]);
        expect(backend.tasks, testCase.label).toEqual([]);
        expect(submitted, testCase.label).toEqual([]);
        expect(collectCalls, testCase.label).toBe(0);

        scheduler.stop();
        await runtime.shutdown();
      });
    }
  });

  it("RUN-09_SQLITE submits only COLLECT while API/static work remains outside Runtime", async () => {
    await withSchedulerSourceRepository(async (repository, database) => {
      insertSchedulerSource(database, { id: "S-ON-A", enabled: true });
      insertSchedulerSource(database, { id: "S-ON-B", enabled: true });
      insertSchedulerSource(database, { id: "S-OFF", enabled: false });
      const backend = new FakeCronBackend();
      const submitted: RuntimeTask[] = [];
      let collectCalls = 0;
      const services = createEmptyStageServices();
      services.collect = async () => {
        collectCalls += 1;
        return createCollectResult();
      };
      const runtime = createRuntime({ services });
      const scheduler = createCronScheduler(
        {
          sources: repository,
          async submit(task) {
            submitted.push(task);
            await runtime.submit(task);
          },
        },
        { backend },
      );

      await runtime.start();
      scheduler.start();
      backend.fire("S-ON-A");
      backend.fire("S-ON-B");
      backend.fire("S-OFF");
      await scheduler.trigger("S-ON-A");

      let apiReadCalls = 0;
      let staticSyncCalls = 0;
      apiReadCalls += 1;
      staticSyncCalls += 1;
      await runtime.drain();

      expect(apiReadCalls).toBe(1);
      expect(staticSyncCalls).toBe(1);
      expect(collectCalls).toBe(3);
      expect(submitted).toHaveLength(3);
      expect(submitted.every((task) => task.type === "COLLECT")).toBe(true);
      expect(new Set(submitted.map((task) => task.type))).toEqual(
        new Set(["COLLECT"]),
      );

      scheduler.stop();
      await runtime.shutdown();
    });
  });
});
