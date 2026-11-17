export const RSS_FIXTURE_URL = "https://feeds.example.test/news.xml";

export function rssFeed(items: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel><title>Fixture</title>${items}</channel>
</rss>`;
}

export function atomFeed(entries: string, namespaces = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:xhtml="http://www.w3.org/1999/xhtml" ${namespaces}>${entries}</feed>`;
}
