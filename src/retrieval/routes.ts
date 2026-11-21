import type { FastifyInstance, FastifyRequest } from "fastify";

import { createBearerPreHandler } from "../auth.js";
import {
  InvalidRequestError,
  registerScopedErrorHandler,
} from "../configuration/http-errors.js";
import type { RetrievalRepositories } from "./index.js";
import { parseRetrievalQuery } from "./pagination.js";

export interface RetrievalRouteDependencies {
  readonly apiToken: string;
  readonly repositories: RetrievalRepositories;
}

declare module "fastify" {
  interface FastifyRequest {
    retrievalQuery?: import("./contracts.js").RetrievalListOptions;
  }
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
      const pathname = request.raw.url?.split("?", 1)[0] ?? "";
      if (
        pathname === "/api/topics" ||
        pathname.endsWith("/items") ||
        pathname === "/api/events" ||
        pathname.endsWith("/updates") ||
        pathname === "/api/knowledge" ||
        pathname === "/api/published-items"
      ) {
        const rawQuery = request.raw.url?.split("?", 2)[1];
        if (pathname === "/api/published-items") {
          request.retrievalQuery = parseRetrievalQuery(rawQuery, [
            "target_type",
            "published_after",
            "published_before",
          ]);
        } else if (pathname.endsWith("/items")) {
          request.retrievalQuery = parseRetrievalQuery(rawQuery, [
            "target_type",
          ]);
        } else {
          request.retrievalQuery = parseRetrievalQuery(rawQuery);
        }
      } else if (request.raw.url?.includes("?") === true) {
        throw new InvalidRequestError();
      }
    });
    registerScopedErrorHandler(scope);

    const { repositories } = dependencies;

    scope.get<{ Params: IdParams }>(
      "/api/topics/:id/items",
      async (request, reply) => {
        const result = repositories.topics.listItems(
          id(request),
          request.retrievalQuery,
        );
        if (result === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return result;
      },
    );

    scope.get("/api/events", async (request) =>
      repositories.events.list(request.retrievalQuery),
    );

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
        const result = repositories.events.listUpdates(
          id(request),
          request.retrievalQuery,
        );
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

    scope.get("/api/knowledge", async (request) =>
      repositories.knowledgeContent.listKnowledge(request.retrievalQuery),
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

    scope.get("/api/published-items", async (request) =>
      repositories.publishedItems.list(request.retrievalQuery),
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
