import type Database from "better-sqlite3";

import type {
  EventDetailDto,
  EventListItemDto,
  EventRetrievalRepository,
  EventUpdateDetailDto,
  EventUpdateWithEvidenceDto,
  RetrievalList,
  RetrievalListOptions,
} from "../contracts.js";
import {
  EVENT_COLUMNS,
  EVENT_UPDATE_COLUMNS,
  evidenceFor,
  getRow,
  getRows,
  list,
  mapEvent,
  mapEventUpdate,
  retrievalLimit,
} from "./shared.js";

export class SqliteEventRetrievalRepository implements EventRetrievalRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  list(options: RetrievalListOptions = {}): RetrievalList<EventListItemDto> {
    const rows = getRows(
      this.#db,
      `SELECT e.id, e.title, e.entity_name, e.subject, e.scope, e.description,
              e.occurred_at, e.discovered_at, COUNT(u.id) AS update_count
       FROM events AS e
       LEFT JOIN event_updates AS u ON u.event_id = e.id
       GROUP BY e.id
       ORDER BY e.discovered_at DESC, e.id DESC
       LIMIT ?`,
      retrievalLimit(options.limit),
    );
    return list(
      rows.map((row) => ({
        ...mapEvent(row),
        update_count: Number(row.update_count),
      })),
    );
  }

  getById(id: string): EventDetailDto | null {
    const row = getRow(
      this.#db,
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`,
      id,
    );
    if (row === undefined) return null;
    return {
      ...mapEvent(row),
      updates: this.#updates(id),
      evidence_contents: evidenceFor(this.#db, "EVENT", id),
    };
  }

  listUpdates(
    eventId: string,
    options: RetrievalListOptions = {},
  ): RetrievalList<EventUpdateWithEvidenceDto> | null {
    if (
      getRow(this.#db, "SELECT id FROM events WHERE id = ?", eventId) ===
      undefined
    ) {
      return null;
    }
    const rows = getRows(
      this.#db,
      `SELECT ${EVENT_UPDATE_COLUMNS} FROM event_updates
       WHERE event_id = ? ORDER BY discovered_at DESC, id DESC LIMIT ?`,
      eventId,
      retrievalLimit(options.limit),
    );
    return list(rows.map((row) => this.#withEvidence(row)));
  }

  getUpdateById(id: string): EventUpdateDetailDto | null {
    const row = getRow(
      this.#db,
      `SELECT ${EVENT_UPDATE_COLUMNS} FROM event_updates WHERE id = ?`,
      id,
    );
    if (row === undefined) return null;
    const update = mapEventUpdate(row);
    const event = getRow(
      this.#db,
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`,
      update.event_id,
    );
    if (event === undefined) return null;
    return {
      ...update,
      event: mapEvent(event),
      evidence_contents: evidenceFor(this.#db, "EVENT_UPDATE", id),
    };
  }

  #updates(eventId: string): EventUpdateWithEvidenceDto[] {
    return getRows(
      this.#db,
      `SELECT ${EVENT_UPDATE_COLUMNS} FROM event_updates
       WHERE event_id = ? ORDER BY discovered_at DESC, id DESC`,
      eventId,
    ).map((row) => this.#withEvidence(row));
  }

  #withEvidence(
    row: Parameters<typeof mapEventUpdate>[0],
  ): EventUpdateWithEvidenceDto {
    const update = mapEventUpdate(row);
    return {
      ...update,
      evidence_contents: evidenceFor(this.#db, "EVENT_UPDATE", update.id),
    };
  }
}

export { SqliteEventRetrievalRepository as SqliteRetrievalEventRepository };
