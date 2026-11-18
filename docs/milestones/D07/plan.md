# D07 Plan：Knowledge Analysis 知识价值判断与保存

> 版本：v0.2
> 版本轨迹：v0.1 首版；v0.2 按 Architect G3 修订移除 Clock 依赖（`knowledge` 表无时间字段）。
> 状态：`APPROVED · Architect G3 PASS`
> 日期：2026-11-18
> 计划参考基线：main `9f70eac273fabc498cf7c8dce9607ad74f3340bf` / tree `f087a32e3541fed197175c11f9463f0e6f7ac4c0`
> Intent：`docs/milestones/D07/intent.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`）
> Spec：`docs/milestones/D07/spec.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`；G3 修订已应用）

本文只把当前 D07 Intent/Spec 映射为文件级实施计划；不构成任何上游/G3 批准、Worker 创建或开发执行授权。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标与不可变更边界

D07 交付一个无 HTTP route 的 Knowledge Analysis 组件：

- 以 Content ID 为唯一任务输入；Content 不存在时返回 `{knowledge_id: null}`，不调用 LLM、不写库。
- 只读取本次 Content 的 `title`、`body`、`summary`、`author`、`published_at`、`completeness`，组装精确六字段 `taskData`。
- 在事务外只调用一次 D02 `analyzeKnowledge`（P-04）；响应严格 Schema、60 秒总超时、2 MiB 上限、非流式及不重试均由 D02 负责，D07 不复制或放宽 Schema。
- `valuable=false` 是合法业务结果：不写「无价值」记录、不写任何其他表，返回空 ID。
- `valuable=true` 只在短同步事务内写入一份 Knowledge；Finding 仅是 `findings_json` 内嵌数组，没有独立 ID、表、队列或 RSS 任务。
- `category` 缺省或 `null` 一律写 SQL `NULL`；`findings=[]` 合法，写入 JSON 文本 `[]`。
- 点查当前 `content_id`：已有 Knowledge 时直接复用同一 ID，不调用 LLM、不改变既有行；这不属于历史 Knowledge 语义检索。
- `UNIQUE(content_id)` 保证一份 Content 至多一份 Knowledge；不同 Content 即使正文相同，也分别判断并各有独立 Knowledge。
- D07 只返回 `{knowledge_id: string | null}`；TopicMatching 派发、Runtime、队列和重试归 D15。

明确不做：

- 不做 Event Search、Event Analysis、Event Update、Topic Matching、Published Item、RSS、Retrieval 或 Adapter/Collection/Processing 变更。
- 不查询历史 Knowledge 做语义去重、增量比较、评分、排序、Translation、语言识别或正文 Hash。
- 不修改 D01 DDL、D02 typed calls/响应 Schema/Prompt、D04 Adapter、D05 Collection、D06 Processing、CI、配置 API、app/server/lifecycle、package/lock。
- 不新增表、字段、索引、ORM、模块级单例、队列、Outbox、缓存、限速、降级或提交后派发。
- 测试不访问真实模型、真实 API Key、公网或真实 `config/prompts`；一律使用 StubLLM/stub typed calls 与临时合成 Prompt 目录。

若实现需要改变公共契约、错误码、Prompt 注入、事务语义、DDL、枚举或返回字段，停止该卡并交 Architect；Worker 不得现场扩写设计。

## 2. 上游事实与文件布局

### 2.1 只读上游核对结论

- `src/database/schema.sql`：`knowledge.content_id` 为 `NOT NULL UNIQUE` 且引用 `contents(id)`；`category` 可为 `NULL`；`findings_json` 必须通过 `json_valid` 且 `json_type='array'`。
- `src/llm/response-validators.ts`：`KnowledgeAnalysisResponse` 是 `valuable` 判别联合；两个分支均为 `strictObject`，`valuable=false` 只允许一个字段；`valuable=true` 的必需字段、Category 枚举与 findings 条目由 D02 严格校验。
- `src/prompt/prompt-repository.ts`：仅 `knowledge-analysis` 读取 `knowledge-analysis.md` 与 `user-context.md`；其余 operation 的 `userContext` 恒为 `null`。
- `src/llm/llm-calls.ts`：Knowledge 的 user content 精确为 `{ task_data, user_context }`；Prompt 每次调用重新读盘，D07 不缓存。
- `src/database/transaction.ts`：`withTransaction()` 使用同步 callback 与 `BEGIN IMMEDIATE`，拒绝 async function/thenable。
- `src/processing/*`：复用其风格与现有只读 `ContentRepository` 类型；不得修改 Processing 文件。

