import {
  ChatCompletionsError,
  type ChatCompletionsProtocolReason,
  type TextCompletionClient,
  type TextCompletionRequest,
} from "./chat-completions-client.js";
import {
  ServerSentEventParser,
  SseEventLimitError,
} from "./stream-protocol.js";

export type StreamingChatCompletionsProtocolReason =
  ChatCompletionsProtocolReason;

export type LlmStreamState =
  | "request_started"
  | "first_chunk_received"
  | "reasoning_started"
  | "content_started"
  | "stream_done"
  | "local_deadline"
  | "upstream_closed"
  | "cancelled";

export interface StreamingChatCompletionsConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly firstByteTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxEvents: number;
  readonly maxContentLength: number;
}

export interface LlmStreamObservation {
  readonly streamState: LlmStreamState;
  readonly firstByteMs?: number;
  readonly firstContentMs?: number;
}

export interface StreamingChatCompletionsDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly onStateChange?: (observation: LlmStreamObservation) => void;
}

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 32_768;

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(
  reason: StreamingChatCompletionsProtocolReason = "LLM_RESPONSE_MALFORMED",
): ChatCompletionsError {
  return new ChatCompletionsError(
    "LLM_RESPONSE_PROTOCOL_ERROR",
    undefined,
    reason,
  );
}

function cancellationError(): ChatCompletionsError {
  return new ChatCompletionsError("LLM_CANCELLED");
}

function isSafeHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function validateConfig(
  config: StreamingChatCompletionsConfig,
): StreamingChatCompletionsConfig {
  try {
    const url = new URL(config.endpoint);
    if (
      !isNonBlankString(config.endpoint) ||
      !isNonBlankString(config.apiKey) ||
      !isNonBlankString(config.model) ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) ||
      !isPositiveInteger(config.firstByteTimeoutMs) ||
      !isPositiveInteger(config.idleTimeoutMs) ||
      !isPositiveInteger(config.totalTimeoutMs) ||
      !isPositiveInteger(config.maxResponseBytes) ||
      !isPositiveInteger(config.maxEvents) ||
      !isPositiveInteger(config.maxContentLength)
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new ChatCompletionsError("LLM_CONFIG_INVALID");
  }
  return config;
}

type TerminalReason = "cancelled" | "first_byte" | "idle" | "total";

function terminalError(reason: TerminalReason): ChatCompletionsError {
  if (reason === "cancelled") {
    return cancellationError();
  }
  return protocolError(
    reason === "first_byte"
      ? "LLM_FIRST_BYTE_TIMEOUT"
      : reason === "idle"
        ? "LLM_STREAM_IDLE_TIMEOUT"
        : "LLM_TIMEOUT_LOCAL",
  );
}

function consumeRejection(value: PromiseLike<unknown>): void {
  Promise.resolve(value).catch(() => undefined);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    consumeRejection(reader.cancel());
  } catch {
    // Cleanup never replaces the primary outcome.
  }
}

function cancelBody(body: ReadableStream<Uint8Array>): void {
  try {
    consumeRejection(body.cancel());
  } catch {
    // Cleanup never replaces the primary outcome.
  }
}

function hasActiveRefusal(message: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(message, "refusal") &&
    message.refusal !== null &&
    message.refusal !== undefined &&
    message.refusal !== ""
  );
}

function hasActiveToolOrFunctionCall(
  message: Record<string, unknown>,
): boolean {
  if (Object.prototype.hasOwnProperty.call(message, "tool_calls")) {
    const calls = message.tool_calls;
    if (!Array.isArray(calls) || calls.length > 0) {
      return true;
    }
  }
  return (
    Object.prototype.hasOwnProperty.call(message, "function_call") &&
    message.function_call !== null &&
    message.function_call !== undefined
  );
}

interface ContentAccumulator {
  readonly content: string;
  readonly hasReasoning: boolean;
  readonly addDelta: (delta: unknown) => void;
  readonly acceptFinalMessage: (message: unknown) => void;
}

function createContentAccumulator(
  maxContentLength: number,
  onReasoning: () => void,
  onContent: () => void,
): ContentAccumulator {
  let content = "";
  let hasReasoning = false;
  let hasContent = false;

  function append(value: unknown): void {
    if (typeof value !== "string") {
      throw protocolError();
    }
    if (value.length === 0) {
      return;
    }
    content += value;
    if (content.length > maxContentLength) {
      throw new ChatCompletionsError("LLM_RESPONSE_TOO_LARGE");
    }
    if (!hasContent) {
      hasContent = true;
      onContent();
    }
  }

  return {
    get content() {
      return content;
    },
    get hasReasoning() {
      return hasReasoning;
    },
    addDelta(delta) {
      if (!isRecord(delta)) {
        throw protocolError();
      }
      if (hasActiveRefusal(delta)) {
        throw protocolError("LLM_REFUSAL");
      }
      if (hasActiveToolOrFunctionCall(delta)) {
        throw protocolError("LLM_TOOL_CALL_UNEXPECTED");
      }
      if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        hasReasoning = true;
        onReasoning();
      }
      if (
        typeof delta.reasoning_content === "string" &&
        delta.reasoning_content.length > 0
      ) {
        hasReasoning = true;
        onReasoning();
      }
      if (delta.content !== undefined && delta.content !== null) {
        append(delta.content);
      }
    },
    acceptFinalMessage(message) {
      if (message === undefined) {
        return;
      }
      if (!isRecord(message)) {
        throw protocolError();
      }
      if (hasActiveRefusal(message)) {
        throw protocolError("LLM_REFUSAL");
      }
      if (hasActiveToolOrFunctionCall(message)) {
        throw protocolError("LLM_TOOL_CALL_UNEXPECTED");
      }
      if (
        message.content !== undefined &&
        message.content !== null &&
        !hasContent
      ) {
        append(message.content);
      }
    },
  };
}

