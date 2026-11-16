import type { AddressInfo } from "node:net";

import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import {
  ConfigError,
  loadConfig,
  type AppConfig,
  type LogLevel,
} from "./config.js";
import { createLogger, type Logger } from "./logger.js";

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface LifecycleResult {
  code: 0 | 1;
  reason: "closed" | "listen_error" | "close_error" | "flush_error" | "timeout";
  forced: boolean;
}

export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface StartServerDependencies {
  app: FastifyInstance;
  config: Pick<AppConfig, "host" | "port">;
  logger: Logger;
  signalSource?: SignalSource;
  shutdownTimeoutMs?: number;
  lateCloseFailure?: () => void;
}

export interface StartServerResult {
  ready: Promise<{ host: string; port: number }>;
  completed: Promise<LifecycleResult>;
}

export interface MainDependencies {
  env?: NodeJS.ProcessEnv;
  loggerFactory?: (level: LogLevel) => Logger;
  appFactory?: (config: AppConfig, logger: Logger) => FastifyInstance;
  signalSource?: SignalSource;
  shutdownTimeoutMs?: number;
  forceExit?: (code: 1) => void;
}

const TIMEOUT = Symbol("timeout");

class OperationTimeoutError extends Error {
  constructor() {
    super("operation timed out");
    this.name = "OperationTimeoutError";
  }
}

class ShutdownBeforeReadyError extends Error {
  constructor() {
    super("Server shutdown before ready");
    this.name = "ShutdownBeforeReadyError";
  }
}

function safeError(operation: string, reason: string): void {
  try {
    process.stderr.write(`${operation}: ${reason}\n`);
  } catch {
    // There is no remaining reporting mechanism.
  }
}

function logError(logger: Logger, operation: string, reason: string): void {
  try {
    logger.error({ operation, reason });
  } catch {
    safeError(operation, reason);
  }
}

function logShutdown(
  logger: Logger,
  outcome: "closed" | "failed" | "timeout",
): void {
  try {
    logger.shutdown({ outcome, forced: outcome !== "closed" });
  } catch {
    safeError("shutdown", outcome);
  }
}

async function withTimeout<T>(
  operation: Promise<T> | (() => Promise<T>),
  timeoutPromise: Promise<never>,
): Promise<T> {
  const pending = typeof operation === "function" ? operation() : operation;
  return Promise.race([pending, timeoutPromise]);
}

function createTimeout(timeoutMs: number): {
  promise: Promise<never>;
  clear: () => void;
} {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError()), timeoutMs);
  });

  return {
    promise,
    clear(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

interface CloseResult {
  outcome: "closed" | "failed" | "timeout";
  reason?: "close_error" | "flush_error";
}

async function closeWithTimeoutDetails(
  app: FastifyInstance,
  logger: Logger,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<CloseResult> {
  const budget = createTimeout(Math.max(0, timeoutMs));

  try {
    try {
      await withTimeout(() => app.close(), budget.promise);
    } catch (error) {
      const timedOut = error instanceof OperationTimeoutError;
      const outcome = timedOut ? "timeout" : "failed";

      logShutdown(logger, outcome);
      if (!timedOut) {
        logError(logger, "shutdown", "close_error");
      }

      if (!timedOut) {
        try {
          await withTimeout(() => logger.flush(), budget.promise);
        } catch (flushError) {
          if (flushError instanceof OperationTimeoutError) {
            return { outcome: "timeout" };
          }

          logError(logger, "shutdown", "flush_error");
        }
      }

      return { outcome };
    }

    logShutdown(logger, "closed");

    try {
      await withTimeout(() => logger.flush(), budget.promise);
    } catch (error) {
      if (error instanceof OperationTimeoutError) {
        return { outcome: "timeout" };
      }

      logError(logger, "shutdown", "flush_error");
      return { outcome: "failed", reason: "flush_error" };
    }

    return { outcome: "closed" };
  } finally {
    budget.clear();
  }
}

export async function closeWithTimeout(
  app: FastifyInstance,
  logger: Logger,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<"closed" | "failed" | "timeout"> {
  return (await closeWithTimeoutDetails(app, logger, timeoutMs)).outcome;
}

function isAddressInfo(value: unknown): value is AddressInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "address" in value &&
    "port" in value &&
    typeof value.address === "string" &&
    typeof value.port === "number"
  );
}

async function cleanupStartupFailure(
  app: FastifyInstance,
  logger: Logger,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);

  const runWithinBudget = async <T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new OperationTimeoutError();
    }

    const budget = createTimeout(remaining);
    try {
      return await withTimeout(operation, budget.promise);
    } finally {
      budget.clear();
    }
  };

  try {
    await runWithinBudget(() => app.close());
  } catch (error) {
    logError(
      logger,
      "shutdown",
      error instanceof OperationTimeoutError ? "timeout" : "close_error",
    );
  }

  if (Date.now() >= deadline) {
    return;
  }

  try {
    await runWithinBudget(() => logger.flush());
  } catch (error) {
    logError(
      logger,
      "shutdown",
      error instanceof OperationTimeoutError ? "timeout" : "flush_error",
    );
  }
}

