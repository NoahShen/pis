export interface ChatCompletionsConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface TextCompletionRequest {
  readonly systemContent: string;
  readonly userContent: string;
  readonly signal?: AbortSignal;
}

export interface TextCompletionClient {
  complete(request: TextCompletionRequest): Promise<string>;
}

export type ChatCompletionsErrorCode =
  | "LLM_CONFIG_INVALID"
  | "LLM_CANCELLED"
  | "LLM_TIMEOUT"
  | "LLM_NETWORK_ERROR"
  | "LLM_HTTP_ERROR"
  | "LLM_RESPONSE_PROTOCOL_ERROR"
  | "LLM_RESPONSE_TOO_LARGE";

export type ChatCompletionsProtocolReason =
  | "LLM_RESPONSE_MALFORMED"
  | "LLM_CONTENT_EMPTY"
  | "LLM_FINISH_REASON_INVALID"
  | "LLM_OUTPUT_TRUNCATED"
  | "LLM_REFUSAL"
  | "LLM_TOOL_CALL_UNEXPECTED";

export type ChatCompletionsErrorCategory =
  | "configuration"
  | "cancellation"
  | "timeout"
  | "network"
  | "http"
  | "response_protocol"
  | "response_size";

const ERROR_CATEGORIES = {
  LLM_CONFIG_INVALID: "configuration",
  LLM_CANCELLED: "cancellation",
  LLM_TIMEOUT: "timeout",
  LLM_NETWORK_ERROR: "network",
  LLM_HTTP_ERROR: "http",
  LLM_RESPONSE_PROTOCOL_ERROR: "response_protocol",
  LLM_RESPONSE_TOO_LARGE: "response_size",
} as const satisfies Record<
  ChatCompletionsErrorCode,
  ChatCompletionsErrorCategory
>;

function isRetryableHttpStatus(status: number | undefined): boolean {
  return (
    status === 429 || (status !== undefined && status >= 500 && status <= 599)
  );
}

function isSafeHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

export class ChatCompletionsError extends Error {
  readonly code: ChatCompletionsErrorCode;
  readonly category: ChatCompletionsErrorCategory;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly reason: ChatCompletionsErrorCode | ChatCompletionsProtocolReason;

  constructor(
    code: ChatCompletionsErrorCode,
    status?: number,
    reason: ChatCompletionsProtocolReason = "LLM_RESPONSE_MALFORMED",
  ) {
    super(`Chat Completions error: ${code}`);
    this.name = "ChatCompletionsError";
    this.code = code;
    this.category = ERROR_CATEGORIES[code];
    this.status =
      code === "LLM_HTTP_ERROR" && isSafeHttpStatus(status)
        ? status
        : undefined;
    this.reason = code === "LLM_RESPONSE_PROTOCOL_ERROR" ? reason : code;
    this.retryable =
      code === "LLM_TIMEOUT" ||
      code === "LLM_NETWORK_ERROR" ||
      (code === "LLM_RESPONSE_PROTOCOL_ERROR" &&
        reason !== "LLM_REFUSAL" &&
        reason !== "LLM_TOOL_CALL_UNEXPECTED") ||
      (code === "LLM_HTTP_ERROR" && isRetryableHttpStatus(this.status));
  }
}

