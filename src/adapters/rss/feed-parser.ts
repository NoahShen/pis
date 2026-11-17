import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { SourceEntry, SourceText } from "../contracts.js";
import { AdapterError } from "../errors.js";
import type { AdapterPolicy } from "../options.js";
import {
  normalizeUrl,
  parseAtomPublishedAt,
  parseRssPublishedAt,
} from "./url-time.js";
import { formatTimestamp } from "../../time/format-time.js";

const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const CONTENT_NAMESPACE = "http://purl.org/rss/1.0/modules/content/";
const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
const MEDIA_NAMESPACE = "http://search.yahoo.com/mrss/";
const MAX_ELEMENTS = 100_000;
const ATTRIBUTES_KEY = ":@";
const TEXT_KEY = "#text";
const CDATA_KEY = "__cdata";
const COMMENT_KEY = "__comment";
const INVALID_XML_CHAR =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u;

type Attributes = Readonly<Record<string, string>>;

interface XmlNode {
  readonly name: string;
  readonly attributes: Attributes;
  readonly children: readonly XmlNode[];
  readonly content: readonly XmlContent[];
}

type XmlContent =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "cdata"; readonly value: string }
  | { readonly kind: "element"; readonly node: XmlNode };

interface NamespaceFrame {
  readonly bindings: Readonly<Record<string, string>>;
}

interface AtomContent {
  readonly text: SourceText | null;
}

interface ParsedAtomLink {
  readonly href: string;
  readonly rel: string | null;
  readonly type: string | null;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: TEXT_KEY,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: { enabled: false },
  cdataPropName: CDATA_KEY,
  commentPropName: COMMENT_KEY,
  alwaysCreateTextNode: true,
  allowBooleanAttributes: false,
  maxNestedTags: 100,
});

function invalidFeed(): never {
  throw new AdapterError("invalid_feed");
}

function unsupportedFeed(): never {
  throw new AdapterError("unsupported_feed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitQualifiedName(name: string): {
  prefix: string | null;
  local: string;
} {
  const separator = name.indexOf(":");
  return separator === -1
    ? { prefix: null, local: name }
    : { prefix: name.slice(0, separator), local: name.slice(separator + 1) };
}

function resolveName(
  name: string,
  namespaces: Readonly<Record<string, string>>,
): Readonly<{ namespace: string | null; local: string }> | null {
  const { prefix, local } = splitQualifiedName(name);
  if (prefix === null) {
    return { namespace: namespaces[""] ?? null, local };
  }

  const namespace = namespaces[prefix];
  return namespace === undefined ? null : { namespace, local };
}

function readAttributes(record: Record<string, unknown>): Attributes {
  const raw = record[ATTRIBUTES_KEY];
  if (raw === undefined) {
    return Object.freeze({});
  }
  if (!isRecord(raw)) {
    return invalidFeed();
  }

  const attributes: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      return invalidFeed();
    }
    attributes[name] = decodeEntityText(value);
  }
  return Object.freeze(attributes);
}

function inheritNamespaces(
  parent: Readonly<Record<string, string>>,
  attributes: Attributes,
): Readonly<Record<string, string>> {
  const bindings: Record<string, string> = Object.assign(
    Object.create(null),
    parent,
  );
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "xmlns") {
      bindings[""] = value;
    } else if (name.startsWith("xmlns:")) {
      bindings[name.slice("xmlns:".length)] = value;
    }
  }
  return Object.freeze(bindings);
}

