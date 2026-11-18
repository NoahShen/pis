import type Database from "better-sqlite3";

import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { Clock } from "../time/clock.js";
import type { ContentRepository } from "./content-repository.js";
import type { ProcessingLogger as Logger } from "./processing-logger.js";
import type { ProcessingSourceItemRepository } from "./source-item-repository.js";

export type {
  ProcessingErrorCode,
  ProcessingFailureCode,
} from "./processing-errors.js";
export type { ProcessingLogger } from "./processing-logger.js";

export interface ProcessOptions {
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  content_id: string | null;
  routes: Array<"EVENT" | "KNOWLEDGE">;
}

export interface ProcessingService {
  process(
    sourceItemId: string,
    options?: ProcessOptions,
  ): Promise<ProcessResult>;
}

export type ProcessingContentRepository = Pick<
  ContentRepository,
  "getById" | "insert"
>;

export type ProcessingSourceItemRepositoryDependency = Pick<
  ProcessingSourceItemRepository,
  "getById" | "setContentId"
>;

export interface ProcessingDependencies {
  readonly database: Database.Database;
  readonly sourceItemRepository: ProcessingSourceItemRepositoryDependency;
  readonly contentRepository: ProcessingContentRepository;
  readonly typedLlmCalls: TypedLlmCalls;
  readonly clock: Clock;
  readonly logger: Logger;
}
