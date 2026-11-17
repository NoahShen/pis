import { CollectionError } from "./collection-errors.js";

export type SingleFlightOperation<T> = (
  signal: AbortSignal | undefined,
) => Promise<T> | T;

export interface SingleFlight {
  run<T>(
    key: string,
    signal: AbortSignal | undefined,
    operation: SingleFlightOperation<T>,
  ): Promise<T>;
}

export interface SingleFlightEntry {
  readonly token: object;
  readonly executionPromise: Promise<unknown>;
}

function aborted<T>(): Promise<T> {
  return Promise.reject(new CollectionError("aborted"));
}

function waitForCaller<T>(
  executionPromise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return executionPromise;
  }
  if (signal.aborted) {
    return aborted();
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (callback: (value: T) => void, value: T): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new CollectionError("aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    executionPromise.then(
      (value) => settle(resolve, value),
      (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function startOperation<T>(
  operation: SingleFlightOperation<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(operation(signal));
  } catch (error) {
    operationPromise = Promise.reject(error);
  }

  void operationPromise.catch(() => undefined);
  return operationPromise;
}

export function clearSingleFlightIfCurrent(
  inFlight: Map<string, SingleFlightEntry>,
  key: string,
  token: object,
): void {
  if (inFlight.get(key)?.token === token) {
    inFlight.delete(key);
  }
}

export class InProcessSingleFlight implements SingleFlight {
  private readonly inFlight = new Map<string, SingleFlightEntry>();

  run<T>(
    key: string,
    signal: AbortSignal | undefined,
    operation: SingleFlightOperation<T>,
  ): Promise<T> {
    if (signal?.aborted === true) {
      return aborted();
    }

    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return waitForCaller(existing.executionPromise as Promise<T>, signal);
    }

    const operationPromise = startOperation(operation, signal);
    const executionPromise = waitForCaller(operationPromise, signal);
    const token = {};

    this.inFlight.set(key, { token, executionPromise });
    const clear = (): void => {
      clearSingleFlightIfCurrent(this.inFlight, key, token);
    };
    void executionPromise.then(clear, clear);

    return waitForCaller(executionPromise, signal);
  }
}
