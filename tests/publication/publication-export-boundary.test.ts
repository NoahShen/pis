import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as publicationBoundary from "../../src/publication/index.js";
import type {
  PublicationContext,
  PublicationDependencies,
  PublicationDraft,
  PublicationErrorCode,
  PublicationEvent,
  PublicationEventSummary,
  PublicationFeed,
  PublicationFinding,
  PublicationKnowledge,
  PublicationLogEntry,
  PublicationLogger,
  PublicationLogReason,
  PublicationLogStage,
  PublicationNotifier,
  PublicationRenderer,
  PublicationService,
  PublicationSourceLinkRepository,
  PublicationTargetRepository,
  PublicationTargetType,
  PublicationUpdate,
  PublishedItem,
  PublishedItemInsert,
  PublishedItemRepository,
  PublishResult,
} from "../../src/publication/index.js";

type ExportBoundaryTypes = {
  readonly context: PublicationContext;
  readonly dependencies: PublicationDependencies;
  readonly draft: PublicationDraft;
  readonly errorCode: PublicationErrorCode;
  readonly event: PublicationEvent;
  readonly eventSummary: PublicationEventSummary;
  readonly feed: PublicationFeed;
  readonly finding: PublicationFinding;
  readonly knowledge: PublicationKnowledge;
  readonly logEntry: PublicationLogEntry;
  readonly logger: PublicationLogger;
  readonly logReason: PublicationLogReason;
  readonly logStage: PublicationLogStage;
  readonly notifier: PublicationNotifier;
  readonly renderer: PublicationRenderer;
  readonly service: PublicationService;
  readonly sourceRepository: PublicationSourceLinkRepository;
  readonly targetRepository: PublicationTargetRepository;
  readonly targetType: PublicationTargetType;
  readonly update: PublicationUpdate;
  readonly publishedItem: PublishedItem;
  readonly publishedInsert: PublishedItemInsert;
  readonly publishedRepository: PublishedItemRepository;
  readonly result: PublishResult;
};

describe("publication public export boundary", () => {
  it("EXPORT_BOUNDARY exposes exactly PublicationError and createPublication at runtime", () => {
    const typeOnlyBoundary: ExportBoundaryTypes | null = null;
    expect(typeOnlyBoundary).toBeNull();
    expect(Object.keys(publicationBoundary).sort()).toEqual([
      "PublicationError",
      "createPublication",
    ]);
    expect(typeof publicationBoundary.PublicationError).toBe("function");
    expect(typeof publicationBoundary.createPublication).toBe("function");
  });

  it("NO_LLM_PRIVACY contains no completion, Prompt, User Context, network, or raw_data path", async () => {
    const directory = new URL("../../src/publication/", import.meta.url);
    const entries = await readdir(directory, { withFileTypes: true });
    const sources = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map(async (entry) => ({
          name: entry.name,
          source: await readFile(new URL(entry.name, directory), "utf8"),
        })),
    );
    const forbiddenTokens = [
      "completionClient",
      "TypedLlmCalls",
      "ChatCompletion",
      "config/prompts",
      "user-context",
      "apiKey",
      "Authorization",
      "fetch(",
      ["raw", "data"].join("_"),
    ];

    for (const { name, source } of sources) {
      for (const token of forbiddenTokens) {
        expect(
          source,
          `${name} contains forbidden token ${token}`,
        ).not.toContain(token);
      }
    }

    const indexSource = sources.find(({ name }) => name === "index.ts")?.source;
    expect(indexSource).toBeDefined();
    expect(indexSource).toContain("export type {");
    expect(indexSource).not.toMatch(
      /Sqlite[A-Za-z]+Repository|renderer-helper|source-helper/,
    );
  });
});
