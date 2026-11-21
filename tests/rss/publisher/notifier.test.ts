import { describe, expect, it, vi } from "vitest";
import { createRssPublicationNotifier } from "../../../src/rss/publisher/notifier.js";
import type { RssFeedKind } from "../../../src/rss/contracts.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createRssPublicationNotifier", () => {
  it("shares only the queued rerun and promotes it after active success", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const execute = vi
      .fn<(feed: RssFeedKind) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const notifier = createRssPublicationNotifier(execute);

    const initial = notifier.notify("EVENT_UPDATES");
    const rerun1 = notifier.notify("EVENT_UPDATES");
    const rerun2 = notifier.notify("EVENT_UPDATES");
    expect(rerun1).not.toBe(initial);
    expect(rerun2).toBe(rerun1);

    let rerunSettled = false;
    void rerun1.then(() => {
      rerunSettled = true;
    });
    first.resolve();
    await initial;
    await Promise.resolve();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(rerunSettled).toBe(false);

    const queuedDuringRerun = notifier.notify("EVENT_UPDATES");
    expect(queuedDuringRerun).not.toBe(rerun1);
    second.resolve();
    await rerun1;
    await Promise.resolve();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(3);
    third.resolve();
    await queuedDuringRerun;
  });

  it("rejects active and queued callers together, resets, and permits retry", async () => {
    const first = deferred();
    const retry = deferred();
    const error = new Error("publish failed");
    const execute = vi
      .fn<(feed: RssFeedKind) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    const notifier = createRssPublicationNotifier(execute);

    const initial = notifier.notify("CURATED_CONTENT");
    const rerun = notifier.notify("CURATED_CONTENT");
    const activeRejection = expect(initial).rejects.toBe(error);
    const queuedRejection = expect(rerun).rejects.toBe(error);
    first.reject(error);
    await activeRejection;
    await queuedRejection;

    const retried = notifier.notify("CURATED_CONTENT");
    retry.resolve();
    await retried;
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("resets after a synchronous execute throw and permits retry", async () => {
    const error = new Error("synchronous failure");
    const execute = vi
      .fn<(feed: RssFeedKind) => Promise<void>>()
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockResolvedValueOnce(undefined);
    const notifier = createRssPublicationNotifier(execute);

    await expect(notifier.notify("EVENT_UPDATES")).rejects.toBe(error);
    await expect(notifier.notify("EVENT_UPDATES")).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("runs different feeds independently", async () => {
    const events = deferred();
    const curated = deferred();
    const execute = vi
      .fn<(feed: RssFeedKind) => Promise<void>>()
      .mockReturnValueOnce(events.promise)
      .mockReturnValueOnce(curated.promise);
    const notifier = createRssPublicationNotifier(execute);

    const eventRun = notifier.notify("EVENT_UPDATES");
    const curatedRun = notifier.notify("CURATED_CONTENT");
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(2);
    curated.resolve();
    await curatedRun;
    events.resolve();
    await eventRun;
  });
});
