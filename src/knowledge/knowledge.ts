import { loadKnowledgeTaskData } from "./content-input.js";
import type {
  KnowledgeDependencies,
  KnowledgeOptions,
  KnowledgeResult,
  KnowledgeService,
} from "./contracts.js";
import { callKnowledgeAnalysis } from "./knowledge-call.js";
import {
  isKnowledgeAbort,
  KnowledgeError,
  normalizeKnowledgeError,
} from "./knowledge-errors.js";
import { logKnowledge, type KnowledgeLogger } from "./knowledge-logger.js";
import { KnowledgePersistence } from "./knowledge-persistence.js";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function dependencyFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): KnowledgeError {
  if (isSignalAborted(signal) || isKnowledgeAbort(error)) {
    return new KnowledgeError("aborted");
  }

  return normalizeKnowledgeError(error, "knowledge_failed");
}

function throwAborted(logger: KnowledgeLogger, contentId: string): never {
  logKnowledge(logger, {
    contentId,
    stage: "check",
    reason: "aborted",
  });
  throw new KnowledgeError("aborted");
}

export function createKnowledgeAnalysis(
  dependencies: KnowledgeDependencies,
): KnowledgeService {
  const persistence = new KnowledgePersistence(dependencies);

  return {
    async analyze(
      contentId: string,
      options?: KnowledgeOptions,
    ): Promise<KnowledgeResult> {
      if (typeof contentId !== "string" || contentId.trim().length === 0) {
        logKnowledge(dependencies.logger, {
          stage: "check",
          reason: "invalid_input",
        });
        throw new KnowledgeError("invalid_input");
      }

      const signal = options?.signal;
      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, contentId);
      }

      let existing;
      try {
        existing = dependencies.knowledgeRepository.getByContentId(contentId);
      } catch (error) {
        logKnowledge(dependencies.logger, {
          contentId,
          stage: "check",
          reason: isSignalAborted(signal) ? "aborted" : "knowledge_failed",
        });
        throw dependencyFailure(error, signal);
      }

      if (existing !== null) {
        if (isSignalAborted(signal)) {
          throwAborted(dependencies.logger, contentId);
        }

        logKnowledge(dependencies.logger, {
          contentId,
          knowledgeId: existing.id,
          stage: "reuse",
        });
        return { knowledge_id: existing.id };
      }

      let taskData;
      try {
        taskData = loadKnowledgeTaskData(
          dependencies.contentRepository,
          contentId,
        );
      } catch (error) {
        logKnowledge(dependencies.logger, {
          contentId,
          stage: "check",
          reason: isSignalAborted(signal) ? "aborted" : "knowledge_failed",
        });
        throw dependencyFailure(error, signal);
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, contentId);
      }

      if (taskData === null) {
        logKnowledge(dependencies.logger, {
          contentId,
          stage: "check",
        });
        return { knowledge_id: null };
      }

      const response = await callKnowledgeAnalysis(
        taskData,
        dependencies.typedLlmCalls,
        dependencies.logger,
        signal,
      );

      if (!response.valuable) {
        return { knowledge_id: null };
      }

      if (isSignalAborted(signal)) {
        throwAborted(dependencies.logger, contentId);
      }

      let knowledge;
      try {
        knowledge = persistence.ensureKnowledge({
          content_id: contentId,
          title: response.title,
          summary: response.summary,
          category: response.category ?? null,
          findings: response.findings,
          value: response.value,
        });
      } catch (error) {
        logKnowledge(dependencies.logger, {
          contentId,
          stage: "persist",
          reason: isSignalAborted(signal) ? "aborted" : "knowledge_failed",
          valuable: true,
        });
        throw dependencyFailure(error, signal);
      }

      logKnowledge(dependencies.logger, {
        contentId,
        knowledgeId: knowledge.id,
        stage: "persist",
        valuable: true,
      });
      return { knowledge_id: knowledge.id };
    },
  };
}
