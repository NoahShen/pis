import { describe, expect, it } from "vitest";

import {
  ConfigurationInputError,
  parseSourceCreate,
  parseSourceUpdate,
  parseTopicCreate,
  parseTopicUpdate,
  type SourceUpdateInput,
  type TopicUpdateInput,
} from "../../src/configuration/contracts.js";

type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type EmptySourceUpdateIsRejected = AssertFalse<
  IsAssignable<{}, SourceUpdateInput>
>;
type EmptyTopicUpdateIsRejected = AssertFalse<
  IsAssignable<{}, TopicUpdateInput>
>;
type SourceUndefinedOnlyUpdatesAreRejected = [
  AssertFalse<IsAssignable<{ name: undefined }, SourceUpdateInput>>,
  AssertFalse<IsAssignable<{ description: undefined }, SourceUpdateInput>>,
  AssertFalse<IsAssignable<{ enabled: undefined }, SourceUpdateInput>>,
];
type TopicUndefinedOnlyUpdatesAreRejected = [
  AssertFalse<IsAssignable<{ name: undefined }, TopicUpdateInput>>,
  AssertFalse<IsAssignable<{ description: undefined }, TopicUpdateInput>>,
  AssertFalse<IsAssignable<{ enabled: undefined }, TopicUpdateInput>>,
];
type MixedDefinedUpdatesAreAccepted = [
  AssertTrue<
    IsAssignable<{ name: undefined; enabled: false }, SourceUpdateInput>
  >,
  AssertTrue<
    IsAssignable<{ name: undefined; enabled: false }, TopicUpdateInput>
  >,
];
type UpdateTypeChecks = [
  EmptySourceUpdateIsRejected,
  EmptyTopicUpdateIsRejected,
  SourceUndefinedOnlyUpdatesAreRejected,
  TopicUndefinedOnlyUpdatesAreRejected,
  MixedDefinedUpdatesAreAccepted,
];

const VALID_SOURCE = {
  name: "  Synthetic Feed  ",
  type: "RSS",
  url: "https://example.test/feed.xml?edition=daily",
  cron: "  0 */5 * * * *  ",
  description: "  Preserve source description  ",
} as const;

function expectInputError(operation: () => unknown): void {
  let observed: unknown;

  try {
    operation();
  } catch (error) {
    observed = error;
  }

  expect(observed).toBeInstanceOf(ConfigurationInputError);
  expect(observed).toMatchObject({
    name: "ConfigurationInputError",
    code: "invalid_configuration_input",
  });
  expect(String(observed)).not.toContain("Synthetic Feed");
  expect(observed).not.toHaveProperty("cause");
}

