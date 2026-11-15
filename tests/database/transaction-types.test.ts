import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { withTransaction } from "../../src/database/transaction.js";

declare const db: Database.Database;

interface ResultWithThenField {
  then: string;
  value: number;
}

function assertTypeSurface(): void {
  const primitiveResult: number = withTransaction(db, () => 42);
  const recordResult: Readonly<Record<string, number>> = withTransaction(
    db,
    () => ({ count: 2 }),
  );
  const thenFieldResult: ResultWithThenField = withTransaction(db, () => ({
    then: "ordinary property",
    value: 7,
  }));

  void primitiveResult;
  void recordResult;
  void thenFieldResult;

  const explicitUnion = (): number | PromiseLike<number> =>
    Math.random() > 0.5 ? 1 : Promise.resolve(1);

  // @ts-expect-error Async functions are not synchronous transaction callbacks.
  withTransaction(db, async () => 1);
  // @ts-expect-error Promise-returning functions are not synchronous callbacks.
  withTransaction(db, () => Promise.resolve(1));
  // @ts-expect-error Explicit synchronous or PromiseLike unions must be rejected.
  withTransaction(db, explicitUnion);
  // @ts-expect-error Conditional mixed unions must be rejected.
  withTransaction(db, () => (Math.random() > 0.5 ? 1 : Promise.resolve(1)));
}

describe("withTransaction types", () => {
  it("withTransaction type surface accepts synchronous results and rejects promise-like callbacks", () => {
    expect(assertTypeSurface).toBeTypeOf("function");
  });
});
