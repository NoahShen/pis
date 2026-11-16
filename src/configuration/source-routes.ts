import type { FastifyInstance, FastifyRequest } from "fastify";

import { createBearerPreHandler } from "../auth.js";
import type { SourceRepository } from "./source-repository.js";
import {
  isJsonMediaType,
  registerScopedErrorHandler,
  requireNoQuery,
  UnsupportedMediaTypeError,
} from "./http-errors.js";

interface SourceRouteDependencies {
  apiToken: string;
  sources: SourceRepository;
}

interface SourceIdParams {
  id: string;
}

function requestBody(request: FastifyRequest): unknown {
  return request.body;
}

export function registerSourceRoutes(
  app: FastifyInstance,
  dependencies: SourceRouteDependencies,
): void {
  void app.register(
    async (scope) => {
      scope.addHook("onRequest", createBearerPreHandler(dependencies.apiToken));
      registerScopedErrorHandler(scope);
      scope.addHook("preParsing", async (request) => {
        if (
          (request.method === "POST" || request.method === "PATCH") &&
          !isJsonMediaType(request.headers["content-type"])
        ) {
          throw new UnsupportedMediaTypeError();
        }
      });
      scope.addHook("preValidation", async (request) => {
        requireNoQuery(request);
      });

      scope.get("/", async () => ({
        items: dependencies.sources.list(),
      }));

      scope.get<{ Params: SourceIdParams }>("/:id", async (request, reply) => {
        const source = dependencies.sources.getById(request.params.id);
        if (source === null) {
          return reply.code(404).send({ error: "not_found" });
        }

        return source;
      });

      scope.post("/", async (request, reply) => {
        const source = dependencies.sources.create(requestBody(request));
        return reply.code(201).send(source);
      });

      scope.patch<{ Params: SourceIdParams }>(
        "/:id",
        async (request, reply) => {
          const source = dependencies.sources.update(
            request.params.id,
            requestBody(request),
          );
          if (source === null) {
            return reply.code(404).send({ error: "not_found" });
          }

          return source;
        },
      );
    },
    { prefix: "/api/sources" },
  );
}
