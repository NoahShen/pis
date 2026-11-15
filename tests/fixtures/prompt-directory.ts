import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const PROMPT_FIXTURES = {
  "processing-route.md":
    "# Synthetic processing route\nRoute fixture content.\n",
  "event-search.md": "# Synthetic event search\nSearch fixture content.\n",
  "event-analysis.md": "# Synthetic event analysis\nEvent fixture content.\n",
  "knowledge-analysis.md":
    "# Synthetic knowledge analysis\nKnowledge fixture content.\n",
  "topic-matching.md": "# Synthetic topic matching\nTopic fixture content.\n",
  "user-context.md":
    "# Synthetic test context\nThis fixture contains no private data.\n",
} as const;

export type PromptFixtureName = keyof typeof PROMPT_FIXTURES;

export const PROMPT_FIXTURE_NAMES = Object.keys(
  PROMPT_FIXTURES,
) as PromptFixtureName[];

export async function writePromptFiles(
  directory: string,
  fileNames: readonly PromptFixtureName[] = PROMPT_FIXTURE_NAMES,
): Promise<void> {
  await mkdir(directory, { recursive: true });

  await Promise.all(
    fileNames.map((fileName) =>
      writeFile(
        path.join(directory, fileName),
        PROMPT_FIXTURES[fileName],
        "utf8",
      ),
    ),
  );
}

export async function writePromptDirectory(
  directory: string,
  overrides: Partial<Record<PromptFixtureName, string>> = {},
): Promise<void> {
  await mkdir(directory, { recursive: true });

  await Promise.all(
    PROMPT_FIXTURE_NAMES.map((fileName) =>
      writeFile(
        path.join(directory, fileName),
        overrides[fileName] ?? PROMPT_FIXTURES[fileName],
        "utf8",
      ),
    ),
  );
}
