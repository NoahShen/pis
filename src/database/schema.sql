-- PIS V1 / DB-03: SQLite schema baseline (2026-11-11)
-- 7 core tables + 4 auxiliary tables + one rebuildable FTS5 index.
-- All application timestamps use ISO-8601 TEXT normalized to +08:00.
-- Generate IDs and timestamp values in the application; do not rely on SQLite UTC CURRENT_TIMESTAMP.
-- Run PRAGMA foreign_keys=ON and PRAGMA busy_timeout on EVERY new connection.
-- WAL mode is a database-level setting; set during initialization.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 01 / Source: subscription configuration and Collection checkpoint.
CREATE TABLE IF NOT EXISTS sources (
    id                TEXT PRIMARY KEY NOT NULL,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    url               TEXT NOT NULL,
    cron              TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    description       TEXT,
    last_collected_at TEXT
);

-- 02 / Content: one normalized result per successfully processed Source Item.
CREATE TABLE IF NOT EXISTS contents (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    author       TEXT,
    published_at TEXT,
    created_at   TEXT NOT NULL,
    body         TEXT NOT NULL,
    summary      TEXT,
    language     TEXT,
    completeness TEXT NOT NULL CHECK (completeness IN ('FULL', 'PARTIAL'))
);

-- 03 / Event: a continuing storyline, NOT a single incident.
CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL,
    entity_name   TEXT NOT NULL,
    subject       TEXT NOT NULL,
    scope         TEXT NOT NULL,
    description   TEXT NOT NULL,
    occurred_at   TEXT,
    discovered_at TEXT NOT NULL
);

-- 04 / Event Update: substantive progression belonging to an Event.
CREATE TABLE IF NOT EXISTS event_updates (
    id            TEXT PRIMARY KEY NOT NULL,
    event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    occurred_at   TEXT,
    discovered_at TEXT NOT NULL
);

-- 05 / Knowledge: exactly zero or one primary Knowledge for a Content.
CREATE TABLE IF NOT EXISTS knowledge (
    id            TEXT PRIMARY KEY NOT NULL,
    content_id    TEXT NOT NULL UNIQUE REFERENCES contents(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL,
    category      TEXT CHECK (category IS NULL OR category IN ('Insight', 'Experience', 'Method', 'Resource')),
    findings_json TEXT NOT NULL CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
    value         TEXT NOT NULL
);

-- 06 / Topic: intentionally no focus, priority or scoring fields.
CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

-- 07 / Published Item: immutable readable snapshot; source links optional and validated when present.
CREATE TABLE IF NOT EXISTS published_items (
    id           TEXT PRIMARY KEY NOT NULL,
    target_type  TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE', 'KNOWLEDGE')),
    target_id    TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL,
    body         TEXT NOT NULL CHECK (length(trim(body)) > 0),
    published_at TEXT NOT NULL,
    UNIQUE (target_type, target_id)
);

-- A1 / Source Item: source identity is resolved from existing fields in application.
-- raw_data stores Adapter-acquired body/summary + source data when available.
-- No entry_key and NO uniqueness on URL, external_id, or publication time.
CREATE TABLE IF NOT EXISTS source_items (
    id            TEXT PRIMARY KEY NOT NULL,
    source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    external_id   TEXT,
    url           TEXT,
    title         TEXT,
    published_at  TEXT,
    discovered_at TEXT NOT NULL,
    content_id    TEXT REFERENCES contents(id) ON DELETE RESTRICT,
    raw_data      TEXT
);

-- A2 / Evidence: EVENT or EVENT_UPDATE to supporting Content.
-- The polymorphic target (type,id) is checked in application code.
CREATE TABLE IF NOT EXISTS event_content_links (
    target_type TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE')),
    target_id   TEXT NOT NULL,
    content_id  TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    PRIMARY KEY (target_type, target_id, content_id)
);

-- A3 / Confirmed core Entity aliases: one supporting Content per alias for V1.
CREATE TABLE IF NOT EXISTS event_entity_aliases (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    alias      TEXT NOT NULL,
    content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    PRIMARY KEY (event_id, alias)
);

-- A4 / Topic Association: only successfully matched targets are recorded.
-- The polymorphic target (type,id) is checked in application code.
CREATE TABLE IF NOT EXISTS topic_associations (
    topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
    target_type TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE', 'KNOWLEDGE')),
    target_id   TEXT NOT NULL,
    matched_at  TEXT NOT NULL,
    PRIMARY KEY (topic_id, target_type, target_id)
);

-- Normal relation / candidate lookup indexes (exclude duplicates of PRIMARY KEY / UNIQUE).
CREATE INDEX IF NOT EXISTS idx_source_items_ext
    ON source_items(source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_items_url_pub
    ON source_items(source_id, url, published_at) WHERE url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_items_content
    ON source_items(content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_entity_name
    ON events(entity_name);
CREATE INDEX IF NOT EXISTS idx_event_updates_history
    ON event_updates(event_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_content_links_content
    ON event_content_links(content_id);
CREATE INDEX IF NOT EXISTS idx_event_entity_aliases_alias
    ON event_entity_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_topic_associations_target
    ON topic_associations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_topic_associations_history
    ON topic_associations(topic_id, matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_items_feed
    ON published_items(target_type, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_published_items_latest
    ON published_items(published_at DESC, id DESC);

-- Rebuildable Event candidate index; one FTS row per Event containing its
-- fields, confirmed aliases, and all previous Event Updates' descriptions.
-- Rebuild this row inside the same short write transaction when the Event,
-- any Event Update, or its confirmed Entity aliases change.
-- trigram MATCH is not effective for short (1-2 character) expressions;
-- fallback to indexed entity/alias lookup and application-specific short queries.
CREATE VIRTUAL TABLE IF NOT EXISTS event_search USING fts5(
    event_id UNINDEXED,
    search_text,
    tokenize = 'trigram'
);
