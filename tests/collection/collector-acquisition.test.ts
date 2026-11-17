import { describe, expect, it, vi } from "vitest";

import type {
  AdapterCallOptions,
  AdapterSource,
  SourceAdapter,
  SourceContent,
  SourceEntry,
} from "../../src/adapters/contracts.js";
import { AdapterError } from "../../src/adapters/errors.js";
import type { Source } from "../../src/configuration/contracts.js";
import {
  createSourceAcquirer,
  type CollectionLogMetadata,
  type CollectionLogger,
  type SourceAcquirerDependencies,
} from "../../src/collection/collector.js";
import { CollectionError } from "../../src/collection/collection-errors.js";
import { createSourceAdapterRegistry } from "../../src/collection/adapter-registry.js";
import { parseRawDataSourceItemV1 } from "../../src/collection/raw-data.js";
import type { SourceItemRepository } from "../../src/collection/source-item-repository.js";
import type { Clock } from "../../src/time/clock.js";

const SOURCE_A = "source-a";
const SOURCE_B = "source-b";
const STARTED_AT = "2026-11-17T10:00:00.000+08:00";

function createSource(overrides: Partial<Source> = {}): Source {
  return {
    id: SOURCE_A,
    name: "Source A",
    type: "RSS",
    url: "https://fixture.example/feed.xml?private=feed-secret",
    cron: "0 * * * *",
    enabled: true,
    description: null,
    last_collected_at: "2026-11-17T09:00:00.000+08:00",
    ...overrides,
  };
}

function createEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: SOURCE_A,
    external_id: "guid-default",
    url: "https://fixture.example/article?private=query-secret",
    title: "Default title",
    author: null,
    published_at: "2026-11-17T09:30:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

function createContent(
  entry: SourceEntry,
  overrides: Partial<SourceContent> = {},
): SourceContent {
  return {
    schema_version: 1,
    entry,
    body: "Private article body",
    summary: "Private adapter summary",
    content_kind: "FULL_BODY",
    acquired_via: "SOURCE_FULL_FIELD",
    completeness_basis: "SOURCE_DECLARED",
    article: {
      status: "NOT_REQUESTED",
      reason: null,
      final_url: null,
    },
    ...overrides,
  };
}

interface EntryCall {
  readonly source: AdapterSource;
  readonly lastCollectedAt: string | null;
  readonly options: AdapterCallOptions | undefined;
}

interface ContentCall {
  readonly entry: SourceEntry;
  readonly options: AdapterCallOptions | undefined;
}

interface RecordingAdapter extends SourceAdapter {
  readonly entryCalls: EntryCall[];
  readonly contentCalls: ContentCall[];
}

function createAdapter(
  fetchEntries: SourceAdapter["fetchEntries"],
  fetchContent: SourceAdapter["fetchContent"],
): RecordingAdapter {
  const entryCalls: EntryCall[] = [];
  const contentCalls: ContentCall[] = [];

  return {
    entryCalls,
    contentCalls,
    async fetchEntries(source, lastCollectedAt, options) {
      entryCalls.push({ source, lastCollectedAt, options });
      return fetchEntries(source, lastCollectedAt, options);
    },
    async fetchContent(entry, options) {
      contentCalls.push({ entry, options });
      return fetchContent(entry, options);
    },
  };
}

class FakeSourceRepository {
  calls = 0;

  constructor(private readonly sources: ReadonlyMap<string, Source>) {}

  getById(id: string): Source | null {
    this.calls += 1;
    return this.sources.get(id) ?? null;
  }
}

class FakeSourceItemRepository implements Pick<
  SourceItemRepository,
  "existsByExternalId" | "existsByUrlAndPublishedAt"
> {
  externalChecks = 0;
  urlChecks = 0;
  writes = 0;

  constructor(
    private readonly existingExternalIds = new Set<string>(),
    private readonly existingUrls = new Set<string>(),
  ) {}

  existsByExternalId(sourceId: string, externalId: string): boolean {
    this.externalChecks += 1;
    return this.existingExternalIds.has(`${sourceId}:${externalId}`);
  }

  existsByUrlAndPublishedAt(
    sourceId: string,
    url: string,
    publishedAt: string | null,
  ): boolean {
    this.urlChecks += 1;
    return this.existingUrls.has(`${sourceId}:${url}:${publishedAt ?? "null"}`);
  }
}

class CountingClock implements Clock {
  calls = 0;

