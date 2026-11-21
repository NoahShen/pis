#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SEMANTIC_CASES,
  SYNTHETIC_USER_CONTEXT,
  semanticSummaryLabel,
} from "./semantic-regression-fixtures.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LIMITS = Object.freeze({
  timeoutMs: 120_000,
  maxCalls: 64,
  maxResponseBytes: 1_048_576,
});
const ENV_KEYS = ["PIS_LLM_ENDPOINT", "PIS_LLM_API_KEY", "PIS_LLM_MODEL"];
const SAFE_ERROR_CODES = new Set([
  "LLM_OUTPUT_JSON_INVALID",
  "LLM_OUTPUT_SCHEMA_INVALID",
  "LLM_OUTPUT_REFERENCE_INVALID",
  "LLM_OUTPUT_CONFLICT",
  "LLM_TIMEOUT",
  "LLM_CANCELLED",
  "LLM_HTTP_ERROR",
  "LLM_PROTOCOL_INVALID",
  "PROMPT_FILE_MISSING",
  "PROMPT_FILE_UNREADABLE",
  "PROMPT_CONTENT_EMPTY",
]);

export function parseArguments(argv) {
  let envFile,
    output,
    selfTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") selfTest = true;
    else if (argument === "--env-file") envFile = argv[++index];
    else if (argument === "--output") output = argv[++index];
    else
      throw new Error(
        "Usage: --self-test OR --env-file PRIVATE_PATH --output PRIVATE_PATH",
      );
    if (
      (argument === "--env-file" &&
        (envFile === undefined || envFile.startsWith("--"))) ||
      (argument === "--output" &&
        (output === undefined || output.startsWith("--")))
    )
      throw new Error("Missing option value");
  }
  if (
    selfTest
      ? envFile !== undefined || output !== undefined
      : envFile === undefined || output === undefined
  )
    throw new Error(
      "Usage: --self-test OR --env-file PRIVATE_PATH --output PRIVATE_PATH",
    );
  return { selfTest, envFile, output };
}

export function parseEnvironment(text) {
  const values = {};
  for (const [index, source] of text.split(/\r?\n/u).entries()) {
    const line = source.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error(`Invalid env syntax at line ${index + 1}`);
    let value = match[2];
    if (/^['"]/u.test(value)) {
      const quote = value[0];
      if (value.length < 2 || !value.endsWith(quote))
        throw new Error(`Invalid env quoting at line ${index + 1}`);
      value = value.slice(1, -1);
      if (quote === "'" && value.includes("'"))
        throw new Error(`Invalid env quoting at line ${index + 1}`);
    } else if (/\s#/u.test(value)) value = value.split(/\s#/u)[0].trimEnd();
    if (match[1] in values)
      throw new Error(`Duplicate env key at line ${index + 1}`);
    values[match[1]] = value;
  }
  return values;
}

export function validatePrivatePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error("Private paths must be absolute");
  const normalized = path.resolve(value);
  const relative = path.relative(ROOT, normalized);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error("Private paths must be outside the repository");
  return normalized;
}

export function safeError(error) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    SAFE_ERROR_CODES.has(error.code)
      ? error.code
      : undefined;
  return {
    category:
      typeof error === "object" &&
      error !== null &&
      "category" in error &&
      typeof error.category === "string"
        ? error.category
        : "harness",
    code: code ?? "UNCLASSIFIED_ERROR",
  };
}

