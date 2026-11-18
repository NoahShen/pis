# D08 Plan：Event Search 历史候选召回

> 版本：v0.2
> 状态：`APPROVED · Architect G3 PASS`
> 日期：2026-11-18
> 计划参考基线：main `4104f15ad706b3165358b3f0108ae9bff282809c` / tree `69089c9993577bdb8c8a25dded4b4c95da3b607f`
> Intent：`docs/milestones/D08/intent.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`）
> Spec：`docs/milestones/D08/spec.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`）

本文只把当前 D08 Intent/Spec 映射成四张文件级、严格串行的任务卡。v0.1 曾获 G3 批准；负责人随后确认 D08 并要求可配置 Update 窗口，故 v0.2 须重新交由 Architect 审核。Git 中 Intent/Spec 状态行仍标 G1 pending，待 Architect 按门禁同步；当前不创建 Worker、心跳或 candidate。D08 只能只读候选召回：不执行 P-03，不写 Event、Update、证据、别名或 FTS，不接 Runtime/HTTP/生产配置。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标、公共结果与不可变更边界

D08 交付无 HTTP route 的只读 Event Search 服务：

- 入口接收 Content ID；非法 ID 在任何 DB/LLM 前映射 `invalid_input`，pre-abort 在任何 DB/LLM 前映射 `aborted`。
- 当前 Content 只点读一次；缺失返回 `{candidates: []}`，不调用 P-02、不查询候选。
- 只显式投影当前 Content 的 `title/body/summary/author/published_at/completeness` 六个字段；禁止对象 spread、Content ID、raw_data、Topics、历史 Event 或 Knowledge。
- 事务外恰好一次 D02 `searchEvents`；输入 user content 只有 `task_data`，不加载或注入 `user_context`。strict JSON/Schema 由 D02 唯一负责。
- `clues=[]` 是成功空结果：P-02 恰一次后直接返回，候选 Repository 零调用、业务表与 FTS 零写入。
- 有 clues 但无候选也是成功空结果；不得错误化或虚构 Event。
- 三路召回：`events.entity_name` 精确 BINARY 匹配、`event_entity_aliases.alias` 精确 BINARY 匹配、`event_search MATCH` 聚合全历史文本。
- FTS 每个检索词独立参数绑定双引号短语；内部双引号翻倍。禁止字符串拼接 SQL、FTS `*`/`NEAR`/列过滤/操作符注入与 bm25 语义评分。
- 同一 Event 跨 clue/索引只保留一个候选；同一别名文字属于不同 Event 时按 Event ID 保持独立。
- 先覆盖全部历史召回、去重和确定性排序，再按 `maxCandidates` 截断；默认 10，可在依赖构造时配置整数 `1..50`。
- 排序严格依次使用：直接实体或别名命中优先、命中不同 clue 数 DESC、FTS 命中检索词数 DESC、`discovered_at` DESC、Event `id` BINARY ASC。首次出现 clue 序号只作为内部证据，不增加第六级排序键。
- 只对截断后的每个候选读取 Event 基本资料和最近 Update 窗口；`maxUpdates` 默认 10，可配置为 `0..100` 的整数。`maxUpdates > 0` 时 SQL 按 `discovered_at DESC, id DESC LIMIT ?` 取数并把配置值作为参数绑定；`maxUpdates = 0` 时不执行 Update 查询，候选仍返回且 `updates: []`。DTO 将查询结果反转为旧→新。
- Update 窗口仅影响 DTO/P-03 上下文，不影响全历史 FTS 召回、候选集合或候选排序；窗口外历史仍由 D01 聚合 FTS 参与召回。
- 所有 Content、候选、上下文和 FTS 读取均在写事务外；D08 从不开启写事务。

公共返回契约固定为：

```ts
interface EventSearchOptions {
  readonly signal?: AbortSignal;
}

interface EventSearchResult {
  candidates: EventCandidate[];
}

interface EventSearchService {
  search(
    contentId: string,
    options?: EventSearchOptions,
  ): Promise<EventSearchResult>;
}

interface EventCandidate {
  id: string;
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
  updates: EventCandidateUpdate[];
}

interface EventCandidateUpdate {
  id: string;
  event_id: string;
  title: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
}
```

明确不做：P-03、NEW_EVENT/NEW_UPDATE/NO_INCREMENT、Event/Update/证据/确认别名写入、FTS 刷新或重建、第二次 LLM、向量召回、bm25 语义排序、Topic/Knowledge/Published Item/RSS、Runtime/queue/retry/dispatch、HTTP route、Cron、生产装配。不新增依赖、Clock、IdGenerator、表、列、索引或缓存。

若实现需要改变 DTO、排序、错误码、Prompt 注入、事务语义或 D01/D02 契约，停止该卡并交 Architect；Worker 不得现场扩写设计。

## 2. 上游事实与文件布局

### 2.1 只读核对结论

- `src/database/schema.sql`：`events.entity_name` 与 `event_entity_aliases.alias` 均有普通索引且默认 BINARY collation；`event_updates` 有 `(event_id, discovered_at DESC)` 索引；`event_search` 是 `fts5(event_id UNINDEXED, search_text, tokenize='trigram')` 可重建派生索引。
- `src/database/event-search.ts`：FTS 聚合文本包含 Event `title/entity_name/subject/scope/description`、全部确认别名和全部历史 Update 的 `title/description`。D08 只查询该索引，不调用或修改刷新/重建实现。
- `src/llm/response-validators.ts`：`EventSearchResponse` 是 strict object，`clues` 可空；每个 clue 只允许 `entity_name/subject/search_terms`，三者均拒绝空白，额外字段/错误类型被 D02 拒绝。
- `src/llm/llm-calls.ts`：`searchEvents()` 只把 task data 放入 user content；除 `knowledge-analysis` 外不注入 User Context。调用会自动 clone task data 并向底层透传 signal。
- `src/prompt/prompt-repository.ts`：`event-search` 只读取 `event-search.md`，返回 `userContext=null`；不得读取真实 Prompt/User Context。
- `src/processing/content-repository.ts`：可只读复用 `Pick<ContentRepository, "getById">`；不创建第二套 Content 持久化实现。
- `tests/database/event-search.test.ts`：已有 D01 证据证明全历史 Update 聚合、短实体/别名普通索引及刷新行为；D08 资格测试只读使用这些既有能力，不改 D01 测试预期。