function parseXmlRecord(
  record: Record<string, unknown>,
  parentNamespaces: Readonly<Record<string, string>>,
  elementCounter: { count: number },
): readonly {
  readonly node: XmlNode;
  readonly namespaces: Readonly<Record<string, string>>;
}[] {
  const nodes = [];

  for (const [name, rawChildren] of Object.entries(record)) {
    if (name === ATTRIBUTES_KEY) {
      continue;
    }
    if (name === TEXT_KEY || name === CDATA_KEY || name === COMMENT_KEY) {
      continue;
    }
    if (name.startsWith("?")) {
      continue;
    }
    if (!Array.isArray(rawChildren)) {
      return invalidFeed();
    }

    // fast-xml-parser attaches attributes to the element record (the record
    // that owns `name`), not to the element's child array.
    const attributes = readAttributes(record);

    const counter = { count: elementCounter.count + 1 };
    elementCounter.count = counter.count;
    if (counter.count > MAX_ELEMENTS) {
      return invalidFeed();
    }

    const namespaces = inheritNamespaces(parentNamespaces, attributes);
    const content: XmlContent[] = [];
    const children: XmlNode[] = [];

    for (const childRecord of rawChildren) {
      if (!isRecord(childRecord)) {
        return invalidFeed();
      }

      const childNames = Object.keys(childRecord).filter(
        (key) => key !== ATTRIBUTES_KEY,
      );
      if (childNames.length === 1 && childNames[0] === TEXT_KEY) {
        const value = childRecord[TEXT_KEY];
        if (typeof value !== "string") {
          return invalidFeed();
        }
        content.push({ kind: "text", value });
      } else if (childNames.length === 1 && childNames[0] === CDATA_KEY) {
        const values = childRecord[CDATA_KEY];
        if (!Array.isArray(values) || values.length !== 1) {
          return invalidFeed();
        }
        const valueRecord = values[0];
        if (
          !isRecord(valueRecord) ||
          typeof valueRecord[TEXT_KEY] !== "string"
        ) {
          return invalidFeed();
        }
        content.push({ kind: "cdata", value: valueRecord[TEXT_KEY] });
      } else if (childNames.length === 1 && childNames[0] === COMMENT_KEY) {
        continue;
      } else if (childNames.length === 1 && !childNames[0].startsWith("?")) {
        const parsed = parseXmlRecord(childRecord, namespaces, elementCounter);
        for (const child of parsed) {
          children.push(child.node);
          content.push({ kind: "element", node: child.node });
        }
      } else {
        return invalidFeed();
      }
    }

    nodes.push({
      node: { name, attributes, children, content },
      namespaces,
    });
  }

  return nodes;
}

function decodeEntityText(value: string): string {
  return value.replace(
    /&(?:#([0-9]+)|#x([0-9a-f]+)|([a-z]+));/giu,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal !== undefined || hexadecimal !== undefined) {
        const codePoint = Number.parseInt(
          decimal ?? hexadecimal ?? "",
          decimal === undefined ? 16 : 10,
        );
        if (
          !Number.isInteger(codePoint) ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      }
      return XML_ENTITIES[entity] ?? entity;
    },
  );
}

const XML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  "&amp;": "&",
  "&apos;": "'",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
});

function collectText(node: XmlNode): string {
  let text = "";
  for (const content of node.content) {
    text +=
      content.kind === "element"
        ? collectText(content.node)
        : content.kind === "cdata"
          ? content.value
          : decodeEntityText(content.value);
  }
  return text;
}

