import type { PublishedItem } from "../publication/contracts.js";
import type { RssFeedDefinition, RssFeedKind } from "./contracts.js";
import {
  RSS_ARCHIVE_BATCH_SIZE,
  RSS_HEAD_LIMIT,
  RssError,
} from "./contracts.js";
import { getRssFeed, parseRssPublishedAt } from "./feed.js";
import { extractPublishedItemSourceLink } from "./source-link.js";

export type RssDocumentType = "head" | "pending" | "archive";

export interface RssRenderDocumentInput {
  readonly feed: RssFeedDefinition;
  readonly items: readonly PublishedItem[];
  readonly documentHref: string;
  readonly previousArchiveHref: string | null;
}

export interface RssDocumentRenderInput extends RssRenderDocumentInput {
  readonly documentType: RssDocumentType;
}

const CONTENT_NAMESPACE = "http://purl.org/rss/1.0/modules/content/";
const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const FEED_HISTORY_NAMESPACE = "http://purl.org/syndication/history/1.0";
const EVENT_TARGET_TYPES = new Set(["EVENT", "EVENT_UPDATE"]);

function isPublishedItemTargetType(value: unknown): boolean {
  return value === "EVENT" || value === "EVENT_UPDATE" || value === "KNOWLEDGE";
}

function containsOnlyXmlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d &&
      (codePoint < 0x20 ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        codePoint === 0xfffe ||
        codePoint === 0xffff)
    ) {
      return false;
    }
  }
  return true;
}

function assertXmlCharacters(value: string): void {
  if (!containsOnlyXmlCharacters(value)) {
    throw new RssError("invalid_xml_character");
  }
}

function validateItemShape(value: unknown): asserts value is PublishedItem {
  if (typeof value !== "object" || value === null) {
    throw new RssError("invalid_input");
  }

  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    !isPublishedItemTargetType(item.target_type) ||
    typeof item.target_id !== "string" ||
    item.target_id.length === 0 ||
    typeof item.title !== "string" ||
    typeof item.summary !== "string" ||
    typeof item.body !== "string" ||
    typeof item.published_at !== "string"
  ) {
    throw new RssError("invalid_input");
  }

  for (const field of [
    item.id,
    item.target_id,
    item.title,
    item.summary,
    item.body,
    item.published_at,
  ]) {
    assertXmlCharacters(field);
  }
}

function formatRfc822(value: string): string {
  return new Date(parseRssPublishedAt(value)).toUTCString();
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function canonicalFeed(feed: RssFeedDefinition): RssFeedDefinition {
  const canonical = getRssFeed(feed.kind);
  if (
    feed.publicationFeed !== canonical.publicationFeed ||
    feed.title !== canonical.title ||
    feed.description !== canonical.description ||
    feed.headKey !== canonical.headKey ||
    feed.pendingKey !== canonical.pendingKey ||
    feed.archiveFilePrefix !== canonical.archiveFilePrefix
  ) {
    throw new RssError("invalid_input");
  }
  return canonical;
}

function archiveHrefPattern(feed: RssFeedDefinition): RegExp {
  return new RegExp(`^archive/${feed.archiveFilePrefix}-(\\d{4})\\.xml$`, "u");
}

function parseArchiveHref(
  feed: RssFeedDefinition,
  href: string,
): number | null {
  const match = archiveHrefPattern(feed).exec(href);
  if (match === null) {
    return null;
  }
  const sequence = Number(match[1]);
  return sequence >= 1 ? sequence : null;
}

function assertDocumentHref(
  feed: RssFeedDefinition,
  documentType: RssDocumentType,
  href: string,
): number | null {
  if (documentType === "head") {
    if (href !== feed.headKey) {
      throw new RssError("invalid_input");
    }
    return null;
  }
  if (documentType === "pending") {
    if (href !== feed.pendingKey) {
      throw new RssError("invalid_pending");
    }
    return null;
  }

  const sequence = parseArchiveHref(feed, href);
  if (sequence === null) {
    throw new RssError("invalid_archive");
  }
  return sequence;
}

function assertPreviousArchiveHref(
  feed: RssFeedDefinition,
  documentType: RssDocumentType,
  currentArchiveSequence: number | null,
  previousArchiveHref: string | null,
): void {
  if (documentType === "head") {
    if (previousArchiveHref !== feed.pendingKey) {
      throw new RssError("invalid_archive");
    }
    return;
  }

  if (previousArchiveHref === null) {
    if (
      documentType === "archive" &&
      (currentArchiveSequence === null || currentArchiveSequence !== 1)
    ) {
      throw new RssError("invalid_archive");
    }
    return;
  }

  const previousSequence = parseArchiveHref(feed, previousArchiveHref);
  if (previousSequence === null) {
    const code =
      documentType === "pending" ? "invalid_pending" : "invalid_archive";
    throw new RssError(code);
  }
  if (
    documentType === "archive" &&
    (currentArchiveSequence === null ||
      previousSequence !== currentArchiveSequence - 1)
  ) {
    throw new RssError("invalid_archive");
  }
}

function assertFeedMembership(item: PublishedItem, feed: RssFeedKind): void {
  const valid =
    feed === "EVENT_UPDATES"
      ? EVENT_TARGET_TYPES.has(item.target_type)
      : item.target_type === "KNOWLEDGE";
  if (!valid) {
    throw new RssError("invalid_input");
  }
}

function assertDocumentItems(
  items: readonly PublishedItem[],
  feed: RssFeedKind,
  documentType: RssDocumentType,
): void {
  if (!Array.isArray(items)) {
    throw new RssError("invalid_input");
  }

  const limit =
    documentType === "pending"
      ? RSS_ARCHIVE_BATCH_SIZE - 1
      : documentType === "head"
        ? RSS_HEAD_LIMIT
        : RSS_ARCHIVE_BATCH_SIZE;
  if (
    items.length > limit ||
    (documentType === "archive" && items.length === 0)
  ) {
    const code =
      documentType === "pending"
        ? "invalid_pending"
        : documentType === "archive"
          ? "invalid_archive"
          : "invalid_input";
    throw new RssError(code);
  }

  const seenIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    validateItemShape(item);
    assertFeedMembership(item, feed);
    const itemTime = parseRssPublishedAt(item.published_at);
    if (seenIds.has(item.id)) {
      throw new RssError("invalid_input");
    }
    seenIds.add(item.id);

    if (index === 0) {
      continue;
    }
    const previous = items[index - 1]!;
    const previousTime = parseRssPublishedAt(previous.published_at);
    const outOfOrder =
      documentType === "head"
        ? previousTime < itemTime ||
          (previousTime === itemTime && previous.id < item.id)
        : previousTime > itemTime ||
          (previousTime === itemTime && previous.id > item.id);
    if (outOfOrder) {
      throw new RssError("invalid_input");
    }
  }
}

