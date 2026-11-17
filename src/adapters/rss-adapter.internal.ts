import {
  snapshotSourceEntry,
  sourceContentSchema,
  type AdapterCallOptions,
  type AdapterSource,
  type SourceAdapter,
  type SourceContent,
  type SourceEntry,
} from "./contracts.js";
import { extractArticle } from "./article-extractor.js";
import { cleanSourceText } from "./content-cleaning.js";
import { AdapterError } from "./errors.js";
import { DEFAULT_ADAPTER_POLICY, type AdapterPolicy } from "./options.js";
import { createFeedReader } from "./rss/feed-reader.js";
import { AcquisitionError, type RssTransport } from "./transport.js";
import { z } from "zod";

export interface RssAdapterDependenciesOptions {
  readonly httpPolicy?: Readonly<AdapterPolicy>;
  readonly transport?: RssTransport;
}

export interface RssRuntimeDependencies {
  restrictedTransportFactory?: (
    signal: AbortSignal,
    policy: Readonly<AdapterPolicy>,
  ) => RssTransport;
}

function snapshotPolicy(
  policy: Readonly<AdapterPolicy>,
): Readonly<AdapterPolicy> {
  return Object.freeze({
    requestTimeoutMs: policy.requestTimeoutMs,
    maxRedirects: policy.maxRedirects,
    feedMaxBytes: policy.feedMaxBytes,
    articleMaxBytes: policy.articleMaxBytes,
    maxFeedEntries: policy.maxFeedEntries,
    articleMinTextChars: policy.articleMinTextChars,
  });
}

function contentWithFallback(
  entry: SourceEntry,
  summary: string | null,
  reason: SourceContent["article"]["reason"],
  status: SourceContent["article"]["status"],
  finalUrl: string | null,
): SourceContent {
  return sourceContentSchema.parse({
    schema_version: 1,
    entry,
    body: summary,
    summary,
    content_kind: summary === null ? "NONE" : "SUMMARY",
    acquired_via: summary === null ? "NONE" : "SOURCE_FALLBACK",
    completeness_basis: summary === null ? "NO_CONTENT" : "PARTIAL_ONLY",
    article: { status, reason, final_url: finalUrl },
  });
}

function noArticleUrl(
  entry: SourceEntry,
  summary: string | null,
): SourceContent {
  return sourceContentSchema.parse({
    schema_version: 1,
    entry,
    body: summary,
    summary,
    content_kind: summary === null ? "NONE" : "SUMMARY",
    acquired_via: summary === null ? "NONE" : "SOURCE_FALLBACK",
    completeness_basis: summary === null ? "NO_CONTENT" : "PARTIAL_ONLY",
    article: {
      status: "NOT_REQUESTED",
      reason: "no_article_url",
      final_url: null,
    },
  });
}

function isArticleFailureReason(
  reason: SourceContent["article"]["reason"],
): reason is
  | "blocked_url"
  | "dns_failed"
  | "network_error"
  | "timeout"
  | "http_status"
  | "redirect_limit"
  | "invalid_redirect"
  | "unsupported_mime"
  | "unsupported_encoding"
  | "response_too_large"
  | "extraction_failed"
  | "restricted_content" {
  switch (reason) {
    case "blocked_url":
    case "dns_failed":
    case "network_error":
    case "timeout":
    case "http_status":
    case "redirect_limit":
    case "invalid_redirect":
    case "unsupported_mime":
    case "unsupported_encoding":
    case "response_too_large":
    case "extraction_failed":
    case "restricted_content":
      return true;
    default:
      return false;
  }
}

function acceptedArticle(
  entry: SourceEntry,
  summary: string | null,
  text: string,
  finalUrl: string,
): SourceContent {
  return sourceContentSchema.parse({
    schema_version: 1,
    entry,
    body: text,
    summary,
    content_kind: "FULL_BODY",
    acquired_via: "ARTICLE_EXTRACT",
    completeness_basis: "ARTICLE_EXTRACTED",
    article: { status: "SUCCESS", reason: null, final_url: finalUrl },
  });
}

function restrictedFragment(
  entry: SourceEntry,
  summary: string | null,
  text: string | null,
  finalUrl: string | null,
): SourceContent {
  if (summary !== null) {
    return contentWithFallback(
      entry,
      summary,
      "restricted_content",
      "FAILED",
      finalUrl,
    );
  }
  return sourceContentSchema.parse({
    schema_version: 1,
    entry,
    body: text,
    summary,
    content_kind: text === null ? "NONE" : "FRAGMENT",
    acquired_via: text === null ? "NONE" : "ARTICLE_EXTRACT",
    completeness_basis: text === null ? "NO_CONTENT" : "PARTIAL_ONLY",
    article: {
      status: "FAILED",
      reason: "restricted_content",
      final_url: finalUrl,
    },
  });
}

interface RequestRace<T> {
  readonly promise: Promise<T>;
  dispose(): void;
}

function requestRace<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
): RequestRace<T> {
  const startRequest = (): Promise<T> => {
    try {
      return Promise.resolve(start());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  if (signal === undefined) {
    return { promise: startRequest(), dispose: () => undefined };
  }
  if (signal.aborted) {
    return {
      promise: Promise.reject(new AdapterError("aborted")),
      dispose: () => undefined,
    };
  }
  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new AdapterError("aborted"));
  });
  void aborted.catch(() => undefined);
  signal.addEventListener("abort", listener, { once: true });
  if (signal.aborted) {
    signal.removeEventListener("abort", listener);
    listener();
    return {
      promise: aborted,
      dispose: () => undefined,
    };
  }
  const request = startRequest();
  void request.catch(() => undefined);
  return {
    promise: Promise.race([request, aborted]),
    dispose: () => signal.removeEventListener("abort", listener),
  };
}

