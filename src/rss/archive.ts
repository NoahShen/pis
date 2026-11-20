import { XMLParser, XMLValidator } from "fast-xml-parser";

import type {
  RssArtifactStore,
  RssFeedDefinition,
  RssFeedKind,
} from "./contracts.js";
import { RSS_ARCHIVE_BATCH_SIZE, RssError } from "./contracts.js";
import { getRssFeed } from "./feed.js";

const CONTENT_NAMESPACE = "http://purl.org/rss/1.0/modules/content/";
const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const FEED_HISTORY_NAMESPACE = "http://purl.org/syndication/history/1.0";
const PUBLISHED_GUID_PREFIX = "pis:published:";
const ARCHIVE_PREFIX = "archive/";
const MAX_ARCHIVE_SEQUENCE = 9_999;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: false,
  maxNestedTags: 100,
});

export type RssArchiveDocumentType = "head" | "pending" | "archive";

export interface RssArchiveItem {
  readonly id: string;
  readonly guid: string;
  readonly title: string;
  readonly link: string | null;
  readonly summary: string;
  readonly body: string;
  readonly pubDate: string;
}

export interface RssArchiveDocument {
  readonly feed: RssFeedKind;
  readonly documentType: RssArchiveDocumentType;
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly previousArchiveKey: string | null;
  readonly items: readonly RssArchiveItem[];
}

export interface RssArchiveParseOptions {
  readonly batchSize?: number;
  /** Undefined validates syntax only; null requires no previous archive. */
  readonly latestArchiveKey?: string | null;
}

export interface DiscoveredRssArchive {
  readonly feed: RssFeedKind;
  readonly sequence: number;
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly document: RssArchiveDocument;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function hasOnlyKeys(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function singleValue(record: UnknownRecord, key: string): unknown {
  const value = record[key];
  if (Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function requiredText(record: UnknownRecord, key: string): string {
  const value = singleValue(record, key);
  if (typeof value === "string") {
    return value;
  }
  if (
    isRecord(value) &&
    hasOnlyKeys(value, new Set(["#text"])) &&
    typeof value["#text"] === "string"
  ) {
    return value["#text"];
  }
  throw new Error("Invalid RSS text element");
}

function optionalText(record: UnknownRecord, key: string): string | null {
  if (!(key in record)) {
    return null;
  }
  return requiredText(record, key);
}

function documentErrorCode(
  documentType: RssArchiveDocumentType,
): "invalid_archive" | "invalid_pending" {
  return documentType === "pending" ? "invalid_pending" : "invalid_archive";
}

function parseDocumentError<T>(
  documentType: RssArchiveDocumentType,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RssError) {
      throw error;
    }
    throw new RssError(documentErrorCode(documentType));
  }
}

export function validateRssBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > RSS_ARCHIVE_BATCH_SIZE) {
    throw new RssError("invalid_input");
  }
  return value;
}

export function buildRssArchiveKey(
  feed: RssFeedDefinition,
  sequence: number,
): string {
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_ARCHIVE_SEQUENCE
  ) {
    throw new RssError("invalid_archive");
  }
  return `${ARCHIVE_PREFIX}${feed.archiveFilePrefix}-${String(sequence).padStart(4, "0")}.xml`;
}

export function parseRssArchiveKey(
  feed: RssFeedDefinition,
  key: string,
): number {
  const match = new RegExp(
    `^${ARCHIVE_PREFIX}${feed.archiveFilePrefix}-(\\d{4})\\.xml$`,
    "u",
  ).exec(key);
  if (match === null) {
    throw new RssError("invalid_archive");
  }
  const sequence = Number(match[1]);
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_ARCHIVE_SEQUENCE
  ) {
    throw new RssError("invalid_archive");
  }
  return sequence;
}

function parseArchiveReference(feed: RssFeedDefinition, value: string): number {
  return parseRssArchiveKey(feed, value);
}