function firstNonBlank(values: Iterable<string | null>): string | null {
  for (const value of values) {
    if (value !== null && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function namespaceOf(node: XmlNode, frame: NamespaceFrame): string | null {
  const bindings = inheritNamespaces(frame.bindings, node.attributes);
  return resolveName(node.name, bindings)?.namespace ?? null;
}

function localNameOf(node: XmlNode): string | null {
  return splitQualifiedName(node.name).local;
}

function hasNamespace(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
): boolean {
  return localNameOf(node) === local && namespaceOf(node, frame) === namespace;
}

function findChildren(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
): XmlNode[] {
  return node.children.filter((child) =>
    hasNamespace(child, namespace, local, frame),
  );
}

function findFirstChild(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
): XmlNode | null {
  return (
    node.children.find((child) =>
      hasNamespace(child, namespace, local, frame),
    ) ?? null
  );
}

function findFirstNonBlankChild(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
): XmlNode | null {
  for (const child of findChildren(node, namespace, local, frame)) {
    if (collectText(child).trim().length > 0) {
      return child;
    }
  }
  return null;
}

function childFrame(node: XmlNode, parent: NamespaceFrame): NamespaceFrame {
  return { bindings: inheritNamespaces(parent.bindings, node.attributes) };
}

function firstChildText(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
): string | null {
  for (const child of findChildren(node, namespace, local, frame)) {
    const value = collectText(child).trim();
    if (value.length > 0) {
      return value;
    }
  }
  return null;
}

function rssLinkUrl(
  node: XmlNode,
  baseUrl: string | null,
  frame: NamespaceFrame,
): string | null {
  for (const child of findChildren(node, null, "link", frame)) {
    const linkFrame = childFrame(child, frame);
    const linkBase = feedBase(child, linkFrame, baseUrl);
    const normalized = normalizeUrl(collectText(child), linkBase.url);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function rssGuidUrl(
  child: XmlNode | null,
  linkUrl: string | null,
  baseUrl: string | null,
  frame: NamespaceFrame,
): string | null {
  if (child === null) {
    return null;
  }

  const guidFrame = childFrame(child, frame);
  const guidBase = feedBase(child, guidFrame, baseUrl);
  const guidText = collectText(child).trim();
  const isPermaLink = child.attributes.isPermaLink?.trim().toLowerCase();
  if (isPermaLink === "true") {
    return normalizeUrl(guidText, guidBase.url);
  }
  if (isPermaLink !== undefined) {
    return null;
  }
  if (linkUrl !== null) {
    return linkUrl;
  }
  return normalizeUrl(guidText);
}

function atomLink(
  node: XmlNode,
  baseUrl: string | null,
  frame: NamespaceFrame,
): string | null {
  for (const link of findChildren(node, ATOM_NAMESPACE, "link", frame)) {
    const linkFrame = childFrame(link, frame);
    const linkBase = feedBase(link, linkFrame, baseUrl);
    const rel = link.attributes.rel?.trim().toLowerCase() ?? null;
    const type = link.attributes.type?.trim().toLowerCase() ?? null;
    if (
      (rel === null || rel === "alternate") &&
      (type === null ||
        type === "text/html" ||
        type === "application/xhtml+xml")
    ) {
      const href = link.attributes.href;
      if (href !== undefined) {
        const normalized = normalizeUrl(href, linkBase.url);
        if (normalized !== null) {
          return normalized;
        }
      }
    }
  }
  return null;
}

function rssText(
  node: XmlNode,
  namespace: string | null,
  local: string,
  frame: NamespaceFrame,
  format: SourceText["format"],
): SourceText | null {
  for (const child of findChildren(node, namespace, local, frame)) {
    const value = collectText(child).trim();
    if (value.length > 0) {
      return { value, format };
    }
  }
  return null;
}

function atomText(
  node: XmlNode,
  local: string,
  frame: NamespaceFrame,
): SourceText | null {
  for (const child of findChildren(node, ATOM_NAMESPACE, local, frame)) {
    const type = child.attributes.type?.trim().toLowerCase() ?? "text";
    if (
      type === "text" ||
      type === "text/plain" ||
      type === "html" ||
      type === "text/html" ||
      type === "xhtml" ||
      type === "application/xhtml+xml"
    ) {
      const value =
        type === "text" || type === "text/plain"
          ? collectText(child).trim()
          : type === "xhtml" || type === "application/xhtml+xml"
            ? serializeAtomSubtree(child, frame).trim()
            : collectText(child).trim();
      if (value.length > 0) {
        return {
          value,
          format: type === "text" || type === "text/plain" ? "TEXT" : "HTML",
        };
      }
    }
  }
  return null;
}

function htmlVisibleText(value: string): string {
  let text = "";
  let index = 0;

  while (index < value.length) {
    const tagStart = value.indexOf("<", index);
    if (tagStart === -1) {
      text += decodeEntityText(value.slice(index));
      break;
    }

    text += decodeEntityText(value.slice(index, tagStart));
    if (value.startsWith("<!--", tagStart)) {
      const commentEnd = value.indexOf("-->", tagStart + 4);
      index = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findHtmlTagEnd(value, tagStart + 1);
    if (tagEnd === -1) {
      text += decodeEntityText(value.slice(tagStart));
      break;
    }

    const tag = value.slice(tagStart + 1, tagEnd);
    const match = /^\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/u.exec(tag);
    if (match === null) {
      if (!tag.trimStart().startsWith("!")) {
        text += decodeEntityText(value.slice(tagStart, tagEnd + 1));
      }
      index = tagEnd + 1;
      continue;
    }

    const tagName = (match[2] ?? "").toLowerCase();
    index = tagEnd + 1;
    if (
      match[1] !== "/" &&
      (tagName === "script" || tagName === "style") &&
      !/\/\s*$/u.test(tag)
    ) {
      const closingStart = findHtmlClosingTag(value, index, tagName);
      if (closingStart === -1) {
        index = value.length;
      } else {
        const closingEnd = findHtmlTagEnd(value, closingStart + 1);
        index = closingEnd === -1 ? value.length : closingEnd + 1;
      }
    }
  }

  return text.replace(/\s+/gu, " ").trim();
}

function findHtmlTagEnd(value: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function findHtmlClosingTag(
  value: string,
  start: number,
  tagName: string,
): number {
  const lowerValue = value.toLowerCase();
  const needle = `</${tagName}`;
  let index = lowerValue.indexOf(needle, start);
  while (index !== -1) {
    const following = lowerValue[index + needle.length];
    if (following === undefined || /[\s>]/u.test(following)) {
      return index;
    }
    index = lowerValue.indexOf(needle, index + needle.length);
  }
  return -1;
}

function atomTitleText(
  node: XmlNode,
  local: string,
  frame: NamespaceFrame,
): string | null {
  for (const child of findChildren(node, ATOM_NAMESPACE, local, frame)) {
    const type = child.attributes.type?.trim().toLowerCase() ?? "text";
    if (
      type !== "text" &&
      type !== "text/plain" &&
      type !== "html" &&
      type !== "text/html" &&
      type !== "xhtml" &&
      type !== "application/xhtml+xml"
    ) {
      continue;
    }

    const visibleText =
      type === "html" || type === "text/html"
        ? htmlVisibleText(collectText(child))
        : collectText(child).replace(/\s+/gu, " ").trim();
    if (visibleText.length > 0) {
      return visibleText;
    }
  }
  return null;
}

function serializeAtomSubtree(node: XmlNode, frame: NamespaceFrame): string {
  return node.content
    .map((content) => {
      if (content.kind === "cdata") {
        return escapeXmlText(content.value);
      }
      if (content.kind === "text") {
        return escapeXmlText(decodeEntityText(content.value));
      }
      return serializeXmlElement(content.node, childFrame(content.node, frame));
    })
    .join("");
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function serializeXmlElement(node: XmlNode, frame: NamespaceFrame): string {
  const attributes = Object.entries(node.attributes)
    .filter(([name]) => name !== "xmlns" && !name.startsWith("xmlns:"))
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
  const inner = serializeAtomSubtree(node, frame);
  const qualifiedName = localNameOf(node) ?? node.name;
  return `<${qualifiedName}${attributes}>${inner}</${qualifiedName}>`;
}

function atomContent(node: XmlNode, frame: NamespaceFrame): AtomContent {
  for (const child of findChildren(node, ATOM_NAMESPACE, "content", frame)) {
    if (child.attributes.src !== undefined) {
      continue;
    }
    const type = child.attributes.type?.trim().toLowerCase() ?? "text";
    if (
      type === "html" ||
      type === "text/html" ||
      type === "xhtml" ||
      type === "application/xhtml+xml"
    ) {
      const value =
        type === "html" || type === "text/html"
          ? collectText(child).trim()
          : serializeAtomSubtree(child, frame).trim();
      if (value.length > 0) {
        return { text: { value, format: "HTML" } };
      }
    } else if (type === "text" || type === "text/plain") {
      const value = collectText(child).trim();
      if (value.length > 0) {
        return { text: { value, format: "TEXT" } };
      }
    }
  }
  return { text: null };
}

function feedBase(
  node: XmlNode,
  frame: NamespaceFrame,
  inheritedUrl: string | null,
): { readonly frame: NamespaceFrame; readonly url: string | null } {
  const base = node.attributes["xml:base"];
  if (base === undefined || base.trim().length === 0) {
    return { frame, url: inheritedUrl };
  }
  return {
    frame,
    url: inheritedUrl === null ? null : normalizeUrl(base, inheritedUrl),
  };
}

function parseRss(
  root: XmlNode,
  rootFrame: NamespaceFrame,
  finalUrl: string,
  maxFeedEntries: number,
  sourceId: string,
): SourceEntry[] {
  const channel = findFirstChild(root, null, "channel", rootFrame);
  if (channel === null) {
    return invalidFeed();
  }
  const rootBase = feedBase(root, rootFrame, finalUrl);
  const channelBase = feedBase(
    channel,
    childFrame(channel, rootBase.frame),
    rootBase.url,
  );
  const channelFrame = channelBase.frame;
  const items = findChildren(channel, null, "item", channelFrame);
  if (items.length > maxFeedEntries) {
    throw new AdapterError("feed_too_many_entries");
  }

  const entries: SourceEntry[] = [];
  for (const item of items) {
    const itemFrame = childFrame(item, channelBase.frame);
    const itemBase = feedBase(item, itemFrame, channelBase.url);
    const guidNode = findFirstNonBlankChild(item, null, "guid", itemBase.frame);
    const externalId =
      guidNode === null ? null : collectText(guidNode).trim() || null;
    const linkUrl = rssLinkUrl(item, itemBase.url, itemBase.frame);
    const url =
      linkUrl ?? rssGuidUrl(guidNode, linkUrl, itemBase.url, itemBase.frame);
    if (externalId === null && url === null) {
      continue;
    }

    const pubDateNode = findFirstNonBlankChild(
      item,
      null,
      "pubDate",
      itemBase.frame,
    );
    const dcDateNode = findFirstNonBlankChild(
      item,
      DC_NAMESPACE,
      "date",
      itemBase.frame,
    );
    const publishedRaw =
      pubDateNode !== null
        ? collectText(pubDateNode)
        : dcDateNode !== null
          ? collectText(dcDateNode)
          : null;
    const publishedAt = parseRssPublishedAt(publishedRaw);

    const bodyText = rssText(
      item,
      CONTENT_NAMESPACE,
      "encoded",
      itemBase.frame,
      "HTML",
    );
    const summaryText =
      rssText(item, null, "description", itemBase.frame, "HTML") ??
      rssText(item, MEDIA_NAMESPACE, "description", itemBase.frame, "HTML");
    const author = firstNonBlank([
      firstChildText(item, null, "author", itemBase.frame),
      firstChildText(item, DC_NAMESPACE, "creator", itemBase.frame),
    ]);

    entries.push({
      source_id: sourceId,
      external_id: externalId,
      url,
      title: firstChildText(item, null, "title", itemBase.frame),
      author,
      published_at: publishedAt,
      full_body: bodyText,
      summary: summaryText,
    });
  }

  return entries;
}

function parseAtomAuthor(node: XmlNode, frame: NamespaceFrame): string | null {
  const author = findFirstChild(node, ATOM_NAMESPACE, "author", frame);
  if (author === null) {
    return null;
  }
  return firstChildText(
    author,
    ATOM_NAMESPACE,
    "name",
    childFrame(author, frame),
  );
}

function parseAtom(
  root: XmlNode,
  rootFrame: NamespaceFrame,
  finalUrl: string,
  maxFeedEntries: number,
  sourceId: string,
): SourceEntry[] {
  const rootBase = feedBase(root, rootFrame, finalUrl);
  const feedAuthor = parseAtomAuthor(root, rootBase.frame);
  const entries = findChildren(root, ATOM_NAMESPACE, "entry", rootBase.frame);
  if (entries.length > maxFeedEntries) {
    throw new AdapterError("feed_too_many_entries");
  }

  const output: SourceEntry[] = [];
  for (const entry of entries) {
    const entryFrame = childFrame(entry, rootBase.frame);
    const entryBase = feedBase(entry, entryFrame, rootBase.url);
    const idNode = findFirstNonBlankChild(
      entry,
      ATOM_NAMESPACE,
      "id",
      entryBase.frame,
    );
    const externalId =
      idNode === null ? null : collectText(idNode).trim() || null;
    const url = atomLink(entry, entryBase.url, entryBase.frame);
    if (externalId === null && url === null) {
      continue;
    }

    const publishedNode = findFirstNonBlankChild(
      entry,
      ATOM_NAMESPACE,
      "published",
      entryBase.frame,
    );
    const updatedNode = findFirstNonBlankChild(
      entry,
      ATOM_NAMESPACE,
      "updated",
      entryBase.frame,
    );
    const publishedRaw =
      publishedNode !== null
        ? collectText(publishedNode)
        : updatedNode !== null
          ? collectText(updatedNode)
          : null;
    const publishedAt = parseAtomPublishedAt(publishedRaw);
    const content = atomContent(entry, entryBase.frame);
    const metadataFrame = childFrame(entry, entryBase.frame);
    const title = atomTitleText(entry, "title", metadataFrame);
    const summary = atomText(entry, "summary", metadataFrame);
    const author = parseAtomAuthor(entry, entryBase.frame) ?? feedAuthor;

    output.push({
      source_id: sourceId,
      external_id: externalId,
      url,
      title,
      author,
      published_at: publishedAt,
      full_body: content.text,
      summary,
    });
  }

  return output;
}

export interface FeedParserOptions {
  readonly finalUrl: string;
  readonly policy: Readonly<AdapterPolicy>;
  readonly sourceId: string;
}

export function parseFeedEntries(
  xml: string,
  options: Readonly<FeedParserOptions>,
): SourceEntry[] {
  if (typeof xml !== "string") {
    return invalidFeed();
  }
  const trimmedXml = xml.trim();
  if (
    INVALID_XML_CHAR.test(xml) ||
    trimmedXml.startsWith("{") ||
    trimmedXml.startsWith("[")
  ) {
    return unsupportedFeed();
  }
  if (trimmedXml.length === 0) {
    return invalidFeed();
  }
  if (/<\s*!DOCTYPE\b|<\s*!ENTITY\b/iu.test(xml)) {
    return unsupportedFeed();
  }

  let parsed: unknown;
  try {
    if (XMLValidator.validate(xml) !== true) {
      return invalidFeed();
    }
    parsed = parser.parse(xml);
  } catch {
    return invalidFeed();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return invalidFeed();
  }

  const counter = { count: 0 };
  const roots: {
    node: XmlNode;
    namespaces: Readonly<Record<string, string>>;
  }[] = [];
  for (const record of parsed) {
    if (!isRecord(record)) {
      return invalidFeed();
    }
    const names = Object.keys(record).filter((key) => key !== ATTRIBUTES_KEY);
    if (
      names.length === 1 &&
      (names[0].startsWith("?") || names[0] === TEXT_KEY)
    ) {
      if (
        names[0] === TEXT_KEY &&
        typeof record[TEXT_KEY] === "string" &&
        record[TEXT_KEY].trim() === ""
      ) {
        continue;
      }
      if (names[0].startsWith("?")) {
        continue;
      }
    }
    const parsedRoots = parseXmlRecord(record, Object.freeze({}), counter);
    roots.push(...parsedRoots);
  }

  const root = roots.length === 1 ? roots[0] : null;
  if (root === null) {
    return invalidFeed();
  }

  const rootName = resolveName(root.node.name, root.namespaces);
  if (rootName === null) {
    return invalidFeed();
  }

  if (rootName.namespace === null && rootName.local === "rss") {
    return parseRss(
      root.node,
      { bindings: root.namespaces },
      options.finalUrl,
      options.policy.maxFeedEntries,
      options.sourceId,
    );
  }
  if (rootName.namespace === ATOM_NAMESPACE && rootName.local === "feed") {
    return parseAtom(
      root.node,
      { bindings: root.namespaces },
      options.finalUrl,
      options.policy.maxFeedEntries,
      options.sourceId,
    );
  }
  return unsupportedFeed();
}
