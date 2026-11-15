import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { withTransaction } from "../../src/database/transaction.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

const CHILD_EVENT_TIMEOUT_MS = 3_000;
const CHILD_EXIT_TIMEOUT_MS = 3_000;
const RELEASE_OBSERVATION_MS = 50;
const lockingClientPath = new URL(
  "../fixtures/locking-client.mjs",
  import.meta.url,
);

interface ProbeRow {
  id: string;
}

interface LockClientEvent {
  event: string;
  pid?: number;
  at?: number;
  code?: string;
  changes?: number;
}

interface ObserveWait {
  observed: boolean;
  message: string;
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  exitedAt: number;
}

interface EventWaiter {
  resolve: (event: LockClientEvent) => void;
  timer: NodeJS.Timeout;
}

function createProbeTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE transaction_probe (
      id TEXT PRIMARY KEY NOT NULL
    );
  `);
}

function insertProbeRow(db: Database.Database, id: string): void {
  db.prepare("INSERT INTO transaction_probe (id) VALUES (?)").run(id);
}

function probeRowIds(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT id FROM transaction_probe ORDER BY id")
    .all() as ProbeRow[];

  return rows.map((row) => row.id);
}

function waitForLockClientEvent(
  waitersByEvent: Map<string, Set<EventWaiter>>,
  eventName: string,
  observedEvents: LockClientEvent[] = [],
): Promise<LockClientEvent> {
  const observedEvent = observedEvents.find(
    (event) => event.event === eventName,
  );
  if (observedEvent !== undefined) {
    return Promise.resolve(observedEvent);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = waitersByEvent.get(eventName);
      waiters?.delete(waiter);
      if (waiters?.size === 0) {
        waitersByEvent.delete(eventName);
      }
      reject(
        new Error(`Timed out waiting for locking client event: ${eventName}`),
      );
    }, CHILD_EVENT_TIMEOUT_MS);

    const waiter: EventWaiter = { resolve, timer };
    const waiters = waitersByEvent.get(eventName) ?? new Set<EventWaiter>();
    waiters.add(waiter);
    waitersByEvent.set(eventName, waiters);
  });
}

function emitLockClientEvent(
  waitersByEvent: Map<string, Set<EventWaiter>>,
  event: LockClientEvent,
): void {
  const waiters = waitersByEvent.get(event.event);
  if (waiters === undefined) {
    return;
  }

  waitersByEvent.delete(event.event);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  }
}

function getObservationWait(
  waitersByEvent: Map<string, Set<EventWaiter>>,
): Promise<ObserveWait> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // A missing waiter proves no observer was still blocked after release.
      resolve({
        observed: true,
        message: "no lock-client waiter was still pending",
      });
    }, RELEASE_OBSERVATION_MS);

    const waiter: EventWaiter = {
      resolve: () => {
        setImmediate(() => {
          resolve({
            observed: false,
            message: "lock client finished before the lock was released",
          });
        });
      },
      timer,
    };
    const waiters = waitersByEvent.get("success") ?? new Set<EventWaiter>();
    waiters.add(waiter);
    waitersByEvent.set("success", waiters);
  });
}

async function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function stopChild(
  child: ChildProcessWithoutNullStreams,
  exitPromise: Promise<ChildExit>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGKILL");

  try {
    await waitWithTimeout(
      exitPromise,
      CHILD_EXIT_TIMEOUT_MS,
      "Locking client did not exit after termination",
    );
  } catch {
    // The original test failure remains authoritative.
  }
}

describe("withTransaction", () => {
  it("withTransaction commits all synchronous writes on success", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        createProbeTable(db);

        const result = withTransaction(db, () => {
          insertProbeRow(db, "first");
          insertProbeRow(db, "second");
          return { committed: 2 } as const;
        });

        expect(result).toEqual({ committed: 2 });
        expect(probeRowIds(db)).toEqual(["first", "second"]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction rolls back all writes and rethrows the original error", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const failure = new Error("synchronous transaction failure");

      try {
        createProbeTable(db);
        let observed: unknown;

        try {
          withTransaction(db, () => {
            insertProbeRow(db, "rolled-back");
            throw failure;
          });
        } catch (error) {
          observed = error;
        }

        expect(observed).toBe(failure);
        expect(probeRowIds(db)).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction uses savepoints for nested success and failure", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const outerFailure = new Error("outer transaction failure");

      try {
        createProbeTable(db);

        const nestedResult = withTransaction(db, () => {
          insertProbeRow(db, "outer-before");
          const innerResult = withTransaction(db, () => {
            insertProbeRow(db, "inner-success");
            return "inner-value";
          });

          let innerFailure: unknown;
          try {
            withTransaction(db, () => {
              insertProbeRow(db, "inner-rollback");
              throw new Error("inner transaction failure");
            });
          } catch (error) {
            innerFailure = error;
          }

          expect(innerFailure).toMatchObject({
            message: "inner transaction failure",
          });
          insertProbeRow(db, "outer-after");
          return innerResult;
        });

        expect(nestedResult).toBe("inner-value");
        expect(probeRowIds(db)).toEqual([
          "inner-success",
          "outer-after",
          "outer-before",
        ]);

        let observedOuterFailure: unknown;
        try {
          withTransaction(db, () => {
            withTransaction(db, () => {
              insertProbeRow(db, "nested-undone");
            });
            throw outerFailure;
          });
        } catch (error) {
          observedOuterFailure = error;
        }

        expect(observedOuterFailure).toBe(outerFailure);
        expect(probeRowIds(db)).toEqual([
          "inner-success",
          "outer-after",
          "outer-before",
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction rejects recognizable async callbacks before invoking them", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      let invocationCount = 0;

      try {
        createProbeTable(db);

        expect(() =>
          // @ts-expect-error Async callbacks are rejected by the type surface.
          withTransaction(db, async () => {
            invocationCount += 1;
            insertProbeRow(db, "async-write");
          }),
        ).toThrow("withTransaction requires a synchronous callback");

        expect(invocationCount).toBe(0);
        expect(probeRowIds(db)).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction rolls back a returned thenable without claiming cancellation", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      let thenInvocationCount = 0;

      try {
        createProbeTable(db);

        const runThenableTransaction = (): void =>
          // @ts-expect-error A sync callback must not return a thenable.
          withTransaction(db, () => {
            insertProbeRow(db, "thenable-write");
            return {
              then: () => {
                thenInvocationCount += 1;
              },
            };
          });

        expect(runThenableTransaction).toThrow(
          "withTransaction callback must not return a thenable",
        );

        expect(thenInvocationCount).toBe(0);
        expect(probeRowIds(db)).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("withTransaction acquires a top-level immediate write transaction", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const contender = new Database(databasePath);

      try {
        createProbeTable(db);
        contender.pragma("busy_timeout = 50");
        let contenderFailure: unknown;

        const result = withTransaction(db, () => {
          try {
            insertProbeRow(contender, "deferred-contender");
          } catch (error) {
            contenderFailure = error;
          }

          insertProbeRow(db, "immediate-owner");
          return "committed";
        });

        expect(contenderFailure).toMatchObject({ code: "SQLITE_BUSY" });
        expect(result).toBe("committed");
        expect(probeRowIds(db)).toEqual(["immediate-owner"]);
      } finally {
        closeDatabase(contender);
        closeDatabase(db);
      }
    });
  });

  it("real independent process waits for a held write transaction and then succeeds", async () => {
    await withDatabasePath(async (databasePath) => {
      const db = openDatabase(databasePath);
      let child: ChildProcessWithoutNullStreams | undefined;
      let exitPromise: Promise<ChildExit> | undefined;
      let transactionOpen = false;
      const eventWaiters = new Map<string, Set<EventWaiter>>();
      const observedEvents: LockClientEvent[] = [];

      try {
        createProbeTable(db);
        db.exec("BEGIN IMMEDIATE");
        transactionOpen = true;

        child = spawn(
          process.execPath,
          [lockingClientPath.pathname, databasePath],
          {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        exitPromise = new Promise<ChildExit>((resolve) => {
          child?.once("exit", (code, signal) =>
            resolve({ code, signal, exitedAt: Date.now() }),
          );
        });

        const stdout = createInterface({ input: child.stdout });
        const stderrLines: string[] = [];
        stdout.on("line", (line) => {
          const event = JSON.parse(line) as LockClientEvent;
          observedEvents.push(event);
          emitLockClientEvent(eventWaiters, event);
        });
        const stderr = createInterface({ input: child.stderr });
        stderr.on("line", (line) => stderrLines.push(line));

        const started = await waitForLockClientEvent(
          eventWaiters,
          "started",
          observedEvents,
        );
        const attempting = await waitForLockClientEvent(
          eventWaiters,
          "attempting",
          observedEvents,
        );

        const observation = await getObservationWait(eventWaiters);
        expect(observation, observation.message).toMatchObject({
          observed: true,
        });

        const releasedAt = Date.now();
        db.exec("COMMIT");
        transactionOpen = false;

        const childExit = await waitWithTimeout(
          exitPromise,
          CHILD_EXIT_TIMEOUT_MS,
          "Locking client did not exit after the write lock was released",
        );
        const success = await waitForLockClientEvent(
          eventWaiters,
          "success",
          observedEvents,
        );

        expect(childExit).toMatchObject({ code: 0, signal: null });
        expect(success.changes).toBe(1);
        expect(success.at).toBeGreaterThanOrEqual(releasedAt);
        expect(attempting.at).toBeLessThanOrEqual(releasedAt);
        expect(stderrLines).toEqual([]);
        expect(probeRowIds(db)).toEqual(["locking-client-write"]);

        console.info(
          "[D01-T03 independent lock probe]",
          JSON.stringify({
            pid: started.pid,
            startedAt: started.at,
            attemptedAt: attempting.at,
            releasedAt,
            exitedAt: childExit.exitedAt,
            exitCode: childExit.code,
          }),
        );
      } finally {
        if (transactionOpen && db.inTransaction) {
          db.exec("ROLLBACK");
        }

        if (child !== undefined && exitPromise !== undefined) {
          await stopChild(child, exitPromise);
        }

        closeDatabase(db);
      }
    });
  });
});
