import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatCompletionsError,
  createChatCompletionsClient,
  type ChatCompletionsConfig,
} from "../../src/llm/chat-completions-client.js";

const ENDPOINT = "https://llm.example.test/v1/chat/completions?route=synthetic";
const API_KEY = "key-sentinel-do-not-leak";
const SYSTEM_CONTENT = "system prompt sentinel";
const USER_CONTENT = "user content sentinel";

function config(
  overrides: Partial<ChatCompletionsConfig> = {},
): ChatCompletionsConfig {
  return {
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    model: "synthetic-model",
    timeoutMs: 1_000,
    maxResponseBytes: 8_192,
    ...overrides,
  };
}

function responseBody(content: string): string {
  return JSON.stringify({
    id: "chatcmpl-synthetic",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          refusal: null,
        },
        finish_reason: "stop",
      },
    ],
  });
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function completionResponse(content: string): Response {
  return new Response(responseBody(content), {
    headers: { "Content-Type": "application/json" },
  });
}

function streamFromChunks(
  chunks: readonly Uint8Array[],
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

function streamedResponse(
  chunks: readonly Uint8Array[],
  init: ResponseInit = { headers: { "Content-Type": "application/json" } },
): Response {
  return new Response(streamFromChunks(chunks), init);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectSafeError(
  error: unknown,
  expected: {
    readonly code: ChatCompletionsError["code"];
    readonly category: ChatCompletionsError["category"];
    readonly retryable: boolean;
    readonly status?: number;
  },
): ChatCompletionsError {
  expect(error).toBeInstanceOf(ChatCompletionsError);
  const chatError = error as ChatCompletionsError;
  expect({
    code: chatError.code,
    category: chatError.category,
    retryable: chatError.retryable,
    status: chatError.status,
  }).toEqual({
    code: expected.code,
    category: expected.category,
    retryable: expected.retryable,
    status: expected.status,
  });

  const text = `${String(chatError)} ${JSON.stringify(chatError)}`;
  for (const sentinel of [
    API_KEY,
    "route=synthetic",
    SYSTEM_CONTENT,
    USER_CONTENT,
    "provider-body-sentinel",
    "provider-message-sentinel",
  ]) {
    expect(text).not.toContain(sentinel);
  }
  return chatError;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createChatCompletionsClient", () => {
  it("createChatCompletionsClient builds one non-streaming request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      completionResponse("answer"),
    );
    const client = createChatCompletionsClient(config(), { fetch: fetchMock });

    await expect(
      client.complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      }),
    ).resolves.toBe("answer");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "synthetic-model",
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_CONTENT },
        { role: "user", content: USER_CONTENT },
      ],
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("complete returns the first stopped message content", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: " first choice ",
              refusal: null,
              tool_calls: [],
              function_call: null,
            },
            finish_reason: "stop",
          },
          {
            message: { role: "assistant", content: "second choice" },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const client = createChatCompletionsClient(config(), { fetch: fetchMock });

    await expect(
      client.complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      }),
    ).resolves.toBe(" first choice ");
  });

  it.each([
    ["null content", { content: null }],
    ["empty content", { content: "" }],
    ["array content", { content: [{ type: "text", text: "synthetic" }] }],
    ["refusal", { content: "synthetic", refusal: "provider-message-sentinel" }],
    ["tool calls", { tool_calls: [{ id: "call-1" }] }],
    ["function call", { function_call: { name: "synthetic" } }],
    ["missing finish reason", { finish_reason: undefined }],
    ["length finish reason", { finish_reason: "length" }],
  ])(
    "complete rejects invalid response envelopes without exposing provider text: %s",
    async (_name, override) => {
      const message = {
        role: "assistant",
        content: "valid",
        ...override,
      };
      const choice = {
        message,
        finish_reason: "stop",
        ...(Object.prototype.hasOwnProperty.call(override, "finish_reason")
          ? {
              finish_reason: (override as { finish_reason?: unknown })
                .finish_reason,
            }
          : {}),
      };
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ choices: [choice] }),
      );
      const client = createChatCompletionsClient(config(), {
        fetch: fetchMock,
      });
      const error = await client
        .complete({
          systemContent: SYSTEM_CONTENT,
          userContent: USER_CONTENT,
        })
        .catch((caught: unknown) => caught);

      expectSafeError(error, {
        code: "LLM_RESPONSE_PROTOCOL_ERROR",
        category: "response_protocol",
        retryable: false,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("complete rejects malformed JSON UTF-8 and choice envelopes safely", async () => {
    const envelopes: readonly (string | Uint8Array)[] = [
      "provider-body-sentinel",
      "{}",
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: { content: "synthetic" } }] }),
      new Uint8Array([0xff, 0xfe, 0xfd]),
    ];

    for (const envelope of envelopes) {
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(envelope, {
            headers: { "Content-Type": "application/json" },
          }),
      );
      const client = createChatCompletionsClient(config(), {
        fetch: fetchMock,
      });
      const error = await client
        .complete({
          systemContent: SYSTEM_CONTENT,
          userContent: USER_CONTENT,
        })
        .catch((caught: unknown) => caught);

      expectSafeError(error, {
        code: "LLM_RESPONSE_PROTOCOL_ERROR",
        category: "response_protocol",
        retryable: false,
      });
    }
  });
});

