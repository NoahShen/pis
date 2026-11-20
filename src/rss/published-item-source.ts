import type {
  PublishedItem,
  PublishedItemRepository,
} from "../publication/contracts.js";
import type { RssFeedKind, RssPublishedItemReader } from "./contracts.js";
import { RssError } from "./contracts.js";
import { getRssFeed, parseRssPublishedAt } from "./feed.js";

const EVENT_TARGET_TYPES = new Set(["EVENT", "EVENT_UPDATE"]);

function isPublishedItemTargetType(value: unknown): boolean {
  return value === "EVENT" || value === "EVENT_UPDATE" || value === "KNOWLEDGE";
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

function assertDescendingOrder(items: readonly PublishedItem[]): void {
  const seenIds = new Set<string>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
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
    if (
      previousTime < itemTime ||
      (previousTime === itemTime && previous.id < item.id)
    ) {
      throw new RssError("invalid_input");
    }
  }
}

function freezeSnapshot(
  items: readonly PublishedItem[],
): readonly PublishedItem[] {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        id: item.id,
        target_type: item.target_type,
        target_id: item.target_id,
        title: item.title,
        summary: item.summary,
        body: item.body,
        published_at: item.published_at,
      }),
    ),
  );
}

class RepositoryPublishedItemReader implements RssPublishedItemReader {
  readonly #repository: PublishedItemRepository;

  constructor(repository: PublishedItemRepository) {
    this.#repository = repository;
  }

  async list(feed: RssFeedKind): Promise<readonly PublishedItem[]> {
    const definition = getRssFeed(feed);
    let rows: readonly PublishedItem[];

    try {
      rows = this.#repository.listForFeed(definition.publicationFeed);
    } catch (error) {
      if (error instanceof RssError) {
        throw error;
      }
      throw new RssError("invalid_input");
    }

    if (!Array.isArray(rows)) {
      throw new RssError("invalid_input");
    }

    for (const row of rows) {
      validateItemShape(row);
      assertFeedMembership(row, feed);
    }
    assertDescendingOrder(rows);

    return freezeSnapshot(rows);
  }
}

export function createPublishedItemSource(
  repository: PublishedItemRepository,
): RssPublishedItemReader {
  return new RepositoryPublishedItemReader(repository);
}
