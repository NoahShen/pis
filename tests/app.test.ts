import type { FastifyInstance } from "fastify";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ConfigurationRepositories } from "../src/configuration/app-assembly.js";
import type { AppConfig } from "../src/config.js";
import { CapturedLogger } from "./fixtures/captured-logger.js";

const API_TOKEN = "detector-application-token";
const BODY_SENTINEL = "detector-body-sentinel";
const QUERY_SENTINEL = "detector-query-sentinel";
const PATH_SENTINEL = "detector-path-sentinel";
const COOKIE_SENTINEL = "detector-cookie-sentinel";
const RSS_SENTINEL = "https://detector-rss-sentinel.example/private";
const config: AppConfig = {
  host: "127.0.0.1",
  port: 3000,
  apiToken: API_TOKEN,
  logLevel: "silent",
};
const apps: FastifyInstance[] = [];

const unusedRepositories: ConfigurationRepositories = {
  source: {
    create: () => {
      throw new Error("not used");
    },
    getById: () => null,
    list: () => [],
    listEnabled: () => [],
    update: () => null,
  },
  topic: {
    create: () => {
      throw new Error("not used");
    },
    getById: () => null,
    list: () => [],
    listEnabled: () => [],
    update: () => null,
  },
};

async function createApp(logger = new CapturedLogger()) {
  const app = await buildApp(config, logger, {
    repositories: unusedRepositories,
  });
  apps.push(app);
  return { app, logger };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("application", () => {
  it("GET /health with valid Bearer returns exact ok body", async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${API_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("GET /health unauthorized variants return exact 401 body and WWW-Authenticate", async () => {
    for (const authorization of [
      undefined,
      "Bearer wrong-token",
      `Basic ${API_TOKEN}`,
      "Bearer ",
      `Bearer ${API_TOKEN} extra`,
    ]) {
      const { app } = await createApp();
      const response = await app.inject({
        method: "GET",
        url: "/health",
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
      expect(response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("unregistered API and feed paths return 404 with no side effects", async () => {
    const { app, logger } = await createApp();

    for (const request of [
      { method: "GET" as const, url: `/api/${PATH_SENTINEL}` },
      {
        method: "POST" as const,
        url: `/feeds/${PATH_SENTINEL}?query=${QUERY_SENTINEL}`,
      },
    ]) {
      const response = await app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          cookie: `session=${COOKIE_SENTINEL}`,
          "x-rss-url": RSS_SENTINEL,
        },
        payload: request.method === "POST" ? BODY_SENTINEL : undefined,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).not.toHaveProperty("status");
    }

    const captured = JSON.stringify(logger.requestEntries);
    for (const sentinel of [
      API_TOKEN,
      BODY_SENTINEL,
      QUERY_SENTINEL,
      COOKIE_SENTINEL,
      RSS_SENTINEL,
    ]) {
      expect(captured).not.toContain(sentinel);
    }
  });

  it("logs request id, method, path only, status and duration", async () => {
    const { app, logger } = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/health?token=must-not-be-logged",
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        cookie: `session=${COOKIE_SENTINEL}`,
        "x-rss-url": RSS_SENTINEL,
      },
      payload: BODY_SENTINEL,
    });

    expect(response.statusCode).toBe(200);
    expect(logger.requestEntries).toHaveLength(1);

    const entry = logger.requestEntries[0];
    expect(entry).toMatchObject({
      method: "GET",
      path: "/health",
      status: 200,
    });
    expect(entry?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(entry?.duration).toBeGreaterThanOrEqual(0);
    for (const sentinel of [
      API_TOKEN,
      BODY_SENTINEL,
      QUERY_SENTINEL,
      COOKIE_SENTINEL,
      RSS_SENTINEL,
    ]) {
      expect(JSON.stringify(entry)).not.toContain(sentinel);
    }
  });

  it("captured logs include 401 response metadata", async () => {
    const { app, logger } = await createApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(401);
    expect(logger.requestEntries).toMatchObject([
      { path: "/health", status: 401 },
    ]);
  });

  it("keeps logging failures out of the request/response path", async () => {
    const logger = new CapturedLogger();
    logger.request = () => {
      throw new Error("logger unavailable");
    };
    const { app } = await createApp(logger);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${API_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("does not register an undocumented readiness route", async () => {
    const { app } = await createApp();

    expect(app.hasRoute({ method: "GET", url: "/ready" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/health" })).toBe(true);
  });
});

describe("module import boundary", () => {
  it("importing app/server modules has no listen or signal side effects", async () => {
    const signalCount =
      process.listenerCount("SIGINT") + process.listenerCount("SIGTERM");

    const serverModule = await import("../src/server.js");

    expect(serverModule.main).toBeTypeOf("function");
    expect(
      process.listenerCount("SIGINT") + process.listenerCount("SIGTERM"),
    ).toBe(signalCount);
  });
});
