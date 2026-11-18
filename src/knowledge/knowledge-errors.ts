export type KnowledgeErrorCode =
  "invalid_input" | "aborted" | "knowledge_failed" | "llm_failed";

export const KNOWLEDGE_ERROR_MESSAGES = {
  invalid_input: "Invalid knowledge input",
  aborted: "Knowledge analysis was aborted",
  knowledge_failed: "Knowledge operation failed",
  llm_failed: "Knowledge LLM call failed",
} as const satisfies Record<KnowledgeErrorCode, string>;

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;

  constructor(code: KnowledgeErrorCode) {
    super(KNOWLEDGE_ERROR_MESSAGES[code]);
    this.name = "KnowledgeError";
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

export function isKnowledgeAbort(error: unknown): boolean {
  return (
    readErrorField(error, "name") === "AbortError" ||
    readErrorField(error, "code") === "ABORT_ERR"
  );
}

export function normalizeKnowledgeError(
  error: unknown,
  fallback: Exclude<KnowledgeErrorCode, "invalid_input" | "aborted">,
): KnowledgeError {
  if (isKnowledgeAbort(error)) {
    return new KnowledgeError("aborted");
  }

  return new KnowledgeError(fallback);
}
