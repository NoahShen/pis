import type { SourceAdapter } from "../adapters/contracts.js";
import { createRssAdapter } from "../adapters/rss-adapter.js";
import { CollectionError } from "./collection-errors.js";

export interface SourceAdapterRegistry {
  get(type: string): SourceAdapter;
}

export function createSourceAdapterRegistry(
  adapters: ReadonlyMap<string, SourceAdapter>,
): SourceAdapterRegistry {
  const snapshot = new Map(adapters);

  return Object.freeze({
    get(type: string): SourceAdapter {
      const adapter = snapshot.get(type);
      if (adapter === undefined) {
        throw new CollectionError("unsupported_source");
      }

      return adapter;
    },
  });
}

export function createRssAdapterRegistry(): SourceAdapterRegistry {
  return createSourceAdapterRegistry(
    new Map<string, SourceAdapter>([["RSS", createRssAdapter()]]),
  );
}
