import { chmod, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRssPagesPublisher,
  RssGitClient,
  type RssPagesPublisher,
} from "../../../src/rss/index.js";
import {
  createPagesFixture,
  pagesFileSet,
  type PagesFixture,
} from "../../fixtures/rss-pages.js";

let fixture: PagesFixture | undefined;
let publisher: RssPagesPublisher | undefined;
afterEach(async () => {
  await publisher?.close();
  await fixture?.close();
  fixture = undefined;
  publisher = undefined;
});

function makePublisher(autoVerify = false, publicDirectory = "") {
  publisher = createRssPagesPublisher({
    repository: fixture!.repository,
    branch: "main",
    workDirectory: fixture!.workDirectory,
    publicOrigin: fixture!.origin,
    publicDirectory,
    timeoutMs: 1_000,
    pollIntervalMs: 100,
    verifier: autoVerify
      ? async (files) => {
          await fixture!.publishPublic();
          const verify = (
            await import("../../../src/rss/index.js")
          ).createRssPagesVerifier({
            publicOrigin: fixture!.origin,
            publicDirectory,
            timeoutMs: 1_000,
            pollIntervalMs: 10,
          });
          await verify(files);
        }
      : async () => undefined,
  });
  return publisher;
}

describe("RSS Pages publisher", () => {
  it("commits a whole feed, preserves the other feed, and is idempotent", async () => {
    fixture = await createPagesFixture();
    const first = await makePublisher().publish(
      pagesFileSet("EVENT_UPDATES", "one"),
    );
    const second = await makePublisher().publish(
      pagesFileSet("CURATED_CONTENT", "two"),
    );
    expect(second.version).not.toBe(first.version);
    expect(
      await readFile(
        path.join(fixture.workDirectory, "event-updates.xml"),
        "utf8",
      ),
    ).toBe("one-head");
    expect(
      await readFile(
        path.join(fixture.workDirectory, "curated-content.xml"),
        "utf8",
      ),
    ).toBe("two-head");
    expect(
      await readFile(path.join(fixture.workDirectory, "README.md"), "utf8"),
    ).toBe("not public\n");
    const repeated = await makePublisher().publish(
      pagesFileSet("CURATED_CONTENT", "two"),
    );
    expect(repeated.version).toBe(second.version);
  });

  it("publishes and verifies the same directory prefix without changing D12 keys", async () => {
    fixture = await createPagesFixture();
    const seen: string[][] = [];
    publisher = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      publicOrigin: fixture.origin,
      publicDirectory: "example_feed",
      verifier: async (files) => {
        seen.push(files.map((file) => file.key));
      },
    });
    const input = pagesFileSet("EVENT_UPDATES", "relative-link-bytes");
    const originalKeys = input.files.map((file) => file.key);
    const originalBytes = input.files.map((file) => [...file.bytes]);
    await publisher.publish(input);
    expect(
      await readFile(
        path.join(fixture.workDirectory, "example_feed/event-updates.xml"),
        "utf8",
      ),
    ).toBe("relative-link-bytes-head");
    expect(seen[0]).toEqual(originalKeys.filter((key) => key !== ".nojekyll"));
    expect(input.files.map((file) => file.key)).toEqual(originalKeys);
    expect(input.files.map((file) => [...file.bytes])).toEqual(originalBytes);
  });

  it("verifies XML without waiting for an anonymous empty .nojekyll", async () => {
    fixture = await createPagesFixture();
    const current = makePublisher(true);
    await fixture.publishPublic();
    const { rm } = await import("node:fs/promises");
    await rm(path.join(fixture.publicDirectory, ".nojekyll"), { force: true });
    const result = await current.publish(pagesFileSet("EVENT_UPDATES", "live"));
    expect(result.verified).toBe(true);
  });

  it("keeps XML verification when .nojekyll is unavailable", async () => {
    fixture = await createPagesFixture();
    publisher = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      publicOrigin: fixture.origin,
      timeoutMs: 100,
      pollIntervalMs: 10,
      verifier: async (files) => {
        expect(files.some((file) => file.key === ".nojekyll")).toBe(false);
        await (
          await import("../../../src/rss/index.js")
        ).createRssPagesVerifier({
          publicOrigin: fixture!.origin,
          timeoutMs: 100,
          pollIntervalMs: 10,
        })(files);
      },
    });
    await expect(
      publisher.publish(pagesFileSet("EVENT_UPDATES", "unavailable")),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects a non-empty .nojekyll", async () => {
    fixture = await createPagesFixture();
    const input = pagesFileSet("EVENT_UPDATES", "invalid");
    await expect(
      makePublisher().publish({
        ...input,
        files: input.files.map((file) =>
          file.key === ".nojekyll"
            ? { ...file, bytes: new Uint8Array([1]) }
            : file,
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("migrates root PIS assets while preserving unknown files and another feed", async () => {
    fixture = await createPagesFixture();
    await makePublisher().publish(pagesFileSet("EVENT_UPDATES", "legacy"));
    await makePublisher(false, "example_feed").publish(
      pagesFileSet("CURATED_CONTENT", "other-feed"),
    );
    await makePublisher(false, "example_feed").publish(
      pagesFileSet("EVENT_UPDATES", "migrated"),
    );
    for (const key of [
      ".nojekyll",
      "event-updates.xml",
      "event-updates-pending.xml",
      "archive/event-updates-0001.xml",
    ]) {
      await expect(
        readFile(path.join(fixture.workDirectory, key)),
      ).rejects.toThrow();
    }
    expect(
      await readFile(path.join(fixture.workDirectory, "README.md"), "utf8"),
    ).toBe("not public\n");
    expect(
      await readFile(
        path.join(fixture.workDirectory, "example_feed/curated-content.xml"),
        "utf8",
      ),
    ).toBe("other-feed-head");
    expect(
      await readFile(
        path.join(fixture.workDirectory, "example_feed/event-updates.xml"),
        "utf8",
      ),
    ).toBe("migrated-head");
  });

  it("does not verify deleted archives", async () => {
    fixture = await createPagesFixture();
    const seen: string[][] = [];
    publisher = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      publicOrigin: fixture.origin,
      verifier: async (files) => {
        seen.push(files.map((file) => file.key));
      },
    });
    await publisher.publish(pagesFileSet("EVENT_UPDATES", "before"));
    await publisher.publish(pagesFileSet("EVENT_UPDATES", "after", false));
    expect(seen[1]).not.toContain("archive/event-updates-0001.xml");
    await expect(
      readFile(
        path.join(fixture.workDirectory, "archive/event-updates-0001.xml"),
      ),
    ).rejects.toThrow();
  });

  it("close is bounded, idempotent, and rejects later operations", async () => {
    fixture = await createPagesFixture();
    const current = makePublisher();
    await current.close();
    await current.close();
    await expect(
      current.publish(pagesFileSet("EVENT_UPDATES", "closed")),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("close cancels an active operation without starting queued work", async () => {
    fixture = await createPagesFixture();
    const client = new RssGitClient({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      timeoutMs: 60_000,
    });
    let operationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const active = client.publish(async () => {
      operationStarted();
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return { version: "", changed: false };
    });
    await started;
    const queued = client.publish(async () => ({
      version: "",
      changed: false,
    }));
    const activeRejection = expect(active).rejects.toMatchObject({
      code: "invalid_input",
    });
    const queuedRejection = expect(queued).rejects.toMatchObject({
      code: "invalid_input",
    });
    const closed = client.close();
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("close hung")), 500),
      ),
    ]);
    await activeRejection;
    await queuedRejection;
    await client.close();
  });

  it("verifies all public bytes and rejects invalid assets", async () => {
    fixture = await createPagesFixture();
    const verified = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      publicOrigin: fixture.origin,
      timeoutMs: 2_000,
      pollIntervalMs: 10,
      verifier: async (files) => {
        await fixture!.publishPublic();
        await (
          await import("../../../src/rss/index.js")
        ).createRssPagesVerifier({
          publicOrigin: fixture!.origin,
          timeoutMs: 2_000,
          pollIntervalMs: 10,
        })(files);
      },
    });
    publisher = verified;
    const result = await verified.publish(
      pagesFileSet("EVENT_UPDATES", "bytes"),
    );
    expect(result.verified).toBe(true);
    await expect(
      verified.publish({
        ...pagesFileSet("EVENT_UPDATES", "bad"),
        files: [{ key: "database.sqlite", bytes: new Uint8Array() }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("reports non-fast-forward without force pushing", async () => {
    fixture = await createPagesFixture();
    const current = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: fixture.workDirectory,
      publicOrigin: fixture.origin,
      timeoutMs: 10_000,
      verifier: async () => undefined,
    });
    publisher = current;
    await current.publish(pagesFileSet("EVENT_UPDATES", "first"));
    const competing = createRssPagesPublisher({
      repository: fixture.repository,
      branch: "main",
      workDirectory: path.join(fixture.directory, "competing"),
      publicOrigin: fixture.origin,
      verifier: async () => undefined,
    });
    await competing.publish(pagesFileSet("CURATED_CONTENT", "other"));
    const hook = path.join(fixture.workDirectory, ".git/hooks/pre-push");
    await writeFile(hook, "#!/bin/sh\nsleep 1\n");
    await chmod(hook, 0o700);
    const pending = current.publish(pagesFileSet("EVENT_UPDATES", "retry"));
    await competing.publish(pagesFileSet("CURATED_CONTENT", "competing"));
    await expect(pending).rejects.toMatchObject({ code: "non_fast_forward" });
    const competingVersion = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.directory + "/competing",
      encoding: "utf8",
    }).stdout.trim();
    const remoteVersion = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.repository,
      encoding: "utf8",
    }).stdout.trim();
    expect(remoteVersion).toBe(competingVersion);
    await competing.close();
  });
});
