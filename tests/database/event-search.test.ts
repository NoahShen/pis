import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  rebuildEventSearch,
  refreshEventSearch,
} from "../../src/database/event-search.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { withTransaction } from "../../src/database/transaction.js";
import { withDatabasePath, closeDatabase } from "../fixtures/database.js";
import { createFaultyDatabase } from "../fixtures/faulty-database.js";

const EVENT_A = "event-a";
const EVENT_B = "event-b";
const CONTENT_A = "content-alias-a";
const CONTENT_B = "content-alias-b";

const EVENT_A_TEXT = [
  "事件甲标题",
  "实体甲",
  "主题甲",
  "范围甲",
  "事件甲描述",
  "乙方别名",
  "甲",
  "甲方别名",
  "更新1标题",
  "旧线索甲乙丙",
  "更新2标题",
  "更新2描述",
  "更新3标题",
  "更新3描述",
  "更新4标题",
  "更新4描述",
  "更新5标题",
  "更新5描述",
  "更新6标题",
  "更新6描述",
  "更新7标题",
  "更新7描述",
  "更新8标题",
  "更新8描述",
  "更新9标题",
  "更新9描述",
  "更新10标题",
  "更新10描述",
  "更新11标题",
  "更新11描述",
  "更新12标题",
  "更新12描述",
].join("\n");

const EVENT_B_TEXT = [
  "事件乙标题",
  "实体",
  "主题乙",
  "范围乙",
  "  事件乙描述  ",
  "乙方专属别名",
  "更新乙标题",
  "更新乙描述",
].join("\n");

interface SearchRow {
  event_id: string;
  search_text: string;
}

interface CountRow {
  count: number;
}

function seedSearchEvents(db: Database.Database): void {
  const insertContent = db.prepare(
    `
      INSERT INTO contents (id, title, created_at, body, completeness)
      VALUES (?, ?, ?, ?, ?)
    `,
  );
  insertContent.run(
    CONTENT_A,
    "Alias Content A",
    "2026-11-15T08:00:00.000+08:00",
    "Alias content A",
    "FULL",
  );
  insertContent.run(
    CONTENT_B,
    "Alias Content B",
    "2026-11-15T08:01:00.000+08:00",
    "Alias content B",
    "FULL",
  );

  db.prepare(
    `
      INSERT INTO events (
        id, title, entity_name, subject, scope, description, occurred_at,
        discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    EVENT_A,
    "事件甲标题",
    "实体甲",
    "主题甲",
    "范围甲",
    "事件甲描述",
    null,
    "2026-11-15T09:00:00.000+08:00",
  );
  db.prepare(
    `
      INSERT INTO events (
        id, title, entity_name, subject, scope, description, occurred_at,
        discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    EVENT_B,
    "事件乙标题",
    "实体",
    "主题乙",
    "范围乙",
    "  事件乙描述  ",
    null,
    "2026-11-15T09:01:00.000+08:00",
  );

  const insertAlias = db.prepare(
    "INSERT INTO event_entity_aliases (event_id, alias, content_id) VALUES (?, ?, ?)",
  );
  insertAlias.run(EVENT_A, "乙方别名", CONTENT_A);
  insertAlias.run(EVENT_A, "甲", CONTENT_A);
  insertAlias.run(EVENT_A, "甲方别名", CONTENT_B);
  insertAlias.run(EVENT_B, "乙方专属别名", CONTENT_A);

  const insertUpdate = db.prepare(
    `
      INSERT INTO event_updates (
        id, event_id, title, description, occurred_at, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  );
  // Insert in reverse chronological order; 11 and 12 share a timestamp and
  // therefore require the id tie-break to retain the expected text order.
  for (let index = 12; index >= 1; index -= 1) {
    const description = index === 1 ? "旧线索甲乙丙" : `更新${index}描述`;
    const discoveredHour = index >= 11 ? 11 : index;
    insertUpdate.run(
      `event-a-update-${String(index).padStart(2, "0")}`,
      EVENT_A,
      `更新${index}标题`,
      description,
      null,
      `2026-11-15T${String(discoveredHour).padStart(2, "0")}:00:00.000+08:00`,
    );
  }
  insertUpdate.run(
    "event-b-update-01",
    EVENT_B,
    "更新乙标题",
    "更新乙描述",
    null,
    "2026-11-15T10:00:00.000+08:00",
  );
}

function searchRows(db: Database.Database): SearchRow[] {
  return db
    .prepare<[], SearchRow>(
      "SELECT event_id, search_text FROM event_search ORDER BY event_id COLLATE BINARY",
    )
    .all();
}

function rowCount(db: Database.Database): number {
  const row = db
    .prepare<[], CountRow>("SELECT count(*) AS count FROM event_search")
    .get();
  if (row === undefined) {
    throw new Error("Expected count query to return a row");
  }
  return row.count;
}

function eventSearchText(db: Database.Database, eventId: string): string[] {
  return db
    .prepare<[string], { search_text: string }>(
      "SELECT search_text FROM event_search WHERE event_id = ?",
    )
    .all(eventId)
    .map(({ search_text }) => search_text);
}

function businessSnapshot(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare<[], { name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'event_search_%'
          AND name <> 'event_search'
        ORDER BY name COLLATE BINARY
      `,
    )
    .all();

  return Object.fromEntries(
    tables.map(({ name }) => {
      const quotedName = `"${name.replaceAll('"', '""')}"`;
      const rows = db.prepare(`SELECT * FROM ${quotedName}`).all();
      return [
        name,
        rows
          .map((row) => JSON.stringify(row))
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      ];
    }),
  );
}

function initializeSearchDatabase(db: Database.Database): void {
  initializeDatabase(db);
  seedSearchEvents(db);
}

function seedExistingSearchRows(db: Database.Database): void {
  refreshEventSearch(db, EVENT_A);
  refreshEventSearch(db, EVENT_B);
}

function queryPlan(
  db: Database.Database,
  sql: string,
  parameter: string,
): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(parameter)
    .map((row) => String((row as { detail: unknown }).detail))
    .join("\n");
}

