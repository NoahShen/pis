export type RetrievalTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

export type KnowledgeCategory =
  "Insight" | "Experience" | "Method" | "Resource" | null;

export interface KnowledgeFinding {
  readonly title?: string;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface RetrievalListOptions {
  readonly limit?: number;
}

export interface RetrievalList<T> {
  readonly items: T[];
  readonly next_cursor: string | null;
}

export interface EventDto {
  readonly id: string;
  readonly title: string;
  readonly entity_name: string;
  readonly subject: string;
  readonly scope: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

export interface EventListItemDto extends EventDto {
  readonly update_count: number;
}

export interface EventUpdateDto {
  readonly id: string;
  readonly event_id: string;
  readonly title: string;
  readonly description: string;
  readonly occurred_at: string | null;
  readonly discovered_at: string;
}

export interface EvidenceContentDto {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly created_at: string;
}

export interface EventUpdateWithEvidenceDto extends EventUpdateDto {
  readonly evidence_contents: EvidenceContentDto[];
}

export interface EventDetailDto extends EventDto {
  readonly updates: EventUpdateWithEvidenceDto[];
  readonly evidence_contents: EvidenceContentDto[];
}

export interface EventUpdateDetailDto extends EventUpdateWithEvidenceDto {
  readonly event: EventDto;
}

export interface KnowledgeDto {
  readonly id: string;
  readonly content_id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: KnowledgeCategory;
  readonly findings: unknown[];
  readonly value: string;
}

export interface ContentDto {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly body: string;
  readonly summary: string | null;
  readonly language: string | null;
  readonly completeness: "FULL" | "PARTIAL";
}

export interface SourceItemDto {
  readonly id: string;
  readonly source_id: string;
  readonly external_id: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly published_at: string | null;
  readonly discovered_at: string;
  readonly content_id: string | null;
  readonly raw_data: string | null;
}

export interface SourceDto {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly url: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly description: string | null;
  readonly last_collected_at: string | null;
}

export interface KnowledgeDetailDto extends KnowledgeDto {
  readonly content: ContentDto | null;
}

export interface ContentDetailDto extends ContentDto {
  readonly source_item: SourceItemDto | null;
  readonly source: SourceDto | null;
}

export interface TopicDto {
  readonly id: string;
  readonly name: string;
  readonly matched_at: string;
}

export type RetrievalTargetDto = EventDto | EventUpdateDto | KnowledgeDto;

export interface TopicItemDto {
  readonly topic_id: string;
  readonly target_type: RetrievalTargetType;
  readonly target_id: string;
  readonly matched_at: string;
  readonly target: RetrievalTargetDto | null;
}

export interface PublishedItemDto {
  readonly id: string;
  readonly target_type: RetrievalTargetType;
  readonly target_id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly published_at: string;
  readonly topics: TopicDto[];
}

export interface PublishedItemDetailDto extends PublishedItemDto {
  readonly target: RetrievalTargetDto | null;
}

export interface TopicRetrievalRepository {
  listItems(
    topicId: string,
    options?: RetrievalListOptions,
  ): RetrievalList<TopicItemDto> | null;
}

export interface EventRetrievalRepository {
  list(options?: RetrievalListOptions): RetrievalList<EventListItemDto>;
  getById(id: string): EventDetailDto | null;
  listUpdates(
    eventId: string,
    options?: RetrievalListOptions,
  ): RetrievalList<EventUpdateWithEvidenceDto> | null;
  getUpdateById(id: string): EventUpdateDetailDto | null;
}

export interface KnowledgeContentRetrievalRepository {
  listKnowledge(options?: RetrievalListOptions): RetrievalList<KnowledgeDto>;
  getKnowledgeById(id: string): KnowledgeDetailDto | null;
  getContentById(id: string): ContentDetailDto | null;
}

export interface PublishedItemRetrievalRepository {
  list(options?: RetrievalListOptions): RetrievalList<PublishedItemDto>;
  getById(id: string): PublishedItemDetailDto | null;
}

export class RetrievalNotFoundError extends Error {
  constructor() {
    super("Retrieval object not found");
    this.name = "RetrievalNotFoundError";
  }
}