### 2.2 模块职责

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/event-search/content-input.ts` | 当前 Content 点读与精确六字段内部 task data | T01 |
| `src/event-search/event-search-errors.ts` | 四个稳定错误码、安全 message、Abort 归一化 | T01 |
| `src/event-search/event-search-call.ts` | 事务外单次 `searchEvents`、错误/取消映射 | T01 |
| `src/event-search/fts-phrase.ts` | FTS 双引号短语字面量编码 | T02 |
| `src/event-search/event-candidate-repository.ts` | 三路只读召回、参数绑定、内部 clue 证据与 Event ID 去重 | T02 |
| `src/event-search/candidate-ranking.ts` | 五级确定性排序与上限截断 | T03 |
| `src/event-search/candidate-context.ts` | Event 基本资料与可配置 `0..100` 的最近 Update 窗口读取 | T03 |
| `src/event-search/contracts.ts` | 公共 Options/Result/Service/DTO/Dependencies 类型 | T04 |
| `src/event-search/event-search-logger.ts` | 白名单安全日志与 best-effort 包装 | T04 |
| `src/event-search/event-search.ts` | 最终服务编排与 `createEventSearch` factory | T04 |
| `src/event-search/index.ts` | 唯一公共导出边界 | T04 |

### 2.3 内部召回证据

T02 的 Repository 不向公共入口暴露 SQL、clues 或分数，但需保留以下内部结构供 T03 确定性排序与定向测试：

```ts
interface EventCandidateClueEvidence {
  readonly clueIndex: number;
  readonly directEntityHit: boolean;
  readonly aliasHit: boolean;
  readonly ftsMatchedTerms: readonly string[];
}

interface EventCandidateHit {
  readonly eventId: string;
  readonly discoveredAt: string;
  readonly firstClueIndex: number;
  readonly clueEvidence: readonly EventCandidateClueEvidence[];
}

interface EventCandidateRepository {
  search(clues: readonly EventCandidateClue[]): EventCandidateSearchResult;
}

