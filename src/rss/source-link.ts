import { parseHTML } from "linkedom";

import { normalizeHttpUrl } from "../publication/source-links.js";

interface SourceSectionLike {
  readonly children: ArrayLike<{
    readonly localName?: string;
    readonly tagName?: string;
    readonly textContent?: string | null;
  }>;
  querySelectorAll(selector: string): ArrayLike<{
    getAttribute(name: string): string | null;
  }>;
}

function isSourceHeading(
  element: SourceSectionLike["children"][number],
): boolean {
  const name = (element.localName ?? element.tagName ?? "").toLowerCase();
  return name === "h2" && element.textContent?.trim() === "来源";
}

export function extractPublishedItemSourceLink(body: string): string | null {
  if (typeof body !== "string") {
    return null;
  }

  const { document } = parseHTML(`<html><body>${body}</body></html>`);
  for (const section of document.querySelectorAll("section")) {
    const sourceSection = section as unknown as SourceSectionLike;
    let hasSourceHeading = false;
    for (let index = 0; index < sourceSection.children.length; index += 1) {
      const child = sourceSection.children[index];
      if (child !== undefined && isSourceHeading(child)) {
        hasSourceHeading = true;
        break;
      }
    }
    if (!hasSourceHeading) {
      continue;
    }

    const anchors = sourceSection.querySelectorAll("a");
    for (let index = 0; index < anchors.length; index += 1) {
      const href = anchors[index]?.getAttribute("href");
      const normalized = normalizeHttpUrl(href);
      if (normalized !== null) {
        return normalized;
      }
    }
  }

  return null;
}
