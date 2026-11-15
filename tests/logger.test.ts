import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";

class CaptureStream extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }

  lines(): Record<string, unknown>[] {
    return Buffer.concat(this.chunks)
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

describe("structured logger", () => {
  it("captured logs include ready and shutdown lifecycle metadata", async () => {
    const destination = new CaptureStream();
    const logger = createLogger("info", destination);

    logger.ready({ host: "127.0.0.1", port: 3000 });
    logger.shutdown({ outcome: "closed", forced: false });
    await logger.flush();

    expect(destination.lines()).toMatchObject([
      { event: "ready", host: "127.0.0.1", port: 3000, pid: process.pid },
      { event: "shutdown", outcome: "closed", forced: false },
    ]);
  });

  it("writes stable event fields, includes request id, and redacts credentials", async () => {
    const destination = new CaptureStream();
    const logger = createLogger("info", destination);

    logger.ready({ host: "127.0.0.1", port: 3000 });
    logger.request({
      requestId: "request-id",
      method: "GET",
      path: "/health",
      status: 200,
      duration: 1.25,
    });
    logger.error({ operation: "listen", reason: "listen_error" });
    logger.shutdown({ outcome: "closed", forced: false });
    await logger.flush();

    const lines = destination.lines();
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.event)).toEqual([
      "ready",
      undefined,
      "error",
      "shutdown",
    ]);
    expect(lines[1]).toMatchObject({
      requestId: "request-id",
      method: "GET",
      path: "/health",
      status: 200,
      duration: 1.25,
      msg: "request",
    });
    expect(lines[0]).toMatchObject({ event: "ready", pid: process.pid });
    expect(lines[3]).toMatchObject({ outcome: "closed", forced: false });

    expect(
      lines.some((line) =>
        JSON.stringify(line).includes("Bearer detector-secret"),
      ),
    ).toBe(false);
  });

  it("request log API emits only allowlisted request metadata", async () => {
    const destination = new CaptureStream();
    const logger = createLogger("info", destination);

    logger.request({
      requestId: "request-id",
      method: "GET",
      path: "/health",
      status: 200,
      duration: 1,
      authorization: "Bearer detector-secret",
      cookie: "session=detector-cookie",
      headers: {
        authorization: "Bearer nested-secret",
        cookie: "session=nested-cookie",
        xApiKey: "nested-api-key",
      },
    } as never);
    await logger.flush();

    const output = JSON.stringify(destination.lines());
    expect(output).not.toContain("detector-secret");
    expect(output).not.toContain("detector-cookie");
    expect(output).not.toContain("nested-secret");
    expect(output).not.toContain("nested-cookie");
    expect(output).not.toContain("nested-api-key");
    expect(destination.lines()).toEqual([
      {
        level: 30,
        time: expect.any(Number),
        requestId: "request-id",
        method: "GET",
        path: "/health",
        status: 200,
        duration: 1,
        msg: "request",
      },
    ]);
  });

  it("honors silent without throwing or writing", async () => {
    const destination = new CaptureStream();
    const logger = createLogger("silent", destination);

    logger.ready({ host: "127.0.0.1", port: 3000 });
    await logger.flush();

    expect(destination.lines()).toEqual([]);
  });
});
