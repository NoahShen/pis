import type { FastifyInstance, FastifyRequest } from "fastify";

import { createBearerPreHandler } from "../auth.js";
import {
  InvalidRequestError,
  registerScopedErrorHandler,
  requireNoQuery,
} from "../configuration/http-errors.js";
import type { RetrievalRepositories } from "./index.js";

export interface RetrievalRouteDependencies {
  readonly apiToken: string;
  readonly repositories: RetrievalRepositories;
}

interface IdParams {
  readonly id: string;
}

const INVALID_ID = /[\u0000-\u001f\u007f]/u;

function id(request: FastifyRequest<{ Params: IdParams }>): string {
  const value = request.params.id;
  if (value.length === 0 || value.length > 256 || INVALID_ID.test(value)) {
    throw new InvalidRequestError();
  }
  return value;
}

export function registerRetrievalRoutes(
  app: FastifyInstance,
  dependencies: RetrievalRouteDependencies,
): void {
  void app.register(async (scope) => {
    scope.addHook("onRequest", createBearerPreHandler(dependencies.apiToken));
    scope.addHook("preValidation", async (request) => {
      requireNoQuery(request);
    });
    registerScopedErrorHandler(scope);

    const { repositories } = dependencies;

    scope.get<{ Params: IdParams }>(
      "/api/topics/:id/items",
      async (request, reply) => {
        const result = repositories.topics.listItems(id(request));
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get("/api/events", async () => repositories.events.list());

    scope.get<{ Params: IdParams }>(
      "/api/events/:id",
      async (request, reply) => {
        const result = repositories.events.getById(id(request));
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get<{ Params: IdParams }>(
      "/api/events/:id/updates",
      async (request, reply) => {
        const result = repositories.events.listUpdates(id(request));
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get<{ Params: IdParams }>(
      "/api/event-updates/:id",
      async (request, reply) => {
        const result = repositories.events.getUpdateById(id(request));
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get("/api/knowledge", async () =>
      repositories.knowledgeContent.listKnowledge(),
    );

    scope.get<{ Params: IdParams }>(
      "/api/knowledge/:id",
      async (request, reply) => {
        const result = repositories.knowledgeContent.getKnowledgeById(
          id(request),
        );
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get<{ Params: IdParams }>(
      "/api/contents/:id",
      async (request, reply) => {
        const result = repositories.knowledgeContent.getContentById(
          id(request),
        );
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get("/api/published-items", async () =>
      repositories.publishedItems.list(),
    );

    scope.get<{ Params: IdParams }>(
      "/api/published-items/:id",
      async (request, reply) => {
        const result = repositories.publishedItems.getById(id(request));
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );
  });
}
