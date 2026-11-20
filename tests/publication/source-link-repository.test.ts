import { describe, expect, it } from "vitest";

import { collectSourceLinks } from "../../src/publication/source-links.js";
import { SqlitePublicationSourceLinkRepository } from "../../src/publication/source-link-repository.js";
import {
  createPublicationSourceLinkFixtureDatabase,
  publicationSourceLinkFixtureIds,
  publicationSourceLinkFixtureUrls,
} from "../fixtures/publication.js";

function withSourceLinkDatabase<T>(
  callback: (repository: SqlitePublicationSourceLinkRepository) => T,
): T {
  const database = createPublicationSourceLinkFixtureDatabase();

  try {
    return callback(new SqlitePublicationSourceLinkRepository(database));
  } finally {
    database.close();
  }
}

describe("SqlitePublicationSourceLinkRepository", () => {
  it("EVENT_SOURCE_SQL reads only the Event's evidence in stable Source Item order with URL fallback", () => {
    withSourceLinkDatabase((repository) => {
      const urls = repository.listSourceUrls(
        "EVENT",
        publicationSourceLinkFixtureIds.event,
      );

      expect(urls).toEqual([
        publicationSourceLinkFixtureUrls.eventPriority,
        publicationSourceLinkFixtureUrls.eventFallback,
        "",
        publicationSourceLinkFixtureUrls.eventPriority,
        "javascript:alert(1)",
        "https://user:password@event.example.test/private",
        "https://event.example.test/control\nsynthetic",
      ]);
      expect(collectSourceLinks(urls, 20)).toEqual([
        publicationSourceLinkFixtureUrls.eventPriority,
        publicationSourceLinkFixtureUrls.eventFallback,
      ]);
      expect(
        repository.listSourceUrls(
          "EVENT",
          publicationSourceLinkFixtureIds.contentOnlyEvent,
        ),
      ).toEqual([publicationSourceLinkFixtureUrls.eventContentOnly]);
      expect(repository.listSourceUrls("EVENT", "missing-event")).toEqual([]);
    });
  });

  it("UPDATE_SOURCE_SQL reads only the Update's own evidence and never inherits parent Event evidence", () => {
    withSourceLinkDatabase((repository) => {
      const urls = repository.listSourceUrls(
        "EVENT_UPDATE",
        publicationSourceLinkFixtureIds.update,
      );

      expect(urls).toEqual([publicationSourceLinkFixtureUrls.eventUpdate]);
      expect(urls).not.toContain(
        publicationSourceLinkFixtureUrls.eventPriority,
      );
      expect(urls).not.toContain(
        publicationSourceLinkFixtureUrls.eventFallback,
      );
      expect(
        repository.listSourceUrls(
          "EVENT_UPDATE",
          publicationSourceLinkFixtureIds.event,
        ),
      ).toEqual([]);
      expect(
        repository.listSourceUrls(
          "EVENT",
          publicationSourceLinkFixtureIds.update,
        ),
      ).toEqual([]);
    });
  });

  it("KNOWLEDGE_SOURCE_SQL follows knowledge.content_id, prefers Source Item URL, and falls back to Content URL", () => {
    withSourceLinkDatabase((repository) => {
      expect(
        repository.listSourceUrls(
          "KNOWLEDGE",
          publicationSourceLinkFixtureIds.knowledge,
        ),
      ).toEqual([publicationSourceLinkFixtureUrls.knowledgeSource]);
      expect(
        repository.listSourceUrls(
          "KNOWLEDGE",
          publicationSourceLinkFixtureIds.fallbackKnowledge,
        ),
      ).toEqual([publicationSourceLinkFixtureUrls.knowledgeFallback]);
      expect(
        repository.listSourceUrls(
          "KNOWLEDGE",
          publicationSourceLinkFixtureIds.contentOnlyKnowledge,
        ),
      ).toEqual([publicationSourceLinkFixtureUrls.knowledgeContentOnly]);
      expect(
        repository.listSourceUrls("KNOWLEDGE", "missing-knowledge"),
      ).toEqual([]);
    });
  });

  it("SOURCE_LINK_DTO returns only a readonly string array with no SQL row or private fields", () => {
    withSourceLinkDatabase((repository) => {
      const arrays = [
        repository.listSourceUrls(
          "EVENT",
          publicationSourceLinkFixtureIds.event,
        ),
        repository.listSourceUrls(
          "EVENT_UPDATE",
          publicationSourceLinkFixtureIds.update,
        ),
        repository.listSourceUrls(
          "KNOWLEDGE",
          publicationSourceLinkFixtureIds.knowledge,
        ),
      ];

      for (const urls of arrays) {
        expect(Array.isArray(urls)).toBe(true);
        expect(urls.every((url) => typeof url === "string")).toBe(true);
        expect(JSON.stringify(urls)).not.toContain("raw_data");
        expect(JSON.stringify(urls)).not.toContain("content_id");
        expect(JSON.stringify(urls)).not.toContain("discovered_at");
      }
    });
  });
});