### 2.2 模块职责

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/knowledge/content-input.ts` | 当前 Content 点读、六字段 task data 的严格投影与内部类型 | T01 |
| `src/knowledge/knowledge-errors.ts` | 四个稳定 Knowledge 错误码与安全映射 | T02 |
| `src/knowledge/knowledge-logger.ts` | 只含白名单元数据的安全 logger 契约 | T02 |
| `src/knowledge/knowledge-call.ts` | 事务外单次 P-04 调用、取消、错误与 valuable 分支安全处理 | T02 |
| `src/knowledge/knowledge-repository.ts` | `knowledge` 参数化点读/插入与 row/DTO 映射 | T03 |
| `src/knowledge/knowledge-persistence.ts` | 单同步事务 recheck、插入、读回、唯一冲突回滚后复用 | T03 |
| `src/knowledge/contracts.ts` | 公共 options/result/service/dependencies 类型 | T04 |
| `src/knowledge/knowledge.ts` | 最终编排与 `createKnowledgeAnalysis` factory | T04 |
| `src/knowledge/index.ts` | 唯一公共导出边界 | T04 |

### 2.3 输入与公共返回契约

T01 内部 task data 固定为：

```ts
interface KnowledgeTaskData {
  title: string;
  body: string;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  completeness: "FULL" | "PARTIAL";
}
```

- 禁止 `content_id`、Content 全对象 spread、`raw_data`、原始 HTML、Source Item、Source、Topics、历史 Knowledge、Prompt 文本或 Token。
- T01 只接受现有只读 `Pick<ContentRepository, "getById">`；不得创建第二套 Content 持久化实现。
- 缺失 Content 返回内部 `null`，不抛领域错误；空字符串/纯空白等非法 ID 在 T04 服务入口、任何 DB 访问前映射 `invalid_input`。

T04 公共契约固定为：

```ts
interface KnowledgeOptions { readonly signal?: AbortSignal }

interface KnowledgeResult {
  knowledge_id: string | null;
}

interface KnowledgeService {
  analyze(contentId: string, options?: KnowledgeOptions): Promise<KnowledgeResult>;
}

function createKnowledgeAnalysis(
  dependencies: KnowledgeDependencies,
): KnowledgeService;
```

`KnowledgeDependencies` 必须显式包含 `database`、只读 ContentRepository、KnowledgeRepository 读取/插入依赖、仅 `analyzeKnowledge` 所需的 typed calls、`idGenerator` 与 logger；**不含 `clock`**。`knowledge` 表无时间字段，故不注入 Clock；禁止新增时间列、时间戳或日志时间字段。

### 2.4 严格响应、错误与日志

D02 是唯一 Schema 来源。T02 只负责单次调用边界、判别分支和错误映射，不得添加第二份 Zod/JSON Schema。

D07 公共稳定错误码固定为：

| code | 安全 message | 触发边界 |
|---|---|---|
| `invalid_input` | `Invalid knowledge input` | ID 不是非空字符串；DB/LLM 前失败 |
| `aborted` | `Knowledge analysis was aborted` | pre-abort、调用中取消、调用返回后已取消 |
| `knowledge_failed` | `Knowledge operation failed` | Content 点读、Knowledge 点读/事务/插入/读回失败 |
| `llm_failed` | `Knowledge LLM call failed` | Prompt 读取、JSON/Zod Schema、底层模型/typed call 失败 |

公共 error 不保留 `cause`、Zod issues、模型原文、Prompt、SQL 或 Token。logger 只允许：

```ts
{
  contentId?: string;
  knowledgeId?: string;
  stage: "check" | "analyze" | "persist" | "reuse";
  reason?: KnowledgeErrorCode;
  valuable?: boolean;
}
```

日志 best-effort，logger 自身失败不得改变业务结果；禁止正文、摘要、findings、Prompt、模型输出或 Token。

### 2.5 Knowledge Repository 与事务

T03 `KnowledgeRepository` 固定提供：

```ts
interface KnowledgeFinding {
  title: string;
  description: string;
}

type KnowledgeCategory = "Insight" | "Experience" | "Method" | "Resource";

interface KnowledgeDraft {
  id: string;
  content_id: string;
  title: string;
  summary: string;
  category: KnowledgeCategory | null;
  findings: KnowledgeFinding[];
  value: string;
}

interface KnowledgeRecord extends KnowledgeDraft {}

