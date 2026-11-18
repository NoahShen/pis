import type Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import {
  rebuildEventSearch,
  refreshEventSearch,
} from "../../src/database/event-search.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import {
  SqliteEventCandidateRepository,
  type EventCandidateClue,
  type EventCandidateHit,
  type EventCandidateSearchResult,
} from "../../src/event-search/event-candidate-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";

const OLD_TIME = "2016-01-10T08:00:00.000+08:00";
const RECENT_TIME = "2026-11-18T08:00:00.000+08:00";

interface EventSeed {
  readonly id: string;
  readonly title?: string;
  readonly entityName: string;
  readonly subject: string;
  readonly scope?: string;
  readonly description?: string;
  readonly discoveredAt?: string;
}

interface TableNameRow {
  readonly name: string;
}

interface SearchTextRow {
  readonly event_id: string;
  readonly search_text: string;
}

function insertContent(db: Database.Database, id: string): void {
  db.prepare(
    `
      INSERT INTO contents (id, title, created_at, body, completeness)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(id, `Synthetic content ${id}`, RECENT_TIME, "Synthetic body", "FULL");
}

function insertEvent(db: Database.Database, event: EventSeed): void {
  db.prepare(
    `
      INSERT INTO events (
        id, title, entity_name, subject, scope, description, occurred_at,
        discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    event.id,
    event.title ?? `${event.id} title`,
    event.entityName,
    event.subject,
    event.scope ?? "Synthetic scope",
    event.description ?? `${event.id} description`,
    null,
    event.discoveredAt ?? RECENT_TIME,
  );
}

function insertAlias(
  db: Database.Database,
  eventId: string,
  alias: string,
  contentId: string,
): void {
  insertContent(db, contentId);
  db.prepare(
    `
      INSERT INTO event_entity_aliases (event_id, alias, content_id)
      VALUES (?, ?, ?)
    `,
  ).run(eventId, alias, contentId);
}

function insertUpdate(
  db: Database.Database,
  id: string,
  eventId: string,
  title: string,
  description: string,
  discoveredAt: string,
): void {
  db.prepare(
    `
      INSERT INTO event_updates (
        id, event_id, title, description, occurred_at, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(id, eventId, title, description, null, discoveredAt);
}

function seedDatabase(db: Database.Database): void {
  initializeDatabase(db);
}

function hitFor(
  result: EventCandidateSearchResult,
  eventId: string,
): EventCandidateHit {
  const hit = result.hits.find((candidate) => candidate.eventId === eventId);
  if (hit === undefined) {
    throw new Error(`Expected candidate ${eventId}`);
  }
  return hit;
}

function snapshotDatabase(
  db: Database.Database,
): Readonly<Record<string, readonly string[]>> {
  const tables = db
    .prepare<[], TableNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'event_search_%'
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

function queryPlan(
  db: Database.Database,
  sql: string,
  parameter: string,
): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(parameter)
    .map((row) => String((row as { readonly detail: unknown }).detail))
    .join("\n");
}

describe("SqliteEventCandidateRepository", () => {
  it("EVT-06 / CLUE_IDENTITY keeps per-subject clue indexes and FTS evidence", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "shared-entity-a",
          entityName: "共享实体",
          subject: "主题甲",
        });
        insertEvent(db, {
          id: "shared-entity-b",
          entityName: "共享实体",
          subject: "主题乙",
        });
        refreshEventSearch(db, "shared-entity-a");
        refreshEventSearch(db, "shared-entity-b");

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "共享实体",
            subject: "主题甲",
            search_terms: [],
          },
          {
            entity_name: "共享实体",
            subject: "主题乙",
            search_terms: [],
          },
        ]);

        expect(result.hits).toHaveLength(2);
        expect(result.ignoredIndexRows).toBe(0);
        expect(hitFor(result, "shared-entity-a").clueEvidence).toEqual([
          {
            clueIndex: 0,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: ["共享实体", "主题甲"],
          },
          {
            clueIndex: 1,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: ["共享实体"],
          },
        ]);
        expect(hitFor(result, "shared-entity-b").clueEvidence).toEqual([
          {
            clueIndex: 0,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: ["共享实体"],
          },
          {
            clueIndex: 1,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: ["共享实体", "主题乙"],
          },
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("EVT-10 / THREE_ROUTES recalls ten-year-old Events by standard name, alias, and FTS", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "old-standard",
          entityName: "标准实体旧",
          subject: "旧主题一",
          discoveredAt: OLD_TIME,
        });
        insertEvent(db, {
          id: "old-alias",
          entityName: "别名实体旧",
          subject: "旧主题二",
          discoveredAt: OLD_TIME,
        });
        insertAlias(db, "old-alias", "确认别名旧", "old-alias-content");
        insertEvent(db, {
          id: "old-fts",
          entityName: "仅索引实体旧",
          subject: "FTS唯一线索",
          discoveredAt: OLD_TIME,
        });
        rebuildEventSearch(db);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "标准实体旧",
            subject: "无匹配主题一",
            search_terms: [],
          },
          {
            entity_name: "确认别名旧",
            subject: "无匹配主题二",
            search_terms: [],
          },
          {
            entity_name: "无匹配实体三",
            subject: "FTS唯一线索",
            search_terms: [],
          },
        ]);

        expect(result.hits).toHaveLength(3);
        expect(result.ignoredIndexRows).toBe(0);
        const standardHit = hitFor(result, "old-standard");
        const aliasHit = hitFor(result, "old-alias");
        const ftsHit = hitFor(result, "old-fts");

        expect(standardHit.discoveredAt).toBe(OLD_TIME);
        expect(standardHit.clueEvidence).toEqual([
          {
            clueIndex: 0,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: ["标准实体旧"],
          },
        ]);
        expect(aliasHit.discoveredAt).toBe(OLD_TIME);
        expect(aliasHit.clueEvidence).toEqual([
          {
            clueIndex: 1,
            directEntityHit: false,
            aliasHit: true,
            ftsMatchedTerms: ["确认别名旧"],
          },
        ]);
        expect(ftsHit.discoveredAt).toBe(OLD_TIME);
        expect(ftsHit.clueEvidence).toEqual([
          {
            clueIndex: 2,
            directEntityHit: false,
            aliasHit: false,
            ftsMatchedTerms: ["FTS唯一线索"],
          },
        ]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("EVT-22 / EMPTY returns a successful empty result for legal clues without matches", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "unrelated-event",
          entityName: "无关实体",
          subject: "无关主题",
        });
        refreshEventSearch(db, "unrelated-event");
        const before = snapshotDatabase(db);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "没有候选的实体",
            subject: "没有候选的主题",
            search_terms: ["没有候选的检索词"],
          },
        ]);

        expect(result).toEqual({ hits: [], ignoredIndexRows: 0 });
        expect(snapshotDatabase(db)).toEqual(before);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("EVT-23 / OLD_UPDATE uses the first historical Update and applies no recall limit", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "old-update-event",
          entityName: "旧更新事件实体",
          subject: "旧更新事件主题",
          discoveredAt: OLD_TIME,
        });
        for (let index = 12; index >= 1; index -= 1) {
          insertUpdate(
            db,
            `old-update-${String(index).padStart(2, "0")}`,
            "old-update-event",
            `历史更新 ${index}`,
            index === 1 ? "历史深线索" : `普通更新描述 ${index}`,
            `2016-01-${String(index).padStart(2, "0")}T08:00:00.000+08:00`,
          );
        }

        for (let index = 1; index <= 11; index += 1) {
          insertEvent(db, {
            id: `matching-event-${String(index).padStart(2, "0")}`,
            entityName: `匹配实体 ${index}`,
            subject: "历史深线索",
            discoveredAt: RECENT_TIME,
          });
        }
        rebuildEventSearch(db);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "线索实体不存在",
            subject: "线索主题不存在",
            search_terms: ["历史深线索"],
          },
        ]);

        expect(result.hits).toHaveLength(12);
        expect(hitFor(result, "old-update-event").clueEvidence).toEqual([
          {
            clueIndex: 0,
            directEntityHit: false,
            aliasHit: false,
            ftsMatchedTerms: ["历史深线索"],
          },
        ]);
        expect(
          db.prepare("SELECT count(*) AS count FROM event_updates").get(),
        ).toEqual({ count: 12 });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("EVT-24 / SAME_ALIAS keeps two Events with identical alias text independent", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "same-alias-a",
          entityName: "实体甲",
          subject: "主题甲",
          discoveredAt: "2026-11-18T08:00:00.000+08:00",
        });
        insertEvent(db, {
          id: "same-alias-b",
          entityName: "实体乙",
          subject: "主题乙",
          discoveredAt: "2026-11-18T09:00:00.000+08:00",
        });
        insertAlias(db, "same-alias-a", "共同别名", "same-alias-content-a");
        insertAlias(db, "same-alias-b", "共同别名", "same-alias-content-b");
        rebuildEventSearch(db);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "共同别名",
            subject: "无匹配主题",
            search_terms: [],
          },
        ]);

        expect(result.hits).toHaveLength(2);
        expect(hitFor(result, "same-alias-a")).toMatchObject({
          discoveredAt: "2026-11-18T08:00:00.000+08:00",
          clueEvidence: [
            {
              clueIndex: 0,
              directEntityHit: false,
              aliasHit: true,
              ftsMatchedTerms: ["共同别名"],
            },
          ],
        });
        expect(hitFor(result, "same-alias-b")).toMatchObject({
          discoveredAt: "2026-11-18T09:00:00.000+08:00",
          clueEvidence: [
            {
              clueIndex: 0,
              directEntityHit: false,
              aliasHit: true,
              ftsMatchedTerms: ["共同别名"],
            },
          ],
        });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("DEDUPE merges routes, terms, clues, and duplicate index rows by Event ID", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "dedupe-event",
          entityName: "去重实体",
          subject: "去重主题",
          description: "去重检索词",
        });
        insertAlias(db, "dedupe-event", "去重实体", "dedupe-content-a");
        insertAlias(db, "dedupe-event", "去重别名", "dedupe-content-b");
        refreshEventSearch(db, "dedupe-event");
        const searchRow = db
          .prepare<[string], SearchTextRow>(
            "SELECT event_id, search_text FROM event_search WHERE event_id = ?",
          )
          .get("dedupe-event");
        if (searchRow === undefined) {
          throw new Error("Expected an Event search row");
        }
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run(searchRow.event_id, searchRow.search_text);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "去重实体",
            subject: "去重主题",
            search_terms: ["去重检索词", "去重检索词", "   "],
          },
          {
            entity_name: "去重别名",
            subject: "去重主题",
            search_terms: ["去重检索词"],
          },
        ]);

        expect(result.hits).toHaveLength(1);
        expect(result.ignoredIndexRows).toBe(0);
        expect(hitFor(result, "dedupe-event")).toMatchObject({
          firstClueIndex: 0,
          clueEvidence: [
            {
              clueIndex: 0,
              directEntityHit: true,
              aliasHit: true,
              ftsMatchedTerms: ["去重实体", "去重主题", "去重检索词"],
            },
            {
              clueIndex: 1,
              directEntityHit: false,
              aliasHit: true,
              ftsMatchedTerms: ["去重别名", "去重主题", "去重检索词"],
            },
          ],
        });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("FTS_LITERAL / PARAMETERS / READ_ONLY binds hostile text and leaves all tables unchanged", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "literal-event",
          entityName: "普通实体",
          subject: "普通主题",
          description: [
            '双"引号线索',
            "括号(测试)",
            "冒号:值",
            "星号*",
            "NEAR",
            "' OR 1=1 --",
            '"alpha" OR beta* NEAR(gamma) subject:value',
          ].join(" "),
        });
        insertAlias(db, "literal-event", "普通别名", "literal-content");
        insertUpdate(
          db,
          "literal-update",
          "literal-event",
          "普通更新",
          "普通更新正文",
          RECENT_TIME,
        );
        rebuildEventSearch(db);
        const before = snapshotDatabase(db);
        const repository = new SqliteEventCandidateRepository(db);
        const literalTerms = [
          '双"引号线索',
          "括号(测试)",
          "冒号:值",
          "星号*",
          "NEAR",
          "' OR 1=1 --",
          '"alpha" OR beta* NEAR(gamma) subject:value',
        ];

        for (const literal of literalTerms) {
          const clue: EventCandidateClue = {
            entity_name: "绝对不存在实体",
            subject: "绝对不存在主题",
            search_terms: [literal, "   "],
          };
          const result = repository.search([clue]);
          expect(hitFor(result, "literal-event").clueEvidence).toEqual([
            {
              clueIndex: 0,
              directEntityHit: false,
              aliasHit: false,
              ftsMatchedTerms: [literal],
            },
          ]);
        }

        expect(snapshotDatabase(db)).toEqual(before);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        closeDatabase(db);
      }
    });
  });

  it("SHORT_TERM uses indexed BINARY entity and alias lookup instead of trigram recall", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "short-entity",
          entityName: "短",
          subject: "普通主题甲",
        });
        insertEvent(db, {
          id: "short-alias",
          entityName: "普通实体乙",
          subject: "普通主题乙",
        });
        insertAlias(db, "short-alias", "小别", "short-alias-content");
        rebuildEventSearch(db);

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "短",
            subject: "无匹配主题一",
            search_terms: [],
          },
          {
            entity_name: "小别",
            subject: "无匹配主题二",
            search_terms: [],
          },
        ]);

        expect(hitFor(result, "short-entity").clueEvidence).toEqual([
          {
            clueIndex: 0,
            directEntityHit: true,
            aliasHit: false,
            ftsMatchedTerms: [],
          },
        ]);
        expect(hitFor(result, "short-alias").clueEvidence).toEqual([
          {
            clueIndex: 1,
            directEntityHit: false,
            aliasHit: true,
            ftsMatchedTerms: [],
          },
        ]);

        expect(
          queryPlan(
            db,
            "SELECT id FROM events WHERE entity_name = ? COLLATE BINARY",
            "短",
          ),
        ).toContain("idx_events_entity_name");
        expect(
          queryPlan(
            db,
            "SELECT event_id FROM event_entity_aliases WHERE alias = ? COLLATE BINARY",
            "小别",
          ),
        ).toContain("idx_event_entity_aliases_alias");
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("ORPHAN counts unmatched FTS rows without creating candidates", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        insertEvent(db, {
          id: "real-event",
          entityName: "真实实体",
          subject: "真实主题",
        });
        refreshEventSearch(db, "real-event");
        db.prepare(
          "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)",
        ).run("missing-event", "孤儿召回线索");
        const existingEvents = db
          .prepare("SELECT count(*) AS count FROM events")
          .get();

        const result = new SqliteEventCandidateRepository(db).search([
          {
            entity_name: "无匹配实体",
            subject: "无匹配主题",
            search_terms: ["孤儿召回线索", "孤儿召回线索"],
          },
        ]);

        expect(result).toEqual({ hits: [], ignoredIndexRows: 1 });
        expect(
          db.prepare("SELECT count(*) AS count FROM events").get(),
        ).toEqual(existingEvents);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("EMPTY_CLUES returns immediately without preparing or executing SQL", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);
      const prepareSpy = vi.spyOn(db, "prepare");

      try {
        seedDatabase(db);
        const repository = new SqliteEventCandidateRepository(db);

        expect(repository.search([])).toEqual({
          hits: [],
          ignoredIndexRows: 0,
        });
        expect(prepareSpy).not.toHaveBeenCalled();
      } finally {
        prepareSpy.mockRestore();
        closeDatabase(db);
      }
    });
  });

  it("ERROR propagates database failures without swallowing them", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        seedDatabase(db);
        const repository = new SqliteEventCandidateRepository(db);
        db.close();

        expect(() =>
          repository.search([
            {
              entity_name: "失败实体",
              subject: "失败主题",
              search_terms: [],
            },
          ]),
        ).toThrow();
      } finally {
        closeDatabase(db);
      }
    });
  });
});
