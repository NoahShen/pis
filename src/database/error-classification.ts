export type SqliteErrorCategory =
  "busy_locked" | "constraint" | "sqlite" | "unknown";

function stableSqliteCode(error: unknown): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

export function classifySqliteError(error: unknown): SqliteErrorCategory {
  const code = stableSqliteCode(error);

  if (code === undefined) {
    return "unknown";
  }

  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return "busy_locked";
  }

  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return "constraint";
  }

  if (code.startsWith("SQLITE_")) {
    return "sqlite";
  }

  return "unknown";
}
