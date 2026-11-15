# D02 Plan · Prompt、LLM 客户端与严格 Schema

> 版本：v0.2 · 2026-11-15
> 状态：**REVIEW · G3 v0.1 意见已修订，待 Architect 复评；用户执行批准仍为 PENDING**
> 起草：Paseo Lead（仅规划）
> 依据：[Intent v0.1](intent.md)（APPROVED）、[Spec v0.1](spec.md)（APPROVED）、[技术实现设计 v1.0](../../PIS_技术实现设计_v1.0.md) §3、§17、[测试设计 v0.2](../../PIS_V1_测试用例设计_v0.2.md) §4.12。
> 代码基线：`0fcc52bb0708b1888dbfa872b3a4907eaeb6218c`（D02 Spec 提交）。

## 1. 执行边界

本 Plan 只落实已批准的 D02-T01～T04，不实现业务服务、数据库访问、Runtime、任务队列、HTTP 业务 API、真实模型验收、第二种 Provider 协议或 Prompt 管理后台。

正式派发 Worker 必须同时满足：

1. Architect 完成 G3 并把本文件状态改为 `APPROVED`。
2. 项目负责人明确批准执行本 Plan；对真实 `user-context.md` 纳入公开 Git 必须单独明确授权。当前 `USER_EXECUTION_APPROVAL=PENDING`、`USER_CONTEXT_PUBLIC_GIT_APPROVAL=PENDING`。
3. Lead 从 D02 文档基线创建独立任务分支并记录 base SHA。
4. T01 使用现有精确工具链；Lead 在纳入 Prompt 前完成字节摘要、公开边界复核和跨 worktree 移交。
5. T01～T04 严格串行；每卡使用新的 Paseo Worker。Worker 不自行 stage/commit，不宣布 PASS。

任务分支结果只记为 `REVIEW`。只有 Lead 审核、Architect 轻量复核并合并后，才按合并 commit 记录 `PASS`。

## 2. 依赖、工具链与现有事实

- D02 不新增依赖。使用现有 `zod@4.6.7`、Node 原生 `fetch`/`AbortController`/Web Streams 和 Vitest；不得修改 `package.json`、`package-lock.json` 或安装新包。
- 执行前显式前置 `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`，确认 Node `v26.13.1` / npm `11.20.0`。每个不含 `node_modules` 的新 worktree 先运行 `npm ci` 安装现有锁文件依赖，再运行 `npm run verify:toolchain`；`npm ci` 不得改变 `package.json`/锁文件。失败即停止，不改用默认 Node。
- 当前六个 Prompt 位于未跟踪的 `config/prompt/`。D02-T01 目标路径为 `config/prompts/`；当前 `config/.DS_Store` 已被忽略，不属于版本管理输入。
- 独立 worktree 不会自动获得主工作区未跟踪文件。获用户执行批准及 `USER_CONTEXT_PUBLIC_GIT_APPROVAL=APPROVED` 后，Lead 先确认 T01 worktree 的 `config/prompts/` 不存在，再创建该目录并仅从主工作区 `config/prompt/` 逐文件原字节复制六份 Markdown，立即复核摘要；目标目录已存在或含任何文件即停止。Worker 不负责跨 worktree 移动、复制或删除源文件；不得带入 `config/.DS_Store` 或其他 config 文件。源 `config/prompt/` 在 T01 合并并验证前保持不动，任务失败时直接丢弃任务分支/worktree 即可恢复。
- Lead 规划期只读摘要如下；T01 执行时必须重新计算并要求前后完全相同：

| 文件 | SHA-256（规划期） |
| --- | --- |
| `event-analysis.md` | `9b05c4b13fd413b7b303183546aa92b02ca4a7359ac26f3dd88b5cb28fad86c3` |
| `event-search.md` | `e75b656c7cb69c93d6c77af47c0e254f0c6386da74c6d2156221109abfd2d746` |
| `knowledge-analysis.md` | `037eceafb9e927a31b57668ab85f3bafd4b410ef9b6118590ec1f00577aa0512` |
| `processing-route.md` | `98a34e833c64a3399b160004b12e2985b77b8d06fd2153fd800424988c3796c4` |
| `topic-matching.md` | `040a083e1b413a30f7d21a3c161fbb1c8edc47f0cb45006aeb36b6438c20e12b` |
| `user-context.md` | `e00edabebc1388adba8351daed7eb09494299bed37b8f6e177e462513b1d84d5` |

- 规划期人工公开边界检查只发现概括性的职业/兴趣背景，未发现姓名、邮箱、电话、凭证、Token 或 URL。概括性的职业/兴趣同样是私人背景，“无邮箱/密钥”不等于允许公开。当前文件不得因 G3 或执行批准被推定获准进入 Git；只有负责人单独同意 `USER_CONTEXT_PUBLIC_GIT_APPROVAL` 后，Lead 才可按上述流程移交。未获授权时保留原文并停止 T01 的 User Context 纳入，不自行改写、脱敏或发布。

## 3. 固定文件边界与依赖图

| 任务 | 独占新增/修改路径 |
| --- | --- |
| T01 | `config/prompts/event-analysis.md`、`event-search.md`、`knowledge-analysis.md`、`processing-route.md`、`topic-matching.md`、`user-context.md`（均由 `config/prompt/` 原字节迁移）、`src/prompt/prompt-repository.ts`、`tests/prompt/prompt-repository.test.ts`、`tests/fixtures/prompt-directory.ts`、`README.md`（仅 Prompt 路径/边界） |
| T02 | `src/llm/response-validators.ts`、`tests/llm/response-validators.test.ts`、`tests/fixtures/llm-responses.ts` |
| T03 | `src/llm/chat-completions-client.ts`、`tests/llm/chat-completions-client.test.ts`、`README.md`（仅调用配置/安全边界） |
| T04 | `src/llm/llm-calls.ts`、`tests/llm/llm-calls.test.ts`、`tests/fixtures/stub-llm.ts`、`README.md`（仅单次调用/无重试边界） |

