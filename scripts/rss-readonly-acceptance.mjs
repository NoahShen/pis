import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { XMLValidator } from "fast-xml-parser";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function fail(message) {
  throw new Error(`RSS read-only acceptance failed: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function parseDatabaseArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") {
      return argv[index + 1];
    }
    if (argument.startsWith("--database=")) {
      return argument.slice("--database=".length);
    }
  }
  return undefined;
}

async function hashDatabaseFiles(databasePath) {
  const labels = new Map();
  labels.set(databasePath, "main");
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${databasePath}${suffix}`)) {
      labels.set(`${databasePath}${suffix}`, suffix.slice(1));
    }
  }

  const recorded = {};
  for (const [file, label] of labels) {
    recorded[label] = sha256(await readFile(file));
  }
  return recorded;
}

async function loadCompiled(relativePath) {
  return import(pathToFileURL(path.join(projectRoot, relativePath)).href);
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
    const failResponse = () => {
      response.statusCode = 404;
      response.end("not found");
    };
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const prefix = `/${secretSegment}/`;
    if (!pathname.startsWith(prefix)) {
      failResponse();
      return;
    }
    const relative = pathname.slice(prefix.length);
    if (
      relative.length === 0 ||
      relative.includes("..") ||
      path.isAbsolute(relative)
    ) {
      failResponse();
      return;
    }
    const filePath = path.join(resolvedRoot, relative);
    if (!filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      failResponse();
      return;
    }
    readFile(filePath)
      .then((bytes) => {
        response.statusCode = 200;
        response.end(bytes);
      })
      .catch(failResponse);
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

async function main() {
  const databasePath = parseDatabaseArg(process.argv);
  if (typeof databasePath !== "string" || databasePath.trim().length === 0) {
    fail("a --database <path> argument is required");
  }
  if (!existsSync(databasePath)) {
    fail("the requested database file does not exist");
  }

  const preHashes = await hashDatabaseFiles(databasePath);

  const [{ SqlitePublishedItemRepository }, rss] = await Promise.all([
    loadCompiled("dist/publication/published-item-repository.js"),
    loadCompiled("dist/rss/index.js"),
  ]);

  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });

  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "pis-rss-readonly-"),
  );

  try {
    database.pragma("query_only = ON");

    const eventCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM published_items
         WHERE target_type IN ('EVENT', 'EVENT_UPDATE')`,
      )
      .get().count;
    const curatedCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM published_items
         WHERE target_type = 'KNOWLEDGE'`,
      )
      .get().count;

    const reader = rss.createPublishedItemSource(
      new SqlitePublishedItemRepository(database),
    );
    const service = rss.createLocalRssSync({ reader, outputDirectory });
    const results = await service.syncAll();

    const files = await relativeFiles(outputDirectory);
    if (!files.every((file) => file.endsWith(".xml"))) {
      fail("the output tree contains a non-XML file");
    }

    const feeds = [];
    let xmlParse = "ok";
    for (const feed of [
      rss.RSS_FEEDS.EVENT_UPDATES,
      rss.RSS_FEEDS.CURATED_CONTENT,
    ]) {
      const headKey = feed.headKey;
      const pendingKey = feed.pendingKey;
      const archiveKeys = files.filter((file) =>
        file.startsWith(`archive/${feed.archiveFilePrefix}-`),
      );
      if (!files.includes(headKey) || !files.includes(pendingKey)) {
        fail(`missing head or pending artifact for ${feed.kind}`);
      }

      const headBytes = await readFile(path.join(outputDirectory, headKey));
      const pendingBytes = await readFile(
        path.join(outputDirectory, pendingKey),
      );
      const pendingDocument = rss.parseRssArchiveDocument(
        feed,
        pendingKey,
        pendingBytes,
        { batchSize: 200 },
      );

      const archiveFiles = [];
      for (const key of archiveKeys) {
        const bytes = await readFile(path.join(outputDirectory, key));
        archiveFiles.push({ key, bytes, hash: sha256(bytes) });
      }

      for (const bytes of [
        headBytes,
        pendingBytes,
        ...archiveFiles.map((archive) => archive.bytes),
      ]) {
        if (XMLValidator.validate(decode(bytes)) !== true) {
          xmlParse = "invalid";
        }
      }

      const archives = archiveFiles.map((archive) => ({
        key: archive.key,
        hash: archive.hash,
      }));

      feeds.push({
        feed: feed.kind,
        count: feed.kind === "EVENT_UPDATES" ? eventCount : curatedCount,
        head: { key: headKey, hash: sha256(headBytes) },
        pending: {
          key: pendingKey,
          hash: sha256(pendingBytes),
          guidCount: pendingDocument.items.length,
        },
        archives,
        chain: {
          headToPending: pendingKey,
          pendingToLatestArchive:
            archiveKeys.length > 0 ? archiveKeys[archiveKeys.length - 1] : null,
        },
      });
    }

    const secretSegment = `rss-${randomUUID()}`;
    const server = await startStaticServer(outputDirectory, secretSegment);
    let staticRead = "ok";
    try {
      const response = await fetch(
        `${server.origin}/${secretSegment}/${rss.RSS_FEEDS.EVENT_UPDATES.headKey}`,
      );
      if (response.status !== 200) {
        staticRead = "failed";
      }
    } finally {
      await server.close();
    }

    const postHashes = await hashDatabaseFiles(databasePath);
    if (JSON.stringify(preHashes) !== JSON.stringify(postHashes)) {
      fail("the database files changed during the read-only run");
    }

    return {
      database: {
        pre: preHashes,
        post: postHashes,
        unchanged: true,
      },
      feeds,
      xmlParse,
      staticRead,
      results: results.map((result) => ({
        feed: result.feed,
        pendingGuidCount: result.pendingGuidCount,
        createdArchiveKeys: result.createdArchiveKeys,
      })),
    };
  } finally {
    if (database.open) {
      database.close();
    }
    await rm(outputDirectory, { force: true, recursive: true });
  }
}

try {
  const summary = await main();
  console.log(JSON.stringify(summary, null, 2));
  console.log("RSS read-only acceptance passed.");
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
