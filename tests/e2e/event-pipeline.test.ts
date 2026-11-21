import { describe, expect, it } from "vitest";

import { TEST_API_TOKEN } from "../fixtures/app-config.js";
import {
  withEventE2eHarness,
  type EventE2eHarness,
  type EventTurn,
} from "../fixtures/e2e-event.js";
import { countRows } from "../fixtures/e2e-pipeline.js";

const CLUES = [
  {
    entity_name: "Regulator One",
    subject: "Investigation",
    search_terms: [],
  },
];

function newEventTurn(matchTopics = true): EventTurn {
  return {
    search: { clues: CLUES },
    analysis: {
      results: [
        {
          action: "NEW_EVENT",
          title: "Regulatory event",
          entity: { name: "Regulator One" },
          subject: "Investigation",
          scope: "Shared scope",
          description: "The initial event evidence.",
          occurred_at: null,
          confirmed_aliases: [],
        },
      ],
    },
    matchTopics,
  };
}

function newUpdateTurn(prefix: string, matchTopics = true): EventTurn {
  return {
    search: { clues: [{ ...CLUES[0], search_terms: ["Regulatory event"] }] },
    analysis: ([eventId]) => {
      if (eventId === undefined)
        throw new Error("Expected NEW_UPDATE candidate");
      return {
        results: [
          {
            action: "NEW_UPDATE",
            event_id: eventId,
            title: "Substantive regulatory progression",
            description: "The update has its own matching and publication.",
            occurred_at: null,
            confirmed_aliases: [],
          },
        ],
      };
    },
    matchTopics,
  };
}

function noIncrementTurn(
  prefix: string,
  confirmedAliases: readonly string[] = [],
): EventTurn {
  return {
    search: { clues: [{ ...CLUES[0], search_terms: ["Regulatory event"] }] },
    analysis: ([eventId]) => {
      if (eventId === undefined)
        throw new Error("Expected NO_INCREMENT candidate");
      return {
        results: [
          {
            action: "NO_INCREMENT",
            event_id: eventId,
            event_update_id: null,
            confirmed_aliases: [...confirmedAliases],
          },
        ],
      };
    },
  };
}

