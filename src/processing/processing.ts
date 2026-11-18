import { formatTimestamp } from "../time/format-time.js";

import type {
  ProcessOptions,
  ProcessResult,
  ProcessingDependencies,
  ProcessingService,
} from "./contracts.js";
import { ContentPersistence } from "./content-persistence.js";
import type { ContentDraft, ContentRecord } from "./content-repository.js";
import {
  normalizeRawDataSourceItem,
  type NormalizedContentDraft,
} from "./content-normalization.js";
import { routeCommittedContent } from "./content-router.js";
import { ProcessingError } from "./processing-errors.js";

function emptyResult(): ProcessResult {
  return { content_id: null, routes: [] };
}

function createDraft(
  normalized: NormalizedContentDraft,
  dependencies: ProcessingDependencies,
): ContentDraft {
  return {
    title: normalized.title,
    url: normalized.url,
    author: normalized.author,
    published_at: normalized.published_at,
    created_at: formatTimestamp(dependencies.clock.now()),
    body: normalized.body,
    summary: normalized.summary,
    language: null,
    completeness: normalized.completeness,
  };
}

function newSignal(options: ProcessOptions | undefined): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

async function routeContent(
  content: ContentRecord,
  dependencies: ProcessingDependencies,
  signal: AbortSignal,
): Promise<ProcessResult> {
  const response = await routeCommittedContent(
    content,
    dependencies.typedLlmCalls,
    dependencies.logger,
    signal,
  );

  return { content_id: content.id, routes: response.routes };
}

export function createProcessing(
  dependencies: ProcessingDependencies,
): ProcessingService {
  const persistence = new ContentPersistence(dependencies);

  return {
    async process(
      sourceItemId: string,
      options?: ProcessOptions,
    ): Promise<ProcessResult> {
      if (
        typeof sourceItemId !== "string" ||
        sourceItemId.trim().length === 0
      ) {
        throw new ProcessingError("invalid_input");
      }

      const signal = newSignal(options);
      if (signal.aborted) {
        throw new ProcessingError("aborted");
      }

      let sourceItem;
      try {
        sourceItem = dependencies.sourceItemRepository.getById(sourceItemId);
      } catch {
        throw new ProcessingError("processing_failed");
      }

      if (sourceItem === null) {
        return emptyResult();
      }

      if (sourceItem.content_id !== null) {
        let content: ContentRecord | null;
        try {
          content = dependencies.contentRepository.getById(
            sourceItem.content_id,
          );
        } catch {
          throw new ProcessingError("processing_failed");
        }

        if (content === null) {
          throw new ProcessingError("processing_failed");
        }

        return routeContent(content, dependencies, signal);
      }

      if (sourceItem.raw_data === null) {
        return emptyResult();
      }

      let normalized;
      try {
        normalized = normalizeRawDataSourceItem(sourceItem.raw_data);
      } catch {
        throw new ProcessingError("processing_failed");
      }

      if (!normalized.usable) {
        return emptyResult();
      }

      let content: ContentRecord | null;
      try {
        content = persistence.ensureContent(
          sourceItem.id,
          createDraft(normalized.content, dependencies),
        );
      } catch {
        throw new ProcessingError("processing_failed");
      }

      if (content === null) {
        return emptyResult();
      }

      return routeContent(content, dependencies, signal);
    },
  };
}
