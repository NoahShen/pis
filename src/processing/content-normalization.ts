import { cleanTextValue } from "../adapters/content-cleaning.js";
import {
  parseRawDataSourceItemV1,
  type RawDataSourceItemV1,
} from "../collection/raw-data.js";

export interface NormalizedContentDraft {
  readonly title: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly body: string;
  readonly summary: string | null;
  readonly language: null;
  readonly completeness: "FULL" | "PARTIAL";
}

export type NormalizationResult =
  | { usable: true; content: NormalizedContentDraft }
  | {
      usable: false;
      reason: "raw_data_invalid" | "title_missing" | "content_unavailable";
    };

function unavailable(
  reason: Extract<NormalizationResult, { usable: false }>["reason"],
): NormalizationResult {
  return { usable: false, reason };
}

export function normalizeRawDataSourceItem(
  rawData: string,
): NormalizationResult {
  let parsed: RawDataSourceItemV1;
  try {
    parsed = parseRawDataSourceItemV1(rawData);
  } catch {
    return unavailable("raw_data_invalid");
  }

  if (parsed.content.content_kind === "NONE") {
    return unavailable("content_unavailable");
  }

  const title = cleanTextValue(parsed.entry.title ?? "");
  if (title === null) {
    return unavailable("title_missing");
  }

  const body = cleanTextValue(parsed.content.body ?? "");
  const summary = cleanTextValue(parsed.content.summary ?? "");

  if (body === null) {
    if (summary === null) {
      return unavailable("content_unavailable");
    }

    return {
      usable: true,
      content: {
        title,
        url: parsed.entry.url,
        author: parsed.entry.author,
        published_at: parsed.entry.published_at,
        body: summary,
        summary,
        language: null,
        completeness: "PARTIAL",
      },
    };
  }

  return {
    usable: true,
    content: {
      title,
      url: parsed.entry.url,
      author: parsed.entry.author,
      published_at: parsed.entry.published_at,
      body,
      summary,
      language: null,
      completeness:
        parsed.content.content_kind === "FULL_BODY" ? "FULL" : "PARTIAL",
    },
  };
}
