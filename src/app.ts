import { randomUUID } from "node:crypto";

import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from "fastify";

import {
  assembleApp,
  type AppDependencies,
} from "./configuration/app-assembly.js";
import { createBearerPreHandler } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

function pathWithoutQuery(url: string | undefined): string {
  if (url === undefined) {
    return "/";
  }

  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function buildApp(
  config: AppConfig,
  logger: Logger,
  dependencies?: AppDependencies,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
  });
  const requestStartedAt = new WeakMap<FastifyRequest, bigint>();

  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    const duration =
      startedAt === undefined
        ? 0
        : Number((process.hrtime.bigint() - startedAt) / 1_000n) / 1_000;

    try {
      logger.request({
        requestId: request.id,
        method: request.method,
        path: pathWithoutQuery(request.raw.url),
        status: reply.statusCode,
        duration,
      });
    } catch {
      // Request logging must not change the HTTP response.
    }
  });

  app.get(
    "/health",
    { preHandler: createBearerPreHandler(config.apiToken) },
    async (_request, reply) => {
      return reply.code(200).send({ status: "ok" });
    },
  );

  assembleApp(app, config, dependencies);

  return app;
}
