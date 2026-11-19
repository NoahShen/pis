# D09 Plan：Event Analysis 新主线、进展与重复证据

> 版本：v0.1
> 状态：`DRAFT · G3_PENDING_ARCHITECT_REVIEW`
> 日期：2026-11-19
> 计划参考基线：main `2484b2876522027b5da4c95ca1b5c03e757d8139` / tree `e995e484a53d4ccbe0f15a90e8f5fbab07679b2c`
> Intent：`docs/milestones/D09/intent.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`）
> Spec：`docs/milestones/D09/spec.md`（`DRAFT · G1_PENDING_OWNER_APPROVAL`）

本文只把当前 D09 Intent/Spec 映射为五张文件级、严格串行的任务卡。当前不创建 Worker、心跳、candidate 或 merge；Lead 不批准 G3。G1/G2/G3 全部通过并明确进入开发前，五卡状态保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标、公共结果与不可变更边界

D09 交付无 HTTP route 的 Event Analysis 服务：

- 入口接收 Content ID；非法 ID 在任何 DB/LLM 前映射 `invalid_input`，pre-abort 在任何 DB/LLM 前映射 `aborted`。
- 调用一次注入的 D08 `EventSearchService.search(contentId,{signal})`；D09 不再调用 P-02、不另写候选检索。
- Content 缺失或 P-02 空 clues：D09 不调用 P-03、零业务写入，返回空 `new_targets`。
- 有 clues 但候选为空：仍恰一次调用 D02 `analyzeEvents`，允许合法 `NEW_EVENT`。
- P-03 task data 固定为当前 Content 六字段 `title/body/summary/author/published_at/completeness` 与 D08 `EventCandidate[]`；不注入 clues、User Context、Topics、Knowledge、raw_data、来源 URL 或额外 Update。
- P-03 references 固定为候选 Event ID 列表及 Update ID → Event ID 映射。严格 Schema、候选引用、Update 归属、冲突 Action 与 alias 首次顺序去重由 D02 唯一负责。
- `results=[]` 是成功空结果；不得强造 `NO_INCREMENT`。
- 全部结果、证据、确认别名和受影响 Event 的 FTS 在一个同步短事务中提交；任何写入、读回或 FTS 失败均全部回滚。
- COMMIT 后只返回本次真正新建的 Event/Update；复用 Update 与 `NO_INCREMENT` 不返回目标。D09 不派发 Topic Matching。

公共返回契约固定为：

```ts
type EventTargetType = "EVENT" | "EVENT_UPDATE";

interface EventAnalysisTarget {
  target_type: EventTargetType;
  target_id: string;
}

interface EventAnalysisResult {
  new_targets: EventAnalysisTarget[];
}

interface EventAnalysisOptions {
  readonly signal?: AbortSignal;
}

interface EventAnalysisService {
  analyze(
    contentId: string,
    options?: EventAnalysisOptions,
  ): Promise<EventAnalysisResult>;
}
```

`new_targets` 按 P-03 results 首次出现顺序稳定去重；空结果为 `{new_targets: []}`。

明确不做：P-02/P-03 自动重试、第二次 P-03、Topic Matching、Published Item、RSS、Runtime/queue/retry/dispatch、HTTP route、Cron、跨文章语义去重、历史摘要、向量检索、新表/列/索引/outbox。不新增依赖，不修改真实 Prompt、User Context、D01 DDL、D02 Schema、D04～D08 公共算法或配置文件。

若实现需要改变 DTO、`reason`、P-03 输入、DDL、D02 引用规则、事务语义或 FTS 契约，停止该卡并交 Architect；Worker 不得现场扩写设计。

### 1.1 D08 `reason` 扩展的 Lead 审核

当前 D08 `EventSearchResult` 只有 `candidates`。在“不重调 P-02、不向 D09 暴露 clues、still 区分 empty clues/no candidates”的约束下，Spec 提出的以下受控扩展是**最小且自洽**的：

```ts
interface EventSearchResult {
  candidates: EventCandidate[];
  readonly reason?:
    | "missing_content"
    | "empty_clues"
    | "no_candidates"
    | "candidates";
}
```

- 类型上保持 `reason?` 可选，避免破坏既有 TypeScript 消费方；D08 生产 factory 在每次成功返回时都实际给出该字段。
- `missing_content`：Content 不存在；`empty_clues`：P-02 合法空线索；`no_candidates`：有线索但最终候选为空；`candidates`：至少一个候选。
- 不把 `reason` 写入日志，不暴露 clues、检索词、分数或 SQL；既有 candidate DTO、排序、窗口、调用次数与只读行为不变。
- D09 对“空 candidates + 缺失 reason”或 `reason/candidates` 矛盾不得猜测原因，映射 `event_analysis_failed`，且绝不为了区分原因再调用 P-02。
- 未发现比该可选只读元数据更小的方案；判别联合或新 `searchDetailed()` 会破坏兼容或扩大公共接口，不列入本 Plan。

## 2. 上游只读核对结论与文件布局

### 2.1 只读核对结论

- `src/llm/response-validators.ts`：P-03 已使用 strict object/discriminated union；`NEW_EVENT` 不接受 `event_id`，`NEW_UPDATE/NO_INCREMENT` 的 Event 必须属于 references，NO_INCREMENT 的 Update 必须存在且归属同一 Event；同 Event 重复 NEW_UPDATE 或 NEW_UPDATE/NO_INCREMENT 冲突已在事务前拒绝；每个 result 的 `confirmed_aliases` 首次顺序去重。
- `src/llm/llm-calls.ts`：`analyzeEvents(taskData,references,{signal})` 会快照 task data/references，除 Knowledge 外不注入 User Context，并原样透传 signal。
- `src/database/schema.sql`：`event_content_links` 主键为 `(target_type,target_id,content_id)`；`event_entity_aliases` 主键为 `(event_id,alias)`；Update→Event 有真实外键；多态 target 的 Event/Update 对应关系由应用层校验；无需 DDL 变更。
- `src/database/event-search.ts`：`refreshEventSearch()` 在调用方事务内使用嵌套 savepoint，外层回滚会同时回滚 FTS；D01 已测试该行为。D09 只调用现有函数，不修改 FTS 实现。
- `src/event-search/contracts.ts` 与 `event-search.ts`：当前成功结果没有 `reason`；候选路径、错误码、只读调用与日志白名单已稳定。T01 只增加 Spec §2.4 的可选只读元数据。
- `tests/database/event-search.test.ts`：已证明全历史 Update 聚合、refresh 确定性、调用方事务 savepoint 回滚、FTS 故障回滚和孤儿索引清理。
- D02 与 DDL 未发现会阻止 D09 持久化设计的冲突；事务内需要额外验证候选 Event/Update 仍存在，但这属于 Spec 已明确要求的业务复核，不重复 D02 Schema。

