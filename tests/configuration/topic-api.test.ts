import SqliteDatabase from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { ConfigurationRepositories } from "../../src/configuration/app-assembly.js";
import type { SourceRepository } from "../../src/configuration/source-repository.js";
import {
  SqliteTopicRepository,
  type TopicRepository,
} from "../../src/configuration/topic-repository.js";
import { openDatabase } from "../../src/database/open-database.js";
import { initializeDatabase } from "../../src/database/schema.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { closeDatabase, withDatabasePath } from "../fixtures/database.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const API_TOKEN = "topic-api-token";
const AUTHORIZATION = { authorization: `Bearer ${API_TOKEN}` };
const TOPIC_INPUT = {
  name: "  Synthetic Topic  ",
  description: "  Synthetic Topic description.  ",
  enabled: true,
} as const;
const BUSINESS_TABLES = [
  "sources",
  "contents",
  "events",
  "event_updates",
  "knowledge",
  "topics",
  "published_items",
  "source_items",
  "event_content_links",
  "event_entity_aliases",
  "topic_associations",
] as const;

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function config(databasePath: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    apiToken: API_TOKEN,
    logLevel: "silent",
    databasePath,
  };
}

async function openTopicApp(
  databasePath: string,
  repositories?: ConfigurationRepositories,
): Promise<FastifyInstance> {
  const app = await buildApp(config(databasePath), new CapturedLogger(), {
    repositories,
  });
  openApps.push(app);
  return app;
}

async function closeApp(app: FastifyInstance): Promise<void> {
  const index = openApps.indexOf(app);
  if (index !== -1) {
    openApps.splice(index, 1);
  }
  await app.close();
}

function topicCount(databasePath: string): number {
  const db = new SqliteDatabase(databasePath, { readonly: true });
  try {
    return (
      db.prepare("SELECT count(*) AS count FROM topics").get() as {
        count: number;
      }
    ).count;
  } finally {
    db.close();
  }
}

function topicRows(databasePath: string): unknown[] {
  const db = new SqliteDatabase(databasePath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT id, name, description, enabled FROM topics ORDER BY id COLLATE BINARY ASC",
      )
      .all();
  } finally {
    db.close();
  }
}

function snapshotBusinessTables(
  databasePath: string,
): Record<(typeof BUSINESS_TABLES)[number], unknown[]> {
  const db = new SqliteDatabase(databasePath, { readonly: true });
  try {
    return Object.fromEntries(
      BUSINESS_TABLES.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    ) as Record<(typeof BUSINESS_TABLES)[number], unknown[]>;
  } finally {
    db.close();
  }
}

