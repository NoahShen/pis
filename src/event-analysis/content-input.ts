import type {
  ContentRecord,
  ContentRepository,
} from "../processing/content-repository.js";
import type { EventCandidate } from "../event-search/contracts.js";
import type { EventAnalysisReferences } from "../llm/response-validators.js";

import type {
  EventAnalysisCandidate,
  EventAnalysisContent,
} from "./contracts.js";

export type EventAnalysisTaskData = {
  content: EventAnalysisContent;
  candidates: EventAnalysisCandidate[];
};

type ContentReader = Pick<ContentRepository, "getById">;

function projectContent(content: EventAnalysisContent): EventAnalysisContent {
  return {
    title: content.title,
    body: content.body,
    summary: content.summary,
    author: content.author,
    published_at: content.published_at,
    completeness: content.completeness,
  };
}

function projectCandidate(candidate: EventCandidate): EventAnalysisCandidate {
  return {
    id: candidate.id,
    title: candidate.title,
    entity_name: candidate.entity_name,
    subject: candidate.subject,
    scope: candidate.scope,
    description: candidate.description,
    occurred_at: candidate.occurred_at,
    discovered_at: candidate.discovered_at,
    updates: candidate.updates.map((update) => ({
      id: update.id,
      event_id: update.event_id,
      title: update.title,
      description: update.description,
      occurred_at: update.occurred_at,
      discovered_at: update.discovered_at,
    })),
  };
}

export function loadEventAnalysisContent(
  contentRepository: ContentReader,
  contentId: string,
): EventAnalysisContent | null {
  const content: ContentRecord | null = contentRepository.getById(contentId);

  return content === null ? null : projectContent(content);
}

export function buildEventAnalysisTaskData(
  content: EventAnalysisContent,
  candidates: readonly EventCandidate[],
): EventAnalysisTaskData {
  return {
    content: projectContent(content),
    candidates: candidates.map(projectCandidate),
  };
}

export function buildEventAnalysisReferences(
  candidates: readonly EventCandidate[],
): EventAnalysisReferences {
  return {
    candidateEventIds: candidates.map(({ id }) => id),
    eventIdByUpdateId: Object.fromEntries(
      candidates.flatMap((candidate) =>
        candidate.updates.map(({ id }) => [id, candidate.id] as const),
      ),
    ),
  };
}
