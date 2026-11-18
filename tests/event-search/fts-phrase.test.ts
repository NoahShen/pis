import { describe, expect, it } from "vitest";

import { toFtsPhrase } from "../../src/event-search/fts-phrase.js";

describe("toFtsPhrase", () => {
  it("FTS_LITERAL wraps the complete term in one quoted phrase", () => {
    expect(toFtsPhrase("alpha beta")).toBe('"alpha beta"');
    expect(toFtsPhrase("中文 检索 词")).toBe('"中文 检索 词"');
  });

  it("FTS_LITERAL doubles every internal double quote", () => {
    expect(toFtsPhrase('a"b')).toBe('"a""b"');
    expect(toFtsPhrase('"quoted"')).toBe('"""quoted"""');
    expect(toFtsPhrase('a"b"c')).toBe('"a""b""c"');
  });

  it("FTS_LITERAL preserves operators and punctuation as literal text", () => {
    const term = '"alpha" OR beta* NEAR(gamma) subject:value';

    expect(toFtsPhrase(term)).toBe(
      '"""alpha"" OR beta* NEAR(gamma) subject:value"',
    );
  });

  it("FTS_LITERAL does not trim or append search syntax", () => {
    expect(toFtsPhrase("  spaced term  ")).toBe('"  spaced term  "');
    expect(toFtsPhrase("star*")).toBe('"star*"');
    expect(toFtsPhrase("column:value")).toBe('"column:value"');
  });
});
