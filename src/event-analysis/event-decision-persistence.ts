import type Database from "better-sqlite3";

import type { IdGenerator } from "../id/id-generator.js";
import type { Clock } from "../time/clock.js";
import { formatTimestamp } from "../time/format-time.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../llm/response-validators.js";

import type { EventAnalysisTarget } from "./contracts.js";
import type {
  EventRecord,
  EventRepository,
  EventUpdateRecord,
} from "./event-repository.js";

export interface EventDecisionOutcome {
  readonly newTarget: EventAnalysisTarget | null;
  readonly affectedEventIds: readonly string[];
}

export interface EventDecisionPersistenceDependencies {
  readonly database: Database.Database;
  readonly eventRepository: EventRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export class EventDecisionPersistence {
  readonly #database: Database.Database;
  readonly #eventRepository: EventRepository;
  readonly #idGenerator: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: EventDecisionPersistenceDependencies) {
    this.#database = dependencies.database;
    this.#eventRepository = dependencies.eventRepository;
    this.#idGenerator = dependencies.idGenerator;
    this.#clock = dependencies.clock;
  }

  apply(
    contentId: string,
    decision: EventAnalysisDecision,
  ): EventDecisionOutcome {
    if (!this.#database.inTransaction) {
      throw new Error(
        "EventDecisionPersistence.apply requires an active transaction",
      );
    }

    switch (decision.action) {
      case "NEW_EVENT":
        return this.#insertEvent(contentId, decision);
      case "NEW_UPDATE":
        return this.#insertUpdate(contentId, decision);
      case "NO_INCREMENT":
        throw new Error("NO_INCREMENT persistence is not available in D09-T02");
    }
  }

  #insertEvent(
    contentId: string,
    decision: Extract<EventAnalysisDecision, { readonly action: "NEW_EVENT" }>,
  ): EventDecisionOutcome {
    const id = this.#idGenerator.next();
    const discoveredAt = formatTimestamp(this.#clock.now());
    const record: EventRecord = {
      id,
      title: decision.title,
      entity_name: decision.entity.name,
      subject: decision.subject,
      scope: decision.scope,
      description: decision.description,
      occurred_at: decision.occurred_at ?? null,
      discovered_at: discoveredAt,
    };
    const event = this.#eventRepository.insertEvent(record);
    const evidence = this.#eventRepository.insertEvidence(
      "EVENT",
      event.id,
      contentId,
    );

    if (!evidence.inserted) {
      throw new Error("New Event evidence was not inserted");
    }

    return {
      newTarget: { target_type: "EVENT", target_id: event.id },
      affectedEventIds: [event.id],
    };
  }

  #insertUpdate(
    contentId: string,
    decision: Extract<EventAnalysisDecision, { readonly action: "NEW_UPDATE" }>,
  ): EventDecisionOutcome {
    const event = this.#eventRepository.getEventById(decision.event_id);
    if (event === null) {
      throw new Error("Event for Event Update no longer exists");
    }

    const id = this.#idGenerator.next();
    const discoveredAt = formatTimestamp(this.#clock.now());
    const record: EventUpdateRecord = {
      id,
      event_id: decision.event_id,
      title: decision.title,
      description: decision.description,
      occurred_at: decision.occurred_at ?? null,
      discovered_at: discoveredAt,
    };
    const update = this.#eventRepository.insertUpdate(record);
    const evidence = this.#eventRepository.insertEvidence(
      "EVENT_UPDATE",
      update.id,
      contentId,
    );

    if (!evidence.inserted) {
      throw new Error("New Event Update evidence was not inserted");
    }

    return {
      newTarget: { target_type: "EVENT_UPDATE", target_id: update.id },
      affectedEventIds: [event.id],
    };
  }
}
