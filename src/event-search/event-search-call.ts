import type { TypedLlmCalls } from "../llm/llm-calls.js";
import type { EventSearchResponse } from "../llm/response-validators.js";

import type { EventSearchTaskData } from "./content-input.js";
import { EventSearchError, isEventSearchAbort } from "./event-search-errors.js";

export type EventSearchCalls = Pick<TypedLlmCalls, "searchEvents">;

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export async function callEventSearch(
  taskData: EventSearchTaskData,
  typedLlmCalls: EventSearchCalls,
  signal: AbortSignal | undefined,
): Promise<EventSearchResponse> {
  if (isSignalAborted(signal)) {
    throw new EventSearchError("aborted");
  }

  try {
    const response = await typedLlmCalls.searchEvents(taskData, { signal });

    if (isSignalAborted(signal)) {
      throw new EventSearchError("aborted");
    }

    return response;
  } catch (error) {
    if (isSignalAborted(signal) || isEventSearchAbort(error)) {
      throw new EventSearchError("aborted");
    }

    throw new EventSearchError("llm_failed");
  }
}
