import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { PublicationContext } from "../../src/publication/contracts.js";
import {
  TemplatePublicationRenderer,
  truncateSummary,
} from "../../src/publication/template-renderer.js";
import {
  createPublicationEventContext,
  createPublicationKnowledgeContext,
  createPublicationUpdateContext,
  sortedKeys,
} from "../fixtures/publication.js";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }

  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function renderedBodies(contexts: readonly PublicationContext[]): string[] {
  const renderer = new TemplatePublicationRenderer();
  return contexts.map((context) => renderer.render(context).body);
}

describe("TemplatePublicationRenderer", () => {
  it("PUB-01_EVENT_RENDER uses Event title, truncated description, and all Event fields", () => {
    const context = createPublicationEventContext({}, null);
    const draft = new TemplatePublicationRenderer().render(context);

    expect(draft.title).toBe("Synthetic Event Title");
    expect(draft.summary).toBe("Synthetic Event Description");
    expect(draft.body).toBe(
      [
        "<section>",
        "<h2>Synthetic Event Title</h2>",
        "<p>核心实体：Synthetic Event Entity</p>",
        "<p>主题：Synthetic Event Subject</p>",
        "<p>范围：Synthetic Event Scope</p>",
        "<p>发生时间：时间未确定</p>",
        "<h3>初始事实</h3>",
        "<p>Synthetic Event Description</p>",
        "</section>",
      ].join("\n"),
    );
  });

  it("PUB-01_UPDATE_RENDER uses only the Update plus parent Event background", () => {
    const context = createPublicationUpdateContext({
      update: {
        title: "Synthetic Current Update",
        description: "Synthetic Current Update Description",
      },
      parentEvent: {
        title: "Synthetic Parent Title",
        entityName: "Synthetic Parent Entity",
        subject: "Synthetic Parent Subject",
        scope: "Synthetic Parent Scope",
      },
      occurredAt: "2026-11-20T10:00:00.000+08:00",
    });
    const pollutedContext = {
      ...context,
      parentEvent: {
        ...context.parentEvent,
        description: "PARENT_DESCRIPTION_MUST_NOT_RENDER",
      },
      history: [{ title: "HISTORY_UPDATE_MUST_NOT_RENDER" }],
    } as PublicationContext;

    const draft = new TemplatePublicationRenderer().render(pollutedContext);

    expect(draft.title).toBe("Synthetic Current Update");
    expect(draft.summary).toBe("Synthetic Current Update Description");
    expect(draft.body).toBe(
      [
        "<section>",
        "<h2>Synthetic Current Update</h2>",
        "<p>所属主线：Synthetic Parent Title</p>",
        "<p>核心实体：Synthetic Parent Entity</p>",
        "<p>主题：Synthetic Parent Subject</p>",
        "<p>范围：Synthetic Parent Scope</p>",
        "<p>发生时间：2026-11-20T10:00:00.000+08:00</p>",
        "<h3>本次进展</h3>",
        "<p>Synthetic Current Update Description</p>",
        "</section>",
      ].join("\n"),
    );
    expect(draft.body).not.toContain("PARENT_DESCRIPTION_MUST_NOT_RENDER");
    expect(draft.body).not.toContain("HISTORY_UPDATE_MUST_NOT_RENDER");
    expect(draft.body).not.toContain("Synthetic Event Description");
  });

  it("PUB-01_KNOWLEDGE_RENDER renders category, summary, value, findings, and null fallback", () => {
    const renderer = new TemplatePublicationRenderer();
    const categorized = renderer.render(createPublicationKnowledgeContext());

    expect(categorized.title).toBe("Synthetic Knowledge Title");
    expect(categorized.summary).toBe("Synthetic Knowledge Summary");
    expect(categorized.body).toBe(
      [
        "<section>",
        "<h2>Synthetic Knowledge Title</h2>",
        "<p>分类：Insight</p>",
        "<p>摘要：Synthetic Knowledge Summary</p>",
        "<p>价值：Synthetic Knowledge Value</p>",
        "<h3>Findings</h3>",
        "<ul>",
        "<li>Synthetic Finding One：Synthetic finding one description</li>",
        "<li>Synthetic Finding Two：Synthetic finding two description</li>",
        "</ul>",
        "</section>",
      ].join("\n"),
    );

    const uncategorized = renderer.render(
      createPublicationKnowledgeContext({
        knowledge: { category: null },
      }),
    );
    expect(uncategorized.body).toContain("<p>分类：未分类</p>");
  });

  it("PUB-10_SUMMARY_BOUND preserves short text and bounds long text on UTF-16 boundaries", () => {
    expect(truncateSummary("short summary")).toBe("short summary");
    expect(truncateSummary("中".repeat(240))).toBe("中".repeat(240));

    const chinese = truncateSummary("中".repeat(241));
    expect(chinese.length).toBe(240);
    expect(chinese.endsWith("…")).toBe(true);
    expect(chinese).toBe(`${"中".repeat(239)}…`);

    const surrogateInput = `${"a".repeat(238)}😀tail`;
    const surrogate = truncateSummary(surrogateInput, 240);
    expect(surrogate).toBe(`${"a".repeat(238)}…`);
    expect(surrogate.length).toBeLessThanOrEqual(240);
    expect(hasUnpairedSurrogate(surrogate)).toBe(false);

    const mixed = "中文😀𠀀".repeat(100);
    const mixedResult = truncateSummary(mixed, 240);
    expect(mixedResult.length).toBeLessThanOrEqual(240);
    expect(mixedResult.endsWith("…")).toBe(true);
    expect(hasUnpairedSurrogate(mixedResult)).toBe(false);
    expect(truncateSummary("abc", 1)).toBe("…");
    expect(truncateSummary("abc", 0)).toBe("");
  });

  it("TAGS_ALLOWLIST emits only section/h2/h3/p/ul/li without attributes", () => {
    const bodies = renderedBodies([
      createPublicationEventContext(),
      createPublicationUpdateContext(),
      createPublicationKnowledgeContext(),
      createPublicationKnowledgeContext({ findings: [] }),
    ]);
    const allowedTags = new Set(["section", "h2", "h3", "p", "ul", "li"]);

    for (const body of bodies) {
      const tags = [...body.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)];
      for (const match of tags) {
        expect(allowedTags.has(match[1]!.toLowerCase())).toBe(true);
        expect(match[0]).toMatch(/^<\/?(?:section|h2|h3|p|ul|li)>$/);
      }
      expect(body).not.toMatch(/<a\b/i);
    }
  });

  it("DTO_KEYS exposes exactly the approved nested fields without private data", () => {
    const eventContext = createPublicationEventContext();
    const updateContext = createPublicationUpdateContext();
    const knowledgeContext = createPublicationKnowledgeContext();
    const finding = knowledgeContext.knowledge.findings[0]!;

    expect(sortedKeys(eventContext)).toEqual(
      ["event", "occurredAt", "targetType"].sort(),
    );
    expect(sortedKeys(eventContext.event)).toEqual(
      ["description", "entityName", "id", "scope", "subject", "title"].sort(),
    );
    expect(sortedKeys(updateContext)).toEqual(
      ["occurredAt", "parentEvent", "targetType", "update"].sort(),
    );
    expect(sortedKeys(updateContext.update)).toEqual(
      ["description", "eventId", "id", "title"].sort(),
    );
    expect(sortedKeys(updateContext.parentEvent)).toEqual(
      ["entityName", "id", "scope", "subject", "title"].sort(),
    );
    expect(updateContext.parentEvent).not.toHaveProperty("description");
    expect(sortedKeys(knowledgeContext)).toEqual(
      ["knowledge", "targetType"].sort(),
    );
    expect(sortedKeys(knowledgeContext.knowledge)).toEqual(
      ["category", "findings", "id", "summary", "title", "value"].sort(),
    );
    expect(sortedKeys(finding)).toEqual(["description", "title"].sort());

    const serialized = JSON.stringify([
      eventContext,
      updateContext,
      knowledgeContext,
    ]);
    for (const forbidden of [
      ["raw", "data"].join("_"),
      ["user", "Context"].join(""),
      "updates",
      "history",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("PURE_RENDER is deterministic, non-mutating, and source has no side effects", async () => {
    const renderer = new TemplatePublicationRenderer();
    const clockNow = vi.fn();
    const nextId = vi.fn();
    const contexts = [
      deepFreeze(createPublicationEventContext()),
      deepFreeze(createPublicationUpdateContext()),
      deepFreeze(createPublicationKnowledgeContext()),
    ];

    expect(renderer.constructor.length).toBe(0);
    for (const context of contexts) {
      const before = JSON.stringify(context);
      const first = renderer.render(context);
      const second = renderer.render(context);
      expect(first).toEqual(second);
      expect(JSON.stringify(context)).toBe(before);
    }
    expect(clockNow).not.toHaveBeenCalled();
    expect(nextId).not.toHaveBeenCalled();

    const sourceFiles = [
      "../../src/publication/contracts.ts",
      "../../src/publication/html.ts",
      "../../src/publication/template-renderer.ts",
    ];
    const forbiddenSourceTokens = [
      ["fetch", "("].join(""),
      ["new ", "Database"].join(""),
      ["with", "Transaction"].join(""),
      ["completion", "Client"].join(""),
      ["Typed", "LlmCalls"].join(""),
      ["config/", "prompts"].join(""),
      ["user-", "context"].join(""),
      ["raw", "_data"].join(""),
      ["Date", ".now"].join(""),
      ["Math", ".random"].join(""),
      ["random", "UUID"].join(""),
      ["node:", "fs"].join(""),
      ["node:", "http"].join(""),
    ];

    for (const relativePath of sourceFiles) {
      const source = await readFile(
        new URL(relativePath, import.meta.url),
        "utf8",
      );
      for (const token of forbiddenSourceTokens) {
        expect(source).not.toContain(token);
      }
    }
  });

  it("EMPTY_FIELD_VALUES renders blank content safely without throwing", () => {
    const renderer = new TemplatePublicationRenderer();
    const emptyEvent = renderer.render(
      createPublicationEventContext(
        {
          id: "",
          title: "",
          entityName: "",
          subject: "",
          scope: "",
          description: "",
        },
        "   ",
      ),
    );
    const emptyUpdate = renderer.render(
      createPublicationUpdateContext({
        update: { id: "", eventId: "", title: "", description: "" },
        parentEvent: {
          id: "",
          title: "",
          entityName: "",
          subject: "",
          scope: "",
        },
        occurredAt: "",
      }),
    );
    const emptyKnowledge = renderer.render(
      createPublicationKnowledgeContext({
        knowledge: { title: "", summary: "", category: null, value: "" },
        findings: [],
      }),
    );

    for (const draft of [emptyEvent, emptyUpdate, emptyKnowledge]) {
      expect(typeof draft.title).toBe("string");
      expect(typeof draft.summary).toBe("string");
      expect(typeof draft.body).toBe("string");
    }
    expect(emptyEvent.body).toContain("<p>核心实体：</p>");
    expect(emptyEvent.body).toContain("<p>发生时间：时间未确定</p>");
    expect(emptyUpdate.body).toContain("<p>发生时间：时间未确定</p>");
    expect(emptyKnowledge.body).toContain("<p>分类：未分类</p>");
    expect(emptyKnowledge.body).toContain("<p>暂无 Findings</p>");
  });
});
