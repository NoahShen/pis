import { describe, expect, it, vi } from "vitest";

import {
  clearSingleFlightIfCurrent,
  InProcessSingleFlight,
  type SingleFlightEntry,
} from "../../src/collection/single-flight.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("InProcessSingleFlight", () => {
  it("aborts every waiter when the first caller cancels and starts the operation once", async () => {
    const singleFlight = new InProcessSingleFlight();
    const controller = new AbortController();
    const operationResult = deferred<string>();
    const operation = vi.fn((signal: AbortSignal | undefined) => {
      expect(signal).toBe(controller.signal);
      return operationResult.promise;
    });

    const first = singleFlight.run("source-a", controller.signal, operation);
    const second = singleFlight.run("source-a", undefined, operation);
    const firstResult = expect(first).rejects.toMatchObject({
      code: "aborted",
    });
    const secondResult = expect(second).rejects.toMatchObject({
      code: "aborted",
    });

    controller.abort();
    await Promise.all([firstResult, secondResult]);
    expect(operation).toHaveBeenCalledTimes(1);

    operationResult.reject(new Error("late operation rejection"));
    await flushMicrotasks();
  });

  it("lets a later waiter cancel itself without cancelling the shared execution", async () => {
    const singleFlight = new InProcessSingleFlight();
    const operationResult = deferred<string>();
    const operation = vi.fn(() => operationResult.promise);
    const laterController = new AbortController();

    const first = singleFlight.run("source-a", undefined, operation);
    const later = singleFlight.run(
      "source-a",
      laterController.signal,
      operation,
    );
    const firstResult = expect(first).resolves.toBe("shared result");
    const laterResult = expect(later).rejects.toMatchObject({
      code: "aborted",
    });

    laterController.abort();
    await laterResult;
    operationResult.resolve("shared result");
    await firstResult;

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not start an operation for a pre-aborted caller", async () => {
    const singleFlight = new InProcessSingleFlight();
    const controller = new AbortController();
    const operation = vi.fn(() => "unexpected");
    controller.abort();

    await expect(
      singleFlight.run("source-a", controller.signal, operation),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("runs different keys independently and aborts only the cancelled key", async () => {
    const singleFlight = new InProcessSingleFlight();
    const firstController = new AbortController();
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    const signals = new Map<string, AbortSignal | undefined>();

    const first = singleFlight.run(
      "source-a",
      firstController.signal,
      (signal) => {
        signals.set("source-a", signal);
        return firstResult.promise;
      },
    );
    const second = singleFlight.run("source-b", undefined, (signal) => {
      signals.set("source-b", signal);
      return secondResult.promise;
    });
    const firstExpectation = expect(first).rejects.toMatchObject({
      code: "aborted",
    });
    const secondExpectation = expect(second).resolves.toBe("source-b result");

    firstController.abort();
    secondResult.resolve("source-b result");

    await Promise.all([firstExpectation, secondExpectation]);
    expect(signals.get("source-a")).toBe(firstController.signal);
    expect(signals.get("source-b")).toBeUndefined();

    firstResult.reject(new Error("late source-a rejection"));
    await flushMicrotasks();
  });

  it("cleans up after settlement so a later call can start a new operation", async () => {
    const singleFlight = new InProcessSingleFlight();
    const firstResult = deferred<string>();
    const firstOperation = vi.fn(() => firstResult.promise);
    const secondOperation = vi.fn(() => "second result");

    const first = singleFlight.run("source-a", undefined, firstOperation);
    firstResult.resolve("first result");
    await expect(first).resolves.toBe("first result");
    await flushMicrotasks();

    await expect(
      singleFlight.run("source-a", undefined, secondOperation),
    ).resolves.toBe("second result");
    expect(firstOperation).toHaveBeenCalledTimes(1);
    expect(secondOperation).toHaveBeenCalledTimes(1);
  });

  it("keeps a newly installed token when an old token cleanup arrives late", () => {
    const inFlight = new Map<string, SingleFlightEntry>();
    const oldToken = {};
    const newToken = {};
    inFlight.set("source-a", {
      token: newToken,
      executionPromise: Promise.resolve("new execution"),
    });

    clearSingleFlightIfCurrent(inFlight, "source-a", oldToken);
    expect(inFlight.get("source-a")?.token).toBe(newToken);

    clearSingleFlightIfCurrent(inFlight, "source-a", newToken);
    expect(inFlight.has("source-a")).toBe(false);
  });
});