### 2.2 模块职责

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/event-search/contracts.ts` | 受控增加 `EventSearchResult.reason` | T01 |
| `src/event-search/event-search.ts` | 在每个成功返回路径设置精确 reason | T01 |
| `src/event-analysis/contracts.ts` | D09 公共 Options/Result/Service/Target/Dependencies 类型 | T01/T05 |
| `src/event-analysis/event-analysis-errors.ts` | 四个稳定错误码、安全 message、Abort 归一化 | T01 |
| `src/event-analysis/content-input.ts` | 当前 Content 的六字段显式投影 | T01 |
| `src/event-analysis/event-analysis-call.ts` | P-03 task data/references 显式组装、单次调用、错误/取消 | T01 |
| `src/event-analysis/event-repository.ts` | Event/Update/证据/别名 SQL Repository 与事务内读回 | T02/T03 |
| `src/event-analysis/event-decision-persistence.ts` | 单 result 的同步持久化、复用、别名与影响集合 | T02/T03 |
| `src/event-analysis/event-search-refresh.ts` | 影响 Event ID 去重/BINARY 排序并调用 D01 refresh | T03 |
| `src/event-analysis/event-analysis-persistence.ts` | 全部 results 单事务、读回、回滚和 new_targets | T04 |
| `src/event-analysis/event-analysis-logger.ts` | 安全白名单日志与 best-effort 包装 | T05 |
| `src/event-analysis/event-analysis.ts` | D08 + P-03 + 事务持久化编排与 factory | T05 |
| `src/event-analysis/index.ts` | 唯一公共导出边界 | T05 |

### 2.3 内部类型与不变量

- Repository 只使用参数绑定和列显式投影；不把 SQL row、cause、模型输出或任意对象 spread 到公共结果。
- D02 已导出的 `EventAnalysisResult` 是 P-03 单个 decision union，和 D09 公共 `EventAnalysisResult`（`new_targets`）同名；内部代码必须用明确别名（如 `EventAnalysisDecision`/`P03EventAnalysisResult`）导入 D02 类型，禁止用同名 import 或双份声明混淆两者。
- `EventDecisionOutcome` 只描述本次 result 的新目标与实际变化：

```ts
interface EventDecisionOutcome {
  readonly newTarget: EventAnalysisTarget | null;
  readonly affectedEventIds: readonly string[];
}
```

- `affectedEventIds` 只包含：新建 Event、实际新建 Update、实际新增 alias 所影响的 Event。仅新增证据、复用 Update、重复 alias 不加入。
- `event_content_links` 允许同一 Content 同时有 EVENT 与 EVENT_UPDATE；业务层必须验证 Update 的父 Event。
- `confirmed_aliases` 不 trim、不规范化、不吸收 P-02 search_terms；D02 已对每个 result 做非空与首次去重，Repository 再用数据库主键跨 result/历史去重且不覆盖原 `content_id`。
- `NEW_UPDATE` 复用查询严格依据 Event + 当前 Content 的 EVENT_UPDATE 证据；存在多条时按 `discovered_at ASC,id ASC` 选第一条，确保确定性。

### 2.4 取消、错误与日志

固定四码：

| code | message |
|---|---|
| `invalid_input` | `Invalid event analysis input` |
| `aborted` | `Event analysis was aborted` |
| `event_analysis_failed` | `Event analysis operation failed` |
| `llm_failed` | `Event analysis LLM call failed` |

- Abort 检测只安全读取 `name/code`，至少识别 `AbortError`、`ABORT_ERR`、`LLM_CANCELLED`；已中止 signal 优先于底层错误。
- D08 `invalid_input/aborted/llm_failed` 分别保持；D08 `event_search_failed` 映射 `event_analysis_failed`；未知 D08 错误也映射 `event_analysis_failed`。
- D02 Prompt/JSON/Schema/reference/conflict 错误统一 `llm_failed`；DB/持久化/FTS/读回错误统一 `event_analysis_failed`。
- `EventAnalysisError` 不保留 cause、SQL、Zod issues、Prompt、正文、模型原文、Token、候选/Event/Update ID 或 alias。
- logger 只允许 `contentId/candidateCount/resultCount/newTargetCount/stage/reason`；stage 仅 `check|search|analyze|persist`。reason 只允许四个错误码或四个 D08 reason。运行时白名单重组对象，同步抛错/异步 rejection 均被吞掉，不改变结果或错误。

### 2.5 事务边界

- Content 读取、D08 search、P-03 调用全部在写事务外。
- `withTransaction()` 回调必须同步；thenable 由 D01 拒绝。
- 事务内逐 result 写 Event/Update/证据/alias；所有实际影响 Event 收集完成后按 Event ID BINARY ASC 去重，逐个调用 D01 `refreshEventSearch()`。
- `refreshEventSearch()` 的嵌套 savepoint 归入 D09 外层事务；不得改为直接写 FTS，不得调用全量 `rebuildEventSearch()`。
- COMMIT 后返回目标集合；D09 不添加 COMMIT 后入队窗口。

## 3. 五卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | D08 reason、D09 六字段输入、P-03 单次调用/引用/错误/取消 | 无持久化、单事务或公共 factory |
| T02 合并后 | Event/Update/证据 Repository 与 NEW_EVENT/首次 NEW_UPDATE 写入原语 | 无 NO_INCREMENT、alias、reuse、FTS 或多结果事务 |
| T03 合并后 | NEW_UPDATE reuse、NO_INCREMENT、confirmed_aliases、同事务 FTS 原语 | 无多 result 外层事务和公共 factory |
| T04 合并后 | 全部 result 单事务、影响 FTS 去重、读回、失败回滚、new_targets | 无 D08+P-03 公共编排或真实 SQLite 集成 |
| T05 合并后 | 公共 factory、D08+P-03+真实 SQLite 集成、完整 P0 本地能力 | 仍须 G4、合并后复验、集成 Gate、CI 与最终验收 |

五卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 和独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。

| Case | 主责任卡 | 交叉验证 |
|---|---|---|
| `EVT-01` | T02 NEW_EVENT 原语；T05 端到端 | 一 Event 一证据、零初始 Update |
| `EVT-02` | T02 首次 NEW_UPDATE；T05 端到端 | 一 Update 一证据、目标 EVENT_UPDATE |
| `EVT-03` | T03 指定 Update 证据；T05 | 零新 Update/目标 |
| `EVT-04` | T03 null Update 只关联 Event；T05 | 不猜测 Update |
| `EVT-05` | T01 合法空 results；T05 | 零业务写入 |
| `EVT-06` | D08 既有搜索责任；T05 多事项分析 | 不由 D09 按实体名合并 |
| `EVT-07` | T04 多结果单事务；T05 | 目标顺序、COMMIT 后返回 |
| `EVT-08/09` | T02/T03 一条 NEW_UPDATE 保存；T05 | 不拆多条、不改旧事实 |
| `EVT-10` | D08 既有全历史召回；T05 | 十年前的 Event 仍进入 P-03 |
| `EVT-11` | D08 既有窗口；T05 P-03 输入 | 只给最近 10 条上下文 |
| `EVT-12/13` | T03 alias/证据/FTS；T05 | NO_INCREMENT 无新目标 |
| `EVT-14` | T01/T05 task data 无 clues；T03 alias 仅来自 confirmed_aliases | P-02 search_terms 不落库 |
| `EVT-15` | T01 D02 strict/reference/conflict；T03 事务内复核；T05 | 事务前拒绝，零部分写 |
| `EVT-16` | T04 DB/FTS 中途失败；T05 | 业务与 FTS 全回滚 |
| `EVT-17` | T03 reuse；T05 | 不新增、不返回目标 |
| `EVT-18` | T03/T04 FTS 一行；T05 D01 rebuild 一致性 | 旧更新/新 alias 可召回 |
| `EVT-21` | T01/T05 reason 分支 | P-03 0 次、零写 |
| `EVT-22` | T01/T05 reason 分支 | 有 clues 无候选仍 P-03 |
| `EVT-23` | D08 全历史召回 + T05 P-03 上下文 | 搜索项不出现在 task data |
| `EVT-24` | T03/T05 | alias 按 event_id 隔离 |
| `PMT-14/15` | T01/T05 D02 strict/reference | 非法输出映射 llm_failed、零写 |
| `PMT-09` | T01/T05 | P-03 无 user_context |
| `E2E-14` | T05 分析部分 | 同 Entity+Subject+Scope 可归同一 Event，不按机构强拆 |
| `ATOMIC` | T04/T05 | 同步事务、FTS 同事务、thenable 拒绝 |
| `PRIVACY` | T01/T05 | task data/error/logger 无敏感内容 |

`EVT-19/20`、`PMT-03/04` 是 S0 真实模型语义回归，不属于 D09 P0 Gate；固定 Stub 不得冒充真实 P-03 语义质量。

## 4. D09-T01 · D08 reason、P-03 task data/references、单次调用与严格错误边界

### 4.1 依赖与精确允许写集

- 前置：D09 Intent/Spec 获批且 Plan 获 G3 批准后的精确执行基线；首个 Worker 固定该批准/执行基线 SHA。
- 修改且仅允许改：`src/event-search/contracts.ts`。
- 修改且仅允许改：`src/event-search/event-search.ts`。
- 修改且仅允许改：`tests/event-search/event-search-service.test.ts`。
- 修改且仅允许改：`tests/event-search/event-search-integration.test.ts`。
- 新增且仅允许写：`src/event-analysis/contracts.ts`。
- 新增且仅允许写：`src/event-analysis/event-analysis-errors.ts`。
- 新增且仅允许写：`src/event-analysis/content-input.ts`。
- 新增且仅允许写：`src/event-analysis/event-analysis-call.ts`。
- 新增且仅允许写：`tests/event-analysis/content-input.test.ts`。
- 新增且仅允许写：`tests/event-analysis/event-analysis-call.test.ts`。
- 只读复用：D02 `llm-calls.ts`/`response-validators.ts`、ContentRepository、D08 contracts/candidates、StubLLM、临时 Prompt fixture、temp database。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2.1～§2.8、§3、§5、§6、§7；`EVT-05`、`EVT-14`、`EVT-15`、`EVT-21`、`EVT-22`、`EVT-23`、`PMT-09`、`PMT-14/15`，以及 D08 reason 的 EVT-21/22 前置。

### 4.2 禁止范围

- 不得修改 D02 LLM/Schema/Prompt、D01 Schema/FTS、Processing、Knowledge、Adapter、Collection、Configuration、app/server/lifecycle、CI、package/lock。
- 不得修改 D08 候选算法、排序、上下文窗口、错误码、日志字段或写能力；只增加 Spec 指定的成功结果只读 `reason`。
- 不得实现 Event/Update Repository、事务、FTS 写入、公共 factory、Runtime 或任何业务写语句。
- 不得创建第二份 Zod/JSON Schema、重试、超时、Provider 切换、响应修复或模型输出解析器。
- 不得读取真实 `config/prompts`、`config/prompt/user-context.md`、Topic/Knowledge/raw_data、API Key 或网络。

### 4.3 实现要求

1. `EventSearchResult` 增加可选只读 `reason`；`createEventSearch()` 的成功返回必须设置且仅设置以下值：Content 缺失 `missing_content`、空 clues `empty_clues`、有 clues 且最终 candidates 为空 `no_candidates`、candidates 非空 `candidates`。
2. D08 既有 candidates/DTO 内容不变；`reason` 不传入 candidate、logger 或 error。空 clues 仍只调用 P-02 一次且候选 Repository 零调用。
3. `EventAnalysisError` 精确实现四码/message；安全 Abort 检测识别 `AbortError`、`ABORT_ERR`、`LLM_CANCELLED`，错误不保留 cause。
4. `loadEventAnalysisContent()` 只接受 `Pick<ContentRepository,"getById">`，恰好一次读取；六字段逐字段显式投影，禁止 spread、ID/URL/created_at/language/raw/HTML/Topic/history/Token。
5. `buildEventAnalysisTaskData()` 只返回 `{content,candidates}`；content 六字段原样，candidate/update 按公共 DTO 字段显式重建，剥离任何运行时额外属性、clues/score/source/reason。
6. `buildEventAnalysisReferences()` 只返回 `candidateEventIds` 与 `eventIdByUpdateId`；candidate 顺序不重排，Update 映射必须稳定；不得把 D08 reason 注入 P-03。
7. `callEventAnalysis()` 只接受 task data、references、`Pick<TypedLlmCalls,"analyzeEvents">` 和 signal；pre-abort 零调用，否则恰好一次 `analyzeEvents(taskData,references,{signal})`。
8. 调用中/返回后取消及三个 Abort 形态映射 `aborted`；其余 Prompt/JSON/Schema/reference/conflict/模型错误映射 `llm_failed`。D02 返回原样交回，不再次解析或校验。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `D08_REASON` | missing/empty_clues/no_candidates/candidates 四值与 candidate 数量一致；成功对象仅增加 `reason` |
| `EVT-21_PRE` | 空 clues：P-02 1 次、candidate Repository 0 次、零写入、reason=`empty_clues` |
| `EVT-22_PRE` | 有 clues 无 hit：candidate Repository 1 次、零上下文 SQL、reason=`no_candidates` |
| `TASK_DATA / PRIVACY` | 顶层精确 `content/candidates`；content 六字段；无 clues/user_context/Topic/Knowledge/raw/URL/Token/extra |
| `CANDIDATE_PROJECTION` | 传入带额外字段的 candidate/update，P-03 JSON 只含 DTO 字段 |
| `REFERENCES` | 候选 ID 顺序与 Update→Event 映射精确；每次调用前快照，调用中外部 mutation 不影响 payload |
| `P03_CALL / SIGNAL` | 只调用 analyzeEvents 恰一次；task data/references/signal 原样；无 searchEvents/重试 |
| `EMPTY_RESULTS` | 合法 `{results:[]}` 原样成功，不补 NO_INCREMENT |
| `EVT-15 / PMT-14/15` | 候选外 Event、错归属 Update、冲突 Action、NEW_EVENT 自造 ID、NO_INCREMENT 缺 Event、额外字段/错误类型均经 D02 拒绝并映射 llm_failed |
| `PMT-09` | 合成 `event-analysis.md` 唯一 Prompt；user JSON 顶层仅 `task_data`，无 `user_context` |
| `ABORT / ERROR_SAFETY` | pre-abort 零调用；调用中/返回后取消优先 aborted；非取消错误恰一次且 llm_failed；无 cause/敏感串 |

另测：D08 缺少/矛盾 reason 留给 T05 的保守失败；T01 不改 D08 空结果既有调用次数与只读快照。P-03 task data 中不得出现 D08 clues 或内部检索证据。

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-search/event-search-service.test.ts tests/event-search/event-search-integration.test.ts tests/event-analysis/content-input.test.ts tests/event-analysis/event-analysis-call.test.ts tests/llm/response-validators.test.ts tests/llm/llm-calls.test.ts tests/prompt/prompt-repository.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|searchEvents|routeProcessing|matchTopics|user_context|raw_data|topics|knowledge|withTransaction|INSERT|UPDATE|DELETE' src/event-analysis/contracts.ts src/event-analysis/event-analysis-errors.ts src/event-analysis/content-input.ts src/event-analysis/event-analysis-call.ts tests/event-analysis/content-input.test.ts tests/event-analysis/event-analysis-call.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后一条禁止 diff 必须为空；静态扫描的合法测试字符串/合成 Prompt sentinel 需逐条解释，生产代码不得出现数据库写、候选检索、其他 operation 或事务。交回必须列 base SHA、实际路径、Case 映射、命令结果、已知限制，并只报 `REVIEW`/`BLOCKED`。本卡通过只表示 reason 与 P-03 前置边界 PASS，不表示任何持久化完成。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE`（必须是 `2484b2876522027b5da4c95ca1b5c03e757d8139` 的后代且只增加已批准的 D09 文档） |
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

