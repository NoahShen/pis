import SqliteDatabase from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { ConfigurationRepositories } from "../../src/configuration/app-assembly.js";
import type { Source } from "../../src/configuration/contracts.js";
import type { SourceRepository } from "../../src/configuration/source-repository.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";
import { withDatabasePath } from "../fixtures/database.js";

const API_TOKEN = "source-api-token";
const AUTHORIZATION = { authorization: `Bearer ${API_TOKEN}` };
const SOURCE_INPUT = {
  name: "  Synthetic Source  ",
  type: "RSS",
  url: "https://source.example.test/feed.xml?edition=daily",
  cron: "  0 */5 * * * *  ",
  enabled: true,
  description: "  Synthetic Source description  ",
} as const;

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

async function withSourceApp<T>(
  callback: (context: {
    app: FastifyInstance;
    databasePath: string;
    logger: CapturedLogger;
  }) => Promise<T>,
  dependencies?: ConfigurationRepositories,
): Promise<T> {
  return withDatabasePath(async (databasePath) => {
    const logger = new CapturedLogger();
    const app = await buildApp(config(databasePath), logger, {
      repositories: dependencies,
    });
    openApps.push(app);

    try {
      return await callback({ app, databasePath, logger });
    } finally {
      const index = openApps.indexOf(app);
      if (index !== -1) {
        openApps.splice(index, 1);
      }
      await app.close();
    }
  });
}

function sourceCount(databasePath: string): number {
  const db = new SqliteDatabase(databasePath, { readonly: true });
  try {
    return (
      db.prepare("SELECT count(*) AS count FROM sources").get() as {
        count: number;
      }
    ).count;
  } finally {
    db.close();
  }
}

function sourceRows(databasePath: string): unknown[] {
  const db = new SqliteDatabase(databasePath, { readonly: true });
  try {
    return db
      .prepare(
        `
          SELECT id, name, type, url, cron, enabled, description, last_collected_at
          FROM sources
          ORDER BY id COLLATE BINARY ASC
        `,
      )
      .all();
  } finally {
    db.close();
  }
}

function createSource(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/api/sources",
    headers: { ...AUTHORIZATION, "content-type": "application/json" },
    payload: SOURCE_INPUT,
  });
}

