import type { PublishedItem } from "../publication/contracts.js";
import type { PlannedRssArchive, RssSyncPlan } from "./archive-planner.js";
import { planAndRenderSync } from "./archive-planner.js";
import type { DiscoveredRssArchive } from "./archive.js";
import { discoverArchives, validateRssBatchSize } from "./archive.js";
import type {
  RssArtifactStore,
  RssFeedDefinition,
  RssFeedKind,
  RssPublishedItemReader,
  RssSyncOptions,
  RssSyncResult,
  RssSyncService,
} from "./contracts.js";
import { RSS_ARCHIVE_BATCH_SIZE, RssError } from "./contracts.js";
import { getRssFeed } from "./feed.js";
import { renderRssArchive } from "./xml-renderer.js";

export interface RssSyncServiceDependencies {
  readonly reader: RssPublishedItemReader;
  readonly store: RssArtifactStore;
  readonly options?: RssSyncOptions;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function artifactWriteFailed(): never {
  throw new RssError("artifact_write_failed");
}

function assertReconstructableArchivesMatchSnapshot(
  archives: readonly DiscoveredRssArchive[],
  feed: RssFeedDefinition,
  items: readonly PublishedItem[],
): void {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  for (const archive of archives) {
    const archivedItems: PublishedItem[] = [];
    let allItemsAvailable = true;
    for (const archivedItem of archive.document.items) {
      const currentItem = itemsById.get(archivedItem.id);
      if (currentItem === undefined) {
        allItemsAvailable = false;
        break;
      }
      archivedItems.push(currentItem);
    }

    if (!allItemsAvailable) {
      continue;
    }

    const expectedBytes = renderRssArchive({
      feed,
      items: archivedItems,
      documentHref: archive.key,
      previousArchiveHref: archive.document.previousArchiveKey,
    });
    if (!bytesEqual(expectedBytes, archive.bytes)) {
      throw new RssError("archive_conflict");
    }
  }
}

async function readForArchive(
  store: RssArtifactStore,
  key: string,
): Promise<Uint8Array | null> {
  try {
    return await store.read(key);
  } catch {
    return artifactWriteFailed();
  }
}

async function readAfterFailedArchiveWrite(
  store: RssArtifactStore,
  key: string,
): Promise<Uint8Array | null> {
  return readForArchive(store, key);
}

async function materializeArchive(
  store: RssArtifactStore,
  archive: PlannedRssArchive,
): Promise<boolean> {
  const existing = await readForArchive(store, archive.key);
  if (existing !== null) {
    if (!bytesEqual(existing, archive.bytes)) {
      throw new RssError("archive_conflict");
    }
    return false;
  }

  try {
    await store.write(archive.key, archive.bytes, { onlyIfAbsent: true });
  } catch {
    const raced = await readAfterFailedArchiveWrite(store, archive.key);
    if (raced === null) {
      return artifactWriteFailed();
    }
    if (!bytesEqual(raced, archive.bytes)) {
      throw new RssError("archive_conflict");
    }
    return false;
  }

  const written = await readForArchive(store, archive.key);
  if (written === null) {
    return artifactWriteFailed();
  }
  if (!bytesEqual(written, archive.bytes)) {
    throw new RssError("archive_conflict");
  }
  return true;
}

async function writeArtifact(
  store: RssArtifactStore,
  key: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await store.write(key, bytes);
  } catch {
    return artifactWriteFailed();
  }
}

function syncResult(
  plan: RssSyncPlan,
  createdArchiveKeys: readonly string[],
): RssSyncResult {
  return Object.freeze({
    feed: plan.feed,
    headKey: plan.headKey,
    pendingKey: plan.pendingKey,
    pendingGuidCount: plan.pendingGuidCount,
    existingArchiveKeys: plan.existingArchiveKeys,
    createdArchiveKeys: Object.freeze([...createdArchiveKeys]),
    archivedOnlyGuidCount: plan.archivedOnlyGuidCount,
  });
}

class RssSyncServiceImpl implements RssSyncService {
  readonly #reader: RssPublishedItemReader;
  readonly #store: RssArtifactStore;
  readonly #options: RssSyncOptions;

  constructor({ reader, store, options = {} }: RssSyncServiceDependencies) {
    this.#reader = reader;
    this.#store = store;
    this.#options = options;
  }

  async sync(feedKind: RssFeedKind): Promise<RssSyncResult> {
    const feed: RssFeedDefinition = getRssFeed(feedKind);
    const batchSize = validateRssBatchSize(
      this.#options.archiveBatchSize ?? RSS_ARCHIVE_BATCH_SIZE,
    );

    let items: readonly PublishedItem[];
    try {
      items = await this.#reader.list(feed.kind);
    } catch (error) {
      if (error instanceof RssError) {
        throw error;
      }
      throw new RssError("invalid_input");
    }

    const archives = await discoverArchives(this.#store, feed, batchSize);
    const plan = planAndRenderSync(
      { feed: feed.kind, items },
      archives,
      this.#options,
    );
    assertReconstructableArchivesMatchSnapshot(archives, feed, items);

    const createdArchiveKeys: string[] = [];
    for (const archive of plan.newArchives) {
      if (await materializeArchive(this.#store, archive)) {
        createdArchiveKeys.push(archive.key);
      }
    }

    await writeArtifact(this.#store, plan.pendingKey, plan.pendingBytes);
    await writeArtifact(this.#store, plan.headKey, plan.headBytes);

    return syncResult(plan, createdArchiveKeys);
  }
}

export function createRssSyncService({
  reader,
  store,
  options,
}: RssSyncServiceDependencies): RssSyncService {
  return new RssSyncServiceImpl({ reader, store, options });
}