## 5. D09-T02 · Event/Update/证据 Repository 与 NEW_EVENT/首次 NEW_UPDATE

### 5.1 依赖与精确允许写集

- 前置：`D09-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增且仅允许写：`src/event-analysis/event-repository.ts`。
- 新增且仅允许写：`src/event-analysis/event-decision-persistence.ts`。
- 新增且仅允许写：`tests/fixtures/event-analysis.ts`。
- 新增且仅允许写：`tests/event-analysis/event-repository.test.ts`。
- 新增且仅允许写：`tests/event-analysis/event-decision-persistence.test.ts`。
- 只读复用：T01 contracts/errors/types、D02 EventAnalysisResult、D01 open/schema/transaction/FTS、`IdGenerator`、`Clock`、`formatTimestamp`、临时 SQLite/fault fixture。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §2.9、§4.1、§4.2（首次写入部分）、§5、§6、§7；`EVT-01`、`EVT-02`、`EVT-08/09`、`EVT-15` 的事务内 Event 存在性基础， `ATOMIC` 的 Repository 基础。

### 5.2 禁止范围

- 不得修改 T01、D01/D02、D08、Processing、Knowledge、app/server/lifecycle、配置、CI、package/lock。
- 不得实现 NO_INCREMENT、Update 按 Event+Content 复用、confirmed_aliases、FTS 刷新、公共 factory、P-03 或 D08 调用。
- 不得直接写 `event_search`、调用 `refreshEventSearch()`/`rebuildEventSearch()`、创建表/列/索引或匹配任务。
- 不得 trim/归一化业务文本；不得模型生成 Event/Update ID；不得在 Repository 内读取 Content/LLM/网络/logger。
- 不得吞 SQLite 异常或捕获后返回部分对象。

### 5.3 实现要求

1. `EventRepository` 提供最小同步接口：按 ID 读取 Event/Update、插入 Event、插入 Update、幂等插入/读取证据；所有 SQL 参数绑定、列显式。
2. `EventRecord/EventUpdateRecord` 映射精确 DDL 字段并区分 `occurred_at=null` 与字符串；`discovered_at` 由调用方提供，不允许 Repository 读取系统时间。
3. `insertEvent()`/`insertUpdate()` 必须断言 `changes===1` 并在同一调用方事务内读回；证据插入用 `ON CONFLICT DO NOTHING` 或等价方式区分 inserted/existing，不能覆盖原关系。
4. `EventDecisionPersistence.apply()` 是同步原语，只由外层事务调用；先断言 `db.inTransaction===true`，否则抛错，不能自行开启事务。
5. `NEW_EVENT`：IdGenerator 生成 Event ID；字段来自模型；`discovered_at=formatTimestamp(clock.now())`；`occurred_at` 缺省/null 写 SQL NULL；插入一条 EVENT 证据；不创建 Update；返回 EVENT 目标与新 Event 影响 ID。
6. 首次 `NEW_UPDATE`：事务内按 `event_id` 重读候选 Event，缺失即失败；生成 Update ID、写入字段与证据、返回 EVENT_UPDATE 目标与 Event 影响 ID。T02 对当前 Content 已有 Update 的情况可由 T03 补齐，禁止在此卡宣称 replay 完成。
7. Event/Update/证据所有写后读回均在同一事务；失败原样抛出交 T04 回滚和映射。T02 不执行 FTS，因此只能通过单事务测试证明基础原语，不能宣称 EVT-18 PASS。
8. Repository/DecisionPersistence 不接收 AbortSignal、Promise、logger、ContentRepository、typed LLM calls 或 EventSearchService。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `REPOSITORY_ROUNDTRIP` | Event/Update 全字段、occurred_at null/字符串、discovered_at 原样读回 |
| `EVIDENCE_IDEMPOTENT` | 同一 target/content 第二次零新增；原行字段不变；不同 target/content 独立 |
| `INSERT_VERIFY` | insert changes 异常或读回失败立即抛错；同事务无遗留半行 |
| `EVT-01` | NEW_EVENT：一 Event 行、一 EVENT 证据、零 Update、目标 EVENT |
| `EVT-02` | 首次 NEW_UPDATE：一 Update 行、一 EVENT_UPDATE 证据、父 Event 正确、目标 EVENT_UPDATE |
| `EVT-08/09` | 模型 description 原样保存；不生成第二条 Update、不改父 Event 或旧 Update |
| `EVT-15_PRE` | 事务内 recheck 发现 Event 缺失即失败；不凭事务外候选快照写入 |
| `SYNC_BOUNDARY` | `db.inTransaction=false` 时 DecisionPersistence 拒绝；未调用 LLM/Content/FTS |
| `ROLLBACK` | 在真实 insert/evidence 后注入异常，外层 withTransaction 回滚全部行 |
| `TIME_BINDING` | FakeClock/SequenceId 精确调用一次；SQL 不读取当前时间 |

另测：SQL 全参数绑定；Event/Update 字段无对象 spread、无额外列；Repository 不调用 refresh/rebuild、不 prepare 非白名单写；测试前后其他业务表不变。

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-analysis/event-repository.test.ts tests/event-analysis/event-decision-persistence.test.ts tests/database/transaction.test.ts tests/database/schema-constraints.test.ts tests/database/event-search.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|analyzeEvents|searchEvents|matchTopics|refreshEventSearch|rebuildEventSearch|INSERT|UPDATE|DELETE|NOW\(|CURRENT_TIMESTAMP' src/event-analysis/event-repository.ts src/event-analysis/event-decision-persistence.ts tests/fixtures/event-analysis.ts tests/event-analysis/event-repository.test.ts tests/event-analysis/event-decision-persistence.test.ts || true
git diff --name-only <BASE_SHA> -- src/event-search src/llm src/prompt src/database src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空；跨多个卡的白名单路径不得提前创建。静态扫描的测试 fixture SQL/INSERT 必须逐条说明为建数用途，生产 Repository 只允许本卡声明的方法。交回格式同 T01。本卡通过只表示 NEW_EVENT/首次 NEW_UPDATE 原语 PASS。

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

## 6. D09-T03 · NEW_UPDATE 重放复用、NO_INCREMENT、确认别名与同事务 FTS

### 6.1 依赖与精确允许写集

- 前置：`D09-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 修改且仅允许改：`src/event-analysis/event-repository.ts`。
- 修改且仅允许改：`src/event-analysis/event-decision-persistence.ts`。
- 新增且仅允许写：`src/event-analysis/event-search-refresh.ts`。
- 修改且仅允许改：`tests/fixtures/event-analysis.ts`。
- 修改且仅允许改：`tests/event-analysis/event-repository.test.ts`。
- 修改且仅允许改：`tests/event-analysis/event-decision-persistence.test.ts`。
- 只读复用：T01/T02、D01 `withTransaction`/`refreshEventSearch`/`rebuildEventSearch`（测试建数与重建一致性）、DDL、D02 normalized aliases。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §2.9～§2.10、§4.2～§4.5、§5、§6、§7；`EVT-03`、`EVT-04`、`EVT-12/13`、`EVT-14`、`EVT-17`、`EVT-18`、`EVT-24`、`ATOMIC`。

