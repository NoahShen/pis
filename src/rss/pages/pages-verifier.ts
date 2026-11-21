import { parseRssArchiveKey } from "../archive.js";
import { RSS_FEEDS } from "../feed.js";
import type { RssPublicationFile } from "../publisher/contracts.js";
import { RssPublisherError } from "../publisher/contracts.js";
import { RSS_NOJEKYLL_KEY } from "../publisher/staging.js";
import { rssPublicUrl } from "./git-client.js";

export interface RssPagesVerifierOptions {
  readonly publicOrigin: string;
  readonly publicDirectory?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetch?: typeof fetch;
  readonly maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function isPublicKey(key: string): boolean {
  if (key === RSS_NOJEKYLL_KEY) return true;
  if (
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#") ||
    key.startsWith("/")
  )
    return false;
  return Object.values(RSS_FEEDS).some((feed) => {
    if (key === feed.headKey || key === feed.pendingKey) return true;
    try {
      parseRssArchiveKey(feed, key);
      return true;
    } catch {
      return false;
    }
  });
}

async function readResponse(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.ok) throw new RssPublisherError("pages_unverified");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit)
    throw new RssPublisherError("pages_unverified");
  if (response.body === null) throw new RssPublisherError("pages_unverified");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RssPublisherError("pages_unverified");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RssPublisherError) throw error;
    throw new RssPublisherError("pages_unverified");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

export function createRssPagesVerifier(options: RssPagesVerifierOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  // Validate once before any public request; values are never normalized.
  rssPublicUrl(options.publicOrigin, RSS_NOJEKYLL_KEY, options.publicDirectory);

  return async function verify(
    files: readonly RssPublicationFile[],
  ): Promise<void> {
    for (const file of files) {
      if (!isPublicKey(file.key)) throw new RssPublisherError("invalid_input");
    }
    const deadline = Date.now() + timeoutMs;
    let matched = false;
    while (!matched) {
      if (Date.now() >= deadline) throw new RssPublisherError("timeout");
      matched = true;
      for (const file of files) {
        const controller = new AbortController();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new RssPublisherError("timeout");
        const timer = setTimeout(
          () => controller.abort(),
          Math.min(remaining, 30_000),
        );
        try {
          const response = await fetchImpl(
            rssPublicUrl(
              options.publicOrigin,
              file.key,
              options.publicDirectory,
            ),
            {
              redirect: "error",
              signal: controller.signal,
              headers: {
                accept:
                  "application/rss+xml, application/xml, text/plain, application/octet-stream",
              },
            },
          );
          const bytes = await readResponse(response, maxResponseBytes);
          if (!equal(bytes, file.bytes)) matched = false;
        } catch (error) {
          if (controller.signal.aborted) throw new RssPublisherError("timeout");
          // Public/deployment endpoints are advisory; origin bytes are authoritative.
          matched = false;
        } finally {
          clearTimeout(timer);
        }
        if (Date.now() >= deadline) throw new RssPublisherError("timeout");
      }
      if (!matched) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new RssPublisherError("timeout");
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(pollIntervalMs, remaining)),
        );
      }
    }
  };
}