/** One bounded streaming request. Retry and operation policy belong to callers. */
export function createStreamingChatCompletionsClient(
  config: StreamingChatCompletionsConfig,
  dependencies: StreamingChatCompletionsDependencies = {},
): TextCompletionClient {
  const validated = validateConfig(config);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;

  return {
    async complete(request: TextCompletionRequest): Promise<string> {
      const callerSignal = request.signal;
      if (callerSignal?.aborted) {
        throw cancellationError();
      }

      const startedAt = Date.now();
      let firstByteMs: number | undefined;
      let firstContentMs: number | undefined;
      const observe = (streamState: LlmStreamState): void => {
        try {
          dependencies.onStateChange?.({
            streamState,
            ...(firstByteMs === undefined ? {} : { firstByteMs }),
            ...(firstContentMs === undefined ? {} : { firstContentMs }),
          });
        } catch {
          // Diagnostics must not affect the completion.
        }
      };
      observe("request_started");

      const abortController = new AbortController();
      let terminalReason: TerminalReason | null = null;
      let resolveTerminal!: (reason: TerminalReason) => void;
      const terminal = new Promise<TerminalReason>((resolve) => {
        resolveTerminal = resolve;
      });
      const beginTerminal = (reason: TerminalReason): void => {
        if (terminalReason !== null) {
          return;
        }
        terminalReason = reason;
        resolveTerminal(reason);
        observe(reason === "cancelled" ? "cancelled" : "local_deadline");
        abortController.abort();
      };
      const onCallerAbort = (): void => beginTerminal("cancelled");
      let totalTimer: ReturnType<typeof setTimeout> | undefined;
      let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let body: ReadableStream<Uint8Array> | null = null;
      let streamFinished = false;
      let cleanupStarted = false;

      const raceTerminal = async <T>(operation: Promise<T>): Promise<T> =>
        Promise.race([
          operation,
          terminal.then((reason) => {
            throw terminalError(reason);
          }),
        ]);

      const clearDataTimers = (): void => {
        if (firstByteTimer !== undefined) {
          clearTimeout(firstByteTimer);
          firstByteTimer = undefined;
        }
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };

      try {
        totalTimer = setTimeout(
          () => beginTerminal("total"),
          validated.totalTimeoutMs,
        );
        firstByteTimer = setTimeout(
          () => beginTerminal("first_byte"),
          validated.firstByteTimeoutMs,
        );
        callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
        if (callerSignal?.aborted) {
          onCallerAbort();
        }
        if (terminalReason !== null) {
          throw terminalError(terminalReason);
        }

        let response: Response;
        try {
          response = await raceTerminal(
            fetchImplementation(validated.endpoint, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${validated.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: validated.model,
                stream: true,
                messages: [
                  { role: "system", content: request.systemContent },
                  { role: "user", content: request.userContent },
                ],
              }),
              redirect: "error",
              signal: abortController.signal,
            }),
          );
        } catch (error) {
          if (terminalReason !== null) {
            throw terminalError(terminalReason);
          }
          if (error instanceof ChatCompletionsError) {
            throw error;
          }
          throw new ChatCompletionsError("LLM_NETWORK_ERROR");
        }
        if (terminalReason !== null) {
          throw terminalError(terminalReason);
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
            // The HTTP status remains the safe primary outcome.
          }
          if (body !== null) {
            cleanupStarted = true;
            cancelBody(body);
          }
          if (status === 499) {
            const error = protocolError("LLM_UPSTREAM_CANCELED");
            Object.defineProperty(error, "status", { value: 499 });
            Object.defineProperty(error, "category", { value: "http" });
            throw error;
          }
          throw new ChatCompletionsError("LLM_HTTP_ERROR", status);
        }

        try {
          body = response.body;
          if (body === null) {
            throw new Error("missing body");
          }
          reader = body.getReader();
        } catch {
          throw protocolError();
        }

        let doneReceived = false;
        let finished = false;
        let finishReasonSeen = false;
        let actualBytes = 0;
        const accumulator = createContentAccumulator(
          validated.maxContentLength,
          () => observe("reasoning_started"),
          () => {
            if (firstContentMs === undefined) {
              firstContentMs = Date.now() - startedAt;
            }
            observe("content_started");
          },
        );
        const parser = new ServerSentEventParser({
          maxEvents: validated.maxEvents,
          onEvent({ data }) {
            if (firstByteTimer !== undefined) {
              clearTimeout(firstByteTimer);
              firstByteTimer = undefined;
            }
            if (idleTimer !== undefined) {
              clearTimeout(idleTimer);
              idleTimer = undefined;
            }
            idleTimer = setTimeout(
              () => beginTerminal("idle"),
              validated.idleTimeoutMs,
            );
            if (firstByteMs === undefined) {
              firstByteMs = Date.now() - startedAt;
              observe("first_chunk_received");
            }
            if (data.trim() === "[DONE]") {
              if (doneReceived) {
                throw protocolError();
              }
              clearTimeout(idleTimer);
              idleTimer = undefined;
              doneReceived = true;
              return;
            }

            let payload: unknown;
            try {
              payload = JSON.parse(data);
            } catch {
              throw protocolError();
            }
            if (!isRecord(payload) || !Array.isArray(payload.choices)) {
              throw protocolError();
            }
            if (payload.choices.length === 0) {
              if (!isRecord(payload.usage)) {
                throw protocolError();
              }
              return;
            }
            if (doneReceived) {
              throw protocolError();
            }
            const choice = payload.choices[0];
            if (!isRecord(choice)) {
              throw protocolError();
            }
            if (choice.delta !== undefined) {
              accumulator.addDelta(choice.delta);
            }
            accumulator.acceptFinalMessage(choice.message);
            if (
              choice.finish_reason !== undefined &&
              choice.finish_reason !== null
            ) {
              finishReasonSeen = true;
              if (choice.finish_reason === "length") {
                throw protocolError("LLM_OUTPUT_TRUNCATED");
              }
              if (choice.finish_reason === "content_filter") {
                throw protocolError("LLM_CONTENT_FILTERED");
              }
              if (choice.finish_reason !== "stop") {
                throw protocolError("LLM_FINISH_REASON_INVALID");
              }
              finished = true;
            }
          },
        });

        try {
          while (true) {
            const readResult = await raceTerminal(reader.read());
            if (terminalReason !== null) {
              throw terminalError(terminalReason);
            }
            if (readResult.done) {
              streamFinished = true;
              parser.finish();
              observe("upstream_closed");
              break;
            }
            if (!(readResult.value instanceof Uint8Array)) {
              throw protocolError();
            }
            actualBytes += readResult.value.byteLength;
            if (actualBytes > validated.maxResponseBytes) {
              throw new ChatCompletionsError("LLM_RESPONSE_TOO_LARGE");
            }
            parser.write(readResult.value);
          }
        } catch (error) {
          if (terminalReason !== null) {
            throw terminalError(terminalReason);
          }
          if (error instanceof ChatCompletionsError) {
            throw error;
          }
          if (error instanceof SseEventLimitError) {
            throw new ChatCompletionsError("LLM_RESPONSE_TOO_LARGE");
          }
          if (error instanceof SyntaxError || error instanceof TypeError) {
            throw protocolError();
          }
          throw protocolError("LLM_STREAM_ABORTED");
        }

        if (doneReceived) {
          try {
            parser.finish();
          } catch (error) {
            if (error instanceof ChatCompletionsError) {
              throw error;
            }
            throw protocolError();
          }
        }
        if (!doneReceived || !finished || !finishReasonSeen) {
          throw protocolError("LLM_STREAM_INCOMPLETE");
        }
        clearDataTimers();
        const content = accumulator.content;
        if (!isNonBlankString(content)) {
          throw protocolError(
            accumulator.hasReasoning
              ? "LLM_REASONING_ONLY"
              : "LLM_CONTENT_EMPTY",
          );
        }
        if (terminalReason !== null) {
          throw terminalError(terminalReason);
        }
        observe("stream_done");
        return content;
      } finally {
        if (totalTimer !== undefined) {
          clearTimeout(totalTimer);
        }
        clearDataTimers();
        callerSignal?.removeEventListener("abort", onCallerAbort);
        if (reader !== null) {
          if (!streamFinished && !cleanupStarted) {
            cleanupStarted = true;
            cancelReader(reader);
          }
          try {
            reader.releaseLock();
          } catch {
            // A locked or errored stream must not mask the primary outcome.
          }
        } else if (body !== null && !streamFinished && !cleanupStarted) {
          cleanupStarted = true;
          cancelBody(body);
        }
      }
    },
  };
}

export const DEFAULT_STREAM_MAX_RESPONSE_BYTES = DEFAULT_MAX_RESPONSE_BYTES;
export const DEFAULT_STREAM_MAX_EVENTS = DEFAULT_MAX_EVENTS;