export function createRssAdapterWithDependencies(
  options: RssAdapterDependenciesOptions | undefined,
  dependencies: RssRuntimeDependencies,
): SourceAdapter {
  const policy = snapshotPolicy(options?.httpPolicy ?? DEFAULT_ADAPTER_POLICY);
  const injectedTransport = options?.transport;
  const factory = dependencies.restrictedTransportFactory;

  function transportFor(signal: AbortSignal): RssTransport {
    if (injectedTransport !== undefined) {
      return injectedTransport;
    }
    if (factory === undefined) {
      throw new AdapterError("network_error");
    }
    return factory(signal, policy);
  }

  const feedReaderFor = (transport: RssTransport) =>
    createFeedReader({ transport, policy });

  return {
    async fetchEntries(source, lastCollectedAt, callOptions) {
      const signal = callOptions?.signal;
      if (signal?.aborted) {
        throw new AdapterError("aborted");
      }
      const controller = new AbortController();
      let abortListener: (() => void) | undefined;
      if (signal !== undefined) {
        abortListener = () => controller.abort();
        signal.addEventListener("abort", abortListener, { once: true });
      }
      let transport: RssTransport;
      try {
        transport = transportFor(controller.signal);
      } catch (error) {
        if (signal !== undefined && abortListener !== undefined) {
          signal.removeEventListener("abort", abortListener);
        }
        throw error;
      }
      const raced = requestRace(
        () => feedReaderFor(transport).fetchEntries(source, lastCollectedAt),
        signal,
      );
      try {
        return await raced.promise;
      } finally {
        raced.dispose();
        if (signal !== undefined && abortListener !== undefined) {
          signal.removeEventListener("abort", abortListener);
        }
      }
    },

    async fetchContent(entry, callOptions) {
      const signal = callOptions?.signal;
      if (signal?.aborted) {
        throw new AdapterError("aborted");
      }
      let frozenEntry: SourceEntry;
      try {
        frozenEntry = snapshotSourceEntry(entry);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new AdapterError("invalid_source");
        }
        throw error;
      }
      const summary = cleanSourceText(frozenEntry.summary);
      const fullBody = cleanSourceText(frozenEntry.full_body);
      if (fullBody !== null) {
        return sourceContentSchema.parse({
          schema_version: 1,
          entry: frozenEntry,
          body: fullBody,
          summary,
          content_kind: "FULL_BODY",
          acquired_via: "SOURCE_FULL_FIELD",
          completeness_basis: "SOURCE_DECLARED",
          article: { status: "NOT_REQUESTED", reason: null, final_url: null },
        });
      }
      const articleUrl = frozenEntry.url;
      if (articleUrl === null) {
        return noArticleUrl(frozenEntry, summary);
      }
      if (signal?.aborted) {
        throw new AdapterError("aborted");
      }

      const controller = new AbortController();
      let abortListener: (() => void) | undefined;
      if (signal !== undefined) {
        abortListener = () => controller.abort();
        signal.addEventListener("abort", abortListener, { once: true });
      }
      let transport: RssTransport;
      try {
        transport = transportFor(controller.signal);
      } catch (error) {
        if (signal !== undefined && abortListener !== undefined) {
          signal.removeEventListener("abort", abortListener);
        }
        throw error;
      }
      let document: {
        readonly finalUrl: string;
        readonly body: string;
        readonly receivedResponse: true;
      };
      const raced = requestRace(
        () =>
          transport.fetch(
            Object.freeze({
              kind: "article",
              url: articleUrl,
              timeoutMs: policy.requestTimeoutMs,
              maxBytes: policy.articleMaxBytes,
            }),
          ),
        signal,
      );
      try {
        document = await raced.promise;
      } catch (error) {
        if (signal?.aborted === true) {
          throw new AdapterError("aborted");
        }
        if (error instanceof AdapterError && error.reason === "aborted") {
          throw error;
        }
        if (!(error instanceof AcquisitionError)) {
          throw error;
        }
        if (!isArticleFailureReason(error.reason)) {
          throw new AdapterError(error.reason);
        }
        const status = error.reason === "blocked_url" ? "BLOCKED" : "FAILED";
        return contentWithFallback(
          frozenEntry,
          summary,
          error.reason,
          status,
          error.receivedResponse ? error.finalUrl : null,
        );
      } finally {
        raced.dispose();
        if (signal !== undefined && abortListener !== undefined) {
          signal.removeEventListener("abort", abortListener);
        }
      }
      if (signal?.aborted === true) {
        throw new AdapterError("aborted");
      }

      const extracted = extractArticle(
        document.body,
        document.finalUrl,
        policy.articleMinTextChars,
      );
      if (extracted.restricted) {
        return restrictedFragment(
          frozenEntry,
          summary,
          extracted.text,
          document.finalUrl,
        );
      }
      if (extracted.text === null) {
        return contentWithFallback(
          frozenEntry,
          summary,
          "extraction_failed",
          "FAILED",
          document.finalUrl,
        );
      }
      return acceptedArticle(
        frozenEntry,
        summary,
        extracted.text,
        document.finalUrl,
      );
    },
  };
}
