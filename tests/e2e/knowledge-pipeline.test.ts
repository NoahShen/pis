import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  countRows,
  withKnowledgeE2eHarness,
} from "../fixtures/e2e-pipeline.js";

const MULTI_FINDING_KNOWLEDGE = {
  valuable: true,
  title: "E2E deterministic Knowledge",
  summary: "A fixed Knowledge summary for the complete production pipeline.",
  category: "Method",
  findings: [
    { title: "First finding", description: "The first persisted finding." },
    { title: "Second finding", description: "The second persisted finding." },
  ],
  value: "Both findings must reach the Curated feed.",
} as const;

describe("D16 Knowledge production E2E", () => {
  it("E2E-04 publishes multi-finding Knowledge through Curated RSS and the full-file publisher", async () => {
    await withKnowledgeE2eHarness(
      { name: "e2e04", knowledge: MULTI_FINDING_KNOWLEDGE },
      async (harness) => {
        await harness.run();
        const db = harness.assembly.database;
        const knowledge = db
          .prepare(
            "SELECT id, content_id, category, findings_json FROM knowledge",
          )
          .get() as {
          id: string;
          content_id: string;
          category: string;
          findings_json: string;
        };
        const published = db
          .prepare("SELECT id, target_id, body FROM published_items")
          .get() as { id: string; target_id: string; body: string };
        expect(JSON.parse(knowledge.findings_json)).toHaveLength(2);
        expect(knowledge).toMatchObject({
          id: "e2e04-knowledge",
          content_id: "e2e04-content",
          category: "Method",
        });
        expect(published).toMatchObject({
          id: "e2e04-published-item",
          target_id: knowledge.id,
        });
        expect(published.body).toContain("First finding");
        expect(published.body).toContain("Second finding");
        expect(countRows(db, "topic_associations")).toBe(1);
        expect(countRows(db, "published_items")).toBe(1);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "knowledge-analysis",
          "topic-matching",
        ]);

        expect(harness.publisher.versions).toHaveLength(3);
        const initialVersions = harness.publisher.versions.slice(0, 2);
        for (const version of initialVersions) {
          expect(Object.keys(version.files).sort()).toEqual([
            ".nojekyll",
            version.feed === "CURATED_CONTENT"
              ? "curated-content-pending.xml"
              : "event-updates-pending.xml",
            version.feed === "CURATED_CONTENT"
              ? "curated-content.xml"
              : "event-updates.xml",
          ]);
        }
        const curated = harness.publisher.versions.at(-1)!;
        expect(curated.feed).toBe("CURATED_CONTENT");
        expect(Object.keys(curated.files).sort()).toEqual([
          ".nojekyll",
          "curated-content-pending.xml",
          "curated-content.xml",
        ]);
        const xml = new TextDecoder().decode(
          curated.files["curated-content.xml"],
        );
        expect(xml).toContain("E2E deterministic Knowledge");
        expect(xml).toContain("First finding");
        expect(xml).toContain("Second finding");
        expect(xml).toContain("pis:published:e2e04-published-item");
        expect(xml.match(/<item>/g)).toHaveLength(1);
        const pending = new TextDecoder().decode(
          curated.files["curated-content-pending.xml"],
        );
        expect(pending).toContain("<fh:archive/>");
        expect(pending).toContain("pis:published:e2e04-published-item");
        const storeXml = await readFile(
          path.join(
            path.dirname(harness.databasePath),
            "e2e04-rss",
            "staging",
            "curated-content.xml",
          ),
          "utf8",
        );
        expect(storeXml).toBe(xml);
      },
    );
  });

  it("E2E-05 retains Content but stops all downstream work for valuable=false", async () => {
    await withKnowledgeE2eHarness(
      { name: "e2e05", knowledge: { valuable: false } },
      async (harness) => {
        await harness.run();
        const db = harness.assembly.database;
        expect(countRows(db, "source_items")).toBe(1);
        expect(countRows(db, "contents")).toBe(1);
        expect(countRows(db, "knowledge")).toBe(0);
        expect(countRows(db, "topic_associations")).toBe(0);
        expect(countRows(db, "published_items")).toBe(0);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "knowledge-analysis",
        ]);
        expect(harness.runtimeTrace).toEqual([
          { type: "COLLECT", source_id: "e2e05-source" },
          { type: "PROCESS", source_item_id: "e2e05-source-item" },
          { type: "KNOWLEDGE_ANALYSIS", content_id: "e2e05-content" },
        ]);
        expect(harness.publisher.versions).toHaveLength(2);
        expect(harness.publisher.versions.map(({ feed }) => feed)).toEqual([
          "EVENT_UPDATES",
          "CURATED_CONTENT",
        ]);
      },
    );
  });

  it("E2E-07 retains valid Knowledge for a disabled Topic without matching or publishing", async () => {
    await withKnowledgeE2eHarness(
      {
        name: "e2e07-disabled",
        knowledge: MULTI_FINDING_KNOWLEDGE,
        disabledTopic: true,
      },
      async (harness) => {
        await harness.run();
        const db = harness.assembly.database;
        expect(countRows(db, "knowledge")).toBe(1);
        expect(countRows(db, "topic_associations")).toBe(0);
        expect(countRows(db, "published_items")).toBe(0);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "knowledge-analysis",
        ]);
        expect(harness.publisher.versions).toHaveLength(2);
        expect(harness.runtimeTrace).toEqual([
          { type: "COLLECT", source_id: "e2e07-disabled-source" },
          { type: "PROCESS", source_item_id: "e2e07-disabled-source-item" },
          { type: "KNOWLEDGE_ANALYSIS", content_id: "e2e07-disabled-content" },
          {
            type: "TOPIC_MATCHING",
            target_type: "KNOWLEDGE",
            target_id: "e2e07-disabled-knowledge",
          },
        ]);
      },
    );
  });

  it("E2E-07 retains valid Knowledge for an enabled Topic with a legitimate empty match", async () => {
    await withKnowledgeE2eHarness(
      {
        name: "e2e07-empty",
        knowledge: MULTI_FINDING_KNOWLEDGE,
        matchTopics: false,
      },
      async (harness) => {
        await harness.run();
        const db = harness.assembly.database;
        expect(countRows(db, "knowledge")).toBe(1);
        expect(countRows(db, "topic_associations")).toBe(0);
        expect(countRows(db, "published_items")).toBe(0);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "knowledge-analysis",
          "topic-matching",
        ]);
        expect(harness.publisher.versions).toHaveLength(2);
      },
    );
  });

  it("E2E-07 retains valid Knowledge when no enabled Topic exists", async () => {
    await withKnowledgeE2eHarness(
      {
        name: "e2e07-none",
        knowledge: MULTI_FINDING_KNOWLEDGE,
        noEnabledTopic: true,
      },
      async (harness) => {
        await harness.run();
        expect(countRows(harness.assembly.database, "knowledge")).toBe(1);
        expect(countRows(harness.assembly.database, "topic_associations")).toBe(
          0,
        );
        expect(countRows(harness.assembly.database, "published_items")).toBe(0);
        expect(harness.publisher.versions).toHaveLength(2);
      },
    );
  });

  it("E2E-11 commits PARTIAL Content before P-01 fails, retries with the same Content, and publishes once", async () => {
    const routeFailure = Object.assign(new Error("synthetic P-01 outage"), {
      code: "LLM_REQUEST_FAILED",
    });
    await withKnowledgeE2eHarness(
      {
        name: "e2e11",
        knowledge: MULTI_FINDING_KNOWLEDGE,
        articleFailure: true,
        routeFailure,
      },
      async (harness) => {
        await harness.run();
        const db = harness.assembly.database;
        const content = db
          .prepare("SELECT id, body, summary, completeness FROM contents")
          .get() as {
          id: string;
          body: string;
          summary: string;
          completeness: string;
        };
        expect(content).toMatchObject({
          id: "e2e11-content",
          completeness: "PARTIAL",
          summary: "Synthetic local fixture summary.",
          body: "Synthetic local fixture summary.",
        });
        expect(harness.llm.routeAttempts).toBe(2);
        expect(
          harness.llm.operations.filter(
            (operation) => operation === "processing-route",
          ),
        ).toHaveLength(2);
        expect(countRows(db, "source_items")).toBe(1);
        expect(countRows(db, "contents")).toBe(1);
        expect(countRows(db, "knowledge")).toBe(1);
        expect(countRows(db, "topic_associations")).toBe(1);
        expect(countRows(db, "published_items")).toBe(1);
        expect(
          harness.runtimeTrace.filter(({ type }) => type === "PROCESS"),
        ).toEqual([
          { type: "PROCESS", source_item_id: "e2e11-source-item" },
          { type: "PROCESS", source_item_id: "e2e11-source-item" },
        ]);
        expect(
          harness.runtimeTrace.filter(
            ({ type }) => type === "KNOWLEDGE_ANALYSIS",
          ),
        ).toHaveLength(1);
        expect(
          harness.runtimeTrace.filter(({ type }) => type === "TOPIC_MATCHING"),
        ).toHaveLength(1);
        expect(
          harness.runtimeTrace.filter(({ type }) => type === "PUBLISH"),
        ).toHaveLength(1);
        expect(harness.publisher.versions).toHaveLength(3);
        const curated = harness.publisher.versions.at(-1)!;
        const xml = new TextDecoder().decode(
          curated.files["curated-content.xml"],
        );
        expect(xml.match(/<item>/g)).toHaveLength(1);
        expect(xml).toContain("pis:published:e2e11-published-item");
        expect(harness.http.requests).toEqual([
          "/production-integration-feed",
          "/production-integration-article",
        ]);
      },
    );
  });
});