async function retrieval(
  harness: EventE2eHarness,
  url: string,
): Promise<unknown> {
  const response = await harness.assembly.app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${TEST_API_TOKEN}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function publishedRows(harness: EventE2eHarness) {
  return harness.assembly.database
    .prepare(
      "SELECT id, target_type, target_id, title, summary, body, published_at FROM published_items ORDER BY target_type, target_id",
    )
    .all();
}

function expectSourceEvidence(harness: EventE2eHarness, count: number): void {
  const db = harness.assembly.database;
  expect(countRows(db, "source_items")).toBe(count);
  expect(countRows(db, "contents")).toBe(count);
  expect(countRows(db, "knowledge")).toBe(0);
  const chain = db
    .prepare(
      `SELECT source_items.id AS source_item_id, source_items.content_id,
              event_content_links.target_type, event_content_links.target_id
       FROM source_items
       JOIN event_content_links
         ON event_content_links.content_id = source_items.content_id
       ORDER BY source_items.id`,
    )
    .all();
  expect(chain).toHaveLength(count);
  expect(chain).toEqual(
    Array.from({ length: count }, () =>
      expect.objectContaining({
        source_item_id: expect.any(String),
        content_id: expect.any(String),
        target_id: expect.any(String),
      }),
    ),
  );
}

describe("D16 Event production E2E", () => {
  it("E2E-01 NEW_EVENT creates no initial Update and publishes one EVENT item", async () => {
    await withEventE2eHarness(
      { name: "e2e01", turns: [newEventTurn()] },
      async (harness) => {
        await harness.collect();
        const db = harness.assembly.database;
        expect(countRows(db, "events")).toBe(1);
        expect(countRows(db, "event_updates")).toBe(0);
        expect(countRows(db, "event_content_links")).toBe(1);
        expect(countRows(db, "knowledge")).toBe(0);
        expectSourceEvidence(harness, 1);
        expect(countRows(db, "topic_associations")).toBe(1);
        const event = db.prepare("SELECT id FROM events").get() as {
          id: string;
        };
        const content = db
          .prepare("SELECT content_id AS id FROM source_items")
          .get() as { id: string };
        const published = publishedRows(harness)[0] as { id: string };
        expect(publishedRows(harness)).toEqual([
          expect.objectContaining({
            target_type: "EVENT",
            target_id: event.id,
          }),
        ]);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "event-search",
          "event-analysis",
          "topic-matching",
        ]);
        expect(
          new TextDecoder()
            .decode(
              harness.publisher.versions.at(-1)?.files["event-updates.xml"],
            )
            .match(/<item>/g),
        ).toHaveLength(1);
        expect(
          await retrieval(harness, `/api/events/${event.id}`),
        ).toMatchObject({
          id: event.id,
          updates: [],
          evidence_contents: [{ id: content.id }],
        });
        expect(
          await retrieval(harness, `/api/published-items/${published.id}`),
        ).toMatchObject({
          target_type: "EVENT",
          target: { id: event.id },
          topics: [{ id: harness.topicId }],
        });
      },
    );
  });

  it("E2E-02 adds one Update and immutable new Item without changing the old Item", async () => {
    await withEventE2eHarness(
      {
        name: "e2e02",
        turns: [newEventTurn(), newUpdateTurn("e2e02")],
      },
      async (harness) => {
        await harness.collect();
        const oldItem = publishedRows(harness)[0];
        const oldXml =
          harness.publisher.versions.at(-1)?.files["event-updates.xml"];
        expect(oldXml).toBeDefined();

        await harness.collect(1);
        expect(countRows(harness.assembly.database, "events")).toBe(1);
        expect(countRows(harness.assembly.database, "event_updates")).toBe(1);
        expectSourceEvidence(harness, 2);
        expect(countRows(harness.assembly.database, "topic_associations")).toBe(
          2,
        );
        const items = publishedRows(harness);
        expect(items).toHaveLength(2);
        expect(items).toContainEqual(oldItem);
        const update = harness.assembly.database
          .prepare("SELECT id, event_id FROM event_updates")
          .get() as { id: string; event_id: string };
        const secondContent = harness.assembly.database
          .prepare(
            "SELECT content_id AS id FROM source_items ORDER BY rowid DESC LIMIT 1",
          )
          .get() as { id: string };
        const newItem = items.find(
          (item) =>
            (item as { id: string }).id !== (oldItem as { id: string }).id,
        ) as { target_type: string; target_id: string };
        expect(newItem).toMatchObject({
          target_type: "EVENT_UPDATE",
          target_id: update.id,
        });
        const newXml =
          harness.publisher.versions.at(-1)?.files["event-updates.xml"];
        expect(newXml).not.toEqual(oldXml);
        expect(new TextDecoder().decode(newXml).match(/<item>/g)).toHaveLength(
          2,
        );
        expect(
          await retrieval(harness, `/api/event-updates/${update.id}`),
        ).toMatchObject({
          id: update.id,
          event: { id: update.event_id },
          evidence_contents: [{ id: secondContent.id }],
        });
        expect(
          await retrieval(
            harness,
            `/api/published-items/${(oldItem as { id: string }).id}`,
          ),
        ).toMatchObject({ body: (oldItem as { body: string }).body });
      },
    );
  });

  it("E2E-03 adds a second source and evidence on NO_INCREMENT without a new Update or Publish", async () => {
    await withEventE2eHarness(
      {
        name: "e2e03",
        turns: [newEventTurn(), noIncrementTurn("e2e03")],
      },
      async (harness) => {
        await harness.collect();
        const oldItems = publishedRows(harness);
        const oldVersions = harness.publisher.versions.length;
        await harness.collect(1);

        expect(countRows(harness.assembly.database, "events")).toBe(1);
        expect(countRows(harness.assembly.database, "event_updates")).toBe(0);
        expect(
          countRows(harness.assembly.database, "event_content_links"),
        ).toBe(2);
        expectSourceEvidence(harness, 2);
        expect(countRows(harness.assembly.database, "topic_associations")).toBe(
          1,
        );
        expect(publishedRows(harness)).toEqual(oldItems);
        expect(harness.publisher.versions).toHaveLength(oldVersions);
        expect(harness.llm.operations).toEqual([
          "processing-route",
          "event-search",
          "event-analysis",
          "topic-matching",
          "processing-route",
          "event-search",
          "event-analysis",
        ]);
        const eventId = (
          harness.assembly.database.prepare("SELECT id FROM events").get() as {
            id: string;
          }
        ).id;
        const contentIds = (
          harness.assembly.database
            .prepare("SELECT content_id AS id FROM source_items")
            .all() as Array<{ id: string }>
        )
          .map(({ id }) => id)
          .sort();
        const event = await retrieval(harness, `/api/events/${eventId}`);
        expect(
          (
            event as { evidence_contents: Array<{ id: string }> }
          ).evidence_contents
            .map(({ id }) => id)
            .sort(),
        ).toEqual(contentIds);
      },
    );
  });

  it("E2E-08 does not backfill an old Event when a Topic is created later", async () => {
    await withEventE2eHarness(
      {
        name: "e2e08",
        turns: [newEventTurn(), newUpdateTurn("e2e08")],
        createTopicInitially: false,
      },
      async (harness) => {
        await harness.collect();
        expect(countRows(harness.assembly.database, "published_items")).toBe(0);
        expect(countRows(harness.assembly.database, "topic_associations")).toBe(
          0,
        );

        await harness.createTopic();
        await harness.collect(1);
        const db = harness.assembly.database;
        expect(countRows(db, "source_items")).toBe(2);
        expect(countRows(db, "contents")).toBe(2);
        expect(countRows(db, "event_content_links")).toBe(2);
        const event = db.prepare("SELECT id FROM events").get() as {
          id: string;
        };
        const contents = db
          .prepare("SELECT id, content_id FROM source_items ORDER BY rowid")
          .all() as Array<{ id: string; content_id: string }>;
        const firstContent = contents[0]!;
        const secondContent = contents[1]!;
        const update = db.prepare("SELECT id FROM event_updates").get() as {
          id: string;
        };
        expect(
          db
            .prepare(
              "SELECT target_type, target_id, content_id FROM event_content_links ORDER BY target_type",
            )
            .all(),
        ).toEqual([
          {
            target_type: "EVENT",
            target_id: event.id,
            content_id: firstContent.content_id,
          },
          {
            target_type: "EVENT_UPDATE",
            target_id: update.id,
            content_id: secondContent.content_id,
          },
        ]);
        expect(countRows(db, "topic_associations")).toBe(1);
        expect(
          db
            .prepare("SELECT target_type, target_id FROM topic_associations")
            .all(),
        ).toEqual([{ target_type: "EVENT_UPDATE", target_id: update.id }]);
        expect(publishedRows(harness)).toEqual([
          expect.objectContaining({
            target_type: "EVENT_UPDATE",
            target_id: update.id,
          }),
        ]);
        expect(
          await retrieval(harness, `/api/topics/${harness.topicId}/items`),
        ).toMatchObject({
          items: [{ target_type: "EVENT_UPDATE", target_id: update.id }],
        });
      },
    );
  });

  it("E2E-10 stores a NO_INCREMENT alias with Content evidence and refreshes FTS without publishing", async () => {
    const alias = "New Regulator Alias";
    await withEventE2eHarness(
      {
        name: "e2e10",
        turns: [newEventTurn(), noIncrementTurn("e2e10", [alias])],
      },
      async (harness) => {
        await harness.collect();
        const oldItems = publishedRows(harness);
        const oldVersions = harness.publisher.versions.length;
        await harness.collect(1);
        const db = harness.assembly.database;
        const event = db.prepare("SELECT id FROM events").get() as {
          id: string;
        };
        const secondContent = db
          .prepare(
            "SELECT content_id AS id FROM source_items ORDER BY rowid DESC LIMIT 1",
          )
          .get() as { id: string };
        expect(
          db
            .prepare(
              "SELECT event_id, alias, content_id FROM event_entity_aliases",
            )
            .all(),
        ).toEqual([
          {
            event_id: event.id,
            alias,
            content_id: secondContent.id,
          },
        ]);
        expect(
          db
            .prepare(
              "SELECT event_id FROM event_search WHERE event_search MATCH ?",
            )
            .all(`"${alias}"`),
        ).toEqual([{ event_id: event.id }]);
        expectSourceEvidence(harness, 2);
        expect(countRows(db, "topic_associations")).toBe(1);
        expect(publishedRows(harness)).toEqual(oldItems);
        expect(harness.publisher.versions).toHaveLength(oldVersions);
        expect(countRows(db, "events")).toBe(1);
        expect(countRows(db, "event_updates")).toBe(0);
        expect(
          await retrieval(harness, `/api/events/${event.id}`),
        ).toMatchObject({ id: event.id, updates: [] });
      },
    );
  });

  it("E2E-14 reuses an Event across regulators in the same Scope and matches the Update itself", async () => {
    const secondTurn = newUpdateTurn("e2e14");
    secondTurn.search.clues[0] = {
      entity_name: "Different Regulator",
      subject: "Investigation",
      search_terms: ["Regulatory event"],
    };
    await withEventE2eHarness(
      {
        name: "e2e14",
        turns: [newEventTurn(), secondTurn],
      },
      async (harness) => {
        await harness.collect();
        await harness.collect(1);
        expect(countRows(harness.assembly.database, "events")).toBe(1);
        expectSourceEvidence(harness, 2);
        expect(countRows(harness.assembly.database, "topic_associations")).toBe(
          2,
        );
        const event = harness.assembly.database
          .prepare("SELECT id FROM events")
          .get() as { id: string };
        const update = harness.assembly.database
          .prepare("SELECT id, event_id FROM event_updates")
          .get() as { id: string; event_id: string };
        const secondContent = harness.assembly.database
          .prepare(
            "SELECT content_id AS id FROM source_items ORDER BY rowid DESC LIMIT 1",
          )
          .get() as { id: string };
        expect(update.event_id).toBe(event.id);
        expect(publishedRows(harness)).toEqual([
          expect.objectContaining({ target_type: "EVENT" }),
          expect.objectContaining({
            target_type: "EVENT_UPDATE",
            target_id: update.id,
          }),
        ]);
        expect(
          await retrieval(harness, `/api/event-updates/${update.id}`),
        ).toMatchObject({
          event: { scope: "Shared scope" },
          evidence_contents: [{ id: secondContent.id }],
        });
      },
    );
  });
});
