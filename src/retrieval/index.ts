import type Database from "better-sqlite3";

import type {
  EventRetrievalRepository,
  KnowledgeContentRetrievalRepository,
  PublishedItemRetrievalRepository,
  TopicRetrievalRepository,
} from "./contracts.js";
import { SqliteEventRetrievalRepository } from "./repositories/event-repository.js";
import { SqliteKnowledgeContentRetrievalRepository } from "./repositories/knowledge-content-repository.js";
import { SqlitePublishedItemRetrievalRepository } from "./repositories/published-item-repository.js";
import { SqliteTopicRetrievalRepository } from "./repositories/topic-repository.js";

export * from "./contracts.js";
export { registerRetrievalRoutes } from "./routes.js";
export type { RetrievalRouteDependencies } from "./routes.js";

export interface RetrievalRepositories {
  readonly topics: TopicRetrievalRepository;
  readonly events: EventRetrievalRepository;
  readonly knowledgeContent: KnowledgeContentRetrievalRepository;
  readonly publishedItems: PublishedItemRetrievalRepository;
}

export function createRetrievalRepositories(
  database: Database.Database,
): RetrievalRepositories {
  return {
    topics: new SqliteTopicRetrievalRepository(database),
    events: new SqliteEventRetrievalRepository(database),
    knowledgeContent: new SqliteKnowledgeContentRetrievalRepository(database),
    publishedItems: new SqlitePublishedItemRetrievalRepository(database),
  };
}
