import { validate as validateCron } from "node-cron";
import { z } from "zod";

export type SourceType = "RSS";
export type ConfigurationInputErrorCode = "invalid_configuration_input";

export class ConfigurationInputError extends Error {
  readonly code: ConfigurationInputErrorCode = "invalid_configuration_input";

  constructor() {
    super("Invalid configuration input");
    this.name = "ConfigurationInputError";
  }
}

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  cron: string;
  enabled: boolean;
  description: string | null;
  last_collected_at: string | null;
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface SourceCreateInput {
  name: string;
  type: SourceType;
  url: string;
  cron: string;
  enabled?: boolean;
  description?: string | null;
}

interface SourceUpdateFields {
  name?: string;
  cron?: string;
  enabled?: boolean;
  description?: string | null;
}

type AtLeastOneDefined<T> = {
  [K in keyof T]-?: { [P in K]-?: Exclude<T[P], undefined> } & {
    [P in Exclude<keyof T, K>]?: T[P];
  };
}[keyof T];

export type SourceUpdateInput = AtLeastOneDefined<SourceUpdateFields>;

export interface TopicCreateInput {
  name: string;
  description: string;
  enabled?: boolean;
}

interface TopicUpdateFields {
  name?: string;
  description?: string;
  enabled?: boolean;
}

export type TopicUpdateInput = AtLeastOneDefined<TopicUpdateFields>;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const HTTP_SCHEME_PREFIX = /^https?:\/\/[^/?#]+/iu;
const CRON_FIELD_COUNT_PATTERN = /\s+/u;

const nonBlankString = z.string().refine((value) => value.trim().length > 0);
const optionalNullableString = z.string().nullable().optional();

function hasAuthorityAtSign(value: string): boolean {
  const authorityStart = value.indexOf("://") + 3;
  const authorityAndPath = value.slice(authorityStart);
  const authorityEnd = authorityAndPath.search(/[/?#]/u);
  const authority =
    authorityEnd === -1
      ? authorityAndPath
      : authorityAndPath.slice(0, authorityEnd);

  return authority.includes("@");
}

function isValidSourceUrl(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !HTTP_SCHEME_PREFIX.test(value) ||
    value.includes("#") ||
    hasAuthorityAtSign(value)
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.host.length > 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function isValidCron(value: string): boolean {
  if (value.trim().length === 0) {
    return false;
  }

  const fieldCount = value.trim().split(CRON_FIELD_COUNT_PATTERN).length;
  return (fieldCount === 5 || fieldCount === 6) && validateCron(value);
}

const sourceUrl = z.string().refine(isValidSourceUrl);
const sourceCron = z.string().refine(isValidCron);
const sourceType = z.literal("RSS");

function hasDefinedField(value: object): boolean {
  return Object.values(value).some((field) => field !== undefined);
}

function removeUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

const sourceCreateSchema = z
  .object({
    name: nonBlankString,
    type: sourceType,
    url: sourceUrl,
    cron: sourceCron,
    enabled: z.boolean().default(true),
    description: optionalNullableString,
  })
  .strict();

const sourceUpdateSchema = z
  .object({
    name: nonBlankString.optional(),
    cron: sourceCron.optional(),
    enabled: z.boolean().optional(),
    description: optionalNullableString,
  })
  .strict()
  .refine(hasDefinedField)
  .transform((value) => removeUndefinedFields(value) as SourceUpdateInput);

const topicCreateSchema = z
  .object({
    name: nonBlankString,
    description: nonBlankString,
    enabled: z.boolean().default(true),
  })
  .strict();

const topicUpdateSchema = z
  .object({
    name: nonBlankString.optional(),
    description: nonBlankString.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(hasDefinedField)
  .transform((value) => removeUndefinedFields(value) as TopicUpdateInput);

function parseConfiguration<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ConfigurationInputError();
  }

  return result.data;
}

export function parseSourceCreate(value: unknown): SourceCreateInput {
  return parseConfiguration(sourceCreateSchema, value);
}

export function parseSourceUpdate(value: unknown): SourceUpdateInput {
  return parseConfiguration(sourceUpdateSchema, value);
}

export function parseTopicCreate(value: unknown): TopicCreateInput {
  return parseConfiguration(topicCreateSchema, value);
}

export function parseTopicUpdate(value: unknown): TopicUpdateInput {
  return parseConfiguration(topicUpdateSchema, value);
}
