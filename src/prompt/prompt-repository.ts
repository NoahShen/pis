import { readFile } from "node:fs/promises";
import path from "node:path";

export const LLM_OPERATIONS = [
  "processing-route",
  "event-search",
  "event-analysis",
  "knowledge-analysis",
  "topic-matching",
] as const;

export type LlmOperation = (typeof LLM_OPERATIONS)[number];

export interface LoadedPrompt {
  readonly instructions: string;
  readonly userContext: string | null;
}

type PromptFileName =
  | "processing-route.md"
  | "event-search.md"
  | "event-analysis.md"
  | "knowledge-analysis.md"
  | "topic-matching.md"
  | "user-context.md";

export type PromptConfigurationErrorCode =
  | "PROMPT_OPERATION_INVALID"
  | "PROMPT_DIRECTORY_INVALID"
  | "PROMPT_FILE_MISSING"
  | "PROMPT_FILE_UNREADABLE"
  | "PROMPT_CONTENT_EMPTY";

const PROMPT_FILES = {
  "processing-route": "processing-route.md",
  "event-search": "event-search.md",
  "event-analysis": "event-analysis.md",
  "knowledge-analysis": "knowledge-analysis.md",
  "topic-matching": "topic-matching.md",
} as const satisfies Record<LlmOperation, PromptFileName>;

const USER_CONTEXT_FILE = "user-context.md";

function isLlmOperation(value: unknown): value is LlmOperation {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PROMPT_FILES, value)
  );
}

function stableErrorCode(error: unknown): unknown {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    return (error as { code?: unknown }).code;
  } catch {
    return undefined;
  }
}

function isMissingFileError(error: unknown): boolean {
  return stableErrorCode(error) === "ENOENT";
}

export class PromptConfigurationError extends Error {
  readonly category = "configuration";
  readonly retryable = false;
  readonly code: PromptConfigurationErrorCode;
  readonly operation: LlmOperation | null;
  readonly fileName: PromptFileName | null;

  constructor(
    code: PromptConfigurationErrorCode,
    operation: LlmOperation | null,
    fileName: PromptFileName | null,
  ) {
    super(`Prompt configuration error: ${code}`);
    this.name = "PromptConfigurationError";
    this.code = code;
    this.operation = operation;
    this.fileName = fileName;
  }
}

export class PromptRepository {
  private readonly promptsDirectory: string;

  constructor(promptsDirectory: string) {
    if (
      typeof promptsDirectory !== "string" ||
      promptsDirectory.trim().length === 0
    ) {
      throw new PromptConfigurationError(
        "PROMPT_DIRECTORY_INVALID",
        null,
        null,
      );
    }

    this.promptsDirectory = promptsDirectory;
  }

  async load(operation: LlmOperation): Promise<LoadedPrompt> {
    if (!isLlmOperation(operation)) {
      throw new PromptConfigurationError(
        "PROMPT_OPERATION_INVALID",
        null,
        null,
      );
    }

    const instructions = await this.readPromptFile(
      operation,
      PROMPT_FILES[operation],
    );

    if (operation !== "knowledge-analysis") {
      return { instructions, userContext: null };
    }

    const userContext = await this.readPromptFile(operation, USER_CONTEXT_FILE);

    return { instructions, userContext };
  }

  private async readPromptFile(
    operation: LlmOperation,
    fileName: PromptFileName,
  ): Promise<string> {
    let contents: string;

    try {
      contents = await readFile(
        path.join(this.promptsDirectory, fileName),
        "utf8",
      );
    } catch (error) {
      throw new PromptConfigurationError(
        isMissingFileError(error)
          ? "PROMPT_FILE_MISSING"
          : "PROMPT_FILE_UNREADABLE",
        operation,
        fileName,
      );
    }

    if (contents.trim().length === 0) {
      throw new PromptConfigurationError(
        "PROMPT_CONTENT_EMPTY",
        operation,
        fileName,
      );
    }

    return contents;
  }
}
