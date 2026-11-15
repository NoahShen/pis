import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const expectedTables = [
  "contents",
  "event_content_links",
  "event_entity_aliases",
  "event_search",
  "event_updates",
  "events",
  "knowledge",
  "published_items",
  "source_items",
  "sources",
  "topic_associations",
  "topics",
];
const expectedIndexes = [
  "idx_event_content_links_content",
  "idx_event_entity_aliases_alias",
  "idx_event_updates_history",
  "idx_events_entity_name",
  "idx_published_items_feed",
  "idx_published_items_latest",
  "idx_source_items_ext",
  "idx_source_items_url_pub",
  "idx_topic_associations_history",
  "idx_topic_associations_target",
  "uq_source_items_content",
];
const originalCwd = process.cwd();
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), "pis-database-smoke-"),
);
const databasePath = path.join(temporaryDirectory, "smoke.sqlite");
let db;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Database smoke verification failed: ${message}`);
  }
}

async function removeDatabaseFiles() {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
}

try {
  process.chdir(temporaryDirectory);

  const { openDatabase } = await import(
    pathToFileURL(path.join(projectRoot, "dist/database/open-database.js")).href
  );
  const { initializeDatabase } = await import(
    pathToFileURL(path.join(projectRoot, "dist/database/schema.js")).href
  );

  const sourceSchema = await readFile(
    path.join(projectRoot, "src/database/schema.sql"),
  );
  const compiledSchema = await readFile(
    path.join(projectRoot, "dist/database/schema.sql"),
  );
  assert(
    sourceSchema.equals(compiledSchema),
    "src/database/schema.sql and dist/database/schema.sql differ",
  );
  console.log("database smoke verifies copied schema bytes");

  db = openDatabase(databasePath);
  initializeDatabase(db);

  const tables = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'event_search_%'
        ORDER BY name
      `,
    )
    .all()
    .map((row) => row.name);
  assert(
    JSON.stringify(tables) === JSON.stringify(expectedTables),
    `unexpected initialized tables: ${JSON.stringify(tables)}`,
  );

  const indexes = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name NOT LIKE 'sqlite_autoindex_%'
        ORDER BY name
      `,
    )
    .all()
    .map((row) => row.name);
  assert(
    JSON.stringify(indexes) === JSON.stringify(expectedIndexes),
    `unexpected initialized indexes: ${JSON.stringify(indexes)}`,
  );

  const invalidForeignKeys = db.pragma("foreign_key_check");
  assert(
    invalidForeignKeys.length === 0,
    "foreign key check found invalid rows",
  );

  const jsonResult = db
    .prepare("SELECT json_valid(?) AS valid, json_type(?, '$') AS kind")
    .get('["event"]', '["event"]');
  assert(
    jsonResult?.valid === 1 && jsonResult?.kind === "array",
    "JSON array functions are unavailable",
  );

  db.prepare(
    "INSERT INTO event_search(event_id, search_text) VALUES (?, ?)",
  ).run("smoke-event", "中华人民共和国");
  const searchHits = db
    .prepare(
      "SELECT event_id FROM event_search WHERE event_search MATCH ? ORDER BY event_id",
    )
    .all("中华人");
  assert(
    searchHits.length === 1 && searchHits[0]?.event_id === "smoke-event",
    "trigram FTS5 search did not initialize correctly",
  );

  console.log(
    "database smoke initializes compiled database modules and the exact schema",
  );
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
} finally {
  try {
    if (db?.open) {
      db.close();
    }
  } finally {
    await removeDatabaseFiles();
    await rm(temporaryDirectory, { recursive: true, force: true });
    process.chdir(originalCwd);
  }
}