function configurationError(): ChatCompletionsError {
  return new ChatCompletionsError("LLM_CONFIG_INVALID");
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function hasParserErasedEmptyUserInfo(endpoint: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\/(?::?@)/i.test(
    endpoint.replace(/[\t\n\r]/g, ""),
  );
}

interface ValidatedConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

function validateConfig(config: ChatCompletionsConfig): ValidatedConfig {
  if (typeof config !== "object" || config === null) {
    throw configurationError();
  }

  const { endpoint, apiKey, model } = config;
  if (
    !isNonBlankString(endpoint) ||
    !isNonBlankString(apiKey) ||
    !isNonBlankString(model)
  ) {
    throw configurationError();
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw configurationError();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    hasParserErasedEmptyUserInfo(endpoint) ||
    (url.protocol === "http:" && !isLoopbackHostname(url.hostname))
  ) {
    throw configurationError();
  }

  const timeoutMs = config.timeoutMs ?? 60_000;
  const maxResponseBytes = config.maxResponseBytes ?? 2 * 1024 * 1024;
  if (!isPositiveInteger(timeoutMs) || !isPositiveInteger(maxResponseBytes)) {
    throw configurationError();
  }

  return { endpoint, apiKey, model, timeoutMs, maxResponseBytes };
}

type LifecycleReason = "cancelled" | "timeout";

function lifecycleError(reason: LifecycleReason): ChatCompletionsError {
  return new ChatCompletionsError(
    reason === "cancelled" ? "LLM_CANCELLED" : "LLM_TIMEOUT",
  );
}

function protocolError(
  reason: ChatCompletionsProtocolReason = "LLM_RESPONSE_MALFORMED",
): ChatCompletionsError {
  return new ChatCompletionsError(
    "LLM_RESPONSE_PROTOCOL_ERROR",
    undefined,
    reason,
  );
}

function consumeRejection(value: PromiseLike<unknown>): void {
  Promise.resolve(value).catch(() => undefined);
}

function cancelBody(body: ReadableStream<Uint8Array>): void {
  try {
    consumeRejection(body.cancel());
  } catch {
    // A cleanup failure must not replace the primary completion result.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    consumeRejection(reader.cancel());
  } catch {
    // A cleanup failure must not replace the primary completion result.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasActiveRefusal(message: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(message, "refusal")) {
    return false;
  }

  const refusal = message.refusal;
  return refusal !== null && refusal !== undefined && refusal !== "";
}

function hasActiveToolOrFunctionCall(
  message: Record<string, unknown>,
): boolean {
  if (Object.prototype.hasOwnProperty.call(message, "tool_calls")) {
    const toolCalls = message.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length > 0) {
      return true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(message, "function_call")) {
    return (
      message.function_call !== null && message.function_call !== undefined
    );
  }

  return false;
}

function extractMessageContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw protocolError();
  }

  const choice = payload.choices[0];
  if (!isRecord(choice)) {
    throw protocolError();
  }
  if (
    !Object.prototype.hasOwnProperty.call(choice, "finish_reason") ||
    choice.finish_reason === undefined
  ) {
    throw protocolError();
  }
  if (choice.finish_reason === "length") {
    throw protocolError("LLM_OUTPUT_TRUNCATED");
  }
  if (choice.finish_reason !== "stop") {
    throw protocolError("LLM_FINISH_REASON_INVALID");
  }

  const message = choice.message;
  if (!isRecord(message)) {
    throw protocolError();
  }
  if (hasActiveRefusal(message)) {
    throw protocolError("LLM_REFUSAL");
  }
  if (hasActiveToolOrFunctionCall(message)) {
    throw protocolError("LLM_TOOL_CALL_UNEXPECTED");
  }

  const content = message.content;
  if (!isNonBlankString(content)) {
    throw protocolError("LLM_CONTENT_EMPTY");
  }

  return content;
}

