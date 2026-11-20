import { createServer } from "node:net";

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { closeWithTimeout, main, startServer } from "../src/lifecycle.js";
import { testEnvironment } from "./fixtures/app-config.js";
import { CapturedLogger, FakeSignals } from "./fixtures/captured-logger.js";

function isPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => false,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 15)),
  ]);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function trackSettlement<T>(promise: Promise<T>): {
  promise: Promise<T>;
  count: () => number;
} {
  let settlements = 0;

  return {
    promise: promise.then(
      (value) => {
        settlements += 1;
        return value;
      },
      (error: unknown) => {
        settlements += 1;
        throw error;
      },
    ),
    count: () => settlements,
  };
}

async function occupyLoopbackPort(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });

  const address = blocker.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to acquire a loopback port");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        blocker.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function hangingCloseApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addHook("preClose", async () => {
    await new Promise(() => undefined);
  });
  return app;
}

const BOUND_ADDRESS_CLEANUP_CASES = [
  {
    fault: "close rejection",
    flushCount: 1,
    timeoutReason: "close_error",
    timed: false,
  },
  {
    fault: "close hang",
    flushCount: 0,
    timeoutReason: "timeout",
    timed: true,
  },
  {
    fault: "flush rejection",
    flushCount: 1,
    timeoutReason: "flush_error",
    timed: false,
  },
  {
    fault: "flush hang",
    flushCount: 1,
    timeoutReason: "timeout",
    timed: true,
  },
] as const;

type BoundAddressCleanupCase = (typeof BOUND_ADDRESS_CLEANUP_CASES)[number];

async function exerciseBoundAddressCleanup(
  testCase: BoundAddressCleanupCase,
): Promise<void> {
  const usesFakeTimers = testCase.timed;
  if (usesFakeTimers) {
    vi.useFakeTimers();
  }

  try {
    const logger = new CapturedLogger();
    if (testCase.fault === "flush rejection") {
      logger.failNextFlush();
    } else if (testCase.fault === "flush hang") {
      logger.flush = () => {
        logger.flushCount += 1;
        return new Promise<void>(() => undefined);
      };
    }

    const close =
      testCase.fault === "close rejection"
        ? vi.fn(async () => {
            throw new Error("close detail");
          })
        : testCase.fault === "close hang"
          ? vi.fn(() => new Promise<void>(() => undefined))
          : vi.fn(async () => undefined);
    const app = {
      listen: vi.fn(async () => "http://127.0.0.1:41011"),
      close,
      server: { address: () => null },
    } as unknown as FastifyInstance;
    const signals = new FakeSignals();
    const startedAt = Date.now();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
      shutdownTimeoutMs: 50,
    });
    const ready = trackSettlement(
      server.ready.catch((error: unknown) => error),
    );
    const completed = trackSettlement(server.completed);

    if (testCase.timed) {
      await vi.advanceTimersByTimeAsync(49);
      expect(ready.count()).toBe(0);
      expect(completed.count()).toBe(0);
      expect(Date.now() - startedAt).toBe(49);
      await vi.advanceTimersByTimeAsync(1);
    }

    await expect(ready.promise).resolves.toMatchObject({
      message: "Server did not expose a bound address",
    });
    await expect(completed.promise).resolves.toEqual({
      code: 1,
      reason: "listen_error",
      forced: false,
    });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.readyEntries).toEqual([]);
    expect(logger.flushCount).toBe(testCase.flushCount);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
      { operation: "shutdown", reason: testCase.timeoutReason },
    ]);
    expect(signals.count()).toBe(0);
    expect(ready.count()).toBe(1);
    expect(completed.count()).toBe(1);
    if (testCase.timed) {
      expect(Date.now() - startedAt).toBe(50);
    }
  } finally {
    if (usesFakeTimers) {
      vi.useRealTimers();
    }
  }
}