interface KnowledgeRepository {
  getByContentId(contentId: string): KnowledgeRecord | null;
  insert(draft: KnowledgeDraft): KnowledgeRecord;
}
```

Repository 只使用 `knowledge` 表的七个现有字段，全部参数绑定；`findings_json` 只能由 `JSON.stringify(draft.findings)` 生成并读回解析。`insert` 内部以私有 SELECT 读回，不向公共接口增加任意读/写 seam。Repository 本身不自带事务。

`KnowledgePersistence.ensureKnowledge(contentId, draftWithoutId)` 使用现有 `withTransaction()`：

1. 事务内先按 `content_id` recheck；已存在则原样返回，不改行。
2. 否则调用注入的 `IdGenerator.next()` 生成 ID，插入一份 Knowledge，再按 ID 读回。
3. 回调必须同步；不得调用 LLM、网络或异步 logger。
4. 任一步失败整体回滚，不留下半完成 Knowledge。
5. 插入遇到 SQLite 唯一约束时，事务先回滚；随后按同一 `content_id` 再点读，存在则复用，不存在则把安全失败交由 T04 映射 `knowledge_failed`。
6. 不同 Content 不做跨文章合并；相同正文仍各自插入。

T04 服务先点查当前 `content_id` 的 Knowledge；已有则零 LLM。`valuable=true` 后进入 T03 事务。事务前的 LLM 调用由 T04 真实 SQLite + StubLLM hook 直接证明。

## 3. 四卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | 当前 Content 六字段投影、缺失 Content 空内部结果 | 无错误码、无 LLM 调用边界、无 Knowledge 持久化 |
| T02 合并后 | 单次 P-04 边界、D02 错误映射、取消、价值分支与安全日志 | 无最终服务、无 Knowledge 写入、无真实 SQLite 集成 |
| T03 合并后 | Knowledge Repository、单事务插入、recheck、唯一冲突复用 | 无公共 factory、无端到端 valuable 分支 |
| T04 合并后 | 公共 factory、真实 SQLite + StubLLM + 合成 Prompt 集成 | 只表示实现及本地任务能力完成；仍须 G4、merge、集成 Gate、CI 与最终验收 |

四卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 与独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。未获 Architect G4 对冻结 tree 的批准，不得创建 candidate。

| Case | 主责任卡 | 交叉验证 |
|---|---|---|
| `KNO-01` | T02 valuable=true 分支；T03 单行插入；T04 端到端 | DB 字段来自 D02 校验后的响应 |
| `KNO-02` | T02 valuable=false；T04 零 Knowledge/零下游写入 | Content 保留 |
| `KNO-03` | T03 three findings → 一行 JSON 数组 | T04 端到端无独立 Finding 表/队列 |
| `KNO-04` | T03 recheck/唯一；T04 重复执行零 LLM | 行数与字段不变 |
| `KNO-05` | T03 不同 Content 独立插入；T04 相同正文两次执行 | 两个 Knowledge ID |
| `KNO-06` | T01 六字段投影和只读依赖；T04 Prompt/call spy | 无 Topics、历史 Knowledge、raw_data |
| `KNO-08` | T02 经 D02 拒绝非法 Schema；T04 零写入 | 缺字段、非法 findings/category |
| `KNO-11` | T02 `category:null`/`findings:[]` 合法；T03 SQL NULL/`[]` | T04 真实 SQLite |
| `KNO-12` | T02 valuable=false 额外字段经 D02 拒绝 | T04 零部分写入 |

`KNO-07/09/10` 属 S0/S1 真实模型语义回归，不在 D07 P0 Gate 内；本计划不得把它们写成 Stub 通过或冒充最终 PASS。

## 4. D07-T01 · Content 点读与 P-04 六字段输入组装

### 4.1 依赖与精确允许写集

- 前置：D07 Plan 获 G3 批准后的精确执行基线；首个 Worker 固定该批准/执行基线 SHA，禁止从任意后续 SHA 开始。
- 新增且仅允许写：`src/knowledge/content-input.ts`。
- 新增且仅允许写：`tests/knowledge/content-input.test.ts`。
- 只读复用：`src/processing/content-repository.ts` 的 `ContentRepository`/`ContentRecord` 类型。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：`spec.md` §1、§3；`KNO-06`，并为 `KNO-01`、`KNO-02`、`KNO-05` 提供规范输入。

### 4.2 禁止范围

- 不得修改 Processing、LLM、Prompt、Database、Adapter、Collection、app/server/lifecycle、配置 API、CI、package/lock。
- 不得实现错误码、KnowledgeRepository、事务、Knowledge 写入、公共 factory、Logger、Topic/Event/Runtime。
- 不得读取 Topics、历史 Knowledge、Source Item、raw_data 或真实 Prompt/config。
- 不得导入真实 `fetch`/Adapter，不得调用 LLM、IdGenerator 或数据库写语句。

### 4.3 实现要求

1. 提供内部函数按 ID 调用一次注入的 `contentRepository.getById(contentId)`；缺失返回 `null`。
2. 只从 Content 记录显式投影六字段；不得对象 spread，不得把 `id`、`url`、`created_at`、`language` 等其他字段带入 task data。
3. `summary`、`author`、`published_at` 保持可空，不得造值；`completeness` 只允许现有 `FULL|PARTIAL`。
4. 输入组装函数无 I/O 副作用、无模块级可变状态，重复调用输出深等价。
5. 测试用 fake ContentRepository spy 证明只对当前 ID 调用一次 `getById`，且不读取第二个 Content。
6. 测试通过临时目录仅放 `knowledge-analysis.md` 与 `user-context.md` 两个合成文件，并经真实 `PromptRepository` + `createTypedLlmCalls` + StubLLM 流动一次 T01 task data；捕获请求必须证明两个 Prompt sentinel 分别进入 system/user context，且 task data 精确六字段。
7. 使用 raw-data、Topic、历史 Knowledge sentinel 证明 task data/user JSON 的 `task_data` 键集不含这些值；不得在测试中读取真实 Prompt 目录。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `KNO-06 / TASK_DATA` | 六字段键集/值与 Content 完全一致；无 `content_id`、raw_data、HTML、Topics 或历史 Knowledge |
| `CONTENT_READ` | `getById` 只调用一次且参数为当前 Content ID；缺失返回 `null` |
| `PROMPT_SOURCE` | 临时目录只有两份合成 Prompt；system 含分析指令 sentinel，user context 含背景 sentinel |
| `VALUE_SHAPES` | nullable summary/author/published_at 原样保留；FULL/PARTIAL 均不丢失 |

另测：同一输入重复调用无状态差异；不同 Content 输入各自投影；生产文件静态扫描不含 Topic/DB write/LLM/HTTP 依赖。

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/knowledge/content-input.test.ts tests/prompt/prompt-repository.test.ts tests/llm/llm-calls.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|raw_data|topics|knowledge' src/knowledge/content-input.ts tests/knowledge/content-input.test.ts || true
git diff --name-only <BASE_SHA> -- src/processing src/llm src/prompt src/database src/adapters src/collection src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后一条输出必须为空；静态扫描结果须逐条解释，不能把合法类型/测试名误报当失败。交回必须列出 base SHA、实际路径、Case 映射、命令结果、已知限制，并只报 `REVIEW`/`BLOCKED`。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE`（必须是 `9f70eac273fabc498cf7c8dce9607ad74f3340bf` 的后代且仅增加已批准 D07 文档） |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §4.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 5. D07-T02 · 严格响应边界、稳定错误、取消与安全日志

