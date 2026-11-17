import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface DomNodeLike {
  readonly nodeType: number;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<DomNodeLike>;
}

export interface DomElementLike extends DomNodeLike {
  readonly localName: string;
  getAttribute(name: string): string | null;
  remove(): void;
}

export interface DomDocumentLike {
  readonly documentElement: DomElementLike | null;
  readonly body: DomElementLike | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): ArrayLike<DomElementLike>;
}

interface ReadabilityResultLike {
  readonly content?: unknown;
}

interface ReadabilityConstructorLike {
  new (
    document: unknown,
    options: Readonly<{ charThreshold: number }>,
  ): { parse(): ReadabilityResultLike | null };
}

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const INVISIBLE_ELEMENTS = new Set([
  "canvas",
  "embed",
  "iframe",
  "noscript",
  "object",
  "script",
  "style",
  "template",
]);

const REMOVED_PARSED_SELECTORS = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeLike(value: unknown): value is DomNodeLike {
  return (
    isRecord(value) &&
    typeof value.nodeType === "number" &&
    (value.textContent === null || typeof value.textContent === "string") &&
    isRecord(value.childNodes) &&
    typeof value.childNodes.length === "number"
  );
}

function isElementLike(value: unknown): value is DomElementLike {
  if (!isNodeLike(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  return (
    typeof record.localName === "string" &&
    typeof record.getAttribute === "function" &&
    typeof record.remove === "function"
  );
}

function isDocumentLike(value: unknown): value is DomDocumentLike {
  return (
    isRecord(value) &&
    (value.documentElement === null || isElementLike(value.documentElement)) &&
    (value.body === null || isElementLike(value.body)) &&
    typeof value.querySelector === "function" &&
    typeof value.querySelectorAll === "function"
  );
}

function childNodesOf(node: DomNodeLike): readonly DomNodeLike[] {
  const children: DomNodeLike[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child: unknown = node.childNodes[index];
    if (!isNodeLike(child)) {
      throw new TypeError("The DOM dependency returned an invalid child node");
    }
    children.push(child);
  }
  return children;
}

export function parseHtmlDocument(html: string, url?: string): DomDocumentLike {
  const parsed: unknown =
    url === undefined
      ? parseHTML(html)
      : parseHTML(html, { location: { href: url } });

  if (!isRecord(parsed) || !isDocumentLike(parsed.document)) {
    throw new TypeError("The DOM dependency returned an invalid document");
  }
  return parsed.document;
}

export function removeElements(
  document: DomDocumentLike,
  selector: string,
): void {
  const matches = document.querySelectorAll(selector);
  for (let index = 0; index < matches.length; index += 1) {
    const match: unknown = matches[index];
    if (!isElementLike(match)) {
      throw new TypeError("The DOM dependency returned an invalid element");
    }
    match.remove();
  }
}

export function queryElements(
  document: DomDocumentLike,
  selector: string,
): readonly DomElementLike[] {
  const matches = document.querySelectorAll(selector);
  const result: DomElementLike[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match: unknown = matches[index];
    if (!isElementLike(match)) {
      throw new TypeError("The DOM dependency returned an invalid element");
    }
    result.push(match);
  }
  return result;
}

export function textContent(node: DomNodeLike): string {
  return node.textContent ?? "";
}

export function collectVisibleText(
  root: DomNodeLike,
  removed: ReadonlySet<DomElementLike> = new Set(),
): string {
  let output = "";

  const appendLineBreak = (): void => {
    if (output.length > 0 && !output.endsWith("\n")) {
      output += "\n";
    }
  };

  const visit = (node: DomNodeLike): void => {
    if (node.nodeType === 3) {
      output += node.textContent ?? "";
      return;
    }
    if (node.nodeType === 8) {
      return;
    }
    if (isElementLike(node)) {
      if (removed.has(node)) {
        return;
      }
      const name = node.localName.toLowerCase();
      if (INVISIBLE_ELEMENTS.has(name)) {
        return;
      }
      if (name === "br") {
        appendLineBreak();
        return;
      }
      if (BLOCK_ELEMENTS.has(name)) {
        appendLineBreak();
      }
      for (const child of childNodesOf(node)) {
        visit(child);
      }
      if (BLOCK_ELEMENTS.has(name)) {
        appendLineBreak();
      }
      return;
    }
    for (const child of childNodesOf(node)) {
      visit(child);
    }
  };

  visit(root);
  return output;
}

export function cleanParsedHtml(content: string): string | null {
  const document = parseHtmlDocument(`<html><body>${content}</body></html>`);
  const removed = new Set<DomElementLike>();
  for (const selector of REMOVED_PARSED_SELECTORS) {
    for (const element of queryElements(document, selector)) {
      removed.add(element);
    }
  }
  for (const element of queryElements(document, "[hidden]")) {
    removed.add(element);
  }
  for (const element of queryElements(document, "[aria-hidden]")) {
    if (element.getAttribute("aria-hidden")?.trim().toLowerCase() === "true") {
      removed.add(element);
    }
  }

  const root = document.body;
  if (root === null) {
    throw new TypeError(
      "The DOM dependency returned a document without a body",
    );
  }
  const lines = collectVisibleText(root, removed)
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  return lines.length === 0 ? null : lines.join("\n");
}

export function extractReadabilityContent(
  document: DomDocumentLike,
  charThreshold: number,
): string | null {
  const ReadabilityClass = Readability as unknown as ReadabilityConstructorLike;
  const parsed = new ReadabilityClass(document, { charThreshold }).parse();
  return isRecord(parsed) && typeof parsed.content === "string"
    ? parsed.content
    : null;
}