function classifyDocumentKey(
  feed: RssFeedDefinition,
  key: string,
): Readonly<{ documentType: RssArchiveDocumentType; sequence: number | null }> {
  if (key === feed.headKey) {
    return { documentType: "head", sequence: null };
  }
  if (key === feed.pendingKey) {
    return { documentType: "pending", sequence: null };
  }
  try {
    return {
      documentType: "archive",
      sequence: parseRssArchiveKey(feed, key),
    };
  } catch {
    throw new RssError("invalid_archive");
  }
}

function decodeXmlBytes(
  bytes: Uint8Array,
  documentType: RssArchiveDocumentType,
): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new RssError(documentErrorCode(documentType));
  }
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
      throw new Error("Unsupported XML declaration");
    }
    return xml;
  } catch {
    throw new RssError(documentErrorCode(documentType));
  }
}

function parseXml(
  xml: string,
  documentType: RssArchiveDocumentType,
): UnknownRecord {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new RssError(documentErrorCode(documentType));
  }
  try {
    const parsed: unknown = parser.parse(xml);
    if (!isRecord(parsed)) {
      throw new Error("Invalid root");
    }
    return parsed;
  } catch {
    throw new RssError(documentErrorCode(documentType));
  }
}

function parseGuid(value: unknown): Readonly<{ id: string; guid: string }> {
  if (!isRecord(value) || value["@isPermaLink"] !== "false") {
    throw new Error("Invalid GUID");
  }
  if (!hasOnlyKeys(value, new Set(["#text", "@isPermaLink"]))) {
    throw new Error("Unexpected GUID field");
  }
  if (typeof value["#text"] !== "string") {
    throw new Error("Invalid GUID text");
  }
  const guid = value["#text"];
  if (
    !guid.startsWith(PUBLISHED_GUID_PREFIX) ||
    guid.length === PUBLISHED_GUID_PREFIX.length
  ) {
    throw new Error("Invalid Published Item GUID");
  }
  return { id: guid.slice(PUBLISHED_GUID_PREFIX.length), guid };
}

function parseArchiveItem(value: unknown): RssArchiveItem {
  if (!isRecord(value)) {
    throw new Error("Invalid item");
  }
  if (
    !hasOnlyKeys(
      value,
      new Set([
        "title",
        "link",
        "description",
        "content:encoded",
        "guid",
        "pubDate",
      ]),
    )
  ) {
    throw new Error("Unexpected item field");
  }

  const guid = parseGuid(requiredSingleton(value, "guid"));
  const pubDate = requiredText(value, "pubDate");
  if (new Date(pubDate).toUTCString() !== pubDate) {
    throw new Error("Invalid RFC 822 publication date");
  }

  return Object.freeze({
    id: guid.id,
    guid: guid.guid,
    title: requiredText(value, "title"),
    link: optionalText(value, "link"),
    summary: requiredText(value, "description"),
    body: requiredText(value, "content:encoded"),
    pubDate,
  });
}

function requiredSingleton(record: UnknownRecord, key: string): unknown {
  const value = singleValue(record, key);
  if (value === undefined) {
    throw new Error(`Missing singleton ${key}`);
  }
  return value;
}

function parseAtomPreviousLink(
  feed: RssFeedDefinition,
  channel: UnknownRecord,
  documentType: RssArchiveDocumentType,
): string | null {
  if (!("atom:link" in channel)) {
    return null;
  }
  const value = requiredSingleton(channel, "atom:link");
  if (!isRecord(value)) {
    throw new Error("Invalid atom link");
  }
  if (
    !hasOnlyKeys(value, new Set(["#text", "@rel", "@href"])) ||
    typeof value["@rel"] !== "string" ||
    typeof value["@href"] !== "string"
  ) {
    throw new Error("Invalid atom link attributes");
  }
  if (value["@rel"] !== "prev-archive") {
    throw new Error("Unsupported atom link relation");
  }
  if ("#text" in value && value["#text"] !== "") {
    throw new Error("Unexpected atom link text");
  }
  if (documentType === "head") {
    if (value["@href"] !== feed.pendingKey) {
      throw new Error("Head must link to pending");
    }
  } else if (parseArchiveReference(feed, value["@href"]) < 1) {
    throw new Error("Invalid previous archive");
  }
  return value["@href"];
}

