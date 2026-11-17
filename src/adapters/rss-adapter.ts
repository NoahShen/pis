import type { SourceAdapter } from "./contracts.js";
import {
  DEFAULT_ADAPTER_POLICY,
  parseAdapterPolicy,
  type AdapterPolicy,
} from "./options.js";
import type { RssTransport } from "./transport.js";
import { createRssAdapterWithDependencies } from "./rss-adapter.internal.js";

export interface RssHttpPolicy {
  requestTimeoutMs: number;
  maxRedirects: number;
  feedMaxBytes: number;
  articleMaxBytes: number;
  maxFeedEntries: number;
  articleMinTextChars: number;
}

export interface RssAdapterOptions {
  httpPolicy?: Partial<RssHttpPolicy>;
  transport: RssTransport;
}

export function createRssAdapter(options: RssAdapterOptions): SourceAdapter {
  if (options.transport === undefined) {
    throw new TypeError("An injected RSS transport is required");
  }
  const policy: Readonly<AdapterPolicy> = parseAdapterPolicy(
    options.httpPolicy ?? DEFAULT_ADAPTER_POLICY,
  );
  return createRssAdapterWithDependencies(
    { ...options, httpPolicy: policy },
    {},
  );
}
