import Database from "better-sqlite3";

const BUSY_TIMEOUT_MS = 5000;

function assertJournalMode(value: unknown): void {
  if (typeof value !== "string" || value.toLowerCase() !== "wal") {
    throw new Error(`Failed to enable SQLite WAL mode: ${String(value)}`);
  }
}

function assertPragmaNumber(
  name: string,
  value: unknown,
  expected: number,
): void {
  if (value !== expected) {
    throw new Error(
      `Failed to configure SQLite ${name}: expected ${expected}, received ${String(value)}`,
    );
  }
}

export function openDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);

  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

    const journalMode = db.pragma("journal_mode", { simple: true });
    assertJournalMode(journalMode);

    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    assertPragmaNumber("foreign_keys", foreignKeys, 1);

    const busyTimeout = db.pragma("busy_timeout", { simple: true });
    assertPragmaNumber("busy_timeout", busyTimeout, BUSY_TIMEOUT_MS);

    return db;
  } catch (error) {
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Preserve the configuration error that caused the connection to fail.
    }

    throw error;
  }
}
