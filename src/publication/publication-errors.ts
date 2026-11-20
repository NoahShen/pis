import type { PublicationErrorCode } from "./contracts.js";

const PUBLICATION_ERROR_MESSAGES = {
  invalid_input: "Invalid publication input",
  aborted: "Publication was aborted",
  publication_failed: "Publication operation failed",
} as const satisfies Record<PublicationErrorCode, string>;

export class PublicationError extends Error {
  readonly code: PublicationErrorCode;

  constructor(code: PublicationErrorCode) {
    super(PUBLICATION_ERROR_MESSAGES[code]);
    this.name = "PublicationError";
    this.code = code;
  }
}

function readErrorField(error: unknown, field: "name" | "code"): unknown {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    return (error as { readonly name?: unknown; readonly code?: unknown })[
      field
    ];
  } catch {
    return undefined;
  }
}

export function isPublicationAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR" ||
    readErrorField(error, "code") === "LLM_CANCELLED" ||
    readErrorField(error, "code") === "aborted" ||
    (error instanceof PublicationError && error.code === "aborted")
  );
}

export function normalizePublicationFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): PublicationError {
  if (signal?.aborted === true || isPublicationAbort(error)) {
    return new PublicationError("aborted");
  }

  return new PublicationError("publication_failed");
}
