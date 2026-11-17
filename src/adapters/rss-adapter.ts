import type { SourceAdapter } from "./contracts.js";
import {
  DEFAULT_ADAPTER_POLICY,
  parseAdapterPolicy,
  type AdapterPolicy,
} from "./options.js";
import { createRestrictedRssTransport } from "./http/restricted-client.js";
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
  transport?: RssTransport;
}

export function createRssAdapter(
  options: RssAdapterOptions = {},
): SourceAdapter {
  const policy: Readonly<AdapterPolicy> = parseAdapterPolicy(
    options.httpPolicy ?? DEFAULT_ADAPTER_POLICY,
  );
  return createRssAdapterWithDependencies(
    { transport: options.transport, httpPolicy: policy },
    {
      restrictedTransportFactory(signal, requestPolicy) {
        return createRestrictedRssTransport({ signal, policy: requestPolicy });
      },
    },
  );
}
