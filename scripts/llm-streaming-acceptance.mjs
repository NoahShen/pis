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
const OPERATIONS = [
  "processing-route",
  "event-search",
  "event-analysis",
  "knowledge-analysis",
  "topic-matching",
];
const SUCCESS = "LLM_CALL_SUCCEEDED";
const SYNTHETIC_INSTRUCTIONS =
  "Process only the autonomous synthetic acceptance task data. Return only JSON matching the supplied output schema.";

export const SYNTHETIC_TASKS = Object.freeze({
  "processing-route": {
    acceptance_id: "OPS-02-T04",
    source_item_id: "synthetic-source-item",
    title: "A synthetic engineering note",
    content: "A small controlled project observed a repeatable result.",
  },
  "event-search": {
    acceptance_id: "OPS-02-T04",
    content_id: "synthetic-content",
    title: "Synthetic project milestone",
    content: "The Synthetic Project completed its controlled milestone.",
  },
  "event-analysis": {
    acceptance_id: "OPS-02-T04",
    content_id: "synthetic-content",
    title: "Synthetic project update",
    content: "The Synthetic Project completed its controlled milestone.",
  },
  "knowledge-analysis": {
    acceptance_id: "OPS-02-T04",
    content_id: "synthetic-content",
    title: "Synthetic measurement note",
    content: "A controlled measurement should have explicit bounds.",
  },
  "topic-matching": {
    acceptance_id: "OPS-02-T04",
    target_type: "EVENT",
    target_id: "synthetic-event",
    title: "Synthetic project milestone",
    description: "A controlled project milestone.",
    enabled_topics: [
      { topic_id: "synthetic-topic", name: "Synthetic engineering" },
    ],
  },
});

const REFERENCES = Object.freeze({
  "processing-route": {},
  "event-search": {},
  "event-analysis": {
    candidateEventIds: ["synthetic-event"],
    eventIdByUpdateId: { "synthetic-update": "synthetic-event" },
  },
  "knowledge-analysis": {},
  "topic-matching": { enabledTopicIds: ["synthetic-topic"] },
});