describe("configuration contracts", () => {
  it("source and topic parsers enforce the approved strict field contract", () => {
    expect(parseSourceCreate(VALID_SOURCE)).toEqual({
      ...VALID_SOURCE,
      enabled: true,
      description: "  Preserve source description  ",
    });
    expect(
      parseSourceCreate({
        ...VALID_SOURCE,
        enabled: false,
        description: null,
      }),
    ).toEqual({
      ...VALID_SOURCE,
      enabled: false,
      description: null,
    });
    expect(
      parseSourceUpdate({
        name: VALID_SOURCE.name,
        cron: VALID_SOURCE.cron,
        enabled: false,
        description: null,
      }),
    ).toEqual({
      name: VALID_SOURCE.name,
      cron: VALID_SOURCE.cron,
      enabled: false,
      description: null,
    });
    expect(
      parseSourceCreate({ ...VALID_SOURCE, description: "" }).description,
    ).toBe("");
    expect(parseSourceUpdate({ description: "" })).toEqual({ description: "" });
    expect(parseSourceUpdate({ name: undefined, enabled: false })).toEqual({
      enabled: false,
    });

    expect(
      parseTopicCreate({
        name: "  Synthetic Topic  ",
        description: "  Synthetic Topic Description  ",
      }),
    ).toEqual({
      name: "  Synthetic Topic  ",
      description: "  Synthetic Topic Description  ",
      enabled: true,
    });
    expect(
      parseTopicUpdate({
        name: " Updated Topic ",
        description: " Updated Description ",
        enabled: false,
      }),
    ).toEqual({
      name: " Updated Topic ",
      description: " Updated Description ",
      enabled: false,
    });
    expect(parseTopicUpdate({ name: undefined, enabled: false })).toEqual({
      enabled: false,
    });

    for (const invalidSource of [
      null,
      [],
      {},
      { ...VALID_SOURCE, name: "" },
      { ...VALID_SOURCE, name: "   " },
      { ...VALID_SOURCE, name: 12 },
      { ...VALID_SOURCE, type: "ATOM" },
      { ...VALID_SOURCE, enabled: 1 },
      { ...VALID_SOURCE, enabled: "true" },
      { ...VALID_SOURCE, enabled: null },
      { ...VALID_SOURCE, unknown: true },
      { ...VALID_SOURCE, id: "injected-id" },
      { ...VALID_SOURCE, last_collected_at: null },
    ]) {
      expectInputError(() => parseSourceCreate(invalidSource));
    }

    for (const invalidUpdate of [
      null,
      [],
      {},
      { id: "source-id" },
      { type: "RSS" },
      { url: VALID_SOURCE.url },
      { last_collected_at: null },
      { name: VALID_SOURCE.name, type: "RSS" },
      { cron: VALID_SOURCE.cron, url: VALID_SOURCE.url },
      { enabled: 0 },
      { description: 4 },
      { unknown: true },
      { name: undefined },
      { description: undefined },
      { enabled: undefined },
      { name: undefined, cron: undefined, description: undefined },
    ]) {
      expectInputError(() => parseSourceUpdate(invalidUpdate));
    }

    for (const invalidTopic of [
      null,
      [],
      {},
      { name: "topic", description: "" },
      { name: "topic", description: "  \t" },
      { name: "topic", description: "description", enabled: 1 },
      { name: "topic", description: "description", unknown: true },
      { id: "topic-id", name: "topic", description: "description" },
    ]) {
      expectInputError(() => parseTopicCreate(invalidTopic));
    }

    for (const invalidUpdate of [
      null,
      [],
      {},
      { id: "topic-id" },
      { name: "" },
      { description: "   " },
      { enabled: null },
      { unknown: true },
      { name: undefined },
      { description: undefined },
      { enabled: undefined },
      { name: undefined, description: undefined },
    ]) {
      expectInputError(() => parseTopicUpdate(invalidUpdate));
    }
  });

  it("source url and cron validation accept only approved syntax", () => {
    for (const value of [
      "http://example.test",
      "https://example.test/feed.xml",
      "HTTPS://example.test/feed.xml",
      "https://example.test:8443/feed?q=value",
    ]) {
      expect(parseSourceCreate({ ...VALID_SOURCE, url: value }).url).toBe(
        value,
      );
    }

    for (const value of [
      "",
      " https://example.test/feed.xml",
      "https://example.test/feed.xml ",
      "example.test/feed.xml",
      "//example.test/feed.xml",
      "ftp://example.test/feed.xml",
      "file:///tmp/feed.xml",
      "data:text/plain,feed",
      "javascript:alert(1)",
      "http:///feed.xml",
      "https:///feed.xml",
      "https://user:secret@example.test/feed.xml",
      "https://@example.test/feed.xml",
      "https://example.test/feed.xml#fragment",
      "https://example.test/\u0000feed",
      "https://example.test/\u001ffeed",
      "https://example.test/\u007ffeed",
      "https://example.test/\nfeed",
    ]) {
      expectInputError(() =>
        parseSourceCreate({ ...VALID_SOURCE, url: value }),
      );
    }

    for (const value of [
      "0 * * * *",
      "0 */5 * * * *",
      "  0  *  * * *  ",
      "0 0 1 JAN MON",
      "*/15 * * * *",
    ]) {
      expect(parseSourceCreate({ ...VALID_SOURCE, cron: value }).cron).toBe(
        value,
      );
    }

    for (const value of [
      "",
      "   ",
      "* * * *",
      "* * * * * * *",
      "not-a-cron * * * *",
      "0 25 * * *",
    ]) {
      expectInputError(() =>
        parseSourceCreate({ ...VALID_SOURCE, cron: value }),
      );
    }
  });
});
