import { describe, expect, it } from "vitest";

import type { RuntimeTask } from "../../src/runtime/contracts.js";
import {
  CronSchedulerError,
  createCronScheduler,
} from "../../src/scheduler/index.js";
import {
  createSchedulerSource,
  createSubmitRecorder,
  FakeCronBackend,
  FakeSourceRepository,
} from "../fixtures/scheduler.js";

describe("createCronScheduler with a fake backend", () => {
  it("CFG-03_ENABLED_ONLY registers enabled Sources and submits their COLLECT tasks", () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
      createSchedulerSource({ id: "S-ON2" }),
      createSchedulerSource({ id: "S-OFF", enabled: false }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    scheduler.start();

    expect(sources.listEnabledCalls).toBe(1);
    expect(backend.scheduleCalls).toHaveLength(2);
    expect(backend.scheduleCalls.map((call) => call.options.name)).toEqual([
      "S-ON",
      "S-ON2",
    ]);
    expect(backend.taskFor("S-OFF")).toBeUndefined();

    for (const task of backend.tasks) {
      task.callback();
    }

    expect(recorder.submitted).toEqual([
      { type: "COLLECT", source_id: "S-ON" },
      { type: "COLLECT", source_id: "S-ON2" },
    ]);

    scheduler.stop();
  });

  it("MANUAL_ENABLED submits one COLLECT when triggering an enabled Source", async () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
      createSchedulerSource({ id: "S-OFF", enabled: false }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    await scheduler.trigger("S-ON");

    expect(recorder.submitted).toEqual([
      { type: "COLLECT", source_id: "S-ON" },
    ]);
    expect(sources.listEnabledCalls).toBe(1);

    await scheduler.trigger("missing-source");
    expect(sources.listEnabledCalls).toBe(2);
    expect(recorder.submitted).toHaveLength(1);
  });

  it("MANUAL_DISABLED resolves with no submit for disabled, missing, or blank ids", async () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
      createSchedulerSource({ id: "S-OFF", enabled: false }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    await expect(scheduler.trigger("S-OFF")).resolves.toBeUndefined();
    await expect(scheduler.trigger("does-not-exist")).resolves.toBeUndefined();
    await expect(scheduler.trigger("")).resolves.toBeUndefined();
    await expect(scheduler.trigger("   ")).resolves.toBeUndefined();

    expect(recorder.submitted).toEqual([]);
    expect(backend.scheduleCalls).toEqual([]);
  });

  // Intent: manual trigger() lets an enabled submit rejection propagate to the
  // caller. This intentionally differs from the Cron callback, which captures
  // rejections to avoid unhandledRejection (see CB_SUBMIT_REJECTION below).
  it("MANUAL_SUBMIT_REJECTION propagates an enabled submit failure to the caller", async () => {
    const backend = new FakeCronBackend();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
    ]);
    const scheduler = createCronScheduler(
      {
        sources,
        submit: async () => {
          throw new Error("submit rejected");
        },
      },
      { backend },
    );

    await expect(scheduler.trigger("S-ON")).rejects.toThrow("submit rejected");
  });

  it("CFG-07_EXPR_NO_PARTIAL rejects a bad expression with zero scheduling", () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-VALID", cron: "0 * * * *" }),
          createSchedulerSource({ id: "S-INVALID", cron: "not a cron" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    expect(() => scheduler.start()).toThrowError(CronSchedulerError);
    expect(backend.validateCalls).toEqual(["0 * * * *", "not a cron"]);
    expect(backend.scheduleCalls).toHaveLength(0);
    expect(backend.tasks).toHaveLength(0);

    // The registry stayed empty, so a later stop touches nothing.
    scheduler.stop();
    expect(backend.tasks).toHaveLength(0);
  });

  it("CFG-07_TZ rejects an invalid timezone before registration", () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        timezone: "Not/AZone",
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-ON" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    expect(() => scheduler.start()).toThrowError(CronSchedulerError);
    expect(backend.scheduleCalls).toHaveLength(0);
    expect(backend.tasks).toHaveLength(0);
  });

  it("DEFAULT_TZ registers with Asia/Shanghai when no timezone is provided", () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-ON" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    scheduler.start();

    expect(backend.scheduleCalls).toHaveLength(1);
    expect(backend.scheduleCalls[0]?.options.timezone).toBe("Asia/Shanghai");

    scheduler.stop();
  });

  it("RUN-09_COLLECT_ONLY only ever submits COLLECT tasks", async () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
      createSchedulerSource({ id: "S-ON2" }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    scheduler.start();
    for (const task of backend.tasks) {
      task.callback();
    }
    await scheduler.trigger("S-ON");
    await scheduler.trigger("S-ON2");

    expect(recorder.submitted.length).toBeGreaterThan(0);
    for (const task of recorder.submitted) {
      expect(task.type).toBe("COLLECT");
    }
    expect(new Set(recorder.submitted.map((task) => task.type))).toEqual(
      new Set(["COLLECT"]),
    );

    scheduler.stop();
  });

  it("STOP destroys every registration idempotently and keeps queued work", async () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
      createSchedulerSource({ id: "S-ON2" }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    scheduler.start();
    for (const task of backend.tasks) {
      task.callback();
    }
    const queued = [...recorder.submitted];
    expect(queued).toHaveLength(2);

    scheduler.stop();
    expect(backend.tasks.map((task) => task.stopCalls)).toEqual([1, 1]);
    expect(backend.tasks.map((task) => task.destroyCalls)).toEqual([1, 1]);
    expect(recorder.submitted).toEqual(queued);

    scheduler.stop();
    expect(backend.tasks.map((task) => task.stopCalls)).toEqual([1, 1]);
    expect(backend.tasks.map((task) => task.destroyCalls)).toEqual([1, 1]);
    expect(recorder.submitted).toEqual(queued);

    await scheduler.trigger("S-ON");
    expect(recorder.submitted).toEqual([
      ...queued,
      { type: "COLLECT", source_id: "S-ON" },
    ]);
  });

  it("START_IDEMPOTENT does not register twice when start is repeated", () => {
    const backend = new FakeCronBackend();
    const recorder = createSubmitRecorder();
    const sources = new FakeSourceRepository([
      createSchedulerSource({ id: "S-ON" }),
    ]);
    const scheduler = createCronScheduler(
      { sources, submit: recorder.submit },
      { backend },
    );

    scheduler.start();
    scheduler.start();
    scheduler.start();

    expect(backend.tasks).toHaveLength(1);
    expect(backend.scheduleCalls).toHaveLength(1);
    expect(sources.listEnabledCalls).toBe(1);

    scheduler.stop();
  });

  it("CFG-07_REGISTRATION_ROLLBACK destroys partial registrations when schedule throws", () => {
    const backend = new FakeCronBackend({
      throwOnScheduleExpressions: ["30 * * * *"],
    });
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-FIRST", cron: "0 * * * *" }),
          createSchedulerSource({ id: "S-SECOND", cron: "30 * * * *" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    expect(() => scheduler.start()).toThrowError(CronSchedulerError);
    expect(backend.scheduleCalls).toHaveLength(2);
    expect(backend.tasks).toHaveLength(1);
    expect(backend.tasks[0]?.stopCalls).toBe(1);
    expect(backend.tasks[0]?.destroyCalls).toBe(1);

    // The partial registration was cleared, so a follow-up stop is a no-op.
    scheduler.stop();
    expect(backend.tasks[0]?.stopCalls).toBe(1);
    expect(backend.tasks[0]?.destroyCalls).toBe(1);
  });

  it("CFG-07_HOSTILE_ROLLBACK swallows cleanup errors and retries cleanly", () => {
    const backend = new FakeCronBackend({
      throwOnScheduleExpressions: ["30 * * * *"],
      throwOnStopExpressions: ["0 * * * *"],
    });
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-FIRST", cron: "0 * * * *" }),
          createSchedulerSource({ id: "S-SECOND", cron: "30 * * * *" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    let thrown: unknown;
    try {
      scheduler.start();
    } catch (error) {
      thrown = error;
    }

    // The raw backend errors never leak: start() always throws the fixed shape.
    expect(thrown).toBeInstanceOf(CronSchedulerError);
    expect((thrown as CronSchedulerError).code).toBe("invalid_cron");

    const firstTask = backend.taskFor("S-FIRST");
    expect(firstTask).toBeDefined();
    // The old timer was still torn down even though its stop() threw.
    expect(firstTask?.stopCalls).toBe(1);
    expect(firstTask?.destroyCalls).toBe(1);

    // Registry was cleared: a retry registers from scratch with no stale timer.
    const schedulesBeforeRetry = backend.scheduleCalls.length;
    expect(schedulesBeforeRetry).toBe(2);
    backend.clearThrowOnSchedule("30 * * * *");
    scheduler.start();

    // Retry schedules exactly the enabled count, and the live timers are one
    // per Source (the destroyed attempt-one timer is not re-registered).
    expect(backend.scheduleCalls).toHaveLength(schedulesBeforeRetry + 2);
    const live = backend.tasks.filter(
      (task) => task.stopCalls === 0 && task.destroyCalls === 0,
    );
    expect(live.map((task) => task.options.name)).toEqual([
      "S-FIRST",
      "S-SECOND",
    ]);

    scheduler.stop();
  });

  it("STOP_HOSTILE never throws and stays idempotent under hostile teardown", () => {
    const backend = new FakeCronBackend({
      throwOnStopExpressions: ["0 * * * *"],
      throwOnDestroyExpressions: ["15 * * * *"],
    });
    const recorder = createSubmitRecorder();
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-ONE", cron: "0 * * * *" }),
          createSchedulerSource({ id: "S-TWO", cron: "15 * * * *" }),
        ]),
        submit: recorder.submit,
      },
      { backend },
    );

    scheduler.start();
    expect(backend.tasks).toHaveLength(2);

    expect(() => scheduler.stop()).not.toThrow();
    const [one, two] = backend.tasks;
    // Both tasks were attempted; a throwing stop/destroy did not block the
    // other step or the other task.
    expect(one?.stopCalls).toBe(1);
    expect(one?.destroyCalls).toBe(1);
    expect(two?.stopCalls).toBe(1);
    expect(two?.destroyCalls).toBe(1);

    // A second stop is a no-op and never throws.
    expect(() => scheduler.stop()).not.toThrow();
    expect(one?.stopCalls).toBe(1);
    expect(two?.stopCalls).toBe(1);
  });

  it("REAL_NODE_CRON validates real expressions without advancing time", () => {
    const recorder = createSubmitRecorder();
    const invalidScheduler = createCronScheduler({
      sources: new FakeSourceRepository([
        createSchedulerSource({ id: "S-INVALID", cron: "not a cron" }),
      ]),
      submit: recorder.submit,
    });

    expect(invalidScheduler).toBeDefined();
    expect(() => invalidScheduler.start()).toThrowError(CronSchedulerError);
    expect(recorder.submitted).toEqual([]);

    const validScheduler = createCronScheduler({
      sources: new FakeSourceRepository([
        createSchedulerSource({ id: "S-VALID", cron: "0 0 29 2 *" }),
      ]),
      submit: recorder.submit,
    });

    try {
      expect(() => validScheduler.start()).not.toThrow();
    } finally {
      validScheduler.stop();
    }

    expect(recorder.submitted).toEqual([]);
  });

  it("ERROR_SHAPE exposes a stable code/message without a cause", () => {
    const scheduler = createCronScheduler(
      {
        sources: new FakeSourceRepository([
          createSchedulerSource({ id: "S-INVALID", cron: "not a cron" }),
        ]),
        submit: createSubmitRecorder().submit,
      },
      { backend: new FakeCronBackend() },
    );

    let thrown: unknown;
    try {
      scheduler.start();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CronSchedulerError);
    const cronError = thrown as CronSchedulerError;
    expect(cronError.name).toBe("CronSchedulerError");
    expect(cronError.code).toBe("invalid_cron");
    expect(cronError.message).toBe("Invalid cron configuration");
    expect(Object.hasOwn(cronError, "cause")).toBe(false);

    const withCause: { cause?: unknown } = cronError;
    expect(withCause.cause).toBeUndefined();
  });

  // Intent: Cron callbacks capture submit rejections (void ... .catch) so one
  // failing Source cannot produce an unhandled rejection or affect other
  // Sources. Manual trigger() deliberately propagates instead (see
  // MANUAL_SUBMIT_REJECTION above); the difference is intentional.
  it("CB_SUBMIT_REJECTION captures cron callback rejections without unhandled rejections", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const backend = new FakeCronBackend();
      const submitted: RuntimeTask[] = [];
      const scheduler = createCronScheduler(
        {
          sources: new FakeSourceRepository([
            createSchedulerSource({ id: "S-ON" }),
            createSchedulerSource({ id: "S-ON2" }),
          ]),
          submit: async (task: RuntimeTask): Promise<void> => {
            submitted.push(task);
            throw new Error("submit rejected");
          },
        },
        { backend },
      );

      scheduler.start();
      for (const task of backend.tasks) {
        expect(() => task.callback()).not.toThrow();
      }

      // Let captured rejections settle before inspecting the ledger.
      await Promise.resolve();
      await Promise.resolve();

      expect(submitted).toEqual([
        { type: "COLLECT", source_id: "S-ON" },
        { type: "COLLECT", source_id: "S-ON2" },
      ]);
      expect(unhandled).toEqual([]);

      scheduler.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
