import type Database from "better-sqlite3";

import { withTransaction } from "./transaction.js";

interface EventSearchSource {
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
}

interface AliasRow {
  alias: string;
}

interface EventUpdateRow {
  title: string;
  description: string;
}

interface EventIdRow {
  id: string;
}

function aggregateEventSearchText(
  db: Database.Database,
  eventId: string,
): string | undefined {
  const event = db
    .prepare<[string], EventSearchSource>(
      `
        SELECT title, entity_name, subject, scope, description
        FROM events
        WHERE id = ?
      `,
    )
    .get(eventId);

  if (event === undefined) {
    return undefined;
  }

  const aliases = db
    .prepare<[string], AliasRow>(
      `
        SELECT alias
        FROM event_entity_aliases
        WHERE event_id = ?
        ORDER BY alias COLLATE BINARY ASC
      `,
    )
    .all(eventId);

  const updates = db
    .prepare<[string], EventUpdateRow>(
      `
        SELECT title, description
        FROM event_updates
        WHERE event_id = ?
        ORDER BY discovered_at ASC, id COLLATE BINARY ASC
      `,
    )
    .all(eventId);

  const textParts = [
    event.title,
    event.entity_name,
    event.subject,
    event.scope,
    event.description,
    ...aliases.map(({ alias }) => alias),
  ];

  for (const update of updates) {
    textParts.push(update.title, update.description);
  }

  return textParts.join("\n");
}

function replaceEventSearchRow(db: Database.Database, eventId: string): void {
  db.prepare<[string]>("DELETE FROM event_search WHERE event_id = ?").run(
    eventId,
  );

  const searchText = aggregateEventSearchText(db, eventId);
  if (searchText === undefined) {
    return;
  }

  db.prepare<[string, string]>(
    "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
  ).run(eventId, searchText);
}

export function refreshEventSearch(
  db: Database.Database,
  eventId: string,
): void {
  withTransaction(db, () => {
    replaceEventSearchRow(db, eventId);
  });
}

export function rebuildEventSearch(db: Database.Database): void {
  withTransaction(db, () => {
    db.prepare("DELETE FROM event_search").run();

    const eventIds = db
      .prepare<[], EventIdRow>(
        "SELECT id FROM events ORDER BY id COLLATE BINARY ASC",
      )
      .all();

    for (const { id } of eventIds) {
      replaceEventSearchRow(db, id);
    }
  });
}
