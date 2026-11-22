export class SseEventLimitError extends Error {}

export interface ServerSentEvent {
  readonly data: string;
}

export interface SseParserOptions {
  readonly maxEvents: number;
  readonly onEvent: (event: ServerSentEvent) => void;
}

/** Incremental, fatal UTF-8 SSE framing. Call finish to reject truncated input. */
export class ServerSentEventParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private dataLines: string[] = [];
  private eventCount = 0;
  private ended = false;
  private skipLeadingLf = false;

  constructor(private readonly options: SseParserOptions) {}

  write(chunk: Uint8Array): void {
    if (this.ended) {
      throw new Error("SSE parser already finished");
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.consume(false);
  }

  finish(): void {
    if (this.ended) {
      return;
    }
    this.buffer += this.decoder.decode();
    this.ended = true;
    this.consume(true);
    this.dispatch();
  }

  private consume(finished: boolean): void {
    if (this.skipLeadingLf) {
      if (this.buffer.startsWith("\n")) {
        this.buffer = this.buffer.slice(1);
      }
      this.skipLeadingLf = false;
    }
    let start = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== "\n" && character !== "\r") {
        continue;
      }
      this.processLine(this.buffer.slice(start, index));
      if (character === "\r" && this.buffer[index + 1] === "\n") {
        index += 1;
      } else if (
        character === "\r" &&
        index + 1 === this.buffer.length &&
        !finished
      ) {
        // The LF half of a CRLF pair may arrive in the next chunk.
        this.buffer = "";
        this.skipLeadingLf = true;
        return;
      }
      start = index + 1;
    }
    this.buffer = this.buffer.slice(start);
    if (finished && this.buffer.length > 0) {
      this.processLine(this.buffer);
      this.buffer = "";
    }
  }

  private processLine(line: string): void {
    if (line.length === 0) {
      this.dispatch();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "data") {
      this.dataLines.push(value);
    }
  }

  private dispatch(): void {
    if (this.dataLines.length === 0) {
      return;
    }
    this.eventCount += 1;
    if (this.eventCount > this.options.maxEvents) {
      throw new SseEventLimitError("SSE event limit exceeded");
    }
    const data = this.dataLines.join("\n");
    this.dataLines = [];
    this.options.onEvent({ data });
  }
}
