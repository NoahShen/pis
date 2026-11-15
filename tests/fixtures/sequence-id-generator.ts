import type { IdGenerator } from "../../src/id/id-generator.js";

export class SequenceIdGenerator implements IdGenerator {
  private readonly values: string[];
  private nextIndex = 0;

  constructor(values: readonly string[]) {
    this.values = [...values];
  }

  next(): string {
    const value = this.values[this.nextIndex];

    if (value === undefined) {
      throw new Error(
        `SequenceIdGenerator exhausted after ${this.values.length} values`,
      );
    }

    this.nextIndex += 1;
    return value;
  }
}
