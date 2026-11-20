import { withTransaction } from "../database/transaction.js";
import { formatTimestamp } from "../time/format-time.js";

import type {
  PublicationContext,
  PublicationDependencies,
  PublicationDraft,
  PublicationErrorCode,
  PublicationService,
  PublicationTargetType,
  PublishResult,
  PublishedItem,
} from "./contracts.js";
import {
  normalizePublicationFailure,
  PublicationError,
} from "./publication-errors.js";
import { logPublication } from "./publication-logger.js";
import { appendSourceLinks, collectSourceLinks } from "./source-links.js";
import { TemplatePublicationRenderer } from "./template-renderer.js";

const DEFAULT_MAX_SOURCE_LINKS = 5;

type PersistOutcome =
  | {
      readonly kind: "existing";
      readonly item: PublishedItem;
    }
  | {
      readonly kind: "created";
      readonly item: PublishedItem;
    }
  | {
      readonly kind: "empty";
    };

function isPublicationTargetType(
  value: unknown,
): value is PublicationTargetType {
  return value === "EVENT" || value === "EVENT_UPDATE" || value === "KNOWLEDGE";
}

function resolveMaxSourceLinks(value: number | undefined): number {
  const max = value ?? DEFAULT_MAX_SOURCE_LINKS;
  if (!Number.isInteger(max) || max < 1 || max > 20) {
    throw new PublicationError("publication_failed");
  }

  return max;
}

function validatePublicationText(draft: PublicationDraft): void {
  if (
    draft.title.trim().length === 0 ||
    draft.summary.trim().length === 0 ||
    draft.body.trim().length === 0
  ) {
    throw new PublicationError("publication_failed");
  }
}

function emptyResult(): PublishResult {
  return {
    published_item_id: null,
    already_published: false,
  };
}

function existingResult(item: PublishedItem): PublishResult {
  return {
    published_item_id: item.id,
    already_published: true,
  };
}

function createdResult(item: PublishedItem): PublishResult {
  return {
    published_item_id: item.id,
    already_published: false,
  };
}

function failureReason(
  error: unknown,
  signal: AbortSignal | undefined,
): PublicationErrorCode {
  return normalizePublicationFailure(error, signal).code;
}

function publicationFeedFor(
  targetType: PublicationTargetType,
): "EVENT" | "KNOWLEDGE" {
  return targetType === "KNOWLEDGE" ? "KNOWLEDGE" : "EVENT";
}

function notifyAfterCommit(
  dependencies: PublicationDependencies,
  targetType: PublicationTargetType,
  targetId: string,
  item: PublishedItem,
): void {
  const notifier = dependencies.notify;
  if (notifier === undefined) {
    return;
  }

  const invoke = (): void => {
    try {
      const pending = notifier.notify(publicationFeedFor(targetType));
      if (pending !== undefined) {
        void Promise.resolve(pending).catch(() => {
          logPublication(dependencies.logger, {
            targetType,
            targetId,
            stage: "notify",
            reason: "notify_failed",
            publishedItemId: item.id,
          });
        });
      }
    } catch {
      logPublication(dependencies.logger, {
        targetType,
        targetId,
        stage: "notify",
        reason: "notify_failed",
        publishedItemId: item.id,
      });
    }
  };

  // Promise settlement is observed after the caller receives the committed
  // result. Notification remains detached and its failures stay best effort.
  queueMicrotask(() => {
    queueMicrotask(invoke);
  });
}

export function createPublication(
  dependencies: PublicationDependencies,
): PublicationService {
  const maxSourceLinks = resolveMaxSourceLinks(dependencies.maxSourceLinks);
  const renderer = dependencies.renderer ?? new TemplatePublicationRenderer();

  return {
    async publish(targetType, targetId, options): Promise<PublishResult> {
      if (
        !isPublicationTargetType(targetType) ||
        typeof targetId !== "string" ||
        targetId.trim().length === 0
      ) {
        logPublication(dependencies.logger, {
          stage: "check",
          reason: "invalid_input",
        });
        throw new PublicationError("invalid_input");
      }

      const signal = options?.signal;
      if (signal?.aborted === true) {
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason: "aborted",
        });
        throw new PublicationError("aborted");
      }

      let existing: PublishedItem | null;
      try {
        existing = dependencies.publishedItemRepository.findByTarget(
          targetType,
          targetId,
        );
      } catch (error) {
        const reason = failureReason(error, signal);
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason,
        });
        throw normalizePublicationFailure(error, signal);
      }

      if (existing !== null) {
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          publishedItemId: existing.id,
        });
        return existingResult(existing);
      }

      let context: PublicationContext | null;
      try {
        context = dependencies.targetRepository.getContext(
          targetType,
          targetId,
        );
      } catch (error) {
        const reason = failureReason(error, signal);
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason,
        });
        throw normalizePublicationFailure(error, signal);
      }

      if (context === null) {
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
        });
        return emptyResult();
      }

      let associated: boolean;
      try {
        associated = dependencies.targetRepository.hasAnyTopicAssociation(
          targetType,
          targetId,
        );
      } catch (error) {
        const reason = failureReason(error, signal);
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
          reason,
        });
        throw normalizePublicationFailure(error, signal);
      }

      if (!associated) {
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "check",
        });
        return emptyResult();
      }

      let item: PublishedItem;
      try {
        const urls = dependencies.sourceLinkRepository.listSourceUrls(
          targetType,
          targetId,
        );
        const links = collectSourceLinks(urls, maxSourceLinks);
        const draft = renderer.render(context);
        const body = appendSourceLinks(draft.body, links);
        validatePublicationText({ ...draft, body });
        item = {
          id: "",
          target_type: targetType,
          target_id: targetId,
          title: draft.title,
          summary: draft.summary,
          body,
          published_at: "",
        };
      } catch (error) {
        const reason = failureReason(error, signal);
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "render",
          reason,
        });
        throw normalizePublicationFailure(error, signal);
      }

      let outcome: PersistOutcome;
      try {
        outcome = withTransaction(dependencies.database, (): PersistOutcome => {
          const concurrent = dependencies.publishedItemRepository.findByTarget(
            targetType,
            targetId,
          );
          if (concurrent !== null) {
            return { kind: "existing", item: concurrent };
          }

          const transactionContext = dependencies.targetRepository.getContext(
            targetType,
            targetId,
          );
          if (transactionContext === null) {
            return { kind: "empty" };
          }

          const transactionAssociated =
            dependencies.targetRepository.hasAnyTopicAssociation(
              targetType,
              targetId,
            );
          if (!transactionAssociated) {
            return { kind: "empty" };
          }

          const now = dependencies.clock.now();
          const id = dependencies.idGenerator.next();
          const publishedAt = formatTimestamp(now);
          const inserted = dependencies.publishedItemRepository.insert({
            ...item,
            id,
            published_at: publishedAt,
          });
          return { kind: "created", item: inserted };
        });
      } catch (error) {
        const reason = failureReason(error, signal);
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "persist",
          reason,
        });
        throw normalizePublicationFailure(error, signal);
      }

      if (outcome.kind === "empty") {
        logPublication(dependencies.logger, {
          targetType,
          targetId,
          stage: "persist",
        });
        return emptyResult();
      }

      logPublication(dependencies.logger, {
        targetType,
        targetId,
        stage: "persist",
        publishedItemId: outcome.item.id,
      });

      if (outcome.kind === "existing") {
        return existingResult(outcome.item);
      }

      notifyAfterCommit(dependencies, targetType, targetId, outcome.item);
      return createdResult(outcome.item);
    },
  };
}