interface EventCandidateSearchResult {
  readonly hits: EventCandidateHit[];
  readonly ignoredIndexRows: number;
}
```

- `clueEvidence` 每个 clue 最多一项；同一 Event 跨 clue 合并，`eventId` 是唯一去重键。
- `firstClueIndex` 仅为 Spec 要求的内部首次出现证据，不参与最终排序。
- `ftsMatchedTerms` 保存该 clue 内实际命中的唯一检索词字面量；跨 clue 排序时按不同字面量并集计数，重复字符串不虚增强度。
- 直接实体与别名命中分别记录；二者任一为真即进入排序第一优先级。
- FTS 派生行若无法关联冻结的 `events`，只累计 `ignoredIndexRows`，绝不把孤儿 ID 放进 hits；T04 只据此写白名单安全日志。

### 2.4 稳定错误、取消与日志

T01 固定四码和安全 message：

| code | message |
|---|---|
| `invalid_input` | `Invalid event search input` |
| `aborted` | `Event search was aborted` |
| `event_search_failed` | `Event search operation failed` |
| `llm_failed` | `Event search LLM call failed` |

- `EventSearchError` 不保留 cause、SQL、Zod issues、Prompt、模型输出、正文、检索词或 Token。
- Abort 归一化至少识别 `name=AbortError`、`code=ABORT_ERR` 与 D02 `LLM_CANCELLED`；任何已中止 signal 优先于底层错误。
- T04 logger 只允许 `contentId`、`candidateCount`、`clueCount`、`stage`、`reason`；stage 仅 `check|extract|search|context`，reason 仅四个稳定错误码。
- 运行时重新白名单组对象；logger 同步抛错或异步 rejection 均被吞掉，不改变结果/错误。禁止正文、clue、候选标题、Prompt、模型输出或 Token。

### 2.5 配置与事务边界

- 服务构造器保存 `maxCandidates = dependencies.maxCandidates ?? 10`；若不是 `1..50` 的整数，factory 同步抛 `RangeError("maxCandidates must be an integer from 1 to 50")`。这是依赖配置错误，不进入 `search()` 的四码业务错误表。
- 服务构造器保存 `maxUpdates = dependencies.maxUpdates ?? 10`；若不是 `0..100` 的整数，factory 同步抛 `RangeError("maxUpdates must be an integer from 0 to 100")`。每个服务实例持有自己的 `maxUpdates`，禁止模块级配置。
- `database` 只用于 T03 的候选上下文参数化读取；候选检索 Repository 自身持有同一 Database。依赖不含 Clock、IdGenerator。
- 服务不调用 `withTransaction()`；T04 在 StubLLM hook、候选 Repository wrapper 和上下文读取 wrapper 内直接断言 `db.inTransaction === false`。

## 3. 四卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | Content 六字段投影、单次 P-02、错误/取消、空 clues 响应 | 无候选检索、排序、上下文或公共 factory |
| T02 合并后 | 三路全历史召回、FTS 字面量、跨来源 Event ID 去重 | 无排序截断、Update 上下文或最终服务 |
| T03 合并后 | 五级排序、候选上限、Event 详情与可配置 `0..100` 的最近 Update 窗口 | 无公共 factory、loader 或真实 SQLite 端到端 |
| T04 合并后 | 公共契约/factory、fixture、真实 SQLite + StubLLM + 合成 Prompt 集成 | 只表示实现及本地任务能力，仍须 G4、合并、集成 Gate、CI 与最终验收 |

四卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 和独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。未获 Architect 对精确冻结 tree 的 G4 批准，不得创建 candidate。

| Case | 主责任卡 | 交叉验证 |
|---|---|---|
| `EVT-06` | T02 同实体不同 Subject 的独立 clue 证据；T04 两事项端到端 | 同名实体不被自动合并 |
| `EVT-10` | T02 十年前 Event 的标准名/别名/FTS 三路召回 | T04 全历史成功结果 |
| `EVT-11` | T03 默认窗口 10、窗口调大/调小/0、同时间 ID 决胜 | T04 DTO 旧→新与实例配置 |
| `EVT-21` | T01 空 clues 成功；T04 Repository 零调用/零写入 | P-02 恰一次 |
| `EVT-22` | T02 空命中的 SearchResult；T04 成功空候选 | 不虚构 Event |
| `EVT-23` | T02 窗口外旧 Update FTS 召回；T03/T04 上下文不偷加窗口外 Update | 不改变候选集合 |
| `EVT-24` | T02 同别名两个 Event 独立；T03 各自上下文 | T04 不混淆 |
| `DEDUPE` | T02 Event ID 去重与 clue 证据合并 | T03/T04 只输出一个候选 |
| `CANDIDATE_LIMIT` | T03 全集合排序后按 `maxCandidates` 截断 | T04 默认 10、可配置 1..50 |
| `UPDATE_LIMIT` | T03 按 `maxUpdates` 读取 Update 窗口 | T04 默认 10、可配置 0..100、0 零 Update SQL |
| `FTS_LITERAL` | T02 引号、操作符、SQL 样式文本均为参数短语 | T04 恶意检索词零写入 |
| `MISSING/INVALID/ABORT` | T01/T04 顺序与次数 | DB/LLM 前拒绝 |
| `ERROR` | T01 LLM；T04 DB/Content/候选/上下文 | 安全错误不透底 |
| `PMT-09` | T01/T04 真实 D02 合成 Prompt 证明无 `user_context` | 不读取真实 config |
| `PMT-15` | T01/T04 event-search 非法 JSON/Schema/额外字段拒绝 | D02 strict Schema |
| `PRIVACY` | T01/T04 task data、logger、错误 sentinel | 无正文/Prompt/Token 泄漏 |

`PMT-02` 是 S0 真实模型语义回归，不属于 D08 P0 Gate；固定 Stub 不得冒充真实 P-02 语义质量。EVT-19/20 属 D09/后续真实模型判断，也不纳入 D08。

## 4. D08-T01 · Content 点读、P-02 六字段输入与单次调用边界

### 4.1 依赖与精确允许写集

- 前置：D08 Intent/Spec 获批且 Plan 获 G3 批准后的精确执行基线；首个 Worker 固定该批准/执行基线 SHA。
- 新增且仅允许写：`src/event-search/content-input.ts`。
- 新增且仅允许写：`src/event-search/event-search-errors.ts`。
- 新增且仅允许写：`src/event-search/event-search-call.ts`。
- 新增且仅允许写：`tests/event-search/content-input.test.ts`。
- 新增且仅允许写：`tests/event-search/event-search-call.test.ts`。
- 只读复用：`src/processing/content-repository.ts`、D02 `llm-calls.ts`/`response-validators.ts`、`src/prompt/prompt-repository.ts`、`tests/fixtures/stub-llm.ts`、`tests/fixtures/temp-directory.ts`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2、§5、§6、§7；`EVT-21` 的 LLM 恰一次/空 clues 前置，`PMT-09`、`PMT-15`，并为 EVT-06/10/22/23/24 提供规范输入。

### 4.2 禁止范围

- 不得修改 Processing、Database/DDL/FTS、D02 LLM/validator/Prompt、Adapter、Collection、D07 Knowledge、app/server/lifecycle、配置 API、CI、package/lock。
- 不得实现候选 Repository、ranking、candidate context、公共 factory、Runtime 或任何数据库写语句。
- 不得增加第二份 Zod/JSON Schema、重试、Provider 切换、超时实现或响应解析器。
- 不得读取 Topics、历史 Event/Knowledge、Source Item、raw_data、真实 Prompt/config、真实模型/API Key 或网络。

### 4.3 实现要求

1. `loadEventSearchTaskData()` 只接受 `Pick<ContentRepository, "getById">`；恰好一次调用当前 ID，缺失返回内部 `null`。
2. 内部 task data 固定六字段 `title/body/summary/author/published_at/completeness`，逐字段显式投影；禁止 spread、`id`、`url`、`created_at`、`language`、Content ID 或 raw data。
3. 可空字段原样保留，`completeness` 仅使用现有 `FULL|PARTIAL`；函数无模块级可变状态。
4. `EventSearchError` 精确实现四码/message；Abort 检测安全读取 shape，不访问敏感 message/cause。
5. `callEventSearch()` 只接受 task data、`Pick<TypedLlmCalls, "searchEvents">` 和 signal。pre-abort 零调用；否则恰好一次 `searchEvents(taskData, { signal })`。
6. 调用中取消、返回后已取消及 AbortError/`ABORT_ERR`/`LLM_CANCELLED` 映射 `aborted`；其他 Prompt/模型/JSON/Schema 失败映射 `llm_failed`。
7. D02 返回的 `EventSearchResponse` 原样交回；`clues=[]` 不转错误、不补猜 clues。不得再次解析 JSON 或校验 Schema。
8. 公共 error 不保留 cause；不得把模型原文、Prompt、正文、clue、Token 写入 error。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `TASK_DATA / PRIVACY` | 六字段键集/值精确；nullable 原样；无 id/url/raw/Topic/history/HTML/Token |
| `CONTENT_READ` | 当前 ID 恰一次；缺失返回 null；不同 Content 各自投影 |
| `P02_CALL / SIGNAL` | 只调用 `searchEvents` 恰一次；task data 与 signal 原样；无重试 |
| `EVT-21_PRE` | 合法 `{clues: []}` 原样成功；不进入候选逻辑 |
| `PMT-09` | 临时目录只有合成 `event-search.md`；真实 PromptRepository + StubLLM；user JSON 只有 `task_data`，无 `user_context` |
| `PMT-15` | 非法 JSON、缺字段、错误类型、外层/clue 额外字段经 D02 拒绝并映射 `llm_failed` |
| `ABORT / ERROR_SAFETY` | pre-abort 零调用；调用中/返回后取消优先 `aborted`；非取消错误恰一次且 `llm_failed`；无 cause/Prompt/模型原文 |

另测：同一输入重复调用输出深等价；system 含合成 event-search 指令 sentinel 且不含 task data；生产文件无 DB write、候选索引、Topics/Event 历史读取或 fetch。

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search/content-input.test.ts tests/event-search/event-search-call.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|raw_data|topics|event_search|analyzeEvents|judgeEvent' src/event-search/content-input.ts src/event-search/event-search-errors.ts src/event-search/event-search-call.ts tests/event-search/content-input.test.ts tests/event-search/event-search-call.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后一条禁止 diff 必须为空；静态扫描命中须逐条解释，不能把故意注入的隐私 sentinel 或合法测试名误报为失败。交回必须列 base SHA、实际路径、Case 映射、命令结果、已知限制，并只报 `REVIEW`/`BLOCKED`。本卡通过只表示输入与单次 P-02 边界 PASS，不表示候选召回完成。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE`（必须是 `4104f15ad706b3165358b3f0108ae9bff282809c` 的后代且只增加已批准 v0.2 D08 文档） |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §4.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 5. D08-T02 · 三路候选 Repository、FTS 字面量与跨来源去重

