import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const connectionPragmas = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA foreign_keys = ON;",
  "PRAGMA busy_timeout = 5000;",
] as const;
const connectionPragmaPattern =
  /^PRAGMA (?:journal_mode = WAL|foreign_keys = ON|busy_timeout = \d+);$/gm;

export function initializeDatabase(db: Database.Database): void {
  const schemaSql = readFileSync(schemaPath, "utf8");
  for (const pragma of connectionPragmas) {
    if (!schemaSql.includes(`${pragma}\n`)) {
      throw new Error(`Database schema is missing required pragma: ${pragma}`);
    }
  }

  db.exec(connectionPragmas.join("\n"));
  const ddlSql = schemaSql.replace(connectionPragmaPattern, "").trimStart();
  const initialize = db.transaction(() => {
    db.exec(ddlSql);
  });

  initialize();
}
