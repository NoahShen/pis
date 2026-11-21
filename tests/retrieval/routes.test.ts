import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { appConfig } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

const TOKEN = "retrieval-test-token";

function config(databasePath: string) {
  return appConfig({ apiToken: TOKEN, databasePath });
}

function authorized(url: string) {
  return {
    method: "GET" as const,
    url,
    headers: { authorization: `Bearer ${TOKEN}` },
  };
}

describe("retrieval routes", () => {
  it("returns every list and detail DTO from the lightweight owned database", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(config(databasePath), new CapturedLogger());
      try {
        const topicItems = await app.inject(
          authorized("/api/topics/topic-1/items"),
        );
        expect(topicItems.statusCode).toBe(200);
        expect(topicItems.headers["content-type"]).toContain(
          "application/json",
        );
        expect(topicItems.json()).toMatchObject({
          next_cursor: null,
          items: [
            { target_type: "EVENT_UPDATE", target: { id: "update-1" } },
            { target_type: "EVENT", target: { id: "event-1" } },
            {
              target_type: "KNOWLEDGE",
              target: { id: "knowledge-1", findings: [{ title: "Finding" }] },
            },
          ],
        });

        const events = await app.inject(authorized("/api/events"));
        expect(events.statusCode).toBe(200);
        expect(events.json()).toMatchObject({
          next_cursor: null,
          items: [{ id: "event-1", update_count: 2 }],
        });

        const event = await app.inject(authorized("/api/events/event-1"));
        expect(event.statusCode).toBe(200);
        expect(event.json()).toMatchObject({
          id: "event-1",
          updates: [
            {
              id: "update-1",
              evidence_contents: [{ id: "content-2" }],
            },
            { id: "update-2", evidence_contents: [] },
          ],
          evidence_contents: [{ id: "content-1" }],
        });

        const updates = await app.inject(
          authorized("/api/events/event-1/updates"),
        );
        expect(updates.statusCode).toBe(200);
        expect(updates.json()).toMatchObject({
          next_cursor: null,
          items: [{ id: "update-1" }, { id: "update-2" }],
        });

        const update = await app.inject(
          authorized("/api/event-updates/update-1"),
        );
        expect(update.statusCode).toBe(200);
        expect(update.json()).toMatchObject({
          id: "update-1",
          event: { id: "event-1" },
          evidence_contents: [{ id: "content-2" }],
        });

        const knowledge = await app.inject(authorized("/api/knowledge"));
        expect(knowledge.statusCode).toBe(200);
        expect(knowledge.json()).toMatchObject({
          next_cursor: null,
          items: [
            {
              id: "knowledge-1",
              findings: [{ title: "Finding", description: "Description" }],
            },
          ],
        });

        const knowledgeDetail = await app.inject(
          authorized("/api/knowledge/knowledge-1"),
        );
        expect(knowledgeDetail.statusCode).toBe(200);
        expect(knowledgeDetail.json()).toMatchObject({
          id: "knowledge-1",
          content: { id: "content-2", completeness: "PARTIAL" },
        });

        const content = await app.inject(authorized("/api/contents/content-1"));
        expect(content.statusCode).toBe(200);
        expect(content.json()).toMatchObject({
          id: "content-1",
          source_item: { id: "source-item-1" },
          source: { id: "source-1", enabled: true },
        });

        const published = await app.inject(authorized("/api/published-items"));
        expect(published.statusCode).toBe(200);
        expect(published.json()).toMatchObject({
          next_cursor: null,
          items: [
            {
              id: "published-1",
              topics: [{ id: "topic-1", name: "Topic one" }],
            },
            { id: "published-2" },
          ],
        });

        const publishedDetail = await app.inject(
          authorized("/api/published-items/published-1"),
        );
        expect(publishedDetail.statusCode).toBe(200);
        expect(publishedDetail.json()).toMatchObject({
          id: "published-1",
          body: "Immutable event body",
          target: { id: "event-1" },
          topics: [{ id: "topic-1" }],
        });
      } finally {
        await app.close();
      }
    });
  });

  it("returns controlled 400, 404 and Bearer authentication responses", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(config(databasePath), new CapturedLogger());
      try {
        for (const url of [
          "/api/topics/missing/items",
          "/api/events/missing",
          "/api/events/missing/updates",
          "/api/event-updates/missing",
          "/api/knowledge/missing",
          "/api/contents/missing",
          "/api/published-items/missing",
        ]) {
          const response = await app.inject(authorized(url));
          expect(response.statusCode).toBe(404);
          expect(response.json()).toEqual({ error: "not_found" });
        }

        for (const url of ["/api/events?limit=50", "/api/contents/%00"]) {
          const response = await app.inject(authorized(url));
          expect(response.statusCode).toBe(400);
          expect(response.json()).toEqual({ error: "invalid_request" });
        }

        for (const headers of [
          undefined,
          { authorization: "Bearer wrong-token" },
        ]) {
          const response = await app.inject({
            method: "GET",
            url: "/api/events",
            headers,
          });
          expect(response.statusCode).toBe(401);
          expect(response.headers["www-authenticate"]).toBe("Bearer");
          expect(response.json()).toEqual({ error: "unauthorized" });
        }
      } finally {
        await app.close();
      }
    });
  });
});
