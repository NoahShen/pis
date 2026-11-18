import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type {
  ContentDraft,
  ContentRecord,
  ContentRepository,
} from "./content-repository.js";
import type { ProcessingSourceItemRepository } from "./source-item-repository.js";

export interface ContentPersistenceDependencies {
  database: Database.Database;
  sourceItemRepository: ProcessingSourceItemRepository;
  contentRepository: ContentRepository;
}

export class ContentPersistence {
  private readonly database: Database.Database;
  private readonly sourceItemRepository: ProcessingSourceItemRepository;
  private readonly contentRepository: ContentRepository;

  constructor(dependencies: ContentPersistenceDependencies) {
    this.database = dependencies.database;
    this.sourceItemRepository = dependencies.sourceItemRepository;
    this.contentRepository = dependencies.contentRepository;
  }

  ensureContent(
    sourceItemId: string,
    draft: ContentDraft,
  ): ContentRecord | null {
    return withTransaction(this.database, () => {
      const sourceItem = this.sourceItemRepository.getById(sourceItemId);
      if (sourceItem === null) {
        return null;
      }

      if (sourceItem.content_id !== null) {
        const existingContent = this.contentRepository.getById(
          sourceItem.content_id,
        );
        if (existingContent === null) {
          throw new Error("Associated Content could not be read");
        }

        return existingContent;
      }

      const content = this.contentRepository.insert(draft);
      const linkedSourceItem = this.sourceItemRepository.setContentId(
        sourceItem.id,
        content.id,
      );

      if (
        linkedSourceItem.id !== sourceItem.id ||
        linkedSourceItem.content_id !== content.id
      ) {
        throw new Error(
          "Source Item Content association could not be verified",
        );
      }

      const readBackSourceItem = this.sourceItemRepository.getById(
        sourceItem.id,
      );
      if (
        readBackSourceItem === null ||
        readBackSourceItem.content_id !== content.id
      ) {
        throw new Error(
          "Source Item Content association could not be verified",
        );
      }

      return content;
    });
  }
}