共同规则：

- 不使用通配符或 `git add config/`；未来只允许精确 stage 上表六个 Markdown。Worker 本身不得 stage。
- Prompt 文件只能由 Lead 按 §2 流程从主工作区原字节复制到 T01 worktree 的精确目标路径，不改写、不重排、不 trim、不复制其他 config 文件。Worker 只校验目标六文件摘要。若目标路径已存在、摘要变化或 User Context 公开授权缺失，T01 标 `BLOCKED`。
- T01 分支合并到主工作区时，目标 `config/prompts/` 与源 `config/prompt/` 路径不同，不允许用主树现有 untracked 内容覆盖分支或反向 stage。Lead 先确认分支与主树源摘要一致，再合并；合并后再次核对六摘要，只有精确一致时才把仅含六文件的源 `config/prompt/` 移出仓库到唯一临时备份并保留至 T01 验证通过。任何摘要差异都先恢复备份并停止，不删除源内容。
- 后续卡只读复用先前接口/Fixture，不另建第二套 operation、Schema、错误或请求类型。
- 不修改 `package.json`、锁文件、`tsconfig*.json`、`vitest.config.ts`、格式脚本、CI、数据库、D00/D01 源码或权威 docs。
- 所有新 `.ts` 自动进入现有 Prettier 白名单；Markdown Prompt 不在格式白名单中，必须保持原字节。

依赖图：

```text
G3 APPROVED → USER_EXECUTION_APPROVED + USER_CONTEXT_PUBLIC_GIT_APPROVED
  → T01 Prompt 目录/逐次读取
  → Lead + Architect → merge
  → T02 五类严格 Schema/引用/冲突校验
  → Lead + Architect → merge
  → T03 单次 Chat Completions 客户端/错误/资源清理
  → Lead + Architect → merge
  → T04 五类 typed call + 固定 Stub/输入捕获
  → Lead + Architect → merge
  → D02 集成 Gate
```

## 4. 固定公共接口与行为

### 4.1 Operation、Prompt 快照与错误

`src/prompt/prompt-repository.ts` 固定以下单一 operation 来源；后续模块不得定义第二套映射：

```ts
export const LLM_OPERATIONS = [
  "processing-route",
  "event-search",
  "event-analysis",
  "knowledge-analysis",
  "topic-matching",
] as const;

export type LlmOperation = (typeof LLM_OPERATIONS)[number];

export interface LoadedPrompt {
  readonly instructions: string;
  readonly userContext: string | null;
}

export class PromptRepository {
  constructor(promptsDirectory: string);
  load(operation: LlmOperation): Promise<LoadedPrompt>;
}
```

固定映射：

| operation | 功能文件 | User Context |
| --- | --- | --- |
| `processing-route` | `processing-route.md` | 否 |
| `event-search` | `event-search.md` | 否 |
| `event-analysis` | `event-analysis.md` | 否 |
| `knowledge-analysis` | `knowledge-analysis.md` | 是，`user-context.md` |
| `topic-matching` | `topic-matching.md` | 否 |

- 构造只保存调用方给出的明确根目录并验证其为非空字符串；不解析环境变量、不执行 I/O、不使用 cwd 回退。`load` 每次用固定文件名映射构造路径，不接受外部文件名。
- `load` 重新读盘，无内存缓存、watcher 或旧值回退。Knowledge 先读功能文件再读 User Context；其余四类绝不读取 `user-context.md`。
- 返回原始 UTF-8 文本，不 trim、不替换、不拼接私密数据或输出 Schema。空白判定使用 `trim().length === 0`，但返回值仍保留原字节解码文本。
- 每次 `load` 返回独立快照。之后文件再变，不改变已返回对象；下一次 `load` 必须看到新内容。不承诺两个文件之间存在跨文件原子编辑。
- 错误固定为 `PromptConfigurationError`：`category="configuration"`、`retryable=false`，只带 operation、安全文件名和以下 code；消息不含根目录、绝对路径、文本或底层 fs message。

| code | 分类条件 |
| --- | --- |
| `PROMPT_OPERATION_INVALID` | 运行期收到未知 operation |
| `PROMPT_DIRECTORY_INVALID` | 构造目录为空/仅空白 |
| `PROMPT_FILE_MISSING` | 固定映射目标返回 `ENOENT` |
| `PROMPT_FILE_UNREADABLE` | 其他读取错误，包括目录冒充文件、权限错误 |
| `PROMPT_CONTENT_EMPTY` | 任一必需文件只有空白 |

### 4.2 五类严格响应

`src/llm/response-validators.ts` 使用 Zod 4 严格对象；所有对象与嵌套对象均使用 `z.strictObject`，未知字段不得被 strip。字符串事实值只做“至少一个非空白字符”校验，不用 trim 改写返回值。外部 JSON 字段保持 snake_case，不做 camelCase 重命名。