### 5.1 依赖与精确允许写集

- 前置：`D08-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增且仅允许写：`src/event-search/fts-phrase.ts`。
- 新增且仅允许写：`src/event-search/event-candidate-repository.ts`。
- 新增且仅允许写：`tests/event-search/fts-phrase.test.ts`。
- 新增且仅允许写：`tests/event-search/event-candidate-repository.test.ts`。
- 只读复用：`src/database/schema.sql`、`src/database/open-database.ts`、`src/database/schema.ts`、`src/database/event-search.ts`、D01 tests/fixtures、T01 类型。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §3.1、§3.2、§3.3、§5、§6、§7；`EVT-06`、`EVT-10`、`EVT-22`、`EVT-23`、`EVT-24` 的搜索部分，`DEDUPE`、`FTS_LITERAL`。

### 5.2 禁止范围

- 不得修改 D01 DDL/FTS 实现、D02 LLM/Prompt、D06 Processing、D07 Knowledge、T01 文件、app/server/lifecycle、配置 API、CI、package/lock。
- 不得刷新/重建/插入/更新/删除 `event_search` 或任何业务表；不得创建 Event/别名/Update。
- 不得对候选 SQL 加 `LIMIT`、近期时间过滤、bm25 排序或语义分数；不得引入向量/新依赖。
- 不得拼接用户值到 SQL；不得把 clue、检索词、FTS SQL 或内部命中证据放进公共 DTO/日志。
- 不得持久化临时 `search_terms`，不得把 clue 写入 `event_entity_aliases`。

### 5.3 实现要求

1. `toFtsPhrase(term)` 返回 `"` + `term.replaceAll('"', '""')` + `"`；空格保持为一个短语，不拆 OR，不追加通配符/NEAR/列过滤。
2. `SqliteEventCandidateRepository.search(clues)` 为每个 clue 独立执行：
   - `events.entity_name` 对 `clue.entity_name` 的精确 BINARY 查询；
   - `event_entity_aliases.alias` 对 `clue.entity_name` 的精确 BINARY 查询并关联真实 `events`；
   - 对 `clue.entity_name`、`clue.subject` 和每个 `search_terms` 字面量分别执行 `event_search MATCH ?`，参数必须由 `toFtsPhrase()` 生成。
3. 三路 SQL 全部参数绑定；直接/别名/FTS 均关联 `events` 取得 `id/discovered_at`，无法关联真实 Event 的派生索引行忽略并只累计 `ignoredIndexRows`，不创建业务实体。
4. 每条 SQL 均显式使用 BINARY 语义；FTS 不引用用户值拼接，不使用 `ORDER BY bm25`。不设置召回 SQL 上限。
5. 以 Event ID 为唯一去重键合并所有 clue/来源；同一 Event 保存 clue evidence、直接/别名布尔值和该 clue 命中词并集，首个 clue 序号取最小索引。
6. 同 entity_name、不同 subject 的 clue 必须保留各自 clueIndex；不同 Event 即使 alias 文字相同也不合并。
7. Repository 返回全部历史 `hits` 与安全的 `ignoredIndexRows` 计数，不排序截断；排序/上下文归 T03。空 clues 返回 `{hits: [], ignoredIndexRows: 0}` 且不执行 SQL。
8. 不捕获或吞 SQLite/FTS 异常；交 T04 统一映射 `event_search_failed`。不得记录原始 SQL/检索词/事件 ID。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-06 / CLUE_IDENTITY` | 同一 entity 两个不同 subject 各保留 clueIndex；候选不被主体名相同吞并 |
| `EVT-10 / THREE_ROUTES` | 十年前 Event 分别可经标准名、确认别名、FTS 召回；无时间过滤 |
| `EVT-22 / EMPTY` | 有合法 clues、无命中时返回 `{hits: [], ignoredIndexRows: 0}` 而非异常；不创建 Event |
| `EVT-23 / OLD_UPDATE` | 检索词只在默认 Update 窗口以外的第 1 条历史 Update 时仍由 FTS 命中；候选召回不受 `maxUpdates` 限制 |
| `EVT-24 / SAME_ALIAS` | 两 Event 同 alias 返回两个独立 hits，各自 discoveredAt 正确 |
| `DEDUPE` | 同一 Event 被标准名、别名、多个 terms/多 clues 命中仍只有一项，证据合并完整 |
| `FTS_LITERAL` | 双引号、括号、冒号、星号、NEAR、SQL 样式文本无 FTS 语法错/注入；表快照不变 |
| `SHORT_TERM` | 1-2 字符实体/别名仍走普通精确索引；不依赖 trigram 命中 |
| `PARAMETERS / READ_ONLY` | 所有值绑定；调用前后全部业务表及 event_search 快照逐字段一致；fetch 零调用 |
| `ORPHAN` | 手工孤儿 `event_search` 行被忽略、只累计 `ignoredIndexRows`，不产生虚构候选 |

另测：`toFtsPhrase()` 的 exact wrapping/double-quote escaping；重复 `search_terms` 不重复累计证据；`event_search` 存在重复派生行时同一 Event 仍去重；生产 SQL 无模板字符串插入 clue 值。测试可先使用 D01 `refreshEventSearch`/`rebuildEventSearch` 建 fixture，但生产 Repository 不得调用它们。

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search/fts-phrase.test.ts tests/event-search/event-candidate-repository.test.ts tests/database/event-search.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|INSERT|UPDATE|DELETE|refreshEventSearch|rebuildEventSearch|bm25|LIMIT' src/event-search/fts-phrase.ts src/event-search/event-candidate-repository.ts tests/event-search/fts-phrase.test.ts tests/event-search/event-candidate-repository.test.ts || true
rg -n 'MATCH|toFtsPhrase|entity_name|alias' src/event-search/event-candidate-repository.ts
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空；静态扫描中的测试 fixture seeding 或合法 `MATCH` 需逐条解释，生产文件不得出现刷新/写操作或 `LIMIT`。交回格式同 T01。本卡通过只表示候选召回与去重 PASS，不表示排序或 DTO 完成。

### 5.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T01_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §5.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 6. D08-T03 · 确定性排序、候选上限与可配置 Update 窗口

### 6.1 依赖与精确允许写集

- 前置：`D08-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 新增且仅允许写：`src/event-search/candidate-ranking.ts`。
- 新增且仅允许写：`src/event-search/candidate-context.ts`。
- 新增且仅允许写：`tests/event-search/candidate-ranking.test.ts`。
- 新增且仅允许写：`tests/event-search/candidate-context.test.ts`。
- 只读复用：T02 `EventCandidateHit`、`src/database/open-database.ts`/`schema.ts`、`src/database/event-search.ts`、tests/fixtures/database.ts。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§3.3、§4、§5、§6、§7；`EVT-11`、`EVT-23`、`EVT-24`，`CANDIDATE_LIMIT`、`UPDATE_LIMIT`，并为 `EVT-10` 提供上下文阶段证据。