describe("complete failure boundaries", () => {
  it("complete maps HTTP network cancellation timeout and size failures safely", async () => {
    const statusCases = [
      [400, false],
      [401, false],
      [403, false],
      [404, false],
      [429, true],
      [500, true],
      [503, true],
    ] as const;

    for (const [status, retryable] of statusCases) {
      const cancel = vi.fn(async () => undefined);
      const fetchMock = vi.fn<typeof fetch>(async () => {
        const response = new Response("provider-body-sentinel", { status });
        Object.defineProperty(response, "body", {
          configurable: true,
          value: { cancel },
        });
        return response;
      });
      const client = createChatCompletionsClient(config(), {
        fetch: fetchMock,
      });
      const error = await client
        .complete({
          systemContent: SYSTEM_CONTENT,
          userContent: USER_CONTENT,
        })
        .catch((caught: unknown) => caught);

      expectSafeError(error, {
        code: "LLM_HTTP_ERROR",
        category: "http",
        retryable,
        status,
      });
      expect(cancel).toHaveBeenCalledOnce();
    }

    const networkFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("provider-body-sentinel");
    });
    const networkClient = createChatCompletionsClient(config(), {
      fetch: networkFetch,
    });
    const networkError = await networkClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    expectSafeError(networkError, {
      code: "LLM_NETWORK_ERROR",
      category: "network",
      retryable: true,
    });

    vi.useFakeTimers();
    const hangingFetch = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined),
    );
    const timeoutClient = createChatCompletionsClient(
      config({ timeoutMs: 50 }),
      { fetch: hangingFetch },
    );
    const timeout = timeoutClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(50);
    expectSafeError(await timeout, {
      code: "LLM_TIMEOUT",
      category: "timeout",
      retryable: true,
    });

    const controller = new AbortController();
    const cancellationClient = createChatCompletionsClient(config(), {
      fetch: hangingFetch,
    });
    const cancellation = cancellationClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
        signal: controller.signal,
      })
      .catch((caught: unknown) => caught);
    controller.abort();
    expectSafeError(await cancellation, {
      code: "LLM_CANCELLED",
      category: "cancellation",
      retryable: false,
    });
  });

  it("complete bounds fetch timeout and caller cancellation without waiting for abort", async () => {
    vi.useFakeTimers();
    let fetchSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      fetchSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const client = createChatCompletionsClient(config({ timeoutMs: 25 }), {
      fetch: fetchMock,
    });

    const timeout = client
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(25);
    expectSafeError(await timeout, {
      code: "LLM_TIMEOUT",
      category: "timeout",
      retryable: true,
    });
    expect(fetchSignal?.aborted).toBe(true);

    const preCancelled = new AbortController();
    preCancelled.abort();
    const preCancelledFetch = vi.fn<typeof fetch>(
      () => new Promise(() => undefined),
    );
    const preCancelledClient = createChatCompletionsClient(config(), {
      fetch: preCancelledFetch,
    });
    const preCancelledError = await preCancelledClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
        signal: preCancelled.signal,
      })
      .catch((caught: unknown) => caught);
    expectSafeError(preCancelledError, {
      code: "LLM_CANCELLED",
      category: "cancellation",
      retryable: false,
    });
    expect(preCancelledFetch).not.toHaveBeenCalled();
  });

  it("complete bounds the stream by bytes read rather than Content-Length", async () => {
    const encoder = new TextEncoder();
    const body = responseBody("answer");
    const first = encoder.encode(body.slice(0, 10));
    const second = encoder.encode(body.slice(10));
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response = streamedResponse([first, second], {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "1",
        },
      });
      Object.defineProperty(response.body!, "cancel", { value: cancel });
      return response;
    });
    const client = createChatCompletionsClient(
      config({ maxResponseBytes: first.byteLength + second.byteLength - 1 }),
      { fetch: fetchMock },
    );

    const error = await client
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    expectSafeError(error, {
      code: "LLM_RESPONSE_TOO_LARGE",
      category: "response_size",
      retryable: false,
    });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());

    const missingLengthResponse = streamedResponse([first, second], {
      headers: { "Content-Type": "application/json" },
    });
    const missingLengthClient = createChatCompletionsClient(
      config({ maxResponseBytes: first.byteLength + second.byteLength }),
      {
        fetch: vi.fn<typeof fetch>(async () => missingLengthResponse),
      },
    );
    await expect(
      missingLengthClient.complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      }),
    ).resolves.toBe("answer");

    const enlargeContent = "x".repeat(100);
    const tooLargeResponse = completionResponse(enlargeContent);
    const contentLengthClient = createChatCompletionsClient(
      config({
        maxResponseBytes:
          tooLargeResponse.headers.get("content-length") === null ? 1 : 5,
      }),
      { fetch: vi.fn<typeof fetch>(async () => tooLargeResponse) },
    );
    const contentLengthError = await contentLengthClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    expectSafeError(contentLengthError, {
      code: "LLM_RESPONSE_TOO_LARGE",
      category: "response_size",
      retryable: false,
    });
  });

  it("complete cancels a hanging response body on timeout or caller cancellation", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
      });
      Object.defineProperty(body, "cancel", { value: cancel });
      return new Response(body);
    });
    const client = createChatCompletionsClient(config({ timeoutMs: 20 }), {
      fetch: fetchMock,
    });
    const timeout = client
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
      })
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(20);
    expectSafeError(await timeout, {
      code: "LLM_TIMEOUT",
      category: "timeout",
      retryable: true,
    });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());

    const controller = new AbortController();
    const cancellationClient = createChatCompletionsClient(config(), {
      fetch: fetchMock,
    });
    const cancellation = cancellationClient
      .complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
        signal: controller.signal,
      })
      .catch((caught: unknown) => caught);
    await flushMicrotasks();
    controller.abort();
    expectSafeError(await cancellation, {
      code: "LLM_CANCELLED",
      category: "cancellation",
      retryable: false,
    });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
  });

  it("complete does not await hanging or rejecting cancellation", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const hangingCancel = vi.fn(() => new Promise<void>(() => undefined));
      const rejectingCancel = vi.fn(() =>
        Promise.reject(new Error("cancel-provider-sentinel")),
      );
      const throwingCancel = vi.fn(() => {
        throw new Error("cancel-throw-sentinel");
      });

      for (const cancel of [hangingCancel, rejectingCancel, throwingCancel]) {
        const fetchMock = vi.fn<typeof fetch>(async () => {
          const body = new ReadableStream<Uint8Array>({
            pull() {
              return new Promise<void>(() => undefined);
            },
          });
          Object.defineProperty(body, "cancel", { value: cancel });
          return new Response(body);
        });
        const controller = new AbortController();
        const client = createChatCompletionsClient(config(), {
          fetch: fetchMock,
        });
        const result = client
          .complete({
            systemContent: SYSTEM_CONTENT,
            userContent: USER_CONTENT,
            signal: controller.signal,
          })
          .catch((caught: unknown) => caught);
        await flushMicrotasks();
        controller.abort();
        expectSafeError(await result, {
          code: "LLM_CANCELLED",
          category: "cancellation",
          retryable: false,
        });
      }

      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("complete does not retain caller listeners between calls", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const client = createChatCompletionsClient(config(), {
      fetch: vi.fn<typeof fetch>(async () => completionResponse("answer")),
    });

    await expect(
      client.complete({
        systemContent: SYSTEM_CONTENT,
        userContent: USER_CONTENT,
        signal: controller.signal,
      }),
    ).resolves.toBe("answer");

    const listener = add.mock.calls[0]?.[1];
    expect(listener).toBeDefined();
    expect(remove).toHaveBeenCalledWith("abort", listener);
    controller.abort();
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("configuration", () => {
  it("complete validates endpoint transport and numeric configuration before fetch", async () => {
    const invalidConfigs: ChatCompletionsConfig[] = [
      config({ endpoint: "not a url" }),
      config({ endpoint: "ftp://example.test/chat" }),
      config({ endpoint: "http://example.test/chat" }),
      config({ endpoint: "http://localhost.example.test/chat" }),
      config({ endpoint: "https://user@example.test/chat" }),
      config({ endpoint: "https://user:pass@example.test/chat" }),
      config({ endpoint: "https://@example.test/chat" }),
      config({ endpoint: "https://:@example.test/chat" }),
      config({ apiKey: "" }),
      config({ model: "  " }),
      config({ timeoutMs: 0 }),
      config({ timeoutMs: Number.NaN }),
      config({ timeoutMs: Number.POSITIVE_INFINITY }),
      config({ maxResponseBytes: -1 }),
      config({ maxResponseBytes: 1.5 }),
    ];

    for (const invalidConfig of invalidConfigs) {
      const fetchMock = vi.fn<typeof fetch>();
      expect(() =>
        createChatCompletionsClient(invalidConfig, { fetch: fetchMock }),
      ).toThrowError(
        expect.objectContaining({
          code: "LLM_CONFIG_INVALID",
          category: "configuration",
          retryable: false,
          status: undefined,
        }),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }

    for (const endpoint of [
      "http://127.0.0.1/chat",
      "http://localhost/chat",
      "http://LOCALHOST/chat",
      "http://[::1]/chat",
      "http://[0:0:0:0:0:0:0:1]/chat",
      "http://127.1/chat",
      "http://2130706433/chat",
      "http://127.0.0.1/path@value",
      "http://127.0.0.1/chat?next=user@example.test",
      "http://127.0.0.1/chat#fragment@value",
      "https://other.example.test/chat",
      "https://OTHER.EXAMPLE.TEST/chat",
    ]) {
      expect(() =>
        createChatCompletionsClient(config({ endpoint }), {
          fetch: vi.fn<typeof fetch>(),
        }),
      ).not.toThrow();
    }
  });
});
