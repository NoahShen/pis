import { describe, expect, it, vi } from "vitest";

import { RSS_FEEDS } from "../../../src/rss/feed.js";
import {
  calibrateRssPublication,
  createRssFeedPublisher,
} from "../../../src/rss/publisher/index.js";
import { RssPublisherError } from "../../../src/rss/publisher/contracts.js";
import type { LocalRssSyncService } from "../../../src/rss/local-sync.js";
import {
  MemoryRssArtifactStore,
  buildRssFileSet,
  xmlTextToBytes,
} from "../../fixtures/rss.js";

function createStore() {
  const fileSet = buildRssFileSet("EVENT_UPDATES", { archiveCount: 2 });
  const store = new MemoryRssArtifactStore();
  for (const file of fileSet.files) {
    if (file.key !== ".nojekyll") {
      store.seed(file.key, file.bytes);
    }
  }
  store.seed("archive/curated-content-0001.xml", xmlTextToBytes("curated"));
  store.seed("event-updates-extra.xml", xmlTextToBytes("extra"));
  return { fileSet, store };
}

describe("RSS startup publication", () => {
  it("syncs first and publishes the complete filtered file set", async () => {
    const { fileSet, store } = createStore();
    const calls: string[] = [];
    const sync = {
      sync: vi.fn(async () => {
        calls.push("sync");
        return {} as Awaited<ReturnType<LocalRssSyncService["sync"]>>;
      }),
      syncAll: vi.fn(),
    } satisfies LocalRssSyncService;
    const publisher = {
      publish: vi.fn(async (files) => {
        calls.push("publish");
        return { feed: files.feed, version: "v1", verified: true };
      }),
    };
    const execute = createRssFeedPublisher({ sync, store, publisher });

    await execute("EVENT_UPDATES");

    expect(calls).toEqual(["sync", "publish"]);
    expect(sync.sync).toHaveBeenCalledWith("EVENT_UPDATES");
    expect(publisher.publish).toHaveBeenCalledWith(fileSet);
  });

  it("fails with stable invalid_input when a required file is missing", async () => {
    const store = new MemoryRssArtifactStore();
    const sync = { sync: vi.fn(), syncAll: vi.fn() };
    const publisher = { publish: vi.fn() };
    const execute = createRssFeedPublisher({ sync, store, publisher });

    const failure = await execute("EVENT_UPDATES").catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RssPublisherError);
    expect((failure as RssPublisherError).code).toBe("invalid_input");
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("calibrates feeds sequentially and stops on failure", async () => {
    const notify = vi.fn(async (feed: "EVENT_UPDATES" | "CURATED_CONTENT") => {
      if (feed === "EVENT_UPDATES") {
        throw new Error("startup failed");
      }
    });

    await expect(calibrateRssPublication({ notify })).rejects.toThrow(
      "startup failed",
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(RSS_FEEDS.EVENT_UPDATES.kind);

    notify.mockReset().mockResolvedValue(undefined);
    await calibrateRssPublication({ notify });
    expect(notify.mock.calls.map(([feed]) => feed)).toEqual([
      "EVENT_UPDATES",
      "CURATED_CONTENT",
    ]);
  });
});
