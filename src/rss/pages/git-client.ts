import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { RssPublisherError } from "../publisher/contracts.js";

const PUBLIC_DIRECTORY = /^[A-Za-z0-9_-]{0,128}$/u;

export function rssPublicKey(key: string, publicDirectory = ""): string {
  if (!PUBLIC_DIRECTORY.test(publicDirectory))
    throw new RssPublisherError("invalid_input");
  return publicDirectory.length === 0 ? key : `${publicDirectory}/${key}`;
}

export function rssPublicUrl(
  publicOrigin: string,
  key: string,
  publicDirectory = "",
): URL {
  return new URL(rssPublicKey(key, publicDirectory), `${publicOrigin}/`);
}

export interface RssGitClientOptions {
  readonly repository: string;
  readonly branch: string;
  readonly workDirectory: string;
  readonly timeoutMs?: number;
  readonly sshCommand?: string;
}

export interface RssGitCommit {
  readonly version: string;
  readonly changed: boolean;
}

export class RssGitClient {
  readonly #repository: string;
  readonly #branch: string;
  readonly #workDirectory: string;
  readonly #timeoutMs: number;
  readonly #sshCommand: string;
  readonly #children = new Set<ChildProcess>();
  #tail: Promise<void> = Promise.resolve();
  #remoteVersion = "";
  #closed = false;

  constructor(options: RssGitClientOptions) {
    this.#repository = options.repository;
    this.#branch = options.branch;
    this.#workDirectory = path.resolve(options.workDirectory);
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#sshCommand = options.sshCommand ?? "ssh -o BatchMode=yes";
  }

  get workDirectory(): string {
    return this.#workDirectory;
  }

  async #run(
    args: readonly string[],
    options: { readonly allowExitCodes?: readonly number[] } = {},
  ): Promise<string> {
    if (this.#closed) throw new RssPublisherError("invalid_input");
    return await new Promise<string>((resolve, reject) => {
      const child = spawn("git", [...args], {
        cwd: this.#workDirectory,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "",
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: this.#sshCommand,
          GIT_AUTHOR_NAME: "PIS RSS Publisher",
          GIT_AUTHOR_EMAIL: "pis-rss@localhost",
          GIT_COMMITTER_NAME: "PIS RSS Publisher",
          GIT_COMMITTER_EMAIL: "pis-rss@localhost",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.#children.add(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill("SIGKILL");
      }, this.#timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < 65_536) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 4096) stderr += chunk;
      });
      const finish = (error?: Error, code?: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#children.delete(child);
        if (error || code === null) {
          reject(new RssPublisherError("timeout"));
          return;
        }
        const allowed = options.allowExitCodes ?? [0];
        if (allowed.includes(code ?? -1)) {
          resolve(stdout.trim());
        } else if (
          args[0] === "push" &&
          /non-fast-forward|fetch first|rejected/iu.test(stderr)
        ) {
          reject(new RssPublisherError("non_fast_forward"));
        } else {
          reject(
            new RssPublisherError(
              args[0] === "push" ? "push_failed" : "artifact_conflict",
            ),
          );
        }
      };
      child.once("error", (error) => finish(error));
      child.once("close", (code) => finish(undefined, code));
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #prepare(): Promise<void> {
    await mkdir(this.#workDirectory, { recursive: true, mode: 0o700 });
    const initialized = await this.#run(
      ["rev-parse", "--is-inside-work-tree"],
      { allowExitCodes: [0, 128] },
    );
    if (initialized !== "true") {
      await this.#run(["init", "--initial-branch", this.#branch, "."]);
      await this.#run(["remote", "add", "origin", this.#repository]);
    }
    await this.#run(["remote", "set-url", "origin", this.#repository]);
    const reference = await this.#run([
      "ls-remote",
      "origin",
      `refs/heads/${this.#branch}`,
    ]);
    this.#remoteVersion =
      reference.length > 0 ? reference.split(/\s/u)[0]! : "";
    if (reference.length > 0) {
      await this.#run(["fetch", "--prune", "origin", this.#branch]);
      await this.#run([
        "checkout",
        "-B",
        this.#branch,
        `origin/${this.#branch}`,
      ]);
      await this.#run(["reset", "--hard", `origin/${this.#branch}`]);
    } else {
      await this.#run(["checkout", "-B", this.#branch]);
    }
    await this.#run(["clean", "-fd"]);
  }

  publish(
    operation: (client: RssGitClient) => Promise<RssGitCommit>,
  ): Promise<RssGitCommit> {
    return this.#serialize(async () => {
      await this.#prepare();
      return await operation(this);
    });
  }

  async remoteVersion(): Promise<string> {
    return await this.#run(["rev-parse", "HEAD"], { allowExitCodes: [0, 128] });
  }

  async stage(key: string): Promise<void> {
    await this.#run(["add", "--", key]);
  }

  async stageAll(): Promise<void> {
    await this.#run(["add", "-A"]);
  }

  async commit(message: string): Promise<RssGitCommit> {
    const changed = await this.#run(["diff", "--cached", "--quiet"], {
      allowExitCodes: [0, 1],
    });
    void changed;
    // diff --quiet has no output; inspect the index directly to distinguish it.
    const status = await this.#run(["status", "--porcelain"]);
    if (status.length === 0) {
      return {
        version: await this.#run(["rev-parse", "HEAD"], {
          allowExitCodes: [0, 128],
        }),
        changed: false,
      };
    }
    await this.#run(["commit", "-m", message]);
    return { version: await this.#run(["rev-parse", "HEAD"]), changed: true };
  }

  async push(version: string): Promise<void> {
    const expected = this.#remoteVersion;
    const latest = await this.#run([
      "ls-remote",
      "origin",
      `refs/heads/${this.#branch}`,
    ]);
    const latestVersion = latest.length > 0 ? latest.split(/\s/u)[0]! : "";
    if (latestVersion !== expected)
      throw new RssPublisherError("non_fast_forward");
    await this.#run(["push", "origin", `HEAD:refs/heads/${this.#branch}`]);
    this.#remoteVersion = version;
    const remote = await this.#run([
      "ls-remote",
      "origin",
      `refs/heads/${this.#branch}`,
    ]);
    if (!remote.startsWith(version))
      throw new RssPublisherError("non_fast_forward");
  }

  async close(): Promise<void> {
    if (this.#closed) {
      await this.#tail;
      return;
    }
    this.#closed = true;
    for (const child of this.#children) child.kill("SIGKILL");
    await this.#tail;
    this.#children.clear();
  }
}
