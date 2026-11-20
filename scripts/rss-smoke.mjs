import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { XMLValidator } from "fast-xml-parser";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_DATABASE = path.join(projectRoot, "data", "pis.sqlite");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`RSS smoke verification failed: ${message}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function loadCompiled(relativePath) {
  return import(pathToFileURL(path.join(projectRoot, relativePath)).href);
}

function buildItems(count, targetType, prefix) {
  return Array.from({ length: count }, (_, offset) => {
    const sequence = offset + 1;
    const suffix = String(sequence).padStart(4, "0");
    const id = `${prefix}-${suffix}`;
    return {
      id,
      target_type: targetType,
      target_id: `${prefix}-target-${suffix}`,
      title: `RSS smoke ${prefix} ${suffix}`,
      summary: `RSS smoke summary ${suffix}`,
      body:
        `<p>合成正文 ${suffix}</p>` +
        `<section><h2>来源</h2><ul>` +
        `<li><a href="https://smoke-source.example.test/${id}">来源</a></li>` +
        `</ul></section>`,
      published_at: new Date(
        Date.UTC(2026, 0, 1) + sequence * 60_000,
      ).toISOString(),
    };
  });
}

function seedDatabase(database, items) {
  const insert = database.prepare(
    `INSERT INTO published_items (id, target_type, target_id, title, summary, body, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const seed = database.transaction((rows) => {
    for (const item of rows) {
      insert.run(
        item.id,
        item.target_type,
        item.target_id,
        item.title,
        item.summary,
        item.body,
        item.published_at,
      );
    }
  });
  seed(items);
}

