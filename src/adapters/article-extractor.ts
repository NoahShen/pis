import {
  extractReadabilityContent,
  parseHtmlDocument,
  queryElements,
  textContent,
  type DomElementLike,
} from "./dom-boundary.js";
import {
  cleanReadabilityContent,
  removeNonContentNodes,
} from "./content-cleaning.js";

export interface ArticleExtraction {
  readonly restricted: boolean;
  readonly text: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function declaresRestrictedJsonLd(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.isAccessibleForFree === false) {
    return true;
  }
  const graph = value["@graph"];
  return (
    Array.isArray(graph) &&
    graph.some((item) => isRecord(item) && item.isAccessibleForFree === false)
  );
}

function parseJsonLd(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function elementHasRestrictedJsonLd(element: DomElementLike): boolean {
  const type = element
    .getAttribute("type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (type !== "application/ld+json") {
    return false;
  }

  const source = textContent(element).trim();
  if (source.length === 0) {
    return false;
  }
  return declaresRestrictedJsonLd(parseJsonLd(source));
}

function hasRestrictedMarkup(
  document: ReturnType<typeof parseHtmlDocument>,
): boolean {
  for (const script of queryElements(document, "script[type]")) {
    if (elementHasRestrictedJsonLd(script)) {
      return true;
    }
  }

  for (const element of queryElements(
    document,
    '[itemprop="isAccessibleForFree"][content]',
  )) {
    if (element.getAttribute("content")?.trim().toLowerCase() === "false") {
      return true;
    }
  }
  return false;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function extractArticle(
  html: string,
  finalUrl: string,
  articleMinTextChars: number,
): ArticleExtraction {
  const document = parseHtmlDocument(html, finalUrl);
  const restricted = hasRestrictedMarkup(document);

  removeNonContentNodes(document);
  const content = extractReadabilityContent(document, articleMinTextChars);
  const fragment = content === null ? null : cleanReadabilityContent(content);
  const accepted =
    fragment !== null &&
    (restricted || codePointLength(fragment) >= articleMinTextChars);

  return { restricted, text: accepted ? fragment : null };
}

export function hasRestrictedContentSignal(html: string): boolean {
  const document = parseHtmlDocument(html);
  return hasRestrictedMarkup(document);
}