const VALID_CONTENT = Object.freeze({
  "processing-route": { routes: ["EVENT", "KNOWLEDGE"] },
  "event-search": {
    clues: [
      {
        entity_name: "Synthetic Project",
        subject: "controlled milestone",
        search_terms: ["Synthetic Project", "controlled milestone"],
      },
    ],
  },
  "event-analysis": {
    results: [
      {
        action: "NEW_UPDATE",
        event_id: "synthetic-event",
        title: "Controlled milestone completed",
        description:
          "The synthetic project completed its controlled milestone.",
        confirmed_aliases: [],
      },
    ],
  },
  "knowledge-analysis": { valuable: false },
  "topic-matching": { matched_topic_ids: ["synthetic-topic"] },
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

function safeHarnessError() {
  return {
    operation: null,
    category: "harness",
    reason: "ACCEPTANCE_HARNESS_ERROR",
    attempts: 0,
    final: true,
  };
}

function prompts() {
  return {
    load: async () => ({
      instructions: SYNTHETIC_INSTRUCTIONS,
      userContext: null,
    }),
  };
}

function invoke(calls, operation, signal) {
  const task = structuredClone(SYNTHETIC_TASKS[operation]);
  const references = structuredClone(REFERENCES[operation]);
  const options = signal === undefined ? {} : { signal };
  if (operation === "processing-route")
    return calls.routeProcessing(task, options);
  if (operation === "event-search") return calls.searchEvents(task, options);
  if (operation === "event-analysis")
    return calls.analyzeEvents(task, references, options);
  if (operation === "knowledge-analysis")
    return calls.analyzeKnowledge(task, options);
  return calls.matchTopics(task, references, options);
}

function newObservation() {
  return {
    firstByteMs: null,
    firstContentMs: null,
    streamStates: [],
  };
}

function observer(observation) {
  return ({ streamState, firstByteMs, firstContentMs }) => {
    if (!observation.streamStates.includes(streamState))
      observation.streamStates.push(streamState);
    if (firstByteMs !== undefined && observation.firstByteMs === null)
      observation.firstByteMs = firstByteMs;
    if (firstContentMs !== undefined && observation.firstContentMs === null)
      observation.firstContentMs = firstContentMs;
  };
}

function safeResult(
  operation,
  startedAt,
  attempts,
  observation,
  error,
  components,
) {
  const failed = error !== undefined;
  const failure = failed
    ? components.summarizeLlmFailure(error, operation)
    : {
        category: "success",
        reason: SUCCESS,
        retryable: false,
      };
  return {
    operation,
    category: failure.category,
    reason: failure.reason,
    ...(failure.httpStatus === undefined
      ? {}
      : { httpStatus: failure.httpStatus }),
    outcome: failed ? "failure" : "success",
    attempts,
    final: true,
    durationMs: Date.now() - startedAt,
    firstByteMs: observation.firstByteMs,
    firstContentMs: observation.firstContentMs,
    streamStates: observation.streamStates,
  };
}

async function executeWithRetry(
  components,
  operation,
  calls,
  policy,
  signal,
  sharedObservation,
) {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const observation = sharedObservation ?? newObservation();
    if (signal?.aborted) {
      return safeResult(
        operation,
        startedAt,
        attempt - 1,
        observation,
        new components.ChatCompletionsError("LLM_CANCELLED"),
        components,
      );
    }
    try {
      await invoke(calls, operation, signal);
      return safeResult(
        operation,
        startedAt,
        attempt,
        observation,
        undefined,
        components,
      );
    } catch (error) {
      const result = safeResult(
        operation,
        startedAt,
        attempt,
        observation,
        error,
        components,
      );
      if (policy.maxAttempts === 1) throw error;

      const retryable = components.summarizeLlmFailure(
        error,
        operation,
      ).retryable;
      if (
        signal?.aborted ||
        !retryable ||
        attempt === policy.maxAttempts ||
        Date.now() - startedAt + policy.retryDelayMs >=
          policy.retryTotalBudgetMs
      )
        return result;
      if (
        !(await components.waitForRetryDelay(
          policy.retryDelayMs,
          signal ?? new AbortController().signal,
        ))
      )
        return result;
    }
  }
  throw new Error("Unreachable retry state");
}

export async function writePrivateJson(outputPath, value) {
  validatePrivatePath(outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(outputPath, 0o600);
}

function encodeSse(content, { multiline = false, crlf = false } = {}) {
  const json = JSON.stringify({
    choices: [{ delta: { content }, finish_reason: null }],
  });
  // SSE joins multiple data lines with a newline; split only at JSON structure.
  const midpoint = Math.max(1, json.indexOf(',"finish_reason"') + 1);
  const data = multiline
    ? `data: ${json.slice(0, midpoint)}\ndata: ${json.slice(midpoint)}\n\n`
    : `data: ${json}\n\n`;
  const finish = `data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: "stop" }],
  })}\n\ndata: [DONE]\n\n`;
  const source = `: synthetic-heartbeat\n\n${data}${finish}`;
  return crlf ? source.replaceAll("\n", "\r\n") : source;
}

function responseFromChunks(chunks, status = 200) {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index === chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[index++]);
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

function splitBytes(text) {
  const bytes = new TextEncoder().encode(text);
  const midpoint = Math.floor(bytes.length / 2);
  return [bytes.slice(0, midpoint), bytes.slice(midpoint)];
}

function syntheticEnvironment() {
  return {
    PIS_LLM_ENDPOINT: "https://synthetic.invalid/v1/chat/completions",
    PIS_LLM_API_KEY: "synthetic-not-a-secret",
    PIS_LLM_MODEL: "synthetic-not-a-model",
    PIS_LLM_PROCESSING_ROUTE_MAX_ATTEMPTS: "2",
    PIS_LLM_PROCESSING_ROUTE_FIRST_BYTE_TIMEOUT_MS: "5000",
    PIS_LLM_PROCESSING_ROUTE_IDLE_TIMEOUT_MS: "5000",
    PIS_LLM_PROCESSING_ROUTE_TOTAL_TIMEOUT_MS: "5000",
    PIS_LLM_PROCESSING_ROUTE_RETRY_TOTAL_BUDGET_MS: "10000",
  };
}

function makeClients(components, policies, handlers) {
  return Object.fromEntries(
    OPERATIONS.map((operation) => [
      operation,
      components.createStreamingChatCompletionsClient(
        components.streamingConfigForOperation(policies[operation]),
        {
          fetch: handlers[operation],
          onStateChange: handlers.observations?.[operation]
            ? observer(handlers.observations[operation])
            : undefined,
        },
      ),
    ]),
  );
}

export async function runSelfTest(components) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pis-llm-streaming-self-test-"),
  );
  const outputPath = path.join(directory, "safe.json");
  const rawPath = path.join(directory, "raw.sse.jsonl");
  try {
    await writeFile(rawPath, "", { mode: 0o600 });
    const env = syntheticEnvironment();
    const policies = components.resolveLlmOperationPolicies(
      {
        endpoint: env.PIS_LLM_ENDPOINT,
        apiKey: env.PIS_LLM_API_KEY,
        model: env.PIS_LLM_MODEL,
      },
      env,
    );
    const raw = async (entry) => {
      await appendFile(rawPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      await chmod(rawPath, 0o600);
    };
    const observations = Object.fromEntries(
      OPERATIONS.map((operation) => [operation, newObservation()]),
    );
    let fixtureIndex = 0;
    const handlers = Object.fromEntries(
      OPERATIONS.map((operation) => [
        operation,
        async (_url, init) => {
          const request = JSON.parse(init.body);
          if (
            request.stream !== true ||
            request.messages.length !== 2 ||
            "temperature" in request ||
            "response_format" in request
          )
            throw new Error("Unexpected streaming request");
          const response = responseFromChunks(
            splitBytes(
              encodeSse(
                VALID_CONTENT[operation]
                  ? JSON.stringify(VALID_CONTENT[operation])
                  : "",
                {
                  multiline: fixtureIndex % 2 === 0,
                  crlf: fixtureIndex % 2 === 1,
                },
              ),
            ),
          );
          fixtureIndex += 1;
          await raw({
            operation,
            status: response.status,
            sse: await response.clone().text(),
          });
          return response;
        },
      ]),
    );
    handlers.observations = observations;
    const calls = components.createTypedLlmCalls({
      prompts: prompts(),
      completionClients: makeClients(components, policies, handlers),
    });
    const results = [];
    for (const operation of OPERATIONS)
      results.push(
        await executeWithRetry(
          components,
          operation,
          calls,
          policies[operation],
        ),
      );
    for (const result of results) {
      result.firstByteMs = observations[result.operation].firstByteMs;
      result.firstContentMs = observations[result.operation].firstContentMs;
      result.streamStates = observations[result.operation].streamStates;
    }

    let incompleteAttempts = 0;
    const retryClient = components.createStreamingChatCompletionsClient(
      {
        ...components.streamingConfigForOperation(policies["processing-route"]),
        totalTimeoutMs: 1000,
      },
      {
        fetch: async () => {
          incompleteAttempts += 1;
          return incompleteAttempts === 1
            ? responseFromChunks(splitBytes("data: {}\n\n"))
            : responseFromChunks(
                splitBytes(
                  encodeSse(JSON.stringify(VALID_CONTENT["processing-route"])),
                ),
              );
        },
      },
    );
    const retryCalls = components.createTypedLlmCalls({
      prompts: prompts(),
      completionClient: retryClient,
    });
    results.push({
      check: "retry",
      ...(await executeWithRetry(
        components,
        "processing-route",
        retryCalls,
        policies["processing-route"],
      )),
    });

    const timeoutResults = [];
    for (const timeout of ["first_byte", "idle", "total"]) {
      const observation = newObservation();
      const config = {
        ...components.streamingConfigForOperation(policies["processing-route"]),
        firstByteTimeoutMs: timeout === "first_byte" ? 10 : 1000,
        idleTimeoutMs: timeout === "idle" ? 10 : 1000,
        totalTimeoutMs: timeout === "total" ? 20 : 1000,
      };
      const fetchOverride = components.createStreamingChatCompletionsClient(
        config,
        {
          fetch: async (_url, init) =>
            new Response(
              new ReadableStream({
                start(controller) {
                  if (timeout === "first_byte") {
                    init.signal.addEventListener("abort", () =>
                      controller.error(new Error("PRIVATE_ABORT_DETAIL")),
                    );
                  } else if (timeout === "idle") {
                    controller.enqueue(
                      new TextEncoder().encode(
                        'data: {"choices":[{"delta":{"reasoning":"synthetic"},"finish_reason":null}]}\n\n',
                      ),
                    );
                  } else {
                    controller.enqueue(
                      new TextEncoder().encode(": heartbeat\n\n"),
                    );
                    init.signal.addEventListener("abort", () => {
                      try {
                        controller.error(new Error("PRIVATE_ABORT_DETAIL"));
                      } catch {
                        // The primary safe timeout classification is retained.
                      }
                    });
                  }
                },
              }),
              { status: 200 },
            ),
          onStateChange: observer(observation),
        },
      );
      const startedAt = Date.now();
      try {
        await fetchOverride.complete({
          systemContent: "synthetic",
          userContent: "synthetic",
        });
        throw new Error("Timeout fixture unexpectedly succeeded");
      } catch (error) {
        timeoutResults.push({
          check: `${timeout}-timeout`,
          ...safeResult(
            "processing-route",
            startedAt,
            1,
            observation,
            error,
            components,
          ),
        });
      }
    }
    results.push(...timeoutResults);

    const cancellationObservation = newObservation();
    const controller = new AbortController();
    const cancellationClient = components.createStreamingChatCompletionsClient(
      {
        ...components.streamingConfigForOperation(policies["processing-route"]),
        totalTimeoutMs: 1000,
      },
      {
        fetch: async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new Error("PRIVATE_ABORT_DETAIL")),
            );
          }),
        onStateChange: (state) => {
          observer(cancellationObservation)(state);
          if (state.streamState === "request_started") controller.abort();
        },
      },
    );
    const cancellationStartedAt = Date.now();
    try {
      await cancellationClient.complete({
        systemContent: "synthetic",
        userContent: "synthetic",
        signal: controller.signal,
      });
      throw new Error("Cancellation fixture unexpectedly succeeded");
    } catch (error) {
      results.push({
        check: "cancellation",
        ...safeResult(
          "processing-route",
          cancellationStartedAt,
          1,
          cancellationObservation,
          error,
          components,
        ),
      });
    }

    const report = {
      mode: "self-test",
      modelExecuted: false,
      network: false,
      operations: results,
      summary: {
        count: results.length,
        succeeded: results.filter((result) => result.outcome === "success")
          .length,
        failed: results.filter((result) => result.outcome === "failure").length,
        retried: results.filter((result) => result.attempts > 1).length,
        totalDurationMs: results.reduce(
          (sum, result) => sum + result.durationMs,
          0,
        ),
      },
    };
    await writePrivateJson(outputPath, report);
    await chmod(rawPath, 0o600);
    return report;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function executeReal(components, env, outputPath) {
  for (const key of ["PIS_LLM_ENDPOINT", "PIS_LLM_API_KEY", "PIS_LLM_MODEL"])
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

  const policies = components.resolveLlmOperationPolicies(
    {
      endpoint: env.PIS_LLM_ENDPOINT,
      apiKey: env.PIS_LLM_API_KEY,
      model: env.PIS_LLM_MODEL,
    },
    env,
  );
  validatePrivatePath(outputPath);
  const rawPath = `${outputPath}.raw.sse.jsonl`;
  validatePrivatePath(rawPath);
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(rawPath, "", { mode: 0o600 });
  await chmod(rawPath, 0o600);
  let attempt = 0;
  const observations = Object.fromEntries(
    OPERATIONS.map((operation) => [operation, newObservation()]),
  );
  const handlers = Object.fromEntries(
    OPERATIONS.map((operation) => [
      operation,
      async (url, init) => {
        const response = await globalThis.fetch(url, init);
        await appendFile(
          rawPath,
          `${JSON.stringify({
            operation,
            attempt: (attempt += 1),
            status: response.status,
            sse: await response.clone().text(),
          })}\n`,
          { mode: 0o600 },
        );
        await chmod(rawPath, 0o600);
        return response;
      },
    ]),
  );
  handlers.observations = observations;
  const calls = components.createTypedLlmCalls({
    prompts: prompts(),
    completionClients: makeClients(components, policies, handlers),
  });
  const results = [];
  for (const operation of OPERATIONS) {
    attempt = 0;
    results.push(
      await executeWithRetry(
        components,
        operation,
        calls,
        policies[operation],
        undefined,
        observations[operation],
      ),
    );
  }
  const report = {
    mode: "real",
    modelExecuted: true,
    operations: results,
    summary: {
      count: results.length,
      succeeded: results.filter((result) => result.outcome === "success")
        .length,
      failed: results.filter((result) => result.outcome === "failure").length,
      totalDurationMs: results.reduce(
        (sum, result) => sum + result.durationMs,
        0,
      ),
    },
  };
  await writePrivateJson(outputPath, report);
  return report;
}

