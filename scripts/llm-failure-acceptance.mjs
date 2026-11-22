#!/usr/bin/env node
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_KEYS = ["PIS_LLM_ENDPOINT", "PIS_LLM_API_KEY", "PIS_LLM_MODEL"];
const OPERATIONS = [
  "processing-route",
  "event-search",
  "event-analysis",
  "knowledge-analysis",
  "topic-matching",
];
const REAL_MAX_CALLS = 5;
const REAL_TASK_DATA = Object.freeze({
  acceptance_id: "OPS-01-T03",
  content: "A minimal deterministic acceptance fixture.",
});

export function parseArguments(argv) {
  let selfTest = false;
  let envFile;
  let output;
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
      (argument === "--env-file" && envFile === undefined) ||
      (argument === "--output" && output === undefined) ||
      (argument === "--env-file" && envFile.startsWith("--")) ||
      (argument === "--output" && output.startsWith("--"))
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

function safeError(error) {
  return {
    operation: null,
    category: "harness",
    reason: "ACCEPTANCE_HARNESS_ERROR",
    retryable: false,
    final: true,
    ...(typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    typeof error.reason === "string" &&
    /^[A-Z][A-Z0-9_]*$/u.test(error.reason)
      ? { reason: error.reason }
      : {}),
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
    throw new Error("Credential-free HTTPS endpoint required");
  return {
    endpoint: env.PIS_LLM_ENDPOINT,
    apiKey: env.PIS_LLM_API_KEY,
    model: env.PIS_LLM_MODEL,
    timeoutMs: 60_000,
    maxResponseBytes: 1_048_576,
  };
}

function summary(error, operation) {
  return {
    operation,
    category: error?.llmFailure?.category ?? "harness",
    reason: error?.llmFailure?.reason ?? "ACCEPTANCE_HARNESS_ERROR",
    ...(Number.isInteger(error?.llmFailure?.httpStatus)
      ? { httpStatus: error.llmFailure.httpStatus }
      : {}),
    attempt: 1,
    final: true,
    count: 1,
  };
}

function businessError(components, operation, cause) {
  const ErrorType = {
    "processing-route": components.ProcessingError,
    "event-search": components.EventSearchError,
    "event-analysis": components.EventAnalysisError,
    "knowledge-analysis": components.KnowledgeError,
    "topic-matching": components.TopicMatchingError,
  }[operation];
  return new ErrorType(
    "llm_failed",
    components.summarizeLlmFailure(cause, operation),
  );
}

function invoke(calls, method) {
  if (method === "analyzeEvents")
    return calls.analyzeEvents(REAL_TASK_DATA, {
      candidateEventIds: [],
      eventIdByUpdateId: {},
    });
  if (method === "matchTopics")
    return calls.matchTopics(REAL_TASK_DATA, { enabledTopicIds: [] });
  return calls[method](REAL_TASK_DATA);
}

function runtimeTask(operation) {
  if (operation === "processing-route")
    return { type: "PROCESS", source_item_id: "acceptance-source-item" };
  if (operation === "event-search" || operation === "event-analysis")
    return { type: "EVENT_ANALYSIS", content_id: "acceptance-content" };
  if (operation === "knowledge-analysis")
    return { type: "KNOWLEDGE_ANALYSIS", content_id: "acceptance-content" };
  return {
    type: "TOPIC_MATCHING",
    target_type: "EVENT",
    target_id: "acceptance-target",
  };
}

export async function verifyRuntimeMatrix(components) {
  const results = [];
  const scenarios = [
    ["network", "LLM_NETWORK_ERROR", true, undefined],
    ["timeout", "LLM_TIMEOUT", true, undefined],
    ["http", "LLM_HTTP_ERROR", true, 429],
    ["http", "LLM_HTTP_ERROR", true, 503],
    ["http", "LLM_HTTP_ERROR", false, 400],
    ["response_protocol", "LLM_RESPONSE_MALFORMED", true, undefined],
    ["response_protocol", "LLM_CONTENT_EMPTY", true, undefined],
    ["response_protocol", "LLM_FINISH_REASON_INVALID", true, undefined],
    ["response_protocol", "LLM_OUTPUT_TRUNCATED", true, undefined],
    ["response_protocol", "LLM_REFUSAL", false, undefined],
    ["response_protocol", "LLM_TOOL_CALL_UNEXPECTED", false, undefined],
    ["response_size", "LLM_RESPONSE_TOO_LARGE", false, undefined],
    ["output_validation", "LLM_OUTPUT_JSON_INVALID", true, undefined],
    ["output_validation", "LLM_OUTPUT_SCHEMA_INVALID", true, undefined],
    ["output_validation", "LLM_OUTPUT_REFERENCE_INVALID", true, undefined],
    ["output_validation", "LLM_OUTPUT_CONFLICT", true, undefined],
  ];
  for (const operation of OPERATIONS) {
    for (const [category, reason, retryable, httpStatus] of scenarios) {
      const logs = [];
      let count = 0;
      const services = {
        collect: async () => ({ source_item_ids: [] }),
        process: async () => {
          throw businessError(
            components,
            operation,
            makeCause(components, category, reason, httpStatus),
          );
        },
        analyzeEvent: async () => {
          throw businessError(
            components,
            operation,
            makeCause(components, category, reason, httpStatus),
          );
        },
        analyzeKnowledge: async () => {
          throw businessError(
            components,
            operation,
            makeCause(components, category, reason, httpStatus),
          );
        },
        matchTopics: async () => {
          throw businessError(
            components,
            operation,
            makeCause(components, category, reason, httpStatus),
          );
        },
        publish: async () => ({ published_item_id: null }),
      };
      const wrapped = Object.fromEntries(
        Object.entries(services).map(([name, service]) => [
          name,
          async (...args) => {
            count += 1;
            return service(...args);
          },
        ]),
      );
      const runtime = components.createRuntime({
        services: wrapped,
        logger: { log: (entry) => logs.push(entry) },
      });
      await runtime.submit(runtimeTask(operation));
      await runtime.start();
      await runtime.drain();
      await runtime.shutdown();
      const expectedCount = retryable ? 2 : 1;
      if (
        count !== expectedCount ||
        logs.length !== expectedCount ||
        logs.some(
          (entry) =>
            entry.operation !== operation ||
            entry.category !== category ||
            entry.reason !== reason ||
            entry.attempt < 1 ||
            entry.final !== (entry.attempt === expectedCount) ||
            (httpStatus === undefined
              ? entry.httpStatus !== undefined
              : entry.httpStatus !== httpStatus),
        )
      )
        throw new Error("Runtime failure matrix assertion failed");
      results.push({
        operation,
        category,
        reason,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        attempt: expectedCount,
        final: true,
        count,
      });
    }
  }
  return results;
}

function makeCause(components, category, reason, httpStatus) {
  if (category === "output_validation")
    return new components.LlmOutputValidationError(reason);
  const code =
    category === "response_protocol" ? "LLM_RESPONSE_PROTOCOL_ERROR" : reason;
  return new components.ChatCompletionsError(code, httpStatus, reason);
}

export async function runSelfTest(components) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pis-llm-failure-self-test-"),
  );
  const outputPath = path.join(directory, "safe.json");
  const rawPath = `${outputPath}.raw.jsonl`;
  try {
    await writeFile(rawPath, "", { mode: 0o600 });
    const calls = components.createTypedLlmCalls({
      prompts: {
        load: async () => ({
          instructions: "Acceptance fixture",
          userContext: null,
        }),
      },
      completionClient: {
        complete: async () => {
          await appendFile(
            rawPath,
            `${JSON.stringify({ request: "PRIVATE_PROMPT", response: "PRIVATE_RESPONSE" })}\n`,
            { mode: 0o600 },
          );
          throw new components.ChatCompletionsError(
            "LLM_RESPONSE_PROTOCOL_ERROR",
            undefined,
            "LLM_CONTENT_EMPTY",
          );
        },
      },
    });
    const results = [];
    for (const [operation, method] of [
      ["processing-route", "routeProcessing"],
      ["event-search", "searchEvents"],
      ["event-analysis", "analyzeEvents"],
      ["knowledge-analysis", "analyzeKnowledge"],
      ["topic-matching", "matchTopics"],
    ]) {
      try {
        await invoke(calls, method);
        throw new Error("Self-test unexpectedly succeeded");
      } catch (error) {
        results.push(summary(error, operation));
      }
    }
    const runtime = await verifyRuntimeMatrix(components);
    const report = {
      mode: "self-test",
      modelExecuted: false,
      network: false,
      results,
      runtime,
    };
    await writeFile(outputPath, JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    await chmod(outputPath, 0o600);
    return {
      ...report,
      output: outputPath,
      raw: rawPath,
      count: results.length + runtime.length,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function completionResponse(content, overrides = {}) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content }, ...overrides }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export async function runFaultInjection(components, onRaw = async () => {}) {
  const scenarios = [
    ["event-analysis", "analyzeEvents", "{not-json", {}],
    ["knowledge-analysis", "analyzeKnowledge", "```json\n{}\n```", {}],
    ["topic-matching", "matchTopics", null, {}],
    [
      "processing-route",
      "routeProcessing",
      null,
      { tool_calls: [{ id: "local-fixture" }] },
    ],
  ];
  const results = [];
  for (const [operation, method, content, overrides] of scenarios) {
    const injectedClient = components.createChatCompletionsClient(
      {
        endpoint: "https://local-injection.invalid/v1/chat/completions",
        apiKey: "local-controlled-fixture",
        model: "local-controlled-fixture",
      },
      {
        fetch: async () => {
          const response = completionResponse(content, overrides);
          await onRaw({ operation, response: await response.clone().text() });
          return response;
        },
      },
    );
    const calls = components.createTypedLlmCalls({
      prompts: {
        load: async () => ({
          instructions: "Acceptance fixture",
          userContext: null,
        }),
      },
      completionClient: injectedClient,
    });
    try {
      await invoke(calls, method);
      results.push({
        operation,
        category: "success",
        reason: "LLM_CALL_SUCCEEDED",
        attempt: 1,
        final: true,
        count: 1,
      });
    } catch (error) {
      results.push(summary(error, operation));
    }
  }
  return results;
}

async function executeReal(components, config, outputPath) {
  const rawPath = `${outputPath}.raw.jsonl`;
  validatePrivatePath(rawPath);
  await writeFile(rawPath, "", { mode: 0o600 });
  let callsMade = 0;
  let currentOperation;
  const raw = async (entry) => {
    await appendFile(rawPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    await chmod(rawPath, 0o600);
  };
  const client = components.createChatCompletionsClient(config, {
    fetch: async (url, init) => {
      const response = await globalThis.fetch(url, init);
      await raw({
        operation: currentOperation,
        response: await response.clone().text(),
      });
      return response;
    },
  });
  const calls = components.createTypedLlmCalls({
    prompts: new components.PromptRepository(path.join(ROOT, "config/prompts")),
    completionClient: client,
  });
  const results = [];
  for (const [operation, method] of [
    ["processing-route", "routeProcessing"],
    ["event-search", "searchEvents"],
    ["event-analysis", "analyzeEvents"],
    ["knowledge-analysis", "analyzeKnowledge"],
    ["topic-matching", "matchTopics"],
  ]) {
    currentOperation = operation;
    try {
      callsMade += 1;
      if (callsMade > OPERATIONS.length)
        throw new Error("Real call budget exceeded");
      const response = await invoke(calls, method);
      await raw({ operation, response });
      results.push({
        operation,
        category: "success",
        reason: "LLM_CALL_SUCCEEDED",
        attempt: 1,
        final: true,
        count: 1,
      });
    } catch (error) {
      await raw({ operation, error: String(error) });
      results.push(summary(error, operation));
    }
  }
  const report = { mode: "real", modelExecuted: true, results };
  const injected = await runFaultInjection(components, raw);
  report.injected = {
    mode: "local",
    modelExecuted: false,
    network: false,
    results: injected,
  };
  await writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  await chmod(outputPath, 0o600);
  return { count: results.length, calls: callsMade, results };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.selfTest) {
    const result = await runSelfTest(await loadComponents());
    console.log(
      JSON.stringify({
        mode: "self-test",
        modelExecuted: false,
        network: false,
        count: result.count,
        verdict: "PASS",
      }),
    );
    return;
  }
  const envPath = validatePrivatePath(options.envFile);
  const outputPath = validatePrivatePath(options.output);
  const config = validateCredentials({
    ...process.env,
    ...parseEnvironment(await readFile(envPath, "utf8")),
  });
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const result = await executeReal(await loadComponents(), config, outputPath);
  console.log(
    JSON.stringify({
      mode: "real",
      count: result.count,
      calls: result.calls,
      verdict: "COMPLETE",
    }),
  );
}

export async function loadComponents() {
  const distUrl = (file) => pathToFileURL(path.join(ROOT, "dist", file)).href;
  const modules = await Promise.all([
    import(distUrl("prompt/prompt-repository.js")),
    import(distUrl("llm/llm-calls.js")),
    import(distUrl("llm/chat-completions-client.js")),
    import(distUrl("llm/response-validators.js")),
    import(distUrl("processing/processing-errors.js")),
    import(distUrl("event-search/event-search-errors.js")),
    import(distUrl("event-analysis/event-analysis-errors.js")),
    import(distUrl("knowledge/knowledge-errors.js")),
    import(distUrl("topic-matching/topic-matching-errors.js")),
    import(distUrl("runtime/runtime.js")),
    import(distUrl("llm/failure-summary.js")),
  ]);
  return Object.assign({}, ...modules);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(JSON.stringify(safeError(error)));
    process.exitCode = 1;
  });
