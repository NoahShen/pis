import { describe, expect, it, vi } from "vitest";

import { SystemClock } from "../../src/time/system-clock.js";
import { FakeClock } from "../fixtures/fake-clock.js";

describe("time facilities", () => {
  it("SystemClock returns distinct Date instances", () => {
    vi.useFakeTimers();

    try {
      const instant = new Date("2025-02-03T04:05:06.007Z");
      vi.setSystemTime(instant);

      const clock = new SystemClock();
      const first = clock.now();
      const second = clock.now();

      expect(first).toEqual(instant);
      expect(second).toEqual(instant);
      expect(first).not.toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it("FakeClock returns defensive Date copies and advances only explicitly", () => {
    const initial = new Date("2025-06-15T04:05:06.007Z");
    const clock = new FakeClock(initial);
    initial.setTime(0);

    const first = clock.now();
    expect(first).toEqual(new Date("2025-06-15T04:05:06.007Z"));
    expect(clock.now()).not.toBe(first);

    first.setTime(0);
    expect(clock.now()).toEqual(new Date("2025-06-15T04:05:06.007Z"));

    clock.advance(1_250);
    expect(clock.now()).toEqual(new Date("2025-06-15T04:05:07.257Z"));
    expect(clock.now()).toEqual(clock.now());
  });
});