function validateCredentials(env) {
  for (const key of ENV_KEYS)
    if (typeof env[key] !== "string" || env[key].length === 0)
      throw new Error("Explicit LLM environment is incomplete");
  let endpoint;
  try {
    endpoint = new URL(env.PIS_LLM_ENDPOINT);
  } catch {
    throw new Error("Invalid LLM endpoint");
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error(
      "LLM endpoint must be credential-free HTTPS without query or fragment",
    );
  return {
    endpoint: env.PIS_LLM_ENDPOINT,
    apiKey: env.PIS_LLM_API_KEY,
    model: env.PIS_LLM_MODEL,
    timeoutMs: LIMITS.timeoutMs,
    maxResponseBytes: LIMITS.maxResponseBytes,
  };
}

function invoke(calls, testCase) {
  if (testCase.operation === "analyzeEvents")
    return calls.analyzeEvents(testCase.taskData, testCase.references);
  if (testCase.operation === "matchTopics")
    return calls.matchTopics(testCase.taskData, testCase.references);
  return calls[testCase.operation](testCase.taskData);
}

async function verifyStorage(calls, testCase, output, database, components) {
  const contentId = `semantic-${testCase.id}-${database.prepare("SELECT count(*) AS count FROM event_entity_aliases").get().count}`;
  if (testCase.id === "EVT-20") {
    try {
      components.parseLlmResponse(
        "event-analysis",
        JSON.stringify({
          results: [
            {
              action: "NEW_UPDATE",
              event_id: "NOT-A-CANDIDATE",
              title: "Synthetic",
              description: "Synthetic",
              confirmed_aliases: [],
            },
          ],
        }),
        { candidateEventIds: ["E-GPT"], eventIdByUpdateId: { "U-1": "E-GPT" } },
      );
    } catch (error) {
      return {
        assertion: "P03_ILLEGAL_CANDIDATE_REJECTED",
        passed: true,
        parserError: safeError(error),
      };
    }
    throw new Error("Illegal Event candidate was accepted");
  }
  if (testCase.storageCheck === "search-terms") {
    const terms = output.clues.flatMap((clue) => clue.search_terms);
    const before = database
      .prepare("SELECT count(*) AS count FROM event_entity_aliases")
      .get().count;
    // P-02 returns retrieval clues only. There is intentionally no alias persistence call.
    if (
      database
        .prepare("SELECT count(*) AS count FROM event_entity_aliases")
        .get().count !== before
    )
      throw new Error("Search terms reached alias storage");
    return {
      assertion: "P02_SEARCH_TERMS_NOT_ALIASES",
      passed: true,
      termCount: terms.length,
    };
  }
  if (testCase.storageCheck !== "aliases") return undefined;
  const result = output.results[0];
  if (!result) throw new Error("Alias storage assertion needs an Event result");
  const idGenerator = { next: () => `semantic-generated-${testCase.id}` };
  const clock = { now: () => new Date("2026-11-21T00:00:00Z") };
  const persistence = new components.EventDecisionPersistence({
    database,
    eventRepository: new components.SqliteEventRepository(database),
    idGenerator,
    clock,
  });
  database.transaction(() => {
    // Evidence and aliases reference a real Content; keep the complete minimal
    // Source -> SourceItem -> Content chain in the same assertion transaction.
    database
      .prepare(
        "INSERT INTO sources (id, name, type, url, cron, enabled) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        `semantic-source-${testCase.id}`,
        "Synthetic semantic source",
        "RSS",
        `https://semantic.invalid/${testCase.id}/feed.xml`,
        "0 * * * *",
        1,
      );
    database
      .prepare(
        "INSERT INTO contents (id, title, created_at, body, completeness) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        contentId,
        "Synthetic semantic content",
        "2026-11-21T00:00:00.000+08:00",
        "Synthetic content used only for storage assertions.",
        "FULL",
      );
    database
      .prepare(
        "INSERT INTO source_items (id, source_id, discovered_at, content_id) VALUES (?, ?, ?, ?)",
      )
      .run(
        `semantic-source-item-${testCase.id}`,
        `semantic-source-${testCase.id}`,
        "2026-11-21T00:00:00.000+08:00",
        contentId,
      );
    persistence.apply(contentId, result);
  })();
  const stored = database
    .prepare(
      "SELECT alias FROM event_entity_aliases WHERE content_id = ? ORDER BY alias",
    )
    .all(contentId)
    .map((row) => row.alias);
  const expected = [...new Set(result.confirmed_aliases)].sort();
  if (JSON.stringify(stored) !== JSON.stringify(expected))
    throw new Error("Stored aliases differ from typed model aliases");
  if (result.confirmed_aliases.includes("AcmeChat"))
    throw new Error("Product was stored as a company alias");
  return {
    assertion: "P03_DIRECT_TYPED_ALIAS_STORAGE",
    passed: true,
    aliasCount: stored.length,
  };
}

async function promptHashes(directory) {
  const hashes = {};
  for (const file of [
    "processing-route.md",
    "event-search.md",
    "event-analysis.md",
    "knowledge-analysis.md",
    "topic-matching.md",
    "user-context.md",
  ])
    hashes[file] = createHash("sha256")
      .update(await readFile(path.join(directory, file)))
      .digest("hex");
  return hashes;
}

async function preparePrompts(tempDirectory) {
  const directory = path.join(tempDirectory, "prompts");
  await mkdir(directory, { mode: 0o700 });
  for (const file of [
    "processing-route.md",
    "event-search.md",
    "event-analysis.md",
    "knowledge-analysis.md",
    "topic-matching.md",
  ])
    await writeFile(
      path.join(directory, file),
      await readFile(path.join(ROOT, "config/prompts", file)),
      { mode: 0o600 },
    );
  await writeFile(
    path.join(directory, "user-context.md"),
    SYNTHETIC_USER_CONTEXT,
    { mode: 0o600 },
  );
  return directory;
}

export async function executeSemanticCases({
  calls,
  testCases,
  database,
  components,
  onRaw,
  getRawContent,
}) {
  const results = [];
  let callsAttempted = 0;
  for (const testCase of testCases) {
    for (let round = 1; round <= testCase.repeat; round += 1) {
      if (callsAttempted >= LIMITS.maxCalls)
        throw new Error("Call budget exceeded");
      callsAttempted += 1;
      const started = Date.now();
      try {
        const output = await invoke(calls, testCase);
        await onRaw({
          caseId: testCase.id,
          round,
          response: output,
          ...(getRawContent ? { rawContent: getRawContent() } : {}),
        });
        const passed = testCase.judge(output);
        const storage = database
          ? await verifyStorage(calls, testCase, output, database, components)
          : undefined;
        results.push({
          caseId: testCase.id,
          round,
          expected: String(testCase.expected),
          actual: semanticSummaryLabel(testCase, output),
          verdict: passed ? "PASS" : "FAIL",
          reason: passed
            ? "Meets fixed semantic predicate"
            : "Does not meet fixed semantic predicate",
          retries: 0,
          formatErrors: 0,
          durationMs: Date.now() - started,
          ...(storage ? { storage } : {}),
        });
      } catch (error) {
        await onRaw({
          caseId: testCase.id,
          round,
          ...(getRawContent ? { rawContent: getRawContent() } : {}),
          error: safeError(error),
        });
        results.push({
          caseId: testCase.id,
          round,
          expected: String(testCase.expected),
          actual: "unavailable",
          verdict: "ERROR",
          reason: "Typed call or storage assertion failed",
          retries: 0,
          formatErrors: 1,
          durationMs: Date.now() - started,
          error: safeError(error),
        });
      }
    }
  }
  return { callsAttempted, results };
}

export async function runSelfTest(dependencies) {
  const tempDirectory = await mkdtemp(
    path.join((await import("node:os")).tmpdir(), "pis-semantic-self-test-"),
  );
  try {
    const prompts = await preparePrompts(tempDirectory);
    const raw = [];
    let callsMade = 0;
    const queued = SEMANTIC_CASES.flatMap((item) =>
      Array.from({ length: item.repeat }, () => item),
    );
    const operations = [];
    const calls = dependencies.createTypedLlmCalls({
      prompts: new dependencies.PromptRepository(prompts),
      completionClient: {
        complete: async (request) => {
          if (callsMade >= queued.length || callsMade >= LIMITS.maxCalls)
            throw new Error("Call budget exceeded");
          const current = queued[callsMade++];
          const promptName = request.systemContent.match(
            /^## Function Instructions\n\n# .*\((P-0\d)\)/mu,
          )?.[1];
          const expectedPrompt = {
            routeProcessing: "P-01",
            searchEvents: "P-02",
            analyzeEvents: "P-03",
            analyzeKnowledge: "P-04",
            matchTopics: "P-05",
          }[current.operation];
          if (
            promptName !== expectedPrompt ||
            request.userContent !==
              JSON.stringify(
                current.operation === "analyzeKnowledge"
                  ? {
                      task_data: current.taskData,
                      user_context: SYNTHETIC_USER_CONTEXT,
                    }
                  : { task_data: current.taskData },
              )
          )
            throw new Error("Self-test operation/input mismatch");
          operations.push(current.operation);
          return JSON.stringify(current.selfTestResponse);
        },
      },
    });
    const outcome = await executeSemanticCases({
      calls,
      testCases: SEMANTIC_CASES,
      onRaw: async (entry) => raw.push(entry),
    });
    if (
      outcome.results.some((result) => result.verdict !== "PASS") ||
      raw.length !== queued.length ||
      JSON.stringify(operations) !==
        JSON.stringify(queued.map((item) => item.operation))
    )
      throw new Error("Offline semantic self-test failed");
    return outcome;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [promptsModule, callsModule, clientModule] = await Promise.all([
    import("../dist/prompt/prompt-repository.js"),
    import("../dist/llm/llm-calls.js"),
    import("../dist/llm/chat-completions-client.js"),
  ]);
  if (options.selfTest) {
    const outcome = await runSelfTest({ ...promptsModule, ...callsModule });
    console.log(
      JSON.stringify({
        mode: "self-test",
        modelExecuted: false,
        network: false,
        calls: outcome.callsAttempted,
        passed: outcome.results.length,
        verdict: "PASS",
      }),
    );
    return;
  }
  const envPath = validatePrivatePath(options.envFile);
  const outputPath = validatePrivatePath(options.output);
  const env = {
    ...process.env,
    ...parseEnvironment(await readFile(envPath, "utf8")),
  };
  const config = validateCredentials(env);
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const tempDirectory = await mkdtemp(
    path.join(outputDirectory, ".semantic-regression-"),
  );
  let database;
  try {
    const [
      databaseModule,
      schemaModule,
      repositoryModule,
      persistenceModule,
      validatorsModule,
    ] = await Promise.all([
      import("../dist/database/open-database.js"),
      import("../dist/database/schema.js"),
      import("../dist/event-analysis/event-repository.js"),
      import("../dist/event-analysis/event-decision-persistence.js"),
      import("../dist/llm/response-validators.js"),
    ]);
    const prompts = await preparePrompts(tempDirectory);
    const hashes = await promptHashes(prompts);
    database = databaseModule.openDatabase(
      path.join(tempDirectory, "assertions.sqlite"),
    );
    schemaModule.initializeDatabase(database);
    const client = clientModule.createChatCompletionsClient(config);
    let rawContent;
    const calls = callsModule.createTypedLlmCalls({
      prompts: new promptsModule.PromptRepository(prompts),
      completionClient: {
        complete: async (request) => {
          try {
            const rawText = await client.complete(request);
            rawContent = rawText;
            return rawText;
          } catch (error) {
            rawContent = undefined;
            throw error;
          }
        },
      },
    });
    const rawPath = `${outputPath}.raw.jsonl`;
    validatePrivatePath(rawPath);
    await writeFile(rawPath, "", { mode: 0o600 });
    const raw = [];
    const outcome = await executeSemanticCases({
      calls,
      testCases: SEMANTIC_CASES,
      database,
      components: {
        ...repositoryModule,
        ...persistenceModule,
        ...validatorsModule,
      },
      getRawContent: () => rawContent,
      onRaw: async (entry) => {
        raw.push(entry);
        await appendFile(rawPath, `${JSON.stringify(entry)}\n`, {
          mode: 0o600,
        });
      },
    });
    const report = {
      schemaVersion: 1,
      model: config.model,
      endpointCategory: "HTTPS OpenAI-compatible chat completions",
      startedAt: new Date().toISOString(),
      timeoutMs: config.timeoutMs,
      callBudget: LIMITS.maxCalls,
      temperature: "not controlled by TextCompletionClient",
      promptSha256: hashes,
      userContext: "fixed synthetic fixture",
      rawResponseCount: raw.length,
      rawResponses: rawPath,
      ...outcome,
    };
    await writeFile(outputPath, JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    await chmod(outputPath, 0o600);
    console.log(
      JSON.stringify({
        mode: "real",
        model: config.model,
        endpointCategory: report.endpointCategory,
        calls: outcome.callsAttempted,
        passed: outcome.results.filter((result) => result.verdict === "PASS")
          .length,
        failed: outcome.results.filter((result) => result.verdict !== "PASS")
          .length,
      }),
    );
    if (outcome.results.some((result) => result.verdict !== "PASS"))
      process.exitCode = 1;
  } finally {
    database?.close();
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(JSON.stringify({ error: safeError(error) }));
    process.exitCode = 1;
  });