function seedHistoricalRows(databasePath: string): void {
  const db = openDatabase(databasePath);
  try {
    initializeDatabase(db);
    db.transaction(() => {
      db.prepare(
        `
          INSERT INTO sources (id, name, type, url, cron, enabled, description, last_collected_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-source",
        "History Source",
        "RSS",
        "https://history.example/feed.xml",
        "0 * * * *",
        1,
        null,
        "2026-11-15T08:00:00.000+08:00",
      );
      db.prepare(
        `
          INSERT INTO contents (id, title, url, author, published_at, created_at, body, summary, language, completeness)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-content",
        "History Content",
        "https://history.example/content",
        null,
        "2026-11-15T09:00:00.000+08:00",
        "2026-11-15T09:01:00.000+08:00",
        "History content body.",
        null,
        "en",
        "FULL",
      );
      db.prepare(
        `
          INSERT INTO events (id, title, entity_name, subject, scope, description, occurred_at, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-event",
        "History Event",
        "History Entity",
        "History Subject",
        "History Scope",
        "History event description.",
        null,
        "2026-11-15T09:02:00.000+08:00",
      );
      db.prepare(
        `
          INSERT INTO event_updates (id, event_id, title, description, occurred_at, discovered_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-event-update",
        "history-event",
        "History Event Update",
        "History update description.",
        null,
        "2026-11-15T09:03:00.000+08:00",
      );
      db.prepare(
        `
          INSERT INTO knowledge (id, content_id, title, summary, category, findings_json, value)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-knowledge",
        "history-content",
        "History Knowledge",
        "History knowledge summary.",
        "Insight",
        "[]",
        "History knowledge value.",
      );
      db.prepare(
        "INSERT INTO topics (id, name, description, enabled) VALUES (?, ?, ?, ?)",
      ).run("history-topic", "History Topic", "History topic.", 1);
      db.prepare(
        `
          INSERT INTO published_items (id, target_type, target_id, title, summary, body, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-published",
        "EVENT",
        "history-event",
        "History Published",
        "History published summary.",
        "History published body.",
        "2026-11-15T09:04:00.000+08:00",
      );
      db.prepare(
        `
          INSERT INTO source_items (id, source_id, external_id, url, title, published_at, discovered_at, content_id, raw_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        "history-source-item",
        "history-source",
        "external-history",
        "https://history.example/item",
        "History Source Item",
        "2026-11-15T09:00:00.000+08:00",
        "2026-11-15T09:05:00.000+08:00",
        "history-content",
        "{}",
      );
      db.prepare(
        "INSERT INTO event_content_links (target_type, target_id, content_id) VALUES (?, ?, ?)",
      ).run("EVENT", "history-event", "history-content");
      db.prepare(
        "INSERT INTO event_entity_aliases (event_id, alias, content_id) VALUES (?, ?, ?)",
      ).run("history-event", "History Alias", "history-content");
      db.prepare(
        "INSERT INTO topic_associations (topic_id, target_type, target_id, matched_at) VALUES (?, ?, ?, ?)",
      ).run(
        "history-topic",
        "EVENT",
        "history-event",
        "2026-11-15T09:06:00.000+08:00",
      );
    }).immediate();
  } finally {
    closeDatabase(db);
  }
}

const unusedSourceRepository: SourceRepository = {
  create: () => {
    throw new Error("source repository must not be reached");
  },
  getById: () => null,
  list: () => [],
  listEnabled: () => [],
  update: () => null,
};

describe("Topic API", () => {
  it("topic API creates lists reads patches and persists through restart", async () => {
    await withDatabasePath(async (databasePath) => {
      const first = await openTopicApp(databasePath);
      const createdResponse = await first.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: TOPIC_INPUT,
      });
      expect(createdResponse.statusCode).toBe(201);
      const created = createdResponse.json();
      expect(created).toEqual({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        ...TOPIC_INPUT,
      });

      const disabledResponse = await first.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: {
          name: "Disabled Topic",
          description: "Disabled Topic description.",
          enabled: false,
        },
      });
      expect(disabledResponse.statusCode).toBe(201);
      const disabled = disabledResponse.json();
      expect(disabled).toMatchObject({ enabled: false });

      const detail = await first.inject({
        method: "GET",
        url: `/api/topics/${created.id}`,
        headers: AUTHORIZATION,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual(created);

      const list = await first.inject({
        method: "GET",
        url: "/api/topics",
        headers: AUTHORIZATION,
      });
      expect(list.statusCode).toBe(200);
      const expectedBeforePatch = [created, disabled].sort((left, right) =>
        String(left.id) < String(right.id) ? -1 : 1,
      );
      expect(list.json()).toEqual({ items: expectedBeforePatch });

      const patchedResponse = await first.inject({
        method: "PATCH",
        url: `/api/topics/${created.id}`,
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: {
          name: "Renamed Topic",
          description: "Renamed Topic description.",
          enabled: false,
        },
      });
      expect(patchedResponse.statusCode).toBe(200);
      const patched = patchedResponse.json();
      expect(patched).toEqual({
        id: created.id,
        name: "Renamed Topic",
        description: "Renamed Topic description.",
        enabled: false,
      });

      await closeApp(first);
      const second = await openTopicApp(databasePath);
      const persistedDetail = await second.inject({
        method: "GET",
        url: `/api/topics/${created.id}`,
        headers: AUTHORIZATION,
      });
      expect(persistedDetail.statusCode).toBe(200);
      expect(persistedDetail.json()).toEqual(patched);

      const persistedList = await second.inject({
        method: "GET",
        url: "/api/topics",
        headers: AUTHORIZATION,
      });
      expect(persistedList.statusCode).toBe(200);
      const expectedAfterPatch = [patched, disabled].sort((left, right) =>
        String(left.id) < String(right.id) ? -1 : 1,
      );
      expect(persistedList.json()).toEqual({ items: expectedAfterPatch });
    });
  });

  it("topic API authenticates before parsing invalid write requests", async () => {
    const create = vi.fn((): never => {
      throw new Error("unauthorized create reached repository");
    });
    const update = vi.fn((): never => {
      throw new Error("unauthorized update reached repository");
    });
    const repositories: ConfigurationRepositories = {
      source: unusedSourceRepository,
      topic: {
        create,
        getById: () => null,
        list: () => [],
        listEnabled: () => [],
        update,
      },
    };

    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath, repositories);
      const requests = [
        {
          method: "POST" as const,
          url: "/api/topics",
          headers: { "content-type": "application/json" },
          payload: "{not-json",
        },
        {
          method: "PATCH" as const,
          url: "/api/topics/topic-1",
          headers: { "content-type": "application/json" },
          payload: "{not-json",
        },
        {
          method: "POST" as const,
          url: "/api/topics?invalid=true",
          headers: { "content-type": "text/plain" },
          payload: "not-json",
        },
        {
          method: "PATCH" as const,
          url: "/api/topics/topic-1",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
        },
        {
          method: "POST" as const,
          url: "/api/topics",
          headers: { "content-type": "application/json" },
          payload: TOPIC_INPUT,
        },
      ];

      for (const request of requests) {
        const response = await app.inject({
          ...request,
          headers: {
            ...request.headers,
            authorization: "Bearer wrong-token",
          },
        });
        expect(response.statusCode).toBe(401);
        expect(response.headers["www-authenticate"]).toBe("Bearer");
        expect(response.json()).toEqual({ error: "unauthorized" });
      }

      const duplicate = await app.inject({
        method: "PATCH",
        url: "/api/topics/topic-1",
        headers: {
          authorization: [`Bearer ${API_TOKEN}`, `Bearer ${API_TOKEN}`],
          "content-type": "application/json",
        } as never,
        payload: "{not-json",
      });
      expect(duplicate.statusCode).toBe(401);

      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });

  it("topic API requires JSON content type and bounds request bodies after authentication", async () => {
    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath);
      for (const request of [
        {
          method: "POST" as const,
          url: "/api/topics",
          payload: JSON.stringify(TOPIC_INPUT),
        },
        {
          method: "PATCH" as const,
          url: "/api/topics/missing",
        },
      ]) {
        const response = await app.inject({
          ...request,
          headers: AUTHORIZATION,
        });
        expect(response.statusCode).toBe(415);
        expect(response.json()).toEqual({ error: "unsupported_media_type" });
      }

      const textPlain = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "text/plain" },
        payload: JSON.stringify(TOPIC_INPUT),
      });
      expect(textPlain.statusCode).toBe(415);

      const malformed = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: "{not-json",
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ error: "invalid_request" });

      const oversized = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json()).toEqual({ error: "payload_too_large" });
      expect(topicCount(databasePath)).toBe(0);
    });
  });

  it("topic API rejects empty unknown and malformed updates without partial writes", async () => {
    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath);
      const created = (
        await app.inject({
          method: "POST",
          url: "/api/topics",
          headers: { ...AUTHORIZATION, "content-type": "application/json" },
          payload: TOPIC_INPUT,
        })
      ).json();
      const rowsBefore = topicRows(databasePath);

      const invalidCreates = [
        {},
        { name: "Topic" },
        { name: "   ", description: "description" },
        { name: "Topic", description: "   " },
        { name: "Topic", description: "description", enabled: 1 },
        { name: "Topic", description: "description", id: "injected-id" },
        { name: "Topic", description: "description", unknown: "must-not-leak" },
      ];
      for (const payload of invalidCreates) {
        const response = await app.inject({
          method: "POST",
          url: "/api/topics",
          headers: { ...AUTHORIZATION, "content-type": "application/json" },
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });
        expect(response.body).not.toContain("must-not-leak");
      }

      for (const payload of [
        {},
        [],
        null,
        { id: created.id },
        { name: "  " },
        { description: "" },
        { enabled: "false" },
        { name: "Would partially update", enabled: "invalid" },
        { name: "Would partially update", unknown: "must-not-leak" },
      ]) {
        const response = await app.inject({
          method: "PATCH",
          url: `/api/topics/${created.id}`,
          headers: { ...AUTHORIZATION, "content-type": "application/json" },
          payload: payload ?? undefined,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });
        expect(response.body).not.toContain("must-not-leak");
        expect(topicRows(databasePath)).toEqual(rowsBefore);
      }

      for (const url of [
        "/api/topics?enabled=true",
        `/api/topics/${created.id}?x=1`,
      ]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: AUTHORIZATION,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });
      }
      expect(topicRows(databasePath)).toEqual(rowsBefore);
    });
  });

  it("topic API does not alter historical associations publications or downstream tables", async () => {
    await withDatabasePath(async (databasePath) => {
      seedHistoricalRows(databasePath);
      const app = await openTopicApp(databasePath);
      const before = snapshotBusinessTables(databasePath);

      const patched = await app.inject({
        method: "PATCH",
        url: "/api/topics/history-topic",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: {
          name: "Updated History Topic",
          description: "Updated History Topic description.",
          enabled: false,
        },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({ enabled: false });
      const afterDisable = snapshotBusinessTables(databasePath);
      for (const table of BUSINESS_TABLES) {
        if (table !== "topics") {
          expect(afterDisable[table], table).toEqual(before[table]);
        }
      }
      expect(afterDisable.topic_associations).toEqual(
        before.topic_associations,
      );
      expect(afterDisable.published_items).toEqual(before.published_items);

      const reenabled = await app.inject({
        method: "PATCH",
        url: "/api/topics/history-topic",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { enabled: true },
      });
      expect(reenabled.statusCode).toBe(200);
      expect(reenabled.json()).toMatchObject({ enabled: true });

      const after = snapshotBusinessTables(databasePath);
      for (const table of BUSINESS_TABLES) {
        if (table !== "topics") {
          expect(after[table], table).toEqual(before[table]);
        }
      }
      expect(after.topic_associations).toEqual(before.topic_associations);
      expect(after.published_items).toEqual(before.published_items);
      expect(after.topics).toEqual([
        {
          id: "history-topic",
          name: "Updated History Topic",
          description: "Updated History Topic description.",
          enabled: 1,
        },
      ]);
    });
  });

  it("topic listEnabled excludes disabled topics without deleting history", async () => {
    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath);
      const enabledResponse = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: TOPIC_INPUT,
      });
      expect(enabledResponse.statusCode).toBe(201);
      const enabled = enabledResponse.json();
      const disabledResponse = await app.inject({
        method: "POST",
        url: "/api/topics",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: {
          name: "Disabled Topic",
          description: "Disabled Topic description.",
          enabled: false,
        },
      });
      expect(disabledResponse.statusCode).toBe(201);
      const disabled = disabledResponse.json();

      const list = await app.inject({
        method: "GET",
        url: "/api/topics",
        headers: AUTHORIZATION,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json<{ items: unknown[] }>().items).toEqual(
        expect.arrayContaining([enabled, disabled]),
      );

      await closeApp(app);
      const db = openDatabase(databasePath);
      try {
        const repository = new SqliteTopicRepository(
          db,
          new SequenceIdGenerator([]),
        );
        expect(
          repository
            .list()
            .map(({ id }) => id)
            .sort(),
        ).toEqual([enabled.id, disabled.id].sort());
        expect(repository.listEnabled()).toEqual([enabled]);
      } finally {
        closeDatabase(db);
      }
    });
  });

  it("topic API returns exact not-found responses and keeps unsupported routes unhandled", async () => {
    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath);
      const detail = await app.inject({
        method: "GET",
        url: "/api/topics/missing",
        headers: AUTHORIZATION,
      });
      expect(detail.statusCode).toBe(404);
      expect(detail.json()).toEqual({ error: "not_found" });

      const patch = await app.inject({
        method: "PATCH",
        url: "/api/topics/missing",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { name: "Missing Topic" },
      });
      expect(patch.statusCode).toBe(404);
      expect(patch.json()).toEqual({ error: "not_found" });

      for (const request of [
        { method: "DELETE" as const, url: "/api/topics" },
        { method: "DELETE" as const, url: "/api/topics/topic-1" },
        { method: "GET" as const, url: "/api/topics/topic-1/unknown" },
      ]) {
        const response = await app.inject({
          ...request,
          headers: AUTHORIZATION,
        });
        expect(response.statusCode).toBe(404);
      }
      expect(topicCount(databasePath)).toBe(0);
    });
  });

  it("topic API maps SQLite contention to 503 and hides unexpected failures", async () => {
    const baseTopic: TopicRepository = {
      create: () => {
        throw new Error("unused");
      },
      getById: () => null,
      list: () => {
        throw Object.assign(new Error("database detail"), {
          code: "SQLITE_BUSY",
        });
      },
      listEnabled: () => [],
      update: () => null,
    };
    const repositories: ConfigurationRepositories = {
      source: unusedSourceRepository,
      topic: baseTopic,
    };

    await withDatabasePath(async (databasePath) => {
      const app = await openTopicApp(databasePath, repositories);
      const unavailable = await app.inject({
        method: "GET",
        url: "/api/topics",
        headers: AUTHORIZATION,
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ error: "storage_unavailable" });
      expect(unavailable.body).not.toContain("database detail");

      repositories.topic.list = () => {
        throw new Error("unexpected database detail");
      };
      const failed = await app.inject({
        method: "GET",
        url: "/api/topics",
        headers: AUTHORIZATION,
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.json()).toEqual({ error: "internal_error" });
      expect(failed.body).not.toContain("unexpected database detail");
    });
  });
});
