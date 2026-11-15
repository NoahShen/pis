import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loadConfig applies defaults only for unset optional variables", () => {
    expect(loadConfig({ API_TOKEN: "secret" })).toEqual({
      host: "127.0.0.1",
      port: 3000,
      apiToken: "secret",
      logLevel: "info",
    });
  });

  it("loadConfig accepts legal overrides and PORT=0", () => {
    expect(
      loadConfig({
        HOST: "0.0.0.0",
        PORT: "0",
        API_TOKEN: "token",
        LOG_LEVEL: "silent",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 0,
      apiToken: "token",
      logLevel: "silent",
    });

    expect(loadConfig({ PORT: "65535", API_TOKEN: "x", LOG_LEVEL: "trace" }).port).toBe(
      65535,
    );
  });

  it("loadConfig ignores unknown environment variables", () => {
    expect(
      loadConfig({
        API_TOKEN: "token",
        UNRELATED_VALUE: "ignored",
        NODE_ENV: "test",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 3000,
      apiToken: "token",
      logLevel: "info",
    });
  });

  it("loadConfig rejects missing, empty, whitespace-containing API_TOKEN without echoing its value", () => {
    for (const apiToken of [undefined, "", "token with space", "line\nbreak"]) {
      let error: unknown;

      try {
        loadConfig(apiToken === undefined ? {} : { API_TOKEN: apiToken });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ path: "API_TOKEN" });
      expect(String(error)).not.toContain("token with space");
      expect(String(error)).not.toContain("line");
    }
  });

  it("loadConfig rejects empty or whitespace-padded HOST, invalid PORT and invalid LOG_LEVEL without echoing inputs", () => {
    const invalidValues = [
      ["HOST", ["", " host", "host "]],
      ["PORT", ["", "-1", "65536", "1.5", " 3000", "3000 ", "1e3", "abc"]],
      ["LOG_LEVEL", ["", " info", "verbose", "INFO"]],
    ] as const;
    const safeReasons = {
      HOST: "must be non-empty without surrounding whitespace",
      PORT: "must be a decimal integer from 0 to 65535",
      LOG_LEVEL: "must be one of fatal, error, warn, info, debug, trace, silent",
    } as const;

    for (const [path, values] of invalidValues) {
      for (const value of values) {
        let error: unknown;

        try {
          loadConfig({ API_TOKEN: "token", [path]: value });
        } catch (caught) {
          error = caught;
        }

        expect(error).toMatchObject({ path, reason: safeReasons[path] });
      }
    }
  });
});
