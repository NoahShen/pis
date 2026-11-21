import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { appConfig } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

const TOKEN = "retrieval-pagination-token";
const authorized = (url: string) => ({
  method: "GET" as const,
  url,
  headers: { authorization: `Bearer ${TOKEN}` },
});

describe("retrieval route pagination", () => {
  it("uses strict input validation and binds cursors to filters", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(
        appConfig({ apiToken: TOKEN, databasePath }),
        new CapturedLogger(),
      );
      try {
        for (const url of [
          "/api/events?limit=201",
          "/api/events?limit=1&limit=2",
          "/api/events?unknown=x",
          "/api/knowledge?target_type=KNOWLEDGE",
          "/api/topics/topic-1/items?target_type=event",
          "/api/published-items?published_after=2026-01-01T00%3A00%3A00",
          "/api/published-items?published_after=2026-01-06T00%3A00%3A00Z&published_before=2026-01-01T00%3A00%3A00Z",
          "/api/events/event-1?limit=1",
        ]) {
          const response = await app.inject(authorized(url));
          expect(response.statusCode, url).toBe(400);
          expect(response.json()).toEqual({ error: "invalid_request" });
        }

        const filtered = await app.inject(
          authorized("/api/topics/topic-1/items?target_type=EVENT&limit=1"),
        );
        expect(filtered.statusCode).toBe(200);
        const first = await app.inject(authorized("/api/events?limit=1"));
        const cursor = first.json().next_cursor as string;
        expect(
          (
            await app.inject(
              authorized(
                `/api/events?limit=1&cursor=${cursor}&target_type=EVENT`,
              ),
            )
          ).statusCode,
        ).toBe(400);
        const changed = await app.inject(
          authorized(
            "/api/topics/topic-1/items?target_type=EVENT_UPDATE&limit=1",
          ),
        );
        const changedCursor = changed.json().next_cursor;
        if (changedCursor !== null) {
          expect(
            (
              await app.inject(
                authorized(
                  `/api/topics/topic-1/items?target_type=EVENT&limit=1&cursor=${changedCursor}`,
                ),
              )
            ).statusCode,
          ).toBe(400);
        }
      } finally {
        await app.close();
      }
    });
  });

  it("paginates all five lists with stable keyset order and no duplicates after inserts", async () => {
    await withRetrievalFixture(async ({ db, databasePath }) => {
      const eventInsert = db.prepare(`INSERT INTO events
        (id,title,entity_name,subject,scope,description,occurred_at,discovered_at)
        VALUES (?,?,?,?,?,?,?,?)`);
      const updateInsert = db.prepare(`INSERT INTO event_updates
        (id,event_id,title,description,occurred_at,discovered_at) VALUES (?,?,?,?,?,?)`);
      const associationInsert = db.prepare(`INSERT INTO topic_associations
        (topic_id,target_type,target_id,matched_at) VALUES (?,?,?,?)`);
      const publishedInsert = db.prepare(`INSERT INTO published_items
        (id,target_type,target_id,title,summary,body,published_at) VALUES (?,?,?,?,?,?,?)`);
      const contentInsert = db.prepare(`INSERT INTO contents
        (id,title,url,author,published_at,created_at,body,summary,language,completeness)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      const knowledgeInsert = db.prepare(`INSERT INTO knowledge
        (id,content_id,title,summary,category,findings_json,value) VALUES (?,?,?,?,?,?,?)`);
      const insertEvent = (id: string, time: string) =>
        eventInsert.run(id, id, "e", "s", "s", "d", null, time);
      insertEvent("event-0", "2025-12-01T00:00:00Z");
      updateInsert.run(
        "update-0",
        "event-1",
        "u0",
        "d",
        null,
        "2025-12-01T00:00:00Z",
      );
      associationInsert.run(
        "topic-1",
        "EVENT",
        "event-0",
        "2025-12-01T00:00:00Z",
      );
      publishedInsert.run(
        "published-0",
        "EVENT",
        "event-0",
        "p0",
        "s",
        "b",
        "2025-12-01T00:00:00Z",
      );
      contentInsert.run(
        "content-0",
        "c0",
        null,
        null,
        null,
        "2025-12-01T00:00:00Z",
        "b",
        null,
        null,
        "FULL",
      );
      knowledgeInsert.run(
        "knowledge-0",
        "content-0",
        "k0",
        "s",
        null,
        "[]",
        "v",
      );

      const app = buildApp(
        appConfig({ apiToken: TOKEN, databasePath }),
        new CapturedLogger(),
      );
      try {
        const urls = [
          "/api/topics/topic-1/items",
          "/api/events",
          "/api/events/event-1/updates",
          "/api/knowledge",
          "/api/published-items",
        ];
        for (const url of urls) {
          const seen: string[] = [];
          let cursor: string | null = null;
          let pages = 0;
          do {
            const separator = url.includes("?") ? "&" : "?";
            const pageUrl: string = `${url}${separator}limit=1${cursor === null ? "" : `&cursor=${cursor}`}`;
            const response = await app.inject(authorized(pageUrl));
            expect(response.statusCode, url).toBe(200);
            const body = response.json();
            expect(body.items).toHaveLength(1);
            const item = body.items[0];
            seen.push(item.target_id ?? item.id);
            cursor = body.next_cursor;
            pages += 1;
            if (pages === 1) {
              const id = `new-${seen.length}`;
              if (url === "/api/events")
                insertEvent(id, "2027-01-01T00:00:00Z");
              if (url.endsWith("/updates"))
                updateInsert.run(
                  id,
                  "event-1",
                  id,
                  "d",
                  null,
                  "2027-01-01T00:00:00Z",
                );
              if (url.endsWith("/items")) {
                insertEvent("event-new", "2026-01-01T00:00:00Z");
                associationInsert.run(
                  "topic-1",
                  "EVENT",
                  "event-new",
                  "2027-01-01T00:00:00Z",
                );
              }
              if (url === "/api/knowledge") {
                contentInsert.run(
                  "content-new",
                  id,
                  null,
                  null,
                  null,
                  "2027-01-01T00:00:00Z",
                  "b",
                  null,
                  null,
                  "FULL",
                );
                knowledgeInsert.run(
                  id,
                  "content-new",
                  id,
                  "s",
                  null,
                  "[]",
                  "v",
                );
              }
              if (url === "/api/published-items")
                publishedInsert.run(
                  id,
                  "EVENT_UPDATE",
                  "update-1",
                  id,
                  "s",
                  "b",
                  "2027-01-01T00:00:00Z",
                );
            }
          } while (cursor !== null);
          expect(new Set(seen).size, url).toBe(seen.length);
          expect(pages, url).toBeGreaterThanOrEqual(2);
        }
      } finally {
        await app.close();
      }
    });
  });

  it("applies published type and inclusive offset-aware time filters", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(
        appConfig({ apiToken: TOKEN, databasePath }),
        new CapturedLogger(),
      );
      try {
        const response = await app.inject(
          authorized(
            "/api/published-items?target_type=EVENT&published_after=2026-01-05T10%3A00%3A00%2B08%3A00&published_before=2026-01-05T10%3A00%3A00Z",
          ),
        );
        expect(response.statusCode).toBe(200);
        expect(
          response.json().items.map((item: { id: string }) => item.id),
        ).toEqual(["published-1"]);
      } finally {
        await app.close();
      }
    });
  });

  it("supports limits above 200 rows and default page size", async () => {
    await withRetrievalFixture(async ({ db, databasePath }) => {
      const insert = db.prepare(`INSERT INTO events
        (id,title,entity_name,subject,scope,description,occurred_at,discovered_at)
        VALUES (?,?,?,?,?,?,?,?)`);
      const transaction = db.transaction(() => {
        for (let index = 0; index < 205; index += 1) {
          const id = `bulk-${String(index).padStart(3, "0")}`;
          insert.run(id, id, "e", "s", "s", "d", null, "2026-02-01T00:00:00Z");
        }
      });
      transaction();
      const app = buildApp(
        appConfig({ apiToken: TOKEN, databasePath }),
        new CapturedLogger(),
      );
      try {
        const first = await app.inject(authorized("/api/events"));
        expect(first.json().items).toHaveLength(50);
        expect(first.json().next_cursor).not.toBeNull();
        const max = await app.inject(authorized("/api/events?limit=200"));
        expect(max.json().items).toHaveLength(200);
        const nextCursor: string = max.json().next_cursor;
        const lastUrl: string = `/api/events?limit=200&cursor=${nextCursor}`;
        const last = await app.inject(authorized(lastUrl));
        expect(last.json().items).toHaveLength(6);
        expect(last.json().next_cursor).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
