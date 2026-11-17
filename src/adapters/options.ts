import { z } from "zod";

export interface AdapterPolicy {
  requestTimeoutMs: number;
  maxRedirects: number;
  feedMaxBytes: number;
  articleMaxBytes: number;
  maxFeedEntries: number;
  articleMinTextChars: number;
}

const policySchema = z
  .object({
    requestTimeoutMs: z.number().int().min(100).max(120_000).default(15_000),
    maxRedirects: z.number().int().min(0).max(5).default(3),
    feedMaxBytes: z.number().int().min(1_024).max(8_388_608).default(2_097_152),
    articleMaxBytes: z
      .number()
      .int()
      .min(1_024)
      .max(16_777_216)
      .default(5_242_880),
    maxFeedEntries: z.number().int().min(1).max(10_000).default(1_000),
    articleMinTextChars: z.number().int().min(1).max(1_000).default(80),
  })
  .strict();

export function parseAdapterPolicy(
  value: unknown = {},
): Readonly<AdapterPolicy> {
  return Object.freeze(policySchema.parse(value));
}

export const DEFAULT_ADAPTER_POLICY: Readonly<AdapterPolicy> =
  parseAdapterPolicy();