### 6.2 禁止范围

- 不得修改 T01、D01/D02/D08、Processing、Knowledge、app/server/lifecycle、配置、CI、package/lock。
- 不得实现多 result 外层事务、公共 factory、D08/P-03 编排或 Runtime 派发。
- 不得直接写/重建 `event_search`，不得调用 `rebuildEventSearch()` 作为正常写入；只通过现有 `refreshEventSearch()`。
- 不得把 alias trim/转小写/替换空格，不得吸收 P-02 search_terms，不得用 alias 合并 Event。
- 不得覆盖已有 alias 的 `content_id`、改变复用 Update 文本或把 evidence-only 写成 FTS 变更。

### 6.3 实现要求

1. Repository 增加按 `event_id` + 当前 `content_id` 的 Update 复用查询，SQL 关系严格为 `event_updates JOIN event_content_links(target_type='EVENT_UPDATE')`，按 `discovered_at ASC,id ASC` 稳定取第一条。
2. `NEW_UPDATE` 先事务内重读 Event；若找到复用 Update，则仅确保 EVENT_UPDATE/current Content 证据存在，返回 `newTarget=null` 且不改变 Update 文本；否则走 T02 首次写入。
3. `NO_INCREMENT` 事务内重读 Event；`event_update_id` 非空时重读 Update 并断言父 Event 相等，否则只写 EVENT 证据；不创建 Update，不返回目标。
4. alias Repository 以 `(event_id,alias,content_id)` 幂等插入；返回是否真正新增并读回；已有 alias 不覆盖旧 `content_id`，同一 alias 文字的不同 Event 完全独立。
5. 每个 result 的 `confirmed_aliases` 对三种 Action 都处理；D02 已在单 result 内去重，Repository 负责跨 result/历史数据库约束去重。无 trim 或额外语义审核。
6. `EventDecisionOutcome.affectedEventIds` 只加入：NEW_EVENT；实际首次 NEW_UPDATE；实际新增 alias。复用 Update 或仅证据不入集合；同一 Event 可重复加入，由 T04 去重。
7. Repository 同时增加 T04 所需只读复核方法：按 `(event_id,alias)` 读取当前 alias 证据、按 polymorphic evidence 主键读取关系、按 Event ID 读取 `event_search` 逻辑文本行；这些方法只读，不自行 refresh。
8. `refreshAffectedEvents()` 在调用方事务内工作：Event ID 按 BINARY ASC 排序并去重，逐 Event 调用一次现有 `refreshEventSearch()`；空集合不 prepare FTS SQL。不得自行开顶层事务。
9. T03 测试使用真实 `withTransaction()` 包裹 DecisionPersistence + refresh，证明业务/证据/alias/FTS 的 savepoint 同事务成功与回滚；正常写入路径不调用 rebuild。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-03` | 指定 Update 只增当前 Content 证据；Update 数不变、零目标、无 FTS 影响 |
| `EVT-04` | null Update 只写 EVENT 证据；从不按 event_id 猜测 Update |
| `WRONG_UPDATE_OWNER` | Update 存在但不属于 Event 时事务内失败、零新增 |
| `EVT-17 / REUSE` | 同 Content+Event 已有链接 Update 时复用；不新增/不返回；原字段完全不变；重复 replay 稳定 |
| `REUSE_ORDER` | 意外多条匹配时按 discovered_at ASC,id ASC 取第一条；只确保该 Update 证据 |
| `EVT-12 / 13` | alias 以当前 Content 为证据；Event ID 不变；NO_INCREMENT 无目标；重复 alias 不覆盖原证据 |
| `EVT-14` | confirmed_aliases=[] 零 alias；P-02 terms 不在任何写入输入中 |
| `EVT-24` | 同 alias 两 Event 各自独立；新增 alias 只刷新指定 Event |
| `EVT-18` | 新 Update/alias 后 FTS 逻辑一行；旧 Update 新 alias 可召回；rebuild 后文本一致 |
| `FTS_IMPACT_SET` | 重复 Event ID 排序去重后 refresh 每 Event 一次；空集合零 FTS SQL |
| `ATOMIC_ROLLBACK` | 注入 FTS insert 失败时 Event/Update/证据/alias 与 FTS 全回滚 |

另测：SQL 参数绑定；复用查询明确 target_type；alias 保留大小写/首尾空白；不同 Content 证据独立；Repository 不调用 trim/replace；refresh 失败原样抛出不吞。

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-analysis/event-repository.test.ts tests/event-analysis/event-decision-persistence.test.ts tests/database/event-search.test.ts tests/database/transaction.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|analyzeEvents|searchEvents|matchTopics|rebuildEventSearch|trim\(|toLowerCase|INSERT INTO event_search|DELETE FROM event_search|UPDATE event_updates' src/event-analysis/event-repository.ts src/event-analysis/event-decision-persistence.ts src/event-analysis/event-search-refresh.ts || true
rg -n 'event_content_links|event_entity_aliases|refreshEventSearch|affectedEventIds' src/event-analysis/event-repository.ts src/event-analysis/event-decision-persistence.ts src/event-analysis/event-search-refresh.ts
git diff --name-only <BASE_SHA> -- src/event-search src/llm src/prompt src/database src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`trim/toLowerCase`、直接 FTS SQL、rebuild 或覆盖 Update 文本的生产命中一律 BLOCKER；测试中的 rebuild 只能用于 EVT-18 一致性断言。交回格式同 T01。本卡通过只表示单 result 持久化不变量与 FTS 原语 PASS。

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

## 7. D09-T04 · 多结果单事务、读回、失败回滚与目标集合

### 7.1 依赖与精确允许写集

- 前置：`D09-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 新增且仅允许写：`src/event-analysis/event-analysis-persistence.ts`。
- 修改且仅允许改：`tests/fixtures/event-analysis.ts`。
- 新增且仅允许写：`tests/event-analysis/event-analysis-persistence.test.ts`。
- 只读复用：T01～T03、D01 `withTransaction`、faulty/temp database、fake clock/id、D02 normalized EventAnalysisResult。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2.9～§2.10、§4、§5、§6、§7；`EVT-07`、`EVT-16`、`EVT-18` 的批量影响集合、`ATOMIC`，并为 T05 提供唯一持久化入口。

