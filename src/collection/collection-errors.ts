import { AdapterError } from "../adapters/errors.js";

export const collectionErrorCodes = [
  "invalid_input",
  "unsupported_source",
  "aborted",
  "collection_failed",
] as const;

export type CollectionErrorCode = (typeof collectionErrorCodes)[number];

const SAFE_MESSAGES = Object.freeze({
  invalid_input: "Invalid collection input",
  unsupported_source: "The source adapter is not registered",
  aborted: "The collection operation was aborted",
  collection_failed: "The collection operation failed",
} satisfies Record<CollectionErrorCode, string>);

export class CollectionError extends Error {
  readonly code: CollectionErrorCode;

  constructor(code: CollectionErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "CollectionError";
    this.code = code;
  }
}

export function isCollectionAbort(error: unknown): boolean {
  if (error instanceof CollectionError) {
    return error.code === "aborted";
  }

  if (error instanceof AdapterError) {
    return error.reason === "aborted";
  }

  return error instanceof Error && error.name === "AbortError";
}

export function toStableCollectionError(error: unknown): CollectionError {
  if (error instanceof CollectionError && error.code === "aborted") {
    return error;
  }

  if (isCollectionAbort(error)) {
    return new CollectionError("aborted");
  }

  return new CollectionError("collection_failed");
}
