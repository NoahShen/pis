import { describe, expect, it } from "vitest";

import { createCronScheduler } from "../../src/scheduler/index.js";
import {
  createSubmitRecorder,
  FakeCronBackend,
  insertSchedulerSource,
  withSchedulerSourceRepository,
} from "../fixtures/scheduler.js";

describe("createCronScheduler with a real SqliteSourceRepository", () => {
  it("CFG-03_SQLITE registers and submits only the enabled rows", async () => {
    await withSchedulerSourceRepository(async (repository, database) => {
      insertSchedulerSource(database, {
        id: "S-ON",
        cron: "0 * * * *",
        enabled: true,
      });
      insertSchedulerSource(database, {
        id: "S-OFF",
        cron: "15 * * * *",
        enabled: false,
      });

      // Enabled state is delegated to D03's listEnabled(), not re-queried.
      expect(repository.listEnabled().map((source) => source.id)).toEqual([
        "S-ON",
      ]);

      const backend = new FakeCronBackend();
      const recorder = createSubmitRecorder();
      const scheduler = createCronScheduler(
        { sources: repository, submit: recorder.submit },
        { backend },
      );

      scheduler.start();

      expect(backend.scheduleCalls).toHaveLength(1);
      expect(backend.scheduleCalls[0]?.options.name).toBe("S-ON");
      expect(backend.taskFor("S-OFF")).toBeUndefined();

      const enabledTask = backend.taskFor("S-ON");
      expect(enabledTask).toBeDefined();
      enabledTask?.callback();

      expect(recorder.submitted).toEqual([
        { type: "COLLECT", source_id: "S-ON" },
      ]);

      scheduler.stop();
    });
  });

  it("MANUAL_SQLITE submits enabled ids and resolves disabled or missing ids", async () => {
    await withSchedulerSourceRepository(async (repository, database) => {
      insertSchedulerSource(database, { id: "S-ON", enabled: true });
      insertSchedulerSource(database, { id: "S-OFF", enabled: false });

      const recorder = createSubmitRecorder();
      const scheduler = createCronScheduler(
        { sources: repository, submit: recorder.submit },
        { backend: new FakeCronBackend() },
      );

      await scheduler.trigger("S-ON");
      await expect(scheduler.trigger("S-OFF")).resolves.toBeUndefined();
      await expect(scheduler.trigger("missing")).resolves.toBeUndefined();

      expect(recorder.submitted).toEqual([
        { type: "COLLECT", source_id: "S-ON" },
      ]);
    });
  });
});
