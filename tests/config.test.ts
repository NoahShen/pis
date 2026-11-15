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

  it.each([undefined, "", "token with space", "line\nbreak"])(
    "loadConfig rejects missing, empty, whitespace-containing API_TOKEN without echoing its value: %j",
    (apiToken) => {
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
    },
  );

  it.each(["", "-1", "65536", "1.5", " 3000", "3000 ", "1e3", "abc"])(
    "rejects invalid PORT %j",
    (port) => {
      expect(() => loadConfig({ API_TOKEN: "token", PORT: port })).toThrowError(
        expect.objectContaining({ path: "PORT" }),
      );
    },
  );

  it.each(["", " info", "verbose", "INFO"])("rejects invalid LOG_LEVEL %j", (logLevel) => {
    expect(() =>
      loadConfig({ API_TOKEN: "token", LOG_LEVEL: logLevel }),
    ).toThrowError(expect.objectContaining({ path: "LOG_LEVEL" }));
  });

  it.each(["", " host", "host "])("rejects invalid HOST %j", (host) => {
    expect(() => loadConfig({ API_TOKEN: "token", HOST: host })).toThrowError(
      expect.objectContaining({ path: "HOST" }),
    );
  });
});