### 5.1 依赖与精确允许写集

- 前置：`D07-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增且仅允许写：`src/knowledge/knowledge-errors.ts`。
- 新增且仅允许写：`src/knowledge/knowledge-logger.ts`。
- 新增且仅允许写：`src/knowledge/knowledge-call.ts`。
- 新增且仅允许写：`tests/knowledge/knowledge-call.test.ts`。
- 只读复用：T01 `content-input.ts`、D02 `llm-calls.ts`/`response-validators.ts`、`tests/fixtures/stub-llm.ts`、`tests/fixtures/temp-directory.ts`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：`spec.md` §1、§4、§7；`KNO-01`、`KNO-02`、`KNO-08`、`KNO-11`、`KNO-12` 的调用/错误前置责任。

### 5.2 禁止范围

- 不得修改 D02 typed calls/validator/Schema/Prompt 或任何既有测试预期。
- 不得新增第二份 Zod/JSON Schema、重试、Provider 切换、超时实现或响应解析器。
- 不得写 Database，不得实现 Repository/事务/公共 factory；不得调用非 `analyzeKnowledge` operation。
- 不得把错误 `cause`、模型原文、Prompt、正文、摘要或 Token 写入 error/logger。
- 不得测试真实模型、真实 API Key、公网或真实 `config/prompts`。

### 5.3 实现要求

1. 提供 `KnowledgeError` 与固定四码/安全 message；提供 AbortError/`ABORT_ERR` 的安全归一化，不暴露底层 cause。
2. 提供白名单 `KnowledgeLogger` 及 best-effort log helper；日志参数类型本身拒绝正文、摘要、findings、Prompt 与 Token。
3. `knowledge-call.ts` 只接收 `KnowledgeTaskData`、`Pick<TypedLlmCalls, "analyzeKnowledge">`、logger 与 signal。
4. 调用前检查 signal；若已取消，在 typed call 前抛 `aborted`。
5. 精确调用一次 `typedLlmCalls.analyzeKnowledge(taskData, { signal })`；调用中与返回后再次检查取消；不自动重试、不调用其他 operation。
6. D02 返回的 union 直接作为唯一合法响应；本层不得重新解释/放宽 strict Schema。`valuable=false` 与 `valuable=true` 原样交回调用方。
7. typed call、Prompt 读取、JSON/Schema 失败统一映射 `llm_failed`；AbortError/取消优先映射 `aborted`。
8. 成功/失败日志只含 `contentId?`、`stage`、`reason?`、`valuable?`；不记录任何响应正文或 tasks data。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `KNO-01` | valuable=true 且有 3 findings 原样返回；typed call 恰好 1 次 |
| `KNO-02` | valuable=false 正常返回；不伪造 title/value，不抛技术错误 |
| `KNO-08` | 缺 value、非法 findings、非法 category、finding 额外字段经 D02 拒绝并映射 `llm_failed` |
| `KNO-11` | `category:null`、`findings:[]` 经 D02 保持合法 |
| `KNO-12` | valuable=false 带 title/value/extra 经 D02 拒绝，整体 `llm_failed` |
| `ERROR_SAFETY` | 错误 message 固定、无 cause、无 Zod issues、无模型原文/Prompt/Token |
| `ABORT / CALL_COUNT` | pre-abort 零 typed call；调用中取消/AbortError → `aborted`；非取消错误恰 1 次且 `llm_failed`，无重试 |

测试应由真实 `createTypedLlmCalls` + StubLLM + 仅含两份 Function/User Context 文件的临时合成目录提供严格响应证据；另用只实现 `analyzeKnowledge` 的同步 spy 证明调用次数、signal 引用透传和未调用其他 operation。logger 测试使用正文/摘要/findings/Prompt/Token sentinel 证明无泄漏。

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/knowledge/knowledge-call.test.ts tests/llm/response-validators.test.ts tests/llm/llm-calls.test.ts tests/prompt/prompt-repository.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(' src/knowledge/knowledge-errors.ts src/knowledge/knowledge-logger.ts src/knowledge/knowledge-call.ts tests/knowledge/knowledge-call.test.ts || true
rg -n 'routeProcessing|searchEvents|analyzeEvents|matchTopics' src/knowledge/knowledge-call.ts || true
git diff --name-only <BASE_SHA> -- src/llm src/prompt src/database/schema.sql src/adapters src/collection src/processing src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后一条及生产文件非 `analyzeKnowledge` operation 扫描必须为空。交回格式同 T01；本卡通过只表示调用/错误边界 PASS，不表示持久化或服务完成。

### 5.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T01_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §5.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 6. D07-T03 · Knowledge Repository、单事务写入与唯一冲突复用

### 6.1 依赖与精确允许写集

- 前置：`D07-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 新增且仅允许写：`src/knowledge/knowledge-repository.ts`。
- 新增且仅允许写：`src/knowledge/knowledge-persistence.ts`。
- 新增且仅允许写：`tests/knowledge/knowledge-repository.test.ts`。
- 新增且仅允许写：`tests/knowledge/knowledge-persistence.test.ts`。
- 只读复用：`src/database/transaction.ts`、`src/id/id-generator.ts`、T01/T02 文件、`tests/fixtures/database.ts`、`tests/fixtures/sequence-id-generator.ts`、`tests/database/transaction.test.ts`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：`spec.md` §2、§5、§6、§7；`KNO-01`、`KNO-03`、`KNO-04`、`KNO-05`、`KNO-11`。

