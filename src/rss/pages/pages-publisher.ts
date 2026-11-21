import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { RSS_FEEDS, getRssFeed } from "../feed.js";
import { parseRssArchiveKey } from "../archive.js";
import type {
  RssFeedFileSet,
  RssPublicationFile,
  RssPublicationPublisher,
  RssPublishResult,
} from "../publisher/contracts.js";
import { RssPublisherError } from "../publisher/contracts.js";
import {
  RssGitClient,
  rssPublicKey,
  type RssGitClientOptions,
} from "./git-client.js";
import {
  createRssPagesVerifier,
  type RssPagesVerifierOptions,
} from "./pages-verifier.js";

export interface RssPagesPublisherOptions extends RssGitClientOptions {
  readonly publicOrigin: string;
  readonly publicDirectory?: string;
  readonly pollIntervalMs?: number;
  readonly verifier?: (files: readonly RssPublicationFile[]) => Promise<void>;
  readonly verifierOptions?: Omit<
    RssPagesVerifierOptions,
    "publicOrigin" | "publicDirectory"
  >;
}

function allowedKey(key: string): boolean {
  if (key === ".nojekyll") return true;
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

export class RssPagesPublisher implements RssPublicationPublisher {
  readonly #client: RssGitClient;
  readonly #publicDirectory: string;
  readonly #verify: (files: readonly RssPublicationFile[]) => Promise<void>;

  constructor(options: RssPagesPublisherOptions) {
    this.#publicDirectory = options.publicDirectory ?? "";
    rssPublicKey(".nojekyll", this.#publicDirectory);
    this.#client = new RssGitClient(options);
    this.#verify =
      options.verifier ??
      createRssPagesVerifier({
        publicOrigin: options.publicOrigin,
        publicDirectory: this.#publicDirectory,
        timeoutMs: options.timeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        ...options.verifierOptions,
      });
  }

  async publish(fileSet: RssFeedFileSet): Promise<RssPublishResult> {
    getRssFeed(fileSet.feed);
    const files = await this.#client.publish(async (client) => {
      const publicKeys = new Set<string>();
      for (const file of fileSet.files) {
        if (!allowedKey(file.key) || publicKeys.has(file.key)) {
          throw new RssPublisherError(
            publicKeys.has(file.key) ? "artifact_conflict" : "invalid_input",
          );
        }
        publicKeys.add(file.key);
      }
      // Keep the D12 keys unchanged; only the Git destination is prefixed.
      // Never scan/copy unrelated remote content into the public asset set.
      const existing: RssPublicationFile[] = [];
      const walk = async (directory: string, prefix = ""): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          const key = `${prefix}${entry.name}`;
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(absolute, `${key}/`);
          else if (entry.isFile() && allowedKey(key)) {
            existing.push({
              key,
              bytes: new Uint8Array(await readFile(absolute)),
            });
          }
        }
      };
      if (this.#publicDirectory.length > 0) {
        // Remove every legacy root PIS entry in this same migration commit.
        // Unknown files and all other directories are deliberately untouched.
        for (const entry of await readdir(client.workDirectory, {
          withFileTypes: true,
        })) {
          if (entry.isFile() && allowedKey(entry.name))
            await rm(path.join(client.workDirectory, entry.name), {
              force: true,
            });
        }
        try {
          const legacyArchives = await readdir(
            path.join(client.workDirectory, "archive"),
            { withFileTypes: true },
          );
          for (const entry of legacyArchives) {
            const key = `archive/${entry.name}`;
            if (entry.isFile() && allowedKey(key))
              await rm(path.join(client.workDirectory, key), { force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await walk(path.join(client.workDirectory, this.#publicDirectory));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        await walk(client.workDirectory);
      }
      const feed = getRssFeed(fileSet.feed);
      for (const file of existing) {
        const own =
          file.key === feed.headKey ||
          file.key === feed.pendingKey ||
          (() => {
            try {
              parseRssArchiveKey(feed, file.key);
              return true;
            } catch {
              return false;
            }
          })();
        if (own && !publicKeys.has(file.key))
          await rm(
            path.join(
              client.workDirectory,
              rssPublicKey(file.key, this.#publicDirectory),
            ),
            { force: true },
          );
      }
      for (const file of fileSet.files) {
        const key = rssPublicKey(file.key, this.#publicDirectory);
        const destination = path.join(client.workDirectory, key);
        await mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(destination, file.bytes, { mode: 0o600 });
        await client.stage(key);
      }
      // Stage deletions for stale archives belonging to this feed only.
      await client.stageAll();
      const result = await client.commit(`Publish ${fileSet.feed} RSS`);
      if (result.changed) await client.push(result.version);
      const published = new Map(existing.map((file) => [file.key, file]));
      for (const file of fileSet.files) published.set(file.key, file);
      for (const key of [...published.keys()]) {
        const own =
          key === feed.headKey ||
          key === feed.pendingKey ||
          (() => {
            try {
              parseRssArchiveKey(feed, key);
              return true;
            } catch {
              return false;
            }
          })();
        if (!allowedKey(key) || (own && !publicKeys.has(key)))
          published.delete(key);
      }
      await this.#verify([...published.values()]);
      return result;
    });
    return { feed: fileSet.feed, version: files.version, verified: true };
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

export function createRssPagesPublisher(
  options: RssPagesPublisherOptions,
): RssPagesPublisher {
  return new RssPagesPublisher(options);
}
