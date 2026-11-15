export const PROCESSING_ROUTE_RESPONSE = {
  routes: ["EVENT", "KNOWLEDGE"],
} as const;

export const EVENT_SEARCH_RESPONSE = {
  clues: [
    {
      entity_name: "Synthetic Entity",
      subject: "Synthetic release",
      search_terms: ["synthetic entity release", "release notes"],
    },
  ],
} as const;

export const EVENT_ANALYSIS_RESULTS = [
  {
    action: "NEW_EVENT",
    title: "Synthetic launch",
    entity: { name: "Synthetic Entity" },
    subject: "Synthetic release",
    scope: "Synthetic project",
    description: "A deterministic event used only for validator tests.",
    occurred_at: "2026-03-01T10:20:30Z",
    confirmed_aliases: ["Synthetic Alias", "Synthetic Alias Two"],
  },
  {
    action: "NEW_UPDATE",
    event_id: "event-synthetic-1",
    title: "Synthetic status update",
    description: "A deterministic update used only for validator tests.",
    occurred_at: "2026-03-02T11:22:33+08:00",
    confirmed_aliases: ["Synthetic Update Alias"],
  },
  {
    action: "NO_INCREMENT",
    event_id: "event-synthetic-2",
    event_update_id: "update-synthetic-2",
    confirmed_aliases: [],
  },
] as const;

export const EVENT_ANALYSIS_RESPONSE = {
  results: EVENT_ANALYSIS_RESULTS,
} as const;

export const EVENT_ANALYSIS_REFERENCES = {
  candidateEventIds: ["event-synthetic-1", "event-synthetic-2"],
  eventIdByUpdateId: {
    "update-synthetic-2": "event-synthetic-2",
  },
} as const;

export const KNOWLEDGE_ANALYSIS_RESPONSE = {
  valuable: true,
  title: "Synthetic knowledge",
  summary: "A deterministic knowledge summary for validator tests.",
  category: "Method",
  findings: [
    {
      title: "Synthetic finding",
      description: "A deterministic finding for validator tests.",
    },
  ],
  value: "A deterministic value statement for validator tests.",
} as const;

export const KNOWLEDGE_ANALYSIS_NEGATIVE_RESPONSE = {
  valuable: false,
} as const;

export const TOPIC_MATCHING_RESPONSE = {
  matched_topic_ids: ["topic-synthetic-1", "topic-synthetic-2"],
} as const;

export const TOPIC_MATCHING_REFERENCES = {
  enabledTopicIds: ["topic-synthetic-1", "topic-synthetic-2"],
} as const;
