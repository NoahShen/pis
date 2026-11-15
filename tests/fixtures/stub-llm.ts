import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";

export type StubLlmResult = string | Error;

export class StubLlmSequenceExhaustedError extends Error {
  constructor() {
    super("Stub LLM response sequence is exhausted");
    this.name = "StubLlmSequenceExhaustedError";
  }
}

export class StubLLM implements TextCompletionClient {
  private readonly sequence: StubLlmResult[];
  private readonly capturedRequests: TextCompletionRequest[] = [];

  constructor(sequence: readonly StubLlmResult[]) {
    this.sequence = [...sequence];
  }

  get requests(): readonly TextCompletionRequest[] {
    return Object.freeze([...this.capturedRequests]);
  }

  async complete(request: TextCompletionRequest): Promise<string> {
    this.capturedRequests.push(
      Object.freeze({
        systemContent: request.systemContent,
        userContent: request.userContent,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }),
    );

    const result = this.sequence.shift();
    if (result === undefined) {
      throw new StubLlmSequenceExhaustedError();
    }

    if (result instanceof Error) {
      throw result;
    }

    return result;
  }
}
