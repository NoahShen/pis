import type { SourceEntry } from "../adapters/contracts.js";

export type SourceItemIdentity =
  | Readonly<{
      kind: "external_id";
      source_id: string;
      external_id: string;
    }>
  | Readonly<{
      kind: "url_published_at";
      source_id: string;
      url: string;
      published_at: string | null;
    }>;

type IdentityFields = Pick<
  SourceEntry,
  "source_id" | "external_id" | "url" | "published_at"
>;
type MetadataFields = Pick<SourceEntry, "external_id" | "url" | "title">;

export function getSourceItemIdentity(
  entry: IdentityFields,
): SourceItemIdentity | null {
  if (entry.external_id !== null) {
    return {
      kind: "external_id",
      source_id: entry.source_id,
      external_id: entry.external_id,
    };
  }

  if (entry.url !== null) {
    return {
      kind: "url_published_at",
      source_id: entry.source_id,
      url: entry.url,
      published_at: entry.published_at,
    };
  }

  return null;
}

export function isObviousInvalidSourceEntry(entry: MetadataFields): boolean {
  return (
    entry.external_id === null && entry.url === null && entry.title === null
  );
}

export function filterValidSourceEntries(
  entries: readonly SourceEntry[],
): SourceEntry[] {
  return entries.filter((entry) => !isObviousInvalidSourceEntry(entry));
}

export function deduplicateSourceEntries(
  entries: readonly SourceEntry[],
): SourceEntry[] {
  const seenExternalIds = new Map<string, Set<string>>();
  const seenUrls = new Map<string, Map<string, Set<string | null>>>();
  const output: SourceEntry[] = [];

  for (const entry of entries) {
    const identity = getSourceItemIdentity(entry);

    if (identity === null) {
      output.push(entry);
      continue;
    }

    if (identity.kind === "external_id") {
      let sourceExternalIds = seenExternalIds.get(identity.source_id);
      if (sourceExternalIds === undefined) {
        sourceExternalIds = new Set<string>();
        seenExternalIds.set(identity.source_id, sourceExternalIds);
      }

      if (sourceExternalIds.has(identity.external_id)) {
        continue;
      }

      sourceExternalIds.add(identity.external_id);
      output.push(entry);
      continue;
    }

    let sourceUrls = seenUrls.get(identity.source_id);
    if (sourceUrls === undefined) {
      sourceUrls = new Map<string, Set<string | null>>();
      seenUrls.set(identity.source_id, sourceUrls);
    }

    let publishedTimes = sourceUrls.get(identity.url);
    if (publishedTimes === undefined) {
      publishedTimes = new Set<string | null>();
      sourceUrls.set(identity.url, publishedTimes);
    }

    if (publishedTimes.has(identity.published_at)) {
      continue;
    }

    publishedTimes.add(identity.published_at);
    output.push(entry);
  }

  return output;
}
