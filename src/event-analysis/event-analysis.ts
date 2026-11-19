import { EventSearchError } from "../event-search/event-search-errors.js";

import type {
  EventAnalysisDependencies,
  EventAnalysisOptions,
  EventAnalysisResult,
  EventAnalysisService,
} from "./contracts.js";
import {
  buildEventAnalysisReferences,
  buildEventAnalysisTaskData,
  loadEventAnalysisContent,
  type EventAnalysisTaskData,
} from "./content-input.js";
import { persistEventAnalysis } from "./event-analysis-persistence.js";
import { callEventAnalysis } from "./event-analysis-call.js";
import {
  EventAnalysisError,
  isEventAnalysisAbort,
} from "./event-analysis-errors.js";
import { logEventAnalysisSafely } from "./event-analysis-logger.js";
import type { EventAnalysisReferences } from "../llm/response-validators.js";
import type { EventSearchResult } from "../event-search/contracts.js";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (isSignalAborted(signal)) {
    throw new EventAnalysisError("aborted");
  }
}

function mapD08Failure(
  error: unknown,
  signal: AbortSignal | undefined,
): EventAnalysisError {
  if (
    isSignalAborted(signal) ||
    isEventAnalysisAbort(error) ||
    (error instanceof EventSearchError && error.code === "aborted")
  ) {
    return new EventAnalysisError("aborted");
  }

  if (error instanceof EventSearchError) {
    switch (error.code) {
      case "invalid_input":
      case "llm_failed":
        return new EventAnalysisError(error.code);
      case "event_search_failed":
      case "aborted":
        return new EventAnalysisError("event_analysis_failed");
    }
  }

  return new EventAnalysisError("event_analysis_failed");
}

function mapFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: "event_analysis_failed" | "llm_failed",
): EventAnalysisError {
  if (isSignalAborted(signal) || isEventAnalysisAbort(error)) {
    return new EventAnalysisError("aborted");
  }

  return new EventAnalysisError(fallback);
}

function validateReason(
  result: EventSearchResult,
): EventAnalysisError | "stop" | "analyze" {
  const candidates = result.candidates;
  if (!Array.isArray(candidates)) {
    return new EventAnalysisError("event_analysis_failed");
  }

  switch (result.reason) {
    case "missing_content":
    case "empty_clues":
      return candidates.length === 0
        ? "stop"
        : new EventAnalysisError("event_analysis_failed");
    case "no_candidates":
      return candidates.length === 0
        ? "analyze"
        : new EventAnalysisError("event_analysis_failed");
    case "candidates":
      return candidates.length > 0
        ? "analyze"
        : new EventAnalysisError("event_analysis_failed");
    default:
      return new EventAnalysisError("event_analysis_failed");
  }
}

function log(
  dependencies: EventAnalysisDependencies,
  metadata: Parameters<typeof logEventAnalysisSafely>[1],
): void {
  logEventAnalysisSafely(dependencies.logger, metadata);
}

export function createEventAnalysis(
  dependencies: EventAnalysisDependencies,
): EventAnalysisService {
  return {
    async analyze(
      contentId: string,
      options?: EventAnalysisOptions,
    ): Promise<EventAnalysisResult> {
      const signal = options?.signal;

      if (typeof contentId !== "string" || contentId.trim().length === 0) {
        log(dependencies, {
          ...(typeof contentId === "string" ? { contentId } : {}),
          stage: "check",
          reason: "invalid_input",
        });
        throw new EventAnalysisError("invalid_input");
      }

      if (isSignalAborted(signal)) {
        log(dependencies, {
          contentId,
          stage: "check",
          reason: "aborted",
        });
        throw new EventAnalysisError("aborted");
      }

      let searchResult: EventSearchResult;
      try {
        searchResult = await dependencies.eventSearch.search(contentId, {
          signal,
        });
      } catch (error) {
        const mapped = mapD08Failure(error, signal);
        log(dependencies, {
          contentId,
          stage: "search",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);

      let decision;
      try {
        decision = validateReason(searchResult);
      } catch (error) {
        throw mapFailure(error, signal, "event_analysis_failed");
      }

      if (decision instanceof EventAnalysisError) {
        log(dependencies, {
          contentId,
          candidateCount: searchResult.candidates.length,
          stage: "search",
          reason: decision.code,
        });
        throw decision;
      }

      log(dependencies, {
        contentId,
        candidateCount: searchResult.candidates.length,
        stage: "search",
        reason: searchResult.reason,
      });

      if (decision === "stop") {
        return { new_targets: [] };
      }

      let content;
      try {
        content = loadEventAnalysisContent(
          dependencies.contentRepository,
          contentId,
        );
      } catch (error) {
        const mapped = mapFailure(error, signal, "event_analysis_failed");
        log(dependencies, {
          contentId,
          stage: "analyze",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);
      if (content === null) {
        log(dependencies, {
          contentId,
          stage: "analyze",
          reason: "event_analysis_failed",
        });
        throw new EventAnalysisError("event_analysis_failed");
      }

      let taskData: EventAnalysisTaskData;
      let references: EventAnalysisReferences;
      try {
        taskData = buildEventAnalysisTaskData(content, searchResult.candidates);
        references = buildEventAnalysisReferences(searchResult.candidates);
      } catch (error) {
        const mapped = mapFailure(error, signal, "llm_failed");
        log(dependencies, {
          contentId,
          stage: "analyze",
          reason: mapped.code,
        });
        throw mapped;
      }

      const response = await callEventAnalysis(
        taskData,
        references,
        dependencies.typedLlmCalls,
        signal,
      );
      const results = response.results;
      if (!Array.isArray(results)) {
        log(dependencies, {
          contentId,
          stage: "analyze",
          reason: "llm_failed",
        });
        throw new EventAnalysisError("llm_failed");
      }

      log(dependencies, {
        contentId,
        candidateCount: searchResult.candidates.length,
        resultCount: results.length,
        stage: "analyze",
      });

      if (results.length === 0) {
        return { new_targets: [] };
      }

      throwIfAborted(signal);

      let persisted: EventAnalysisResult;
      try {
        persisted = persistEventAnalysis(
          {
            database: dependencies.database,
            eventRepository: dependencies.eventRepository,
            idGenerator: dependencies.idGenerator,
            clock: dependencies.clock,
          },
          contentId,
          results,
        );
      } catch (error) {
        const mapped = mapFailure(error, signal, "event_analysis_failed");
        log(dependencies, {
          contentId,
          stage: "persist",
          reason: mapped.code,
        });
        throw mapped;
      }

      throwIfAborted(signal);
      log(dependencies, {
        contentId,
        newTargetCount: persisted.new_targets.length,
        stage: "persist",
      });

      return persisted;
    },
  };
}
