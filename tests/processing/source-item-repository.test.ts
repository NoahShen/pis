import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  SqliteSourceItemRepository,
  type SourceItemDraft,
} from "../../src/collection/source-item-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { SqliteContentRepository } from "../../src/processing/content-repository.js";
import { SqliteProcessingSourceItemRepository } from "../../src/processing/source-item-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const SOURCE_ID = "source-processing";

function insertSource(db: Database.Database): void {
  db.prepare(
    `
      INSERT INTO sources (
        id, name, type, url, cron, enabled, description, last_collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `,
  ).run(
    SOURCE_ID,
    "Processing Source",
    "RSS",
    "https://fixture.example/processing.xml",
    "0 * * * *",
    1,
    null,
  );
}

function createSourceItemDraft(
  overrides: Partial<SourceItemDraft> = {},
): SourceItemDraft {
  return {
    source_id: SOURCE_ID,
    external_id: "fixture-guid",
    url: "https://fixture.example/item",
    title: "Fixture item",
    published_at: "2026-11-18T09:00:00.000+08:00",
    discovered_at: "2026-11-18T09:01:00.000+08:00",
    content_id: null,
    raw_data: '{"schema_version":1}',
    ...overrides,
  };
}

function insertSourceItem(
  db: Database.Database,
  id: string,
  overrides: Partial<SourceItemDraft> = {},
) {
  return new SqliteSourceItemRepository(
    db,
    new SequenceIdGenerator([id]),
  ).insert(createSourceItemDraft(overrides));
}

function insertContent(db: Database.Database, id: string): void {
  new SqliteContentRepository(db, new SequenceIdGenerator([id])).insert({
    title: "Fixture Content",
    url: null,
    author: null,
    published_at: null,
    created_at: "2026-11-18T09:02:00.000+08:00",
    body: "Fixture body",
    summary: null,
    language: null,
    completeness: "FULL",
  });
}

class UpdateResultDatabase {
  sql = "";
  parameters: unknown[] = [];

  constructor(private readonly changes: number) {}

  prepare(sql: string): unknown {
    this.sql = sql;
    return {
      run: (...parameters: unknown[]) => {
        this.parameters = parameters;
        return { changes: this.changes, lastInsertRowid: 0 };
      },
    };
  }
}

describe("SqliteProcessingSourceItemRepository", () => {
  it("reads fixed Source Item columns and returns null for a missing ID", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const inserted = insertSourceItem(db, "source-item-full", {
          external_id: "external-'quoted'-?",
          url: "https://fixture.example/item?value='quoted'&other=?",
          title: "Title 'quoted' ?",
          raw_data: '{"literal":"\' OR 1 = 1 -- ?"}',
        });
        const repository = new SqliteProcessingSourceItemRepository(db);

        expect(repository.getById(inserted.id)).toEqual(inserted);
        expect(repository.getById("missing-' OR 1 = 1 -- ?")).toBeNull();
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("binds Source Item and Content IDs when setting content_id and reads the row back", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        insertSource(db);
        const sourceItem = insertSourceItem(db, "source-item-'quoted'-?");
        const contentId = "content-'quoted'-?";
        insertContent(db, contentId);
        const repository = new SqliteProcessingSourceItemRepository(db);

        const updated = repository.setContentId(sourceItem.id, contentId);

        expect(updated).toEqual({ ...sourceItem, content_id: contentId });
        expect(repository.getById(sourceItem.id)).toEqual(updated);
        expect(
          db
            .prepare("SELECT content_id FROM source_items WHERE id = ?")
            .get(sourceItem.id),
        ).toEqual({ content_id: contentId });
        expect(
          db.prepare("SELECT count(*) AS count FROM source_items").get(),
        ).toEqual({ count: 1 });
      } finally {
        closeDatabase(db);
      }
    });
  });

  it.each([0, 2])(
    "rejects a content_id update that affects %i rows instead of one",
    async (changes) => {
      await withDatabasePath((databasePath) => {
        const realDatabase = openDatabase(databasePath);

        try {
          const recordingDatabase = new UpdateResultDatabase(changes);
          const repository = new SqliteProcessingSourceItemRepository(
            recordingDatabase as unknown as Database.Database,
          );

          expect(() =>
            repository.setContentId("source-item-id", "content-id"),
          ).toThrow("Expected exactly one Source Item update");
          expect(recordingDatabase.sql).toContain(
            "UPDATE source_items\n  SET content_id = ?\n  WHERE id = ?",
          );
          expect(recordingDatabase.parameters).toEqual([
            "content-id",
            "source-item-id",
          ]);
        } finally {
          closeDatabase(realDatabase);
        }
      });
    },
  );
});