function assertPreviousArchive(
  feed: RssFeedDefinition,
  documentType: RssArchiveDocumentType,
  sequence: number | null,
  previousArchiveKey: string | null,
  options: RssArchiveParseOptions,
): void {
  if (documentType === "head") {
    if (previousArchiveKey !== feed.pendingKey) {
      throw new Error("Head must link to pending");
    }
    return;
  }

  if (documentType === "archive") {
    const expected =
      sequence === null || sequence === 1
        ? null
        : buildRssArchiveKey(feed, sequence - 1);
    if (previousArchiveKey !== expected) {
      throw new Error("Archive chain mismatch");
    }
    return;
  }

  if (previousArchiveKey !== null) {
    parseRssArchiveKey(feed, previousArchiveKey);
  }
  if (
    options.latestArchiveKey !== undefined &&
    previousArchiveKey !== options.latestArchiveKey
  ) {
    throw new Error("Pending chain mismatch");
  }
}

export function parseRssArchiveDocument(
  feed: RssFeedDefinition,
  key: string,
  bytes: Uint8Array,
  options: RssArchiveParseOptions = {},
): RssArchiveDocument {
  const canonical = canonicalFeed(feed);
  let classified: ReturnType<typeof classifyDocumentKey>;
  try {
    classified = classifyDocumentKey(canonical, key);
  } catch {
    throw new RssError("invalid_archive");
  }
  const { documentType, sequence } = classified;

  return parseDocumentError(documentType, () => {
    const xml = decodeXmlBytes(bytes, documentType);
    const parsed = parseXml(xml, documentType);
    if (!hasOnlyKeys(parsed, new Set(["rss", "?xml"]))) {
      throw new Error("Unexpected root field");
    }
    const rss = requiredSingleton(parsed, "rss");
    if (!isRecord(rss)) {
      throw new Error("Invalid rss element");
    }
    if (
      !hasOnlyKeys(
        rss,
        new Set([
          "channel",
          "@version",
          "@xmlns:content",
          "@xmlns:atom",
          "@xmlns:fh",
        ]),
      ) ||
      rss["@version"] !== "2.0" ||
      rss["@xmlns:content"] !== CONTENT_NAMESPACE ||
      rss["@xmlns:atom"] !== ATOM_NAMESPACE ||
      rss["@xmlns:fh"] !== FEED_HISTORY_NAMESPACE
    ) {
      throw new Error("Invalid rss attributes");
    }

    const channel = requiredSingleton(rss, "channel");
    if (!isRecord(channel)) {
      throw new Error("Invalid channel");
    }
    if (
      !hasOnlyKeys(
        channel,
        new Set([
          "title",
          "link",
          "description",
          "atom:link",
          "fh:archive",
          "item",
          "#text",
        ]),
      )
    ) {
      throw new Error("Unexpected channel field");
    }
    if (
      "#text" in channel &&
      (typeof channel["#text"] !== "string" || channel["#text"].trim() !== "")
    ) {
      throw new Error("Unexpected channel text");
    }

    if (
      requiredText(channel, "title") !== canonical.title ||
      requiredText(channel, "link") !== key ||
      requiredText(channel, "description") !== canonical.description
    ) {
      throw new Error("Wrong Feed identity");
    }

    const archiveMarkerPresent = "fh:archive" in channel;
    if (
      (documentType === "head" && archiveMarkerPresent) ||
      (documentType !== "head" && !archiveMarkerPresent)
    ) {
      throw new Error("Wrong RFC 5005 marker");
    }
    if (archiveMarkerPresent && requiredText(channel, "fh:archive") !== "") {
      throw new Error("Invalid archive marker");
    }

    const previousArchiveKey = parseAtomPreviousLink(
      canonical,
      channel,
      documentType,
    );
    assertPreviousArchive(
      canonical,
      documentType,
      sequence,
      previousArchiveKey,
      options,
    );

    const rawItems = channel.item;
    const itemValues = Array.isArray(rawItems)
      ? rawItems
      : rawItems === undefined
        ? []
        : [rawItems];
    const items = itemValues.map(parseArchiveItem);
    const seenGuids = new Set<string>();
    for (const item of items) {
      if (seenGuids.has(item.guid)) {
        throw new Error("Duplicate GUID");
      }
      seenGuids.add(item.guid);
    }

    if (documentType === "archive") {
      const batchSize = validateRssBatchSize(
        options.batchSize ?? RSS_ARCHIVE_BATCH_SIZE,
      );
      if (items.length !== batchSize) {
        throw new Error("Archive must be exactly one full batch");
      }
    } else if (documentType === "pending") {
      const batchSize = validateRssBatchSize(
        options.batchSize ?? RSS_ARCHIVE_BATCH_SIZE,
      );
      if (items.length > batchSize - 1) {
        throw new Error("Pending exceeds the unsealed remainder");
      }
    }

    return Object.freeze({
      feed: canonical.kind,
      documentType,
      key,
      title: feed.title,
      description: feed.description,
      previousArchiveKey,
      items: Object.freeze(items),
    });
  });
}

