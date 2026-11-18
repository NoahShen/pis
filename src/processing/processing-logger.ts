import type { ProcessingErrorCode } from "./processing-errors.js";

export type ProcessingLogStage = "route";
export type ProcessingLogReason = ProcessingErrorCode;

export interface ProcessingLogMetadata {
  readonly sourceItemId?: string;
  readonly contentId?: string;
  readonly stage: ProcessingLogStage;
  readonly reason?: ProcessingLogReason;
  readonly routeCount?: number;
}

export interface ProcessingLogger {
  log(metadata: ProcessingLogMetadata): void;
}
