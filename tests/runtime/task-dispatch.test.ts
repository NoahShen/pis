import { describe, expect, it } from "vitest";

import { QueueClosedError } from "../../src/runtime/index.js";
import { dispatchDownstreamTasks } from "../../src/runtime/task-dispatch.js";
import type {
  RuntimeLogEntry,
  RuntimeTask,
} from "../../src/runtime/contracts.js";
import {
  createCollectTask,
  createProcessTask,
  waitForCondition,
} from "../fixtures/runtime.js";

describe("dispatchDownstreamTasks", () => {
  it("DEFAULTS retries an enqueue failure twice with no explicit limit", async () => {
    let attempts = 0;

    await dispatchDownstreamTasks(
      [createCollectTask("default-attempts")],
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first dispatch failure");
        }
      },
    );

    expect(attempts).toBe(2);
  });

  it("RUN-05/06_DISPATCH retries only B and never duplicates successful A", async () => {
    let upstreamExecuteCalls = 0;
    const upstreamExecute = () => {
      upstreamExecuteCalls += 1;
      return [
        createCollectTask("dispatch-a"),
        createCollectTask("dispatch-b"),
        createCollectTask("dispatch-c"),
      ];
    };
    const tasks = upstreamExecute();
    const attempts = new Map<string, number>();
    const order: string[] = [];

    await dispatchDownstreamTasks(
      tasks,
      async (task) => {
        const taskId = "source_id" in task ? task.source_id : "unexpected";
        const attempt = (attempts.get(taskId) ?? 0) + 1;
        attempts.set(taskId, attempt);
        order.push(`${taskId}:${attempt}`);

        if (taskId === "dispatch-b" && attempt === 1) {
          throw new Error("transient enqueue failure");
        }
      },
      { dispatchAttempts: 2 },
    );

    expect(order).toEqual([
      "dispatch-a:1",
      "dispatch-b:1",
      "dispatch-b:2",
      "dispatch-c:1",
    ]);
    expect(Object.fromEntries(attempts)).toEqual({
      "dispatch-a": 1,
      "dispatch-b": 2,
      "dispatch-c": 1,
    });
    expect(upstreamExecuteCalls).toBe(1);
  });

  it("DISPATCH_EXHAUST logs B failure and continues through C without throwing", async () => {
    const entries: RuntimeLogEntry[] = [];
    const attempts = new Map<string, number>();

    await expect(
      dispatchDownstreamTasks(
        [
          createCollectTask("dispatch-a"),
          createCollectTask("dispatch-b"),
          createCollectTask("dispatch-c"),
        ],
        async (task) => {
          const taskId = "source_id" in task ? task.source_id : "unexpected";
          attempts.set(taskId, (attempts.get(taskId) ?? 0) + 1);
          if (taskId === "dispatch-b") {
            throw new Error("persistent enqueue failure");
          }
        },
        {
          dispatchAttempts: 2,
          logger: {
            log: (entry) => {
              entries.push(entry);
            },
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(Object.fromEntries(attempts)).toEqual({
      "dispatch-a": 1,
      "dispatch-b": 2,
      "dispatch-c": 1,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      taskType: "COLLECT",
      taskId: "dispatch-b",
      stage: "dispatch",
      attempt: 2,
      maxAttempts: 2,
      reason: "dispatch_failed",
    });
  });

  it("DISPATCH_CANCELLED does not retry queue_closed and leaves completed siblings intact", async () => {
    const entries: RuntimeLogEntry[] = [];
    const attempts = new Map<string, number>();

    await dispatchDownstreamTasks(
      [
        createCollectTask("dispatch-a"),
        createCollectTask("dispatch-closed"),
        createCollectTask("dispatch-c"),
      ],
      async (task) => {
        const taskId = "source_id" in task ? task.source_id : "unexpected";
        attempts.set(taskId, (attempts.get(taskId) ?? 0) + 1);
        if (taskId === "dispatch-closed") {
          throw new QueueClosedError();
        }
      },
      {
        dispatchAttempts: 2,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
      },
    );

    expect(Object.fromEntries(attempts)).toEqual({
      "dispatch-a": 1,
      "dispatch-closed": 1,
      "dispatch-c": 1,
    });
    expect(entries).toEqual([
      expect.objectContaining({
        taskId: "dispatch-closed",
        stage: "dispatch",
        attempt: 1,
        maxAttempts: 2,
        reason: "dispatch_cancelled",
      }),
    ]);
  });

  it("DISPATCH_CANCELLED treats an aborted signal as terminal without calling enqueue", async () => {
    const controller = new AbortController();
    const entries: RuntimeLogEntry[] = [];
    let enqueueCalls = 0;
    controller.abort();

    await dispatchDownstreamTasks(
      [createProcessTask("cancelled-a"), createProcessTask("cancelled-b")],
      async () => {
        enqueueCalls += 1;
      },
      {
        dispatchAttempts: 2,
        logger: {
          log: (entry) => {
            entries.push(entry);
          },
        },
        signal: controller.signal,
      },
    );

    expect(enqueueCalls).toBe(0);
    expect(entries).toEqual([
      expect.objectContaining({
        taskId: "cancelled-a",
        reason: "dispatch_cancelled",
        attempt: 1,
      }),
      expect.objectContaining({
        taskId: "cancelled-b",
        reason: "dispatch_cancelled",
        attempt: 1,
      }),
    ]);
  });

  it("DISPATCH_LOGGER waits for queue_closed despite an asynchronous rejecting logger", async () => {
    let enqueueCalls = 0;
    const dispatch = dispatchDownstreamTasks(
      [createCollectTask("dispatch-closed")],
      async (_task: RuntimeTask) => {
        enqueueCalls += 1;
        throw new QueueClosedError();
      },
      {
        dispatchAttempts: 2,
        logger: { log: async () => Promise.reject(new Error("logger failed")) },
      },
    );

    await waitForCondition(() => enqueueCalls === 1);
    await expect(dispatch).resolves.toBeUndefined();
    expect(enqueueCalls).toBe(1);
  });

  it("DISPATCH_ATTEMPTS rejects non-positive or non-integer limits", async () => {
    for (const dispatchAttempts of [0, -1, 1.5, Number.NaN]) {
      await expect(
        dispatchDownstreamTasks([], async () => undefined, {
          dispatchAttempts,
        }),
      ).rejects.toBeInstanceOf(RangeError);
    }
  });
});
