import type Database from "better-sqlite3";
import path from "node:path";

import { withTempDirectory } from "./temp-directory.js";

export async function withDatabasePath<T>(
  callback: (databasePath: string) => T | Promise<T>,
): Promise<T> {
  return withTempDirectory((directory) =>
    callback(path.join(directory, "database.sqlite")),
  );
}

export function closeDatabase(db: Database.Database): void {
  if (db.open) {
    db.close();
  }
}
