import { describe, expect, it } from "vitest";

import {
  decodeRetrievalCursor,
  encodeRetrievalCursor,
  parseRetrievalQuery,
} from "../../src/retrieval/pagination.js";

describe("retrieval pagination protocol", () => {
  it("parses strict limits and rejects every non-decimal or out-of-range form", () => {
    expect(parseRetrievalQuery(undefined).limit).toBe(50);
    expect(parseRetrievalQuery("limit=1").limit).toBe(1);
    expect(parseRetrievalQuery("limit=200").limit).toBe(200);
    for (const query of [
      "limit=",
      "limit=0",
      "limit=201",
      "limit=+1",
      "limit=-1",
      "limit=1.0",
      "limit=%201",
      "limit=1%20",
      "limit=01",
      "limit=1e2",
      "limit=foo",
      "limit=1&limit=2",
      "unknown=value",
    ]) {
      expect(() => parseRetrievalQuery(query)).toThrow();
    }
  });

  it("round-trips base64url v1 cursors and binds their filter context", () => {
    const filters = {
      target_type: "EVENT",
      published_after: "2026-01-01T00:00:00Z",
    } as const;
    const cursor = encodeRetrievalCursor(
      { time: "2026-01-02T00:00:00Z", id: "item-1" },
      filters,
    );
    expect(cursor).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toEqual({
      v: 1,
      time: "2026-01-02T00:00:00Z",
      id: "item-1",
      ...filters,
    });
    expect(decodeRetrievalCursor(cursor, filters)).toEqual({
      time: "2026-01-02T00:00:00Z",
      id: "item-1",
    });
    expect(() => decodeRetrievalCursor(cursor, {})).toThrow();
    expect(() =>
      decodeRetrievalCursor(cursor, { ...filters, target_type: "KNOWLEDGE" }),
    ).toThrow();
  });

  it("rejects malformed, padded, oversized and wrong-shape cursors", () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const invalid = [
      "",
      "a=",
      "a+b",
      "not-base64url!",
      "e30", // no v/time/id
      encode({ v: 2, time: "time", id: "id" }),
      encode({ v: "1", time: "time", id: "id" }),
      encode({ v: 1, time: 1, id: "id" }),
      encode({ v: 1, time: "time", id: "" }),
      encode({ v: 1, time: "time", id: "id", extra: true }),
      encode({ v: 1, time: "time", id: "id", target_type: "EVENT" }),
      Buffer.from("[]").toString("base64url"),
      Buffer.from("not json").toString("base64url"),
      "A".repeat(2049),
    ];
    for (const cursor of invalid) {
      expect(() => decodeRetrievalCursor(cursor, {})).toThrow();
    }
  });

  it("accepts explicit-offset ISO filters and rejects invalid filters and ranges", () => {
    expect(
      parseRetrievalQuery(
        "published_after=2026-01-01T00%3A00%3A00%2B08%3A00&published_before=2026-01-02T00%3A00%3A00Z",
        ["published_after", "published_before"],
      ),
    ).toMatchObject({
      published_after: "2026-01-01T00:00:00+08:00",
      published_before: "2026-01-02T00:00:00Z",
    });
    for (const query of [
      "target_type=event",
      "target_type=",
      "target_type=EVENT&target_type=KNOWLEDGE",
      "published_after=2026-01-01",
      "published_after=2026-01-01T00%3A00%3A00",
      "published_after=2026-01-01T00%3A00%3A00%2B0800",
      "published_after=2026-13-01T00%3A00%3A00Z",
      "published_after=2026-01-02T00%3A00%3A00Z&published_before=2026-01-01T00%3A00%3A00Z",
    ]) {
      expect(() =>
        parseRetrievalQuery(query, [
          "target_type",
          "published_after",
          "published_before",
        ]),
      ).toThrow();
    }
    expect(() => parseRetrievalQuery("target_type=EVENT")).toThrow();
  });
});
