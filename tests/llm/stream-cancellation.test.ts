import { describe, expect, it, vi } from "vitest";

import { waitForRetryDelay } from "../../src/llm/operation-policy.js";

describe("streaming retry cancellation", () => {
  it("cancels retry backoff promptly and removes its listener", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      let settled = false;
      const waiting = waitForRetryDelay(60_000, controller.signal).then(
        (completed) => {
          settled = true;
          return completed;
        },
      );
      controller.abort();
      await expect(waiting).resolves.toBe(false);
      expect(settled).toBe(true);
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      await vi.advanceTimersByTimeAsync(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts backoff for an already-cancelled attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForRetryDelay(60_000, controller.signal)).resolves.toBe(
      false,
    );
  });
});
