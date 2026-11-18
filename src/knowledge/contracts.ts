import type Database from "better-sqlite3";

import type { IdGenerator } from "../id/id-generator.js";
import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { ContentRepository } from "../processing/content-repository.js";

import type { KnowledgeLogger } from "./knowledge-logger.js";
import type { KnowledgeErrorCode } from "./knowledge-errors.js";
import type { KnowledgeRepository } from "./knowledge-repository.js";

export interface KnowledgeOptions {
  readonly signal?: AbortSignal;
}

export interface KnowledgeResult {
  knowledge_id: string | null;
}

export interface KnowledgeService {
  analyze(
    contentId: string,
    options?: KnowledgeOptions,
  ): Promise<KnowledgeResult>;
}

export type KnowledgeContentRepository = Pick<ContentRepository, "getById">;

export type KnowledgeRepositoryDependency = Pick<
  KnowledgeRepository,
  "getByContentId" | "insert"
>;

export type KnowledgeAnalysisCalls = Pick<TypedLlmCalls, "analyzeKnowledge">;

export type KnowledgeFailureCode = Exclude<
  KnowledgeErrorCode,
  "invalid_input" | "aborted"
>;

export interface KnowledgeDependencies {
  readonly database: Database.Database;
  readonly contentRepository: KnowledgeContentRepository;
  readonly knowledgeRepository: KnowledgeRepositoryDependency;
  readonly typedLlmCalls: KnowledgeAnalysisCalls;
  readonly idGenerator: IdGenerator;
  readonly logger: KnowledgeLogger;
}
