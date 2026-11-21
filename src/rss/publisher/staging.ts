import type { RssFeedDefinition, RssFeedKind } from "../contracts.js";
import { parseRssArchiveKey } from "../archive.js";
import { getRssFeed } from "../feed.js";
import type { RssFeedFileSet, RssPublicationFile } from "./contracts.js";
import { RssPublisherError } from "./contracts.js";

export const RSS_NOJEKYLL_KEY = ".nojekyll";

export interface RssStagedFile {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export interface RssCommitIntent {
  readonly feed: RssFeedKind;
  readonly baseVersion: string;
  readonly remoteVersion: string;
  readonly files: readonly RssStagedFile[];
}

export interface RssRemoteVersionReader {
  readVersion(feed: RssFeedKind): Promise<string | null | undefined>;
}

export interface RssStagingRequest {
  readonly fileSet: RssFeedFileSet;
  readonly baseVersion: string;
}

function failInvalidInput(): never {
  throw new RssPublisherError("invalid_input");
}

function validatePublicationKey(feed: RssFeedDefinition, key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    failInvalidInput();
  }
  if (
    key.includes("\\") ||
    key.startsWith("/") ||
    key.includes("?") ||
    key.includes("#")
  ) {
    failInvalidInput();
  }

  const segments = key.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    failInvalidInput();
  }

  const isArchive = ((): boolean => {
    try {
      parseRssArchiveKey(feed, key);
      return true;
    } catch {
      return false;
    }
  })();

  const allowed =
    key === feed.headKey ||
    key === feed.pendingKey ||
    key === RSS_NOJEKYLL_KEY ||
    isArchive;
  if (!allowed) {
    failInvalidInput();
  }
}

function validateFileBytes(file: RssPublicationFile): void {
  if (!(file.bytes instanceof Uint8Array)) {
    failInvalidInput();
  }
}

function commitOrder(feed: RssFeedDefinition, key: string): number {
  if (key === feed.pendingKey) {
    return 1;
  }
  if (key === feed.headKey) {
    return 2;
  }
  if (key === RSS_NOJEKYLL_KEY) {
    return 3;
  }
  return 0;
}

export async function stageRssFeedFileSet(
  request: RssStagingRequest,
  remote: RssRemoteVersionReader,
): Promise<RssCommitIntent> {
  const fileSet = request.fileSet;
  if (
    typeof fileSet !== "object" ||
    fileSet === null ||
    typeof fileSet.feed !== "string"
  ) {
    failInvalidInput();
  }
  if (typeof request.baseVersion !== "string") {
    failInvalidInput();
  }

  let feed: RssFeedDefinition;
  try {
    feed = getRssFeed(fileSet.feed);
  } catch {
    failInvalidInput();
  }

  const files = fileSet.files;
  if (!Array.isArray(files) || files.length === 0) {
    failInvalidInput();
  }

  const seenKeys = new Set<string>();
  for (const file of files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.key !== "string"
    ) {
      failInvalidInput();
    }
    validatePublicationKey(feed, file.key);
    validateFileBytes(file);
    if (seenKeys.has(file.key)) {
      throw new RssPublisherError("artifact_conflict");
    }
    seenKeys.add(file.key);
  }

  if (
    !seenKeys.has(feed.headKey) ||
    !seenKeys.has(feed.pendingKey) ||
    !seenKeys.has(RSS_NOJEKYLL_KEY)
  ) {
    failInvalidInput();
  }

  const remoteVersion = (await remote.readVersion(feed.kind)) ?? "";
  if (remoteVersion !== request.baseVersion) {
    throw new RssPublisherError("non_fast_forward");
  }

  const staged = [...files].sort((left, right) => {
    const order = commitOrder(feed, left.key) - commitOrder(feed, right.key);
    if (order !== 0) {
      return order;
    }
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });

  return {
    feed: feed.kind,
    baseVersion: request.baseVersion,
    remoteVersion,
    files: staged.map((file) => ({
      key: file.key,
      bytes: Uint8Array.from(file.bytes),
    })),
  };
}
