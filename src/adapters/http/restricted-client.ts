import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

import { Agent, Dispatcher, Pool } from "undici";

import type { AdapterPolicy } from "../options.js";
import {
  AcquisitionError,
  type RssTransport,
  type RssTransportDocument,
  type RssTransportRequest,
} from "../transport.js";
import {
  canonicalizeRestrictedUrl,
  createPinnedLookup,
  type DnsResolver,
  type PinnedDnsLookup,
  resolveRestrictedAddress,
  type DnsAddress,
  systemDnsResolver,
} from "./address-policy.js";
import {
  charsetFromContentType,
  decodeResponseBody,
  validateContentEncoding,
  validateContentType,
} from "./encoding.js";

const DISPATCHER_KEY = Symbol.for("undici.dispatcher");
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_HEADER_SIZE = 16 * 1024;
const CANCEL_TIMEOUT_MS = 250;
const CLEANUP_TIMEOUT_MS = CANCEL_TIMEOUT_MS;
const FIXED_USER_AGENT = "PIS-RSS/1.0";

type FetchInitWithDispatcher = RequestInit & {
  readonly dispatcher: Dispatcher;
  readonly [DISPATCHER_KEY]: Dispatcher;
};

interface FetchHeaders {
  [name: string]: string;
}

type NodeFetch = (
  input: URL,
  init: FetchInitWithDispatcher,
) => Promise<Response>;

export interface DispatcherObservation {
  readonly dispatcher: Dispatcher;
  close(): void;
  destroy(): void;
  cancelledReads(): number;
}

export interface RestrictedClientTracker {
  dispatcherCreated(observation: DispatcherObservation): void;
  dispatcherCloseStarted?(): void;
  dispatcherClosed?(): void;
  dispatcherDestroyStarted?(): void;
  dispatcherDestroyed?(): void;
  dispatcherCloseFailed?(): void;
  dispatcherDestroyFailed?(): void;
  lookupScheduled?(): void;
  lookupSettled?(): void;
  readerCancelled?(): void;
  activeHandles?(): number;
}

export interface RestrictedConnectorOptions {
  readonly hostname: string;
  readonly host?: string;
  readonly protocol: string;
  readonly port: string;
  readonly servername?: string;
  readonly localAddress?: string | null;
  readonly socketPath?: string | null;
  readonly httpSocket?: Socket;
}

export type RestrictedConnector = (
  options: RestrictedConnectorOptions & { readonly lookup: PinnedDnsLookup },
  callback: (...args: [null, Socket | TLSSocket] | [Error, null]) => void,
) => void;

export interface RestrictedClientDependencies {
  readonly resolver?: DnsResolver;
  readonly fetch?: NodeFetch;
  readonly dispatcherFactory?: (address: DnsAddress) => Dispatcher;
  readonly connector?: RestrictedConnector;
  readonly tracker?: RestrictedClientTracker;
}

export interface RestrictedClientOptions extends RestrictedClientDependencies {
  readonly signal: AbortSignal;
  readonly policy: AdapterPolicy;
}

interface HopResources {
  dispatcher: Dispatcher;
  observation: DispatcherObservation;
  settled: boolean;
}

function safeError(
  reason: "dns_failed" | "network_error" | "timeout" | "aborted",
  receivedResponse: boolean,
  finalUrl: string | null,
): AcquisitionError {
  return new AcquisitionError(reason, receivedResponse, finalUrl);
}

function knownReason(error: unknown): AcquisitionError | null {
  return error instanceof AcquisitionError ? error : null;
}

function classifyFetchError(
  error: unknown,
  signal: AbortSignal,
  receivedResponse: boolean,
  finalUrl: string | null,
): AcquisitionError {
  const acquisition = knownReason(error);
  if (acquisition !== null) {
    return acquisition;
  }
  if (signal.aborted) {
    return safeError("timeout", receivedResponse, finalUrl);
  }
  return safeError("network_error", receivedResponse, finalUrl);
}

async function raceWithSignal<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  receivedResponse: boolean,
  finalUrl: string | null,
): Promise<T> {
  const interrupted = (): AcquisitionError =>
    safeError("timeout", receivedResponse, finalUrl);
  if (signal.aborted) {
    throw interrupted();
  }
  let listener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(interrupted());
    signal.addEventListener("abort", listener, { once: true });
  });
  void aborted.catch(() => undefined);
  try {
    let pending: Promise<T> | undefined;
    let operationError: unknown;
    let operationThrew = false;
    try {
      pending = operation();
    } catch (error) {
      operationThrew = true;
      operationError = error;
    }
    if (operationThrew) {
      if (signal.aborted) {
        throw interrupted();
      }
      throw operationError;
    }
    if (signal.aborted) {
      void pending?.catch(() => undefined);
      throw interrupted();
    }
    return await Promise.race([pending as Promise<T>, aborted]);
  } finally {
    if (listener !== undefined) {
      signal.removeEventListener("abort", listener);
    }
  }
}

