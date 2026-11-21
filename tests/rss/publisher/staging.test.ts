import { describe, expect, it } from "vitest";

import {
  RssPublisherError,
  stageRssFeedFileSet,
} from "../../../src/rss/index.js";
import type {
  RssFeedFileSet,
  RssFeedKind,
  RssPublisherErrorCode,
  RssRemoteVersionReader,
  RssStagingRequest,
  RssPublicationFile,
} from "../../../src/rss/index.js";
import { buildRssFileSet, rssFile } from "../../fixtures/rss.js";

function remoteAt(version: string | null): RssRemoteVersionReader {
  return {
    async readVersion() {
      return version;
    },
  };
}

async function rejectsWith(
  promise: Promise<unknown>,
  code: RssPublisherErrorCode,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RssPublisherError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("RSS publication staging", () => {
  it("stages the complete file set of one Feed into a single commit intent", async () => {
    const fileSet = buildRssFileSet("EVENT_UPDATES", { archiveCount: 2 });

    const intent = await stageRssFeedFileSet(
      { fileSet, baseVersion: "commit-base" },
      remoteAt("commit-base"),
    );

    expect(intent.feed).toBe("EVENT_UPDATES");
    expect(intent.baseVersion).toBe("commit-base");
    expect(intent.remoteVersion).toBe("commit-base");
    expect(intent.files.map((file) => file.key)).toEqual([
      "archive/event-updates-0001.xml",
      "archive/event-updates-0002.xml",
      "event-updates-pending.xml",
      "event-updates.xml",
      ".nojekyll",
    ]);

    const head = intent.files.find((file) => file.key === "event-updates.xml");
    expect(head?.bytes).toEqual(new TextEncoder().encode("<head/>"));
  });

  it("keeps sealed archives before pending and head in the commit (RSS-22)", async () => {
    const fileSet = buildRssFileSet("CURATED_CONTENT", { archiveCount: 3 });

    const intent = await stageRssFeedFileSet(
      { fileSet, baseVersion: "commit-base" },
      remoteAt("commit-base"),
    );

    const keys = intent.files.map((file) => file.key);
    const firstArchive = keys.indexOf("archive/curated-content-0001.xml");
    const pending = keys.indexOf("curated-content-pending.xml");
    const head = keys.indexOf("curated-content.xml");
    expect(firstArchive).toBeGreaterThanOrEqual(0);
    expect(firstArchive).toBeLessThan(pending);
    expect(pending).toBeLessThan(head);
    expect(keys.at(-1)).toBe(".nojekyll");
  });

  it("rejects an unknown Feed kind with invalid_input", async () => {
    const fileSet = {
      feed: "UNKNOWN_FEED",
      files: [rssFile("event-updates.xml", "<head/>")],
    } as unknown as RssFeedFileSet;

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("commit-base"),
      ),
      "invalid_input",
    );
  });

  it.each([
    "/absolute.xml",
    "../escape.xml",
    "dir\\file.xml",
    "event-updates.xml?query=1",
    "event-updates.xml#fragment",
    "a//b.xml",
    "./event-updates.xml",
  ])("rejects unsafe key %s with invalid_input", async (key) => {
    const fileSet: RssFeedFileSet = {
      feed: "EVENT_UPDATES",
      files: [rssFile(key, "<content/>")],
    };

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("commit-base"),
      ),
      "invalid_input",
    );
  });

  const whitelistCases: readonly { feed: RssFeedKind; key: string }[] = [
    { feed: "CURATED_CONTENT", key: "event-updates.xml" },
    { feed: "EVENT_UPDATES", key: "curated-content.xml" },
    { feed: "EVENT_UPDATES", key: "archive/curated-content-0001.xml" },
    { feed: "EVENT_UPDATES", key: "archive/other-0001.xml" },
  ];

  it.each(whitelistCases)(
    "rejects key outside the Feed whitelist ($feed: $key) with invalid_input",
    async ({ feed, key }) => {
      const fileSet: RssFeedFileSet = {
        feed,
        files: [rssFile(key, "<content/>")],
      };

      await rejectsWith(
        stageRssFeedFileSet(
          { fileSet, baseVersion: "commit-base" },
          remoteAt("commit-base"),
        ),
        "invalid_input",
      );
    },
  );

  it.each(["event-updates.xml", "event-updates-pending.xml", ".nojekyll"])(
    "requires the %s file in the file set with invalid_input",
    async (requiredKey) => {
      const fileSet: RssFeedFileSet = {
        feed: "EVENT_UPDATES",
        files: buildRssFileSet("EVENT_UPDATES").files.filter(
          (file) => file.key !== requiredKey,
        ),
      };

      await rejectsWith(
        stageRssFeedFileSet(
          { fileSet, baseVersion: "commit-base" },
          remoteAt("commit-base"),
        ),
        "invalid_input",
      );
    },
  );

  it("rejects duplicate keys in one file set with artifact_conflict", async () => {
    const fileSet: RssFeedFileSet = {
      feed: "EVENT_UPDATES",
      files: [
        rssFile("event-updates.xml", "<first/>"),
        rssFile("event-updates.xml", "<second/>"),
      ],
    };

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("commit-base"),
      ),
      "artifact_conflict",
    );
  });

  it("rejects incomplete bytes with invalid_input", async () => {
    const file = {
      key: "event-updates.xml",
      bytes: "not-a-byte-array",
    } as unknown as RssPublicationFile;
    const fileSet: RssFeedFileSet = { feed: "EVENT_UPDATES", files: [file] };

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("commit-base"),
      ),
      "invalid_input",
    );
  });

  it("rejects an empty file set with invalid_input", async () => {
    const fileSet: RssFeedFileSet = { feed: "EVENT_UPDATES", files: [] };

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("commit-base"),
      ),
      "invalid_input",
    );
  });

  it("rejects a non-string base version with invalid_input", async () => {
    const fileSet = buildRssFileSet("EVENT_UPDATES");

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: 42 } as unknown as RssStagingRequest,
        remoteAt("commit-base"),
      ),
      "invalid_input",
    );
  });

  it("rejects a remote branch that moved beyond the base with non_fast_forward (RSS-20)", async () => {
    const fileSet = buildRssFileSet("EVENT_UPDATES");

    await rejectsWith(
      stageRssFeedFileSet(
        { fileSet, baseVersion: "commit-base" },
        remoteAt("remote-newer-commit"),
      ),
      "non_fast_forward",
    );
  });

  it("stages an initial publish when both the remote and the base are empty", async () => {
    const fileSet = buildRssFileSet("EVENT_UPDATES");

    const intent = await stageRssFeedFileSet(
      { fileSet, baseVersion: "" },
      remoteAt(null),
    );

    expect(intent.remoteVersion).toBe("");
    expect(intent.files.map((file) => file.key)).toContain("event-updates.xml");
  });

  it("keeps staging errors free of content, keys and paths", async () => {
    const secretContent = "SUPER-SECRET-BODY-CONTENT";
    const fileSet: RssFeedFileSet = {
      feed: "EVENT_UPDATES",
      files: [rssFile("/etc/passwd", secretContent)],
    };

    const error = await stageRssFeedFileSet(
      { fileSet, baseVersion: "commit-base" },
      remoteAt("commit-base"),
    ).then(
      () => {
        throw new Error("expected staging to fail");
      },
      (failure: unknown) => failure as RssPublisherError,
    );

    expect(error.code).toBe("invalid_input");
    expect(error.message).not.toContain(secretContent);
    expect(error.message).not.toContain("/etc/passwd");
    expect(error.message).not.toContain("commit-base");
  });
});