```ts
export interface ProcessingRouteResponse {
  readonly routes: Array<"EVENT" | "KNOWLEDGE">;
}

export interface EventSearchResponse {
  readonly clues: Array<{
    readonly entity_name: string;
    readonly subject: string;
    readonly search_terms: string[];
  }>;
}

export type EventAnalysisResult =
  | {
      readonly action: "NEW_EVENT";
      readonly title: string;
      readonly entity: { readonly name: string };
      readonly subject: string;
      readonly scope: string;
      readonly description: string;
      readonly occurred_at?: string | null;
      readonly confirmed_aliases: string[];
    }
  | {
      readonly action: "NEW_UPDATE";
      readonly event_id: string;
      readonly title: string;
      readonly description: string;
      readonly occurred_at?: string | null;
      readonly confirmed_aliases: string[];
    }
  | {
      readonly action: "NO_INCREMENT";
      readonly event_id: string;
      readonly event_update_id: string | null;
      readonly confirmed_aliases: string[];
    };

export interface EventAnalysisResponse {
  readonly results: EventAnalysisResult[];
}

export type KnowledgeAnalysisResponse =
  | { readonly valuable: false }
  | {
      readonly valuable: true;
      readonly title: string;
      readonly summary: string;
      readonly category?:
        | "Insight"
        | "Experience"
        | "Method"
        | "Resource"
        | null;
      readonly findings: Array<{
        readonly title: string;
        readonly description: string;
      }>;
      readonly value: string;
    };

export interface TopicMatchingResponse {
  readonly matched_topic_ids: string[];
}

export interface EventAnalysisReferences {
  readonly candidateEventIds: readonly string[];
  readonly eventIdByUpdateId: Readonly<Record<string, string>>;
}

export interface TopicMatchingReferences {
  readonly enabledTopicIds: readonly string[];
}

export type LlmResponseByOperation = {
  "processing-route": ProcessingRouteResponse;
  "event-search": EventSearchResponse;
  "event-analysis": EventAnalysisResponse;
  "knowledge-analysis": KnowledgeAnalysisResponse;
  "topic-matching": TopicMatchingResponse;
};

export type LlmReferenceContextByOperation = {
  "processing-route": Record<never, never>;
  "event-search": Record<never, never>;
  "event-analysis": EventAnalysisReferences;
  "knowledge-analysis": Record<never, never>;
  "topic-matching": TopicMatchingReferences;
};

export function parseLlmResponse<K extends LlmOperation>(
  operation: K,
  content: string,
  references: LlmReferenceContextByOperation[K],
): LlmResponseByOperation[K];

export function getOutputJsonSchema(operation: LlmOperation): string;
```

规则：

- 先对完整 `content` 调用 `JSON.parse`，再从 Markdown fence、前后解释文本或部分片段中提取均不支持，也不自动修复。
- P-01 允许空 `routes`；结构合法后按首次出现顺序去重 enum。
- P-02 允许空 `clues`；`entity_name`、`subject` 和每个 `search_terms` 项非空白；不要求或生成 Event ID/确认别名。
- P-03 外层严格 `{results}`，允许空数组。三个 action 分支互斥，额外字段按分支拒绝；`NEW_EVENT` 不得带 `event_id`/`event_update_id`，`NEW_UPDATE` 不得生成 Update ID，`NO_INCREMENT` 不得带新事实字段。
- `confirmed_aliases` 在每个 P-03 分支必填，允许空数组，项非空白；按精确首次出现顺序去重。`occurred_at` 可缺省或 null；非 null 时必须是可解析且带 `Z` 或 `±HH:MM` 时区的 ISO 时间点。
- P-03 `NEW_UPDATE.event_id` 必须在 `candidateEventIds`；`NO_INCREMENT.event_id` 同上；非 null `event_update_id` 必须由 `eventIdByUpdateId` 映射到同一个 event。未知引用、错误归属均拒绝。
- 同一 event 出现 `NEW_UPDATE` 与 `NO_INCREMENT` 混合动作，或同一 event 出现多个 `NEW_UPDATE`，均以冲突拒绝。多个纯 `NO_INCREMENT` 不额外定为冲突；多个 NEW_EVENT 没有可比较的既有 ID。
- P-04 为严格 `valuable` 判别联合。`false` 只有该字段；`true` 必须含 title、summary、findings、value，`category` 缺省与 null 都表示未分类，findings 允许空数组。不得把空/否定结果转成技术错误。
- P-05 每项非空白并按首次出现顺序去重；去重后每个 ID 必须在显式 `enabledTopicIds` 快照内。空数组合法。
- `getOutputJsonSchema` 只从上述 Zod Schema 使用 `z.toJSONSchema(..., { io: "output" })` 产生稳定 JSON 字符串；Prompt Markdown 不维护第二份可执行 Schema。
- 错误固定为 `LlmOutputValidationError`：`category="output_validation"`、`retryable=true`，只带 operation 和以下 code；不携带原始模型文本、解析后的业务值或 Zod 值。

| code | 分类条件 |
| --- | --- |
| `LLM_OUTPUT_JSON_INVALID` | 完整文本不是合法 JSON |
| `LLM_OUTPUT_SCHEMA_INVALID` | 类型、缺失/额外字段、enum、非空字符串、时间格式等失败 |
| `LLM_OUTPUT_REFERENCE_INVALID` | Event/Update/Topic 引用不存在或 Update 归属错误 |
| `LLM_OUTPUT_CONFLICT` | 同 Event 矛盾动作或重复 NEW_UPDATE |

### 4.3 单次 Chat Completions 客户端

`src/llm/chat-completions-client.ts` 只支持已批准的 OpenAI-compatible Chat Completions 非流式协议，不实现 Responses、Anthropic Messages、流式或 Provider 适配层。

```ts
export interface ChatCompletionsConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export interface TextCompletionRequest {
  readonly systemContent: string;
  readonly userContent: string;
  readonly signal?: AbortSignal;
}

export interface TextCompletionClient {
  complete(request: TextCompletionRequest): Promise<string>;
}

export function createChatCompletionsClient(
  config: ChatCompletionsConfig,
  dependencies?: { readonly fetch?: typeof globalThis.fetch },
): TextCompletionClient;
```

