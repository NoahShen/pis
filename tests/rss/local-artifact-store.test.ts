import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  RSS_FEEDS,
  RssError,
  createLocalArtifactStore,
  parseRssArchiveDocument,
  renderRssHead,
  renderRssPending,
} from "../../src/rss/index.js";
import {
  StubRssPublishedItemReader,
  createRssPublishedItem,
  xmlBytesToText,
  xmlTextToBytes,
} from "../fixtures/rss.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const VALID_XML = '<?xml version="1.0" encoding="UTF-8"?><root/>';

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

function expectRssError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(RssError);
  expect((error as RssError).code).toBe(code);
}

describe("local RSS artifact store", () => {
  it("writes readable canonical XML, creates private files, and lists stably", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const bytes = xmlTextToBytes(VALID_XML);

      await store.write("nested/zeta.xml", bytes);
      await store.write("alpha.xml", xmlTextToBytes("<alpha/>"));
      await writeFile(path.join(root, "ignored.txt"), "not an artifact");
      await writeFile(path.join(root, ".alpha.xml.tmp"), "temporary");

      expect(await store.list("")).toEqual(["alpha.xml", "nested/zeta.xml"]);
      expect(await store.read("nested/zeta.xml")).toEqual(bytes);
      expect(await store.read("missing.xml")).toBeNull();
      expect(await store.list("missing/")).toEqual([]);

      const fileStats = await lstat(path.join(root, "nested/zeta.xml"));
      expect(fileStats.mode & 0o777).toBe(0o600);
    });
  });

  it("rejects absolute, traversal, separator, URL, query, fragment and non-XML keys", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const invalidKeys = [
        "",
        "/absolute.xml",
        "../escape.xml",
        "feed/../escape.xml",
        "feed\\escape.xml",
        "feed//double.xml",
        "feed/./same.xml",
        "https://example.test/feed.xml",
        "feed.xml?token=secret",
        "feed.xml#fragment",
        "feed.txt",
        ".xml",
      ] as const;

      for (const key of invalidKeys) {
        const readError = await store
          .read(key)
          .catch((error: unknown) => error);
        expectRssError(readError, "invalid_artifact_key");
        const writeError = await store
          .write(key, xmlTextToBytes(VALID_XML))
          .catch((error: unknown) => error);
        expectRssError(writeError, "invalid_artifact_key");
      }

      for (const prefix of ["../", "feed//", "https://example.test/"]) {
        const error = await store
          .list(prefix)
          .catch((caught: unknown) => caught);
        expectRssError(error, "invalid_artifact_key");
      }
    });
  });

  it("does not expose the absolute root, secret or body in safe errors", async () => {
    await withTempDirectory(async (root) => {
      const secretRoot = path.join(root, "rss-secret-value");
      await mkdir(secretRoot);
      const store = createLocalArtifactStore(secretRoot);
      const secret = "never-return-this-secret";
      const body = "private RSS body";

      const error = await store
        .write(
          `https://example.test/${secret}?body=${body}`,
          xmlTextToBytes(body),
        )
        .catch((caught: unknown) => caught);
      expectRssError(error, "invalid_artifact_key");
      expect((error as Error).message).not.toContain(secretRoot);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(body);
    });
  });

  it("rejects root-escape, internal prefix and final-file symlinks", async () => {
    await withTempDirectory(async (root) => {
      await withTempDirectory(async (outside) => {
        const store = createLocalArtifactStore(root);
        await mkdir(path.join(root, "inside"));
        await mkdir(path.join(root, "redirect"));
        await writeFile(path.join(root, "inside/target.xml"), VALID_XML);
        await writeFile(path.join(outside, "value.xml"), VALID_XML);
        await symlink(outside, path.join(root, "escape"), "dir");
        await symlink("inside", path.join(root, "alias"), "dir");
        await symlink("inside/target.xml", path.join(root, "final.xml"));
        await symlink(
          path.join(outside, "value.xml"),
          path.join(root, "redirect/final.xml"),
        );

        for (const key of [
          "escape/value.xml",
          "alias/target.xml",
          "final.xml",
          "redirect/final.xml",
        ]) {
          const error = await store
            .read(key)
            .catch((caught: unknown) => caught);
          expectRssError(error, "unsafe_path");
        }
        const listError = await store
          .list("escape/")
          .catch((caught: unknown) => caught);
        expectRssError(listError, "unsafe_path");

        for (const key of ["alias/new.xml", "final.xml"]) {
          const error = await store
            .write(key, xmlTextToBytes(VALID_XML))
            .catch((caught: unknown) => caught);
          expectRssError(error, "unsafe_path");
        }
        expect(
          await readFile(path.join(root, "inside/target.xml"), "utf8"),
        ).toBe(VALID_XML);
        expect(await readFile(path.join(outside, "value.xml"), "utf8")).toBe(
          VALID_XML,
        );
      });
    });
  });

  it("atomically replaces valid head and pending documents, including pending 0 -> 1 -> 0", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const feed = RSS_FEEDS.EVENT_UPDATES;
      const item = createRssPublishedItem();
      const pendingEmpty = renderRssPending({
        feed,
        items: [],
        documentHref: feed.pendingKey,
        previousArchiveHref: null,
      });
      const pendingOne = renderRssPending({
        feed,
        items: [item],
        documentHref: feed.pendingKey,
        previousArchiveHref: null,
      });
      const head = renderRssHead({
        feed,
        items: [item],
        documentHref: feed.headKey,
        previousArchiveHref: feed.pendingKey,
      });

      await store.write(feed.pendingKey, pendingEmpty);
      await store.write(feed.pendingKey, pendingOne);
      await store.write(feed.pendingKey, pendingEmpty);
      await store.write(feed.headKey, head);

      const finalPending = (await store.read(feed.pendingKey))!;
      const pendingDocument = parseRssArchiveDocument(
        feed,
        feed.pendingKey,
        finalPending,
      );
      expect(pendingDocument.items).toEqual([]);
      expect(xmlBytesToText(finalPending)).toContain("<fh:archive/>");
      expect(
        parseRssArchiveDocument(
          feed,
          feed.headKey,
          (await store.read(feed.headKey))!,
        ).items,
      ).toHaveLength(1);
      expect(
        (await relativeFiles(root)).some((file) => file.endsWith(".tmp")),
      ).toBe(false);
    });
  });

  it("uses race-free only-if-absent links and never overwrites an existing archive", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const key = "archive/event-updates-0001.xml";
      const first = xmlTextToBytes('<archive value="first"/>');
      const second = xmlTextToBytes('<archive value="second"/>');

      await store.write(key, first, { onlyIfAbsent: true });
      const error = await store
        .write(key, second, { onlyIfAbsent: true })
        .catch((caught: unknown) => caught);
      expectRssError(error, "artifact_exists");
      expect(await store.read(key)).toEqual(first);

      const raceKey = "archive/event-updates-0002.xml";
      const results = await Promise.allSettled([
        store.write(raceKey, xmlTextToBytes('<archive value="left"/>'), {
          onlyIfAbsent: true,
        }),
        store.write(raceKey, xmlTextToBytes('<archive value="right"/>'), {
          onlyIfAbsent: true,
        }),
      ]);
      expect(
        results.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(({ status }) => status === "rejected");
      expectRssError(
        rejected?.status === "rejected" ? rejected.reason : null,
        "artifact_exists",
      );
      const raceBytes = xmlBytesToText((await store.read(raceKey))!);
      expect(
        raceBytes === '<archive value="left"/>' ||
          raceBytes === '<archive value="right"/>',
      ).toBe(true);
      expect(
        (await relativeFiles(root)).some((file) => file.endsWith(".tmp")),
      ).toBe(false);
    });
  });

  it("cleans temporary files and leaves no final file for invalid XML or write failures", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const invalidError = await store
        .write("invalid.xml", xmlTextToBytes("<root>"))
        .catch((caught: unknown) => caught);
      expectRssError(invalidError, "artifact_write_failed");
      expect(await store.read("invalid.xml")).toBeNull();

      const blockedDirectory = path.join(root, "blocked");
      await mkdir(blockedDirectory);
      await chmod(blockedDirectory, 0o500);
      try {
        const writeError = await store
          .write("blocked/file.xml", xmlTextToBytes(VALID_XML))
          .catch((caught: unknown) => caught);
        expectRssError(writeError, "artifact_write_failed");
        expect((writeError as Error).message).not.toContain(blockedDirectory);
        expect((writeError as Error).message).not.toContain(VALID_XML);
        expect(await store.read("blocked/file.xml")).toBeNull();
      } finally {
        await chmod(blockedDirectory, 0o700);
      }

      expect(
        (await relativeFiles(root)).some((file) => file.endsWith(".tmp")),
      ).toBe(false);
    });
  });

  it("does not invoke the published-item reader for static list or read", async () => {
    await withTempDirectory(async (root) => {
      const store = createLocalArtifactStore(root);
      const reader = new StubRssPublishedItemReader();
      await store.write("static.xml", xmlTextToBytes(VALID_XML));

      await store.list("");
      await store.read("static.xml");
      expect(reader.calls).toEqual([]);
    });
  });
});
