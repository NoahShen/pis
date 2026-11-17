import type { SourceEntry } from "../../src/adapters/contracts.js";

export const ARTICLE_URL = "https://articles.example.test/story";

export function sourceEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    source_id: "source-1",
    external_id: "entry-1",
    url: ARTICLE_URL,
    title: "Fixture story",
    author: "Fixture author",
    published_at: "2026-01-01T08:00:00.000+08:00",
    full_body: null,
    summary: null,
    ...overrides,
  };
}

export function articleHtml({
  restricted = false,
  signal = "json-ld",
  short = false,
  unreadable = false,
}: {
  restricted?: boolean;
  signal?: "json-ld" | "json-ld-object" | "itemprop" | "invalid";
  short?: boolean;
  unreadable?: boolean;
} = {}): string {
  if (unreadable) {
    return "<html><head></head><body></body></html>";
  }
  const paragraph = short
    ? "<p>Too short.</p>"
    : `<p>${"A complete paragraph contains substantial article evidence with context and detail. ".repeat(3)}</p><p>A second paragraph proves that paragraph boundaries remain visible after extraction.</p>`;
  const restriction =
    restricted && signal === "json-ld"
      ? '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","isAccessibleForFree":false}]}</script>'
      : restricted && signal === "json-ld-object"
        ? '<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}</script>'
        : restricted && signal === "itemprop"
          ? '<div itemprop="isAccessibleForFree" content="false"></div>'
          : restricted && signal === "invalid"
            ? '<script type="application/ld+json">{not valid json</script>'
            : "";
  return `<!doctype html><html><head>${restriction}<script>globalThis.mutated = true</script><style>.hidden { display:none }</style><link rel="stylesheet" href="https://assets.example.test/site.css"></head><body><nav>Navigation links</nav><header>Site header</header><main><article><h1>Fixture story</h1>${paragraph}</article></main><footer>Footer</footer><form>Form</form><img src="https://images.example.test/photo.jpg" alt="image"></body></html>`;
}
