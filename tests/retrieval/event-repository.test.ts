import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SqliteEventRetrievalRepository } from "../../src/retrieval/repositories/event-repository.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

describe("SqliteEventRetrievalRepository", () => {
  it("lists events with counts and gets full updates and evidence", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteEventRetrievalRepository(db);
      const events = repository.list();
      expect(events.items).toHaveLength(1);
      expect(events.items[0]).toMatchObject({ id: "event-1", update_count: 2 });
      const detail = repository.getById("event-1");
      expect(detail?.updates.map((update) => update.id)).toEqual([
        "update-1",
        "update-2",
      ]);
      expect(detail?.updates[0].evidence_contents[0].id).toBe("content-2");
      expect(detail?.evidence_contents[0]).toMatchObject({
        id: "content-1",
        title: "First content",
      });
      expect(repository.getById("missing")).toBeNull();
    });
  });

  it("gets update details and paginated update lists with parent 404 semantics", async () => {
    await withRetrievalFixture(({ db }) => {
      const repository = new SqliteEventRetrievalRepository(db);
      expect(repository.listUpdates("event-1", { limit: 1 })?.items[0].id).toBe(
        "update-1",
      );
      expect(repository.listUpdates("missing")).toBeNull();
      const update = repository.getUpdateById("update-1");
      expect(update?.event.id).toBe("event-1");
      expect(update?.evidence_contents[0].id).toBe("content-2");
      expect(repository.getUpdateById("missing")).toBeNull();
    });
  });

  it("reads events from a query_only database", async () => {
    await withRetrievalFixture(({ db, databasePath }) => {
      db.close();
      const queryOnly = new Database(databasePath);
      queryOnly.pragma("query_only = ON");
      try {
        const repository = new SqliteEventRetrievalRepository(queryOnly);
        expect(repository.getById("event-1")?.updates).toHaveLength(2);
      } finally {
        queryOnly.close();
      }
    });
  });
});
