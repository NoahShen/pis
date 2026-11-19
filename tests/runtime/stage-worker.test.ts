import { describe, expect, it } from "vitest";

import { BoundedTaskQueue } from "../../src/runtime/index.js";
import { StageWorker } from "../../src/runtime/stage-worker.js";
import { createDeferred, waitForCondition } from "../fixtures/runtime.js";

describe("StageWorker", () => {
  it("WORKER_SERIAL processes three tasks serially and start is idempotent", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 3 });
    await Promise.all([
      queue.enqueue("first"),
      queue.enqueue("second"),
      queue.enqueue("third"),
    ]);
    queue.close();

    const gates = [
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
    ];
    const started: string[] = [];
    let activeHandlers = 0;
    let maxActiveHandlers = 0;
    const worker = new StageWorker<string>({
      queue,
      handle: async (task) => {
        started.push(task);
        activeHandlers += 1;
        maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
        await gates[started.length - 1]!.promise;
        activeHandlers -= 1;
      },
    });

    worker.start();
    worker.start();
    await waitForCondition(() => started.length === 1);
    expect(started).toEqual(["first"]);
    expect(activeHandlers).toBe(1);
    expect(queue.size).toBe(2);

    gates[0]!.resolve(undefined);
    await waitForCondition(() => started.length === 2);
    expect(started).toEqual(["first", "second"]);
    expect(activeHandlers).toBe(1);

    gates[1]!.resolve(undefined);
    await waitForCondition(() => started.length === 3);
    expect(started).toEqual(["first", "second", "third"]);
    expect(activeHandlers).toBe(1);

    gates[2]!.resolve(undefined);
    await worker.done();
    expect(started).toEqual(["first", "second", "third"]);
    expect(maxActiveHandlers).toBe(1);
    expect(queue.size).toBe(0);
  });

  it("WORKER_ERROR_CONTINUE reports handler failure and continues when onError throws", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 2 });
    await queue.enqueue("fails");
    await queue.enqueue("continues");
    queue.close();

    const handled: string[] = [];
    const reported: unknown[] = [];
    const worker = new StageWorker<string>({
      queue,
      handle: async (task) => {
        handled.push(task);
        if (task === "fails") {
          throw new Error("handler failure");
        }
      },
      onError: async (error) => {
        reported.push(error);
        throw new Error("error reporter failure");
      },
    });

    worker.start();
    await worker.done();

    expect(handled).toEqual(["fails", "continues"]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);
    expect((reported[0] as Error).message).toBe("handler failure");
    expect(queue.size).toBe(0);
  });

  it("WORKER_DONE resolves only after close and drain, with no queued work left", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 1 });
    await queue.enqueue("last");
    queue.close();

    const gate = createDeferred<void>();
    let started = false;
    let handled = false;
    let doneSettled = false;
    const worker = new StageWorker<string>({
      queue,
      handle: async () => {
        started = true;
        await gate.promise;
        handled = true;
      },
    });

    worker.start();
    const done = worker.done().then(() => {
      doneSettled = true;
    });

    await waitForCondition(() => started);
    await Promise.resolve();
    expect(doneSettled).toBe(false);
    expect(handled).toBe(false);
    expect(queue.size).toBe(0);

    gate.resolve(undefined);
    await done;

    expect(doneSettled).toBe(true);
    expect(handled).toBe(true);
    await expect(queue.dequeue()).resolves.toBeNull();
    expect(queue.size).toBe(0);
    expect(queue.isClosed).toBe(true);
  });
});