### 6.2 禁止范围

- 不得修改 DDL、D01 Database、D02 LLM/Prompt、D06 Processing、T01/T02 文件或既有测试。
- 不得调用 LLM、HTTP、Adapter、Logger、Runtime 或下游任务。
- 不得创建 Finding 独立实体/ID/表、事件或 Topic；不得跨 Content 合并、Hash 或查找全部历史 Knowledge。
- 不得用字符串拼接 SQL，不得暴露任意 SQL/事务 seam，不得加入内存缓存或模块级单例。
- 不得在事务 callback 中执行 async、thenable、网络、LLM 或异步 logger。

### 6.3 实现要求

1. Repository 固定 `SELECT ... WHERE content_id = ?` 与 `INSERT` 七字段；所有值绑定；`changes===1`、读回存在且 `content_id` 一致，否则失败。
2. `insert` 只写 `knowledge` 一行，`category=null` 绑定 SQLite `NULL`，`findings_json` 用 `JSON.stringify` 且必须是数组。
3. row 映射必须区分 SQL `NULL` 与空字符串；不得为 Category 填空值，不得把 findings JSON 展开为其他行。
4. `ensureKnowledge` 使用真实 `withTransaction()`；事务内先按当前 `content_id` recheck，已存在则返回既有行，不生成 ID/不插入。
5. 无既有行时用注入 IdGenerator 生成 ID、插入并读回；成功后 `db.inTransaction===false`，只有一行。
6. 插入异常必须回滚。仅 SQLite 唯一约束错误允许事务外按同一 `content_id` 再点读；存在则复用，不存在则重新抛出供 T04 安全映射。
7. 注入 after-insert/readback failure 时 `knowledge` 行数不变；thenable callback 由现有 helper 拒绝且 rollback。
8. 两个不同 Content 相同正文/相同模型字段仍分别插入；同一 Content 重复 ensure 复用且不更新既有字段。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `KNO-01` | 七字段参数绑定/读回完整；content_id 正确；事务内插入，提交后一行可见 |
| `KNO-03` | findings 为 3 项时仍只有 1 行，`findings_json` 解析为 3 项且无 Finding 其他表 |
| `KNO-04` | 已有 content_id recheck 返回同一 ID，行数/字段不变，无插入 |
| `KNO-05` | 两个不同 content_id 即使正文完全相同也各有独立行 |
| `KNO-11` | category null 在 DB 中 `typeof === "null"`；findings=[] 精确为 `[]` JSON 数组 |
| `UNIQUE` | 直接重复 content_id 触发真实 SQLite 唯一约束；行数不增 |
| `UNIQUE_RECOVERY` | stale recheck + 已提交竞争行导致的唯一冲突回滚后，同一 content_id 点读复用既有 ID |
| `ROLLBACK` | insert/readback 失败后无半完成 Knowledge；thenable callback 被拒绝 |

