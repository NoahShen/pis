import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
  type SourceItemRecord,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_A = "source-a";
const SOURCE_B = "source-b";

function insertSources(db: Database.Database): void {
  const insertSource = db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
  );

  insertSource.run(
    SOURCE_A,
    "Source A",
    "RSS",
    "https://fixture.example/source-a.xml",
    "0 * * * *",
    1,
    null,
  );
  insertSource.run(
    SOURCE_B,
    "Source B",
    "RSS",
    "https://fixture.example/source-b.xml",
    "0 * * * *",
    1,
    null,
  );
}

function createDraft(
  overrides: Partial<SourceItemDraft> = {},
): SourceItemDraft {
  return {
    source_id: SOURCE_A,
    external_id: null,
    url: "https://fixture.example/item",
    title: "Fixture item",
    published_at: "2026-11-17T09:00:00.000+08:00",
    discovered_at: "2026-11-17T10:00:00.000+08:00",
    content_id: null,
    raw_data: '{"schema_version":1,"body":"fixture"}',
    ...overrides,
  };
}

function readSourceItem(
  db: Database.Database,
  id: string,
): SourceItemRecord | undefined {
  return db
    .prepare(
      `
        SELECT
          id, source_id, external_id, url, title, published_at, discovered_at,
          content_id, raw_data
        FROM source_items
        WHERE id = ?
      `,
    )
    .get(id) as SourceItemRecord | undefined;
}

describe("SqliteSourceItemRepository", () => {
  it("COL-02/COL-05 scopes external_id existence checks to one Source", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSources(db);
        const repository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-a"]),
        );

        repository.insert(
          createDraft({
            source_id: SOURCE_A,
            external_id: "shared-guid",
            url: "https://fixture.example/original",
            title: "Original title",
            published_at: "2026-11-17T09:00:00.000+08:00",
          }),
        );

        expect(repository.existsByExternalId(SOURCE_A, "shared-guid")).toBe(
          true,
        );
        expect(repository.existsByExternalId(SOURCE_B, "shared-guid")).toBe(
          false,
        );
        expect(repository.existsByExternalId(SOURCE_A, "different-guid")).toBe(
          false,
        );
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("COL-03/COL-04/COL-05/COL-18 compares URL with exact source and published time", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSources(db);
        const repository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-a", "source-item-b"]),
        );
        const url = "https://fixture.example/shared?edition=daily";
        const publishedAt = "2026-11-17T09:00:00.000+08:00";

        repository.insert(
          createDraft({
            source_id: SOURCE_A,
            url,
            published_at: publishedAt,
          }),
        );
        repository.insert(
          createDraft({
            source_id: SOURCE_A,
            url,
            title: "Undated fixture item",
            published_at: null,
          }),
        );

        expect(
          repository.existsByUrlAndPublishedAt(SOURCE_A, url, publishedAt),
        ).toBe(true);
        expect(
          repository.existsByUrlAndPublishedAt(
            SOURCE_A,
            url,
            "2026-11-17T10:00:00.000+08:00",
          ),
        ).toBe(false);
        expect(repository.existsByUrlAndPublishedAt(SOURCE_A, url, null)).toBe(
          true,
        );
        expect(
          repository.existsByUrlAndPublishedAt(SOURCE_B, url, publishedAt),
        ).toBe(false);
        expect(repository.existsByUrlAndPublishedAt(SOURCE_B, url, null)).toBe(
          false,
        );
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("persists every inserted field, content_id NULL, raw_data verbatim, and bound values", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSources(db);
        const repository = new SqliteSourceItemRepository(
          db,
          new SequenceIdGenerator(["source-item-persisted"]),
        );
        const draft = createDraft({
          external_id: "guid-'quoted'-?",
          url: "https://fixture.example/item?title='quoted'&value=?",
          title: "Title 'quoted' ?",
          raw_data: `{"literal":"' OR 1 = 1 -- ?","newline":"first\\nsecond"}`,
        });

        const inserted = repository.insert(draft);

        expect(inserted).toEqual({
          id: "source-item-persisted",
          ...draft,
        });
        expect(inserted.content_id).toBeNull();
        expect(inserted.raw_data).toBe(draft.raw_data);
        expect(readSourceItem(db, inserted.id)).toEqual(inserted);
        expect(
          db
            .prepare(
              `
                SELECT id, content_id
                FROM source_items
                WHERE content_id IS NULL AND source_id = ?
              `,
            )
            .all(SOURCE_A),
        ).toEqual([{ id: inserted.id, content_id: null }]);
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_items'",
            )
            .get(),
        ).toEqual({ name: "source_items" });
      } finally {
        closeDatabase(db);
      }
    });
  });
});
