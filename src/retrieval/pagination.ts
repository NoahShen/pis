import { InvalidRequestError } from "../configuration/http-errors.js";
import type { RetrievalCursor, RetrievalListOptions } from "./contracts.js";

export const DEFAULT_RETRIEVAL_LIMIT = 50;
export const MAX_RETRIEVAL_LIMIT = 200;

const LIMIT = /^(?:[1-9][0-9]*)$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[^\u0000-\u001f\u007f]{1,256}$/;
const ISO_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CURSOR_LENGTH = 2048;

export interface RetrievalQueryFilters {
  readonly target_type?: "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";
  readonly published_after?: string;
  readonly published_before?: string;
}

export function parseRetrievalQuery(
  query: string | undefined,
  allowedFilters: readonly (keyof RetrievalQueryFilters)[] = [],
): RetrievalListOptions {
  const parameters = new URLSearchParams(query ?? "");
  const allowed = new Set<string>(["limit", "cursor", ...allowedFilters]);
  const values = new Map<string, string>();
  for (const [key, value] of parameters) {
    if (!allowed.has(key) || values.has(key)) {
      throw new InvalidRequestError();
    }
    values.set(key, value);
  }

  const rawLimit = values.get("limit");
  let limit = DEFAULT_RETRIEVAL_LIMIT;
  if (rawLimit !== undefined) {
    if (!LIMIT.test(rawLimit)) throw new InvalidRequestError();
    limit = Number(rawLimit);
    if (limit > MAX_RETRIEVAL_LIMIT) throw new InvalidRequestError();
  }

  const filters: {
    -readonly [K in keyof RetrievalQueryFilters]?: RetrievalQueryFilters[K];
  } = {};
  const targetType = values.get("target_type");
  if (targetType !== undefined) {
    if (
      targetType !== "EVENT" &&
      targetType !== "EVENT_UPDATE" &&
      targetType !== "KNOWLEDGE"
    ) {
      throw new InvalidRequestError();
    }
    filters.target_type = targetType;
  }
  for (const key of ["published_after", "published_before"] as const) {
    const value = values.get(key);
    if (value !== undefined) {
      if (!ISO_OFFSET.test(value) || !Number.isFinite(Date.parse(value))) {
        throw new InvalidRequestError();
      }
      filters[key] = value;
    }
  }
  if (
    filters.published_after !== undefined &&
    filters.published_before !== undefined &&
    Date.parse(filters.published_after) > Date.parse(filters.published_before)
  ) {
    throw new InvalidRequestError();
  }

  const encodedCursor = values.get("cursor");
  const cursor =
    encodedCursor === undefined
      ? undefined
      : decodeRetrievalCursor(encodedCursor, filters);
  return { limit, cursor, ...filters };
}

export function decodeRetrievalCursor(
  encoded: string,
  filters: RetrievalQueryFilters,
): RetrievalCursor {
  if (
    encoded.length === 0 ||
    encoded.length > MAX_CURSOR_LENGTH ||
    !BASE64URL.test(encoded) ||
    encoded !== Buffer.from(encoded, "base64url").toString("base64url")
  ) {
    throw new InvalidRequestError();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidRequestError();
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRequestError();
  }
  const cursor = value as Record<string, unknown>;
  const filterEntries = Object.entries(filters).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedKeys = [
    "v",
    "time",
    "id",
    ...filterEntries.map(([key]) => key),
  ];
  const actualKeys = Object.keys(cursor);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(cursor, key)) ||
    cursor.v !== 1 ||
    typeof cursor.time !== "string" ||
    cursor.time.length === 0 ||
    cursor.time.length > 256 ||
    typeof cursor.id !== "string" ||
    !ID.test(cursor.id)
  ) {
    throw new InvalidRequestError();
  }
  for (const [key, filter] of filterEntries) {
    if (cursor[key] !== filter) throw new InvalidRequestError();
  }
  return { time: cursor.time, id: cursor.id };
}

export function encodeRetrievalCursor(
  cursor: RetrievalCursor,
  filters: RetrievalQueryFilters = {},
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, time: cursor.time, id: cursor.id, ...filters }),
    "utf8",
  ).toString("base64url");
}
