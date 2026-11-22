import { describe, expect, it } from "vitest";

import { ServerSentEventParser } from "../../src/llm/stream-protocol.js";

const encoder = new TextEncoder();

function parse(
  chunks: readonly (string | Uint8Array)[],
  maxEvents = 100,
): string[] {
  const events: string[] = [];
  const parser = new ServerSentEventParser({
    maxEvents,
    onEvent: (event) => events.push(event.data),
  });
  for (const chunk of chunks) {
    parser.write(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
  }
  parser.finish();
  return events;
}

describe("ServerSentEventParser", () => {
  it("frames LF CR and CRLF events, comments, fields and multiline data", () => {
    expect(
      parse([
        ": heartbeat\n\n",
        "event: message\r",
        "data: one\r",
        "data: two\r\r",
        "data: [DONE]\n\n",
      ]),
    ).toEqual(["one\ntwo", "[DONE]"]);

    expect(parse(["data: a\r", "\ndata: b\r\n\r", "\n"])).toEqual(["a\nb"]);
    expect(parse(["data:unspaced\n\n", "data:  one-space\n\n"])).toEqual([
      "unspaced",
      " one-space",
    ]);
    expect(parse(["id: ignored\nretry: 10\n\n"])).toEqual([]);
  });

  it("decodes multibyte UTF-8 across arbitrary chunks", () => {
    const bytes = encoder.encode('data: {"text":"汉字🙂"}\n\n');
    const events: string[] = [];
    const parser = new ServerSentEventParser({
      maxEvents: 1,
      onEvent: (event) => events.push(event.data),
    });
    for (const byte of bytes) {
      parser.write(new Uint8Array([byte]));
    }
    parser.finish();
    expect(events).toEqual(['{"text":"汉字🙂"}']);
  });

  it("dispatches a final unterminated event and rejects incomplete UTF-8", () => {
    expect(parse(["data: final"])).toEqual(["final"]);
    expect(() => parse([new Uint8Array([0xf0, 0x9f])])).toThrow();
    expect(() => parse([new Uint8Array([0xff])])).toThrow();
  });

  it("enforces the data event bound without counting heartbeats", () => {
    expect(parse([": one\n\n: two\n\ndata: ok\n\n"], 1)).toEqual(["ok"]);
    expect(() => parse(["data: one\n\ndata: two\n\n"], 1)).toThrow(
      "SSE event limit exceeded",
    );
  });
});
