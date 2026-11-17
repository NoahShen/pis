import type { SourceText } from "./contracts.js";
import {
  cleanParsedHtml,
  collectVisibleText,
  parseHtmlDocument,
  queryElements,
  removeElements,
  type DomDocumentLike,
} from "./dom-boundary.js";

const REMOVED_SELECTORS = [
  "script",
  "style",
  "template",
  "noscript",
  "nav",
  "header",
  "footer",
  "form",
  "aside",
  "iframe",
  "canvas",
  "object",
  "embed",
  "dialog",
] as const;

export function normalizeCleanText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function removeInvisibleAttributes(document: DomDocumentLike): void {
  removeElements(document, "[hidden]");
  for (const element of queryElements(document, "[aria-hidden]")) {
    if (element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true") {
      element.remove();
    }
  }
}

export function removeNonContentNodes(document: DomDocumentLike): void {
  for (const selector of REMOVED_SELECTORS) {
    removeElements(document, selector);
  }
  removeInvisibleAttributes(document);
}

export function cleanTextValue(value: string): string | null {
  const cleaned = normalizeCleanText(value);
  return cleaned.length === 0 ? null : cleaned;
}

export function cleanHtmlValue(value: string): string | null {
  const document = parseHtmlDocument(
    `<html><head></head><body>${value}</body></html>`,
  );
  removeNonContentNodes(document);
  const root = document.body;
  if (root === null) {
    throw new TypeError(
      "The DOM dependency returned a document without a body",
    );
  }
  return cleanTextValue(collectVisibleText(root));
}

export function cleanReadabilityContent(value: string): string | null {
  return cleanParsedHtml(value);
}

export function cleanSourceText(text: SourceText | null): string | null {
  if (text === null) {
    return null;
  }
  return text.format === "TEXT"
    ? cleanTextValue(text.value)
    : cleanHtmlValue(text.value);
}
