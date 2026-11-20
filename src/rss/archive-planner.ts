import type { PublishedItem } from "../publication/contracts.js";
import type { DiscoveredRssArchive } from "./archive.js";
import {
  buildRssArchiveKey,
  parseRssArchiveKey,
  validateRssBatchSize,
} from "./archive.js";
import type {
  RssFeedDefinition,
  RssFeedKind,
  RssSyncOptions,
} from "./contracts.js";
import {
  RSS_ARCHIVE_BATCH_SIZE,
  RSS_HEAD_LIMIT,
  RssError,
} from "./contracts.js";
import { getRssFeed, parseRssPublishedAt } from "./feed.js";
import {
  renderRssArchive,
  renderRssHead,
  renderRssPending,
} from "./xml-renderer.js";

const EVENT_TARGET_TYPES = new Set(["EVENT", "EVENT_UPDATE"]);

export interface RssSyncSnapshot {
  readonly feed: RssFeedKind;
  readonly items: readonly PublishedItem[];
}

export interface PlannedRssArchive {
  readonly sequence: number;
  readonly key: string;
  readonly items: readonly PublishedItem[];
  readonly bytes: Uint8Array;
}

export interface RssSyncPlan {
  readonly feed: RssFeedKind;
  readonly headKey: string;
  readonly pendingKey: string;
  readonly pendingGuidCount: number;
  readonly pendingBytes: Uint8Array;
  readonly headBytes: Uint8Array;
  readonly existingArchiveKeys: readonly string[];
  readonly archivedOnlyGuidCount: number;
  readonly newArchives: readonly PlannedRssArchive[];
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareItems(left: PublishedItem, right: PublishedItem): number {
  const timeDifference =
    parseRssPublishedAt(left.published_at) -
    parseRssPublishedAt(right.published_at);
  return timeDifference === 0 ? compareIds(left.id, right.id) : timeDifference;
}

function validateHeadLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > RSS_HEAD_LIMIT) {
    throw new RssError("invalid_input");
  }
  return value;
}

function assertSnapshotItem(item: PublishedItem, feed: RssFeedKind): void {
  const validTargetType =
    feed === "EVENT_UPDATES"
      ? EVENT_TARGET_TYPES.has(item.target_type)
      : item.target_type === "KNOWLEDGE";
  if (
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    !validTargetType ||
    typeof item.target_id !== "string" ||
    item.target_id.length === 0 ||
    typeof item.title !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.body !== "string" ||
    typeof item.published_at !== "string"
  ) {
    throw new RssError("invalid_input");
  }
  parseRssPublishedAt(item.published_at);
}

function validateSnapshot(
  snapshot: RssSyncSnapshot,
  feed: RssFeedDefinition,
): readonly PublishedItem[] {
  if (!Array.isArray(snapshot.items)) {
    throw new RssError("invalid_input");
  }
  const seenIds = new Set<string>();
  for (const item of snapshot.items) {
    assertSnapshotItem(item, feed.kind);
    if (seenIds.has(item.id)) {
      throw new RssError("invalid_input");
    }
    seenIds.add(item.id);
  }
  return snapshot.items;
}

function validateArchives(
  archives: readonly DiscoveredRssArchive[],
  feed: RssFeedDefinition,
  batchSize: number,
): readonly DiscoveredRssArchive[] {
  if (!Array.isArray(archives)) {
    throw new RssError("invalid_archive");
  }
  const sorted = [...archives].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const seenGuids = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const archive = sorted[index]!;
    if (
      archive.feed !== feed.kind ||
      archive.document.feed !== feed.kind ||
      archive.sequence !== index + 1 ||
      archive.document.key !== archive.key ||
      archive.document.documentType !== "archive" ||
      parseRssArchiveKey(feed, archive.key) !== archive.sequence ||
      archive.document.previousArchiveKey !==
        (archive.sequence === 1
          ? null
          : buildRssArchiveKey(feed, archive.sequence - 1)) ||
      archive.document.items.length !== batchSize
    ) {
      throw new RssError("invalid_archive");
    }
    for (const item of archive.document.items) {
      if (seenGuids.has(item.guid)) {
        throw new RssError("invalid_archive");
      }
      seenGuids.add(item.guid);
    }
  }
  return Object.freeze(sorted);
}

function archivedIds(
  archives: readonly DiscoveredRssArchive[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const archive of archives) {
    for (const item of archive.document.items) {
      ids.add(item.id);
    }
  }
  return ids;
}

export function planAndRenderSync(
  snapshot: RssSyncSnapshot,
  archives: readonly DiscoveredRssArchive[],
  options: RssSyncOptions = {},
): RssSyncPlan {
  const feed = getRssFeed(snapshot.feed);
  const headLimit = validateHeadLimit(options.headLimit ?? RSS_HEAD_LIMIT);
  const batchSize = validateRssBatchSize(
    options.archiveBatchSize ?? RSS_ARCHIVE_BATCH_SIZE,
  );
  const current = validateSnapshot(snapshot, feed);
  const existing = validateArchives(archives, feed, batchSize);

  const currentById = new Map(current.map((item) => [item.id, item]));
  const sealedIds = archivedIds(existing);
  let archivedOnlyGuidCount = 0;
  for (const id of sealedIds) {
    if (!currentById.has(id)) {
      archivedOnlyGuidCount += 1;
    }
  }

  const unsealed = current
    .filter((item) => !sealedIds.has(item.id))
    .sort(compareItems);
  const fullBatchCount = Math.floor(unsealed.length / batchSize);
  const pendingItems = unsealed.slice(fullBatchCount * batchSize);

  const newArchives: PlannedRssArchive[] = [];
  let previousArchiveKey =
    existing.length === 0 ? null : existing[existing.length - 1]!.key;
  for (let batchIndex = 0; batchIndex < fullBatchCount; batchIndex += 1) {
    const sequence = existing.length + batchIndex + 1;
    const key = buildRssArchiveKey(feed, sequence);
    const items = Object.freeze(
      unsealed.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
    );
    const bytes = renderRssArchive({
      feed,
      items,
      documentHref: key,
      previousArchiveHref: previousArchiveKey,
    });
    newArchives.push(Object.freeze({ sequence, key, items, bytes }));
    previousArchiveKey = key;
  }

  const pendingItemsFrozen = Object.freeze(pendingItems);
  const pendingBytes = renderRssPending({
    feed,
    items: pendingItemsFrozen,
    documentHref: feed.pendingKey,
    previousArchiveHref: previousArchiveKey,
  });
  const headItems = Object.freeze(
    [...current].sort(compareItems).reverse().slice(0, headLimit),
  );
  const headBytes = renderRssHead({
    feed,
    items: headItems,
    documentHref: feed.headKey,
    previousArchiveHref: feed.pendingKey,
  });

  return Object.freeze({
    feed: feed.kind,
    headKey: feed.headKey,
    pendingKey: feed.pendingKey,
    pendingGuidCount: pendingItemsFrozen.length,
    pendingBytes,
    headBytes,
    existingArchiveKeys: Object.freeze(existing.map((archive) => archive.key)),
    archivedOnlyGuidCount,
    newArchives: Object.freeze(newArchives),
  });
}