export function startServer({
  app,
  config,
  logger,
  signalSource = process,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  lateCloseFailure,
}: StartServerDependencies): StartServerResult {
  const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const shutdownBeforeReadyError = new ShutdownBeforeReadyError();
  let resolveReady!: (address: { host: string; port: number }) => void;
  let rejectReady!: (error: Error) => void;
  let resolveCompleted!: (result: LifecycleResult) => void;
  let readySettled = false;
  let completedSettled = false;
  let shutdownStarted = false;
  let shutdownDeadline = 0;
  let subscribed = false;

  const ready = new Promise<{ host: string; port: number }>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  const completed = new Promise<LifecycleResult>((resolve) => {
    resolveCompleted = resolve;
  });

  const rejectReadyIfPending = (error: Error): boolean => {
    if (readySettled) {
      return false;
    }

    readySettled = true;
    rejectReady(error);
    return true;
  };

  const resolveReadyIfActive = (address: {
    host: string;
    port: number;
  }): boolean => {
    if (shutdownStarted || readySettled) {
      return false;
    }

    readySettled = true;
    resolveReady(address);
    return true;
  };

  const closeLateListeningResource = async (): Promise<void> => {
    if (!app.server.listening) {
      return;
    }

    const budget = createTimeout(Math.max(0, shutdownDeadline - Date.now()));

    try {
      await withTimeout(
        () =>
          new Promise<void>((resolve, reject) => {
            app.server.close((error) => (error ? reject(error) : resolve()));
          }),
        budget.promise,
      );
    } catch (error) {
      logError(
        logger,
        "shutdown",
        error instanceof OperationTimeoutError ? "timeout" : "close_error",
      );
      try {
        lateCloseFailure?.();
      } catch {
        safeError("shutdown", "close_error");
      }
    } finally {
      budget.clear();
    }
  };

  const shutdownHandler = (): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    shutdownDeadline = Date.now() + Math.max(0, shutdownTimeoutMs);
    rejectReadyIfPending(shutdownBeforeReadyError);
    void closeWithTimeoutDetails(app, logger, shutdownTimeoutMs).then(
      (result) => {
        finish({
          code: result.outcome === "closed" ? 0 : 1,
          reason:
            result.outcome === "closed"
              ? "closed"
              : result.outcome === "failed"
                ? (result.reason ?? "close_error")
                : "timeout",
          forced: result.outcome !== "closed",
        });
      },
      () => {
        logError(logger, "shutdown", "close_error");
        finish({ code: 1, reason: "close_error", forced: true });
      },
    );
  };

  const unsubscribe = (): void => {
    if (!subscribed) {
      return;
    }

    for (const signal of signals) {
      signalSource.off(signal, shutdownHandler);
    }
    subscribed = false;
  };

  const finishListenFailure = async (readyError: Error): Promise<void> => {
    unsubscribe();
    logError(logger, "listen", "listen_error");
    await cleanupStartupFailure(app, logger, shutdownTimeoutMs);
    rejectReadyIfPending(readyError);
    finish({ code: 1, reason: "listen_error", forced: false });
  };

  function finish(result: LifecycleResult): void {
    if (completedSettled) {
      return;
    }

    completedSettled = true;
    unsubscribe();
    rejectReadyIfPending(shutdownBeforeReadyError);
    resolveCompleted(result);
  }

  for (const signal of signals) {
    signalSource.on(signal, shutdownHandler);
  }
  subscribed = true;

  void (async () => {
    try {
      await app.listen({ host: config.host, port: config.port });
    } catch {
      if (shutdownStarted) {
        await closeLateListeningResource();
        return;
      }

      await finishListenFailure(new Error("Server failed to listen"));
      return;
    }

    if (shutdownStarted) {
      await closeLateListeningResource();
      return;
    }

    const address = app.server.address();
    if (shutdownStarted) {
      await closeLateListeningResource();
      return;
    }

    if (!isAddressInfo(address)) {
      await finishListenFailure(
        new Error("Server did not expose a bound address"),
      );
      return;
    }

    const boundAddress = { host: address.address, port: address.port };
    if (!resolveReadyIfActive(boundAddress)) {
      await closeLateListeningResource();
      return;
    }

    if (shutdownStarted) {
      await closeLateListeningResource();
      return;
    }

    try {
      logger.ready(boundAddress);
    } catch {
      logError(logger, "ready", "log_error");
      shutdownHandler();
    }
  })();

  return { ready, completed };
}

