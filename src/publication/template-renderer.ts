import type {
  PublicationContext,
  PublicationDraft,
  PublicationEvent,
  PublicationEventSummary,
  PublicationKnowledge,
  PublicationRenderer,
  PublicationUpdate,
} from "./contracts.js";
import { escapeHtml } from "./html.js";

const DEFAULT_SUMMARY_LIMIT = 240;

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function truncateSummary(
  value: string,
  max = DEFAULT_SUMMARY_LIMIT,
): string {
  if (!Number.isFinite(max)) {
    return value;
  }

  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) {
    return "";
  }

  if (value.length <= limit) {
    return value;
  }

  let end = Math.max(0, limit - 1);
  if (
    end > 0 &&
    end < value.length &&
    isHighSurrogate(value.charCodeAt(end - 1)) &&
    isLowSurrogate(value.charCodeAt(end))
  ) {
    end -= 1;
  }

  return `${value.slice(0, end)}…`;
}

function formatOccurredAt(value: string | null): string {
  return value === null || value.trim() === "" ? "时间未确定" : value;
}

function renderEvent(
  event: PublicationEvent,
  occurredAt: string | null,
): PublicationDraft {
  return {
    title: event.title,
    summary: truncateSummary(event.description),
    body: [
      "<section>",
      `<h2>${escapeHtml(event.title)}</h2>`,
      `<p><strong>核心实体</strong>：${escapeHtml(event.entityName)}</p>`,
      `<p><strong>主题</strong>：${escapeHtml(event.subject)}</p>`,
      `<p><strong>范围</strong>：${escapeHtml(event.scope)}</p>`,
      `<p><strong>发生时间</strong>：${escapeHtml(formatOccurredAt(occurredAt))}</p>`,
      "<h3>初始事实</h3>",
      `<p>${escapeHtml(event.description)}</p>`,
      "</section>",
    ].join("\n"),
  };
}

function renderEventUpdate(
  update: PublicationUpdate,
  parentEvent: PublicationEventSummary,
  occurredAt: string | null,
): PublicationDraft {
  return {
    title: update.title,
    summary: truncateSummary(update.description),
    body: [
      "<section>",
      `<h2>${escapeHtml(update.title)}</h2>`,
      `<p><strong>所属主线</strong>：${escapeHtml(parentEvent.title)}</p>`,
      `<p><strong>核心实体</strong>：${escapeHtml(parentEvent.entityName)}</p>`,
      `<p><strong>主题</strong>：${escapeHtml(parentEvent.subject)}</p>`,
      `<p><strong>范围</strong>：${escapeHtml(parentEvent.scope)}</p>`,
      `<p><strong>发生时间</strong>：${escapeHtml(formatOccurredAt(occurredAt))}</p>`,
      "<h3>本次进展</h3>",
      `<p>${escapeHtml(update.description)}</p>`,
      "</section>",
    ].join("\n"),
  };
}

function renderKnowledge(knowledge: PublicationKnowledge): PublicationDraft {
  const findings =
    knowledge.findings.length === 0
      ? ["<p>暂无 Findings</p>"]
      : [
          "<ul>",
          ...knowledge.findings.map(
            (finding) =>
              `<li><strong>${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.description)}</p></li>`,
          ),
          "</ul>",
        ];

  return {
    title: knowledge.title,
    summary: knowledge.summary,
    body: [
      "<section>",
      `<h2>${escapeHtml(knowledge.title)}</h2>`,
      `<p><strong>分类</strong>：${escapeHtml(knowledge.category ?? "未分类")}</p>`,
      `<p><strong>摘要</strong>：${escapeHtml(knowledge.summary)}</p>`,
      `<p><strong>价值</strong>：${escapeHtml(knowledge.value)}</p>`,
      "<h3>Findings</h3>",
      ...findings,
      "</section>",
    ].join("\n"),
  };
}

export class TemplatePublicationRenderer implements PublicationRenderer {
  render(context: PublicationContext): PublicationDraft {
    switch (context.targetType) {
      case "EVENT":
        return renderEvent(context.event, context.occurredAt);
      case "EVENT_UPDATE":
        return renderEventUpdate(
          context.update,
          context.parentEvent,
          context.occurredAt,
        );
      case "KNOWLEDGE":
        return renderKnowledge(context.knowledge);
    }

    const unreachable: never = context;
    throw new Error(`Unsupported publication target type: ${unreachable}`);
  }
}
