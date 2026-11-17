import { describe, expect, it } from "vitest";

import type { SourceAdapter } from "../../src/adapters/contracts.js";
import { createSourceAdapterRegistry } from "../../src/collection/adapter-registry.js";
import { CollectionError } from "../../src/collection/collection-errors.js";

const adapter: SourceAdapter = {
  async fetchEntries() {
    return [];
  },
  async fetchContent() {
    throw new Error("not used by this test");
  },
};

describe("SourceAdapterRegistry", () => {
  it("returns the registered adapter only for an exact Source.type", () => {
    const registry = createSourceAdapterRegistry(
      new Map<string, SourceAdapter>([["RSS", adapter]]),
    );

    expect(registry.get("RSS")).toBe(adapter);
    expect(() => registry.get("rss")).toThrowError(CollectionError);
    expect(() => registry.get("ATOM")).toThrowError(CollectionError);
  });

  it("uses the fixed unsupported_source error without leaking the requested type", () => {
    const registry = createSourceAdapterRegistry(new Map());
    const requestedType = "PRIVATE_SOURCE?token=secret";

    let error: unknown;
    try {
      registry.get(requestedType);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CollectionError);
    expect(error).toMatchObject({
      code: "unsupported_source",
      message: "The source adapter is not registered",
    });
    expect((error as Error).message).not.toContain(requestedType);
  });
});