describe("startServer", () => {
  it("startServer keeps completed pending while serving and resolves ready after listen", async () => {
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });

    await expect(server.ready).resolves.toEqual({
      host: "127.0.0.1",
      port: expect.any(Number),
    });
    expect(logger.readyEntries).toEqual([await server.ready]);
    expect(await isPending(server.completed)).toBe(true);
    expect(signals.count()).toBe(2);

    signals.emit("SIGINT");
    await expect(server.completed).resolves.toEqual({
      code: 0,
      reason: "closed",
      forced: false,
    });
    expect(signals.count()).toBe(0);
  });

  it("listen rejection closes owned resources once and flushes once within one shared budget", async () => {
    const app = Fastify({ logger: false });
    let closeCount = 0;
    app.addHook("preClose", async () => {
      closeCount += 1;
    });
    app.listen = async () => {
      throw new Error("listen detail");
    };
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });
    const ready = trackSettlement(server.ready);
    const completed = trackSettlement(server.completed);

    await expect(ready.promise).rejects.toThrow(/failed to listen/);
    await expect(completed.promise).resolves.toEqual({
      code: 1,
      reason: "listen_error",
      forced: false,
    });
    expect(logger.readyEntries).toEqual([]);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
    ]);
    expect(closeCount).toBe(1);
    expect(logger.flushCount).toBe(1);
    expect(signals.count()).toBe(0);
    expect(ready.count()).toBe(1);
    expect(completed.count()).toBe(1);
  });

  it("bound address failure closes owned resources once and flushes once within one shared budget", async () => {
    const close = vi.fn(async () => undefined);
    const app = {
      listen: vi.fn(async () => "http://127.0.0.1:41011"),
      close,
      server: { address: () => null },
    } as unknown as FastifyInstance;
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });
    const ready = trackSettlement(server.ready);
    const completed = trackSettlement(server.completed);

    await expect(ready.promise).rejects.toThrow(/bound address/);
    await expect(completed.promise).resolves.toEqual({
      code: 1,
      reason: "listen_error",
      forced: false,
    });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.flushCount).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
    ]);
    expect(signals.count()).toBe(0);
    expect(ready.count()).toBe(1);
    expect(completed.count()).toBe(1);
  });

  it.each(BOUND_ADDRESS_CLEANUP_CASES)(
    "bound address failure with cleanup $fault closes once, bounds flush to one shared deadline, and preserves listen_error",
    async (testCase) => {
      await exerciseBoundAddressCleanup(testCase);
    },
  );

  it("startup cleanup close rejection still attempts one bounded flush and preserves listen_error", async () => {
    const close = vi.fn(async () => {
      throw new Error("close detail");
    });
    const app = {
      listen: vi.fn(async () => {
        throw new Error("listen detail");
      }),
      close,
    } as unknown as FastifyInstance;
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });
    const ready = trackSettlement(server.ready);
    const completed = trackSettlement(server.completed);

    await expect(ready.promise).rejects.toThrow(/failed to listen/);
    await expect(completed.promise).resolves.toEqual({
      code: 1,
      reason: "listen_error",
      forced: false,
    });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.flushCount).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
      { operation: "shutdown", reason: "close_error" },
    ]);
    expect(signals.count()).toBe(0);
    expect(ready.count()).toBe(1);
    expect(completed.count()).toBe(1);
  });

  it("startup cleanup close hang skips flush after budget exhaustion and preserves listen_error", async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn(() => new Promise<void>(() => undefined));
      const app = {
        listen: vi.fn(async () => {
          throw new Error("listen detail");
        }),
        close,
      } as unknown as FastifyInstance;
      const logger = new CapturedLogger();
      const signals = new FakeSignals();
      const server = startServer({
        app,
        config: { host: "127.0.0.1", port: 0 },
        logger,
        signalSource: signals,
        shutdownTimeoutMs: 50,
      });
      const ready = trackSettlement(
        server.ready.catch((error: unknown) => error),
      );
      const completed = trackSettlement(server.completed);

      await vi.advanceTimersByTimeAsync(0);
      expect(close).toHaveBeenCalledExactlyOnceWith();
      await vi.advanceTimersByTimeAsync(50);

      await expect(ready.promise).resolves.toMatchObject({
        message: "Server failed to listen",
      });
      await expect(completed.promise).resolves.toEqual({
        code: 1,
        reason: "listen_error",
        forced: false,
      });
      expect(logger.flushCount).toBe(0);
      expect(logger.errorEntries).toEqual([
        { operation: "listen", reason: "listen_error" },
        { operation: "shutdown", reason: "timeout" },
      ]);
      expect(signals.count()).toBe(0);
      expect(ready.count()).toBe(1);
      expect(completed.count()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("startup cleanup flush rejection stays bounded and settles listen_error once", async () => {
    const logger = new CapturedLogger();
    logger.failNextFlush();
    const close = vi.fn(async () => undefined);
    const app = {
      listen: vi.fn(async () => {
        throw new Error("listen detail");
      }),
      close,
    } as unknown as FastifyInstance;
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });
    const ready = trackSettlement(
      server.ready.catch((error: unknown) => error),
    );
    const completed = trackSettlement(server.completed);

    await expect(ready.promise).resolves.toMatchObject({
      message: "Server failed to listen",
    });
    await expect(completed.promise).resolves.toEqual({
      code: 1,
      reason: "listen_error",
      forced: false,
    });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.flushCount).toBe(1);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
      { operation: "shutdown", reason: "flush_error" },
    ]);
    expect(signals.count()).toBe(0);
    expect(ready.count()).toBe(1);
    expect(completed.count()).toBe(1);
  });

  it("startup cleanup flush hang stays bounded and settles listen_error once", async () => {
    vi.useFakeTimers();
    try {
      const logger = new CapturedLogger();
      logger.flush = () => {
        logger.flushCount += 1;
        return new Promise<void>(() => undefined);
      };
      const close = vi.fn(async () => undefined);
      const app = {
        listen: vi.fn(async () => {
          throw new Error("listen detail");
        }),
        close,
      } as unknown as FastifyInstance;
      const signals = new FakeSignals();
      const server = startServer({
        app,
        config: { host: "127.0.0.1", port: 0 },
        logger,
        signalSource: signals,
        shutdownTimeoutMs: 50,
      });
      const ready = trackSettlement(
        server.ready.catch((error: unknown) => error),
      );
      const completed = trackSettlement(server.completed);

      await vi.advanceTimersByTimeAsync(50);

      await expect(ready.promise).resolves.toMatchObject({
        message: "Server failed to listen",
      });
      await expect(completed.promise).resolves.toEqual({
        code: 1,
        reason: "listen_error",
        forced: false,
      });
      expect(close).toHaveBeenCalledExactlyOnceWith();
      expect(logger.flushCount).toBe(1);
      expect(logger.errorEntries).toEqual([
        { operation: "listen", reason: "listen_error" },
        { operation: "shutdown", reason: "timeout" },
      ]);
      expect(signals.count()).toBe(0);
      expect(ready.count()).toBe(1);
      expect(completed.count()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("two independent startup failures use parallel 5000ms cleanup deadlines and settle together", async () => {
    const realHrtime = process.hrtime.bigint.bind(process.hrtime);
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const wallStartedAt = realHrtime();
      const closeStartTimes: number[][] = [[], []];
      const failures = [0, 1].map((index) => {
        const logger = new CapturedLogger();
        const signals = new FakeSignals();
        const close = vi.fn(() => {
          closeStartTimes[index]?.push(Date.now());
          return new Promise<void>(() => undefined);
        });
        const app = {
          listen: vi.fn(async () => {
            throw new Error("listen detail");
          }),
          close,
        } as unknown as FastifyInstance;
        const server = startServer({
          app,
          config: { host: "127.0.0.1", port: 0 },
          logger,
          signalSource: signals,
          shutdownTimeoutMs: 5_000,
        });

        return {
          ready: trackSettlement(server.ready.catch((error: unknown) => error)),
          completed: trackSettlement(server.completed),
          close,
          logger,
          signals,
        };
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(closeStartTimes).toEqual([[startedAt], [startedAt]]);
      for (const failure of failures) {
        expect(failure.close).toHaveBeenCalledExactlyOnceWith();
        expect(failure.ready.count()).toBe(0);
        expect(failure.completed.count()).toBe(0);
        expect(failure.logger.flushCount).toBe(0);
        expect(failure.signals.count()).toBe(0);
      }

      await vi.advanceTimersByTimeAsync(4_999);
      for (const failure of failures) {
        expect(failure.ready.count()).toBe(0);
        expect(failure.completed.count()).toBe(0);
      }

      await vi.advanceTimersByTimeAsync(1);
      for (const failure of failures) {
        await expect(failure.ready.promise).resolves.toMatchObject({
          message: "Server failed to listen",
        });
        await expect(failure.completed.promise).resolves.toEqual({
          code: 1,
          reason: "listen_error",
          forced: false,
        });
        expect(failure.close).toHaveBeenCalledExactlyOnceWith();
        expect(failure.logger.flushCount).toBe(0);
        expect(failure.logger.errorEntries).toEqual([
          { operation: "listen", reason: "listen_error" },
          { operation: "shutdown", reason: "timeout" },
        ]);
        expect(failure.signals.count()).toBe(0);
        expect(failure.ready.count()).toBe(1);
        expect(failure.completed.count()).toBe(1);
      }

      expect(Date.now() - startedAt).toBe(5_000);
      const wallElapsedMs = Number(realHrtime() - wallStartedAt) / 1_000_000;
      expect(wallElapsedMs).toBeLessThan(4_900);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shutdown timeout includes log flush in the shared 5000ms budget and resolves forced code one", async () => {
    vi.useFakeTimers();
    try {
      const app = Fastify({ logger: false });
      app.listen = async () => "http://127.0.0.1:41001";
      Object.defineProperty(app.server, "address", {
        configurable: true,
        value: () => ({ address: "127.0.0.1", family: "IPv4", port: 41001 }),
      });
      app.addHook("preClose", async () => {
        await new Promise(() => undefined);
      });
      const logger = new CapturedLogger();
      const signals = new FakeSignals();
      const server = startServer({
        app,
        config: { host: "127.0.0.1", port: 0 },
        logger,
        signalSource: signals,
      });

      await expect(server.ready).resolves.toEqual({
        host: "127.0.0.1",
        port: 41001,
      });
      signals.emit("SIGTERM");
      signals.emit("SIGINT");
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(server.completed).resolves.toEqual({
        code: 1,
        reason: "timeout",
        forced: true,
      });
      expect(logger.shutdownEntries).toEqual([
        { outcome: "timeout", forced: true },
      ]);
      expect(logger.flushCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("duplicate SIGINT/SIGTERM callbacks reuse one close operation and unsubscribe", async () => {
    const app = Fastify({ logger: false });
    let closeCount = 0;
    app.addHook("preClose", async () => {
      closeCount += 1;
    });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });

    await server.ready;
    signals.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));
    signals.emit("SIGTERM");

    await expect(server.completed).resolves.toMatchObject({
      code: 0,
      reason: "closed",
    });
    expect(closeCount).toBe(1);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "closed", forced: false },
    ]);
    expect(signals.count()).toBe(0);
  });

  it("rejects pending ready and shares one close when a signal arrives before listen settles", async () => {
    const listen = deferred<string>();
    const app = Fastify({ logger: false });
    const close = vi.fn(async () => undefined);
    app.listen = () => listen.promise;
    app.close = close as unknown as FastifyInstance["close"];
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });
    const readyOutcome = server.ready.catch((error: unknown) => error);

    expect(await isPending(server.completed)).toBe(true);
    signals.emit("SIGINT");

    await expect(readyOutcome).resolves.toMatchObject({
      name: "ShutdownBeforeReadyError",
      message: "Server shutdown before ready",
    });
    await expect(server.completed).resolves.toEqual({
      code: 0,
      reason: "closed",
      forced: false,
    });
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.readyEntries).toEqual([]);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "closed", forced: false },
    ]);
    expect(signals.count()).toBe(0);
  });

  it("consumes a late listen resolve, closes newly listening resources, and preserves completed", async () => {
    const listen = deferred<string>();
    let listening = false;
    let notifyClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    const app = Fastify({ logger: false });
    const close = vi.fn(async () => undefined);
    const serverClose = vi.fn((callback) => {
      notifyClosed();
      callback();
    });
    const lateCloseFailure = vi.fn();
    app.listen = () => listen.promise;
    app.close = close as unknown as FastifyInstance["close"];
    app.server.close = serverClose as unknown as typeof app.server.close;
    Object.defineProperty(app.server, "listening", {
      configurable: true,
      get: () => listening,
    });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
      lateCloseFailure,
    });
    const readyOutcome = server.ready.catch((error: unknown) => error);

    signals.emit("SIGTERM");
    await expect(readyOutcome).resolves.toMatchObject({
      name: "ShutdownBeforeReadyError",
    });
    await expect(server.completed).resolves.toEqual({
      code: 0,
      reason: "closed",
      forced: false,
    });

    listening = true;
    listen.resolve("http://127.0.0.1:41003");
    await closed;

    await expect(server.completed).resolves.toEqual({
      code: 0,
      reason: "closed",
      forced: false,
    });
    expect(logger.readyEntries).toEqual([]);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "closed", forced: false },
    ]);
    expect(logger.flushCount).toBe(1);
    expect(close).toHaveBeenNthCalledWith(1);
    expect(serverClose).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect(lateCloseFailure).not.toHaveBeenCalled();
  });

  it("reports a failed late listen cleanup without changing the primary close result", async () => {
    const listen = deferred<string>();
    let listening = false;
    let notifyClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    const app = Fastify({ logger: false });
    app.listen = () => listen.promise;
    app.close = (async () => undefined) as unknown as FastifyInstance["close"];
    app.server.close = ((callback: (error?: Error) => void) => {
      notifyClosed();
      callback(new Error("late close detail"));
    }) as unknown as typeof app.server.close;
    Object.defineProperty(app.server, "listening", {
      configurable: true,
      get: () => listening,
    });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const lateCloseFailure = vi.fn();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
      lateCloseFailure,
    });
    const readyOutcome = server.ready.catch((error: unknown) => error);

    signals.emit("SIGTERM");
    await readyOutcome;
    await server.completed;
    listening = true;
    listen.resolve("http://127.0.0.1:41004");
    await closed;
    await vi.waitFor(() =>
      expect(lateCloseFailure).toHaveBeenCalledExactlyOnceWith(),
    );

    await expect(server.completed).resolves.toEqual({
      code: 0,
      reason: "closed",
      forced: false,
    });
    expect(logger.readyEntries).toEqual([]);
    expect(logger.errorEntries).toEqual([
      { operation: "shutdown", reason: "close_error" },
    ]);
  });

  it("late listen rejection after shutdown does not repeat owned cleanup", async () => {
    const listen = deferred<string>();
    const app = Fastify({ logger: false });
    const close = vi.fn(async () => undefined);
    app.listen = () => listen.promise;
    app.close = close as unknown as FastifyInstance["close"];
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const server = startServer({
        app,
        config: { host: "127.0.0.1", port: 0 },
        logger,
        signalSource: signals,
      });
      const readyOutcome = server.ready.catch((error: unknown) => error);

      signals.emit("SIGINT");
      await expect(readyOutcome).resolves.toMatchObject({
        name: "ShutdownBeforeReadyError",
      });
      await expect(server.completed).resolves.toEqual({
        code: 0,
        reason: "closed",
        forced: false,
      });

      listen.reject(new Error("late listen detail"));
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      await expect(server.completed).resolves.toEqual({
        code: 0,
        reason: "closed",
        forced: false,
      });
      expect(logger.readyEntries).toEqual([]);
      expect(logger.errorEntries).toEqual([]);
      expect(logger.shutdownEntries).toEqual([
        { outcome: "closed", forced: false },
      ]);
      expect(close).toHaveBeenCalledExactlyOnceWith();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("flush failure after close resolves forced flush_error", async () => {
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const server = startServer({
      app,
      config: { host: "127.0.0.1", port: 0 },
      logger,
      signalSource: signals,
    });

    await server.ready;
    logger.failNextFlush();
    signals.emit("SIGINT");

    await expect(server.completed).resolves.toEqual({
      code: 1,
      reason: "flush_error",
      forced: true,
    });
    expect(logger.errorEntries).toEqual([
      { operation: "shutdown", reason: "flush_error" },
    ]);
  });
});