### 7.2 禁止范围

- 不得修改 T01～T03、D01/D02/D08、Processing、Knowledge、app/server/lifecycle、配置、CI、package/lock。
- 不得调用 Content、D08、P-03、logger、fetch、Adapter、Runtime 或异步服务；不得有 await/Promise/thenable 返回。
- 不得在单个 result 内提前 refresh 后继续写；不得在事务失败后返回已收集 targets。
- 不得新增表/列/索引、outbox、retry 状态或派发。

### 7.3 实现要求

1. `persistEventAnalysis()` 只接受 Database、EventRepository、Clock、IdGenerator、Content ID 和已通过 D02 的 results；它是同步函数，不能返回 PromiseLike。
2. 函数使用一次外层 `withTransaction()`；transaction 开始前若调用方显式要求检查 signal，只能检查已 aborted 并抛 aborted，不能把 signal 传入异步操作。
3. 按 results 原始顺序逐项调用 T03 DecisionPersistence；D02 已保证动作合法与引用有效，T04 不复制 Schema 或冲突校验结论。
4. 收集所有 result 的 affected Event ID；事务内全部业务写入结束后，按 BINARY ASC 去重并调用 T03 `refreshAffectedEvents()`。同一 Event 的 FTS 刷新一次。
5. 事务内逐 result 读回：Event/Update 行、对应证据、每个 alias 的当前 Content/既有证据、受影响 Event 的 FTS 逻辑一行；NO_INCREMENT 无 alias 时不得要求 FTS 变更。
6. `new_targets` 只收集非 null outcome，保持首次出现顺序；同 type+ID 再次出现只保留一次。不得返回 reused Update、NO_INCREMENT、受影响 Event 或内部 outcome。
7. 任一 write/read-back/FTS/sort/refresh 失败均由 `withTransaction()` 回滚并原样抛出；T04 不返回部分集合，不吞异常，不在 catch 中继续读成功路径结果。
8. 事务提交后返回普通 `{new_targets}`；T04 不做下游派发，不宣称 exactly-once 或崩溃恢复。

