import type { RssFeedDefinition, RssFeedKind } from "./contracts.js";
import { RssError } from "./contracts.js";

const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const EVENT_UPDATES_FEED = Object.freeze({
  kind: "EVENT_UPDATES",
  publicationFeed: "EVENT",
  title: "PIS Event Updates",
  description: "PIS event and event-update publications",
  headKey: "event-updates.xml",
  pendingKey: "event-updates-pending.xml",
  archiveFilePrefix: "event-updates",
} as const satisfies RssFeedDefinition);

const CURATED_CONTENT_FEED = Object.freeze({
  kind: "CURATED_CONTENT",
  publicationFeed: "KNOWLEDGE",
  title: "PIS Curated Content",
  description: "PIS curated knowledge publications",
  headKey: "curated-content.xml",
  pendingKey: "curated-content-pending.xml",
  archiveFilePrefix: "curated-content",
} as const satisfies RssFeedDefinition);

export const RSS_FEEDS = Object.freeze({
  EVENT_UPDATES: EVENT_UPDATES_FEED,
  CURATED_CONTENT: CURATED_CONTENT_FEED,
} satisfies Readonly<Record<RssFeedKind, RssFeedDefinition>>);

export function getRssFeed(kind: RssFeedKind): RssFeedDefinition {
  if (kind === EVENT_UPDATES_FEED.kind) {
    return EVENT_UPDATES_FEED;
  }
  if (kind === CURATED_CONTENT_FEED.kind) {
    return CURATED_CONTENT_FEED;
  }

  throw new RssError("invalid_input");
}

export function parseRssPublishedAt(value: string): number {
  const match = ISO_TIMESTAMP.exec(value);
  if (match === null) {
    throw new RssError("invalid_time");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7] ?? "0");
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new RssError("invalid_time");
  }

  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, millisecond);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute ||
    calendar.getUTCSeconds() !== second ||
    calendar.getUTCMilliseconds() !== millisecond
  ) {
    throw new RssError("invalid_time");
  }

  const offsetSign = match[9] === "-" ? -1 : 1;
  return (
    calendar.getTime() - offsetSign * (offsetHour * 60 + offsetMinute) * 60_000
  );
}
