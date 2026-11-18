export const PROCESSING_ERROR_CODES = [
  "invalid_input",
  "aborted",
  "processing_failed",
  "llm_failed",
] as const;

export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];
export type ProcessingFailureCode = Extract<
  ProcessingErrorCode,
  "processing_failed" | "llm_failed"
>;

const SAFE_MESSAGES = {
  invalid_input: "Invalid processing input",
  aborted: "Processing was aborted",
  processing_failed: "Processing failed",
  llm_failed: "LLM processing failed",
} as const satisfies Record<ProcessingErrorCode, string>;

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode;

  constructor(code: ProcessingErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "ProcessingError";
    this.code = code;
  }
}

function readErrorField(error: unknown, field: string): unknown {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    return (error as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

export function isProcessingAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR"
  );
}

export function toProcessingError(
  error: unknown,
  fallbackCode: ProcessingFailureCode,
): ProcessingError {
  return new ProcessingError(
    isProcessingAbort(error) ? "aborted" : fallbackCode,
  );
}
