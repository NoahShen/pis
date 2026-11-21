import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import {
  registerRetrievalRoutes,
  type RetrievalRepositories,
} from "../retrieval/index.js";
import type { ConfigurationRepositories } from "./app-assembly.js";
import { registerSourceRoutes } from "./source-routes.js";
import { registerTopicRoutes } from "./topic-routes.js";

export function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repositories: ConfigurationRepositories,
  retrieval?: RetrievalRepositories,
): void {
  registerSourceRoutes(app, {
    apiToken: config.apiToken,
    sources: repositories.source,
  });
  registerTopicRoutes(app, {
    apiToken: config.apiToken,
    topics: repositories.topic,
  });
  if (retrieval !== undefined) {
    registerRetrievalRoutes(app, {
      apiToken: config.apiToken,
      repositories: retrieval,
    });
  }
}
