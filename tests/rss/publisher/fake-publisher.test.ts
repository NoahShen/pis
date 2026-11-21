import { describe, expect, it } from "vitest";

import {
  createFakeRssPublisher,
  RssPublisherError,
} from "../../../src/rss/index.js";
import type {
  RssFeedFileSet,
  RssPublisherErrorCode,
} from "../../../src/rss/index.js";
import { buildRssFileSet, rssFile } from "../../fixtures/rss.js";

async function rejectsWith(
  promise: Promise<unknown>,
  code: RssPublisherErrorCode,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RssPublisherError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("fake RSS publisher", () => {
  it("returns a controlled commit version and a verified result", async () => {
    const publisher = createFakeRssPublisher({ version: "controlled-commit" });

    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));

    expect(result).toEqual({
      feed: "EVENT_UPDATES",
      version: "controlled-commit",
      verified: true,
    });
    expect(publisher.calls).toHaveLength(1);
  });

  it("generates deterministic versions in publish order", async () => {
    const publisher = createFakeRssPublisher();

    const first = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    const second = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));

    expect(first.version).toBe("fake-commit-000001");
    expect(second.version).toBe("fake-commit-000002");
  });

  it("supports a version function", async () => {
    const publisher = createFakeRssPublisher({
      version: () => "function-commit",
    });

    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));

    expect(result.version).toBe("function-commit");
  });

  it("records the commit trace with sealed archives before pending and head (RSS-22)", async () => {
    const publisher = createFakeRssPublisher();

    await publisher.publish(
      buildRssFileSet("EVENT_UPDATES", { archiveCount: 2 }),
    );

    expect(publisher.commits).toHaveLength(1);
    expect(publisher.commits[0].feed).toBe("EVENT_UPDATES");
    expect(publisher.commits[0].verified).toBe(true);
    expect(publisher.commits[0].keys).toEqual([
      "archive/event-updates-0001.xml",
      "archive/event-updates-0002.xml",
      "event-updates-pending.xml",
      "event-updates.xml",
      ".nojekyll",
    ]);
  });

  it("injects push failures and recovers on the next publish (RSS-20)", async () => {
    const publisher = createFakeRssPublisher({ pushFailures: 1 });

    await rejectsWith(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
      "push_failed",
    );
    expect(publisher.commits).toHaveLength(0);

    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    expect(result.version).toBe("fake-commit-000001");
    expect(publisher.commits).toHaveLength(1);
  });

  it("injects pages bytes mismatch failures", async () => {
    const publisher = createFakeRssPublisher({ pagesFailures: 1 });

    await rejectsWith(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
      "pages_unverified",
    );
    expect(publisher.commits).toHaveLength(0);

    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    expect(result.verified).toBe(true);
    expect(publisher.commits).toHaveLength(1);
  });

  it("injects non-fast-forward conflicts without recording a commit (RSS-20)", async () => {
    const publisher = createFakeRssPublisher({
      nonFastForwardFailures: 1,
    });

    await rejectsWith(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
      "non_fast_forward",
    );
    expect(publisher.commits).toHaveLength(0);

    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    expect(result.version).toBe("fake-commit-000001");
  });

  it("updates the verified file sets and versions per Feed only on success", async () => {
    const publisher = createFakeRssPublisher({ version: "state-commit" });

    await publisher.publish(
      buildRssFileSet("EVENT_UPDATES", { archiveCount: 1 }),
    );
    await publisher.publish(buildRssFileSet("CURATED_CONTENT"));

    expect(publisher.publishedVersions).toEqual({
      EVENT_UPDATES: "state-commit",
      CURATED_CONTENT: "state-commit",
    });
    expect(
      publisher.publishedFileSets.EVENT_UPDATES?.map((file) => file.key),
    ).toEqual([
      "archive/event-updates-0001.xml",
      "event-updates-pending.xml",
      "event-updates.xml",
      ".nojekyll",
    ]);
    const head = publisher.publishedFileSets.EVENT_UPDATES?.find(
      (file) => file.key === "event-updates.xml",
    );
    expect(head?.bytes).toEqual(new TextEncoder().encode("<head/>"));
  });

  it("keeps the verified file sets and versions unchanged after a fault", async () => {
    const publisher = createFakeRssPublisher();
    await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    const beforeVersions = publisher.publishedVersions;
    const beforeFileSets = publisher.publishedFileSets;

    publisher.failNextPublishWith("push_failed");
    await rejectsWith(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
      "push_failed",
    );

    expect(publisher.publishedVersions).toEqual(beforeVersions);
    expect(publisher.publishedFileSets).toEqual(beforeFileSets);
  });

  it("supports one-shot fault injection and resetFaults", async () => {
    const publisher = createFakeRssPublisher();

    publisher.failNextPublishWith("pages_unverified");
    await rejectsWith(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
      "pages_unverified",
    );

    publisher.failNextPublishWithError(new Error("custom failure"));
    await expect(
      publisher.publish(buildRssFileSet("EVENT_UPDATES")),
    ).rejects.toThrow("custom failure");

    publisher.resetFaults();
    const result = await publisher.publish(buildRssFileSet("EVENT_UPDATES"));
    expect(result.version).toBe("fake-commit-000001");
  });

  it("propagates staging validation errors without recording a commit", async () => {
    const publisher = createFakeRssPublisher();
    const invalid: RssFeedFileSet = {
      feed: "EVENT_UPDATES",
      files: [rssFile("../escape.xml", "<content/>")],
    };

    await rejectsWith(publisher.publish(invalid), "invalid_input");
    expect(publisher.commits).toHaveLength(0);
  });

  it("keeps injected failures free of file content", async () => {
    const secretContent = "SUPER-SECRET-HEAD-BODY";
    const publisher = createFakeRssPublisher({ pushFailures: 1 });

    const error = await publisher
      .publish(
        buildRssFileSet("EVENT_UPDATES", { headContents: secretContent }),
      )
      .then(
        () => {
          throw new Error("expected the publish to fail");
        },
        (failure: unknown) => failure as RssPublisherError,
      );

    expect(error.code).toBe("push_failed");
    expect(error.message).not.toContain(secretContent);
    expect(error.message).not.toContain("event-updates.xml");
  });
});