function closeObservation(observation: DispatcherObservation): void {
  try {
    observation.close();
  } catch {
    destroyObservation(observation);
  }
}

function destroyObservation(observation: DispatcherObservation): void {
  try {
    observation.destroy();
  } catch {
    // Cleanup is best-effort and never replaces the request result.
  }
}

function createObservation(
  dispatcher: Dispatcher,
  tracker: RestrictedClientTracker | undefined,
): DispatcherObservation {
  let closed = false;
  let destroyed = false;
  let cancelledReads = 0;
  const notify = (callback: (() => void) | undefined): void => {
    try {
      callback?.();
    } catch {
      // Observation callbacks cannot replace dispatcher state or leak rejections.
    }
  };
  const destroyDispatcher = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    let result: Promise<void>;
    try {
      result = Promise.resolve(dispatcher.destroy());
    } catch {
      notify(tracker?.dispatcherDestroyFailed);
      return;
    }
    void result.then(
      () => notify(tracker?.dispatcherDestroyed),
      () => notify(tracker?.dispatcherDestroyFailed),
    );
  };
  const observation: DispatcherObservation = {
    dispatcher,
    close() {
      if (closed || destroyed) {
        return;
      }
      closed = true;
      notify(tracker?.dispatcherCloseStarted);
      let finished = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (): boolean => {
        if (finished) {
          return false;
        }
        finished = true;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        return true;
      };
      timer = setTimeout(() => {
        timer = undefined;
        if (finish()) {
          destroyDispatcher();
        }
      }, CLEANUP_TIMEOUT_MS);
      let result: Promise<void>;
      try {
        result = Promise.resolve(dispatcher.close());
      } catch {
        finish();
        notify(tracker?.dispatcherCloseFailed);
        destroyDispatcher();
        return;
      }
      void result.then(
        () => {
          if (finish()) {
            notify(tracker?.dispatcherClosed);
          }
        },
        () => {
          if (finish()) {
            notify(tracker?.dispatcherCloseFailed);
            destroyDispatcher();
          }
        },
      );
    },
    destroy() {
      notify(tracker?.dispatcherDestroyStarted);
      destroyDispatcher();
    },
    cancelledReads() {
      return cancelledReads;
    },
  };
  const tracked: DispatcherObservation = Object.freeze({
    dispatcher,
    close: observation.close,
    destroy: observation.destroy,
    cancelledReads() {
      cancelledReads += 1;
      notify(tracker?.readerCancelled);
      return observation.cancelledReads();
    },
  });
  tracker?.dispatcherCreated(observation);
  return Object.freeze({
    dispatcher,
    close: observation.close,
    destroy: observation.destroy,
    cancelledReads: tracked.cancelledReads,
  });
}

function assertDispatcher(
  dispatcher: unknown,
): asserts dispatcher is Dispatcher {
  if (
    !(dispatcher instanceof Dispatcher) ||
    typeof dispatcher.dispatch !== "function" ||
    typeof dispatcher.close !== "function" ||
    typeof dispatcher.destroy !== "function"
  ) {
    throw new TypeError("The restricted HTTP dispatcher is incompatible");
  }
}

function createConnectorFactory(
  connector: RestrictedConnector,
  pinnedLookup: PinnedDnsLookup,
): Agent.Options["factory"] {
  return (origin, options) => {
    const configured = options as {
      readonly connect?: { readonly lookup?: unknown };
    };
    if (configured.connect?.lookup !== pinnedLookup) {
      throw new TypeError("The production dispatcher lost its pinned lookup");
    }
    const originUrl = new URL(origin);
    const defaultPort = originUrl.protocol === "https:" ? "443" : "80";
    return new Pool(origin, {
      ...(options as Pool.Options),
      connect: (connectOptions, callback) => {
        connector(
          {
            ...connectOptions,
            port: connectOptions.port || originUrl.port || defaultPort,
            servername:
              connectOptions.servername ??
              (originUrl.protocol === "https:"
                ? connectOptions.hostname
                : undefined),
            lookup: pinnedLookup,
          },
          callback,
        );
      },
    });
  };
}

function createProductionDispatcher(
  address: DnsAddress,
  connector?: RestrictedConnector,
): Dispatcher {
  const pinnedLookup: PinnedDnsLookup = createPinnedLookup(address);
  const agent = new Agent({
    connect: {
      lookup: pinnedLookup,
    },
    maxHeaderSize: MAX_HEADER_SIZE,
    ...(connector === undefined
      ? {}
      : { factory: createConnectorFactory(connector, pinnedLookup) }),
  });
  assertDispatcher(agent);
  return agent;
}

