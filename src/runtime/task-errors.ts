import { classifySqliteError } from "../database/error-classification.js";

export type TaskErrorCategory = "retryable" | "non_retryable" | "cancelled";

function stableStringField(
  error: unknown,
  field: "name" | "code",
): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const value = (
      error as { readonly name?: unknown; readonly code?: unknown }
    )[field];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function classifyTaskError(error: unknown): {
  readonly category: TaskErrorCategory;
  readonly reason: string;
} {
  const name = stableStringField(error, "name");
  const code = stableStringField(error, "code");

  if (name === "AbortError") {
    return { category: "cancelled", reason: "AbortError" };
  }

  if (code === "ABORT_ERR" || code === "LLM_CANCELLED" || code === "aborted") {
    return { category: "cancelled", reason: code };
  }

  if (code !== undefined && code.endsWith("_failed")) {
    return { category: "retryable", reason: code };
  }

  if (
    code === "invalid_input" ||
    code === "target_not_found" ||
    code === "unsupported_source"
  ) {
    return { category: "non_retryable", reason: code };
  }

  const sqliteCategory = classifySqliteError(error);

  if (sqliteCategory === "busy_locked") {
    return { category: "retryable", reason: code ?? "busy_locked" };
  }

  if (sqliteCategory === "constraint") {
    return { category: "non_retryable", reason: code ?? "constraint" };
  }

  if (sqliteCategory === "sqlite" && code !== undefined) {
    return { category: "retryable", reason: code };
  }

  return { category: "retryable", reason: "unknown_error" };
}