另测：不存在返回 null；SQL 传空字符串不会被映射为 null；SQLite/Parser 细节只在内部失败，不写日志；`getByContentId` 只查询当前 ID，不扫描 Topics/Events/其他 Knowledge。

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/knowledge/knowledge-repository.test.ts tests/knowledge/knowledge-persistence.test.ts tests/database/transaction.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(' src/knowledge/knowledge-repository.ts src/knowledge/knowledge-persistence.ts tests/knowledge/knowledge-repository.test.ts tests/knowledge/knowledge-persistence.test.ts || true
rg -n 'routeProcessing|searchEvents|analyzeEvents|analyzeKnowledge|matchTopics|fetchContent|topics|events' src/knowledge/knowledge-repository.ts src/knowledge/knowledge-persistence.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

后两条生产范围扫描和禁止 diff 必须为空。交回格式同 T01；本卡通过只表示 Repository/事务/幂等能力 PASS。

### 6.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T02_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §6.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 7. D07-T04 · 公共 factory、fixture 与真实 SQLite 集成

### 7.1 依赖与精确允许写集

- 前置：`D07-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 新增且仅允许写：`src/knowledge/contracts.ts`。
- 新增且仅允许写：`src/knowledge/knowledge.ts`。
- 新增且仅允许写：`src/knowledge/index.ts`。
- 新增且仅允许写：`tests/fixtures/knowledge.ts`。
- 新增且仅允许写：`tests/knowledge/knowledge-service.test.ts`。
- 新增且仅允许写：`tests/knowledge/knowledge-integration.test.ts`。
- 只读复用：T01～T03、D02 `createTypedLlmCalls`/`PromptRepository`/validator、现有 `SqliteContentRepository`、`openDatabase`/`initializeDatabase`、SequenceIdGenerator/StubLLM/temp database 工具。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：`spec.md` §1～§8；全部 `KNO-01`～`KNO-06`、`KNO-08`、`KNO-11`、`KNO-12` 的最终集成证据。

### 7.2 禁止范围

- 不得修改 T01～T03 文件；若集成暴露其接口缺陷，交 Lead 重走对应任务卡，不得在 T04 重写。
- 不得修改 D01 Schema/DDL、D02 LLM/Prompt/validator、D04 Adapter、D05 Collection、D06 Processing、CI、app/server/lifecycle、配置 API、package/lock。
- 不得实现 TopicMatching、Event、Published Item、Runtime、队列、重试、HTTP route、Cron、配置接线或下游派发。
- 不得读取真实 `config/prompts`、真实模型/API Key、网络、私密环境或未跟踪文件。
- 不得新增第二条 ContentRepository 写实现、测试后门、公共 SQL/事务 seam 或模块级状态。

### 7.3 实现要求

1. `contracts.ts` 只暴露 Spec 的 Options/Result/Service/Dependencies、必要 Repository Pick 类型与稳定错误/logger 类型；不暴露内部 parser、SQL、事务或测试 seam。
2. `index.ts` 只导出 `createKnowledgeAnalysis`、`KnowledgeError` 与公共 type；不得导出 Runtime/factory 依赖集合之外的服务入口或下游任务。
3. 服务入口顺序固定：空字符串/纯空白 ID → `invalid_input`；pre-abort → `aborted`；当前 content_id Knowledge 点查 → 命中直接复用；Content 点查 → 缺失空结果；组装六字段；事务外单次 P-04；valuable=false 空结果；valuable=true 时以 `category ?? null`、findings 原数组构造 T03 draft 并 ensure；返回 `{knowledge_id}`。
4. 既有 Knowledge 零 LLM；不同 Content 始终对各自 ID 点查，绝不扫描历史 Knowledge。
5. DB/Content/Knowledge/Persistence 失败映射 `knowledge_failed`；Prompt/typed call/JSON/Schema 失败映射 `llm_failed`；取消优先 `aborted`；不得把底层详情放 message/cause。
6. 每处 logger best-effort，只记录白名单；logger 自己失败不得改变 result/error。
7. `tests/fixtures/knowledge.ts` 提供：合成 Content 插入/读取、Knowledge 行数/row 读取、两个 Prompt 合成目录、D02 typed calls spy（非 analyzeKnowledge 一律 unexpected）、StubLLM request capture、captured logger、SequenceIdGenerator、真实临时 DB harness 和 sentinel。
8. 真实 SQLite 集成使用公共 `createKnowledgeAnalysis`、真实 `SqliteContentRepository`、真实 `SqliteKnowledgeRepository`/T03 persistence、D02 `createTypedLlmCalls`、StubLLM 与仅两份 Prompt 的合成目录。
9. 在 StubLLM.complete hook 中直接断言：`db.inTransaction===false`、目标 Content 可见且 `contents count=1`、`knowledge count=0`；证明 LLM 在事务外且写入尚未发生。成功返回后 Knowledge count=1。
10. 成功 valuable=true 路径 `typed analyzeKnowledge calls=1`、`stub.requests.length=1`。已有 Knowledge、missing Content、invalid input、pre-abort、valuable=false、Schema invalid 分别断言 LLM 次数为 0 或 1 的精确值；禁止只写“无重试”而不断言次数。
11. 解析 `stub.requests[0].userContent`，其 `task_data` 精确为六字段且键序/键集稳定；`user_context` 等于合成背景 sentinel。`systemContent` 含合成分析指令 sentinel且不含背景/任务正文；只有 `knowledge-analysis` Prompt load 一次。
12. 使用彼此不同的 Content/raw/Topic/history/Token/Prompt sentinel 证明 `task_data` 不含 `content_id`、raw_data、Topics、历史 Knowledge 或 Token；正文 sentinel只在 `task_data.body` 出现，logger/system 不泄漏。
13. 测试结果字段精确 `{knowledge_id}`；valuable=false/missing/reuse 也使用同一 snake_case 结构，不返回 valuable、Knowledge 全对象或下游任务。
14. 真实 DB 断言：D02 的 category 缺省或显式 null 都按 `category ?? null` 写 SQL NULL；findings=[] 为 `[]`；3 findings 一行；重复执行一行且零 LLM；两个 Content 相同正文两行；Schema invalid/事务失败零部分写入；Content 行保持。
15. 测试后关闭 SQLite；无 server/socket/timer/unhandled rejection、WAL/SHM 或真实网络依赖残留。

### 7.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `KNO-01` | 真实 DB valuable=true → `{knowledge_id}`、1 行、字段来自 D02 合法结果、LLM 恰一次 |
| `KNO-02` | valuable=false → null、Knowledge count=0、Content 行不变、无下游写入 |
| `KNO-03` | 3 findings → 1 Knowledge、`findings_json` 长度 3、无独立 Finding 实体/表 |
| `KNO-04` | 首次写入后重复 analyze → 同 ID、requests 仍 1、行数不变 |
| `KNO-05` | 两 Content 相同正文 → 两 Knowledge ID/两行；各自 Content 只点读 |
| `KNO-06` | 当前 Content + 两份 Prompt 唯一来源；六字段 task data；无 Topics/历史 Knowledge/raw_data |
| `KNO-08` | valuable=true 缺字段/findings 非法/category 非法 → `llm_failed`、零 Knowledge |
| `KNO-11` | category 缺省与显式 null 均合法并保存 SQL NULL；findings [] 为 JSON `[]` |
| `KNO-12` | valuable=false 额外字段 → `llm_failed`、零 Knowledge/Content 不变 |
| `CALL_ORDER` | StubLLM hook 中 `inTransaction=false`、Content 可见、Knowledge count=0；返回后 count=1 |
| `MISSING / INVALID / ABORT` | missing→null、invalid/pre-abort 在 DB 前失败、均零 LLM/零写入 |
| `PRIVACY` | logger/user/system 无正文/摘要/findings/Prompt/Token/raw sentinel；错误无 cause/SQL/Zod/model 原文 |

另测：已有 Knowledge 预置后 analyze 零 LLM 且既有字段不变；owned repository failure → `knowledge_failed`；LLM failure → `llm_failed` 且零 Knowledge；logger throw 不改变结果；两个 factory 无共享状态；factory 不持有 Clock，无时间依赖；无真实 Prompt/model/API Key/公网。

### 7.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/knowledge tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts
npx vitest run tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts tests/processing/processing-integration.test.ts tests/database/transaction.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(' src/knowledge tests/knowledge tests/fixtures/knowledge.ts || true
rg -n 'routeProcessing|searchEvents|analyzeEvents|matchTopics|fetchContent|config/prompts|process\.env|apiKey' src/knowledge || true
git diff --name-only <BASE_SHA> -- src/database/schema.sql src/llm src/prompt src/adapters src/collection src/processing src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后两条生产范围扫描和禁止 diff 必须为空。测试只允许临时合成 Prompt 与 StubLLM。交回须附真实 SQLite + D02 StubLLM 集成测试名/PASS、call 次数、transaction hook、SQL NULL/`[]`、零真实网络证据，并只报 `REVIEW`/`BLOCKED`。

### 7.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T03_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §7.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；不得由 Lead 代替 Worker 编码，也不得让 Worker 自行创建 candidate。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 `HEAD`/tree，tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case 映射、错误/隐私、禁止路径、no-op 与全部定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
6. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
7. **Merge**：Lead 在 D07 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
8. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
9. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

每卡必须在 `progress.md` 记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结与 candidate 只使用精确 SHA，不以 branch 名或工作目录代替证据。

## 9. D07 集成 Gate 与最终验收

四卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行并提交以下证据：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/knowledge
npx vitest run tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/transaction.test.ts tests/database/schema-constraints.test.ts tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database/schema.sql src/llm src/prompt src/adapters src/collection src/processing src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

Gate 必须保留：

- `KNO-01/02/03/04/05/06/08/11/12` 的 D07 P0 责任逐项映射与真实 SQLite 证据；`KNO-07/09/10` 明确为 S0/S1，不由本 Gate 冒充。
- **事务外单次 LLM 的直接证据**：StubLLM.complete hook 内 `db.inTransaction===false`、目标 Content 已可见且 `contents count=1`、`knowledge count=0`；调用后 valuable=true 才出现一行。
- **调用次数/输入直接证据**：成功 valuable=true 为 `typed analyzeKnowledge calls=1`、Stub `requests=1`；已有 Knowledge、missing、invalid input、pre-abort 为 0；valuable=false 与 Schema invalid 各为 1 次且无自动重试。`task_data` 精确六字段。
- **Prompt 来源与隐私直接证据**：合成目录恰好 `knowledge-analysis.md` + `user-context.md`；system 只含分析指令、user 只含 `user_context` 背景；raw/Topic/history/Token sentinel 不进入 task data、system 或 logger。
- **写入不变量**：valuable=false 零 Knowledge；invalid Schema/LLM failure/事务 failure 零部分写入；category null 是 SQL NULL；findings [] 是合法空 JSON 数组；3 findings 仍一行；同 Content 重复零 LLM；不同 Content 相同正文各自一行。
- **边界隔离**：无 Event、Topic、Published Item、Finding 表、Runtime/queue/dispatch/HTTP route；DDL、Prompt/Schema、CI、Adapter、Collection、Processing、App/Server/Lifecycle、配置 API、package/lock 零未批准 diff。
- 五份功能 Prompt 与 User Context 相对 `9f70eac273fabc498cf7c8dce9607ad74f3340bf` 哈希不变；测试资源全部关闭。

Lead 提交 `D07_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 依持续授权复核本地 Gate、push 已批准 main SHA、等待精确 SHA 的远程 CI Success，并完成最终角色/工作区归档与心跳清理。本地 Gate、远程 CI 与 Architect 最终验收全部满足前不得签发 `D07_FINAL_PASS`。

G3 批准且正式开发触发后，由 Architect 创建唯一 D07 推进心跳（默认 `*/10 * * * *`，`Asia/Shanghai`）并在 `progress.md` 记录准确 ID；Lead 不自行创建心跳。最终 PASS 后由 Architect 核验并归档全部 D07 Worker/Workspace 与 D07 Lead，删除准确心跳并复查删除结果。

## 10. 风险、回滚与停止条件

- 上游门禁：D07 Intent/Spec 当前仍为 `DRAFT · G1_PENDING_OWNER_APPROVAL`。Plan 可以继续接受 G3 修订，但在上游获批且 G3 PASS 前不得进入开发。
- Schema 漂移：D02 是唯一 strict Schema。若 D02 实际行为与 Spec §4 不符，标 `BLOCKED` 交 Architect，不在 D07 复制/修补 Schema。
- 幂等与并发：先按当前 content_id 点查不是历史语义检索；事务内 recheck + UNIQUE 是写入不变量。唯一冲突必须在事务回滚后再点读，不得在失败事务内伪造复用。
- 事务边界：不得用代码结构间接声称事务外调用；T04 必须在真实 SQLite 的 StubLLM hook 内直接断言 transaction=false 且 Knowledge 尚未写入。
- Prompt/隐私：只读取临时合成目录；若测试读取真实 `config/prompts` 或把 user context 注入其他 operation，立即 `FAIL`。
- 任何失败按 `BLOCKED`/`FAIL` 记录。同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分或 Spec 根因；涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 只将当前 D07 Intent/Spec 映射为四张严格串行、文件级可执行任务卡，没有新增业务需求、公共返回字段、DDL、Prompt、依赖或替代任务 ID。
- T01～T04 均列出精确允许写集、依赖/base、Spec/Case 映射、禁止范围、验证命令与冻结/candidate/merge/archive 证据字段。
- D07 只调用 P-04 `analyzeKnowledge` 一次且事务外；valuable=false 零写入；valuable=true 单行；点查复用；UNIQUE 冲突回滚后复用；两篇同正文独立 Knowledge；Finding 内嵌 JSON。
- D07 不包含 Event Analysis/Search、Topic Matching、Published Item、RSS、Runtime 或派发；KNO-07/09/10 明确为 S0/S1 非 P0。
- 当前结论：`PENDING · Architect G3`。本文件不是批准记录，不授权创建 Worker 或启动正式开发。
