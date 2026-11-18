import type {
  ContentRecord,
  ContentRepository,
} from "../processing/content-repository.js";

export type KnowledgeTaskData = {
  title: string;
  body: string;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  completeness: "FULL" | "PARTIAL";
};

type ContentReader = Pick<ContentRepository, "getById">;

function projectTaskData(content: ContentRecord): KnowledgeTaskData {
  return {
    title: content.title,
    body: content.body,
    summary: content.summary,
    author: content.author,
    published_at: content.published_at,
    completeness: content.completeness,
  };
}

export function loadKnowledgeTaskData(
  contentRepository: ContentReader,
  contentId: string,
): KnowledgeTaskData | null {
  const content = contentRepository.getById(contentId);

  return content === null ? null : projectTaskData(content);
}