export function createChatCompletionsClient(
  config: ChatCompletionsConfig,
  dependencies?: { readonly fetch?: typeof globalThis.fetch },
): TextCompletionClient {
  const validatedConfig = validateConfig(config);
  const fetchImplementation = dependencies?.fetch ?? globalThis.fetch;

  return {
    async complete(request: TextCompletionRequest): Promise<string> {
      const callerSignal = request.signal;
      if (callerSignal?.aborted) {
        throw lifecycleError("cancelled");
      }

      const abortController = new AbortController();
      let lifecycleReason: LifecycleReason | null = null;
      let resolveLifecycle!: (reason: LifecycleReason) => void;
      const lifecycle = new Promise<LifecycleReason>((resolve) => {
        resolveLifecycle = resolve;
      });

      const beginLifecycle = (reason: LifecycleReason): void => {
        if (lifecycleReason !== null) {
          return;
        }

        lifecycleReason = reason;
        resolveLifecycle(reason);
        abortController.abort();
      };

      const onCallerAbort = (): void => beginLifecycle("cancelled");
      let timer: ReturnType<typeof setTimeout> | undefined;
      let body: ReadableStream<Uint8Array> | null = null;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let bodyCancelStarted = false;
      let readerCancelStarted = false;
      let streamFinished = false;

      const raceLifecycle = async <T>(operation: Promise<T>): Promise<T> => {
        return Promise.race([
          operation,
          lifecycle.then((reason) => {
            throw lifecycleError(reason);
          }),
        ]);
      };

      try {
        timer = setTimeout(
          () => beginLifecycle("timeout"),
          validatedConfig.timeoutMs,
        );
        callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

        if (callerSignal?.aborted) {
          onCallerAbort();
        }
        if (lifecycleReason !== null) {
          throw lifecycleError(lifecycleReason);
        }

        const requestInit: RequestInit = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${validatedConfig.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: validatedConfig.model,
            stream: false,
            messages: [
              { role: "system", content: request.systemContent },
              { role: "user", content: request.userContent },
            ],
          }),
          redirect: "error",
          signal: abortController.signal,
        };

        let response: Response;
        try {
          response = await raceLifecycle(
            fetchImplementation(validatedConfig.endpoint, requestInit),
          );
        } catch (error) {
          if (lifecycleReason !== null) {
            throw lifecycleError(lifecycleReason);
          }
          if (error instanceof ChatCompletionsError) {
            throw error;
          }
          throw new ChatCompletionsError("LLM_NETWORK_ERROR");
        }

        if (lifecycleReason !== null) {
          throw lifecycleError(lifecycleReason);
        }

        let status: unknown;
        try {
          status = response.status;
        } catch {
          throw protocolError();
        }
        if (!isSafeHttpStatus(status)) {
          throw protocolError();
        }

        if (status < 200 || status >= 300) {
          try {
            body = response.body;
          } catch {
            throw new ChatCompletionsError("LLM_HTTP_ERROR", status);
          }
          if (body !== null) {
            bodyCancelStarted = true;
            cancelBody(body);
          }
          throw new ChatCompletionsError("LLM_HTTP_ERROR", status);
        }

        try {
          body = response.body;
        } catch {
          throw protocolError();
        }
        if (body === null) {
          throw protocolError();
        }

        try {
          reader = body.getReader();
        } catch {
          throw protocolError();
        }

        const chunks: Uint8Array[] = [];
        let actualBytes = 0;

        while (true) {
          let readResult: Awaited<
            ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>
          >;
          try {
            readResult = await raceLifecycle(reader.read());
          } catch (error) {
            if (lifecycleReason !== null) {
              throw lifecycleError(lifecycleReason);
            }
            if (error instanceof ChatCompletionsError) {
              throw error;
            }
            throw new ChatCompletionsError("LLM_NETWORK_ERROR");
          }

          if (lifecycleReason !== null) {
            throw lifecycleError(lifecycleReason);
          }
          if (readResult.done) {
            streamFinished = true;
            break;
          }
          if (!(readResult.value instanceof Uint8Array)) {
            throw protocolError();
          }

          actualBytes += readResult.value.byteLength;
          if (actualBytes > validatedConfig.maxResponseBytes) {
            readerCancelStarted = true;
            cancelReader(reader);
            throw new ChatCompletionsError("LLM_RESPONSE_TOO_LARGE");
          }
          chunks.push(readResult.value);
        }

        const responseBytes = new Uint8Array(actualBytes);
        let offset = 0;
        for (const chunk of chunks) {
          responseBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        let contentText: string;
        try {
          contentText = new TextDecoder("utf-8", { fatal: true }).decode(
            responseBytes,
          );
        } catch {
          throw protocolError();
        }

        let payload: unknown;
        try {
          payload = JSON.parse(contentText);
        } catch {
          throw protocolError();
        }

        const content = extractMessageContent(payload);
        if (lifecycleReason !== null) {
          throw lifecycleError(lifecycleReason);
        }
        return content;
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        callerSignal?.removeEventListener("abort", onCallerAbort);

        if (reader !== null) {
          if (!streamFinished && !readerCancelStarted) {
            readerCancelStarted = true;
            cancelReader(reader);
          }
          try {
            reader.releaseLock();
          } catch {
            // Releasing a locked/cancelled stream must not mask the outcome.
          }
          if (body !== null && !streamFinished && !bodyCancelStarted) {
            bodyCancelStarted = true;
            cancelBody(body);
          }
        } else if (body !== null && !bodyCancelStarted) {
          bodyCancelStarted = true;
          cancelBody(body);
        }
      }
    },
  };
}
