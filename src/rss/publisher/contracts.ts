import type { RssFeedKind } from "../contracts.js";

export interface RssPublicationFile {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export interface RssFeedFileSet {
  readonly feed: RssFeedKind;
  readonly files: readonly RssPublicationFile[];
}

export interface RssPublishResult {
  readonly feed: RssFeedKind;
  readonly version: string;
  readonly verified: boolean;
}

export interface RssPublicationPublisher {
  publish(files: RssFeedFileSet): Promise<RssPublishResult>;
}

export type RssPublisherErrorCode =
  | "invalid_input"
  | "artifact_conflict"
  | "non_fast_forward"
  | "push_failed"
  | "pages_unverified"
  | "timeout";

const PUBLISHER_ERROR_MESSAGES = Object.freeze({
  invalid_input: "Invalid RSS publication input",
  artifact_conflict: "RSS publication artifact conflict",
  non_fast_forward: "RSS publication remote branch is not fast-forward",
  push_failed: "RSS publication push failed",
  pages_unverified: "RSS publication pages verification failed",
  timeout: "RSS publication timed out",
} as const satisfies Readonly<Record<RssPublisherErrorCode, string>>);

export class RssPublisherError extends Error {
  readonly code: RssPublisherErrorCode;

  constructor(code: RssPublisherErrorCode) {
    super(PUBLISHER_ERROR_MESSAGES[code]);
    this.name = "RssPublisherError";
    this.code = code;
  }
}