### 6.2 禁止范围

- 不得修改 T01/T02 文件、DDL/FTS 刷新、D02、Processing、Knowledge、app/server/lifecycle、配置 API、CI、package/lock。
- 不得重新做三路 SQL 召回、按时间过滤 Event、加载窗口外 Update 到 DTO、写入/刷新任何表。
- 不得生成时钟、ID、别名、证据、Event/Update，或调用 LLM/Adapter/HTTP/Runtime。
- 不得把测试 matcher 或测试专用 seam 放进生产接口；不得暴露 clues、检索词、bm25 或内部排序分数。

### 6.3 实现要求

1. `rankEventCandidates(hits, maxCandidates)` 只对已去重 hits 排序；比较键严格依次为：
   1. 任一 clue `directEntityHit || aliasHit` 为真；
   2. `clueEvidence.length` DESC；
   3. `clueEvidence.flatMap(ftsMatchedTerms)` 的不同字面量集合大小 DESC；
   4. `discoveredAt` DESC（BINARY/ISO-8601 字符串）；
   5. `eventId` BINARY ASC。
2. `firstClueIndex` 可保留但不进入比较器；不得以 `bm25`、相关度浮点、当前时间或插入顺序补充排序。
3. 先对全部 hits 完整排序，再 `slice(0, maxCandidates)`；函数不得接收或添加 SQL 召回限制。测试覆盖 1/10/50 与超过上限集合。
4. `loadEventCandidateContexts(database, rankedHits, maxUpdates, signal?)` 只处理排序后的候选 ID，按稳定输入顺序读取 Event 基本字段；若 Event 在读取时已不存在则跳过，不创建替代对象。
5. Event 查询只选 `id/title/entity_name/subject/scope/description/occurred_at/discovered_at`，参数绑定当前 Event ID。
6. `maxUpdates > 0` 时 Update 查询精确为 `WHERE event_id = ? ORDER BY discovered_at DESC, id DESC LIMIT ?`；event ID 与窗口值均参数绑定，row 映射区分 null 与空字符串。
7. `maxUpdates = 0` 时对每个候选仍读取 Event 基本资料，但完全不执行 Update SQL，并返回 `updates: []`。
8. 查询结果在 DTO 中整体 `.reverse()`，因此旧→新；同一 discovered_at 的选取由 id DESC 决定，反转后同时间按 id ASC 呈现。
9. 不加载窗口以外 Update 到 DTO；窗口外历史仍已由 T02 FTS 覆盖。无候选时零上下文 SQL。
10. `maxUpdates` 只传入 T03 上下文阶段；不得传给 T02、改变 hits、候选顺序或 `maxCandidates` 截断。
11. 上下文读取不开启事务；每个候选/Update 读取前后检查 signal，已取消映射 `aborted`，其他 SQLite 错误交 T04 映射 `event_search_failed`。不吞错。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-11 / UPDATE_WINDOW` | 同一 12 条 Update 在 `maxUpdates=0/1/10/100` 下分别输出 `[]`、最近 1、默认最近 10、全部 12；最新两条同 discovered_at 按 id DESC 取，DTO 反转后顺序精确 |
| `WINDOW_ZERO` | `maxUpdates=0` 仍返回候选/Event 基本资料，但 Update SQL 零调用；不是空候选 |
| `WINDOW_BINDING` | `LIMIT ?` 第二参数绑定当前实例的 1/10/100；SQL 文本不含写死窗口常量 |
| `EVT-23 / HISTORY_SPLIT` | 旧线索已在 T02 hits 中，但 T03 在当前 `maxUpdates` 窗口下不偷加窗口外 Update |
| `EVT-24 / ISOLATION` | 两个候选各自 Update 只按自身 event_id 读取，不串上下文 |
| `RANK_DIRECT` | 标准名/别名任一命中均优先于仅 FTS；direct 与 alias 同级 |
| `RANK_CLUE_COUNT` | 命中不同 clue 数多者优先；重复 clue evidence 不双计 |
| `RANK_FTS_COUNT` | 唯一 FTS 命中词数多者优先；重复词不虚增 |
| `RANK_TIME_ID` | 前三级相同后 discovered_at DESC；再同则 id ASC；`firstClueIndex` 不改变结果 |
| `CANDIDATE_LIMIT` | `maxCandidates` 全集合先排序后截断；1/10/50 边界；超过上限时保留稳定前 N；与 `maxUpdates` 互不替代 |
| `CONTEXT_SHAPE` | Event/Update 公共字段精确；occurred_at null 原样；无 clue/score/额外字段 |
| `READ_ONLY / NO_MATCHES` | 调用前后业务/FTS 快照一致，无 transaction；空 hits 零 SQL |

另测：Update 插入顺序与输出无关；候选 Event 不存在时跳过；Event discovered_at 与 Update 时间互不替代；0/1/10/100 窗口不改变 hits 与候选顺序；配置 0 时通过 Database wrapper 证明 `event_updates` 查询次数为 0；非零窗口通过 wrapper 捕获参数绑定；不调用 `refreshEventSearch`/`rebuildEventSearch`/`withTransaction`；SQL 不拼接 ID 或窗口值。

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search/candidate-ranking.test.ts tests/event-search/candidate-context.test.ts tests/database/event-search.test.ts tests/database/schema-consistency.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|INSERT|UPDATE|DELETE|withTransaction|refreshEventSearch|rebuildEventSearch|bm25|Date\.now|IdGenerator|Clock' src/event-search/candidate-ranking.ts src/event-search/candidate-context.ts tests/event-search/candidate-ranking.test.ts tests/event-search/candidate-context.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空；静态扫描为测试 fixture 命中的合法 SQL/seed 需逐条解释，生产两文件不得出现写、事务、刷新或时间相关非确定输入。交回格式同 T01。本卡通过只表示排序/上下文 PASS。

### 6.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T02_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §6.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 7. D08-T04 · 公共契约、factory、fixture 与真实 SQLite 集成

### 7.1 依赖与精确允许写集

- 前置：`D08-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 新增且仅允许写：`src/event-search/contracts.ts`。
- 新增且仅允许写：`src/event-search/event-search-logger.ts`。
- 新增且仅允许写：`src/event-search/event-search.ts`。
- 新增且仅允许写：`src/event-search/index.ts`。
- 新增且仅允许写：`tests/fixtures/event-search.ts`。
- 新增且仅允许写：`tests/event-search/event-search-service.test.ts`。
- 新增且仅允许写：`tests/event-search/event-search-integration.test.ts`。
- 只读复用：T01～T03、D02 `createTypedLlmCalls`/`PromptRepository`/validator、D01 `openDatabase`/`initializeDatabase`/event-search fixture、现有 `SqliteContentRepository`、StubLLM/temp database/database fixtures。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1～§8；全部 D08 P0 责任的最终集成证据，以及 `PMT-09`/`PMT-15` 的 end-to-end 证据。