function requestHeaders(kind: "feed" | "article"): FetchHeaders {
  return {
    accept:
      kind === "feed"
        ? "application/rss+xml, application/atom+xml, application/xml, text/xml"
        : "text/html, application/xhtml+xml",
    "user-agent": FIXED_USER_AGENT,
  };
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  resources: HopResources,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    resources.observation.cancelledReads();
    await Promise.race([
      reader.cancel(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CANCEL_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // The dispatcher destroy below is the bounded cleanup fallback.
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function cancelResponseBody(
  response: Response,
  resources: HopResources,
): Promise<void> {
  if (response.body === null) {
    return;
  }
  const reader = response.body.getReader();
  try {
    await cancelReader(reader, resources);
  } finally {
    reader.releaseLock();
  }
}

async function readBody(
  response: Response,
  maxBytes: number,
  resources: HopResources,
  signal: AbortSignal,
  finalUrl: string,
): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await raceWithSignal(
        () => reader.read(),
        signal,
        true,
        finalUrl,
      );
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        throw new AcquisitionError("response_too_large", false, null);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    await cancelReader(reader, resources);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function drainRedirectBody(
  response: Response,
  resources: HopResources,
): Promise<void> {
  if (response.body === null) {
    return;
  }
  const reader = response.body.getReader();
  try {
    await cancelReader(reader, resources);
  } finally {
    reader.releaseLock();
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

function resolveRedirectUrl(location: string, currentUrl: URL): URL {
  if (
    location.trim().length === 0 ||
    /[\u0000-\u001f\u007f\\]/.test(location)
  ) {
    throw new AcquisitionError("invalid_redirect", false, null);
  }

  const scheme = /^[a-z][a-z\d+.-]*:/i.test(location);
  if (scheme && !/^[a-z][a-z\d+.-]*:\/\//i.test(location)) {
    throw new AcquisitionError("invalid_redirect", false, null);
  }

  let target: string;
  try {
    if (scheme) {
      target = location;
    } else if (location.startsWith("//")) {
      target = `${currentUrl.protocol}${location}`;
    } else {
      target = new URL(location, currentUrl).href;
    }
    new URL(target);
  } catch {
    throw new AcquisitionError("invalid_redirect", false, null);
  }
  return canonicalizeRestrictedUrl(target);
}

async function acquire(
  request: Readonly<RssTransportRequest>,
  signal: AbortSignal,
  policy: AdapterPolicy,
  dependencies: RestrictedClientDependencies,
): Promise<RssTransportDocument> {
  let currentUrl = canonicalizeRestrictedUrl(request.url);
  let finalUrl: string | null = null;
  let redirects = 0;
  const resolver = dependencies.resolver ?? systemDnsResolver;
  const fetchRequest: NodeFetch = dependencies.fetch ?? globalThis.fetch;
  const dispatcherFactory =
    dependencies.dispatcherFactory ??
    ((address: DnsAddress) =>
      createProductionDispatcher(address, dependencies.connector));

  while (true) {
    let address: DnsAddress;
    try {
      dependencies.tracker?.lookupScheduled?.();
      address = await raceWithSignal(
        () => resolveRestrictedAddress(currentUrl, resolver),
        signal,
        finalUrl !== null,
        finalUrl,
      );
      dependencies.tracker?.lookupSettled?.();
    } catch (error) {
      const known = knownReason(error);
      if (known !== null) {
        throw new AcquisitionError(known.reason, finalUrl !== null, finalUrl);
      }
      throw safeError("dns_failed", finalUrl !== null, finalUrl);
    }

    if (signal.aborted) {
      throw safeError("timeout", finalUrl !== null, finalUrl);
    }

    let dispatcher: Dispatcher;
    try {
      dispatcher = dispatcherFactory(address);
      assertDispatcher(dispatcher);
    } catch {
      throw safeError("network_error", finalUrl !== null, finalUrl);
    }
    const observation = createObservation(dispatcher, dependencies.tracker);
    const resources: HopResources = {
      dispatcher,
      observation,
      settled: false,
    };

    try {
      const response = await raceWithSignal(
        () =>
          fetchRequest(currentUrl, {
            method: "GET",
            headers: requestHeaders(request.kind),
            redirect: "manual",
            signal,
            dispatcher,
            [DISPATCHER_KEY]: dispatcher,
          }),
        signal,
        finalUrl !== null,
        finalUrl,
      );
      finalUrl = currentUrl.href;

      if (REDIRECT_STATUSES.has(response.status)) {
        await drainRedirectBody(response, resources);
        if (redirects >= policy.maxRedirects) {
          resources.settled = true;
          closeObservation(observation);
          throw new AcquisitionError("redirect_limit", true, finalUrl);
        }
        const location = response.headers.get("location");
        if (location === null || location.trim().length === 0) {
          resources.settled = true;
          closeObservation(observation);
          throw new AcquisitionError("invalid_redirect", true, finalUrl);
        }
        let nextUrl: URL;
        try {
          nextUrl = resolveRedirectUrl(location, currentUrl);
        } catch (error) {
          resources.settled = true;
          closeObservation(observation);
          throw new AcquisitionError(
            knownReason(error)?.reason ?? "invalid_redirect",
            true,
            finalUrl,
          );
        }
        if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
          resources.settled = true;
          closeObservation(observation);
          throw new AcquisitionError("invalid_redirect", true, finalUrl);
        }
        redirects += 1;
        currentUrl = nextUrl;
        resources.settled = true;
        closeObservation(observation);
        if (signal.aborted) {
          throw safeError("timeout", true, finalUrl);
        }
        continue;
      }

      if (
        response.status < 200 ||
        response.status > 299 ||
        response.status === 206 ||
        response.headers.has("content-range")
      ) {
        await cancelResponseBody(response, resources);
        throw new AcquisitionError("http_status", true, finalUrl);
      }

      if (response.status === 204 || response.status === 205) {
        await cancelResponseBody(response, resources);
        throw new AcquisitionError(
          request.kind === "feed" ? "invalid_feed" : "extraction_failed",
          true,
          finalUrl,
        );
      }

      const contentType = response.headers.get("content-type");
      try {
        validateContentType(contentType, request.kind);
        validateContentEncoding(response.headers.get("content-encoding"));
      } catch (error) {
        await cancelResponseBody(response, resources);
        throw error;
      }

      const contentLength = parseContentLength(
        response.headers.get("content-length"),
      );
      if (contentLength !== null && contentLength > request.maxBytes) {
        await cancelResponseBody(response, resources);
        throw new AcquisitionError("response_too_large", true, finalUrl);
      }

      let bytes: Uint8Array;
      try {
        bytes = await readBody(
          response,
          request.maxBytes,
          resources,
          signal,
          finalUrl,
        );
      } catch (error) {
        const known = knownReason(error);
        if (known !== null) {
          throw new AcquisitionError(known.reason, true, finalUrl);
        }
        throw classifyFetchError(error, signal, true, finalUrl);
      }

      let body: string;
      try {
        body = decodeResponseBody(
          bytes,
          request.kind,
          charsetFromContentType(contentType),
        );
      } catch (error) {
        const known = knownReason(error);
        if (known !== null) {
          throw new AcquisitionError(known.reason, true, finalUrl);
        }
        throw new AcquisitionError("unsupported_encoding", true, finalUrl);
      }

      resources.settled = true;
      closeObservation(observation);
      return { finalUrl, body, receivedResponse: true };
    } catch (error) {
      const known = knownReason(error);
      if (known !== null) {
        if (known.receivedResponse || finalUrl === null) {
          throw known;
        }
        throw new AcquisitionError(known.reason, true, finalUrl);
      }
      throw classifyFetchError(error, signal, finalUrl !== null, finalUrl);
    } finally {
      if (!resources.settled) {
        destroyObservation(observation);
      }
    }
  }
}

export function createRestrictedRssTransport(
  options: RestrictedClientOptions,
): RssTransport {
  const dependencies: RestrictedClientDependencies = {
    resolver: options.resolver,
    fetch: options.fetch,
    dispatcherFactory: options.dispatcherFactory,
    connector: options.connector,
    tracker: options.tracker,
  };
  return {
    async fetch(request) {
      if (options.signal.aborted) {
        throw new AcquisitionError("aborted", false, null);
      }
      const controller = new AbortController();
      let abortCause: "aborted" | "timeout" | null = null;
      const onCallerAbort = (): void => {
        abortCause ??= "aborted";
        controller.abort();
      };
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
      const timer = setTimeout(() => {
        abortCause ??= "timeout";
        controller.abort();
      }, request.timeoutMs);
      try {
        return await acquire(
          request,
          controller.signal,
          options.policy,
          dependencies,
        );
      } catch (error) {
        if (abortCause === "aborted") {
          const known = knownReason(error);
          throw new AcquisitionError(
            "aborted",
            known?.receivedResponse ?? false,
            known?.finalUrl ?? null,
          );
        }
        if (abortCause === "timeout") {
          const known = knownReason(error);
          throw new AcquisitionError(
            "timeout",
            known?.receivedResponse ?? false,
            known?.finalUrl ?? null,
          );
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", onCallerAbort);
      }
    },
  };
}
