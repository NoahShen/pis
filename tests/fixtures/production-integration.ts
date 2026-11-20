import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdapterCallOptions,
  AdapterSource,
  SourceAdapter,
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import { createRestrictedRssTransport } from "../../src/adapters/http/restricted-client.js";
import { DEFAULT_ADAPTER_POLICY } from "../../src/adapters/options.js";
import { createRssAdapter } from "../../src/adapters/rss-adapter.js";
import type {
  TextCompletionClient,
  TextCompletionRequest,
} from "../../src/llm/chat-completions-client.js";
import { HttpFixture } from "./http-fixture.js";
import { articleHtml } from "./rss-content.js";
import { rssFeed } from "./rss-list.js";

export type ProductionLlmOperation =
  "processing-route" | "knowledge-analysis" | "topic-matching";

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUserContent(value: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Production integration LLM user content was not JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "Production integration LLM user content was not an object",
    );
  }
  return parsed;
}

function classifyOperation(
  request: TextCompletionRequest,
): ProductionLlmOperation {
  const user = parseUserContent(request.userContent);
  if (Object.prototype.hasOwnProperty.call(user, "user_context")) {
    return "knowledge-analysis";
  }

  const taskData = user.task_data;
  if (
    isRecord(taskData) &&
    isRecord(taskData.target) &&
    taskData.target.target_type === "KNOWLEDGE"
  ) {
    return "topic-matching";
  }

  return "processing-route";
}

export class ProductionIntegrationLlmStub implements TextCompletionClient {
  readonly operations: ProductionLlmOperation[] = [];

  constructor(
    private readonly topicId: () => string,
    private readonly onCall?: (operation: ProductionLlmOperation) => void,
  ) {}

  async complete(request: TextCompletionRequest): Promise<string> {
    const operation = classifyOperation(request);
    this.operations.push(operation);
    this.onCall?.(operation);

    switch (operation) {
      case "processing-route":
        return JSON.stringify({ routes: ["KNOWLEDGE"] });
      case "knowledge-analysis":
        return JSON.stringify({
          valuable: true,
          title: "Production integration Knowledge",
          summary:
            "A deterministic Knowledge result from the production chain.",
          category: "Method",
          findings: [
            {
              title: "Integrated finding",
              description: "The production Runtime completed each stage.",
            },
          ],
          value: "Proves the assembled services persist a publishable result.",
        });
      case "topic-matching":
        return JSON.stringify({ matched_topic_ids: [this.topicId()] });
    }
  }
}

export async function writeProductionIntegrationPrompts(
  directory: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, "processing-route.md"),
      "Synthetic production integration routing instructions.\n",
      "utf8",
    ),
    writeFile(
      path.join(directory, "knowledge-analysis.md"),
      "Synthetic production integration Knowledge instructions.\n",
      "utf8",
    ),
    writeFile(
      path.join(directory, "topic-matching.md"),
      "Synthetic production integration Topic instructions.\n",
      "utf8",
    ),
    writeFile(
      path.join(directory, "user-context.md"),
      "Synthetic test-only context; no private User Context is read.\n",
      "utf8",
    ),
  ]);
  return directory;
}

export function configureProductionIntegrationRss(
  fixture: HttpFixture,
): string {
  const feedPath = "/production-integration-feed";
  const articlePath = "/production-integration-article";
  const articleUrl = `${fixture.origin}${articlePath}`;

  fixture
    .route(feedPath, ({ response }) => {
      response.setHeader("content-type", "application/rss+xml; charset=utf-8");
      response.end(
        rssFeed(`
          <item>
            <guid>production-integration-entry</guid>
            <title>Production integration article</title>
            <link>${articleUrl}</link>
            <description>Synthetic local fixture summary.</description>
          </item>
        `),
      );
    })
    .route(articlePath, ({ response }) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(articleHtml());
    });

  return `${fixture.origin}${feedPath}`;
}

export function createProductionIntegrationSourceAdapter({
  fixture,
  signal,
  onCollect,
}: {
  readonly fixture: HttpFixture;
  readonly signal: AbortSignal;
  readonly onCollect: () => void;
}): SourceAdapter {
  const transport = createRestrictedRssTransport({
    signal,
    policy: DEFAULT_ADAPTER_POLICY,
    resolver: fixture.resolver,
    connector: fixture.connector,
  });
  const adapter = createRssAdapter({ transport });

  return {
    fetchEntries(
      source: AdapterSource,
      lastCollectedAt: string | null,
      options?: AdapterCallOptions,
    ): Promise<SourceEntry[]> {
      onCollect();
      return adapter.fetchEntries(source, lastCollectedAt, options);
    },
    fetchContent(
      entry: SourceEntry,
      options?: AdapterCallOptions,
    ): Promise<SourceContent> {
      return adapter.fetchContent(entry, options);
    },
  };
}
