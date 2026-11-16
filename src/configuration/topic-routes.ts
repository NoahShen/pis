import type { FastifyInstance, FastifyRequest } from "fastify";

import { createBearerPreHandler } from "../auth.js";
import {
  isJsonMediaType,
  registerScopedErrorHandler,
  requireNoQuery,
  UnsupportedMediaTypeError,
} from "./http-errors.js";
import type { TopicRepository } from "./topic-repository.js";

interface TopicRouteDependencies {
  apiToken: string;
  topics: TopicRepository;
}

interface TopicIdParams {
  id: string;
}

function requestBody(request: FastifyRequest): unknown {
  return request.body;
}

export function registerTopicRoutes(
  app: FastifyInstance,
  dependencies: TopicRouteDependencies,
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
        items: dependencies.topics.list(),
      }));

      scope.get<{ Params: TopicIdParams }>("/:id", async (request, reply) => {
        const topic = dependencies.topics.getById(request.params.id);
        if (topic === null) {
          return reply.code(404).send({ error: "not_found" });
        }

        return topic;
      });

      scope.post("/", async (request, reply) => {
        const topic = dependencies.topics.create(requestBody(request));
        return reply.code(201).send(topic);
      });

      scope.patch<{ Params: TopicIdParams }>("/:id", async (request, reply) => {
        const topic = dependencies.topics.update(
          request.params.id,
          requestBody(request),
        );
        if (topic === null) {
          return reply.code(404).send({ error: "not_found" });
        }

        return topic;
      });
    },
    { prefix: "/api/topics" },
  );
}
