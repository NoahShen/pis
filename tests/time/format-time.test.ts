import { describe, expect, it } from "vitest";

import { formatTimestamp } from "../../src/time/format-time.js";

describe("formatTimestamp", () => {
  it("formatTimestamp emits fixed +08:00 at normal, UTC cross-day, month and year boundaries", () => {
    expect(formatTimestamp(new Date("2025-06-15T04:05:06.007Z"))).toBe(
      "2025-06-15T12:05:06.007+08:00",
    );
    expect(formatTimestamp(new Date("2025-03-10T18:30:00.000Z"))).toBe(
      "2025-03-11T02:30:00.000+08:00",
    );
    expect(formatTimestamp(new Date("2025-01-31T17:45:00.000Z"))).toBe(
      "2025-02-01T01:45:00.000+08:00",
    );
    expect(formatTimestamp(new Date("2024-12-31T16:30:00.000Z"))).toBe(
      "2025-01-01T00:30:00.000+08:00",
    );
  });

  it("formatTimestamp rejects invalid Date", () => {
    expect(() => formatTimestamp(new Date(Number.NaN))).toThrow(
      /requires a valid Date/,
    );
  });
});
