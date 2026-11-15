import { createServer } from "node:net";

import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { closeWithTimeout, main, startServer } from "../src/lifecycle.js";
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

  it("listen failure rejects ready, resolves listen_error and emits no ready log", async () => {
    const occupied = await occupyLoopbackPort();
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();

    try {
      const server = startServer({
        app,
        config: { host: "127.0.0.1", port: occupied.port },
        logger,
        signalSource: signals,
      });

      await expect(server.ready).rejects.toThrow(/failed to listen/);
      await expect(server.completed).resolves.toEqual({
        code: 1,
        reason: "listen_error",
        forced: false,
      });
      expect(logger.readyEntries).toEqual([]);
      expect(logger.errorEntries).toEqual([
        { operation: "listen", reason: "listen_error" },
      ]);
      expect(logger.flushCount).toBe(1);
      expect(signals.count()).toBe(0);
    } finally {
      await occupied.close();
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

  it("consumes a late listen reject without an unhandled rejection or state change", async () => {
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
        env: { API_TOKEN: "test-token", PORT: "0" },
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
      env: { API_TOKEN: "test-token" },
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
    const occupied = await occupyLoopbackPort();
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
        env: { API_TOKEN: "test-token", PORT: String(occupied.port) },
        loggerFactory: () => logger,
        appFactory: () => Fastify({ logger: false }),
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
      await occupied.close();
    }
  });

  it("normal shutdown completes close and log flush within the shared budget without force exit", async () => {
    const app = Fastify({ logger: false });
    const logger = new CapturedLogger();
    const signals = new FakeSignals();
    const forceExit = vi.fn();
    const running = main({
      env: { API_TOKEN: "test-token", PORT: "0" },
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
      env: { API_TOKEN: "test-token", PORT: "0" },
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
      env: { API_TOKEN: "test-token", PORT: "0" },
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
      env: { API_TOKEN: "test-token", PORT: "0" },
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
      env: { API_TOKEN: "test-token", PORT: "0" },
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

  it("missing configuration is rejected before creating an app", async () => {
    const logger = new CapturedLogger();
    const appFactory = vi.fn();
    const forceExit = vi.fn();
    await main({ env: {}, loggerFactory: () => logger, appFactory, forceExit });

    expect(appFactory).not.toHaveBeenCalled();
    expect(logger.errorEntries).toEqual([
      { operation: "config", reason: "config_error" },
    ]);
    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