async function relativeFiles(directory) {
  const files = [];
  const visit = async (current, prefix) => {
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

async function startStaticServer(root, secretSegment) {
  const resolvedRoot = path.resolve(root);
  const server = createServer((request, response) => {
    const fail = () => {
      response.statusCode = 404;
      response.end("not found");
    };
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const prefix = `/${secretSegment}/`;
    if (!pathname.startsWith(prefix)) {
      fail();
      return;
    }
    const relative = pathname.slice(prefix.length);
    if (
      relative.length === 0 ||
      relative.includes("..") ||
      path.isAbsolute(relative)
    ) {
      fail();
      return;
    }
    const filePath = path.join(resolvedRoot, relative);
    if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      fail();
      return;
    }
    readFile(filePath)
      .then((bytes) => {
        response.statusCode = 200;
        response.end(bytes);
      })
      .catch(fail);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function validateStaticAccess(outputDirectory) {
  const secretSegment = `rss-${randomUUID()}`;
  const server = await startStaticServer(outputDirectory, secretSegment);
  try {
    const correct = await fetch(
      `${server.origin}/${secretSegment}/event-updates.xml`,
    );
    assert(correct.status === 200, "static correct key did not return 200");
    const wrong = await fetch(`${server.origin}/rss-wrong/event-updates.xml`);
    assert(wrong.status === 404, "static wrong key did not return 404");
  } finally {
    await server.close();
  }
}

async function runGroup(
  context,
  label,
  eventCount,
  curatedCount,
  expectedPending,
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), `pis-rss-smoke-${label}-`),
  );
  const databasePath = path.join(directory, "smoke.sqlite");
  const outputDirectory = path.join(directory, "feeds", "output");
  const database = context.openDatabase(databasePath);

  try {
    context.initializeDatabase(database);
    seedDatabase(database, buildItems(eventCount, "EVENT", "smoke-event"));
    seedDatabase(
      database,
      buildItems(curatedCount, "KNOWLEDGE", "smoke-knowledge"),
    );

    const reader = context.createPublishedItemSource(
      new context.SqlitePublishedItemRepository(database),
    );
    const service = context.createLocalRssSync({ reader, outputDirectory });
    const changesBefore = database.total_changes;
    const results = await service.syncAll();
    assert(
      database.total_changes === changesBefore,
      "RSS sync increased the database write counter",
    );
    assert(
      results.map((result) => result.feed).join(",") ===
        "EVENT_UPDATES,CURATED_CONTENT",
      "syncAll did not run both feeds in canonical order",
    );

    const files = await relativeFiles(outputDirectory);
    assert(
      files.every((file) => file.endsWith(".xml")),
      "output tree contains a non-XML file",
    );

    const feeds = [];
    for (const feed of [
      context.RSS_FEEDS.EVENT_UPDATES,
      context.RSS_FEEDS.CURATED_CONTENT,
    ]) {
      const headKey = feed.headKey;
      const pendingKey = feed.pendingKey;
      const archiveKey = `archive/${feed.archiveFilePrefix}-0001.xml`;
      for (const key of [headKey, pendingKey, archiveKey]) {
        assert(files.includes(key), `missing expected artifact ${key}`);
      }

      const headBytes = await readFile(path.join(outputDirectory, headKey));
      const pendingBytes = await readFile(
        path.join(outputDirectory, pendingKey),
      );
      const archiveBytes = await readFile(
        path.join(outputDirectory, archiveKey),
      );
      for (const bytes of [headBytes, pendingBytes, archiveBytes]) {
        assert(
          XMLValidator.validate(decode(bytes)) === true,
          "generated XML failed validation",
        );
      }

      const headText = decode(headBytes);
      const pendingText = decode(pendingBytes);
      const archiveText = decode(archiveBytes);
      assert(!headText.includes("<fh:archive/>"), "head contains a marker");
      assert(
        pendingText.includes("<fh:archive/>"),
        "pending is missing the archive marker",
      );
      assert(
        archiveText.includes("<fh:archive/>"),
        "sealed archive is missing the archive marker",
      );

      const headDoc = context.parseRssArchiveDocument(
        feed,
        headKey,
        headBytes,
        { batchSize: 200 },
      );
      const pendingDoc = context.parseRssArchiveDocument(
        feed,
        pendingKey,
        pendingBytes,
        { batchSize: 200 },
      );
      const archiveDoc = context.parseRssArchiveDocument(
        feed,
        archiveKey,
        archiveBytes,
        { batchSize: 200 },
      );
      assert(
        headDoc.previousArchiveKey === pendingKey,
        "head chain does not point to pending",
      );
      assert(
        pendingDoc.previousArchiveKey === archiveKey,
        "pending chain does not point to archive0001",
      );
      assert(
        archiveDoc.previousArchiveKey === null,
        "first archive has an unexpected previous link",
      );
      assert(headDoc.items.length === 200, "head did not contain 200 items");
      assert(
        archiveDoc.items.length === 200,
        "archive did not contain 200 items",
      );
      assert(
        pendingDoc.items.length === expectedPending,
        `pending item count mismatch for ${feed.kind}`,
      );

      feeds.push({
        feed: feed.kind,
        headKey,
        pendingKey,
        archiveKey,
        pendingGuidCount: pendingDoc.items.length,
        headHash: sha256(headBytes),
        pendingHash: sha256(pendingBytes),
        archiveHash: sha256(archiveBytes),
      });
    }

    await validateStaticAccess(outputDirectory);

    return { label, feeds };
  } finally {
    if (database.open) {
      database.close();
    }
    await rm(directory, { force: true, recursive: true });
  }
}

try {
  const [
    { openDatabase },
    { initializeDatabase },
    { SqlitePublishedItemRepository },
    rss,
  ] = await Promise.all([
    loadCompiled("dist/database/open-database.js"),
    loadCompiled("dist/database/schema.js"),
    loadCompiled("dist/publication/published-item-repository.js"),
    loadCompiled("dist/rss/index.js"),
  ]);

  const context = {
    openDatabase,
    initializeDatabase,
    SqlitePublishedItemRepository,
    RSS_FEEDS: rss.RSS_FEEDS,
    createLocalRssSync: rss.createLocalRssSync,
    createPublishedItemSource: rss.createPublishedItemSource,
    parseRssArchiveDocument: rss.parseRssArchiveDocument,
  };

  const defaultBefore = existsSync(DEFAULT_DATABASE);
  const groupOne = await runGroup(context, "group1", 201, 201, 1);
  const groupTwo = await runGroup(context, "group2", 200, 200, 0);
  assert(
    existsSync(DEFAULT_DATABASE) === defaultBefore,
    "default database state changed during smoke",
  );

  console.log("RSS smoke summary:");
  console.log(JSON.stringify({ groupOne, groupTwo }, null, 2));
  console.log("RSS smoke verification passed.");
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
