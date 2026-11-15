import Fastify from "fastify";

import { afterEach, describe, expect, it } from "vitest";

import { createBearerPreHandler, isBearerAuthorized } from "../src/auth.js";

const apps: ReturnType<typeof Fastify>[] = [];

function buildAuthApp(token = "correct-token") {
  const app = Fastify({ logger: false });
  apps.push(app);

  app.get("/protected", { preHandler: createBearerPreHandler(token) }, async () => ({
    status: "ok",
  }));

  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("Bearer authentication", () => {
  it("isBearerAuthorized accepts case-insensitive scheme and exact case-sensitive token", () => {
    for (const authorization of [
      "Bearer correct-token",
      "bearer correct-token",
      "BEARER correct-token",
    ]) {
      expect(isBearerAuthorized(authorization, "correct-token")).toBe(true);
    }

    expect(isBearerAuthorized("Bearer Correct-Token", "correct-token")).toBe(false);
  });

  it("isBearerAuthorized rejects missing, malformed, extra-field and empty-token values", () => {
    for (const authorization of [
      undefined,
      "",
      "correct-token",
      "Basic correct-token",
      "Bearer",
      "Bearer ",
      "Bearer  correct-token",
      "Bearer correct-token extra",
      "Bearer\tcorrect-token",
      "Bearer correct-token ",
    ]) {
      expect(isBearerAuthorized(authorization, "correct-token")).toBe(false);
    }
  });

  it("isBearerAuthorized rejects token length difference and other mismatches as 401", () => {
    expect(isBearerAuthorized("Bearer shorter", "longer-token")).toBe(false);
    expect(isBearerAuthorized("Bearer longer-token", "shorter")).toBe(false);
    expect(isBearerAuthorized("Bearer correct-token", "correct-Token")).toBe(false);
  });

  it("returns 401 for missing, malformed and incorrect credentials", async () => {
    const app = buildAuthApp();

    const missing = await app.inject({ method: "GET", url: "/protected" });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toBe("Bearer");
    expect(missing.json()).toEqual({ error: "unauthorized" });

    const malformed = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer" },
    });
    expect(malformed.statusCode).toBe(401);

    const incorrect = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(incorrect.statusCode).toBe(401);
  });

  it("createBearerPreHandler rejects duplicate raw Authorization headers before value parsing", async () => {
    const app = buildAuthApp();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: {
        authorization: ["Bearer wrong-token", "Bearer correct-token"],
      } as never,
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns exactly {status: ok} for a correct token", async () => {
    const response = await buildAuthApp().inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer correct-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
