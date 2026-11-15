import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const databaseDesignPath = new URL(
  "../../docs/PIS_数据库设计_v1.0.md",
  import.meta.url,
);
const schemaPath = new URL("../../src/database/schema.sql", import.meta.url);

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function extractSqlBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map(
    (match) => match[1],
  );
}

describe("frozen database schema", () => {
  it("bundled schema exactly matches the frozen database design SQL block", () => {
    const design = readFileSync(databaseDesignPath, "utf8");
    const blocks = extractSqlBlocks(design);
    const bundledSchema = readFileSync(schemaPath, "utf8");

    expect(blocks).toHaveLength(1);
    expect(normalizeNewlines(bundledSchema)).toBe(normalizeNewlines(blocks[0]));
  });
});
