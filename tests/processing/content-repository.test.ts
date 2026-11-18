import { describe, expect, it } from "vitest";

import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import {
  SqliteContentRepository,
  type ContentDraft,
} from "../../src/processing/content-repository.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

function createDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    title: "Content title",
    url: "https://fixture.example/content",
    author: "Fixture Author",
    published_at: "2026-11-18T08:00:00.000+08:00",
    created_at: "2026-11-18T09:00:00.000+08:00",
    body: "First line\nSecond line",
    summary: "Fixture summary",
    language: null,
    completeness: "FULL",
    ...overrides,
  };
}

describe("SqliteContentRepository", () => {
  it("binds every Content value and reads back the complete inserted row", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const draft = createDraft({
          title: "Title 'quoted' ? --",
          url: "https://fixture.example/item?title='quoted'&value=?",
          author: "Author 'quoted' ?",
          published_at: "2026-11-18T08:30:00.000+08:00",
          created_at: "2026-11-18T09:15:00.000+08:00",
          body: "alpha <algorithm>\nList<T> ?\n' OR 1 = 1 --",
          summary: "Summary 'quoted' ?",
          completeness: "PARTIAL",
        });
        const repository = new SqliteContentRepository(
          db,
          new SequenceIdGenerator(["content-'quoted'-?"]),
        );

        const inserted = repository.insert(draft);

        expect(inserted).toEqual({ id: "content-'quoted'-?", ...draft });
        expect(repository.getById(inserted.id)).toEqual(inserted);
        expect(
          db
            .prepare(
              `
                SELECT
                  id, title, url, author, published_at, created_at, body,
                  summary, language, completeness
                FROM contents
                WHERE id = ?
              `,
            )
            .get(inserted.id),
        ).toEqual(inserted);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("returns null for a missing Content and binds the lookup ID", async () => {
    await withDatabasePath((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        initializeDatabase(db);
        const repository = new SqliteContentRepository(
          db,
          new SequenceIdGenerator(["existing-content"]),
        );
        const inserted = repository.insert(createDraft());

        expect(repository.getById("missing-' OR 1 = 1 -- ?")).toBeNull();
        expect(repository.getById(inserted.id)).toEqual(inserted);
      } finally {
        closeDatabase(db);
      }
    });
  });
});
