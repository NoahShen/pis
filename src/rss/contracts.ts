import type {
  PublicationFeed,
  PublishedItem,
} from "../publication/contracts.js";

export const RSS_HEAD_LIMIT = 200;
export const RSS_ARCHIVE_BATCH_SIZE = 200;

export type RssFeedKind = "EVENT_UPDATES" | "CURATED_CONTENT";

export interface RssFeedDefinition {
  readonly kind: RssFeedKind;
  readonly publicationFeed: PublicationFeed;
  readonly title: "PIS Event Updates" | "PIS Curated Content";
  readonly description: string;
  readonly headKey: "event-updates.xml" | "curated-content.xml";
  readonly pendingKey:
    "event-updates-pending.xml" | "curated-content-pending.xml";
  readonly archiveFilePrefix: "event-updates" | "curated-content";
}

export interface RssPublishedItemReader {
  list(feed: RssFeedKind): Promise<readonly PublishedItem[]>;
}

export interface RssArtifactStore {
  list(prefix: string): Promise<readonly string[]>;
  read(key: string): Promise<Uint8Array | null>;
  write(
    key: string,
    bytes: Uint8Array,
    options?: { readonly onlyIfAbsent?: boolean },
  ): Promise<void>;
}

export interface RssSyncOptions {
  readonly headLimit?: number;
  readonly archiveBatchSize?: number;
}

export interface RssSyncResult {
  readonly feed: RssFeedKind;
  readonly headKey: string;
  readonly pendingKey: string;
  readonly pendingGuidCount: number;
  readonly existingArchiveKeys: readonly string[];
  readonly createdArchiveKeys: readonly string[];
  readonly archivedOnlyGuidCount: number;
}

export interface RssSyncService {
  sync(feed: RssFeedKind): Promise<RssSyncResult>;
}

export type RssErrorCode =
  | "invalid_input"
  | "invalid_time"
  | "invalid_xml_character"
  | "invalid_archive"
  | "invalid_pending"
  | "archive_conflict"
  | "invalid_artifact_key"
  | "unsafe_path"
  | "artifact_exists"
  | "artifact_write_failed";

const RSS_ERROR_MESSAGES = Object.freeze({
  invalid_input: "Invalid RSS input",
  invalid_time: "Invalid RSS publication time",
  invalid_xml_character: "RSS content contains an invalid XML character",
  invalid_archive: "Invalid RSS archive document",
  invalid_pending: "Invalid RSS pending document",
  archive_conflict: "RSS archive conflict",
  invalid_artifact_key: "Invalid RSS artifact key",
  unsafe_path: "Unsafe RSS artifact path",
  artifact_exists: "RSS artifact already exists",
  artifact_write_failed: "RSS artifact write failed",
} as const satisfies Readonly<Record<RssErrorCode, string>>);

export class RssError extends Error {
  readonly code: RssErrorCode;

  constructor(code: RssErrorCode) {
    super(RSS_ERROR_MESSAGES[code]);
    this.name = "RssError";
    this.code = code;
  }
}
