import { AdapterError } from "../errors.js";
import { formatTimestamp } from "../../time/format-time.js";

const HTTP_SCHEMES = new Set(["http:", "https:"]);
const RFC_822_OFFSET =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:([+-])(\d{2})(\d{2})|UT|GMT|UTC)$/u;
const RFC_3339_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/iu;
const MONTHS: Readonly<Record<string, number>> = Object.freeze({
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
});

function parseAbsoluteUrl(value: string, base?: string | null): URL | null {
  try {
    const parsed =
      base === undefined || base === null
        ? new URL(value)
        : new URL(value, base);
    return HTTP_SCHEMES.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeUrl(
  value: unknown,
  base?: string | null,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/[\u0000-\u001F\u007F]/u.test(trimmed)) {
    return null;
  }

  const parsed = parseAbsoluteUrl(trimmed, base);
  if (
    parsed === null ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    return null;
  }

  const defaultPort = parsed.protocol === "https:" ? "443" : "80";
  if (parsed.port.length > 0 && parsed.port !== defaultPort) {
    return null;
  }

  return parsed.href;
}

export function requireTransportUrl(value: unknown): string {
  const normalized = normalizeUrl(value);
  if (normalized === null) {
    throw new AdapterError("invalid_source");
  }

  return normalized;
}

function rfc822ToIso(value: string): string | null {
  const match = RFC_822_OFFSET.exec(value);
  if (match === null) {
    return null;
  }

  const month = MONTHS[match[2] ?? ""] ?? 0;
  if (
    !isValidDateTime(
      Number(match[3]),
      month,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? "0"),
    ) ||
    (match[7] !== undefined &&
      !isValidOffset(Number(match[8]), Number(match[9])))
  ) {
    return null;
  }

  return formatParsedDate(value);
}

function rfc3339ToIso(value: string): string | null {
  const match = RFC_3339_WITH_ZONE.exec(value);
  if (match === null) {
    return null;
  }

  if (
    !isValidDateTime(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ) ||
    (match[7] !== undefined &&
      !isValidOffset(Number(match[8]), Number(match[9])))
  ) {
    return null;
  }

  return formatParsedDate(value);
}

function isValidOffset(hours: number, minutes: number): boolean {
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isValidDateTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
): boolean {
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59 &&
    seconds >= 0 &&
    seconds <= 59
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function formatParsedDate(value: string): string | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? formatTimestamp(new Date(milliseconds))
    : null;
}

export function parseRssPublishedAt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return rfc822ToIso(value.trim());
}

export function parseAtomPublishedAt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return rfc3339ToIso(value.trim());
}
