import type { RssFeedKind } from "../contracts.js";
import type {
  RssFeedFileSet,
  RssPublishResult,
  RssPublicationFile,
  RssPublicationPublisher,
} from "./contracts.js";
import { RssPublisherError } from "./contracts.js";
import { stageRssFeedFileSet } from "./staging.js";
import type { RssCommitIntent } from "./staging.js";

export type FakePublisherFault =
  "non_fast_forward" | "push_failed" | "pages_unverified";

export interface FakeRssCommitRecord {
  readonly feed: RssFeedFileSet["feed"];
  readonly version: string;
  readonly keys: readonly string[];
  readonly verified: boolean;
}

export interface FakeRssPublisherOptions {
  readonly baseVersion?: string;
  readonly version?: string | (() => string);
  readonly nonFastForwardFailures?: number;
  readonly pushFailures?: number;
  readonly pagesFailures?: number;
}

export interface FakeRssPublisher extends RssPublicationPublisher {
  readonly calls: readonly RssFeedFileSet[];
  readonly commits: readonly FakeRssCommitRecord[];
  readonly publishedFileSets: Readonly<
    Partial<Record<RssFeedKind, readonly RssPublicationFile[]>>
  >;
  readonly publishedVersions: Readonly<Partial<Record<RssFeedKind, string>>>;
  failNextPublishWith(fault: FakePublisherFault): void;
  failNextPublishWithError(error: Error): void;
  resetFaults(): void;
}

function defaultVersion(sequence: number): string {
  return `fake-commit-${String(sequence).padStart(6, "0")}`;
}

export function createFakeRssPublisher(
  options: FakeRssPublisherOptions = {},
): FakeRssPublisher {
  let baseVersion = options.baseVersion ?? "";
  const commitSequence = { value: 0 };
  const nonFastForwardFailures = { value: options.nonFastForwardFailures ?? 0 };
  const pushFailures = { value: options.pushFailures ?? 0 };
  const pagesFailures = { value: options.pagesFailures ?? 0 };
  const nextError = { value: undefined as Error | undefined };
  const calls: RssFeedFileSet[] = [];
  const commits: FakeRssCommitRecord[] = [];
  const publishedFileSets = new Map<
    RssFeedKind,
    readonly RssPublicationFile[]
  >();
  const publishedVersions = new Map<RssFeedKind, string>();

  const remoteVersionReader = {
    async readVersion(): Promise<string> {
      return baseVersion;
    },
  };

  return {
    async publish(files: RssFeedFileSet): Promise<RssPublishResult> {
      calls.push(files);

      const intent: RssCommitIntent = await stageRssFeedFileSet(
        { fileSet: files, baseVersion },
        remoteVersionReader,
      );

      const injected = nextError.value;
      if (injected !== undefined) {
        nextError.value = undefined;
        throw injected;
      }
      if (nonFastForwardFailures.value > 0) {
        nonFastForwardFailures.value -= 1;
        throw new RssPublisherError("non_fast_forward");
      }
      if (pushFailures.value > 0) {
        pushFailures.value -= 1;
        throw new RssPublisherError("push_failed");
      }
      if (pagesFailures.value > 0) {
        pagesFailures.value -= 1;
        throw new RssPublisherError("pages_unverified");
      }

      commitSequence.value += 1;
      const version =
        typeof options.version === "function"
          ? options.version()
          : (options.version ?? defaultVersion(commitSequence.value));

      commits.push({
        feed: intent.feed,
        version,
        keys: intent.files.map((file) => file.key),
        verified: true,
      });
      publishedFileSets.set(
        intent.feed,
        intent.files.map((file) => ({
          key: file.key,
          bytes: Uint8Array.from(file.bytes),
        })),
      );
      publishedVersions.set(intent.feed, version);

      return { feed: intent.feed, version, verified: true };
    },

    calls,

    commits,

    get publishedFileSets(): Readonly<
      Partial<Record<RssFeedKind, readonly RssPublicationFile[]>>
    > {
      return Object.freeze({ ...Object.fromEntries(publishedFileSets) });
    },

    get publishedVersions(): Readonly<Partial<Record<RssFeedKind, string>>> {
      return Object.freeze({ ...Object.fromEntries(publishedVersions) });
    },

    failNextPublishWith(fault: FakePublisherFault): void {
      nextError.value = new RssPublisherError(fault);
    },

    failNextPublishWithError(error: Error): void {
      nextError.value = error;
    },

    resetFaults(): void {
      nextError.value = undefined;
      nonFastForwardFailures.value = 0;
      pushFailures.value = 0;
      pagesFailures.value = 0;
    },
  };
}
