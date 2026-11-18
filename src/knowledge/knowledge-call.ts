import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { KnowledgeAnalysisResponse } from "../llm/response-validators.js";

import type { KnowledgeTaskData } from "./content-input.js";
import {
  isKnowledgeAbort,
  KnowledgeError,
  normalizeKnowledgeError,
} from "./knowledge-errors.js";
import { logKnowledge, type KnowledgeLogger } from "./knowledge-logger.js";

export type KnowledgeAnalysisCalls = Pick<TypedLlmCalls, "analyzeKnowledge">;

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function callKnowledgeAnalysis(
  taskData: KnowledgeTaskData,
  typedLlmCalls: KnowledgeAnalysisCalls,
  logger: KnowledgeLogger | undefined,
  signal: AbortSignal | undefined,
): Promise<KnowledgeAnalysisResponse> {
  if (isSignalAborted(signal)) {
    logKnowledge(logger, { stage: "check", reason: "aborted" });
    throw new KnowledgeError("aborted");
  }

  try {
    const response = await typedLlmCalls.analyzeKnowledge(taskData, { signal });

    if (isSignalAborted(signal)) {
      throw new KnowledgeError("aborted");
    }

    logKnowledge(logger, { stage: "analyze", valuable: response.valuable });
    return response;
  } catch (error) {
    if (isSignalAborted(signal) || isKnowledgeAbort(error)) {
      logKnowledge(logger, { stage: "analyze", reason: "aborted" });
      throw new KnowledgeError("aborted");
    }

    logKnowledge(logger, { stage: "analyze", reason: "llm_failed" });
    throw normalizeKnowledgeError(error, "llm_failed");
  }
}
