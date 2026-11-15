import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LLM_OPERATIONS,
  PromptConfigurationError,
  PromptRepository,
  type LlmOperation,
  type PromptConfigurationErrorCode,
} from "../../src/prompt/prompt-repository.js";
import {
  PROMPT_FIXTURES,
  PROMPT_FIXTURE_NAMES,
  writePromptDirectory,
  writePromptFiles,
} from "../fixtures/prompt-directory.js";
import { withTempDirectory } from "../fixtures/temp-directory.js";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function capturePromptError(
  operation: LlmOperation,
  repository: PromptRepository,
): Promise<PromptConfigurationError> {
  try {
    await repository.load(operation);
  } catch (error) {
    expect(error).toBeInstanceOf(PromptConfigurationError);
    return error as PromptConfigurationError;
  }

  throw new Error("Expected PromptRepository.load to fail");
}

function expectPromptError(
  error: PromptConfigurationError,
  code: PromptConfigurationErrorCode,
): void {
  expect(error).toMatchObject({
    name: "PromptConfigurationError",
    category: "configuration",
    retryable: false,
    code,
  });
  expect(error).not.toHaveProperty("cause");
}

describe("PromptRepository", () => {
  it("PromptRepository loads the fixed Markdown source on every operation", async () => {
    await withTempDirectory(async (directory) => {
      await writePromptDirectory(directory);
      const repository = new PromptRepository(directory);

      for (const operation of LLM_OPERATIONS) {
        const fileName = `${operation}.md` as const;
        const loaded = await repository.load(operation);

        expect(loaded.instructions).toBe(PROMPT_FIXTURES[fileName]);
        expect(loaded.userContext).toBe(
          operation === "knowledge-analysis"
            ? PROMPT_FIXTURES["user-context.md"]
            : null,
        );
      }
    });
  });

  it("PromptRepository rereads a changed prompt on the next load", async () => {
    await withTempDirectory(async (directory) => {
      await writePromptDirectory(directory);
      const repository = new PromptRepository(directory);
      const first = await repository.load("processing-route");
      const revised = "# Revised processing route\nUse the latest source.\n";

      await writeFile(
        path.join(directory, "processing-route.md"),
        revised,
        "utf8",
      );

      const second = await repository.load("processing-route");

      expect(first.instructions).toBe(PROMPT_FIXTURES["processing-route.md"]);
      expect(second.instructions).toBe(revised);
    });
  });

  it("PromptRepository reads user context only for knowledge analysis", async () => {
    await withTempDirectory(async (directory) => {
      const functionalPromptNames = PROMPT_FIXTURE_NAMES.filter(
        (fileName) => fileName !== "user-context.md",
      );
      await writePromptFiles(directory, functionalPromptNames);
      const repository = new PromptRepository(directory);

      for (const operation of LLM_OPERATIONS) {
        if (operation === "knowledge-analysis") {
          continue;
        }

        await expect(repository.load(operation)).resolves.toEqual({
          instructions: PROMPT_FIXTURES[`${operation}.md`],
          userContext: null,
        });
      }

      const error = await capturePromptError("knowledge-analysis", repository);
      expectPromptError(error, "PROMPT_FILE_MISSING");
      expect(error.operation).toBe("knowledge-analysis");
      expect(error.fileName).toBe("user-context.md");

      const absentDirectoryError = await capturePromptError(
        "topic-matching",
        new PromptRepository(path.join(directory, "not-present")),
      );
      expectPromptError(absentDirectoryError, "PROMPT_FILE_MISSING");
      expect(absentDirectoryError.operation).toBe("topic-matching");
      expect(absentDirectoryError.fileName).toBe("topic-matching.md");
    });
  });

  it("PromptRepository preserves raw text in an independent snapshot", async () => {
    await withTempDirectory(async (directory) => {
      const rawInstructions = "\n  synthetic route text  \r\n";
      const rawContext = "\n  synthetic context text  \n";
      await writePromptDirectory(directory, {
        "knowledge-analysis.md": rawInstructions,
        "user-context.md": rawContext,
      });
      const repository = new PromptRepository(directory);
      const first = await repository.load("knowledge-analysis");

      await writePromptDirectory(directory, {
        "knowledge-analysis.md": "# Replaced instructions\n",
        "user-context.md": "# Replaced context\n",
      });

      const second = await repository.load("knowledge-analysis");

      expect(first).toEqual({
        instructions: rawInstructions,
        userContext: rawContext,
      });
      expect(second).toEqual({
        instructions: "# Replaced instructions\n",
        userContext: "# Replaced context\n",
      });
      expect(first).not.toBe(second);
    });
  });

  it("PromptRepository fails closed for invalid directories operations and missing files", async () => {
    expect(() => new PromptRepository("   ")).toThrowError(
      expect.objectContaining({
        code: "PROMPT_DIRECTORY_INVALID",
        category: "configuration",
        retryable: false,
        operation: null,
        fileName: null,
      }),
    );

    await withTempDirectory(async (directory) => {
      const repository = new PromptRepository(directory);
      for (const invalidOperation of [
        "unknown-operation",
        "constructor",
        "toString",
        "__proto__",
      ]) {
        const invalidOperationError = await capturePromptError(
          invalidOperation as LlmOperation,
          repository,
        );
        expectPromptError(invalidOperationError, "PROMPT_OPERATION_INVALID");
        expect(invalidOperationError.operation).toBeNull();
        expect(invalidOperationError.fileName).toBeNull();
      }

      const missingError = await capturePromptError(
        "processing-route",
        repository,
      );
      expectPromptError(missingError, "PROMPT_FILE_MISSING");
      expect(missingError.fileName).toBe("processing-route.md");

      await mkdir(path.join(directory, "event-analysis.md"));
      const unreadableError = await capturePromptError(
        "event-analysis",
        repository,
      );
      expectPromptError(unreadableError, "PROMPT_FILE_UNREADABLE");
      expect(unreadableError.fileName).toBe("event-analysis.md");
    });
  });

  it("PromptRepository reports empty prompt content without leaking source text", async () => {
    await withTempDirectory(async (directory) => {
      const sentinel = "private-source-sentinel";
      await writePromptDirectory(directory, {
        "event-search.md": " \n\t\r",
        "user-context.md": ` ${sentinel} \n`,
      });
      const repository = new PromptRepository(directory);
      const instructionsError = await capturePromptError(
        "event-search",
        repository,
      );

      expectPromptError(instructionsError, "PROMPT_CONTENT_EMPTY");
      expect(instructionsError.operation).toBe("event-search");
      expect(instructionsError.fileName).toBe("event-search.md");
      expect(String(instructionsError)).not.toContain(directory);
      expect(String(instructionsError)).not.toContain(sentinel);

      await writePromptDirectory(directory);
      await writeFile(
        path.join(directory, "user-context.md"),
        " \n\t\n",
        "utf8",
      );
      const contextError = await capturePromptError(
        "knowledge-analysis",
        repository,
      );

      expectPromptError(contextError, "PROMPT_CONTENT_EMPTY");
      expect(contextError.operation).toBe("knowledge-analysis");
      expect(contextError.fileName).toBe("user-context.md");
      expect(String(contextError)).not.toContain(directory);
      expect(String(contextError)).not.toContain(sentinel);
    });
  });
});

describe("public synthetic prompt context", () => {
  it("public user context is explicitly synthetic and independent", async () => {
    const userContext = await readFile(
      path.join(PROJECT_ROOT, "config/prompts/user-context.md"),
      "utf8",
    );
    const firstLine = userContext.split(/\r?\n/u, 1)[0];

    expect(firstLine).toBe("# D02 固定测试用通用合成背景");
    expect(userContext).toContain(
      "不是任何私有 User Context 的复制、改写、脱敏、摘要或派生版本",
    );
  });
});
