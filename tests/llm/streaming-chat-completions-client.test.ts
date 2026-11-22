import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatCompletionsError } from "../../src/llm/chat-completions-client.js";
import { summarizeLlmFailure } from "../../src/llm/failure-summary.js";
import {
  createStreamingChatCompletionsClient,
  type LlmStreamState,
  type StreamingChatCompletionsConfig,
} from "../../src/llm/streaming-chat-completions-client.js";

const encoder = new TextEncoder();
const ENDPOINT = "https://llm.example.test/v1/chat/completions";
const SECRET = "private-reasoning-or-provider-secret";

function config(
  overrides: Partial<StreamingChatCompletionsConfig> = {},
): StreamingChatCompletionsConfig {
  return {
    endpoint: ENDPOINT,
    apiKey: "secret-token",
    model: "synthetic-model",
    firstByteTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    totalTimeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    maxEvents: 100,
    maxContentLength: 64 * 1024,
    ...overrides,
  };
}

function event(value: unknown): string {
  return `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
}

function delta(
  content?: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    choices: [
      { delta: { ...(content === undefined ? {} : { content }), ...extra } },
    ],
  };
}

function finish(reason = "stop", message?: unknown): Record<string, unknown> {
  return {
    choices: [
      {
        delta: {},
        ...(message === undefined ? {} : { message }),
        finish_reason: reason,
      },
    ],
  };
}

function completion(...payloads: unknown[]): string {
  return payloads.map(event).join("") + event("[DONE]");
}

function responseFromText(text: string, chunkSize = text.length): Response {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
        } else {
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        }
      },
    }),
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

async function failure(
  client: ReturnType<typeof createStreamingChatCompletionsClient>,
  signal?: AbortSignal,
): Promise<ChatCompletionsError> {
  const error = await client
    .complete({
      systemContent: "system",
      userContent: "user",
      ...(signal ? { signal } : {}),
    })
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ChatCompletionsError);
  expect(JSON.stringify(error)).not.toContain(SECRET);
  return error as ChatCompletionsError;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("streaming Chat Completions protocol", () => {
  it("sends only model stream and two messages", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseFromText(completion(delta("answer"), finish())),
    );
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: fetchMock,
    });
    await expect(
      client.complete({
        systemContent: "system prompt",
        userContent: "user task",
      }),
    ).resolves.toBe("answer");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "synthetic-model",
      stream: true,
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user task" },
      ],
    });
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
  });

  it("aggregates one-byte UTF-8 chunks, CRLF, comments, multiline data and final DONE", async () => {
    const first = JSON.stringify(delta("汉"));
    const second = JSON.stringify(delta("🙂"));
    const payload = `: heartbeat\n\n${event(first).replace("\n", "\r\n")}${event(second)}${event(finish())}data: [DONE]`;
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () => responseFromText(payload, 1),
    });
    await expect(
      client.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("汉🙂");
  });

  it("joins multiline JSON data and ignores comments between content events", async () => {
    const data = JSON.stringify(delta("joined"));
    const splitAt = data.indexOf(",");
    const text = `data: ${data.slice(0, splitAt)}\ndata: ${data.slice(splitAt)}\n\n: ping\n\n${completion(finish())}`;
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () => responseFromText(text),
    });
    await expect(
      client.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("joined");
  });

  it("uses final message.content when a provider sends no delta content", async () => {
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(finish("stop", { role: "assistant", content: "final" })),
        ),
    });
    await expect(
      client.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("final");
  });

  it("keeps reasoning out of content and reports only safe state and timings", async () => {
    const states: LlmStreamState[] = [];
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(
            delta(undefined, { reasoning: SECRET }),
            delta("text"),
            finish(),
          ),
        ),
      onStateChange: (observation) => {
        states.push(observation.streamState);
        expect(JSON.stringify(observation)).not.toContain(SECRET);
      },
    });
    await expect(
      client.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("text");
    expect(states).toEqual([
      "request_started",
      "first_chunk_received",
      "reasoning_started",
      "content_started",
      "upstream_closed",
      "stream_done",
    ]);
  });

  it.each([
    [
      "reasoning only",
      completion(delta(undefined, { reasoning: SECRET }), finish()),
      "LLM_REASONING_ONLY",
    ],
    [
      "null content",
      completion(delta(null as unknown as string), finish()),
      "LLM_CONTENT_EMPTY",
    ],
    ["whitespace", completion(delta(" \n"), finish()), "LLM_CONTENT_EMPTY"],
    [
      "length",
      completion(delta("partial"), finish("length")),
      "LLM_OUTPUT_TRUNCATED",
    ],
    [
      "content filter",
      completion(finish("content_filter")),
      "LLM_CONTENT_FILTERED",
    ],
    [
      "other finish",
      completion(finish("tool_calls")),
      "LLM_FINISH_REASON_INVALID",
    ],
    [
      "no done",
      event(delta("partial")) + event(finish()),
      "LLM_STREAM_INCOMPLETE",
    ],
    [
      "no finish",
      event(delta("partial")) + event("[DONE]"),
      "LLM_STREAM_INCOMPLETE",
    ],
  ])("rejects %s with a safe reason", async (_name, body, reason) => {
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () => responseFromText(body),
    });
    const error = await failure(client);
    expect(error).toMatchObject({
      code: "LLM_RESPONSE_PROTOCOL_ERROR",
      reason,
    });
    expect(summarizeLlmFailure(error)).toMatchObject({
      category:
        reason === "LLM_CONTENT_FILTERED"
          ? "response_protocol"
          : "response_protocol",
      reason,
      retryable: reason !== "LLM_CONTENT_FILTERED",
    });
  });

  it("accepts usage-only events before and after stop without changing content", async () => {
    const states: LlmStreamState[] = [];
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(
            { choices: [], usage: { prompt_tokens: 2 } },
            delta("answer"),
            finish(),
            { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } },
          ),
        ),
      onStateChange: (observation) => states.push(observation.streamState),
    });
    await expect(
      client.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("answer");
    expect(states).toEqual([
      "request_started",
      "first_chunk_received",
      "content_started",
      "upstream_closed",
      "stream_done",
    ]);
  });

  it("accepts a usage-only event after DONE but rejects other data after DONE", async () => {
    const usageOnly = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(delta("answer"), finish()) +
            event({ choices: [], usage: { total_tokens: 3 } }),
        ),
    });
    await expect(
      usageOnly.complete({ systemContent: "s", userContent: "u" }),
    ).resolves.toBe("answer");

    const lateData = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(delta("answer"), finish()) +
            event({ choices: [{ delta: { content: SECRET } }] }),
        ),
    });
    expect((await failure(lateData)).reason).toBe("LLM_RESPONSE_MALFORMED");
  });

  it.each([
    ["without usage", { choices: [] }],
    ["with null usage", { choices: [], usage: null }],
    ["with array usage", { choices: [], usage: [] }],
  ])("rejects an empty choices event %s", async (_name, payload) => {
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(completion(delta("answer"), payload, finish())),
    });
    expect((await failure(client)).reason).toBe("LLM_RESPONSE_MALFORMED");
  });

  it("rejects non-usage data after DONE including events flushed at EOF", async () => {
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        responseFromText(
          completion(delta("ok"), finish()) + event(delta("late")).trimEnd(),
        ),
    });
    expect((await failure(client)).reason).toBe("LLM_RESPONSE_MALFORMED");
  });

  it("maps malformed JSON, UTF-8, refusal and tool calls without provider details", async () => {
    const bodies = [
      event(SECRET) + event("[DONE]"),
      completion(delta(undefined, { refusal: SECRET }), finish()),
      completion(delta(undefined, { tool_calls: [{ id: SECRET }] }), finish()),
    ];
    for (const body of bodies) {
      const client = createStreamingChatCompletionsClient(config(), {
        fetch: async () => responseFromText(body),
      });
      expect((await failure(client)).code).toBe("LLM_RESPONSE_PROTOCOL_ERROR");
    }
    const invalidUtf8 = createStreamingChatCompletionsClient(config(), {
      fetch: async () => new Response(new Uint8Array([0xff])),
    });
    expect((await failure(invalidUtf8)).reason).toBe("LLM_RESPONSE_MALFORMED");
  });
});

describe("streaming bounds, timeouts and cleanup", () => {
  it("bounds response bytes, event count and content length", async () => {
    const cases = [
      [config({ maxResponseBytes: 5 }), completion(delta("too large"))],
      [config({ maxEvents: 1 }), event(delta("one")) + event(delta("two"))],
      [config({ maxContentLength: 3 }), completion(delta("four"), finish())],
    ] as const;
    for (const [configuration, body] of cases) {
      const client = createStreamingChatCompletionsClient(configuration, {
        fetch: async () => responseFromText(body),
      });
      const error = await failure(client);
      expect(error).toMatchObject({
        code: "LLM_RESPONSE_TOO_LARGE",
        retryable: false,
      });
    }
  });

  it("distinguishes first byte idle and total deadlines and cleans pending reads", async () => {
    vi.useFakeTimers();
    for (const [kind, delay, reason] of [
      ["first", 20, "LLM_FIRST_BYTE_TIMEOUT"],
    ] as const) {
      const cancel = vi.fn(async () => undefined);
      const reader = {
        read: vi.fn(
          () =>
            new Promise<{ done: boolean; value?: Uint8Array }>(() => undefined),
        ),
        cancel,
        releaseLock: vi.fn(),
      };
      const fetchMock = vi.fn<typeof fetch>(async () => {
        if (kind === "first") {
          return new Promise<Response>(() => undefined);
        }
        return {
          status: 200,
          body: { getReader: () => reader },
        } as unknown as Response;
      });
      const client = createStreamingChatCompletionsClient(
        config({
          firstByteTimeoutMs: kind === "first" ? 20 : 100,
          idleTimeoutMs: 40,
          totalTimeoutMs: 80,
        }),
        { fetch: fetchMock },
      );
      const pending = failure(client);
      await vi.advanceTimersByTimeAsync(0);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(delay);
      expect((await pending).reason).toBe(reason);
    }

    const cancel = vi.fn(async () => undefined);
    const firstRead = deferred<{ done: boolean; value?: Uint8Array }>();
    const pendingRead = deferred<{ done: boolean; value?: Uint8Array }>();
    const secondReadStarted = deferred<void>();
    let reads = 0;
    const reader = {
      read: vi.fn(() => {
        if (reads++ > 0) {
          secondReadStarted.resolve();
        }
        return reads === 1 ? firstRead.promise : pendingRead.promise;
      }),
      cancel,
      releaseLock: vi.fn(),
    };
    await vi.runAllTimersAsync();
    const totalReader = {
      read: vi.fn(
        () =>
          new Promise<{ done: boolean; value?: Uint8Array }>(() => undefined),
      ),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const totalClient = createStreamingChatCompletionsClient(
      config({
        firstByteTimeoutMs: 100,
        idleTimeoutMs: 40,
        totalTimeoutMs: 80,
      }),
      {
        fetch: async () =>
          ({
            status: 200,
            body: { getReader: () => totalReader },
          }) as unknown as Response,
      },
    );
    const totalPending = failure(totalClient);
    await vi.advanceTimersByTimeAsync(80);
    const totalError = await totalPending;
    expect(totalError.reason).toBe("LLM_TIMEOUT_LOCAL");
    expect(summarizeLlmFailure(totalError)).toMatchObject({
      category: "timeout",
      reason: "LLM_TIMEOUT_LOCAL",
    });

    vi.useRealTimers();
    const states: LlmStreamState[] = [];
    const client = createStreamingChatCompletionsClient(
      config({
        firstByteTimeoutMs: 1_000,
        idleTimeoutMs: 100,
        totalTimeoutMs: 1_000,
      }),
      {
        fetch: async () =>
          ({
            status: 200,
            body: { getReader: () => reader },
          }) as unknown as Response,
        onStateChange: ({ streamState }) => states.push(streamState),
      },
    );
    const pending = failure(client);
    await flushMicrotasks();
    firstRead.resolve({
      done: false,
      value: encoder.encode(event(delta(undefined, { reasoning: "r" }))),
    });
    await secondReadStarted.promise;
    expect(states).toContain("reasoning_started");
    const idleError = await pending;
    expect({
      reason: idleError.reason,
      reads: reader.read.mock.calls.length,
      states,
    }).toMatchObject({ reason: "LLM_STREAM_IDLE_TIMEOUT", reads: 2 });
    expect(summarizeLlmFailure(idleError)).toMatchObject({
      category: "timeout",
      reason: "LLM_STREAM_IDLE_TIMEOUT",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("cancels immediately without retry and does not expose late events", async () => {
    const cancel = vi.fn(async () => undefined);
    const reader = {
      read: vi.fn(
        () =>
          new Promise<{ done: boolean; value?: Uint8Array }>(() => undefined),
      ),
      cancel,
      releaseLock: vi.fn(),
    };
    const controller = new AbortController();
    const client = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        ({
          status: 200,
          body: { getReader: () => reader },
        }) as unknown as Response,
    });
    const pending = failure(client, controller.signal);
    await flushMicrotasks();
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ code: "LLM_CANCELLED", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(summarizeLlmFailure(error)).toMatchObject({
      category: "cancellation",
    });
  });

  it("maps HTTP statuses including 499 and stream errors", async () => {
    for (const status of [400, 429, 499, 503]) {
      const client = createStreamingChatCompletionsClient(config(), {
        fetch: async () => new Response(SECRET, { status }),
      });
      const error = await failure(client);
      const summary = summarizeLlmFailure(error);
      expect(summary).toMatchObject({
        category: "http",
        httpStatus: status,
        reason: status === 499 ? "LLM_UPSTREAM_CANCELED" : "LLM_HTTP_ERROR",
        retryable: status === 429 || status === 499 || status >= 500,
      });
    }
    const aborted = createStreamingChatCompletionsClient(config(), {
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error(SECRET));
            },
          }),
        ),
    });
    const abortedError = await failure(aborted);
    expect(abortedError.reason).toBe("LLM_STREAM_ABORTED");
    expect(summarizeLlmFailure(abortedError)).toMatchObject({
      category: "network",
      reason: "LLM_STREAM_ABORTED",
    });
  });
});