  now(): Date {
    this.calls += 1;
    return new Date("2026-11-17T02:00:00.000Z");
  }
}

class CapturedCollectionLogger implements CollectionLogger {
  readonly entries: CollectionLogMetadata[] = [];

  log(metadata: CollectionLogMetadata): void {
    this.entries.push(metadata);
  }
}

function createHarness(options: {
  readonly sources: ReadonlyMap<string, Source>;
  readonly adapter: SourceAdapter;
  readonly sourceItems?: FakeSourceItemRepository;
}) {
  const sourceRepository = new FakeSourceRepository(options.sources);
  const sourceItemRepository =
    options.sourceItems ?? new FakeSourceItemRepository();
  const clock = new CountingClock();
  const logger = new CapturedCollectionLogger();
  const dependencies: SourceAcquirerDependencies = {
    sourceRepository,
    sourceItemRepository,
    adapters: createSourceAdapterRegistry(
      new Map<string, SourceAdapter>([["RSS", options.adapter]]),
    ),
    clock,
    logger,
  };

  return {
    acquire: createSourceAcquirer(dependencies),
    sourceRepository,
    sourceItemRepository,
    clock,
    logger,
  };
}

function expectOnlySafeLogKeys(logger: CapturedCollectionLogger): void {
  const allowed = new Set(["sourceId", "stage", "reason", "count"]);
  for (const entry of logger.entries) {
    expect(Object.keys(entry).every((key) => allowed.has(key))).toBe(true);
  }

  const serialized = JSON.stringify(logger.entries);
  expect(serialized).not.toContain("Private article body");
  expect(serialized).not.toContain("Private adapter summary");
  expect(serialized).not.toContain("query-secret");
  expect(serialized).not.toContain("feed-secret");
  expect(serialized).not.toContain("raw_data");
}

