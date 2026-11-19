import type Database from "better-sqlite3";

import { withTransaction } from "../database/transaction.js";
import type { IdGenerator } from "../id/id-generator.js";
import type { Clock } from "../time/clock.js";
import type { EventAnalysisResult as EventAnalysisDecision } from "../llm/response-validators.js";

import type {
  EventAnalysisResult,
  EventAnalysisTarget,
  EventTargetType,
} from "./contracts.js";
import {
  EventDecisionPersistence,
  type EventDecisionOutcome,
} from "./event-decision-persistence.js";
import type { EventRepository } from "./event-repository.js";
import { refreshAffectedEvents } from "./event-search-refresh.js";

export interface EventAnalysisPersistenceDependencies {
  readonly database: Database.Database;
  readonly eventRepository: EventRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

interface EventSearchRowCount {
  readonly count: number;
}

function requireReadback(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyEvidence(
  eventRepository: EventRepository,
  targetType: EventTargetType,
  targetId: string,
  contentId: string,
): void {
  const evidence = eventRepository.getEvidence(targetType, targetId, contentId);

  requireReadback(
    evidence !== null &&
      evidence.target_type === targetType &&
      evidence.target_id === targetId &&
      evidence.content_id === contentId,
    "Persisted Event evidence could not be read back",
  );
}

function verifyAliases(
  eventRepository: EventRepository,
  eventId: string,
  aliases: readonly string[],
  expectedContentId?: string,
): void {
  for (const alias of aliases) {
    const stored = eventRepository.getAlias(eventId, alias);
    requireReadback(
      stored !== null &&
        stored.event_id === eventId &&
        stored.alias === alias &&
        stored.content_id.length > 0 &&
        (expectedContentId === undefined ||
          stored.content_id === expectedContentId),
      "Persisted Event alias could not be read back",
    );
  }
}

function verifyNewEvent(
  eventRepository: EventRepository,
  contentId: string,
  decision: Extract<EventAnalysisDecision, { readonly action: "NEW_EVENT" }>,
  outcome: EventDecisionOutcome,
): string {
  const target = outcome.newTarget;
  requireReadback(
    target !== null && target.target_type === "EVENT",
    "NEW_EVENT did not produce an Event target",
  );

  const event = eventRepository.getEventById(target.target_id);
  requireReadback(event !== null, "Persisted Event could not be read back");
  requireReadback(
    event.title === decision.title &&
      event.entity_name === decision.entity.name &&
      event.subject === decision.subject &&
      event.scope === decision.scope &&
      event.description === decision.description &&
      event.occurred_at === (decision.occurred_at ?? null) &&
      event.discovered_at.length > 0,
    "Persisted Event did not match the accepted result",
  );
  verifyEvidence(eventRepository, "EVENT", event.id, contentId);
  verifyAliases(
    eventRepository,
    event.id,
    decision.confirmed_aliases,
    contentId,
  );
  requireReadback(
    outcome.affectedEventIds.includes(event.id),
    "NEW_EVENT did not report its affected Event",
  );

  return event.id;
}

function verifyNewUpdate(
  eventRepository: EventRepository,
  contentId: string,
  decision: Extract<EventAnalysisDecision, { readonly action: "NEW_UPDATE" }>,
  outcome: EventDecisionOutcome,
): string {
  const event = eventRepository.getEventById(decision.event_id);
  requireReadback(
    event !== null,
    "Event for persisted Event Update could not be read back",
  );

  if (outcome.newTarget === null) {
    const reusedUpdate = eventRepository.findReusableUpdate(
      event.id,
      contentId,
    );
    requireReadback(
      reusedUpdate !== null && reusedUpdate.event_id === event.id,
      "Reused Event Update could not be read back",
    );
    verifyEvidence(eventRepository, "EVENT_UPDATE", reusedUpdate.id, contentId);
    verifyAliases(eventRepository, event.id, decision.confirmed_aliases);
    return event.id;
  }

  requireReadback(
    outcome.newTarget.target_type === "EVENT_UPDATE",
    "NEW_UPDATE did not produce an Event Update target",
  );
  const update = eventRepository.getUpdateById(outcome.newTarget.target_id);
  requireReadback(
    update !== null,
    "Persisted Event Update could not be read back",
  );
  requireReadback(
    update.event_id === event.id &&
      update.title === decision.title &&
      update.description === decision.description &&
      update.occurred_at === (decision.occurred_at ?? null) &&
      update.discovered_at.length > 0,
    "Persisted Event Update did not match the accepted result",
  );
  verifyEvidence(eventRepository, "EVENT_UPDATE", update.id, contentId);
  verifyAliases(eventRepository, event.id, decision.confirmed_aliases);
  requireReadback(
    outcome.affectedEventIds.includes(event.id),
    "NEW_UPDATE did not report its affected Event",
  );

  return event.id;
}

function verifyNoIncrement(
  eventRepository: EventRepository,
  contentId: string,
  decision: Extract<EventAnalysisDecision, { readonly action: "NO_INCREMENT" }>,
  outcome: EventDecisionOutcome,
): string {
  requireReadback(
    outcome.newTarget === null,
    "NO_INCREMENT unexpectedly produced a target",
  );

  const event = eventRepository.getEventById(decision.event_id);
  requireReadback(
    event !== null,
    "Event for persisted NO_INCREMENT could not be read back",
  );

  if (decision.event_update_id === null) {
    verifyEvidence(eventRepository, "EVENT", event.id, contentId);
  } else {
    const update = eventRepository.getUpdateById(decision.event_update_id);
    requireReadback(
      update !== null && update.event_id === event.id,
      "NO_INCREMENT Event Update could not be read back",
    );
    verifyEvidence(eventRepository, "EVENT_UPDATE", update.id, contentId);
  }

  verifyAliases(eventRepository, event.id, decision.confirmed_aliases);
  return event.id;
}

function verifyDecisionReadback(
  eventRepository: EventRepository,
  contentId: string,
  decision: EventAnalysisDecision,
  outcome: EventDecisionOutcome,
): void {
  switch (decision.action) {
    case "NEW_EVENT":
      verifyNewEvent(eventRepository, contentId, decision, outcome);
      return;
    case "NEW_UPDATE":
      verifyNewUpdate(eventRepository, contentId, decision, outcome);
      return;
    case "NO_INCREMENT":
      verifyNoIncrement(eventRepository, contentId, decision, outcome);
      return;
  }
}

function verifyAffectedEventSearchRows(
  database: Database.Database,
  eventRepository: EventRepository,
  affectedEventIds: readonly string[],
): void {
  const uniqueEventIds = new Set(affectedEventIds);

  for (const eventId of uniqueEventIds) {
    const row = database
      .prepare<[string], EventSearchRowCount>(
        `
          SELECT count(*) AS count
          FROM event_search
          WHERE event_id = ?
        `,
      )
      .get(eventId);
    requireReadback(
      row?.count === 1 && eventRepository.getEventSearchText(eventId) !== null,
      "Affected Event search text could not be read back as one logical row",
    );
  }
}

function rememberTarget(
  targets: EventAnalysisTarget[],
  seenTargets: Set<string>,
  target: EventAnalysisTarget,
): void {
  const key = `${target.target_type}\u0000${target.target_id}`;
  if (!seenTargets.has(key)) {
    seenTargets.add(key);
    targets.push({
      target_type: target.target_type,
      target_id: target.target_id,
    });
  }
}

export function persistEventAnalysis(
  dependencies: EventAnalysisPersistenceDependencies,
  contentId: string,
  results: readonly EventAnalysisDecision[],
): EventAnalysisResult {
  if (results.length === 0) {
    return { new_targets: [] };
  }

  const decisionPersistence = new EventDecisionPersistence({
    database: dependencies.database,
    eventRepository: dependencies.eventRepository,
    idGenerator: dependencies.idGenerator,
    clock: dependencies.clock,
  });

  return withTransaction(dependencies.database, () => {
    const targets: EventAnalysisTarget[] = [];
    const seenTargets = new Set<string>();
    const affectedEventIds: string[] = [];

    for (const decision of results) {
      const outcome = decisionPersistence.apply(contentId, decision);
      affectedEventIds.push(...outcome.affectedEventIds);
      verifyDecisionReadback(
        dependencies.eventRepository,
        contentId,
        decision,
        outcome,
      );

      if (outcome.newTarget !== null) {
        rememberTarget(targets, seenTargets, outcome.newTarget);
      }
    }

    refreshAffectedEvents(dependencies.database, affectedEventIds);
    verifyAffectedEventSearchRows(
      dependencies.database,
      dependencies.eventRepository,
      affectedEventIds,
    );

    return { new_targets: targets };
  });
}