### 7.2 禁止范围

- 不得修改 T01～T03 文件；若集成暴露其接口缺陷，交 Lead 重走对应任务卡，不在 T04 重写。
- 不得修改 D01 Schema/FTS、D02 LLM/Prompt/validator、D04 Adapter、D05 Collection、D06 Processing、D07 Knowledge、CI、app/server/lifecycle、配置 API、package/lock。
- 不得实现 P-03/Event Analysis、Event/Update/证据/别名/FTS 写、Topic/Knowledge/Published Item/RSS、Runtime/queue/retry/dispatch/HTTP route/Cron/生产装配。
- 不得读取真实 `config/prompts`、`config/prompt/user-context.md`、真实模型/API Key、网络、私密环境或未跟踪文件。
- 不得新增第二套 Content/候选 Repository、测试后门、公开 SQL/事务 seam、Clock/IdGenerator 或模块级状态。

### 7.3 实现要求

1. `contracts.ts` 暴露 Spec 的 Options/Result/Service/EventCandidate/EventCandidateUpdate 与依赖类型；依赖显式包含 `database`、只读 Content `getById`、T02 `EventCandidateRepository`、仅 `searchEvents` 的 typed calls、logger、可选 `maxCandidates` 与可选 `maxUpdates`。不得含 Clock/IdGenerator。
2. `index.ts` 运行时只导出 `createEventSearch` 和 `EventSearchError`；DTO/Options/Service/Dependencies 只作 type export，不导出内部 hit/SQL/parser。
3. `createEventSearch()` 分别验证 `maxCandidates` 与 `maxUpdates`；服务入口顺序固定：非法 Content ID → `invalid_input`；pre-abort → `aborted`；Content 点读一次 → 缺失空结果；六字段 task data → 事务外恰一次 P-02；空 clues → 空结果；仅按 `{entity_name, subject, search_terms}` 完全相等做稳定去重并保留首次出现，不 trim/归一化或按 entity 合并；T02 全历史召回；T03 排序/`maxCandidates` 截断；T03 使用本实例 `maxUpdates` 读取上下文；返回 `{candidates}`。
4. Content 读取异常映射 `event_search_failed`；候选/上下文/FTS/SQLite 异常映射 `event_search_failed`；LLM/Prompt/JSON/Schema 异常由 T01 映射 `llm_failed`；任何阶段已中止 signal 优先 `aborted`。候选 Repository 返回 `ignoredIndexRows>0` 时只写 `stage=search` 的白名单安全日志，记录孤儿行被忽略但不写 ID/text。`maxUpdates` 不得改变候选集合、候选顺序或 FTS 召回。
5. 每个同步读取/LLM 返回后检查 signal；取消不得继续下一阶段。不得把底层 cause/SQL/Zod issues/模型原文/Prompt/正文/检索词放进公共 error。
6. logger 入口只接受白名单字段，运行时重组对象；在 invalid/pre-abort/缺失/空 clues/空候选/成功/错误及 `ignoredIndexRows>0` 路径 best-effort 记录允许的 `stage` 与计数；logger failure 不改变结果/错误。
7. 仅在 Content 存在且 clues 非空时调用候选 Repository；clues=[]/缺失/非法/pre-abort/LLM 失败必须候选 Repository 零调用。
8. `tests/fixtures/event-search.ts` 提供：合成 Content、Event/Update/别名、D01 FTS 建 fixture、业务与 FTS 快照、临时 `event-search.md`、StubLLM request capture、candidate/context spy、captured logger、真实临时 DB harness 与隐私 sentinel。
9. 集成使用公共 factory、真实 `SqliteContentRepository`、T02 真实候选 Repository、T03 真实上下文读取、真实 `createTypedLlmCalls`/`PromptRepository`/StubLLM 与仅含 `event-search.md` 的临时目录。
10. 在 StubLLM、候选 Repository wrapper、上下文 wrapper 中直接断言 `db.inTransaction===false`；上下文 wrapper 还要记录当前实例传入的 `maxUpdates` 与 Update SQL 次数，不得通过代码结构间接声称“事务外”。
11. 每路径精确断言 `typed.searchEvents` 次数：缺失/非法/pre-abort 为 0；正常/空 clues/空候选/Schema 失败为 1；无重试。候选 Repository 次数：空 clues/缺失/非法/pre-abort/LLM 失败为 0；有 clues 恰 1。
12. `maxCandidates` 默认 10；测试 1、50、非法 0/51/小数/非数字同步 RangeError。构造超过上限的 Event 集，证明召回覆盖所有候选后再截断。
13. `maxUpdates` 默认 10；测试 0、1、10、100，非法 -1/101/小数/非数字同步抛精确 `RangeError`。两个实例配置相同 clues/候选但不同 `maxUpdates`，证明各自 Update 窗口独立，候选 ID/顺序和输入 clues 不变。
14. 解析 StubLLM user JSON：顶层只有 `task_data`；task_data 精确六字段；无 `user_context`、Content ID、raw/Topic/history/Token sentinel。system 只含合成 event-search 指令和 D02 schema，不含正文/背景 sentinel。
15. 真实 SQLite 断言三路召回、跨 clue/来源去重、同 alias 两 Event、窗口外旧 Update 仍召回、默认/调大/调小/0 Update 窗口、稳定排序和空结果；调用前后业务表及 FTS 全快照不变。
16. 测试后关闭 SQLite；无 server/socket/timer/unhandled rejection、WAL/SHM 或真实网络依赖残留；`globalThis.fetch` 与 Adapter spy 为零。