- `timeoutMs` 默认 `60_000`，`maxResponseBytes` 默认 `2 * 1024 * 1024`；显式值必须是有限正整数。`endpoint`、`apiKey`、`model` 必须至少含一个非空白字符；URL 必须是 HTTP(S)、不得含用户名/密码；HTTP 只允许 `localhost`、`127.0.0.1` 或 `::1` 测试地址。
- 配置只在 factory 同步校验，不在模型请求时读取环境。endpoint 原样使用，不自动补 `/v1/chat/completions` 或其他路径。配置与错误均不回显 endpoint query、密钥或模型响应正文。
- 请求使用注入的 fetch，缺省为 `globalThis.fetch`；工厂/导入无网络副作用。POST 头精确为 `Authorization: Bearer <apiKey>` 与 `Content-Type: application/json`，并设 `redirect: "error"`。
- 请求体只含配置的 `model`、`stream: false`、两条 `messages`：`system` 为传入 systemContent，`user` 为传入 userContent。不得发送 tools、tool_choice、response_format、流式参数、动态生成的 role 或第二个预算字段。D02 不新增 temperature/top_p 等未批准参数。
- 成功 HTTP 必须是 JSON 对象，`choices[0].message.content` 为非空白字符串，`choices[0].finish_reason === "stop"`。拒绝 null/数组/多模态 content、refusal、tool/function call、非 stop finish reason 和缺失字段；envelope 其他未知字段可忽略。
- 调用前先检查调用方 signal；已取消时不得调用 fetch。用本地 `AbortController` 组合调用方 signal 与单次总超时，超时预算从 fetch 前开始并覆盖 fetch、响应头、响应体、UTF-8 解码和 envelope 提取。fetch 自身与 lifecycle abort race，并向 fetch 传入组合 signal，不能依赖自定义 fetch 必然服从 abort；未赢竞速的 fetch/read Promise 必须挂接 rejection consumer，避免迟到 rejection 变成 unhandled。
- 每个 `reader.read()` 同样与 lifecycle abort race。abort 或 finally 不得无界等待 `reader.cancel()`/`body.cancel()`：同步发起取消，对同步抛错和 Promise rejection 都做 contained 消费；release lock 也必须在 try/catch 中完成，不能在仍有 actor 挂起时反向阻塞或掩盖主错误。timer/listener 必须无条件清理，任何必须等待的 cleanup 仍受明确上限约束。取消返回永不 settle 或 reject 都不能阻止 `complete` 有界返回，也不能产生未处理 rejection。
- 2xx 响应按实际流读取字节，不信任 Content-Length；超过上限立即取消并失败。非 2xx 不读取无界正文，直接取消 body 并只保留安全 status。UTF-8 用 fatal decoder；非法编码是协议错误。
- `complete` 只返回模型 content 文本，不解析业务 JSON、不校验业务 Schema、不写日志、不重试。业务 JSON/引用错误由 T02/T04 负责。

固定 `ChatCompletionsError` 分类：

| code | `category` | `retryable` | 说明 |
| --- | --- | --- | --- |
| `LLM_CONFIG_INVALID` | `configuration` | false | endpoint/密钥/模型/数值/安全 URL 配置非法 |
| `LLM_CANCELLED` | `cancellation` | false | 调用方 signal 取消；原因为取消而非超时 |
| `LLM_TIMEOUT` | `timeout` | true | 本次总预算耗尽 |
| `LLM_NETWORK_ERROR` | `network` | true | fetch 网络/重定向拒绝等，不含底层敏感信息 |
| `LLM_HTTP_ERROR` | `http` | 429 或 5xx 为 true，其余 false | 仅附安全数字 `status`，无响应 body |
| `LLM_RESPONSE_PROTOCOL_ERROR` | `response_protocol` | false | envelope/content/finish reason/UTF-8 非法 |
| `LLM_RESPONSE_TOO_LARGE` | `response_size` | false | 实际读取字节超限 |

分类只供未来业务/Runtime 决定是否在既有最多两次总预算内重试；D02 客户端和 typed call 自身绝不重试。

### 4.4 五类单次 typed call

`src/llm/llm-calls.ts` 组合 Prompt、HTTP 文本客户端与严格响应校验，只执行一次尝试：

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface LlmCallOptions {
  readonly signal?: AbortSignal;
}

