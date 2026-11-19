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
        return this.#recordNoIncrement(contentId, decision);
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

    const affectedEventIds = [event.id];
    this.#saveAliases(
      event.id,
      contentId,
      decision.confirmed_aliases,
      affectedEventIds,
    );

    return {
      newTarget: { target_type: "EVENT", target_id: event.id },
      affectedEventIds,
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

    const reusableUpdate = this.#eventRepository.findReusableUpdate(
      event.id,
      contentId,
    );
    if (reusableUpdate !== null) {
      this.#eventRepository.insertEvidence(
        "EVENT_UPDATE",
        reusableUpdate.id,
        contentId,
      );
      const affectedEventIds: string[] = [];
      this.#saveAliases(
        event.id,
        contentId,
        decision.confirmed_aliases,
        affectedEventIds,
      );

      return { newTarget: null, affectedEventIds };
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

    const affectedEventIds = [event.id];
    this.#saveAliases(
      event.id,
      contentId,
      decision.confirmed_aliases,
      affectedEventIds,
    );

    return {
      newTarget: { target_type: "EVENT_UPDATE", target_id: update.id },
      affectedEventIds,
    };
  }

  #recordNoIncrement(
    contentId: string,
    decision: Extract<
      EventAnalysisDecision,
      { readonly action: "NO_INCREMENT" }
    >,
  ): EventDecisionOutcome {
    const event = this.#eventRepository.getEventById(decision.event_id);
    if (event === null) {
      throw new Error("Event for NO_INCREMENT no longer exists");
    }

    if (decision.event_update_id !== null) {
      const update = this.#eventRepository.getUpdateById(
        decision.event_update_id,
      );
      if (update === null || update.event_id !== event.id) {
        throw new Error("NO_INCREMENT Event Update does not belong to Event");
      }

      this.#eventRepository.insertEvidence(
        "EVENT_UPDATE",
        update.id,
        contentId,
      );
    } else {
      this.#eventRepository.insertEvidence("EVENT", event.id, contentId);
    }

    const affectedEventIds: string[] = [];
    this.#saveAliases(
      event.id,
      contentId,
      decision.confirmed_aliases,
      affectedEventIds,
    );

    return { newTarget: null, affectedEventIds };
  }

  #saveAliases(
    eventId: string,
    contentId: string,
    aliases: readonly string[],
    affectedEventIds: string[],
  ): void {
    for (const alias of aliases) {
      const result = this.#eventRepository.insertAlias(
        eventId,
        alias,
        contentId,
      );
      if (result.inserted) {
        affectedEventIds.push(eventId);
      }
    }
  }
}
