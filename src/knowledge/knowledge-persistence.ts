import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { IdGenerator } from "../id/id-generator.js";

import type {
  KnowledgeDraft,
  KnowledgeRecord,
  KnowledgeRepository,
} from "./knowledge-repository.js";

export type KnowledgeDraftInput = Omit<KnowledgeDraft, "id"> & {
  id?: string;
};

export interface KnowledgePersistenceDependencies {
  database: Database.Database;
  knowledgeRepository: KnowledgeRepository;
  idGenerator: IdGenerator;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return false;
  }

  try {
    const code = (error as { code?: unknown }).code;
    return code === "SQLITE_CONSTRAINT_UNIQUE";
  } catch {
    return false;
  }
}

export class KnowledgePersistence {
  readonly #database: Database.Database;
  readonly #knowledgeRepository: KnowledgeRepository;
  readonly #idGenerator: IdGenerator;

  constructor(dependencies: KnowledgePersistenceDependencies) {
    this.#database = dependencies.database;
    this.#knowledgeRepository = dependencies.knowledgeRepository;
    this.#idGenerator = dependencies.idGenerator;
  }

  ensureKnowledge(draft: KnowledgeDraftInput): KnowledgeRecord {
    const values = {
      content_id: draft.content_id,
      title: draft.title,
      summary: draft.summary,
      category: draft.category,
      findings: draft.findings,
      value: draft.value,
    } satisfies Omit<KnowledgeDraft, "id">;

    try {
      return withTransaction(this.#database, () => {
        const existing = this.#knowledgeRepository.getByContentId(
          values.content_id,
        );
        if (existing !== null) {
          return existing;
        }

        const id = this.#idGenerator.next();
        const inserted = this.#knowledgeRepository.insert({ id, ...values });
        const readBack = this.#knowledgeRepository.getByContentId(
          values.content_id,
        );

        if (readBack === null || readBack.id !== inserted.id) {
          throw new Error("Inserted Knowledge could not be verified");
        }

        return readBack;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existing = this.#knowledgeRepository.getByContentId(
        values.content_id,
      );
      if (existing !== null) {
        return existing;
      }

      throw error;
    }
  }
}