### 7.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-06` | 同实体两 Subject 产生两个相关候选/各自 clue 证据；不被实体名合并；输出仍按确定性顺序 |
| `EVT-10` | 十年前 Event 经标准名/别名/FTS 均可在集成服务召回 |
| `EVT-11` | 同一 12 Update 默认输出最近 10；调大为 100 输出全部、调小为 3 输出最近 3、0 输出 `[]`；同时间 ID 决胜；DTO 旧→新 |
| `EVT-21` | clues=[] → 空；P-02 1 次、候选 Repository 0、零写入/零下游 |
| `EVT-22` | 有 clues 无候选 → 空成功；不虚构 Event/不写库 |
| `EVT-23` | 第 1 条 Update 线索经 FTS 召回，DTO 只含当前实例 `maxUpdates` 窗口内记录；改变窗口不改变候选 |
| `EVT-24` | 同 alias 两 Event 都输出且各自上下文隔离 |
| `DEDUPE` | 多 clue/多来源同 Event 只一个 DTO；同 alias 不同 Event 保持两个 |
| `CANDIDATE_LIMIT` | `maxCandidates` 超过上限的全历史集合按五级键稳定截断；默认 10，支持 1/50 |
| `UPDATE_LIMIT` | `maxUpdates` 默认 10，支持 0/1/10/100；0 零 Update SQL，非零 `LIMIT ?` 参数绑定；与 `maxCandidates` 独立 |
| `FTS_LITERAL` | 引号/括号/冒号/星号/NEAR/SQL sentinel 正常参数化；无注入、无快照变化 |
| `MISSING/INVALID/ABORT` | 缺失空结果；非法/pre-abort DB/LLM 前失败；中途/返回后取消 `aborted` |
| `ERROR` | DB/Content/候选/上下文 → `event_search_failed`；LLM/Schema → `llm_failed`；message 固定、无 cause |
| `PMT-09` | 合成 `event-search.md` 唯一 Prompt；P-02 user content 无 `user_context` |
| `PMT-15` | 非法 JSON/缺字段/错误类型/额外字段 → `llm_failed`、零候选/零写入 |
| `PRIVACY` | task_data/system/logger/error 无正文/Topic/history/raw/Token/Prompt sentinel |
| `PUBLIC_SHAPE` | 结果只有 `{candidates}`；candidate/update 键集精确；未暴露 score/clues/source |

另测：factory 无共享状态；两个实例的 `maxCandidates` 与 `maxUpdates` 分别互不影响，不得把两个配置混用；logger throw/reject 不改变结果；公开类型不允许 Clock/IdGenerator；空候选时上下文零调用；FTS 孤儿行被忽略；candidate Event 详情缺失时跳过且不虚构。

### 7.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/event-search.test.ts tests/database/schema-consistency.test.ts
npx vitest run tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts tests/database/transaction.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|analyzeEvents|routeProcessing|analyzeKnowledge|matchTopics|event_content_links|published_items|topics|knowledge' src/event-search tests/event-search tests/fixtures/event-search.ts || true
rg -n 'INSERT|UPDATE|DELETE|withTransaction|refreshEventSearch|rebuildEventSearch|bm25|Clock|IdGenerator|Date\.now' src/event-search || true
rg -n 'config/prompts|config/prompt|process\.env|apiKey|user_context' src/event-search tests/event-search tests/fixtures/event-search.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空；生产扫描中合法 `event_search MATCH` 或目录名命中须逐条解释。测试只允许临时合成 Prompt、StubLLM 与真实临时 SQLite。交回须附真实 SQLite + D02 StubLLM 集成测试名/PASS、call/repository 次数、transaction wrapper、五级排序、两个独立上限、默认/调大/调小/0 Update 窗口、窗口外旧 Update 召回、只读快照、隐私与 fetch 零调用证据，并只报 `REVIEW`/`BLOCKED`。

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；不得由 Lead 代替 Worker 编码，也不得让 Worker 自行创建 candidate。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 `HEAD`/tree，tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case、错误/隐私、禁止路径、no-op 和全部定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch 路径/SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **同次交回硬门禁**：冻结完成后，Lead 必须在**同一次回复**中给出冻结 tree、patch 路径/SHA-256、路径数、blob、定向/full 验证数字与交回结论。若 Architect 只能从磁盘发现冻结产物，本卡退回流程重做，不接受事后补报。
6. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
7. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
8. **Merge**：Lead 在 D08 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
9. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
10. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

