import {
  snapshotAdapterSource,
  sourceEntriesSchema,
  type AdapterCallOptions,
  type AdapterSource,
  type SourceEntry,
} from "../contracts.js";
import { z } from "zod";
import { AdapterError } from "../errors.js";
import type { AdapterPolicy } from "../options.js";
import { AcquisitionError, type RssTransport } from "../transport.js";
import { parseFeedEntries } from "./feed-parser.js";
import { requireTransportUrl } from "./url-time.js";

export interface FeedReaderOptions {
  readonly transport: RssTransport;
  readonly policy: Readonly<AdapterPolicy>;
}

interface AbortRace<T> {
  readonly promise: Promise<T>;
  dispose(): void;
}

function startRequest<T>(start: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(start());
  } catch (error) {
    return Promise.reject(error);
  }
}

function raceWithAbort<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
): AbortRace<T> {
  if (signal === undefined) {
    return { promise: startRequest(start), dispose: () => undefined };
  }

  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new AdapterError("aborted"));
  });

  if (signal.aborted) {
    listener();
    return { promise: aborted, dispose: () => undefined };
  }

  signal.addEventListener("abort", listener, { once: true });
  if (signal.aborted) {
    signal.removeEventListener("abort", listener);
    listener();
    return { promise: aborted, dispose: () => undefined };
  }

  const request = startRequest(start);

  return {
    promise: Promise.race([request, aborted]),
    dispose: () => {
      if (listener !== undefined) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new AdapterError("aborted");
  }
}

function assertSupportedSource(source: AdapterSource): void {
  if (source.type.toUpperCase() !== "RSS") {
    throw new AdapterError("unsupported_source");
  }
}

function snapshotSource(source: AdapterSource): AdapterSource {
  try {
    return snapshotAdapterSource(source);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AdapterError("invalid_source");
    }
    throw error;
  }
}

function mapKnownTransportError(error: unknown): AdapterError {
  if (error instanceof AcquisitionError) {
    return new AdapterError(error.reason);
  }
  if (error instanceof AdapterError) {
    return error;
  }
  throw error;
}

function snapshotDependencies(dependencies: FeedReaderOptions): {
  readonly transport: RssTransport;
  readonly policy: Readonly<AdapterPolicy>;
} {
  const policy = Object.freeze({
    requestTimeoutMs: dependencies.policy.requestTimeoutMs,
    maxRedirects: dependencies.policy.maxRedirects,
    feedMaxBytes: dependencies.policy.feedMaxBytes,
    articleMaxBytes: dependencies.policy.articleMaxBytes,
    maxFeedEntries: dependencies.policy.maxFeedEntries,
    articleMinTextChars: dependencies.policy.articleMinTextChars,
  });
  return { transport: dependencies.transport, policy };
}

export function createFeedReader(dependencies: FeedReaderOptions) {
  const snapshot = snapshotDependencies(dependencies);
  return {
    async fetchEntries(
      source: AdapterSource,
      lastCollectedAt: string | null,
      options?: AdapterCallOptions,
    ): Promise<SourceEntry[]> {
      const signal = options?.signal;
      ensureNotAborted(signal);
      const frozenSource = snapshotSource(source);
      assertSupportedSource(frozenSource);
      const requestUrl = requireTransportUrl(frozenSource.url);
      void lastCollectedAt;

      let document: Awaited<ReturnType<RssTransport["fetch"]>>;
      const raced = raceWithAbort(
        () =>
          snapshot.transport.fetch(
            Object.freeze({
              kind: "feed",
              url: requestUrl,
              timeoutMs: snapshot.policy.requestTimeoutMs,
              maxBytes: snapshot.policy.feedMaxBytes,
            }),
          ),
        signal,
      );
      try {
        document = await raced.promise;
      } catch (error) {
        throw mapKnownTransportError(error);
      } finally {
        raced.dispose();
        ensureNotAborted(signal);
      }

      if (document.receivedResponse !== true) {
        throw new AdapterError("network_error");
      }

      ensureNotAborted(signal);
      const entries = parseFeedEntries(document.body, {
        finalUrl: document.finalUrl,
        policy: snapshot.policy,
        sourceId: frozenSource.id,
      });
      return sourceEntriesSchema.parse(entries);
    },
  };
}
