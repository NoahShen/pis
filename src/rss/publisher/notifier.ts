import { parseRssArchiveKey } from "../archive.js";
import type { RssArtifactStore, RssFeedKind } from "../contracts.js";
import { getRssFeed } from "../feed.js";
import type { LocalRssSyncService } from "../local-sync.js";
import {
  RssPublisherError,
  type RssPublicationFile,
  type RssPublicationPublisher,
} from "./contracts.js";
import { RSS_NOJEKYLL_KEY } from "./staging.js";

export interface RssPublicationNotifier {
  notify(feed: RssFeedKind): Promise<void>;
}

interface FeedRun {
  readonly active: Promise<void>;
  queued: Promise<void> | undefined;
  resolveQueued: (() => void) | undefined;
  rejectQueued: ((reason: unknown) => void) | undefined;
}

export function createRssPublicationNotifier(
  execute: (feed: RssFeedKind) => Promise<void>,
): RssPublicationNotifier {
  const runs = new Map<RssFeedKind, FeedRun>();

  function start(feed: RssFeedKind): FeedRun {
    const run: FeedRun = {
      active: Promise.resolve().then(() => execute(feed)),
      queued: undefined,
      resolveQueued: undefined,
      rejectQueued: undefined,
    };
    runs.set(feed, run);

    void run.active.then(
      () => {
        if (run.queued) {
          const rerun = start(feed).active;
          void rerun.then(run.resolveQueued, run.rejectQueued);
        } else if (runs.get(feed) === run) {
          runs.delete(feed);
        }
      },
      (error: unknown) => {
        if (runs.get(feed) === run) {
          runs.delete(feed);
        }
        run.rejectQueued?.(error);
      },
    );

    return run;
  }

  function notify(feed: RssFeedKind): Promise<void> {
    const existing = runs.get(feed);
    if (!existing) {
      return start(feed).active;
    }
    if (!existing.queued) {
      existing.queued = new Promise<void>((resolve, reject) => {
        existing.resolveQueued = resolve;
        existing.rejectQueued = reject;
      });
    }
    return existing.queued;
  }

  return { notify };
}

export interface RssFeedPublisherDependencies {
  readonly sync: LocalRssSyncService;
  readonly store: RssArtifactStore;
  readonly publisher: RssPublicationPublisher;
}

export function createRssFeedPublisher({
  sync,
  store,
  publisher,
}: RssFeedPublisherDependencies): (feed: RssFeedKind) => Promise<void> {
  return async (feed) => {
    await sync.sync(feed);
    const definition = getRssFeed(feed);
    const head = await store.read(definition.headKey);
    const pending = await store.read(definition.pendingKey);
    if (head === null || pending === null) {
      throw new RssPublisherError("invalid_input");
    }

    const listed = await store.list("archive/");
    const archiveKeys = listed.filter((key) => {
      try {
        parseRssArchiveKey(definition, key);
        return true;
      } catch {
        return false;
      }
    });
    const files: RssPublicationFile[] = [
      { key: RSS_NOJEKYLL_KEY, bytes: new Uint8Array() },
    ];
    for (const key of archiveKeys) {
      const bytes = await store.read(key);
      if (bytes === null) {
        throw new RssPublisherError("invalid_input");
      }
      files.push({ key, bytes });
    }
    files.push(
      { key: definition.pendingKey, bytes: pending },
      { key: definition.headKey, bytes: head },
    );

    await publisher.publish({ feed, files });
  };
}
