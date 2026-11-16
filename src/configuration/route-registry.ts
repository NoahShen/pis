import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import type { ConfigurationRepositories } from "./app-assembly.js";
import { registerSourceRoutes } from "./source-routes.js";
import { registerTopicRoutes } from "./topic-routes.js";

export function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  repositories: ConfigurationRepositories,
): void {
  registerSourceRoutes(app, {
    apiToken: config.apiToken,
    sources: repositories.source,
  });
  registerTopicRoutes(app, {
    apiToken: config.apiToken,
    topics: repositories.topic,
  });
}