function isOwnArchiveCandidate(feed: RssFeedDefinition, key: string): boolean {
  return key.startsWith(`${ARCHIVE_PREFIX}${feed.archiveFilePrefix}-`);
}

export async function discoverArchives(
  store: RssArtifactStore,
  feed: RssFeedDefinition,
  batchSize = RSS_ARCHIVE_BATCH_SIZE,
): Promise<readonly DiscoveredRssArchive[]> {
  const canonical = canonicalFeed(feed);
  validateRssBatchSize(batchSize);

  let listed: readonly string[];
  try {
    listed = await store.list(ARCHIVE_PREFIX);
  } catch {
    throw new RssError("invalid_archive");
  }
  if (!Array.isArray(listed)) {
    throw new RssError("invalid_archive");
  }

  const keys: string[] = [];
  const seenKeys = new Set<string>();
  for (const key of listed) {
    if (typeof key !== "string") {
      throw new RssError("invalid_archive");
    }
    if (!isOwnArchiveCandidate(canonical, key)) {
      continue;
    }
    parseRssArchiveKey(canonical, key);
    if (seenKeys.has(key)) {
      throw new RssError("invalid_archive");
    }
    seenKeys.add(key);
    keys.push(key);
  }

  keys.sort(
    (left, right) =>
      parseRssArchiveKey(canonical, left) -
      parseRssArchiveKey(canonical, right),
  );
  for (let index = 0; index < keys.length; index += 1) {
    if (parseRssArchiveKey(canonical, keys[index]!) !== index + 1) {
      throw new RssError("invalid_archive");
    }
  }

  const archives: DiscoveredRssArchive[] = [];
  const seenGuids = new Set<string>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let bytes: Uint8Array | null;
    try {
      bytes = await store.read(key);
    } catch {
      throw new RssError("invalid_archive");
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new RssError("invalid_archive");
    }

    const document = parseRssArchiveDocument(canonical, key, bytes, {
      batchSize,
    });
    for (const item of document.items) {
      if (seenGuids.has(item.guid)) {
        throw new RssError("invalid_archive");
      }
      seenGuids.add(item.guid);
    }
    archives.push(
      Object.freeze({
        feed: canonical.kind,
        sequence: index + 1,
        key,
        bytes,
        document,
      }),
    );
  }

  return Object.freeze(archives);
}
