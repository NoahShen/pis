import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PublishedItem } from "../../src/publication/contracts.js";
import {
  RSS_FEEDS,
  RssError,
  createLocalArtifactStore,
  createLocalRssSync,
  parseRssArchiveDocument,
  planAndRenderSync,
  renderRssArchive,
  renderRssHead,
  renderRssPending,
} from "../../src/rss/index.js";
import type { RssArtifactStore, RssFeedKind } from "../../src/rss/index.js";
import {
  StubRssPublishedItemReader,
  createRssItems,
  createRssPublishedItem,
  xmlBytesToText,
  xmlTextToBytes,
} from "../fixtures/rss.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;
const CURATED_FEED = RSS_FEEDS.CURATED_CONTENT;
const EVENT_ARCHIVE_ONE = "archive/event-updates-0001.xml";
const EVENT_ARCHIVE_TWO = "archive/event-updates-0002.xml";

function rows(
  event: readonly PublishedItem[] = [],
  curated: readonly PublishedItem[] = [],
): Readonly<Record<RssFeedKind, readonly PublishedItem[]>> {
  return { EVENT_UPDATES: event, CURATED_CONTENT: curated };
}

function expectRssError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(RssError);
  expect((error as RssError).code).toBe(code);
}

async function relativeFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else {
        files.push(relative);
      }
    }
  };
  await visit(directory, "");
  return files.sort();
}

function noTemporaryFiles(files: readonly string[]): void {
  expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
}

function expectFiles(
  actual: readonly string[],
  expected: readonly string[],
): void {
  expect(actual).toEqual([...expected].sort());
}

async function present(
  store: RssArtifactStore,
  key: string,
): Promise<Uint8Array> {
  const bytes = await store.read(key);
  expect(bytes).not.toBeNull();
  return bytes!;
}