### 7.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-07` | NEW_EVENT + NEW_UPDATE 两 result 同事务；目标顺序与 P-03 results 一致；COMMIT 后可同时读回 |
| `MULTI_EVENT` | 三个不同 Event results 均写入；无按 entity/subject 合并 |
| `TARGET_ORDER_DEDUPE` | 目标顺序稳定、首次去重；NO_INCREMENT/reuse 不入集合 |
| `AFFECTED_DEDUPE` | 同 Event 多结果只 refresh 一次；Event ID 按 BINARY 顺序调用 |
| `EVT-16 / MID_DB_FAILURE` | 多 result 中途 DB/FTS 失败；Event/Update/证据/alias/FTS 全回滚、无返回目标 |
| `READBACK_FAILURE` | 写后读回不一致即抛错并回滚；不以“insert 已执行”宣称成功 |
| `EVIDENCE_NO_REFRESH` | NO_INCREMENT 仅证据不触发 FTS；有 alias 时触发一次 |
| `SYNC_CALLBACK` | 实现/types 拒绝 async/thenable；真实 withTransaction 拒绝 PromiseLike 并回滚 |
| `NO_RESULTS` | `results=[]` 不打开事务或不执行写入；返回空目标 |
| `ATOMIC` | LLM/Content/D08 在事务外由上游保证；T04 事务内 SQL 全部为同步 Repository/FTS |

另测：同一 Event 多 NO_INCREMENT 的 alias/证据组合稳定；不同 Content 测试数据；异常类型被原样保留供 T05 安全映射；事务结束后 `db.inTransaction=false`；业务/FTS 快照遵守提交或回滚语义。

### 7.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-analysis/event-analysis-persistence.test.ts tests/event-analysis/event-decision-persistence.test.ts tests/event-analysis/event-repository.test.ts tests/database/transaction.test.ts tests/database/event-search.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|await\b|async\b|Promise|fetch\(|analyzeEvents|searchEvents|matchTopics|logger|withTransaction|refreshEventSearch|rebuildEventSearch' src/event-analysis/event-analysis-persistence.ts tests/event-analysis/event-analysis-persistence.test.ts || true
git diff --name-only <BASE_SHA> -- src/event-search src/llm src/prompt src/database src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空；`withTransaction`/`refreshEventSearch` 在生产文件中的命中为预期，必须解释同步调用位置，不得出现 await/Promise 或外部调用。测试中的 Promise 只能用于验证拒绝。交回格式同 T01。本卡通过只表示批量持久化与回滚 PASS。

### 7.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T03_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §7.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 8. D09-T05 · 公共 factory、D08+P-03+真实 SQLite 集成与 P0 Gate

### 8.1 依赖与精确允许写集

- 前置：`D09-T04` 已通过、合并并按门禁归档；base 固定为 T04 merge SHA。
- 修改且仅允许改：`src/event-analysis/contracts.ts`。
- 新增且仅允许写：`src/event-analysis/event-analysis-logger.ts`。
- 新增且仅允许写：`src/event-analysis/event-analysis.ts`。
- 新增且仅允许写：`src/event-analysis/index.ts`。
- 修改且仅允许改：`tests/fixtures/event-analysis.ts`。
- 新增且仅允许写：`tests/event-analysis/event-analysis-service.test.ts`。
- 新增且仅允许写：`tests/event-analysis/event-analysis-integration.test.ts`。
- 只读复用：T01～T04、D08 公共 factory、D02 typed calls/PromptRepository/validator、D01 open/schema/transaction/FTS、ContentRepository、StubLLM、fake clock/id、临时 SQLite。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1～§9；D09 P0 的最终服务/集成证据，`EVT-01`～`EVT-18`、`EVT-21`～`EVT-24` 的 D09 责任，`PMT-14/15`、`PMT-09`，`E2E-14` 分析部分。

### 8.2 禁止范围

- 不得修改 T01～T04、D01/D02/D08、Processing、Knowledge/Topic/Publish/RSS、Runtime/queue/retry/dispatch/HTTP/Cron、配置、CI、package/lock。
- 不得实现第二次 P-02/P-03、自动重试、候选重排、Update 窗口重算或 clues 注入。
- 不得读取真实 `config/prompts`、`config/prompt/user-context.md`、API Key、网络或私密环境。
- 不得返回队列/Published Item/Content/模型原文/内部 decision；不得在 logger/error 中写 Event/Update ID 或 alias。

### 8.3 实现要求

