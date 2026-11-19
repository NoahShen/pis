import { describe, expect, it, vi } from "vitest";

import { BoundedTaskQueue, QueueClosedError } from "../../src/runtime/index.js";

describe("BoundedTaskQueue", () => {
  it("FIFO preserves strict enqueue and dequeue order", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 3 });

    await queue.enqueue("first");
    await queue.enqueue("second");
    await queue.enqueue("third");

    await expect(queue.dequeue()).resolves.toBe("first");
    await expect(queue.dequeue()).resolves.toBe("second");
    await expect(queue.dequeue()).resolves.toBe("third");
  });

  it("SIZE counts buffered tasks and direct handoff does not duplicate", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 2 });

    expect(queue.size).toBe(0);
    await queue.enqueue("first");
    expect(queue.size).toBe(1);
    await queue.enqueue("second");
    expect(queue.size).toBe(2);

    await expect(queue.dequeue()).resolves.toBe("first");
    expect(queue.size).toBe(1);
    await expect(queue.dequeue()).resolves.toBe("second");
    expect(queue.size).toBe(0);

    const handoff = queue.dequeue();
    expect(queue.size).toBe(0);
    await queue.enqueue("handoff");
    expect(queue.size).toBe(0);
    await expect(handoff).resolves.toBe("handoff");
  });

  it("CAPACITY_DEFAULT uses a bounded capacity of eight and rejects invalid values", async () => {
    const queue = new BoundedTaskQueue<number>();
    const accepted: Promise<void>[] = [];

    for (let task = 0; task < 8; task += 1) {
      accepted.push(queue.enqueue(task));
    }

    await Promise.all(accepted);
    expect(queue.size).toBe(8);

    let ninthSettled = false;
    const ninth = queue.enqueue(8).then(() => {
      ninthSettled = true;
    });
    await Promise.resolve();
    expect(ninthSettled).toBe(false);

    await queue.dequeue();
    await ninth;
    expect(ninthSettled).toBe(true);
    expect(queue.size).toBe(8);

    for (const capacity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new BoundedTaskQueue({ capacity })).toThrow(RangeError);
    }
  });

  it("RUN-08_BACKPRESSURE waits while full and resumes without dropping tasks", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 1 });

    await queue.enqueue("first");
    let secondSettled = false;
    const second = queue.enqueue("second").then(() => {
      secondSettled = true;
    });

    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(queue.size).toBe(1);

    await expect(queue.dequeue()).resolves.toBe("first");
    await second;
    expect(secondSettled).toBe(true);
    expect(queue.size).toBe(1);
    await expect(queue.dequeue()).resolves.toBe("second");
    expect(queue.size).toBe(0);
  });

  it("BACKPRESSURE_FIFO wakes blocked enqueue callers in submission order", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 1 });
    const wakeOrder: string[] = [];

    await queue.enqueue("head");
    const second = queue.enqueue("second").then(() => {
      wakeOrder.push("second");
    });
    const third = queue.enqueue("third").then(() => {
      wakeOrder.push("third");
    });

    await Promise.resolve();
    expect(wakeOrder).toEqual([]);

    await expect(queue.dequeue()).resolves.toBe("head");
    await second;
    expect(wakeOrder).toEqual(["second"]);

    await expect(queue.dequeue()).resolves.toBe("second");
    await third;
    expect(wakeOrder).toEqual(["second", "third"]);

    await expect(queue.dequeue()).resolves.toBe("third");
  });

  it("CLOSE_WAKE_ENQUEUE rejects every blocked enqueue caller with queue_closed", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 1 });

    await queue.enqueue("accepted");
    const second = queue.enqueue("second");
    const third = queue.enqueue("third");
    await Promise.resolve();

    queue.close();
    const results = await Promise.allSettled([second, third]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(QueueClosedError);
        expect(result.reason).toMatchObject({ code: "queue_closed" });
      }
    }

    expect(queue.isClosed).toBe(true);
    expect(queue.size).toBe(1);
    await expect(queue.dequeue()).resolves.toBe("accepted");
  });

  it("CLOSE_WAKE_DEQUEUE wakes every blocked dequeue caller with null", async () => {
    const queue = new BoundedTaskQueue<string>();
    const first = queue.dequeue();
    const second = queue.dequeue();

    queue.close();

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
  });

  it("CLOSE_DRAIN drains accepted buffered tasks before returning null", async () => {
    const queue = new BoundedTaskQueue<string>({ capacity: 2 });

    await queue.enqueue("first");
    await queue.enqueue("second");
    queue.close();
    queue.close();

    expect(queue.size).toBe(2);
    await expect(queue.dequeue()).resolves.toBe("first");
    await expect(queue.dequeue()).resolves.toBe("second");
    await expect(queue.dequeue()).resolves.toBeNull();
    await expect(queue.enqueue("late")).rejects.toMatchObject({
      code: "queue_closed",
    });
  });

  it("ABORT_WAKE aborts both waiter kinds, closes immediately, and removes its listener", async () => {
    const enqueueController = new AbortController();
    const enqueueQueue = new BoundedTaskQueue<string>({
      capacity: 1,
      signal: enqueueController.signal,
    });

    await enqueueQueue.enqueue("accepted");
    const blockedEnqueue = enqueueQueue.enqueue("blocked");
    await Promise.resolve();
    enqueueController.abort();

    await expect(blockedEnqueue).rejects.toMatchObject({
      code: "queue_closed",
    });
    expect(enqueueQueue.isClosed).toBe(true);
    expect(enqueueQueue.size).toBe(1);
    await expect(enqueueQueue.dequeue()).resolves.toBe("accepted");
    await expect(enqueueQueue.dequeue()).resolves.toBeNull();

    const dequeueController = new AbortController();
    const removeAbortListener = vi.spyOn(
      dequeueController.signal,
      "removeEventListener",
    );
    const dequeueQueue = new BoundedTaskQueue<string>({
      signal: dequeueController.signal,
    });
    const blockedDequeue = dequeueQueue.dequeue();
    dequeueController.abort();

    await expect(blockedDequeue).resolves.toBeNull();
    expect(dequeueQueue.isClosed).toBe(true);
    expect(removeAbortListener).toHaveBeenCalledTimes(1);
    const [eventName, listener] = removeAbortListener.mock.calls[0]!;
    expect(eventName).toBe("abort");
    expect(typeof listener).toBe("function");

    const preAbortedQueue = new BoundedTaskQueue<string>({
      signal: dequeueController.signal,
    });
    expect(preAbortedQueue.isClosed).toBe(true);
    await expect(preAbortedQueue.dequeue()).resolves.toBeNull();
    await expect(preAbortedQueue.enqueue("late")).rejects.toMatchObject({
      code: "queue_closed",
    });
  });

  it("NO_DROP accepts and returns every task exactly once under backpressure", async () => {
    const queue = new BoundedTaskQueue<number>({ capacity: 3 });
    const taskCount = 10;

    const producers = Array.from({ length: taskCount }, (_, task) =>
      queue.enqueue(task),
    );
    const consumers = Array.from({ length: taskCount }, () => queue.dequeue());
    const [producerResults, consumerResults] = await Promise.all([
      Promise.all(producers),
      Promise.all(consumers),
    ]);

    expect(producerResults).toHaveLength(taskCount);
    expect(consumerResults).toEqual(
      Array.from({ length: taskCount }, (_, task) => task),
    );
    expect(queue.size).toBe(0);

    queue.close();
    await expect(queue.dequeue()).resolves.toBeNull();
  });
});
