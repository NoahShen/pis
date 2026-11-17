import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { AcquisitionResult } from "./collector.js";
import { getSourceItemIdentity } from "./source-item-identity.js";
import type {
  SourceItemDraft,
  SourceItemRepository,
} from "./source-item-repository.js";

export interface CollectionPersistenceResult {
  readonly new_source_item_ids: string[];
}

export interface CollectionPersistence {
  persist(
    sourceId: string,
    acquisition: AcquisitionResult,
  ): CollectionPersistenceResult;
}

export interface CollectionPersistenceDependencies {
  readonly database: Database.Database;
  readonly sourceItemRepository: Pick<
    SourceItemRepository,
    "existsByExternalId" | "existsByUrlAndPublishedAt" | "insert"
  >;
}

interface SourceCheckpointRow {
  last_collected_at: string | null;
}

const UPDATE_LAST_COLLECTED_AT = `
  UPDATE sources
  SET last_collected_at = ?
  WHERE id = ?
`;
const SELECT_LAST_COLLECTED_AT = `
  SELECT last_collected_at
  FROM sources
  WHERE id = ?
`;

function isAlreadyCollected(
  sourceId: string,
  draft: SourceItemDraft,
  repository: CollectionPersistenceDependencies["sourceItemRepository"],
): boolean {
  const identity = getSourceItemIdentity({
    source_id: draft.source_id,
    external_id: draft.external_id,
    url: draft.url,
    published_at: draft.published_at,
  });

  if (identity === null) {
    return false;
  }

  if (identity.kind === "external_id") {
    return repository.existsByExternalId(sourceId, identity.external_id);
  }

  return repository.existsByUrlAndPublishedAt(
    sourceId,
    identity.url,
    identity.published_at,
  );
}

class SqliteCollectionPersistence implements CollectionPersistence {
  constructor(
    private readonly dependencies: CollectionPersistenceDependencies,
  ) {}

  persist(
    sourceId: string,
    acquisition: AcquisitionResult,
  ): CollectionPersistenceResult {
    const startedAt = acquisition.startedAt;
    if (startedAt === null) {
      return { new_source_item_ids: [] };
    }

    return withTransaction(this.dependencies.database, () => {
      const newSourceItemIds: string[] = [];

      for (const draft of acquisition.drafts) {
        const sourceItemDraft: SourceItemDraft = {
          source_id: draft.entry.source_id,
          external_id: draft.entry.external_id,
          url: draft.entry.url,
          title: draft.entry.title,
          published_at: draft.entry.published_at,
          discovered_at: startedAt,
          content_id: null,
          raw_data: draft.raw_data,
        };

        if (
          isAlreadyCollected(
            sourceId,
            sourceItemDraft,
            this.dependencies.sourceItemRepository,
          )
        ) {
          continue;
        }

        const inserted =
          this.dependencies.sourceItemRepository.insert(sourceItemDraft);
        newSourceItemIds.push(inserted.id);
      }

      const updateResult = this.dependencies.database
        .prepare(UPDATE_LAST_COLLECTED_AT)
        .run(startedAt, sourceId);
      if (updateResult.changes !== 1) {
        throw new Error("Collection checkpoint did not match one Source");
      }

      const checkpoint = this.dependencies.database
        .prepare(SELECT_LAST_COLLECTED_AT)
        .get(sourceId) as SourceCheckpointRow | undefined;
      if (
        checkpoint === undefined ||
        checkpoint.last_collected_at !== startedAt
      ) {
        throw new Error("Collection checkpoint could not be read back");
      }

      return { new_source_item_ids: newSourceItemIds };
    });
  }
}

export function createCollectionPersistence(
  dependencies: CollectionPersistenceDependencies,
): CollectionPersistence {
  return new SqliteCollectionPersistence(dependencies);
}
