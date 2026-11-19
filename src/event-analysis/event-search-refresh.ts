import type Database from "better-sqlite3";

import { refreshEventSearch } from "../database/event-search.js";

function compareEventIdsBinary(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function refreshAffectedEvents(
  database: Database.Database,
  eventIds: readonly string[],
): void {
  if (!database.inTransaction) {
    throw new Error("refreshAffectedEvents requires an active transaction");
  }

  const orderedEventIds = [...new Set(eventIds)].sort(compareEventIdsBinary);
  for (const eventId of orderedEventIds) {
    refreshEventSearch(database, eventId);
  }
}
