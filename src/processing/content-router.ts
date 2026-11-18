import type { JsonObject, TypedLlmCalls } from "../llm/llm-calls.js";
import type { ProcessingRouteResponse } from "../llm/response-validators.js";

import { ProcessingError, toProcessingError } from "./processing-errors.js";
import type { ProcessingLogger } from "./processing-logger.js";

export type ProcessingRoute = ProcessingRouteResponse["routes"][number];
export type RouteProcessingCall = Pick<TypedLlmCalls, "routeProcessing">;

export interface CommittedContentSnapshot {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly summary: string | null;
  readonly completeness: "FULL" | "PARTIAL";
  readonly url: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
}

export interface ProcessingRouteTaskData {
  readonly title: string;
  readonly body: string;
  readonly summary: string | null;
  readonly completeness: "FULL" | "PARTIAL";
  readonly url: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
}

function createTaskData(
  content: CommittedContentSnapshot,
): ProcessingRouteTaskData & JsonObject {
  return {
    title: content.title,
    body: content.body,
    summary: content.summary,
    completeness: content.completeness,
    url: content.url,
    author: content.author,
    published_at: content.published_at,
  };
}

function deduplicateRoutes(
  routes: readonly ProcessingRoute[],
): ProcessingRoute[] {
  return [...new Set(routes)];
}

function logSafely(
  logger: ProcessingLogger,
  metadata: Parameters<ProcessingLogger["log"]>[0],
): void {
  try {
    logger.log(metadata);
  } catch {
    // Logging is best-effort and must not replace a stable routing result.
  }
}

export async function routeCommittedContent(
  content: CommittedContentSnapshot,
  typedLlmCalls: RouteProcessingCall,
  logger: ProcessingLogger,
  signal: AbortSignal,
): Promise<ProcessingRouteResponse> {
  if (signal.aborted) {
    throw new ProcessingError("aborted");
  }

  let routes: ProcessingRoute[];
  try {
    const response = await typedLlmCalls.routeProcessing(
      createTaskData(content),
      {
        signal,
      },
    );
    if (signal.aborted) {
      throw new ProcessingError("aborted");
    }
    routes = deduplicateRoutes(response.routes);
  } catch (error) {
    const processingError = signal.aborted
      ? new ProcessingError("aborted")
      : toProcessingError(error, "llm_failed");

    logSafely(logger, {
      contentId: content.id,
      stage: "route",
      reason: processingError.code,
    });
    throw processingError;
  }

  logSafely(logger, {
    contentId: content.id,
    stage: "route",
    routeCount: routes.length,
  });
  return { routes };
}
