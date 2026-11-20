import { AcquisitionError } from "../transport.js";

const FEED_MIME_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
]);

const ARTICLE_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);

const SUPPORTED_LABELS = new Set(["ascii", "us-ascii", "utf-8", "utf8"]);

const SUPPORTED_CONTENT_ENCODINGS = new Set([
  "identity",
  "gzip",
  "x-gzip",
  "deflate",
  "br",
  "zstd",
]);

function unsupportedMime(): AcquisitionError {
  return new AcquisitionError("unsupported_mime", false, null);
}

function unsupportedEncoding(): AcquisitionError {
  return new AcquisitionError("unsupported_encoding", false, null);
}

function parameters(parts: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim().toLowerCase();
    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    if (name.length > 0 && !result.has(name)) {
      result.set(name, value);
    }
  }
  return result;
}

export function validateContentType(
  rawContentType: string | null,
  kind: "feed" | "article",
): void {
  if (rawContentType === null) {
    throw unsupportedMime();
  }
  const [rawMime = "", ...parts] = rawContentType.split(";");
  const mime = rawMime.trim().toLowerCase();
  const supported = kind === "feed" ? FEED_MIME_TYPES : ARTICLE_MIME_TYPES;
  if (!supported.has(mime)) {
    throw unsupportedMime();
  }
  const charset = parameters([mime, ...parts]).get("charset");
  if (charset !== undefined && !SUPPORTED_LABELS.has(charset.toLowerCase())) {
    throw unsupportedEncoding();
  }
}

export function validateContentEncoding(rawEncoding: string | null): void {
  if (rawEncoding === null || rawEncoding.trim().length === 0) {
    return;
  }
  const encodings = rawEncoding
    .split(",")
    .map((item) => item.trim().toLowerCase());
  if (
    encodings.length !== 1 ||
    !SUPPORTED_CONTENT_ENCODINGS.has(encodings[0] ?? "")
  ) {
    throw unsupportedEncoding();
  }
}

function decodeAscii(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw unsupportedEncoding();
    }
    output += String.fromCharCode(byte);
  }
  return output;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw unsupportedEncoding();
  }
}

function decodeUtf8Probe(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function declaredXmlEncoding(rawBody: Uint8Array): string | null {
  const prefix = decodeUtf8Probe(rawBody.subarray(0, 512));
  const declaration = /<\?xml\s[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(
    prefix,
  );
  return declaration?.[1]?.trim().toLowerCase() ?? null;
}

function declaredHtmlEncoding(textPrefix: string): string | null {
  const charset = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(
    textPrefix,
  );
  if (charset?.[1] !== undefined) {
    return charset[1].toLowerCase();
  }
  const content =
    /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^\s;"']+)/i.exec(
      textPrefix,
    );
  return content?.[1]?.toLowerCase() ?? null;
}

export function decodeResponseBody(
  bytes: Uint8Array,
  kind: "feed" | "article",
  declaredCharset: string | null,
): string {
  let decodeAsciiBody =
    declaredCharset === "ascii" || declaredCharset === "us-ascii";
  if (declaredCharset !== null && !SUPPORTED_LABELS.has(declaredCharset)) {
    throw unsupportedEncoding();
  }

  const probablePrefix = decodeUtf8Probe(bytes.subarray(0, 1024));
  if (kind === "feed") {
    const xmlEncoding = declaredXmlEncoding(bytes);
    if (xmlEncoding !== null && !SUPPORTED_LABELS.has(xmlEncoding)) {
      throw unsupportedEncoding();
    }
    decodeAsciiBody ||= xmlEncoding === "ascii" || xmlEncoding === "us-ascii";
  } else {
    const htmlEncoding = declaredHtmlEncoding(probablePrefix);
    if (htmlEncoding !== null && !SUPPORTED_LABELS.has(htmlEncoding)) {
      throw unsupportedEncoding();
    }
    decodeAsciiBody ||= htmlEncoding === "ascii" || htmlEncoding === "us-ascii";
  }

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const body = bytes.subarray(3);
    return decodeAsciiBody ? decodeAscii(body) : decodeUtf8(body);
  }

  return decodeAsciiBody ? decodeAscii(bytes) : decodeUtf8(bytes);
}

export function charsetFromContentType(
  rawContentType: string | null,
): string | null {
  if (rawContentType === null) {
    return null;
  }
  const [mime = "", ...parts] = rawContentType.split(";");
  return (
    parameters([mime, ...parts])
      .get("charset")
      ?.toLowerCase() ?? null
  );
}