export interface TypedLlmCalls {
  routeProcessing(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<ProcessingRouteResponse>;
  searchEvents(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<EventSearchResponse>;
  analyzeEvents(
    taskData: JsonObject,
    references: EventAnalysisReferences,
    options?: LlmCallOptions,
  ): Promise<EventAnalysisResponse>;
  analyzeKnowledge(
    taskData: JsonObject,
    options?: LlmCallOptions,
  ): Promise<KnowledgeAnalysisResponse>;
  matchTopics(
    taskData: JsonObject,
    references: TopicMatchingReferences,
    options?: LlmCallOptions,
  ): Promise<TopicMatchingResponse>;
}

export interface TypedLlmCallDependencies {
  readonly prompts: Pick<PromptRepository, "load">;
  readonly completionClient: TextCompletionClient;
}

export function createTypedLlmCalls(
  dependencies: TypedLlmCallDependencies,
): TypedLlmCalls;
```

- 五个方法分别固定使用同名 operation 映射；先 `load` 一次，再调用一次 `completionClient.complete`，最后 `parseLlmResponse` 一次。Prompt 失败时不发 HTTP；completion 错误原样上抛；校验失败不重试。
- 每次公开方法进入后、第一个 `await` 前，用同步独立深拷贝捕获 `taskData` 与引用参数快照（Node 26 `structuredClone`，随后只读使用），不保留对调用方可变对象/嵌套数组/映射的引用。后续 request JSON 序列化与 `parseLlmResponse` 引用校验必须使用同一份快照，因此等待 Prompt load 或 HTTP 期间修改原对象不能改变实际请求或校验候选集合。
- System content 由本次 Prompt 快照的原始 `instructions`、固定标签以及 `getOutputJsonSchema(operation)` 组成。不得从 Markdown 猜 Schema，不得把动态任务数据拼入 system。
- 非 Knowledge 的 user content 精确序列化为 `{ "task_data": <taskData> }`；Knowledge 为 `{ "task_data": <taskData>, "user_context": <snapshot.userContext> }`。动态数据始终保持 JSON 值，不生成 role、工具或配置。
- 同一方法调用只使用一个 Prompt 快照；成功和失败路径都不缓存。调用方模拟第二次尝试时再次执行方法，因而重新读盘。
- typed call 不查询数据库、不落库、不派发任务、不记录请求或响应内容，不实现完整 Runtime 两次预算。

## 5. 任务卡

### D02-T01 · PromptRepository 与逐次磁盘读取

```yaml
id: D02-T01
status: NOT_STARTED
depends_on: [G3_APPROVED, USER_EXECUTION_APPROVED, USER_CONTEXT_PUBLIC_GIT_APPROVED, EXACT_TOOLCHAIN_READY]
spec_refs: ["D02 Spec §2", "D02 Spec §6"]
```

**实现**

1. Lead 前置：再次扫描主工作区六文件与公开边界，确认 `USER_CONTEXT_PUBLIC_GIT_APPROVAL=APPROVED`；在 T01 worktree 创建 `config/prompts/`，仅从主工作区 `config/prompt/` 原字节复制六份 Markdown，不添加 `.DS_Store` 或其他文件。源目录保持不动，复制前后摘要必须与上表完全一致。Worker 到达时目标文件应已存在；Worker 不执行跨 worktree `mv/cp/rm`。
2. 实现 §4.1。构造不读盘；固定映射只接受 `LlmOperation`。Knowledge 读取两个文件，其他 operation 不构造 User Context 路径。
3. 使用 `node:fs/promises.readFile(path, "utf8")` 逐次读；仅检查必需内容是否全为空白。错误转换为 §4.1 安全错误，不附底层 message/cause/路径。
4. 测试只使用 D00 `withTempDirectory()` 和合成 Markdown，不把实际 User Context 放进测试、日志或 Fixture。
5. README 只说明部署必须向 `PromptRepository` 提供明确 `config/prompts/` 根目录、五类映射、Knowledge 两文件、无缓存/无 watcher，以及 D02 尚未接入启动流程。

**必须验证**

- 固定映射五类；每次 load 读盘，修改后下一次立即看到。
- Knowledge 读取功能文件与 User Context 两文件，其他四类即使 `user-context.md` 缺失仍成功且不读它。
- 返回原文不改写；一次快照在后续文件修改后保持原字符串。
- 缺文件、目录冒充文件/读取错误、空白功能文件、空白 User Context、非法 operation 和空目录全部失败且不返回空字符串。
- 错误不包含临时绝对路径、Prompt 正文或合成私有 sentinel。

**可定位测试名称**

- `PromptRepository loads the fixed Markdown source on every operation`
- `PromptRepository rereads a changed prompt on the next load`
- `PromptRepository reads user context only for knowledge analysis`
- `PromptRepository preserves raw text in an independent snapshot`
- `PromptRepository fails closed for invalid directories operations and missing files`
- `PromptRepository reports empty prompt content without leaking source text`

**验证命令**

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
npm run verify:toolchain
npm test -- tests/prompt/prompt-repository.test.ts
npm run verify
```

**审核证据**

- Lead 移交前后六文件摘要、主工作区源文件与 T01 worktree 目标文件逐一对比、`find config` 快照、公开边界与 User Context 公开授权结论；确认无重复 Markdown、无 `.DS_Store` stage、未改写内容。
- 定向/full verify 退出码与测试数；临时目录在成功和失败后清理。
- `git diff --name-status` 只含本卡白名单；新增 Prompt 的摘要与主工作区源文件完全相同。

### D02-T02 · 五类严格响应与引用校验

```yaml
id: D02-T02
status: NOT_STARTED
depends_on: [D02-T01]
spec_refs: ["D02 Spec §3", "D02 Spec §6"]
```

**实现**

1. 在单文件实现 §4.2 的 Zod Schema、公开返回类型、引用上下文、`parseLlmResponse` 和 `getOutputJsonSchema`。每个 object、entity、clue、finding 都必须是 strict object。
2. 先 JSON parse，再按 operation parse；结构校验后才做引用与跨结果冲突校验。只允许规范明确要求的首次顺序去重。
3. 时间使用显式时区校验；返回原始合法字符串，不转换成 `Date` 或业务存储格式。
4. `tests/fixtures/llm-responses.ts` 只提供确定性合成合法/非法 JSON 值，覆盖 P-01～P-05 与三个 P-03 分支；不得从真实 Prompt 生成期望值或读取实际 User Context。
5. 生成 Schema 的测试解析 `getOutputJsonSchema` 返回 JSON，证明对象节点 `additionalProperties: false`，并确认 P-03 三分支、P-04 两分支与 enum/null/optional 规则存在。

**必须验证**

- 五类合法结果、各自合法空结果；P-04 `valuable=false` 严格合法，`valuable=true` 的 category 缺省/null、空 findings 合法。
- 所有层级额外字段、必要字段缺失、错误类型、非法 enum、空白事实字符串、Markdown fence/解释文本、非法 JSON 拒绝。
- P-03 NEW_EVENT 额外 `event_id` 拒绝；NEW_UPDATE 生成 Update ID 拒绝；NO_INCREMENT 缺 Update 字段拒绝。
- 未知 Event/Topic、错误 Update 归属拒绝；同 Event NEW_UPDATE+NO_INCREMENT、重复 NEW_UPDATE 拒绝。
- routes、aliases、matched topic IDs 精确去重且保序；search_terms 不被改写；occurred_at 的 `Z`/offset 合法，无时区或无效日历值拒绝。
- 所有错误 code/category/retryable 稳定且不包含原始模型文本、ID 值或 paths 以外的业务 content。

**可定位测试名称**

- `parseLlmResponse accepts every strict response shape`
- `parseLlmResponse accepts every valid empty and negative business result`
- `strict schemas reject additional missing mistyped and enum fields at every level`
- `event analysis rejects invalid branches unknown events and wrong update ownership`
- `event analysis rejects contradictory and duplicate update decisions`
- `reference-backed topic matching rejects unknown topics before stable deduplication`
- `occurred_at requires an explicit timezone and returns the original text`
- `generated output schemas forbid additional properties in every object`

**验证命令**

```text
npm test -- tests/llm/response-validators.test.ts
npm run verify
```

**审核证据**

- operation→Schema→返回类型静态映射；strict object 覆盖清单。
- 合法/空/非法/引用/冲突矩阵与稳定错误 code；Schema JSON 中 `additionalProperties:false` 的对象计数。
- full verify 退出码；未新增依赖、数据库调用、真实 LLM 或第二份 Prompt Schema。

### D02-T03 · 原生 fetch 单次 Chat Completions 客户端

```yaml
id: D02-T03
status: NOT_STARTED
depends_on: [D02-T02]
spec_refs: ["D02 Spec §4", "D02 Spec §5", "D02 Spec §6"]
```

**实现**

1. 在单文件实现 §4.3，导出配置、请求、客户端接口与 `ChatCompletionsError`；默认 fetch 通过依赖注入覆盖，生产导入不联网。
2. 配置在 factory 同步验证。URL 使用 `URL` 解析，HTTPS 任意 host，HTTP 仅精确 loopback；禁止 userinfo、空密钥/模型、非法数值。
3. 每次 complete 先检查预取消，再创建本地 AbortController、timeout timer 与调用方 listener；组合 signal 传给 fetch，且 fetch Promise 与 lifecycle abort 竞速。所有 fetch/header/body/UTF-8/envelope 处理共用同一总预算，并消费未赢竞速 Promise 的迟到 rejection。
4. 按流读取实际字节并设上限；每个 `reader.read()` 与 abort 竞速。任何退出路径都在 finally 清 timer/listener、同步发起未完成 reader/body 取消并消费同步抛错/后续 rejection，再以 try/catch 尝试 release lock；禁止无界 `await` 自定义 cancel，也不能让 cleanup 错误覆盖原始 timeout/cancellation。非 2xx 同样有界取消 body，不读取无界正文。
5. envelope 提取只接受 §4.3 指定字段；不附 response body、endpoint query、token、Prompt/user content 到错误。测试不监听端口，使用注入 fetch 和确定性 `ReadableStream`。

**必须验证**

- 成功请求方法、URL 原样、头、`stream:false`、model、两条 messages；无 tools/response_format/额外协议字段。
- 合法 stop content 返回；null/空/数组 content、refusal、tool/function call、缺失或非 stop finish_reason、非法 JSON envelope/UTF-8 均为协议错误。
- 非 2xx、网络错误、调用方取消、总超时、挂起 body、实际字节超限和 Content-Length 缺失均及时、安全结束。
- 注入 fetch 永不 resolve 或忽略 abort 时仍按超时/取消有界返回；预取消时 fetch 调用数为 0。
- `reader.cancel()`/`body.cancel()` 永不 settle、同步抛错或后续 reject 时，complete 仍有界返回且不产生未处理 rejection。
- 401/403 非重试、429/5xx 可重试、其他 HTTP 非重试；错误安全字段只有 code/category/retryable/status。
- 每次成功或失败都清理 timer/listener/reader；调用方 signal 不会被移除错对象；不产生后台流。
- 配置非法在 fetch 前失败；密钥、endpoint query、system/user 内容与供应商 body sentinel 不进入 `String(error)`。

**可定位测试名称**

- `createChatCompletionsClient builds one non-streaming request`
- `complete returns the first stopped message content`
- `complete rejects invalid response envelopes without exposing provider text`
- `complete maps HTTP network cancellation timeout and size failures safely`
- `complete bounds the stream by bytes read rather than Content-Length`
- `complete cancels a hanging response body on timeout or caller cancellation`
- `complete bounds a fetch that never settles or ignores abort`
- `complete does not await hanging or rejecting cancellation`
- `complete validates endpoint transport and numeric configuration before fetch`

**验证命令**

```text
npm test -- tests/llm/chat-completions-client.test.ts
npm run verify
```

**审核证据**

- 每类错误的 code/category/retryable/status 表；fetch 调用次数 0/1。
- 实际字节计数、abort 原因、fetch/read/cleanup 有界竞速、cancel rejection 消费、reader release 与 timer/listener 清理证据；敏感 sentinel 不在错误消息中。
- full verify 退出码；无真实网络/LLM、无不必要日志、无新增依赖或重试实现。

### D02-T04 · 五类 typed call、固定 Stub 与输入捕获

```yaml
id: D02-T04
status: NOT_STARTED
depends_on: [D02-T03]
spec_refs: ["D02 Spec §4", "D02 Spec §6"]
```

**实现**

1. 在单文件实现 §4.4。五个公开方法使用固定 operation，禁止调用方传任意 Prompt 名；共享 helper 只执行 input snapshot→prompt load→request composition→one completion→JSON/schema validation，快照在任何 await 前完成并贯穿请求与引用校验。
2. System content 只用本次 Prompt 原文、固定标签与 `getOutputJsonSchema`；user content 只用 JSON `task_data`，Knowledge 另加独立 `user_context` 字段。动态数据不得成为 system/role/tool/config。
3. 不吞错、不重试、不自动修复、不缓存快速失败状态；completion 只调用一次，Prompt 失败时不调用 completion。
4. `tests/fixtures/stub-llm.ts` 固定导出实现 `TextCompletionClient` 的 `StubLLM`：构造函数接收成功文本/Error 的固定顺序，每次 `complete` 消耗一项并记录只读请求快照；队列耗尽抛出稳定的 `StubLlmSequenceExhaustedError`。不得随机生成成功响应，且该替身只存在于测试目录。
5. 测试使用合成 Prompt 与动态 sentinel，不读取真实 User Context；每类覆盖正常结果、合法空/否定结果、非法输出。PMT-13 使用临时 processing Prompt：第一次非法 JSON，修改文件后第二次合法 JSON。

**必须验证**

- 五个方法都只 load 一次、complete 一次、parse 一次，并返回对应强类型结果；空/否定结果不转技术错误。
- 每类非法 JSON、额外字段或错误类型均抛 T02 对应 code，completion 恰好一次，不重试。
- 每类 system 含该类本次 Prompt 和代码生成 Schema，不含动态 task data；user JSON 与进入方法时捕获的 taskData 快照等价。
- Prompt 原文只进入 system；User Context 只进入 Knowledge user JSON 的 `user_context` 字段，其他四类精确无此字段；不把任何动态数据拼接进 message 字符串。
- 在 Prompt load/HTTP 等待期间修改原 taskData 或 references 后，实际请求与输出引用校验仍使用调用开始时的同一份快照。
- 动态指令 sentinel 只出现在 user JSON 数据中，不能改写 system/messages；合成敏感 sentinel 不进入错误。
- PMT-13 第一次请求使用旧 Prompt、第二次使用新 Prompt；两次 completion 内容分别稳定，单次调用不重读。
- Stub 耗尽明确失败；不依赖测试顺序、真实模型、时间或随机值。

**可定位测试名称**

- `typed calls exercise all five operations with fixed responses`
- `typed calls preserve legal empty and negative business results`
- `typed calls reject invalid model output after exactly one completion`
- `typed calls separate prompt task data and knowledge user context`
- `typed calls keep dynamic instruction sentinels in the user JSON field`
- `typed calls snapshot task data and references before awaiting`
- `typed calls reread a changed prompt on the next caller retry`
- `stub LLM fails deterministically when its fixed sequence is exhausted`

**验证命令**

```text
npm test -- tests/llm/llm-calls.test.ts
npm run verify
```

**审核证据**

- 五 operation 的请求数/成功数/非法输出数；每类 system/user 的字段级断言，不保存真实 Prompt 或背景。
- PMT-13 两轮请求中的 Prompt 版本摘要/合成 sentinel、completion 次数与错误/成功序列。
- full verify 退出码；生产 `src` 无 Stub/测试队列，无数据库/真实网络/重试/日志。

## 6. Fixture 与资源生命周期

- 临时目录统一使用现有 `tests/fixtures/temp-directory.ts` 的 `withTempDirectory()`；测试结束删除，不触碰真实 `config/prompts/`。
- Prompt 测试写入合成 UTF-8 Markdown，失败注入使用缺文件、目录冒文件等真实 fs 行为；不通过修改生产代码增加测试开关。
- T03 不监听 socket。注入 fetch 返回确定的 `Response`/`ReadableStream`；另用永不 settle/忽略 abort 的 fetch Promise、永不 settle 的 cancel Promise 和 reject 的 cancel 验证有界生命周期。所有 body、reader、timer、listener 在测试 finally 或客户端 finally 清理，迟到 rejection 必须被消费。
- Stub 队列和请求快照只在 `tests/fixtures/`，每个测试新建；不跨测试共享，不写磁盘，不使用真实 endpoint/model/key。
- 所有测试不联网、不读真实 User Context、不访问数据库、不依赖 `dist`、locale、时区、随机数或测试顺序。
- `npm test` 阶段不得读取 build 产物；`npm run verify` 按既有顺序执行 typecheck、test、build、smoke、format，无需新增 post-build probe。

## 7. 统一验证与证据格式

每个新的独立 worktree 首次执行下列 bootstrap，已有 `node_modules` 的同一 worktree 不重复 `npm ci`。每卡随后先执行定向测试，再执行一次 `npm run verify`；`verify` 已覆盖 toolchain、typecheck、全量 test、build、D00/D01 smoke 和 format:check，不重复运行无新故障的子步骤。`npm ci` 只安装锁文件中的现有依赖，不得改变清单或锁文件。

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
npm ci
npm run verify:toolchain
<本卡定向测试>
npm run verify
```

每卡回报固定包含：

1. Task ID、base/branch、base SHA、改动文件。
2. 逐命令退出码、测试通过/跳过数、可定位测试名。
3. Case 映射、实际执行平台、`NOT_RUN`、偏离和 blockers。
4. Prompt 摘要、请求字段、错误 code、字节计数、资源清理等最小证据，不粘贴完整 Prompt、User Context、Token、动态正文或供应商响应。
5. `git status --short` 与确认未越权修改 docs/config（T01 六个 Prompt 除外）/CI/依赖。

D02 Case 映射：

| 卡 | 覆盖 | 仍为后续/NOT_RUN |
| --- | --- | --- |
| T01 | PMT-08、PMT-09、PMT-10；PMT-13 的逐次读盘基础 | 完整调用重试、Runtime |
| T02 | PMT-07、PMT-14、PMT-15、PMT-03 的非法 Event ID结构部分 | 数据库不部分落库、真实语义判定 |
| T03 | HTTP 请求/envelope/超时/取消/错误安全基础 | 真实供应商、真实网络、业务重试 |
| T04 | 五类 typed call、固定 Stub/记录、PMT-13 | PMT-11/12 真实语义、完整 Runtime 两次预算 |

PMT-03/04/11/12 的模型语义效果不外推；固定 Stub 只证明请求、校验和错误处理。

## 8. 集成 Gate

四卡合并后由 Lead 组织 Architect 验收：

1. 从合并 commit 创建不含 `node_modules/dist/coverage` 的干净快照。
2. 前置精确工具链，确认 Node/npm 后运行 `npm ci` 和一次 `npm run verify`。
3. 核对最终 `config/prompts/` 恰有六个预期 Markdown，摘要与迁移前一致；无 `config/prompt/` 重复源、无 `.DS_Store` 纳入。
4. 复核 operation→Prompt 映射、五个 strict Schema、错误分类、请求协议和五 typed call 无第二套类型/映射。
5. 单独执行 T01～T04 定向测试并保存摘要；确认无真实网络、真实 User Context 测试、数据库访问或测试 Stub 进入 `src`。
6. 审计 sensitive sentinel：错误、README、测试失败输出不含密钥、Prompt、User Context 或供应商正文。
7. 本地记录 darwin-arm64 证据；未运行的真实 OpenAI-compatible Provider、真实模型语义、PMT-11/12、完整 Runtime 两次重试与业务落库均记 `NOT_RUN`。
8. push 不在本 Plan 的本地执行授权内。只有项目负责人另行明确授权 push 后，Lead 才可推送集成结果并等待远程 CI；必须记录 run URL、commit SHA、作业结论并确认 CI Success。未获 push 授权、未推送或未运行时记 `REMOTE_CI=NOT_RUN`，不得宣称满足 Intent 的远程 CI 条件，也不得给出 D02 最终 PASS。

D02 只有四卡、本地集成 Gate 和经授权运行的远程 CI 全部通过后才可申请里程碑验收。Plan/G3 本身不授予 PASS。

## 9. 风险与回滚

| 风险 | 监控/处理 | 回滚 |
| --- | --- | --- |
| 未跟踪 Prompt 被整目录误提交 | T01 精确六文件白名单、摘要、`git status`；禁止 `git add config/` | 移除错误 stage，保留原文；不重写 Prompt 迎合 Git |
| 独立 worktree 缺少主树未跟踪 Prompt | 用户批准后由 Lead 精确原字节复制并双方摘要核验；Worker 不跨 worktree 移动 | 丢弃任务 worktree；主工作区源文件始终保留直至验证完成 |
| 实际 User Context 以私人背景进入公开 Git | 概括职业/兴趣也按私人内容处理；执行批准中单独要求 `USER_CONTEXT_PUBLIC_GIT_APPROVAL` | 未获单独授权即不纳入 Git；保留原文并 BLOCKED，不自行改写或脱敏 |
| 目录出现双份 Prompt | Lead 只在 T01 worktree 目标目录建立副本；合并后摘要一致才备份并移出主树旧源 | 丢弃任务分支或恢复主树备份；不覆盖任一不同摘要文件 |
| Zod 默认 strip 未知字段 | 所有层级 strict object + 额外字段矩阵 | 回滚 Schema，不靠 Prompt 文字补漏 |
| 模型返回 Markdown/fence 被猜取 | 完整 `JSON.parse`，无修复/提取 | 返回 output JSON 错误，交上层预算 |
| Event/Topic 引用或 Update 归属写错 | 调用时显式快照，结构化后检查；无数据库查询 | 拒绝整个响应，不部分消费结果 |
| Update/No increment 决策矛盾 | 解析后按 event_id 检查指定冲突 | 回滚该响应，不进入落库 |
| 非流式 envelope 被供应商差异破坏 | 只接受已批准 Chat Completions stop content；安全协议错误 | 不带 body 重试；真实 Provider 兼容性另记 NOT_RUN |
| fetch/响应体/取消失败挂起 | fetch 与 abort race、逐 read race、实际字节上限、cancel rejection consumer、有界 cleanup | 阻断 T03；不放宽为无限等待 fetch/read/cancel |
| 重定向把鉴权带到其他地址 | `redirect:"error"`，不手工跟随 | 失败关闭，不接受响应 |
| 密钥/正文进入日志或 error | 不记录正文、错误不含 cause/body/query，sentinel 测试 | 阻断任务，删除不安全错误路径后重验 |
| timer/listener/reader 泄漏 | 每路径 finally 清理，超时/取消/成功/失败测试 | 阻断 T03，不依赖 GC 或进程退出兜底 |
| 客户端偷偷重试造成双重预算 | T03/T04 断言 fetch/completion 恰好一次；Runtime 不在范围 | 移除本地重试，未来只在业务总预算控制 |
| Stub/真实 User Context 混入测试 | Stub 仅 tests fixture；全部合成数据和临时目录 | 阻断 T04，生产 `src` 不保留测试替身 |
| 新增依赖或协议扩张 | 文件/依赖 diff 审计；只允现有 Zod/原生 fetch | 回滚依赖和协议改动，不在本卡扩范围 |

**当前实际状态**：Plan v0.2 为 `REVIEW`，G3 v0.1 已提出 CHANGES_REQUIRED 并已修订，G3 复评尚未进行。`USER_EXECUTION_APPROVAL=PENDING`、`USER_CONTEXT_PUBLIC_GIT_APPROVAL=PENDING`；Prompt 迁移、`npm ci`、代码实现、定向测试、full verify、干净快照、push、远程 CI、真实 Provider 和任何 Worker 执行均为 `NOT_RUN`。T01～T04 保持 `NOT_STARTED`。

## 10. G3 记录

| 记录 | 状态 | 说明 |
| --- | --- | --- |
| Lead Plan v0.1 · 2026-11-15 | `REVIEW` | 已固定四卡文件边界、operation/Prompt 映射、五类 Schema/引用、错误分类、HTTP 协议、typed calls、测试与 Gate；等待 Architect G3 |
| Architect G3 v0.1 · 2026-11-15 | `CHANGES_REQUIRED` | 要求补充跨 worktree 文件移交与 User Context 单独公开授权、typed call 输入快照、fetch/read/cleanup 全生命周期有界、修正 User Context 消息位置、worktree `npm ci`、远程 CI 待 push 授权门禁 |
| Lead Plan v0.2 · 2026-11-15 | `REVIEW` | 已逐项修订上述 6 类问题；未执行任务，等待 Architect G3 复评 |