function renderItem(item: PublishedItem): string {
  const sourceLink = extractPublishedItemSourceLink(item.body);
  const link =
    sourceLink === null ? "" : `<link>${escapeXmlText(sourceLink)}</link>`;

  return [
    "<item>",
    `<title>${escapeXmlText(item.title)}</title>`,
    link,
    `<description>${escapeXmlText(item.summary)}</description>`,
    `<content:encoded>${cdata(item.body)}</content:encoded>`,
    `<guid isPermaLink="false">${escapeXmlText(`pis:published:${item.id}`)}</guid>`,
    `<pubDate>${formatRfc822(item.published_at)}</pubDate>`,
    "</item>",
  ].join("");
}

export function renderRssDocument(input: RssDocumentRenderInput): Uint8Array {
  const feed = canonicalFeed(input.feed);
  if (
    input.documentType !== "head" &&
    input.documentType !== "pending" &&
    input.documentType !== "archive"
  ) {
    throw new RssError("invalid_input");
  }

  assertXmlCharacters(input.documentHref);
  if (input.previousArchiveHref !== null) {
    assertXmlCharacters(input.previousArchiveHref);
  }
  const currentArchiveSequence = assertDocumentHref(
    feed,
    input.documentType,
    input.documentHref,
  );
  assertPreviousArchiveHref(
    feed,
    input.documentType,
    currentArchiveSequence,
    input.previousArchiveHref,
  );
  assertDocumentItems(input.items, feed.kind, input.documentType);

  const previousLink =
    input.previousArchiveHref === null
      ? ""
      : `<atom:link rel="prev-archive" href="${escapeXmlAttribute(input.previousArchiveHref)}"/>`;
  const archiveMarker = input.documentType === "head" ? "" : "<fh:archive/>";
  const items = input.items.map(renderItem).join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:content="${CONTENT_NAMESPACE}" xmlns:atom="${ATOM_NAMESPACE}" xmlns:fh="${FEED_HISTORY_NAMESPACE}">` +
    "<channel>" +
    `<title>${escapeXmlText(feed.title)}</title>` +
    `<link>${escapeXmlText(input.documentHref)}</link>` +
    `<description>${escapeXmlText(feed.description)}</description>` +
    previousLink +
    archiveMarker +
    items +
    "</channel></rss>";

  return new TextEncoder().encode(xml);
}

export function renderRssHead(input: RssRenderDocumentInput): Uint8Array {
  return renderRssDocument({ ...input, documentType: "head" });
}

export function renderRssPending(input: RssRenderDocumentInput): Uint8Array {
  return renderRssDocument({ ...input, documentType: "pending" });
}

export function renderRssArchive(input: RssRenderDocumentInput): Uint8Array {
  return renderRssDocument({ ...input, documentType: "archive" });
}