describe("Source API", () => {
  it("source API authenticates before parsing malformed or oversized write bodies", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      const cases = [
        { method: "GET" as const, url: "/api/sources?invalid=true" },
        { method: "GET" as const, url: "/api/sources/source-1?invalid=true" },
        {
          method: "POST" as const,
          url: "/api/sources?invalid=true",
          headers: { "content-type": "text/plain" },
          payload: "not-json",
        },
        {
          method: "PATCH" as const,
          url: "/api/sources/source-1",
          headers: { "content-type": "application/json" },
          payload: "{not-json",
        },
        {
          method: "POST" as const,
          url: "/api/sources",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
        },
      ];

      for (const request of cases) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(401);
        expect(response.headers["www-authenticate"]).toBe("Bearer");
        expect(response.json()).toEqual({ error: "unauthorized" });
      }

      const wrongToken = await app.inject({
        method: "POST",
        url: "/api/sources",
        headers: {
          authorization: "Bearer wrong-token",
          "content-type": "application/json",
        },
        payload: SOURCE_INPUT,
      });
      expect(wrongToken.statusCode).toBe(401);
      expect(sourceCount(databasePath)).toBe(0);
    });
  });

  it("source API rejects duplicate Authorization on every Source write before repositories", async () => {
    await withDatabasePath(async (databasePath) => {
      const seedApp = await buildApp(
        config(databasePath),
        new CapturedLogger(),
      );
      let source: Source;
      try {
        const created = await createSource(seedApp);
        expect(created.statusCode).toBe(201);
        source = created.json();
      } finally {
        await seedApp.close();
      }

      const rowsBefore = sourceRows(databasePath);
      const create = vi.fn((): never => {
        throw new Error("duplicate authorization reached create");
      });
      const update = vi.fn((): never => {
        throw new Error("duplicate authorization reached update");
      });
      const topic = vi.fn((): never => {
        throw new Error("duplicate authorization reached Topic repository");
      });
      const repositories: ConfigurationRepositories = {
        source: {
          create,
          getById: () => source,
          list: () => [source],
          listEnabled: () => [source],
          update,
        },
        topic: {
          create: topic,
          getById: topic,
          list: topic,
          listEnabled: topic,
          update: topic,
        },
      };
      const app = await buildApp(config(databasePath), new CapturedLogger(), {
        repositories,
      });

      try {
        const authorization = [`Bearer ${API_TOKEN}`, `Bearer ${API_TOKEN}`];
        const requests = [
          {
            method: "POST" as const,
            url: "/api/sources",
            payload: SOURCE_INPUT,
          },
          {
            method: "POST" as const,
            url: "/api/sources",
            payload: "{not-json",
          },
          {
            method: "PATCH" as const,
            url: `/api/sources/${source.id}`,
            payload: { name: "Renamed Source" },
          },
          {
            method: "PATCH" as const,
            url: `/api/sources/${source.id}`,
            payload: "{not-json",
          },
        ];

        for (const request of requests) {
          const response = await app.inject({
            ...request,
            headers: {
              authorization,
              "content-type": "application/json",
            } as never,
          });
          expect(response.statusCode).toBe(401);
          expect(response.headers["www-authenticate"]).toBe("Bearer");
          expect(response.json()).toEqual({ error: "unauthorized" });
        }

        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(sourceRows(databasePath)).toEqual(rowsBefore);
      } finally {
        await app.close();
      }
    });
  });

  it("source API leaves unknown routes and methods as unauthenticated 404s", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      for (const request of [
        { method: "GET" as const, url: "/api/not-a-configuration-route" },
        { method: "GET" as const, url: "/api/sources/source-1/unknown" },
        { method: "DELETE" as const, url: "/api/sources" },
        { method: "DELETE" as const, url: "/api/sources/source-1" },
      ]) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(404);
      }

      expect(sourceCount(databasePath)).toBe(0);
    });
  });

  it("source API accepts only bounded application/json write bodies", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      const textPlain = await app.inject({
        method: "POST",
        url: "/api/sources",
        headers: { ...AUTHORIZATION, "content-type": "text/plain" },
        payload: JSON.stringify(SOURCE_INPUT),
      });
      expect(textPlain.statusCode).toBe(415);
      expect(textPlain.json()).toEqual({ error: "unsupported_media_type" });

      const missingType = await app.inject({
        method: "PATCH",
        url: "/api/sources/missing",
        headers: AUTHORIZATION,
      });
      expect(missingType.statusCode).toBe(415);

      const malformed = await app.inject({
        method: "POST",
        url: "/api/sources",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: "{not-json",
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ error: "invalid_request" });

      const oversized = await app.inject({
        method: "POST",
        url: "/api/sources",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json()).toEqual({ error: "payload_too_large" });
      expect(sourceCount(databasePath)).toBe(0);
    });
  });

  it("source API rejects every query string without repository side effects", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      for (const url of [
        "/api/sources?enabled=true",
        "/api/sources/source-1?invalid=true",
      ]) {
        const response = await app.inject({
          method: "GET",
          url,
          headers: AUTHORIZATION,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });
      }

      const write = await app.inject({
        method: "POST",
        url: "/api/sources?write=true",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: SOURCE_INPUT,
      });
      expect(write.statusCode).toBe(400);
      expect(sourceCount(databasePath)).toBe(0);
    });
  });

  it("source API creates, reads, lists, and patches the persisted Source contract", async () => {
    await withSourceApp(async ({ app }) => {
      const created = await createSource(app);
      expect(created.statusCode).toBe(201);
      const source = created.json();
      expect(source).toEqual({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        name: SOURCE_INPUT.name,
        type: "RSS",
        url: SOURCE_INPUT.url,
        cron: SOURCE_INPUT.cron,
        enabled: true,
        description: SOURCE_INPUT.description,
        last_collected_at: null,
      });

      const detail = await app.inject({
        method: "GET",
        url: `/api/sources/${source.id}`,
        headers: AUTHORIZATION,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toEqual(source);

      const list = await app.inject({
        method: "GET",
        url: "/api/sources",
        headers: AUTHORIZATION,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual({ items: [source] });

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/sources/${source.id}`,
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { name: "Renamed Source", cron: "0 * * * *", enabled: false },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toMatchObject({
        id: source.id,
        name: "Renamed Source",
        type: source.type,
        url: source.url,
        cron: "0 * * * *",
        enabled: false,
        description: source.description,
        last_collected_at: null,
      });
    });
  });

  it("source API lists every Source by id including disabled Sources after an empty list", async () => {
    await withSourceApp(async ({ app }) => {
      const empty = await app.inject({
        method: "GET",
        url: "/api/sources",
        headers: AUTHORIZATION,
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({ items: [] });

      const first = (await createSource(app)).json();
      const second = (await createSource(app)).json();
      const disabled = await app.inject({
        method: "PATCH",
        url: `/api/sources/${first.id}`,
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { enabled: false },
      });
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json()).toMatchObject({ id: first.id, enabled: false });

      const list = await app.inject({
        method: "GET",
        url: "/api/sources",
        headers: AUTHORIZATION,
      });
      expect(list.statusCode).toBe(200);
      const items = list.json<{ items: Array<Record<string, unknown>> }>()
        .items;
      const expected = [disabled.json(), second].sort((left, right) =>
        String(left.id) < String(right.id) ? -1 : 1,
      );
      expect(items).toEqual(expected);
      expect(items.map((item) => item.id)).toEqual(
        items.map((item) => item.id).sort(),
      );
      expect(items).toContainEqual(
        expect.objectContaining({ id: first.id, enabled: false }),
      );
      expect(items).toContainEqual(expect.objectContaining({ id: second.id }));
    });
  });

  it("source API rejects each immutable Source field without changing the Source or database", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      const source = (await createSource(app)).json();
      const immutableFields = [
        ["id", source.id],
        ["type", source.type],
        ["url", source.url],
        ["last_collected_at", source.last_collected_at],
      ] as const;

      for (const [field, value] of immutableFields) {
        const beforeSource = await app.inject({
          method: "GET",
          url: `/api/sources/${source.id}`,
          headers: AUTHORIZATION,
        });
        const beforeRows = sourceRows(databasePath);
        const response = await app.inject({
          method: "PATCH",
          url: `/api/sources/${source.id}`,
          headers: { ...AUTHORIZATION, "content-type": "application/json" },
          payload: { [field]: value },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });

        const afterSource = await app.inject({
          method: "GET",
          url: `/api/sources/${source.id}`,
          headers: AUTHORIZATION,
        });
        expect(afterSource.json()).toEqual(beforeSource.json());
        expect(sourceRows(databasePath)).toEqual(beforeRows);
      }

      expect(sourceRows(databasePath)).toHaveLength(1);
    });
  });

  it("source API maps strict input failures to safe 400 responses without writes", async () => {
    await withSourceApp(async ({ app, databasePath }) => {
      const invalidBodies: Array<Record<string, unknown> | unknown[] | null> = [
        null,
        [],
        {},
        { ...SOURCE_INPUT, name: "   " },
        { ...SOURCE_INPUT, enabled: "true" },
        { ...SOURCE_INPUT, url: "file:///private/feed.xml" },
        { ...SOURCE_INPUT, cron: "* * * *" },
        { ...SOURCE_INPUT, unknown_field: "must-not-leak" },
      ];

      for (const payload of invalidBodies) {
        const response = await app.inject({
          method: "POST",
          url: "/api/sources",
          headers: { ...AUTHORIZATION, "content-type": "application/json" },
          payload: payload ?? undefined,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "invalid_request" });
        expect(response.body).not.toContain("must-not-leak");
      }

      const created = await createSource(app);
      const source = created.json();
      const unknownField = await app.inject({
        method: "PATCH",
        url: `/api/sources/${source.id}`,
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { unknown_field: "must-not-leak" },
      });
      expect(unknownField.statusCode).toBe(400);
      expect(unknownField.json()).toEqual({ error: "invalid_request" });

      const unchanged = await app.inject({
        method: "GET",
        url: `/api/sources/${source.id}`,
        headers: AUTHORIZATION,
      });
      expect(unchanged.json()).toEqual(source);
      expect(sourceCount(databasePath)).toBe(1);
    });
  });

  it("source API returns exact not-found responses without exposing repository state", async () => {
    await withSourceApp(async ({ app }) => {
      const detail = await app.inject({
        method: "GET",
        url: "/api/sources/missing",
        headers: AUTHORIZATION,
      });
      expect(detail.statusCode).toBe(404);
      expect(detail.json()).toEqual({ error: "not_found" });

      const patch = await app.inject({
        method: "PATCH",
        url: "/api/sources/missing",
        headers: { ...AUTHORIZATION, "content-type": "application/json" },
        payload: { name: "Renamed Source" },
      });
      expect(patch.statusCode).toBe(404);
      expect(patch.json()).toEqual({ error: "not_found" });
    });
  });

  it("source API maps SQLite contention to 503 and hides unexpected failures", async () => {
    const baseSource: SourceRepository = {
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
    const topic = (): never => {
      throw new Error("topic must not be reached");
    };
    const repositories: ConfigurationRepositories = {
      source: baseSource,
      topic: {
        create: topic,
        getById: topic,
        list: topic,
        listEnabled: topic,
        update: topic,
      },
    };

    await withSourceApp(async ({ app }) => {
      const unavailable = await app.inject({
        method: "GET",
        url: "/api/sources",
        headers: AUTHORIZATION,
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ error: "storage_unavailable" });
      expect(unavailable.body).not.toContain("database detail");

      repositories.source.list = () => {
        throw new Error("unexpected database detail");
      };
      const failed = await app.inject({
        method: "GET",
        url: "/api/sources",
        headers: AUTHORIZATION,
      });
      expect(failed.statusCode).toBe(500);
      expect(failed.json()).toEqual({ error: "internal_error" });
      expect(failed.body).not.toContain("unexpected database detail");
    }, repositories);
  });

  it("source API registers only Source configuration routes", async () => {
    await withSourceApp(async ({ app }) => {
      for (const request of [
        { method: "GET" as const, url: "/api/topics" },
        { method: "POST" as const, url: "/api/topics" },
        { method: "PATCH" as const, url: "/api/topics/topic-1" },
      ]) {
        const response = await app.inject({
          ...request,
          headers: AUTHORIZATION,
        });
        expect(response.statusCode).toBe(404);
      }

      expect(app.hasRoute({ method: "GET", url: "/api/sources" })).toBe(true);
      expect(app.hasRoute({ method: "GET", url: "/api/topics" })).toBe(false);
    });
  });
});
