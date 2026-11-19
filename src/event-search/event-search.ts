import type { EventSearchResponse } from "../llm/response-validators.js";

import { loadEventCandidateContexts } from "./candidate-context.js";
import { rankEventCandidates } from "./candidate-ranking.js";
import type {
  EventCandidate,
  EventSearchDependencies,
  EventSearchOptions,
  EventSearchResult,
  EventSearchService,
} from "./contracts.js";
import { loadEventSearchTaskData } from "./content-input.js";
import type {
  EventCandidateClue,
  EventCandidateSearchResult,
} from "./event-candidate-repository.js";
import { callEventSearch } from "./event-search-call.js";
import { EventSearchError, isEventSearchAbort } from "./event-search-errors.js";
import {
  logEventSearchSafely,
  type EventSearchLogMetadata,
  type EventSearchLogger,
} from "./event-search-logger.js";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (isSignalAborted(signal)) {
    throw new EventSearchError("aborted");
  }
}

function failure(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: "event_search_failed" | "llm_failed",
): EventSearchError {
  if (signal?.aborted === true || isEventSearchAbort(error)) {
    return new EventSearchError("aborted");
  }

  return new EventSearchError(fallback);
}

function validateIntegerOption(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(message);
  }
}

function sameSearchTerms(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((term, index) => term === right[index])
  );
}

function sameClue(
  left: EventCandidateClue,
  right: EventCandidateClue,
): boolean {
  return (
    left.entity_name === right.entity_name &&
    left.subject === right.subject &&
    sameSearchTerms(left.search_terms, right.search_terms)
  );
}

function dedupeClues(
  clues: EventSearchResponse["clues"],
): EventCandidateClue[] {
  const unique: EventCandidateClue[] = [];

  for (const clue of clues) {
    if (!unique.some((existing) => sameClue(existing, clue))) {
      unique.push(clue);
    }
  }

  return unique;
}

function log(
  logger: EventSearchLogger,
  metadata: EventSearchLogMetadata,
): void {
  logEventSearchSafely(logger, metadata);
}

function loadContexts(
  dependencies: EventSearchDependencies,
  rankedHits: Parameters<typeof loadEventCandidateContexts>[1],
  maxUpdates: number,
  signal: AbortSignal | undefined,
): EventCandidate[] {
  try {
    return loadEventCandidateContexts(
      dependencies.database,
      rankedHits,
      maxUpdates,
      signal,
    );
  } catch (error) {
    throw failure(error, signal, "event_search_failed");
  }
}

export function createEventSearch(
  dependencies: EventSearchDependencies,
): EventSearchService {
  const maxCandidates =
    dependencies.maxCandidates === undefined ? 10 : dependencies.maxCandidates;
  const maxUpdates =
    dependencies.maxUpdates === undefined ? 10 : dependencies.maxUpdates;

  validateIntegerOption(
    maxCandidates,
    1,
    50,
    "maxCandidates must be an integer from 1 to 50",
  );
  validateIntegerOption(
    maxUpdates,
    0,
    100,
    "maxUpdates must be an integer from 0 to 100",
  );

  return {
    async search(
      contentId: string,
      options?: EventSearchOptions,
    ): Promise<EventSearchResult> {
      const signal = options?.signal;

      if (typeof contentId !== "string" || contentId.trim().length === 0) {
        log(dependencies.logger, {
          ...(typeof contentId === "string" ? { contentId } : {}),
          stage: "check",
          reason: "invalid_input",
        });
        throw new EventSearchError("invalid_input");
      }

      if (isSignalAborted(signal)) {
        log(dependencies.logger, {
          contentId,
          stage: "check",
          reason: "aborted",
        });
        throw new EventSearchError("aborted");
      }

      let taskData;
      try {
        taskData = loadEventSearchTaskData(
          dependencies.contentRepository,
          contentId,
        );
      } catch (error) {
        const mapped = failure(error, signal, "event_search_failed");
        log(dependencies.logger, {
          contentId,
          stage: "check",
          reason: mapped.code,
        });
        throw mapped;
      }

      if (isSignalAborted(signal)) {
        log(dependencies.logger, {
          contentId,
          stage: "check",
          reason: "aborted",
        });
        throw new EventSearchError("aborted");
      }

      if (taskData === null) {
        log(dependencies.logger, {
          contentId,
          candidateCount: 0,
          stage: "check",
        });
        return { candidates: [], reason: "missing_content" };
      }

      let response: EventSearchResponse;
      try {
        response = await callEventSearch(
          taskData,
          dependencies.typedLlmCalls,
          signal,
        );
      } catch (error) {
        const mapped =
          error instanceof EventSearchError
            ? error
            : failure(error, signal, "llm_failed");
        log(dependencies.logger, {
          contentId,
          stage: "extract",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);

      const clues = dedupeClues(response.clues);
      log(dependencies.logger, {
        contentId,
        clueCount: clues.length,
        stage: "extract",
      });

      if (clues.length === 0) {
        return { candidates: [], reason: "empty_clues" };
      }

      let searchResult: EventCandidateSearchResult;
      try {
        searchResult = dependencies.candidateRepository.search(clues);
      } catch (error) {
        const mapped = failure(error, signal, "event_search_failed");
        log(dependencies.logger, {
          contentId,
          clueCount: clues.length,
          stage: "search",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);

      if (searchResult.ignoredIndexRows > 0) {
        log(dependencies.logger, {
          contentId,
          clueCount: clues.length,
          stage: "search",
        });
      }

      log(dependencies.logger, {
        contentId,
        candidateCount: searchResult.hits.length,
        clueCount: clues.length,
        stage: "search",
      });

      let rankedHits;
      try {
        rankedHits = rankEventCandidates(searchResult.hits, maxCandidates);
      } catch (error) {
        const mapped = failure(error, signal, "event_search_failed");
        log(dependencies.logger, {
          contentId,
          stage: "context",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);
      let candidates: EventCandidate[];
      try {
        candidates = loadContexts(dependencies, rankedHits, maxUpdates, signal);
      } catch (error) {
        const mapped =
          error instanceof EventSearchError
            ? error
            : failure(error, signal, "event_search_failed");
        log(dependencies.logger, {
          contentId,
          candidateCount: rankedHits.length,
          clueCount: clues.length,
          stage: "context",
          reason: mapped.code,
        });
        throw mapped;
      }
      throwIfAborted(signal);

      log(dependencies.logger, {
        contentId,
        candidateCount: candidates.length,
        clueCount: clues.length,
        stage: "context",
      });

      return {
        candidates,
        reason: candidates.length === 0 ? "no_candidates" : "candidates",
      };
    },
  };
}