`progress.md` 每卡记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_PATH`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## 9. D08 集成 Gate 与最终验收

四卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行并提交以下证据：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search tests/database/event-search.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts tests/database/schema-consistency.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

Gate 必须保留：

- `EVT-06/10/11/21/22/23/24` 的 D08 搜索与上下文 P0 责任逐项 Case→测试文件/命令→PASS；EVT-19/20 与 `PMT-02` 明确为 S0/S1 非 P0。
- P-02 恰一次且事务外调用的直接证据；六字段 task_data、无 `user_context`、合成 Prompt 唯一来源。
- clues=[] 的 P-02 1 次、候选 Repository 0 次、业务/FTS 零写入；有 clues 无候选为成功空结果。
- 三路全历史召回、FTS 字面量注入测试、跨 clue/来源 Event 去重、同 alias 不同 Event 独立。
- 五级排序/`maxCandidates` 默认 10、可配置 1..50/去重后截断的顺序证据；候选上限不进入召回 SQL。
- `maxUpdates` 默认 10、可配置 0..100、每实例独立；非零按 `DESC,id DESC LIMIT ?` 参数绑定，0 零 Update SQL 且候选不消失；DTO 反转旧→新。
- 同一候选集在默认、调大、调小、0 Update 窗口下候选 ID/顺序不变；窗口外第 1 条 Update 仍可经 FTS 召回但不进入上下文。
- 对业务表与 `event_search` 的前后快照不变、`db.inTransaction=false`、`globalThis.fetch`/Adapter 零调用。
- 受保护路径 diff 为空；无 Prompt/DDL/FTS 刷新/Package/App/Server/Lifecycle 变化；无真实 Prompt/User Context/模型/API Key。
- 测试资源全部关闭。失败不得用重跑成功覆盖首次真实失败；D07 RSS 清理时序失败若复现，记录测试名/次数/环境并以定向复现区分已知观察项与 D08 回归，不弱化断言，也不擅自修改 D05。

Lead 提交 `D08_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 依持续授权复核本地 Gate、push 已批准 main SHA、等待精确 SHA 远程 CI Success，并完成最终角色/workspace 归档与心跳清理。本地 Gate、远程 CI 与 Architect 最终验收全部满足前不得签发 `D08_FINAL_PASS`。

G3 批准且正式开发触发后，由 Architect 创建唯一 D08 推进心跳（默认 `*/10 * * * *`，`Asia/Shanghai`）并在 `progress.md` 记录准确 ID；Lead 不自行创建心跳。最终 PASS 后由 Architect 核验并归档全部 D08 Worker/Workspace 与 D08 Lead，删除准确心跳并复查删除结果。

## 10. 风险、回滚与停止条件

- **上游门禁**：负责人本轮已明确确认 D08，但 Git 中 Intent/Spec 仍为 `DRAFT · G1_PENDING_OWNER_APPROVAL`，两者状态待 Architect 按权威流程同步。本 Plan 可供 v0.2 G3 审核，但在上游门禁记录和开发授权明确前不得进入开发；Plan 不自行修改或批准上游状态。
- **D02 契约漂移**：D02 是唯一 strict Schema。若实际行为与 Spec §2/§5 或严格的 task-data-only 输入不符，标 `BLOCKED` 交 Architect，不在 D08 复制/修补 Schema。
- **FTS trigram 边界**：1-2 字符不依赖 trigram；标准名/确认别名普通精确索引仍负责短词。不得为提升短词召回改用 LIKE、通配符或未批准语义评分。
- **排序口径**：`firstClueIndex` 是内部证据但不参与 Spec 五级排序；`discovered_at` 与 `id` 必须使用明确比较，不依赖 JS/SQLite 自然顺序。
- **配置边界**：`maxCandidates`（默认 10，`1..50`）与 `maxUpdates`（默认 10，`0..100`）是独立构造期依赖配置；非法值分别同步抛出规定的 RangeError，不得混淆、静默截断、退化为默认值或使用模块级值。
- **只读风险**：任何生产 SQL 写、FTS refresh/rebuild、事务开启或同进程 fixture 泄漏均判 BLOCKER；测试 seeding 与生产调用边界必须清楚。
- **已知观察项**：D07 报告的 RSS HTTP 清理时序失败保留为观察项；若 D08 full verify 复现，不得弱化/跳过测试，按 D05 先例定位环境与根因。
- **回滚**：每卡 candidate 以固定 base 单一 parent，必要时 revert merge commit；不得 reset 主线、覆盖其他里程碑或修改已批准上游来“修复”D08。
- 任何失败按 `BLOCKED`/`FAIL` 记录。同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分或 Spec 根因；涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 只把当前 D08 Intent/Spec 映射为四张严格串行、文件级可执行任务卡，没有新增公共返回字段、DDL、Prompt、依赖、Worker 或替代任务 ID。
- T01～T04 均列出精确允许写集、固定 base、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive 证据字段。
- D08 只读：一次 P-02、三路全历史召回、Event ID 去重、五级排序/`maxCandidates` 上限、每实例 `maxUpdates` 的默认/可配置 Update 窗口；`clues=[]` 与空候选均为成功空结果；不执行 P-03 或任何业务/FTS 写。
- `PMT-02` 明确为 S0 非 P0；`PMT-09`/`PMT-15` 的事件搜索部分由 T01/T04 覆盖；D07 RSS 时序失败不弱化。
- 当前结论：`D08_PLAN=G3_PENDING_ARCHITECT_REVIEW`。G3 复核通过前任务状态保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push 或最终验收。

- v0.1 `APPROVED`：Architect 核对 commit `69a2f0d16ac74405d1e7596ca48767aa772fc61b`、tree `6484e947eaf845edfb887d1128563dd3419486ca`；四卡精确写集、三路召回、FTS 字面量、五级排序、默认 Update 窗口、只读与隐私证明均符合当时 Spec。
- v0.2 `APPROVED`：同步负责人确认的 `maxUpdates` 可选依赖（默认 10，`0..100`，0 零 Update SQL，非零 `LIMIT ?` 参数绑定）；更新 T03 上下文、T04 factory/实例隔离与 0/1/10/100 集成证据。四卡写集、禁止范围及冻结即交回硬门禁保持不变；v0.1 的 G3 批准不自动覆盖本修订。

- G3 批准：commit `a5274c8cc735bb9b458c52c608db5b3b612f43c6`，tree `8be730d563859735ff0139d8759a828a41c17830`。负责人已确认开发；按持续授权启动 T01。
