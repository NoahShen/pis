import { describe, expect, it } from "vitest";

import { classifySqliteError } from "../../src/database/error-classification.js";

describe("classifySqliteError", () => {
  it("classifySqliteError distinguishes busy constraint sqlite and unknown by code", () => {
    expect(classifySqliteError({ code: "SQLITE_BUSY" })).toBe("busy_locked");
    expect(classifySqliteError({ code: "SQLITE_BUSY_SNAPSHOT" })).toBe(
      "busy_locked",
    );
    expect(classifySqliteError({ code: "SQLITE_LOCKED" })).toBe("busy_locked");
    expect(classifySqliteError({ code: "SQLITE_LOCKED_SHAREDCACHE" })).toBe(
      "busy_locked",
    );
    expect(classifySqliteError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(
      "constraint",
    );
    expect(classifySqliteError({ code: "SQLITE_IOERR" })).toBe("sqlite");
    expect(classifySqliteError({ code: "SQLITE_NOTADB" })).toBe("sqlite");
    expect(classifySqliteError({ code: "UNRELATED_CODE" })).toBe("unknown");
    expect(
      classifySqliteError(
        new Error("SQLITE_CONSTRAINT unique secret SQL and private path"),
      ),
    ).toBe("unknown");
    expect(classifySqliteError(null)).toBe("unknown");
    expect(classifySqliteError(undefined)).toBe("unknown");
    expect(classifySqliteError("SQLITE_BUSY")).toBe("unknown");
    expect(classifySqliteError({ code: 5 })).toBe("unknown");

    const hostileInput = new Proxy(
      {},
      {
        get: () => {
          throw new Error("code getter failure");
        },
      },
    );
    expect(classifySqliteError(hostileInput)).toBe("unknown");
  });
});