1. `contracts.ts` 补全 Dependencies：Database、只读 Content `getById`、注入的 D08 `EventSearchService`、仅 `analyzeEvents` 的 typed calls、EventRepository、Clock、IdGenerator、logger。不得包含 searchEvents/route/match/Adapter/Runtime 或模块级配置。
2. `index.ts` 运行时只导出 `createEventAnalysis` 与 `EventAnalysisError`；DTO/Options/Service/Dependencies 仅 type export，不导出内部 SQL/repository/decision/logger helper。
3. 服务顺序固定：非法 Content ID → pre-abort → D08 search 恰一次 → reason 分支 → 必要时 Content 点读与六字段 task data → D02 analyzeEvents 恰一次 → 空 results → T04 persist → `{new_targets}`。
4. D08 `missing_content/empty_clues` 必须零候选且直接返回空目标；`no_candidates` 必须是零候选并允许 P-03；`candidates` 必须 candidates 非空。`candidates=[]` 且 reason 缺失、reason=`candidates` 却为空、reason=`no_candidates` 却带候选、missing/empty 却带候选等矛盾结果映射 `event_analysis_failed`，绝不二次 P-02。
5. D08 `EventSearchError` 按 §2.4 映射；Content 在 D08 之后点读失败/缺失、persist/FTS 失败映射 `event_analysis_failed`；D02 异常映射 `llm_failed`；signal abort 优先 `aborted`；错误不保留 cause。
6. P-03 task data/references 必须由 T01 builder 生成；显式验证 JSON 顶层只有 `content/candidates`，不包含 clues/reason/D08 内部证据/user_context/Topics/Knowledge/raw/URL/Token。
7. `event-analysis-logger.ts` 按六字段白名单运行时重组；stage 仅 `check|search|analyze|persist`，reason 仅四错误码/四 D08 reason；logger throw/reject best-effort 不改变业务结果。
8. factory 使用注入 repository/clock/id，不创建第二套 Event SQL；T04 持久化只在事务外 P-03 完成后调用。已中止 signal 在 D08/P-03 返回后、事务开始前阻断；不得把异步取消检查放进同步事务 callback。
9. fixture 提供合成 Content（含 raw/Topic/history/Token sentinel）、候选 Event/Update/alias、合成 `event-search.md` + `event-analysis.md`、StubLLM request capture、D08/Content/Repository/FTS 计数、业务与 FTS 快照、真实临时 DB harness。
10. 集成使用真实 D08 + P-03 typed calls + 真实 Content/Repository + 真实 SQLite；Assertions 必须直接检查 `db.inTransaction`：LLM/D08/Content 阶段为 false，事务内 Repository/FTS 为 true，COMMIT 后 false。
11. 对每个分支精确断言 P-02 1 次、P-03 0/1 次、D08 search 1 次、P-03 analyzeEvents 无重试；空 clues/no candidates 区分不得靠第二次 P-02。Content 读取次数需说明 D08 一次 + 需要 P-03 时 D09 一次。
12. Stub P-03 user JSON 顶层仅 `task_data`；task_data 仅 content 六字段与 candidates；candidates 的 Event/Update 键集精确；不把 clue、reason、P02 search_terms、user_context、raw/Topic/history/Token 注入。

### 8.4 服务测试矩阵

| Case | 必测断言 |
|---|---|
| `EVT-21` | reason=empty_clues → 空目标；P-03 0、Content 二次读 0、事务 0、零写 |
| `MISSING_CONTENT` | reason=missing_content → 空目标；P-03 0、零写 |
| `EVT-22` | reason=no_candidates + P-03 NEW_EVENT → 仍调用 P-03、创建 Event/证据、零 Update |
| `REASON_CONSISTENCY` | reason 缺失/矛盾 → event_analysis_failed，P-03 0、事务 0、无二次 search |
| `EVT-05` | P-03 results=[] → 空目标、事务 0、零写 |
| `CALL_ORDER` | D08 → Content → P-03 → persist；P-02/P-03 各恰一次；无 searchEvents 直接调用 |
| `ERROR_MAP` | D08 四码映射、Content/DB/FTS→event_analysis_failed、D02→llm_failed、取消优先 aborted |
| `LOGGER` | 六字段白名单；无 ID/alias/正文/Prompt/Token；throw/reject 不改变结果 |
| `PUBLIC_SHAPE` | 仅 `{new_targets}`；target 键集精确；runtime exports 仅 factory/error |
| `ABORT` | pre-abort 零 D08；D08/Content/P-03 返回后取消不进入持久化 |

### 8.5 真实 SQLite 集成矩阵

| Case | 必测断言 |
|---|---|
| `EVT-01` | 无候选 NEW_EVENT：Event+EVENT 证据、零 Update、FTS 一行、目标 EVENT |
| `EVT-02` | 候选 Event NEW_UPDATE：Update+证据、FTS 一行、目标 EVENT_UPDATE |
| `EVT-03/04` | NO_INCREMENT 指定 Update/null Update：对应证据、零新目标；null 不猜 Update |
| `EVT-06/07` | 多事项/多 Event 结果：不按 entity 合并，一次事务保存，目标顺序稳定 |
| `EVT-08/09` | 单 result 一条 Update；旧 Update 文本不变；矛盾/修正作为新 Update 保存 |
| `EVT-10` | 十年前 Event 由 D08 召回并进入 P-03；不因时间排除 |
| `EVT-11/23` | 12 Update 中旧线索经 FTS 召回，但 P-03 只收到最近 10；搜索词不进入 P-03 task data |
| `EVT-12/13/14` | alias 有当前 Content 证据、去重、FTS 可查；P-02 terms 不落库；NO_INCREMENT 无目标 |
| `EVT-15` | 自造 ID/候选外 Event/错归属 Update/冲突 Action → llm_failed、零业务/FTS 写 |
| `EVT-16` | 多结果中途 DB/FTS 异常 → 全表与 FTS 回滚、无目标 |
| `EVT-17` | 同 Content+Event replay 复用原 Update、零新增、零目标 |
| `EVT-18` | Update/alias 后 FTS 每 Event 一行；旧文本/新 alias 可召回；D01 rebuild 一致 |
| `EVT-24` | 同 alias 两 Event 独立；新增 alias 只刷新目标 Event |
| `PMT-09` | P-03 user content 无 user_context；system 只含合成 prompt/schema |
| `PMT-14/15` | strict 额外/缺失/错误类型/非法引用/冲突 → llm_failed、零部分写 |
| `E2E-14_ANALYSIS` | 同公司同 Subject+Scope 新监管调查可归属原 Event；复用 Event ID、写新 Update/证据；不创建 Topic/Published/RSS |

另测：D08 reason 四分支与真实 SQLite；业务表和 FTS 全快照；多结果 commit 后目标可读回；空结果/empty clues 无事务；SQL 在事务外/内的调用计数；globalThis.fetch/Adapter 零调用；关闭 DB 后无 WAL/SHM/unhandled rejection。

### 8.6 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-analysis tests/event-search tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/event-search.test.ts tests/database/schema-consistency.test.ts tests/database/transaction.test.ts tests/processing/content-repository.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|searchEvents|routeProcessing|analyzeKnowledge|matchTopics|user_context|raw_data|topics|knowledge|published_items|routeProcessing|rebuildEventSearch|EventSearchError|INSERT|UPDATE|DELETE' src/event-analysis/event-analysis.ts src/event-analysis/event-analysis-logger.ts src/event-analysis/index.ts src/event-analysis/contracts.ts || true
rg -n 'config/prompts|config/prompt|process\.env|apiKey|new .*Repository|CryptoIdGenerator|SystemClock' src/event-analysis tests/event-analysis tests/fixtures/event-analysis.ts || true
git diff --name-only <BASE_SHA> -- src/event-search/event-candidate-repository.ts src/event-search/candidate-ranking.ts src/event-search/candidate-context.ts src/llm src/prompt src/database src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

