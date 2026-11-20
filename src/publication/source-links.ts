import { escapeAttribute, escapeHtml } from "./html.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const candidate = raw.trim();
  if (candidate.length === 0 || CONTROL_CHARACTERS.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hostname.length === 0
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function collectSourceLinks(
  urls: readonly string[],
  max: number,
): readonly string[] {
  if (!Number.isInteger(max) || max < 1 || max > 20) {
    throw new RangeError("max must be an integer between 1 and 20");
  }

  const collected: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const normalized = normalizeHttpUrl(raw);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    collected.push(normalized);
    if (collected.length === max) {
      break;
    }
  }

  return collected;
}

export function appendSourceLinks(
  body: string,
  links: readonly string[],
): string {
  if (links.length === 0) {
    return body;
  }

  const items = links.map(
    (link) =>
      `<li><a href="${escapeAttribute(link)}">${escapeHtml(link)}</a></li>`,
  );

  return `${body}<section><h2>来源</h2><ul>${items.join("")}</ul></section>`;
}
