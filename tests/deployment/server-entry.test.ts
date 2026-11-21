import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isDirectEntry } from "../../src/server.js";

const modulePath = fileURLToPath(
  new URL("../../src/server.ts", import.meta.url),
);

describe("server direct-entry detection", () => {
  it("accepts a normal direct node invocation", () => {
    expect(isDirectEntry(modulePath, undefined)).toBe(true);
  });

  it("accepts the exact PM2 module path even when argv names the wrapper", () => {
    expect(isDirectEntry("/pm2/ProcessContainerFork.js", modulePath)).toBe(
      true,
    );
  });

  it("does not start for imports or a different PM2 application path", () => {
    expect(isDirectEntry(undefined, undefined)).toBe(false);
    expect(
      isDirectEntry("/pm2/ProcessContainerFork.js", "/other/server.js"),
    ).toBe(false);
    expect(
      isDirectEntry("/pm2/ProcessContainerFork.js", `${modulePath}.other`),
    ).toBe(false);
  });
});