describe("event search", () => {
  it("refreshEventSearch writes exactly one deterministic row per event", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        refreshEventSearch(db, EVENT_A);
        refreshEventSearch(db, EVENT_A);
        refreshEventSearch(db, EVENT_B);

        expect(rowCount(db)).toBe(2);
        expect(eventSearchText(db, EVENT_A)).toEqual([EVENT_A_TEXT]);
        expect(eventSearchText(db, EVENT_B)).toEqual([EVENT_B_TEXT]);
        expect(searchRows(db).map(({ event_id }) => event_id)).toEqual([
          EVENT_A,
          EVENT_B,
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("event search includes confirmed aliases and all historical updates", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        refreshEventSearch(db, EVENT_A);

        const [text] = eventSearchText(db, EVENT_A);
        expect(text).toBe(EVENT_A_TEXT);
        expect(text?.split("\n")).toHaveLength(32);
        expect(text).toContain("乙方别名\n甲\n甲方别名\n更新1标题");
        expect(text).toContain(
          "更新10描述\n更新11标题\n更新11描述\n更新12标题\n更新12描述",
        );
        expect(EVENT_B_TEXT.split("\n")).toContain("  事件乙描述  ");
        expect(EVENT_B_TEXT).toContain("  事件乙描述  \n乙方专属别名");
        expect(text).not.toContain("未确认别名");
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("refreshEventSearch joins caller transaction and rolls back its savepoint", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        seedExistingSearchRows(db);

        withTransaction(db, () => {
          db.prepare("UPDATE events SET title = ? WHERE id = ?").run(
            "事务内提交标题",
            EVENT_A,
          );
          refreshEventSearch(db, EVENT_A);
        });

        expect(
          db.prepare("SELECT title FROM events WHERE id = ?").get(EVENT_A),
        ).toEqual({ title: "事务内提交标题" });
        expect(eventSearchText(db, EVENT_A)).toEqual([
          EVENT_A_TEXT.replace("事件甲标题", "事务内提交标题"),
        ]);

        const businessBeforeRollback = businessSnapshot(db);
        const searchBeforeRollback = searchRows(db);

        expect(() =>
          withTransaction(db, () => {
            db.prepare("UPDATE events SET description = ? WHERE id = ?").run(
              "事务回滚描述",
              EVENT_A,
            );
            refreshEventSearch(db, EVENT_A);
            throw new Error("caller transaction rollback");
          }),
        ).toThrow("caller transaction rollback");

        expect(businessSnapshot(db)).toEqual(businessBeforeRollback);
        expect(searchRows(db)).toEqual(searchBeforeRollback);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("event search finds a clue older than the ten most recent updates", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        refreshEventSearch(db, EVENT_A);

        expect(
          db
            .prepare(
              "SELECT event_id FROM event_search WHERE event_search MATCH ? ORDER BY event_id",
            )
            .all("旧线索甲乙"),
        ).toEqual([{ event_id: EVENT_A }]);
        expect(
          db
            .prepare(
              "SELECT event_id FROM event_search WHERE event_search MATCH ? ORDER BY event_id",
            )
            .all("更新12"),
        ).toEqual([{ event_id: EVENT_A }]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("refreshing one event leaves another event and business facts unchanged", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        seedExistingSearchRows(db);
        const eventBText = eventSearchText(db, EVENT_B);
        const beforeBusiness = businessSnapshot(db);

        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(EVENT_A, "人为重复旧索引");
        expect(eventSearchText(db, EVENT_A)).toHaveLength(2);

        refreshEventSearch(db, EVENT_A);

        expect(eventSearchText(db, EVENT_A)).toEqual([EVENT_A_TEXT]);
        expect(eventSearchText(db, EVENT_B)).toEqual(eventBText);
        expect(businessSnapshot(db)).toEqual(beforeBusiness);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("refreshEventSearch removes stale rows for an absent event without creating it", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const missingEventId = "event-missing";

      try {
        initializeSearchDatabase(db);
        seedExistingSearchRows(db);
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(missingEventId, "孤儿索引");
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(missingEventId, "孤儿索引第二条");
        const existingEvents = db
          .prepare("SELECT count(*) AS count FROM events")
          .get();

        refreshEventSearch(db, missingEventId);

        expect(eventSearchText(db, missingEventId)).toEqual([]);
        expect(
          db.prepare("SELECT count(*) AS count FROM events").get(),
        ).toEqual(existingEvents);
        expect(eventSearchText(db, EVENT_A)).toEqual([EVENT_A_TEXT]);
        expect(eventSearchText(db, EVENT_B)).toEqual([EVENT_B_TEXT]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("rebuildEventSearch converges duplicate and stale derived rows", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        seedExistingSearchRows(db);
        const businessBefore = businessSnapshot(db);

        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(EVENT_A, "过期索引");
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(EVENT_A, "另一条过期索引");
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run("event-missing", "孤儿索引");

        expect(rowCount(db)).toBe(5);
        rebuildEventSearch(db);

        expect(searchRows(db)).toEqual([
          { event_id: EVENT_A, search_text: EVENT_A_TEXT },
          { event_id: EVENT_B, search_text: EVENT_B_TEXT },
        ]);
        expect(businessSnapshot(db)).toEqual(businessBefore);
        expect(
          db
            .prepare(
              "SELECT count(*) AS count FROM event_search WHERE event_id = ?",
            )
            .get("event-missing"),
        ).toEqual({ count: 0 });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("rebuildEventSearch succeeds on an empty database", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        rebuildEventSearch(db);

        expect(rowCount(db)).toBe(0);
        expect(searchRows(db)).toEqual([]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("refresh and rebuild roll back FTS changes on injected insert failure", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        seedExistingSearchRows(db);
        const oldSearchRows = searchRows(db);
        const oldBusiness = businessSnapshot(db);

        const faultyRefreshDb = createFaultyDatabase(db, 1);
        expect(() => refreshEventSearch(faultyRefreshDb, EVENT_A)).toThrow(
          "injected event_search insert failure",
        );
        expect(searchRows(db)).toEqual(oldSearchRows);
        expect(businessSnapshot(db)).toEqual(oldBusiness);

        const faultyRebuildDb = createFaultyDatabase(db, 2);
        expect(() => rebuildEventSearch(faultyRebuildDb)).toThrow(
          "injected event_search insert failure",
        );
        expect(searchRows(db)).toEqual(oldSearchRows);
        expect(businessSnapshot(db)).toEqual(oldBusiness);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("short entity and alias terms use ordinary indexed exact lookup", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeSearchDatabase(db);
        refreshEventSearch(db, EVENT_A);

        expect(
          db
            .prepare("SELECT id FROM events WHERE entity_name = ? ORDER BY id")
            .all("实体"),
        ).toEqual([{ id: EVENT_B }]);
        expect(
          db
            .prepare(
              "SELECT event_id FROM event_entity_aliases WHERE alias = ? ORDER BY event_id",
            )
            .all("甲"),
        ).toEqual([{ event_id: EVENT_A }]);

        expect(
          queryPlan(db, "SELECT id FROM events WHERE entity_name = ?", "实体"),
        ).toContain("idx_events_entity_name");
        expect(
          queryPlan(
            db,
            "SELECT event_id FROM event_entity_aliases WHERE alias = ?",
            "甲",
          ),
        ).toContain("idx_event_entity_aliases_alias");
      } finally {
        closeDatabase(db);
      }
    });
  });
});
