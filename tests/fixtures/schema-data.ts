import type Database from "better-sqlite3";

export const schemaFixtureIds = {
  source: "source-schema-fixture",
  contentOne: "content-schema-fixture-one",
  contentTwo: "content-schema-fixture-two",
  event: "event-schema-fixture",
  eventUpdate: "event-update-schema-fixture",
  topic: "topic-schema-fixture",
} as const;

export function seedSchemaData(db: Database.Database): void {
  const seed = db.transaction(() => {
    db.prepare(
      `
        INSERT INTO sources (
          id, name, type, url, cron, enabled, description, last_collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      schemaFixtureIds.source,
      "Schema Fixture Source",
      "RSS",
      "https://fixture.example/feed.xml",
      "0 * * * *",
      1,
      "minimal schema fixture",
      null,
    );

    const insertContent = db.prepare(
      `
        INSERT INTO contents (
          id, title, url, author, published_at, created_at, body, summary,
          language, completeness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertContent.run(
      schemaFixtureIds.contentOne,
      "Fixture Content One",
      "https://fixture.example/content-one",
      "Fixture Author",
      "2026-11-15T09:00:00.000+08:00",
      "2026-11-15T09:01:00.000+08:00",
      "Fixture body one.",
      null,
      "zh-CN",
      "FULL",
    );
    insertContent.run(
      schemaFixtureIds.contentTwo,
      "Fixture Content Two",
      "https://fixture.example/content-two",
      "Fixture Author",
      "2026-11-15T10:00:00.000+08:00",
      "2026-11-15T10:01:00.000+08:00",
      "Fixture body two.",
      null,
      "zh-CN",
      "PARTIAL",
    );

    db.prepare(
      `
        INSERT INTO events (
          id, title, entity_name, subject, scope, description, occurred_at,
          discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      schemaFixtureIds.event,
      "Fixture Event",
      "Fixture Entity",
      "Fixture Subject",
      "Fixture Scope",
      "Fixture event description.",
      null,
      "2026-11-15T11:00:00.000+08:00",
    );

    db.prepare(
      `
        INSERT INTO event_updates (
          id, event_id, title, description, occurred_at, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      schemaFixtureIds.eventUpdate,
      schemaFixtureIds.event,
      "Fixture Event Update",
      "Fixture event update description.",
      null,
      "2026-11-15T12:00:00.000+08:00",
    );

    db.prepare(
      `
        INSERT INTO topics (id, name, description, enabled)
        VALUES (?, ?, ?, ?)
      `,
    ).run(
      schemaFixtureIds.topic,
      "Fixture Topic",
      "Fixture topic description.",
      1,
    );
  });

  seed();
}