export async function loadComponents() {
  const distUrl = (file) => pathToFileURL(path.join(ROOT, "dist", file)).href;
  const modules = await Promise.all([
    import(distUrl("llm/chat-completions-client.js")),
    import(distUrl("llm/llm-calls.js")),
    import(distUrl("llm/streaming-chat-completions-client.js")),
    import(distUrl("llm/operation-policy.js")),
    import(distUrl("llm/failure-summary.js")),
  ]);
  return Object.assign({}, ...modules);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const components = await loadComponents();
  if (options.selfTest) {
    const report = await runSelfTest(components);
    console.log(
      JSON.stringify({
        mode: "self-test",
        modelExecuted: false,
        network: false,
        count: report.summary.count,
        succeeded: report.summary.succeeded,
        expectedFailures: report.summary.failed,
        durationMs: report.summary.totalDurationMs,
        verdict: "PASS",
      }),
    );
    return;
  }
  const envPath = validatePrivatePath(options.envFile);
  const outputPath = validatePrivatePath(options.output);
  const report = await executeReal(
    components,
    parseEnvironment(await readFile(envPath, "utf8")),
    outputPath,
  );
  console.log(
    JSON.stringify({
      mode: "real",
      count: report.summary.count,
      succeeded: report.summary.succeeded,
      failed: report.summary.failed,
      durationMs: report.summary.totalDurationMs,
      verdict: report.summary.failed === 0 ? "COMPLETE" : "FAILED",
    }),
  );
  if (report.summary.failed !== 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(JSON.stringify(safeHarnessError()));
    process.exitCode = 1;
  });
