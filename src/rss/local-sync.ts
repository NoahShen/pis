import path from "node:path";

import type {
  RssFeedKind,
  RssPublishedItemReader,
  RssSyncOptions,
  RssSyncResult,
} from "./contracts.js";
import { getRssFeed } from "./feed.js";
import { createLocalArtifactStore } from "./local-artifact-store.js";
import { createRssSyncService } from "./sync-service.js";

const SYNC_ORDER = Object.freeze([
  "EVENT_UPDATES",
  "CURATED_CONTENT",
] as const satisfies readonly RssFeedKind[]);

export interface LocalRssSyncService {
  sync(feed: RssFeedKind): Promise<RssSyncResult>;
  syncAll(): Promise<readonly RssSyncResult[]>;
}

export interface LocalRssSyncDependencies {
  readonly reader: RssPublishedItemReader;
  readonly outputDirectory: string;
  readonly options?: RssSyncOptions;
}

class LocalRssSyncServiceImpl implements LocalRssSyncService {
  readonly #syncService;
  readonly #feedTails = new Map<RssFeedKind, Promise<void>>();

  constructor({ reader, outputDirectory, options }: LocalRssSyncDependencies) {
    const store = createLocalArtifactStore(path.resolve(outputDirectory));
    this.#syncService = createRssSyncService({ reader, store, options });
  }

  sync(feed: RssFeedKind): Promise<RssSyncResult> {
    getRssFeed(feed);
    const previous = this.#feedTails.get(feed) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#feedTails.set(feed, tail);

    return previous.then(async () => {
      try {
        return await this.#syncService.sync(feed);
      } finally {
        release();
        if (this.#feedTails.get(feed) === tail) {
          this.#feedTails.delete(feed);
        }
      }
    });
  }

  async syncAll(): Promise<readonly RssSyncResult[]> {
    const results: RssSyncResult[] = [];
    for (const feed of SYNC_ORDER) {
      results.push(await this.sync(feed));
    }
    return Object.freeze(results);
  }
}

export function createLocalRssSync({
  reader,
  outputDirectory,
  options,
}: LocalRssSyncDependencies): LocalRssSyncService {
  return new LocalRssSyncServiceImpl({ reader, outputDirectory, options });
}