async function flushForStartupError(
  logger: Logger,
  timeoutMs: number,
): Promise<void> {
  const budget = createTimeout(Math.max(0, timeoutMs));

  try {
    await withTimeout(() => logger.flush(), budget.promise);
  } catch {
    // The force-exit path remains bounded even when logging is unavailable.
  } finally {
    budget.clear();
  }
}

export async function main(deps: MainDependencies = {}): Promise<void> {
  const forceExit = deps.forceExit ?? ((code: 1): never => process.exit(code));
  const shutdownTimeoutMs =
    deps.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const loggerFactory = deps.loggerFactory ?? createLogger;
  const appFactory = deps.appFactory ?? buildApp;
  let config: AppConfig;

  try {
    config = loadConfig(deps.env ?? process.env);
  } catch (error) {
    const reason =
      error instanceof ConfigError ? "config_error" : "internal_error";
    let logger: Logger;

    try {
      logger = loggerFactory("error");
    } catch {
      safeError("config", reason);
      forceExit(1);
      return;
    }

    logError(logger, "config", reason);
    await flushForStartupError(logger, shutdownTimeoutMs);
    forceExit(1);
    return;
  }

  let logger: Logger;
  try {
    logger = loggerFactory(config.logLevel);
  } catch {
    safeError("startup", "logger_error");
    forceExit(1);
    return;
  }

  let app: FastifyInstance;
  try {
    app = appFactory(config, logger);
  } catch {
    logError(logger, "startup", "app_error");
    await flushForStartupError(logger, shutdownTimeoutMs);
    forceExit(1);
    return;
  }

  const server = startServer({
    app,
    config,
    logger,
    signalSource: deps.signalSource,
    shutdownTimeoutMs,
    lateCloseFailure: () => forceExit(1),
  });

  try {
    await server.ready;
  } catch {
    const result = await server.completed;
    if (result.code === 0) {
      process.exitCode = 0;
      return;
    }

    forceExit(1);
    return;
  }

  const result = await server.completed;
  if (result.code === 0) {
    process.exitCode = 0;
    return;
  }

  forceExit(1);
}