describe("closeWithTimeout", () => {
  it("close failure resolves forced code one and production main calls default force exit", async () => {
    const app = Fastify({ logger: false });
    app.addHook("preClose", async () => {
      throw new Error("close failed");
    });
    const logger = new CapturedLogger();

    await expect(closeWithTimeout(app, logger, 100)).resolves.toBe("failed");
    expect(logger.shutdownEntries).toEqual([
      { outcome: "failed", forced: true },
    ]);
    expect(logger.errorEntries).toEqual([
      { operation: "shutdown", reason: "close_error" },
    ]);
    expect(logger.flushCount).toBe(1);

    const productionApp = {
      listen: async () => "http://127.0.0.1:41002",
      server: {
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 41002 }),
      },
      close: async () => {
        throw new Error("production close failed");
      },
    } as unknown as FastifyInstance;
    const productionLogger = new CapturedLogger();
    const signals = new FakeSignals();
    const processExit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      const running = main({
        env: testEnvironment({ PORT: "0" }),
        loggerFactory: () => productionLogger,
        appFactory: () => productionApp,
        signalSource: signals,
      });

      await vi.waitFor(() =>
        expect(productionLogger.readyEntries).toHaveLength(1),
      );
      signals.emit("SIGINT");
      await running;

      expect(processExit).toHaveBeenCalledExactlyOnceWith(1);
      expect(productionLogger.errorEntries).toContainEqual({
        operation: "shutdown",
        reason: "close_error",
      });
    } finally {
      processExit.mockRestore();
    }
  });

  it("flush must finish inside the remaining shared budget", async () => {
    vi.useFakeTimers();
    try {
      const app = Fastify({ logger: false });
      const logger = new CapturedLogger();
      logger.flush = () => new Promise(() => undefined);
      const closing = closeWithTimeout(app, logger, 20);

      await vi.advanceTimersByTimeAsync(20);
      await expect(closing).resolves.toBe("timeout");
      expect(logger.shutdownEntries).toEqual([
        { outcome: "closed", forced: false },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush failure is a failed bounded shutdown", async () => {
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    logger.failNextFlush();

    await expect(closeWithTimeout(app, logger, 100)).resolves.toBe("failed");
    expect(logger.shutdownEntries).toEqual([
      { outcome: "closed", forced: false },
    ]);
  });
});

describe("main", () => {
  it("listen failure flushes and force-exits without waiting for a signal", async () => {
    const app = Fastify({ logger: false });
    app.listen = async () => {
      throw new Error("listen failed");
    };
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();

    await main({
      env: testEnvironment(),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      forceExit,
    });

    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.readyEntries).toEqual([]);
    expect(logger.errorEntries).toEqual([
      { operation: "listen", reason: "listen_error" },
    ]);
    expect(logger.flushCount).toBe(1);
    expect(signals.count()).toBe(0);
  });

  it("ready rejection also consumes completed without an unhandled rejection", async () => {
    const logger = new CapturedLogger();
    const forceExit = vi.fn();
    const signals = new FakeSignals();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      await main({
        env: testEnvironment(),
        loggerFactory: () => logger,
        appFactory: () => {
          const app = Fastify({ logger: false });
          app.listen = async () => {
            throw new Error("listen detail");
          };
          return app;
        },
        signalSource: signals,
        forceExit,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
      expect(logger.readyEntries).toEqual([]);
      expect(signals.count()).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("normal shutdown completes close and log flush within the shared budget without force exit", async () => {
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: testEnvironment({ PORT: "0" }),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      forceExit,
    });

    await vi.waitFor(() => expect(logger.readyEntries).toHaveLength(1));
    signals.emit("SIGTERM");
    await running;
    expect(forceExit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("graceful signal before a pending listen exits zero without force exit", async () => {
    const listen = deferred<string>();
    const app = Fastify({ logger: false });
    const close = vi.fn(async () => undefined);
    app.listen = () => listen.promise;
    app.close = close as unknown as FastifyInstance["close"];
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: testEnvironment({ PORT: "0" }),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      forceExit,
    });

    await vi.waitFor(() => expect(signals.count()).toBe(2));
    signals.emit("SIGTERM");
    await expect(running).resolves.toBeUndefined();

    expect(process.exitCode).toBe(0);
    expect(forceExit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(logger.readyEntries).toEqual([]);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "closed", forced: false },
    ]);
    expect(signals.count()).toBe(0);
  });

  it("late cleanup failure after graceful shutdown requests a nonzero exit", async () => {
    const listen = deferred<string>();
    let listening = false;
    let notifyClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve;
    });
    const app = Fastify({ logger: false });
    app.listen = () => listen.promise;
    app.close = (async () => undefined) as unknown as FastifyInstance["close"];
    app.server.close = ((callback: (error?: Error) => void) => {
      notifyClosed();
      callback(new Error("late close detail"));
    }) as unknown as typeof app.server.close;
    Object.defineProperty(app.server, "listening", {
      configurable: true,
      get: () => listening,
    });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: testEnvironment({ PORT: "0" }),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      forceExit,
    });

    await vi.waitFor(() => expect(signals.count()).toBe(2));
    signals.emit("SIGTERM");
    await running;
    expect(forceExit).not.toHaveBeenCalled();

    listening = true;
    listen.resolve("http://127.0.0.1:41005");
    await closed;
    await vi.waitFor(() =>
      expect(forceExit).toHaveBeenCalledExactlyOnceWith(1),
    );
  });

  it("signal before a pending listen remains nonzero when the primary close fails", async () => {
    const listen = deferred<string>();
    const app = Fastify({ logger: false });
    app.listen = () => listen.promise;
    app.close = (async () => {
      throw new Error("primary close detail");
    }) as unknown as FastifyInstance["close"];
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: testEnvironment({ PORT: "0" }),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      forceExit,
    });

    await vi.waitFor(() => expect(signals.count()).toBe(2));
    signals.emit("SIGINT");
    await expect(running).resolves.toBeUndefined();

    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "failed", forced: true },
    ]);
    expect(logger.errorEntries).toEqual([
      { operation: "shutdown", reason: "close_error" },
    ]);
    expect(logger.readyEntries).toEqual([]);
  });

  it("signal before a pending listen remains nonzero when close times out", async () => {
    const listen = deferred<string>();
    const app = Fastify({ logger: false });
    app.listen = () => listen.promise;
    app.close = (() =>
      new Promise(() => undefined)) as unknown as FastifyInstance["close"];
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: testEnvironment({ PORT: "0" }),
      loggerFactory: () => logger,
      appFactory: () => app,
      signalSource: signals,
      shutdownTimeoutMs: 20,
      forceExit,
    });

    await vi.waitFor(() => expect(signals.count()).toBe(2));
    signals.emit("SIGINT");
    await expect(running).resolves.toBeUndefined();

    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.shutdownEntries).toEqual([
      { outcome: "timeout", forced: true },
    ]);
    expect(logger.readyEntries).toEqual([]);
  });

  it("missing LLM configuration is rejected before creating an app", async () => {
    const logger = new CapturedLogger();
    const appFactory = vi.fn();
    const forceExit = vi.fn();
    await main({
      env: { API_TOKEN: "test-token" },
      loggerFactory: () => logger,
      appFactory,
      forceExit,
    });

    expect(appFactory).not.toHaveBeenCalled();
    expect(logger.errorEntries).toEqual([
      { operation: "config", reason: "config_error" },
    ]);
    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
