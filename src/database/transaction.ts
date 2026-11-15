import type Database from "better-sqlite3";

type SyncResult<T> = T extends unknown
  ? [T] extends [PromiseLike<unknown>]
    ? never
    : T
  : never;

type SyncOperation<F extends () => unknown> = F extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => SyncResult<Result>
  : never;

function isAsyncFunction(operation: () => unknown): boolean {
  return Object.prototype.toString.call(operation) === "[object AsyncFunction]";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return false;
  }

  return typeof (value as { then?: unknown }).then === "function";
}

export function withTransaction<F extends () => unknown>(
  db: Database.Database,
  operation: F & SyncOperation<F>,
): SyncResult<ReturnType<F>> {
  if (isAsyncFunction(operation)) {
    throw new TypeError("withTransaction requires a synchronous callback");
  }

  const runOperation = (): SyncResult<ReturnType<F>> => {
    const result = operation();

    if (isThenable(result)) {
      throw new TypeError(
        "withTransaction callback must not return a thenable",
      );
    }

    return result as SyncResult<ReturnType<F>>;
  };

  return db.transaction(runOperation).immediate();
}