静态扫描的生产命中必须逐条解释：T05 service 合法引用/映射 D08 error；测试中的 fixture seeding/extra-field injection 属允许用途。交回须附真实 SQLite + 真实 D08 + D02 StubP03 的 Case→测试名→命令→PASS、P-02/P-03 次数、reason 四分支、事务内外探针、rollback/FTS/alias/replay/target 证据，并只报 `REVIEW`/`BLOCKED`。

### 8.7 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T04_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §8.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 9. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；不得由 Lead 代替 Worker 编码，也不得让 Worker 自行创建 candidate。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 `HEAD`/tree；tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡精确白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case、错误/隐私、禁止路径、no-op、定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch 路径/SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **同次交回硬门禁**：冻结完成后，Lead 必须在**同一次回复**中给出冻结 tree、patch 路径/SHA-256、路径数、blob、定向/full 验证数字与交回结论。若 Architect 只能从磁盘发现冻结产物，本卡退回流程重做，不接受事后补报。
6. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
7. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
8. **Merge**：Lead 在 D09 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
9. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
10. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

`progress.md` 每卡记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_PATH`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## 10. D09 集成 Gate 与最终验收

五卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/event-analysis tests/event-search tests/database/event-search.test.ts tests/database/schema-consistency.test.ts tests/database/transaction.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/processing/content-repository.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database/schema.sql src/database/event-search.ts src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

Gate 必须保留：

- `EVT-01`～`EVT-18`、`EVT-21`～`EVT-24` 的 D09 P0 责任逐项 Case→测试文件/命令→PASS；`EVT-19/20`、`PMT-03/04` 明确为 S0 非 P0。
- `PMT-14/15`、`PMT-09` 和 `E2E-14` 分析部分逐项证据；E2E-14 不冒充 Topic/Publish/RSS 完成。
- D08 reason 四分支；Content 缺失/empty clues 时 P-03 0 次且零写；no candidates 时 P-03 1 次且可 NEW_EVENT。
- D08 search 1 次、P-02 1 次、P-03 0/1 次的分支计数；任何路径均无第二次 P-02 或第二次 P-03。
- P-03 task data 顶层只有 content+candidates，六字段精确、最近窗口正确、无 clues/user_context/Topics/Knowledge/raw/URL/Token。
- NEW_EVENT 零初始 Update；NEW_UPDATE 复用与事实修正边界；NO_INCREMENT 零新目标；confirmed_aliases 三 Action 均保存且不吸收 search_terms。
- 全部 results/证据/alias/FTS 单事务；同一 Event FTS 刷新一次；中途 DB/FTS/readback 失败全部回滚；目标只含真正新建项。
- 业务与 FTS 前后快照、事务内外探针、fetch/Adapter 零调用、错误/logger 隐私 sentinel 全部通过。
- 相对批准基线仅允许 D09 路径；D01 DDL/FTS 实现、D02 LLM/Prompt/Schema、D04～D08 算法、真实 config、CI/package/lock 零未批准 diff。
- 测试资源全部关闭，无 server/socket/timer/unhandled rejection/WAL/SHM 残留。

Lead 提交 `D09_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 依持续授权复核本地 Gate、push 已批准 main SHA、等待精确 SHA CI Success，并完成最终角色/workspace 归档与心跳清理。本地 Gate、远程 CI 与 Architect 最终验收全部满足前不得签发 `D09_FINAL_PASS`。

G3 批准且正式开发触发后，由 Architect 创建唯一 D09 推进心跳（默认 `*/10 * * * *`，`Asia/Shanghai`）并在 `progress.md` 记录准确 ID；Lead 不自行创建心跳。最终 PASS 后由 Architect 核验并归档全部 D09 Worker/Workspace 与 D09 Lead，删除准确心跳并复查删除结果。

## 11. 风险、回滚与停止条件

- **上游门禁**：D09 Intent/Spec 在 Git 中仍为 `DRAFT · G1_PENDING_OWNER_APPROVAL`；本 Plan 只可供 G3 审核，不能在上游获批前开发。
- **文档基线滞后**：D09 Intent/Spec 头部仍写 `2ab5de8`，而 Architect 本轮固定基线和当前 main 为 `2484b287…`。本 Plan 使用明确的 `2484b287…`；Architect 应在 G1/G2 同步文档状态与基线。
- **P-03 输入文档冲突**：项目技术设计 §17.5 写有“P-02 clues”进入 P-03；D09 当前 Spec、本次任务边界及技术设计 §2.5/§11 伪代码只使用 Content + candidates。Lead 按当前明确任务边界制定 Plan，但 Architect 必须在 G2/G3 明确采纳并处理权威文档冲突，不得由 Worker 自行选择。
- **D08 契约修订**：`reason` 是 D08 成功结果的受控可选元数据扩展；若 G2 不接受，T01 及其下游不能进入开发，且不得用第二次 P-02、暴露 clues 或猜测空原因替代。
- **D02 漂移**：D02 是唯一 strict Schema。若实际行为与 §2.1 不符，立即 `BLOCKED`，不在 D09 复制/修补 validator。
- **事务边界**：任何 LLM/D08/Content 读取发生在 D09 写事务内、T04 回调返回 PromiseLike、FTS 不随外层回滚、或事务内 logger/异步调用，均判 BLOCKER。
- **FTS 实现**：只调用 D01 `refreshEventSearch()`；不得为了“简化”直接写 event_search、使用全量 rebuild 正常路径或改动 schema。
- **私有数据**：测试只读取临时合成 Prompt；真实 `config/prompts`、`config/prompt/user-context.md`、API Key、正文/模型 sentinel 不得进入提交、任务卡或日志。
- **已知观察项**：D07 的 RSS 清理时序问题仍是非 D09 观察项；若 full verify 复现，记录测试名/次数/环境并按 D05 先例定位，不弱化 D09 断言或修改 D05。
- **回滚**：每卡 candidate 以固定 base 单一 parent，必要时 revert merge commit；不得 reset 主线、覆盖其他里程碑或修改已批准上游来“修复”D09。
- 同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分或 Spec 根因；涉及上游变更重走受影响 Gate。

## 12. G3 门禁结论

- 本 Plan 只把当前 D09 Intent/Spec 映射为五张严格串行、文件级可执行任务卡，没有新增公共返回字段、DDL、Prompt、依赖、Worker 或替代任务 ID；唯一扩展是 Spec 已明确列出的 D08 可选只读 reason，其 Lead 审核结论见 §1.1。
- T01～T05 均列出精确允许写集、固定 base、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive 证据字段。
- 当前设计保证：完整 D08 搜索后一次 P-03；empty clues 与 no candidates 可区分且绝不重调 P-02；P-03 task data 不含 clues/User Context/Topics/Knowledge/raw；D02 独占 strict Schema/reference/conflict；三 Action、证据、alias、FTS 与 new_targets 满足 D09 边界。
- `EVT-19/20`、`PMT-03/04` 保持 S0，不用 Stub 冒充；`E2E-14` 只声明分析部分。
- 当前结论：`D09_PLAN=G3_PENDING_ARCHITECT_REVIEW`。G3 复核通过前任务状态保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push 或最终验收。
- 仍待 Architect 在 G1/G2/G3 处理：Intent/Spec 状态、文档基线 `2ab5de8→2484b287…`、技术设计 §17.5 与当前“P-03 不收 clues”的冲突、D08 reason 扩展的最终批准。Lead 不自行修改或批准上述上游事项。
