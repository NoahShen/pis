import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CryptoIdGenerator } from "../../src/id/crypto-id-generator.js";
import { SequenceIdGenerator } from "../fixtures/sequence-id-generator.js";

const deterministicUuid = "123e4567-e89b-42d3-a456-426614174000";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();

  return {
    ...actual,
    randomUUID: vi.fn(() => deterministicUuid),
  };
});

describe("ID generators", () => {
  it("SequenceIdGenerator returns exact sequence, then throws on exhaustion", () => {
    const generator = new SequenceIdGenerator(["item-1", "item-2"]);

    expect(generator.next()).toBe("item-1");
    expect(generator.next()).toBe("item-2");
    expect(() => generator.next()).toThrow(/exhausted after 2 values/);
    expect(() => generator.next()).toThrow(/exhausted after 2 values/);
  });

  it("CryptoIdGenerator delegates to Node randomUUID", () => {
    const generator = new CryptoIdGenerator();

    expect(generator.next()).toBe(deterministicUuid);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
