import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type Database from "better-sqlite3";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import {
  RSS_FEEDS,
  createLocalArtifactStore,
  createLocalRssSync,
  createPublishedItemSource,
  parseRssArchiveDocument,
} from "../../src/rss/index.js";
import type {
  RssArchiveDocument,
  RssArtifactStore,
} from "../../src/rss/index.js";
import { SqlitePublishedItemRepository } from "../../src/publication/published-item-repository.js";
import {
  RSS_EXTERNAL_SENTINELS,
  buildRssCuratedFeedItems,
  buildRssEventFeedItems,
  seedRssDatabasePublishedItems,
  withRssDatabase,
} from "../fixtures/rss-database.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const EVENT_FEED = RSS_FEEDS.EVENT_UPDATES;
const CURATED_FEED = RSS_FEEDS.CURATED_CONTENT;
const EVENT_ARCHIVE_ONE = "archive/event-updates-0001.xml";
const EVENT_ARCHIVE_TWO = "archive/event-updates-0002.xml";
const CURATED_ARCHIVE_ONE = "archive/curated-content-0001.xml";
const CURATED_ARCHIVE_TWO = "archive/curated-content-0002.xml";
const DEFAULT_DATABASE = path.resolve("data/pis.sqlite");

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

async function present(
  store: RssArtifactStore,
  key: string,
): Promise<Uint8Array> {
  const bytes = await store.read(key);
  expect(bytes).not.toBeNull();
  return bytes!;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function readTotalChanges(database: Database.Database): number {
  return (database as Database.Database & { readonly total_changes: number })
    .total_changes;
}

function guids(document: RssArchiveDocument): readonly string[] {
  return document.items.map((item) => item.guid);
}

function parseDocument(
  feed: (typeof RSS_FEEDS)[keyof typeof RSS_FEEDS],
  key: string,
  bytes: Uint8Array,
): RssArchiveDocument {
  return parseRssArchiveDocument(feed, key, bytes, { batchSize: 200 });
}

async function expectChain(
  store: RssArtifactStore,
  feed: (typeof RSS_FEEDS)[keyof typeof RSS_FEEDS],
  archiveOne: string,
  archiveTwo: string,
): Promise<void> {
  const headBytes = await present(store, feed.headKey);
  const head = parseDocument(feed, feed.headKey, headBytes);
  expect(head.previousArchiveKey).toBe(feed.pendingKey);
  expect(decode(headBytes)).not.toContain("<fh:archive/>");

  const pendingBytes = await present(store, feed.pendingKey);
  const pending = parseDocument(feed, feed.pendingKey, pendingBytes);
  expect(pending.previousArchiveKey).toBe(archiveTwo);
  expect(decode(pendingBytes)).toContain("<fh:archive/>");

  const archiveTwoBytes = await present(store, archiveTwo);
  const archiveTwoDocument = parseDocument(feed, archiveTwo, archiveTwoBytes);
  expect(archiveTwoDocument.previousArchiveKey).toBe(archiveOne);

  const archiveOneBytes = await present(store, archiveOne);
  const archiveOneDocument = parseDocument(feed, archiveOne, archiveOneBytes);
  expect(archiveOneDocument.previousArchiveKey).toBeNull();
}

async function expectFeedCoverage(
  feed: (typeof RSS_FEEDS)[keyof typeof RSS_FEEDS],
  store: RssArtifactStore,
  archiveOne: string,
  archiveTwo: string,
  expectedTotal: number,
): Promise<void> {
  const head = parseDocument(
    feed,
    feed.headKey,
    await present(store, feed.headKey),
  );
  const pending = parseDocument(
    feed,
    feed.pendingKey,
    await present(store, feed.pendingKey),
  );
  const archiveOneDocument = parseDocument(
    feed,
    archiveOne,
    await present(store, archiveOne),
  );
  const archiveTwoDocument = parseDocument(
    feed,
    archiveTwo,
    await present(store, archiveTwo),
  );

  const all = [
    ...guids(head),
    ...guids(pending),
    ...guids(archiveOneDocument),
    ...guids(archiveTwoDocument),
  ];
  expect(new Set(all).size).toBe(expectedTotal);
  expect(head.items).toHaveLength(200);
  expect(archiveOneDocument.items).toHaveLength(200);
  expect(archiveTwoDocument.items).toHaveLength(200);
}

describe("local RSS complete file set", () => {
  it("builds the 400 then 451 head/pending/archive file set with a stable chain", async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = path.join(directory, "feeds", "output");
      await withRssDatabase(async (database) => {
        seedRssDatabasePublishedItems(database, buildRssEventFeedItems(1, 400));
        seedRssDatabasePublishedItems(
          database,
          buildRssCuratedFeedItems(1, 400),
        );

        const reader = createPublishedItemSource(
          new SqlitePublishedItemRepository(database),
        );
        const service = createLocalRssSync({
          reader,
          outputDirectory,
        });
        const store = createLocalArtifactStore(outputDirectory);

        const changesBefore = readTotalChanges(database);
        const results = await service.syncAll();
        expect(readTotalChanges(database)).toBe(changesBefore);
        expect(results.map((result) => result.feed)).toEqual([
          "EVENT_UPDATES",
          "CURATED_CONTENT",
        ]);

        await expectFeedCoverage(
          EVENT_FEED,
          store,
          EVENT_ARCHIVE_ONE,
          EVENT_ARCHIVE_TWO,
          400,
        );
        await expectFeedCoverage(
          CURATED_FEED,
          store,
          CURATED_ARCHIVE_ONE,
          CURATED_ARCHIVE_TWO,
          400,
        );

        const pendingZero = parseDocument(
          EVENT_FEED,
          EVENT_FEED.pendingKey,
          await present(store, EVENT_FEED.pendingKey),
        );
        expect(pendingZero.items).toEqual([]);
        expect(decode(await present(store, CURATED_FEED.pendingKey))).toContain(
          "<fh:archive/>",
        );
        await expectChain(
          store,
          EVENT_FEED,
          EVENT_ARCHIVE_ONE,
          EVENT_ARCHIVE_TWO,
        );
        await expectChain(
          store,
          CURATED_FEED,
          CURATED_ARCHIVE_ONE,
          CURATED_ARCHIVE_TWO,
        );

        const eventArchiveOne = await present(store, EVENT_ARCHIVE_ONE);
        const eventArchiveTwo = await present(store, EVENT_ARCHIVE_TWO);
        const curatedArchiveOne = await present(store, CURATED_ARCHIVE_ONE);
        const curatedArchiveTwo = await present(store, CURATED_ARCHIVE_TWO);

        seedRssDatabasePublishedItems(
          database,
          buildRssEventFeedItems(401, 51),
        );
        seedRssDatabasePublishedItems(
          database,
          buildRssCuratedFeedItems(401, 51),
        );

        const changesBeforeSecond = readTotalChanges(database);
        await service.syncAll();
        expect(readTotalChanges(database)).toBe(changesBeforeSecond);

        expect(
          parseDocument(
            EVENT_FEED,
            EVENT_FEED.pendingKey,
            await present(store, EVENT_FEED.pendingKey),
          ).items,
        ).toHaveLength(51);
        expect(
          parseDocument(
            CURATED_FEED,
            CURATED_FEED.pendingKey,
            await present(store, CURATED_FEED.pendingKey),
          ).items,
        ).toHaveLength(51);
        expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(
          eventArchiveOne,
        );
        expect(await present(store, EVENT_ARCHIVE_TWO)).toEqual(
          eventArchiveTwo,
        );
        expect(await present(store, CURATED_ARCHIVE_ONE)).toEqual(
          curatedArchiveOne,
        );
        expect(await present(store, CURATED_ARCHIVE_TWO)).toEqual(
          curatedArchiveTwo,
        );

        await expectFeedCoverage(
          EVENT_FEED,
          store,
          EVENT_ARCHIVE_ONE,
          EVENT_ARCHIVE_TWO,
          451,
        );
        await expectFeedCoverage(
          CURATED_FEED,
          store,
          CURATED_ARCHIVE_ONE,
          CURATED_ARCHIVE_TWO,
          451,
        );
        await expectChain(
          store,
          EVENT_FEED,
          EVENT_ARCHIVE_ONE,
          EVENT_ARCHIVE_TWO,
        );
        await expectChain(
          store,
          CURATED_FEED,
          CURATED_ARCHIVE_ONE,
          CURATED_ARCHIVE_TWO,
        );

        const eventHead = await present(store, EVENT_FEED.headKey);
        const eventPending = await present(store, EVENT_FEED.pendingKey);

        // Event feed GUIDs never cross into Curated and vice versa.
        const eventGuids = [
          ...guids(
            parseDocument(
              EVENT_FEED,
              EVENT_FEED.headKey,
              await present(store, EVENT_FEED.headKey),
            ),
          ),
          ...guids(
            parseDocument(
              EVENT_FEED,
              EVENT_FEED.pendingKey,
              await present(store, EVENT_FEED.pendingKey),
            ),
          ),
        ];
        expect(
          eventGuids.every((guid) =>
            guid.startsWith("pis:published:rss-db-event"),
          ),
        ).toBe(true);
        const curatedGuids = [
          ...guids(
            parseDocument(
              CURATED_FEED,
              CURATED_FEED.headKey,
              await present(store, CURATED_FEED.headKey),
            ),
          ),
          ...guids(
            parseDocument(
              CURATED_FEED,
              CURATED_FEED.pendingKey,
              await present(store, CURATED_FEED.pendingKey),
            ),
          ),
        ];
        expect(
          curatedGuids.every((guid) =>
            guid.startsWith("pis:published:rss-db-knowledge"),
          ),
        ).toBe(true);

        // Repeated sync on an unchanged snapshot keeps every byte stable.
        await service.syncAll();
        expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(
          eventArchiveOne,
        );
        expect(await present(store, EVENT_ARCHIVE_TWO)).toEqual(
          eventArchiveTwo,
        );
        expect(await present(store, EVENT_FEED.headKey)).toEqual(eventHead);
        expect(await present(store, EVENT_FEED.pendingKey)).toEqual(
          eventPending,
        );

        // Late and rollback snapshots never rewrite sealed archive bytes.
        const lateEvent = buildRssEventFeedItems(501, 1)[0]!;
        const lateCurated = buildRssCuratedFeedItems(501, 1)[0]!;
        seedRssDatabasePublishedItems(database, [lateEvent, lateCurated]);
        await service.syncAll();
        expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(
          eventArchiveOne,
        );
        expect(await present(store, CURATED_ARCHIVE_TWO)).toEqual(
          curatedArchiveTwo,
        );
        expect(
          parseDocument(
            EVENT_FEED,
            EVENT_FEED.pendingKey,
            await present(store, EVENT_FEED.pendingKey),
          ).items,
        ).toHaveLength(52);

        database
          .prepare("DELETE FROM published_items WHERE id = ?")
          .run(lateEvent.id);
        database
          .prepare("DELETE FROM published_items WHERE id = ?")
          .run(lateCurated.id);
        await service.syncAll();
        expect(await present(store, EVENT_ARCHIVE_ONE)).toEqual(
          eventArchiveOne,
        );
        expect(await present(store, CURATED_ARCHIVE_TWO)).toEqual(
          curatedArchiveTwo,
        );
        expect(
          parseDocument(
            EVENT_FEED,
            EVENT_FEED.pendingKey,
            await present(store, EVENT_FEED.pendingKey),
          ).items,
        ).toHaveLength(51);
        expect(await present(store, EVENT_FEED.headKey)).toEqual(eventHead);
      });
    });
  });

  it("keeps the output tree XML-only, isolated from sentinels and the default database", async () => {
    await withTempDirectory(async (directory) => {
      const outputDirectory = path.join(directory, "feeds", "output");
      const sentinelDirectory = path.join(directory, "sentinel-area");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(sentinelDirectory, { recursive: true });
      await writeFile(
        path.join(sentinelDirectory, "database.sqlite"),
        RSS_EXTERNAL_SENTINELS.database,
      );
      await writeFile(
        path.join(sentinelDirectory, ".env"),
        RSS_EXTERNAL_SENTINELS.env,
      );
      await writeFile(
        path.join(sentinelDirectory, "prompt.md"),
        RSS_EXTERNAL_SENTINELS.prompt,
      );
      await writeFile(
        path.join(sentinelDirectory, "app.log"),
        RSS_EXTERNAL_SENTINELS.log,
      );

      const defaultBefore = existsSync(DEFAULT_DATABASE);
      await withRssDatabase(async (database) => {
        seedRssDatabasePublishedItems(database, buildRssEventFeedItems(1, 400));
        seedRssDatabasePublishedItems(
          database,
          buildRssCuratedFeedItems(1, 400),
        );
        const reader = createPublishedItemSource(
          new SqlitePublishedItemRepository(database),
        );
        const service = createLocalRssSync({
          reader,
          outputDirectory,
        });
        const store = createLocalArtifactStore(outputDirectory);

        const changesBefore = readTotalChanges(database);
        await service.syncAll();
        expect(readTotalChanges(database)).toBe(changesBefore);

        const files = await relativeFiles(outputDirectory);
        expect(files).toEqual(
          [
            CURATED_ARCHIVE_ONE,
            CURATED_ARCHIVE_TWO,
            CURATED_FEED.headKey,
            CURATED_FEED.pendingKey,
            EVENT_ARCHIVE_ONE,
            EVENT_ARCHIVE_TWO,
            EVENT_FEED.headKey,
            EVENT_FEED.pendingKey,
          ].sort(),
        );
        expect(files.every((file) => file.endsWith(".xml"))).toBe(true);

        for (const file of files) {
          const text = decode(await present(store, file));
          expect(XMLValidator.validate(text)).toBe(true);
          for (const sentinel of Object.values(RSS_EXTERNAL_SENTINELS)) {
            expect(text).not.toContain(sentinel);
          }
          expect(text).not.toContain(outputDirectory);
          expect(text).not.toContain(path.resolve(outputDirectory));
          expect(text).not.toContain("SELECT");
          expect(text).not.toContain("RssError");
        }
      });

      expect(existsSync(DEFAULT_DATABASE)).toBe(defaultBefore);
    });
  });
});
