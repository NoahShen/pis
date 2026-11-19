import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createRuntime } from "../../src/runtime/index.js";
import {
  createCollectResult,
  createCollectTask,
  createDeferred,
  createEmptyStageServices,
  createProcessResult,
  withRuntimeSqliteProbe,
} from "../fixtures/runtime.js";

const runtimeSourceFiles = [
  "task-dispatch.ts",
  "runtime-logger.ts",
  "runtime-errors.ts",
  "runtime.ts",
  "index.ts",
] as const;

function runtimeSource(): string {
  return runtimeSourceFiles
    .map((fileName) =>
      readFileSync(
        new URL(`../../src/runtime/${fileName}`, import.meta.url),
        "utf8",
      ),
    )
    .join("\n");
}

describe("RUN-16 Runtime transaction boundary", () => {
  it("RUN-16 waits outside a real SQLite transaction while a concurrent short transaction commits", async () => {
    await withRuntimeSqliteProbe(async (probe) => {
      const gate = createDeferred<void>();
      const samples: boolean[] = [];
      let processCalls = 0;
      let collectOptions: Readonly<Record<string, unknown>> | undefined;
      const services = createEmptyStageServices();

      services.collect = async (_sourceId, options) => {
        collectOptions = options as Readonly<Record<string, unknown>>;
        samples.push(probe.database.inTransaction);
        await gate.promise;
        samples.push(probe.database.inTransaction);
        return createCollectResult(["source-item-after-boundary"]);
      };
      services.process = async () => {
        processCalls += 1;
        return createProcessResult(null);
      };

      const runtime = createRuntime({ services });
      await runtime.submit(createCollectTask("transaction-boundary-source"));
      await runtime.start();
      await vi.waitFor(() => expect(samples).toHaveLength(1));

      expect(probe.database.inTransaction).toBe(false);
      probe.insertSource("concurrent-short-transaction");
      expect(probe.database.inTransaction).toBe(false);
      expect(probe.readSourceIds()).toEqual(["concurrent-short-transaction"]);
      expect(samples).toEqual([false]);

      gate.resolve(undefined);
      await runtime.drain();

      expect(samples).toEqual([false, false]);
      expect(collectOptions).toBeDefined();
      expect(Object.keys(collectOptions ?? {})).toEqual(["signal"]);
      expect(collectOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(processCalls).toBe(1);
      await runtime.shutdown();
    });
  });

  it("RUN-16 production Runtime sources contain zero transaction, database, or SQL access", () => {
    const source = runtimeSource();

    expect(source).not.toMatch(/\bwithTransaction\b/u);
    expect(source).not.toMatch(/\bnew\s+Database\b/u);
    expect(source).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
    expect(source).not.toMatch(
      /\b(?:fetch|openDatabase|initializeDatabase)\b/u,
    );
  });
});
