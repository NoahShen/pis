import type {
  ErrorLogMetadata,
  Logger,
  ReadyLogMetadata,
  RequestLogMetadata,
  ShutdownLogMetadata,
} from "../../src/logger.js";
import type { SignalSource } from "../../src/lifecycle.js";

export class CapturedLogger implements Logger {
  readonly readyEntries: ReadyLogMetadata[] = [];
  readonly shutdownEntries: ShutdownLogMetadata[] = [];
  readonly errorEntries: ErrorLogMetadata[] = [];
  readonly requestEntries: RequestLogMetadata[] = [];
  flushCount = 0;
  private readonly flushWaiters: (() => void)[] = [];

  ready(metadata: ReadyLogMetadata): void {
    this.readyEntries.push(metadata);
  }

  shutdown(metadata: ShutdownLogMetadata): void {
    this.shutdownEntries.push(metadata);
  }

  error(metadata: ErrorLogMetadata): void {
    this.errorEntries.push(metadata);
  }

  request(metadata: RequestLogMetadata): void {
    this.requestEntries.push(metadata);
  }

  failNextFlush(error = new Error("flush failed")): void {
    this.flush = async () => {
      this.flushCount += 1;
      throw error;
    };
  }

  flush(): Promise<void> {
    this.flushCount += 1;
    for (const resolve of this.flushWaiters.splice(0)) {
      resolve();
    }
    return Promise.resolve();
  }

  waitForFlush(): Promise<void> {
    return new Promise((resolve) => this.flushWaiters.push(resolve));
  }
}

export class FakeSignals implements SignalSource {
  private readonly listeners = new Map<NodeJS.Signals, Set<() => void>>();

  on(signal: NodeJS.Signals, listener: () => void): this {
    const listeners = this.listeners.get(signal) ?? new Set();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
    return this;
  }

  off(signal: NodeJS.Signals, listener: () => void): this {
    this.listeners.get(signal)?.delete(listener);
    return this;
  }

  emit(signal: NodeJS.Signals): void {
    for (const listener of this.listeners.get(signal) ?? []) {
      listener();
    }
  }

  count(): number {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0,
    );
  }
}
