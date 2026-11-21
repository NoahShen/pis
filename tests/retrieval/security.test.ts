import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { appConfig, TEST_API_TOKEN } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { withRetrievalFixture } from "../fixtures/retrieval.js";

const protectedRoutes = [
  "/health",
  "/api/sources",
  "/api/sources/source-1",
  "/api/topics",
  "/api/topics/topic-1",
  "/api/topics/topic-1/items",
  "/api/events",
  "/api/events/event-1",
  "/api/events/event-1/updates",
  "/api/event-updates/update-1",
  "/api/knowledge",
  "/api/knowledge/knowledge-1",
  "/api/contents/content-1",
  "/api/published-items",
  "/api/published-items/published-1",
];

function databaseDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("retrieval API security", () => {
  it("requires Bearer on every old and new protected API", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(appConfig({ databasePath }), new CapturedLogger());
      try {
        for (const url of protectedRoutes) {
          for (const authorization of [undefined, "Bearer wrong-token"]) {
            const response = await app.inject({
              method: "GET",
              url,
              ...(authorization === undefined
                ? {}
                : { headers: { authorization } }),
            });
            expect(response.statusCode, `${url} ${authorization}`).toBe(401);
            expect(response.headers["www-authenticate"]).toBe("Bearer");
            expect(response.json()).toEqual({ error: "unauthorized" });
          }
        }
      } finally {
        await app.close();
      }
    });
  });

  it("does not turn RSS paths into authorized dynamic endpoints", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(appConfig({ databasePath }), new CapturedLogger());
      try {
        for (const url of [
          "/feeds/event-updates.xml",
          "/feeds/curated-content.xml",
          "/rss/event-updates.xml",
        ]) {
          const response = await app.inject({
            method: "GET",
            url,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          });
          expect(response.statusCode).toBe(404);
          expect(response.body).not.toContain("Published event");
        }
      } finally {
        await app.close();
      }
    });
  });

  it("binds dangerous ID and query input and returns sanitized errors", async () => {
    await withRetrievalFixture(async ({ db, databasePath }) => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      const before = databaseDigest(databasePath);
      const app = buildApp(appConfig({ databasePath }), new CapturedLogger());
      const secret = appConfig().llmApiKey;
      const dangerous = encodeURIComponent(
        "' OR 1=1; DROP TABLE events;-- /private/absolute/path",
      );
      try {
        const responses = [
          await app.inject({
            method: "GET",
            url: `/api/events/${dangerous}`,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          }),
          await app.inject({
            method: "GET",
            url: `/api/published-items?target_type=${dangerous}`,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          }),
          await app.inject({
            method: "GET",
            url: `/api/events/${dangerous}?unexpected=<script>alert(1)</script>`,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          }),
        ];
        expect(responses.map((response) => response.statusCode)).toEqual([
          404, 400, 400,
        ]);
        for (const response of responses) {
          expect(response.body).not.toMatch(
            /SELECT|DROP TABLE|SqliteError|stack|at .*\.ts|Bearer|\/private\/absolute\/path/,
          );
          expect(response.body).not.toContain(secret);
          expect(response.body).not.toContain(databasePath);
        }
      } finally {
        await app.close();
      }
      db.pragma("wal_checkpoint(TRUNCATE)");
      expect(databaseDigest(databasePath)).toBe(before);
      expect(db.prepare("SELECT COUNT(*) AS count FROM events").get()).toEqual({
        count: 1,
      });
    });
  });

  it("accepts 256-character IDs and returns controlled 400 above the bound", async () => {
    await withRetrievalFixture(async ({ databasePath }) => {
      const app = buildApp(appConfig({ databasePath }), new CapturedLogger());
      try {
        for (const length of [256, 257, 1000]) {
          const response = await app.inject({
            method: "GET",
            url: `/api/events/${"x".repeat(length)}`,
            headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
          });
          expect(response.statusCode).toBe(length === 256 ? 404 : 400);
          if (length > 256) {
            expect(response.json()).toEqual({ error: "invalid_request" });
          }
        }
      } finally {
        await app.close();
      }
    });
  });
});
