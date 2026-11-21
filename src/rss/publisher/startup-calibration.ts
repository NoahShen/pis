import type { RssPublicationNotifier } from "./notifier.js";

export async function calibrateRssPublication(
  notifier: RssPublicationNotifier,
): Promise<void> {
  await notifier.notify("EVENT_UPDATES");
  await notifier.notify("CURATED_CONTENT");
}