describe("local RSS sync composition", () => {
  it("writes archive, pending and head under an explicit secret root", async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = path.join(
        directory,
        "secret-feed-root",
        "output",
      );
      const reader = new StubRssPublishedItemReader(rows(createRssItems(3)));
      const service = createLocalRssSync({
        reader,
        outputDirectory,
        options: { archiveBatchSize: 2, headLimit: 2 },
      });

      const result = await service.sync("EVENT_UPDATES");
      const store = createLocalArtifactStore(outputDirectory);
      const files = await relativeFiles(outputDirectory);

      expectFiles(files, [
        EVENT_ARCHIVE_ONE,
        EVENT_FEED.headKey,
        EVENT_FEED.pendingKey,
      ]);
      expect(result.createdArchiveKeys).toEqual([EVENT_ARCHIVE_ONE]);
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_ARCHIVE_ONE,
          await present(store, EVENT_ARCHIVE_ONE),
          { batchSize: 2 },
        ).items,
      ).toHaveLength(2);
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          await present(store, EVENT_FEED.pendingKey),
          { batchSize: 2, latestArchiveKey: EVENT_ARCHIVE_ONE },
        ).items.map((item) => item.id),
      ).toEqual(["rss-0003"]);
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.headKey,
          await present(store, EVENT_FEED.headKey),
        ).items.map((item) => item.id),
      ).toEqual(["rss-0003", "rss-0002"]);
      expect(
        xmlBytesToText(await present(store, EVENT_FEED.pendingKey)),
      ).toContain("<fh:archive/>");
      expect(
        xmlBytesToText(await present(store, EVENT_FEED.headKey)),
      ).not.toContain("secret-feed-root");
      expect(reader.calls).toEqual(["EVENT_UPDATES"]);
      noTemporaryFiles(files);

      await store.list("");
      await store.read(EVENT_FEED.headKey);
      expect(reader.calls).toEqual(["EVENT_UPDATES"]);
    });
  });

  it("syncAll runs both Feeds sequentially in canonical order", async () => {
    await withTempDirectory(async (directory) => {
      const event = createRssItems(1);
      const curated = createRssItems(1, "KNOWLEDGE").map((item) => ({
        ...item,
        id: "knowledge-0001",
        target_id: "knowledge-target-0001",
      }));
      const reader = new StubRssPublishedItemReader(rows(event, curated));
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });

      const results = await service.syncAll();
      expect(results.map((result) => result.feed)).toEqual([
        "EVENT_UPDATES",
        "CURATED_CONTENT",
      ]);
      expect(reader.calls).toEqual(["EVENT_UPDATES", "CURATED_CONTENT"]);
      expectFiles(await relativeFiles(directory), [
        CURATED_FEED.headKey,
        CURATED_FEED.pendingKey,
        EVENT_FEED.headKey,
        EVENT_FEED.pendingKey,
      ]);
    });
  });

  it("keeps a legal pending archive through 0 -> 1 -> 0 and repeated snapshots", async () => {
    await withTempDirectory(async (directory) => {
      const reader = new StubRssPublishedItemReader();
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });
      const store = createLocalArtifactStore(directory);

      await service.sync("EVENT_UPDATES");
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          await present(store, EVENT_FEED.pendingKey),
          { batchSize: 2 },
        ).items,
      ).toEqual([]);

      const item = createRssPublishedItem();
      reader.replace(rows([item]));
      await service.sync("EVENT_UPDATES");
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          await present(store, EVENT_FEED.pendingKey),
          { batchSize: 2 },
        ).items.map((entry) => entry.id),
      ).toEqual([item.id]);
      const stablePending = await present(store, EVENT_FEED.pendingKey);
      const stableHead = await present(store, EVENT_FEED.headKey);
      await service.sync("EVENT_UPDATES");
      expect(await present(store, EVENT_FEED.pendingKey)).toEqual(
        stablePending,
      );
      expect(await present(store, EVENT_FEED.headKey)).toEqual(stableHead);

      reader.replace(rows([]));
      await service.sync("EVENT_UPDATES");
      const emptyPending = await present(store, EVENT_FEED.pendingKey);
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          emptyPending,
          { batchSize: 2 },
        ).items,
      ).toEqual([]);
      expect(xmlBytesToText(emptyPending)).toContain("<fh:archive/>");
      expectFiles(await relativeFiles(directory), [
        EVENT_FEED.headKey,
        EVENT_FEED.pendingKey,
      ]);
    });
  });

  it("preserves sealed bytes through repeat, late, rollback and interleaved Feed syncs", async () => {
    await withTempDirectory(async (directory) => {
      const initial = createRssItems(3);
      const curated = createRssItems(1, "KNOWLEDGE").map((item) => ({
        ...item,
        id: "knowledge-0001",
        target_id: "knowledge-target-0001",
      }));
      const reader = new StubRssPublishedItemReader(rows(initial, curated));
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });
      const store = createLocalArtifactStore(directory);

      await service.sync("EVENT_UPDATES");
      const archiveOne = await present(store, EVENT_ARCHIVE_ONE);
      await service.sync("CURATED_CONTENT");
      await service.sync("EVENT_UPDATES");
      expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(archiveOne);

      const late = createRssPublishedItem({
        id: "rss-late",
        target_id: "rss-target-late",
        title: "Late item",
        published_at: "2025-01-01T00:00:00.000Z",
      });
      reader.replace(rows([...initial, late], curated));
      await service.sync("EVENT_UPDATES");
      expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(archiveOne);
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_ARCHIVE_TWO,
          await present(store, EVENT_ARCHIVE_TWO),
          { batchSize: 2 },
        ).items.map((item) => item.id),
      ).toEqual(["rss-late", "rss-0003"]);
      const archiveTwo = await present(store, EVENT_ARCHIVE_TWO);

      reader.replace(rows(initial, curated));
      await service.sync("EVENT_UPDATES");
      expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(archiveOne);
      expect(await present(store, EVENT_ARCHIVE_TWO)).toEqual(archiveTwo);
      expectFiles(await relativeFiles(directory), [
        EVENT_ARCHIVE_ONE,
        EVENT_ARCHIVE_TWO,
        CURATED_FEED.headKey,
        CURATED_FEED.pendingKey,
        EVENT_FEED.headKey,
        EVENT_FEED.pendingKey,
      ]);
    });
  });

  it("archive conflicts preserve the old archive, pending and head", async () => {
    await withTempDirectory(async (directory) => {
      const store = createLocalArtifactStore(directory);
      const currentItems = createRssItems(2);
      const oldItems = [...createRssItems(2, "EVENT_UPDATE")]
        .reverse()
        .map((item, index) =>
          index === 0 ? { ...item, title: "Conflicting sealed title" } : item,
        );
      const conflict = renderRssArchive({
        feed: EVENT_FEED,
        items: oldItems,
        documentHref: EVENT_ARCHIVE_ONE,
        previousArchiveHref: null,
      });
      const oldPending = renderRssPending({
        feed: EVENT_FEED,
        items: [],
        documentHref: EVENT_FEED.pendingKey,
        previousArchiveHref: EVENT_ARCHIVE_ONE,
      });
      const oldHead = renderRssHead({
        feed: EVENT_FEED,
        items: currentItems,
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      });
      await store.write(EVENT_ARCHIVE_ONE, conflict, { onlyIfAbsent: true });
      await store.write(EVENT_FEED.pendingKey, oldPending);
      await store.write(EVENT_FEED.headKey, oldHead);

      const reader = new StubRssPublishedItemReader(rows(currentItems));
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });
      const error = await service
        .sync("EVENT_UPDATES")
        .catch((caught: unknown) => caught);

      expectRssError(error, "archive_conflict");
      expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(conflict);
      expect(await present(store, EVENT_FEED.pendingKey)).toEqual(oldPending);
      expect(await present(store, EVENT_FEED.headKey)).toEqual(oldHead);
      noTemporaryFiles(await relativeFiles(directory));
    });
  });

  it("stops at archive, pending or head failure without advancing later files", async () => {
    await withTempDirectory(async (directory) => {
      const store = createLocalArtifactStore(directory);
      const reader = new StubRssPublishedItemReader(rows(createRssItems(2)));
      const pendingSentinel = renderRssPending({
        feed: EVENT_FEED,
        items: [],
        documentHref: EVENT_FEED.pendingKey,
        previousArchiveHref: null,
      });
      const headSentinel = renderRssHead({
        feed: EVENT_FEED,
        items: [],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      });
      await mkdir(
        path.join(
          directory,
          "archive",
          EVENT_FEED.archiveFilePrefix + "-0001.xml",
        ),
        {
          recursive: true,
        },
      );
      await store.write(EVENT_FEED.pendingKey, pendingSentinel);
      await store.write(EVENT_FEED.headKey, headSentinel);

      const archiveError = await createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      })
        .sync("EVENT_UPDATES")
        .catch((caught: unknown) => caught);
      expectRssError(archiveError, "artifact_write_failed");
      expect(await present(store, EVENT_FEED.pendingKey)).toEqual(
        pendingSentinel,
      );
      expect(await present(store, EVENT_FEED.headKey)).toEqual(headSentinel);
      noTemporaryFiles(await relativeFiles(directory));
    });

    await withTempDirectory(async (directory) => {
      const store = createLocalArtifactStore(directory);
      const reader = new StubRssPublishedItemReader(rows(createRssItems(2)));
      const headSentinel = renderRssHead({
        feed: EVENT_FEED,
        items: [],
        documentHref: EVENT_FEED.headKey,
        previousArchiveHref: EVENT_FEED.pendingKey,
      });
      await mkdir(path.join(directory, EVENT_FEED.pendingKey));
      await store.write(EVENT_FEED.headKey, headSentinel);

      const pendingError = await createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      })
        .sync("EVENT_UPDATES")
        .catch((caught: unknown) => caught);
      expectRssError(pendingError, "artifact_write_failed");
      expect(await present(store, EVENT_ARCHIVE_ONE)).not.toBeNull();
      expect(await present(store, EVENT_FEED.headKey)).toEqual(headSentinel);
      noTemporaryFiles(await relativeFiles(directory));
    });

    await withTempDirectory(async (directory) => {
      const store = createLocalArtifactStore(directory);
      const reader = new StubRssPublishedItemReader(rows(createRssItems(2)));
      await mkdir(path.join(directory, EVENT_FEED.headKey));

      const headError = await createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      })
        .sync("EVENT_UPDATES")
        .catch((caught: unknown) => caught);
      expectRssError(headError, "artifact_write_failed");
      expect(await present(store, EVENT_ARCHIVE_ONE)).not.toBeNull();
      expect(
        parseRssArchiveDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          await present(store, EVENT_FEED.pendingKey),
          { batchSize: 2, latestArchiveKey: EVENT_ARCHIVE_ONE },
        ).items,
      ).toEqual([]);
      noTemporaryFiles(await relativeFiles(directory));
    });
  });

  it("stops syncAll after one Feed failure and does not write the other Feed", async () => {
    await withTempDirectory(async (directory) => {
      const event = createRssItems(1);
      const curated = createRssItems(1, "KNOWLEDGE").map((item) => ({
        ...item,
        id: "knowledge-0001",
        target_id: "knowledge-target-0001",
      }));
      const reader = new StubRssPublishedItemReader(rows(event, curated));
      await mkdir(path.join(directory, EVENT_FEED.pendingKey));
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });

      const error = await service.syncAll().catch((caught: unknown) => caught);
      expectRssError(error, "artifact_write_failed");
      expect(reader.calls).toEqual(["EVENT_UPDATES"]);
      const store = createLocalArtifactStore(directory);
      expect(await store.read(CURATED_FEED.headKey)).toBeNull();
      expect(await store.read(CURATED_FEED.pendingKey)).toBeNull();
    });
  });

  it("serializes concurrent sync calls for the same Feed", async () => {
    await withTempDirectory(async (directory) => {
      let releaseFirst!: () => void;
      let markFirstStarted!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let calls = 0;
      const reader = {
        async list(): Promise<readonly PublishedItem[]> {
          calls += 1;
          if (calls === 1) {
            markFirstStarted();
            await firstGate;
          }
          return [];
        },
      };
      const service = createLocalRssSync({
        reader,
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });

      const first = service.sync("EVENT_UPDATES");
      const second = service.sync("EVENT_UPDATES");
      await firstStarted;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(calls).toBe(1);
      releaseFirst();
      await Promise.all([first, second]);
      expect(calls).toBe(2);
    });
  });

  it("only renders controlled relative archive links", async () => {
    await withTempDirectory(async (directory) => {
      const planned = planAndRenderSync(
        { feed: EVENT_FEED.kind, items: createRssItems(2) },
        [],
        { archiveBatchSize: 2 },
      );
      const service = createLocalRssSync({
        reader: new StubRssPublishedItemReader(rows(createRssItems(2))),
        outputDirectory: directory,
        options: { archiveBatchSize: 2 },
      });
      await service.sync("EVENT_UPDATES");
      const store = createLocalArtifactStore(directory);
      const pending = xmlBytesToText(
        await present(store, EVENT_FEED.pendingKey),
      );
      expect(planned.newArchives[0]?.key).toBe(EVENT_ARCHIVE_ONE);
      expect(pending).not.toContain("?before");
      expect(pending).not.toContain(directory);
      expect(pending).toContain('href="archive/event-updates-0001.xml"');
    });
  });
});
