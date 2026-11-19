import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type {
  EventAnalysisReferences,
  EventAnalysisResponse,
} from "../llm/response-validators.js";

import type { EventAnalysisTaskData } from "./content-input.js";
import {
  EventAnalysisError,
  isEventAnalysisAbort,
} from "./event-analysis-errors.js";

export type EventAnalysisCalls = Pick<TypedLlmCalls, "analyzeEvents">;

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isAbort(error: unknown): boolean {
  return (
    isEventAnalysisAbort(error) ||
    (error instanceof EventAnalysisError && error.code === "aborted")
  );
}

export async function callEventAnalysis(
  taskData: EventAnalysisTaskData,
  references: EventAnalysisReferences,
  typedLlmCalls: EventAnalysisCalls,
  signal: AbortSignal | undefined,
): Promise<EventAnalysisResponse> {
  if (isSignalAborted(signal)) {
    throw new EventAnalysisError("aborted");
  }

  try {
    const response = await typedLlmCalls.analyzeEvents(taskData, references, {
      signal,
    });

    if (isSignalAborted(signal)) {
      throw new EventAnalysisError("aborted");
    }

    return response;
  } catch (error) {
    if (isSignalAborted(signal) || isAbort(error)) {
      throw new EventAnalysisError("aborted");
    }

    throw new EventAnalysisError("llm_failed");
  }
}
