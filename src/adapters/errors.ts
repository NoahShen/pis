import type { AdapterReason } from "./contracts.js";

const SAFE_MESSAGES: Readonly<Record<AdapterReason, string>> = Object.freeze({
  unsupported_source: "The source adapter does not support this source",
  invalid_source: "The source is invalid",
  unsupported_feed: "The feed format is not supported",
  invalid_feed: "The feed is invalid",
  blocked_url: "The URL is not allowed",
  dns_failed: "The host could not be resolved",
  network_error: "The network request failed",
  timeout: "The operation timed out",
  aborted: "The operation was aborted",
  http_status: "The remote server returned an error status",
  redirect_limit: "The redirect limit was exceeded",
  invalid_redirect: "The redirect is invalid",
  unsupported_mime: "The response media type is not supported",
  unsupported_encoding: "The response encoding is not supported",
  response_too_large: "The response exceeded its size limit",
  feed_too_many_entries: "The feed contains too many entries",
  extraction_failed: "Article extraction failed",
  restricted_content: "The article content is restricted",
  no_article_url: "The entry has no article URL",
});

export class AdapterError extends Error {
  readonly reason: AdapterReason;

  constructor(reason: AdapterReason) {
    super(SAFE_MESSAGES[reason]);
    this.name = "AdapterError";
    this.reason = reason;
  }
}