describe("Collection acquisition", () => {
  it("rejects an empty Source ID before repository, adapter, clock or writes", async () => {
    const adapter = createAdapter(
      vi.fn(async () => []),
      vi.fn(async (entry) => createContent(entry)),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
    });

    await expect(harness.acquire("   ")).rejects.toMatchObject({
      code: "invalid_input",
      message: "Invalid collection input",
    });
    expect(harness.sourceRepository.calls).toBe(0);
    expect(harness.sourceItemRepository.writes).toBe(0);
    expect(harness.clock.calls).toBe(0);
    expect(adapter.entryCalls).toHaveLength(0);
  });

  it("CFG-03 returns an empty internal result for missing and disabled Sources without adapter work", async () => {
    const adapter = createAdapter(
      vi.fn(async () => []),
      vi.fn(async (entry) => createContent(entry)),
    );
    const disabled = createSource({ id: "disabled", enabled: false });
    const harness = createHarness({
      sources: new Map([[disabled.id, disabled]]),
      adapter,
    });

    await expect(harness.acquire("missing")).resolves.toEqual({
      startedAt: null,
      drafts: [],
    });
    await expect(harness.acquire("disabled")).resolves.toEqual({
      startedAt: null,
      drafts: [],
    });

    expect(harness.clock.calls).toBe(0);
    expect(harness.sourceItemRepository.externalChecks).toBe(0);
    expect(harness.sourceItemRepository.urlChecks).toBe(0);
    expect(harness.sourceItemRepository.writes).toBe(0);
    expect(adapter.entryCalls).toHaveLength(0);
    expect(adapter.contentCalls).toHaveLength(0);
  });

  it("COL-02/COL-06 passes the checkpoint to the adapter and content-fetches only new GUIDs, including late old published times", async () => {
    const oldGuid = createEntry({
      external_id: "old-guid",
      url: "https://fixture.example/old?private=old",
    });
    const lateOldPublished = createEntry({
      external_id: "late-guid",
      published_at: "2026-11-01T08:00:00.000+08:00",
    });
    const adapter = createAdapter(
      vi.fn(async () => [oldGuid, lateOldPublished]),
      vi.fn(async (entry) => createContent(entry)),
    );
    const sourceItems = new FakeSourceItemRepository(
      new Set([`${SOURCE_A}:old-guid`]),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
      sourceItems,
    });

    const result = await harness.acquire(SOURCE_A);

    expect(result.startedAt).toBe(STARTED_AT);
    expect(harness.clock.calls).toBe(1);
    expect(adapter.entryCalls).toHaveLength(1);
    expect(adapter.entryCalls[0]?.lastCollectedAt).toBe(
      "2026-11-17T09:00:00.000+08:00",
    );
    expect(adapter.contentCalls.map((call) => call.entry.external_id)).toEqual([
      "late-guid",
    ]);
    expect(result.drafts.map((draft) => draft.entry.external_id)).toEqual([
      "late-guid",
    ]);
  });

  it("filters obvious invalid entries, deduplicates the batch, preserves order, and prefilters the repository", async () => {
    const invalid = createEntry({ external_id: null, url: null, title: null });
    const first = createEntry({ external_id: "duplicate-guid" });
    const duplicate = createEntry({
      external_id: "duplicate-guid",
      title: "Duplicate title",
    });
    const urlOnly = createEntry({
      external_id: null,
      url: "https://fixture.example/existing",
      published_at: null,
    });
    const adapter = createAdapter(
      vi.fn(async () => [invalid, first, duplicate, urlOnly]),
      vi.fn(async (entry) => createContent(entry)),
    );
    const sourceItems = new FakeSourceItemRepository(
      new Set(),
      new Set([`${SOURCE_A}:https://fixture.example/existing:null`]),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
      sourceItems,
    });

    const result = await harness.acquire(SOURCE_A);

    expect(adapter.contentCalls.map((call) => call.entry.title)).toEqual([
      "Default title",
    ]);
    expect(result.drafts.map((draft) => draft.entry.external_id)).toEqual([
      "duplicate-guid",
    ]);
    expect(harness.logger.entries).toContainEqual({
      sourceId: SOURCE_A,
      stage: "filter_entries",
      reason: "invalid_entry",
      count: 1,
    });
  });

  it("COL-08/COL-09 delegates content acquisition exactly once per candidate and preserves adapter evidence", async () => {
    const fullEntry = createEntry({ external_id: "full" });
    const summaryEntry = createEntry({ external_id: "summary" });
    const adapter = createAdapter(
      vi.fn(async () => [fullEntry, summaryEntry]),
      vi.fn(async (entry) =>
        entry.external_id === "summary"
          ? createContent(entry, {
              body: "Summary fallback body",
              summary: "Adapter-provided summary",
              content_kind: "SUMMARY",
              acquired_via: "SOURCE_FALLBACK",
              completeness_basis: "PARTIAL_ONLY",
              article: {
                status: "FAILED",
                reason: "extraction_failed",
                final_url: "https://fixture.example/final?ok=1",
              },
            })
          : createContent(entry),
      ),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
    });

    const result = await harness.acquire(SOURCE_A);

    expect(adapter.contentCalls).toHaveLength(2);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]?.content.content_kind).toBe("FULL_BODY");
    expect(result.drafts[1]?.content).toMatchObject({
      body: "Summary fallback body",
      summary: "Adapter-provided summary",
      content_kind: "SUMMARY",
      acquired_via: "SOURCE_FALLBACK",
      completeness_basis: "PARTIAL_ONLY",
      article: {
        status: "FAILED",
        reason: "extraction_failed",
        final_url: "https://fixture.example/final?ok=1",
      },
    });
    expect(
      parseRawDataSourceItemV1(result.drafts[0]?.raw_data ?? "").content,
    ).toEqual({
      body: "Private article body",
      summary: "Private adapter summary",
      content_kind: "FULL_BODY",
      acquired_via: "SOURCE_FULL_FIELD",
      completeness_basis: "SOURCE_DECLARED",
      article: {
        status: "NOT_REQUESTED",
        reason: null,
        final_url: null,
      },
    });
  });

  it("COL-10 degrades one non-abort AdapterError to valid NONE and continues with other candidates", async () => {
    const failedEntry = createEntry({ external_id: "failed" });
    const goodEntry = createEntry({ external_id: "good" });
    const adapter = createAdapter(
      vi.fn(async () => [failedEntry, goodEntry]),
      vi.fn(async (entry) => {
        if (entry.external_id === "failed") {
          throw new AdapterError("network_error");
        }
        return createContent(entry);
      }),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
    });

    const result = await harness.acquire(SOURCE_A);

    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]?.content).toMatchObject({
      body: null,
      summary: null,
      content_kind: "NONE",
      acquired_via: "NONE",
      completeness_basis: "NO_CONTENT",
      article: {
        status: "FAILED",
        reason: "network_error",
        final_url: null,
      },
    });
    expect(result.drafts[1]?.entry.external_id).toBe("good");
    expect(adapter.contentCalls).toHaveLength(2);
    expectOnlySafeLogKeys(harness.logger);
  });

  it("rejects pre-aborted calls and cancellation after listing before any content fetch", async () => {
    const controller = new AbortController();
    const adapter = createAdapter(
      vi.fn(async () => {
        controller.abort();
        return [createEntry()];
      }),
      vi.fn(async (entry) => createContent(entry)),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      harness.acquire(SOURCE_A, { signal: preAborted.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(adapter.entryCalls).toHaveLength(0);

    await expect(
      harness.acquire(SOURCE_A, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(adapter.entryCalls).toHaveLength(1);
    expect(adapter.contentCalls).toHaveLength(0);
    expect(harness.sourceItemRepository.writes).toBe(0);
  });

  it("COL-14 single-flights one Source while another Source runs independently", async () => {
    let resolveSourceA!: (entries: SourceEntry[]) => void;
    const sourceAEntries = new Promise<SourceEntry[]>((resolve) => {
      resolveSourceA = resolve;
    });
    const sourceAEntry = createEntry({ external_id: "source-a-item" });
    const sourceBEntry = createEntry({
      source_id: SOURCE_B,
      external_id: "source-b-item",
    });
    const adapter = createAdapter(
      vi.fn(async (source) => {
        if (source.id === SOURCE_A) {
          return sourceAEntries;
        }
        return [sourceBEntry];
      }),
      vi.fn(async (entry) => createContent(entry)),
    );
    const harness = createHarness({
      sources: new Map([
        [SOURCE_A, createSource()],
        [SOURCE_B, createSource({ id: SOURCE_B, name: "Source B" })],
      ]),
      adapter,
    });

    const firstA = harness.acquire(SOURCE_A);
    const secondA = harness.acquire(SOURCE_A);
    const sourceBResult = expect(
      harness.acquire(SOURCE_B),
    ).resolves.toMatchObject({
      drafts: [{ entry: { external_id: "source-b-item" } }],
    });

    await sourceBResult;
    expect(
      adapter.entryCalls.filter((call) => call.source.id === SOURCE_A),
    ).toHaveLength(1);
    expect(
      adapter.entryCalls.filter((call) => call.source.id === SOURCE_B),
    ).toHaveLength(1);

    resolveSourceA([sourceAEntry]);
    await Promise.all([firstA, secondA]);
    expect(adapter.contentCalls).toHaveLength(2);
  });

  it("maps list failure and unknown adapters to stable safe errors without drafts", async () => {
    const listAdapter = createAdapter(
      vi.fn(async () => {
        throw new AdapterError("network_error");
      }),
      vi.fn(async (entry) => createContent(entry)),
    );
    const listHarness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter: listAdapter,
    });

    await expect(listHarness.acquire(SOURCE_A)).rejects.toMatchObject({
      code: "collection_failed",
      message: "The collection operation failed",
    });
    expect(listAdapter.contentCalls).toHaveLength(0);
    expectOnlySafeLogKeys(listHarness.logger);

    const unknownAdapter = createAdapter(
      vi.fn(async () => []),
      vi.fn(async (entry) => createContent(entry)),
    );
    const unknownSource = {
      ...createSource(),
      type: "ATOM" as unknown as Source["type"],
    };
    const unknownHarness = createHarness({
      sources: new Map([[SOURCE_A, unknownSource]]),
      adapter: unknownAdapter,
    });

    await expect(unknownHarness.acquire(SOURCE_A)).rejects.toMatchObject({
      code: "unsupported_source",
      message: "The source adapter is not registered",
    });
    expect(unknownAdapter.entryCalls).toHaveLength(0);
    expect(unknownAdapter.contentCalls).toHaveLength(0);
  });

  it("does not swallow an unknown content-acquisition exception", async () => {
    const failure = new Error("programming failure with private detail");
    const adapter = createAdapter(
      vi.fn(async () => [createEntry()]),
      vi.fn(async () => {
        throw failure;
      }),
    );
    const harness = createHarness({
      sources: new Map([[SOURCE_A, createSource()]]),
      adapter,
    });

    await expect(harness.acquire(SOURCE_A)).rejects.toBe(failure);
    expectOnlySafeLogKeys(harness.logger);
    expect(JSON.stringify(harness.logger.entries)).not.toContain(
      failure.message,
    );
  });
});
