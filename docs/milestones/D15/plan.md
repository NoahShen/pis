# D15 Plan：六阶段 Runtime 与调度

> 版本：v0.1
> 状态：`G3_PENDING · ARCHITECT_REVIEW`
> 日期：2026-11-19
> 计划基线：main `e25bc2ebc55825e54420b20c3a3cadac42301b62` / tree `83db6072eb5ec565d810827edfec438feb7f0039`
> Intent：`docs/milestones/D15/intent.md`（`APPROVED · G1`）
> Spec：`docs/milestones/D15/spec.md`（`APPROVED · G2`）

本文只把已批准的 D15 Intent/Spec 映射为五张文件级、严格串行的任务卡。当前只交付 `plan.md` 与 `progress.md`；**不创建 Worker、心跳、candidate、merge 或生产代码**。Plan 未获 Architect G3 批准前，五卡保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标、公共契约与不可变更边界

D15 交付无 HTTP route、无 app/server 接线的六阶段 Runtime 编排与调度：

- 六类任务判别联合，任务对象只含业务 ID；业务模块不持有 Runtime、队列或其他模块引用。
- 每阶段独立有界内存队列 + 初始 1 个 Worker；满时背压等待，正常运行不丢任务；关闭唤醒所有等待者。
- 统一纯函数 `mapResultToDownstreamTasks()` 把业务结果映射为下游任务；空结果成功且不派发。
- 错误三分类 `retryable | non_retryable | cancelled`；技术性错误最多执行 2 次（含首次）。
- 上游 COMMIT 后派发失败只重试未入队下游；已成功入队的下游绝不重复，失败下游单独重试；不重跑业务/LLM。
- Cron 只调度 enabled Source，只提交 `COLLECT`；非法表达式/时区启动即拒且零部分注册；默认 `Asia/Shanghai`。
- 优雅关闭：停新增 → 内部继续派发 → drain → 关队列；超时 abort 剩余工作并记录，不 `process.exit`。

公共契约固定为：

```ts
export type TargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

export type RuntimeTask =
  | { readonly type: "COLLECT"; readonly source_id: string }
  | { readonly type: "PROCESS"; readonly source_item_id: string }
  | { readonly type: "EVENT_ANALYSIS"; readonly content_id: string }
  | { readonly type: "KNOWLEDGE_ANALYSIS"; readonly content_id: string }
  | { readonly type: "TOPIC_MATCHING"; readonly target_type: TargetType; readonly target_id: string }
  | { readonly type: "PUBLISH"; readonly target_type: TargetType; readonly target_id: string };

export type RuntimeTaskType = RuntimeTask["type"];

export interface PublishResult {
  readonly published_item_id: string;
}

export interface StageServices {
  collect(sourceId: string, options?: { readonly signal?: AbortSignal }): Promise<CollectResult>;
  process(sourceItemId: string, options?: { readonly signal?: AbortSignal }): Promise<ProcessResult>;
  analyzeEvent(contentId: string, options?: { readonly signal?: AbortSignal }): Promise<EventAnalysisResult>;
  analyzeKnowledge(contentId: string, options?: { readonly signal?: AbortSignal }): Promise<KnowledgeResult>;
  matchTopics(type: TargetType, id: string, options?: { readonly signal?: AbortSignal }): Promise<TopicMatchingResult>;
  publish(type: TargetType, id: string, options?: { readonly signal?: AbortSignal }): Promise<PublishResult>;
}

export interface Runtime {
  submit(task: RuntimeTask): Promise<void>;
  start(): Promise<void>;
  stopAccepting(): void;
  drain(): Promise<void>;
  shutdown(options?: { readonly timeoutMs?: number }): Promise<void>;
}
```

- `TargetType` 与 D10 `TopicTargetType` 结构一致，Plan 要求复用该类型别名，不另造漂移的第二套字符串联合。
- `CollectResult`、`ProcessResult`、`KnowledgeResult`、`EventAnalysisResult`、`TopicMatchingResult` 只以 `import type` 复用 D05～D10 的已批准契约；Runtime 不 import 任何业务实现。
- `PublishResult` 按 Spec §5 的接口形状在 Runtime 契约内声明；D11 未交付，D15 只用 stub 注入，不实现模板渲染/RSS/云端/API。
- Spec §6 的关闭序列显式包含 `stopAccepting()`；Intent §3 的草案接口只列 `submit/start/drain/shutdown`。本 Plan 以已批准 Spec §6 为准增加 `stopAccepting()`，`drain()`/`shutdown()` 的业务语义不变；这是实现契约澄清，不是范围扩张，G3 时请 Architect 确认。

不可变更边界：

- 不修改 D00～D10 任何业务实现、DDL、Prompt、配置 API、CI、`package.json`/`package-lock.json`。
- 不新增持久化任务表、Outbox、恢复扫描、Redis、分布式 Worker；崩溃窗口按 V1 接受。
- 不实现 Published Item 模板、RSS 生成、云端上传、API 查询、D11 Product Generation。
- 不在 `src/app.ts`、`src/server.ts`、`src/lifecycle.ts` 接线；D15 交付可组合 Runtime/Scheduler 模块与测试证据。
- 不新增依赖；Cron 使用已确认 `node-cron` 4.6.0。
- 六类任务只传 ID，不含正文、对象、模型输出、AbortSignal 或函数。
- 不调用 `process.exit()`；进程生命周期由调用方决定。
- 不读取私有 `config/prompts`、`config/prompt/user-context.md`、API Key、Token；测试只用合成 sentinel。
- 不使用 `any`、`@ts-ignore`、`@ts-expect-error`；不以 `SELECT *`、对象 spread 或宽泛 row 绕过契约。

## 2. 上游只读核对结论与文件布局

### 2.1 上游只读核对结论

- `src/collection/contracts.ts`：`CollectionService.collect(sourceId, { signal? })` 返回 `{ new_source_item_ids: string[] }`；错误码 `invalid_input | unsupported_source | aborted | collection_failed`。
- `src/processing/contracts.ts`：`ProcessingService.process(sourceItemId, { signal? })` 返回 `{ content_id: string | null; routes: Array<"EVENT" | "KNOWLEDGE"> }`；错误码 `invalid_input | aborted | processing_failed | llm_failed`。
- `src/knowledge/contracts.ts`：`KnowledgeService.analyze(contentId, { signal? })` 返回 `{ knowledge_id: string | null }`；错误码 `invalid_input | aborted | knowledge_failed | llm_failed`。
- `src/event-analysis/contracts.ts`：`EventAnalysisService.analyze(contentId, { signal? })` 返回 `{ new_targets: Array<{ target_type: "EVENT" | "EVENT_UPDATE"; target_id: string }> }`；错误码 `invalid_input | aborted | event_analysis_failed | llm_failed`。
- `src/topic-matching/contracts.ts`：`TopicMatchingService.match(type, id, { signal? })` 返回 `{ should_publish: boolean; target_type; target_id }`；错误码 `invalid_input | aborted | target_not_found | topic_matching_failed | llm_failed`。
- `src/configuration/source-repository.ts`：`SourceRepository.listEnabled()` 执行 `WHERE enabled = 1 ORDER BY id COLLATE BINARY ASC`，返回 `id/name/type/url/cron/enabled/description/last_collected_at`；`Source.cron` 为字符串、`Source.enabled` 为布尔。D15 只读复用，不写第二份 Source SQL。
- `src/database/open-database.ts`：`openDatabase()` 启用 WAL、`foreign_keys=ON`、`busy_timeout=5000`；`src/database/transaction.ts` 的 `withTransaction()` 为同步 `BEGIN IMMEDIATE`，拒绝 async/thenable；`initializeDatabase(db)` 应用既有 schema。D15 仅在 RUN-16 测试 fixture 中使用真实 SQLite。
- `src/database/error-classification.ts`：已有 SQLite 分类 `busy_locked | constraint | sqlite | unknown`；Runtime 错误分类可只读复用 `classifySqliteError()` 判断 `SQLITE_BUSY`/`SQLITE_LOCKED`，不修改 D01。
- `package.json` / `package-lock.json`：`node-cron` 已固定为 `4.6.0`，提供 `validate`/`schedule`；D15 不新增依赖、不改 package/lock。
- 当前 `src/` 无 `runtime/`、`scheduler/` 目录；D15 新增 `src/runtime/` 与 `src/scheduler/`，测试新增 `tests/runtime/`、`tests/scheduler/` 与 fixture。
- D11 Product Generation 尚未交付；`PublishResult` 与 `publish` 只按 Spec §5 形状声明并由 T05 stub 注入，不冒充 D11 实现。

未发现已批准 D15 Spec 与 D01 SQLite/transaction、D03 `listEnabled()`、D05～D10 结果/错误契约之间的实现冲突。若 Worker 发现实际行为偏离以上只读结论，立即 `BLOCKED`，不得在 D15 修补上游或复制第二份规则。

### 2.2 模块职责

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/runtime/contracts.ts` | 六类 Task、结果类型别名、`StageServices`、`Runtime`、`RuntimeDependencies`、日志白名单类型 | T01 |
| `src/runtime/task-mapping.ts` | 纯函数 `mapResultToDownstreamTasks()`、`runtimeTaskId()`；空结果→`[]` | T01 |
| `src/runtime/task-errors.ts` | `retryable/non_retryable/cancelled` 分类、Abort 识别、SQLite 短暂锁映射 | T01 |
| `src/runtime/bounded-task-queue.ts` | FIFO 有界队列、背压等待、关闭/abort 唤醒、`QueueClosedError` | T02 |
| `src/runtime/stage-worker.ts` | 单 Worker 串行消费循环、`done()`、best-effort `onError` | T02 |
| `src/runtime/task-dispatch.ts` | 下游逐任务独立派发/有限重试，已成功不重复入队 | T03 |
| `src/runtime/runtime-logger.ts` | 八字段白名单 logger，best-effort | T03 |
| `src/runtime/runtime-errors.ts` | `RuntimeInputError`/`RuntimeClosedError` 稳定错误 | T03 |
| `src/runtime/runtime.ts` | `createRuntime()`、六队列/六 Worker、重试、派发、drain、关闭 | T03/T05 |
| `src/runtime/index.ts` | Runtime 公共导出边界 | T01/T02/T03/T05 |
| `src/scheduler/contracts.ts` | `CronSchedulerOptions`、`CronScheduler`、`CronBackend`、`CronSchedulerError` | T04 |
| `src/scheduler/cron-scheduler.ts` | enabled Source 校验/注册、手工触发、node-cron 适配 | T04 |
| `src/scheduler/index.ts` | Scheduler 公共导出边界 | T04 |
| `tests/fixtures/runtime.ts` | 合成任务/结果、计数 stub、gate、真实 SQLite RUN-16 探针 | T01～T05 递进 |
| `tests/fixtures/scheduler.ts` | fake CronBackend、真实 SourceRepository/SQLite 数据、合成 Source | T04～T05 |
| `tests/runtime/*.test.ts` | T01～T05 的单元、边界与真实 SQLite 集成证据 | 各卡 |
| `tests/scheduler/*.test.ts` | T04 调度、时区/表达式、真实 SQLite enabled 过滤 | T04/T05 |

### 2.3 内部不变量

- Runtime → 业务模块只允许 `import type` 契约；业务模块不得 import `src/runtime`、队列或 Worker。
- 任务对象扁平且只含 ID；不得把 Result DTO、Cause、Prompt、正文、模型输出或 AbortSignal 放入任务。
- `mapResultToDownstreamTasks()` 无 I/O、无数据库、无 LLM、无时钟、无随机；同一输入恒返回同一输出。
- Runtime 不开启数据库事务；SQLite 短事务只属于业务模块。Runtime 的职责是“调用 → 映射 → 派发”。
- 阶段重试只包裹阶段服务调用；派发重试在阶段成功后独立进行，绝不通过阶段重试补偿派发失败。
- 每阶段独立队列/独立容量/独立 Worker；一个阶段失败或背压不改变其他阶段队列容量。
- 日志只允许 `taskType/taskId/stage/attempt/maxAttempts/queueSize/reason/durationMs`；logger 失败不改变业务结果。
- Scheduler 只调用 `sources.listEnabled()` 与 `submit()`；不调用 Adapter、Collection、DB 写入或 HTTP。
- Scheduler 先校验全部 enabled Source 的表达式与时区，再注册任何一个；任何非法项都不得留下部分注册。
- 关闭顺序固定：`stopAccepting()` → 内部派发可继续 → `drain()` → 关闭队列/Worker；超时才 abort 剩余工作。

## 3. 五卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | 六类 Task/Result 纯契约、纯下游映射、错误三分类 | 无队列、Worker、Runtime、重试、派发、Cron、关闭 |
| T02 合并后 | 有界 FIFO 队列、背压、关闭/abort 唤醒、单 Worker 串行循环 | 无阶段重试、无下游派发、无 Runtime、无 Cron |
| T03 合并后 | 六阶段 Runtime、最多 2 次技术重试、派发失败只重试下游、drain、基础关闭 | 无 Cron、无超时取消、无真实 SQLite 六阶段集成 |
| T04 合并后 | enabled Source Cron 注册、手工触发、表达式/时区校验、node-cron 适配 | 无 Runtime 重试/派发/关闭集成；无 app 接线 |
| T05 合并后 | 优雅关闭、超时 abort、真实 SQLite + stub StageServices 六阶段集成、全部 P0 证据 | 无 D11 模板/RSS/云端/API；无 D16 真实模型/E2E 结论 |

五卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 和独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。

| Case | 主责任卡 | D15 必测断言 |
|---|---|---|
| `RUN-01` | T01/T05 | 六类任务返回结果→正确后继；任务只含 ID；业务模块无 Runtime/队列引用 |
| `RUN-02` | T01/T03/T05 | Collection 空、Process null/空 routes、Event 空 targets、Knowledge null、Topic false 均为成功空结果，不重试、不派发 |
| `RUN-03` | T03/T05 | 暂时 HTTP/LLM/SQLite busy 错误最多 2 次（含首次）；第二次成功继续，第二次失败终止 |
| `RUN-04` | T03/T05 | invalid_input/target_not_found/cancelled 不重试；取消向上传播且不误判为空结果 |
| `RUN-05` | T03/T05 | COMMIT 后一个下游入队失败一次：只重试未入队下游，不重跑业务/LLM |
| `RUN-06` | T03/T05 | 两个下游：第一个成功不重复，第二个单独重试；失败不触发上游重跑 |
| `RUN-07` | T03/T05 | 上游提交失败不派发；可按技术规则重试上游，第二次成功才派发 |
| `RUN-08` | T02/T05 | 容量满时提交背压等待；Worker 消费后恢复；不丢任务 |
| `RUN-09` | T02/T04/T05 | Cron 只提交 COLLECT；API GET/静态 RSS 同步不进入六阶段队列 |
| `RUN-10` | T05 | 关闭前有排队/执行/背压/重试任务：停新增、内部继续派发、排空后关闭 |
| `RUN-11` | T05 | 关闭超时 abort 剩余工作、解除等待、记录日志、不死锁、不 process.exit |
| `RUN-12` | T01/T03/T05 | Event/Knowledge 双路独立；一路失败不阻断另一路；两 Worker 各 1、队列独立 |
| `RUN-13` | T05（P1） | 记录 COMMIT→入队崩溃窗口；无持久化任务表/Outbox/恢复扫描；不阻断 P0 |
| `RUN-14` | T03/T05（P1） | 日志仅八字段白名单、有类型/ID/原因/次数、无正文/Prompt/Token；不阻断 P0 |
| `RUN-15` | T01/T03/T05 | 非法 Event/Topic 引用（`*_failed`/`llm_failed`）retryable；不存在业务目标 `target_not_found` non_retryable；不写非法关联 |
| `RUN-16` | T03/T05 | Adapter HTTP/LLM 等待期间无写事务；Runtime 不开启事务；短事务只在业务写入阶段 |
| `CFG-03` | T04/T05 | 禁用 Source 不注册、不触发；Cron 只对 enabled Source 提交 COLLECT |
| `CFG-07` | T04/T05 | 非法 Cron 表达式/时区启动即拒；零部分注册；默认 Asia/Shanghai |

`RUN-13`/`RUN-14` 为 P1 记录边界，不作为 P0 阻断；其余 Case 为 D15 P0 Gate 硬条件。真实模型语义（S0/S1）不在 D15 冒充通过，属 D16。

## 4. D15-T01 · 六类 Task/Result、纯下游映射与错误分类

### 4.1 依赖与精确允许写集

- 前置：D15 Plan 已获 G3 批准并明确启动 T01；base 固定为批准 `plan.md`/`progress.md` 后的精确文档提交 SHA。
- 新增且仅允许写：`src/runtime/contracts.ts`。
- 新增且仅允许写：`src/runtime/task-mapping.ts`。
- 新增且仅允许写：`src/runtime/task-errors.ts`。
- 新增且仅允许写：`src/runtime/index.ts`。
- 新增且仅允许写：`tests/fixtures/runtime.ts`。
- 新增且仅允许写：`tests/runtime/task-mapping.test.ts`。
- 新增且仅允许写：`tests/runtime/task-errors.test.ts`。
- 只读复用：D05～D10 `contracts.ts`、`src/database/error-classification.ts`、`src/time/clock.ts`、D10 `TopicTargetType`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2、§3；Intent §2.1～§2.5；`RUN-01`、`RUN-02`、`RUN-12`（映射/类型部分）、`RUN-15`（分类基础）。

### 4.2 禁止范围

- 不得新增队列、Worker、Runtime、重试、派发、Cron、关闭实现或任何 I/O。
- 不得修改 `src/collection`、`src/processing`、`src/knowledge`、`src/event-analysis`、`src/event-search`、`src/topic-matching`、`src/database`、`src/configuration`、`src/time`、`src/id`。
- 不得修改 app/server/lifecycle、配置、CI、package/lock、Prompt。
- 不得重复声明 D05～D10 已有的结果类型；只允许 `import type`，唯一本地结果类型为 `PublishResult`。
- 不得把 `TargetType` 写成与 `TopicTargetType` 可能漂移的第二套列表；必须以别名/受测结构等价方式复用。
- 不得使用 `any`、`@ts-ignore`、`@ts-expect-error` 或宽泛对象 spread。

### 4.3 实现要求

1. `contracts.ts` 声明且仅声明六种 `RuntimeTask`；每个变体只含 flat ID 字段；`RuntimeTaskType = RuntimeTask["type"]`。
2. 从 D05～D10 以 `import type` 引入 `CollectResult`、`ProcessResult`、`KnowledgeResult`、`EventAnalysisResult`、`TopicMatchingResult`；`TargetType` 复用 D10 `TopicTargetType`；`PublishResult` 按 Spec §5 本地声明为 `{ published_item_id: string }`。
3. `StageServices` 六方法、可选 `{ signal?: AbortSignal }`；`RuntimeDependencies` 固定 `services` 以及 `queueCapacity?`（默认 8）、`maxAttempts?`（默认 2）、`dispatchAttempts?`（默认 2）、`shutdownTimeoutMs?`（默认 5000）、`logger?`。
4. `RuntimeLogEntry` 只允许 `taskType/taskId/stage/attempt/maxAttempts/queueSize/reason/durationMs`；`Runtime` 接口含 `submit/start/stopAccepting/drain/shutdown`。这些是类型，不实现行为。
5. `mapResultToDownstreamTasks()` 是纯函数，精确按 Spec §2：
   - `COLLECT.new_source_item_ids[]` → 每个非空白 ID 一个 `PROCESS`，保持输入顺序；
   - `PROCESS.content_id=null` → `[]`；否则按 routes 生成 `EVENT_ANALYSIS` 与/或 `KNOWLEDGE_ANALYSIS`，去重且固定 EVENT 在前、KNOWLEDGE 在后；
   - `EVENT_ANALYSIS.new_targets[]` → 每个非空白 target 一个 `TOPIC_MATCHING`，保持输入顺序；
   - `KNOWLEDGE_ANALYSIS.knowledge_id` 非空 → 一个 `TOPIC_MATCHING("KNOWLEDGE", id)`；null/空白 → `[]`；
   - `TOPIC_MATCHING.should_publish=false` → `[]`；true → 一个 `PUBLISH`，target 使用**本任务**的 `target_type/target_id`，不信任服务返回替换目标；
   - `PUBLISH` → `[]`。
6. 空数组、空/空白 ID、null、false 都返回 `[]` 且不抛错；空结果是成功，不重试。
7. `runtimeTaskId(task)` 为日志提供稳定业务 ID：COLLECT→`source_id`；PROCESS→`source_item_id`；EVENT_ANALYSIS/KNOWLEDGE_ANALYSIS→`content_id`；TOPIC_MATCHING/PUBLISH→`target_id`。
8. `task-errors.ts` 导出 `TaskErrorCategory = "retryable" | "non_retryable" | "cancelled"` 与 `classifyTaskError(error): { category; reason }`：
   - 先识别取消：`name=AbortError`、`code=ABORT_ERR`、`code=LLM_CANCELLED`、`code=aborted` → `cancelled`；
   - `*_failed` 与 `llm_failed` → `retryable`；
   - `invalid_input`、`target_not_found`、`unsupported_source` → `non_retryable`（Spec §3 顶表的“配置无效”覆盖 `unsupported_source`）；
   - `classifySqliteError()=busy_locked` → `retryable`；
   - 其他未知技术异常 → `retryable`；返回值只含稳定 code/category，不保留 cause/SQL/正文/URL。
9. `index.ts` 只导出 T01 的类型、`mapResultToDownstreamTasks`、`classifyTaskError`、`runtimeTaskId`；不导出任何队列/Worker/Cron。
10. fixture 只建立合成 Task/Result 构造器与断言辅助；无 SQL、无 LLM、无网络、无私有 sentinel。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `TASK_UNION` | 恰好六种 type；每变体 `Object.keys()` 精确等于允许 ID 字段；无 AbortSignal/函数/额外字段 |
| `RUN-01_MAP` | 六类结果分别映射到 Spec §2 精确后继任务；顺序稳定 |
| `RUN-02_MAP` | 空数组、null content_id、空 routes、空 targets、null knowledge_id、false publish 均 `[]` 且不抛错 |
| `RUN-12_MAP` | PROCESS 同时含 EVENT/KNOWLEDGE 时生成两条独立任务；EVENT 在前，重复 route 去重 |
| `PUBLISH_TERMINAL` | PUBLISH 任意结果 → `[]` |
| `RUN-15_CLASSIFY` | `llm_failed`/`collection_failed`/`processing_failed`/`event_analysis_failed`/`knowledge_failed`/`topic_matching_failed` → retryable；`invalid_input`/`target_not_found`/`unsupported_source` → non_retryable；`aborted`/AbortError/ABORT_ERR/LLM_CANCELLED → cancelled |
| `SQLITE_BUSY` | `SQLITE_BUSY`/`SQLITE_LOCKED` → retryable；`SQLITE_CONSTRAINT` 不作为普通技术重试依据 |
| `UNKNOWN_TECH` | 未知 Error → retryable；返回信息不含 cause/message 原文 |
| `BLANK_IDS` | 空/空白 ID 被过滤，绝不生成空白 ID 任务 |
| `PURE_DETERMINISTIC` | 同一输入两次深相等；mapping 源码无 I/O/DB/LLM/时钟/随机 |
| `ID_ONLY` | 任务序列化/枚举只有 ID；无对象/正文/模型输出/队列引用 |

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/runtime/task-mapping.test.ts tests/runtime/task-errors.test.ts
npm run format
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|withTransaction|BoundedTaskQueue|StageWorker|node-cron|process\.exit|user_context|raw_data|apiKey|config/prompts' src/runtime/contracts.ts src/runtime/task-mapping.ts src/runtime/task-errors.ts src/runtime/index.ts tests/fixtures/runtime.ts tests/runtime/task-mapping.test.ts tests/runtime/task-errors.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。静态扫描命中仅允许 `classifySqliteError` 只读引用或测试禁止字段断言，并须逐条解释。交回必须列 base SHA、实际路径、Case→测试名、命令结果和已知限制，仅报 `REVIEW`/`BLOCKED`。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE` |
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

## 5. D15-T02 · 有界队列背压/关闭唤醒与单 Worker 消费循环

### 5.1 依赖与精确允许写集

- 前置：`D15-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增且仅允许写：`src/runtime/bounded-task-queue.ts`。
- 新增且仅允许写：`src/runtime/stage-worker.ts`。
- 修改且仅允许改：`src/runtime/index.ts`。
- 修改且仅允许改：`tests/fixtures/runtime.ts`。
- 新增且仅允许写：`tests/runtime/bounded-task-queue.test.ts`。
- 新增且仅允许写：`tests/runtime/stage-worker.test.ts`。
- 只读复用：T01 契约/mapping/分类、`src/runtime/contracts.ts`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §4、§5（Worker 部分）、§6（唤醒基础）、§8（queueSize 基础）；`RUN-08`、`RUN-10`（队列唤醒基础）、`RUN-11`（解除等待基础）。

### 5.2 禁止范围

- 不得实现 Runtime、阶段重试、下游派发、drain/stopAccepting/shutdown、Cron 或 DB。
- 不得让队列无界增长、静默丢弃、忙轮询或使用 `setInterval`/`sleep`。
- 不得在 worker 中吞掉错误而不给 `onError`；不得让一个 handler 异常终止整个 Worker 循环。
- 不得修改 T01 契约（除非纯类型导出修正，必须在本卡变更范围说明）。
- 不得修改 app/server/lifecycle、配置、CI、package/lock、Prompt。

### 5.3 实现要求

1. `BoundedTaskQueue<T>` 为 FIFO：`enqueue(task): Promise<void>`、`dequeue(): Promise<T | null>`、`close(): void`、`size: number`、`isClosed: boolean`。
2. `capacity` 默认 8，必须为正整数；`signal?: AbortSignal`。队列不执行任务、不调用业务模块。
3. `enqueue`：有空位则立即接收；满时按 FIFO 背压等待；关闭/abort 后立即拒绝 `QueueClosedError`（code `queue_closed`）；正常运行不抛“队列满”、不丢任务。
4. `dequeue`：FIFO 取出；为空且未关闭则等待；关闭/abort 时唤醒所有等待者，缓冲任务仍可继续被排空，排空后返回 `null`。
5. `close()` 幂等：拒绝所有等待 enqueue 者、以 `null` 唤醒所有等待 dequeue 者；不执行任务；可通过 abort signal 触发同等唤醒。
6. abort signal 已中止时构造队列即 `isClosed=true`；等待中的 enqueue 拒绝、dequeue 返回 null；移除监听避免泄漏。
7. `StageWorker` 单循环：`dequeue()` → `handle(task)` 串行执行 → 继续；无并发、无定时器；`start()` 幂等；`done()` 在队列关闭且排空后 resolve。
8. handler 拒绝时调用可选 `onError(error)`（best-effort，抛错不得终止循环）后继续；不自行重试、不派发下游。
9. `index.ts` 导出 `BoundedTaskQueue`、`QueueClosedError`；`StageWorker` 保持内部，测试直接 import `src/runtime/stage-worker.ts`。
10. 不创建 Runtime 对象；T02 不宣称 RUN-03～RUN-07、RUN-10/RUN-11 的完整语义。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `FIFO` | 入队/出队顺序严格 FIFO |
| `SIZE` | `size` 精确反映缓冲数量；handoff 不重复计数 |
| `CAPACITY_DEFAULT` | 未给 capacity 时默认 8；非法 capacity 拒绝 |
| `RUN-08_BACKPRESSURE` | capacity=1：第二任务等待；dequeue/Worker 消费后恢复；不丢任务 |
| `BACKPRESSURE_FIFO` | 多个等待 enqueue 者按 FIFO 唤醒 |
| `CLOSE_WAKE_ENQUEUE` | close 时所有等待 enqueue 者以 `queue_closed` 拒绝 |
| `CLOSE_WAKE_DEQUEUE` | close 时等待 dequeue 者以 null 唤醒 |
| `CLOSE_DRAIN` | 关闭时缓冲任务先排空，再返回 null；不丢已接受任务 |
| `ABORT_WAKE` | abort signal 唤醒等待者并 `isClosed=true` |
| `NO_DROP` | N 入队 = N 出队；无静默失败 |
| `WORKER_SERIAL` | 3 任务顺序处理，最大并发 1 |
| `WORKER_ERROR_CONTINUE` | handler 抛错一次触发 onError，后续任务仍处理 |
| `WORKER_DONE` | close + 排空后 `done()` resolve；无残留定时器/handle |

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/runtime/bounded-task-queue.test.ts tests/runtime/stage-worker.test.ts tests/runtime/task-mapping.test.ts tests/runtime/task-errors.test.ts
npm run format
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|setInterval|setTimeout|process\.exit|fetch\(|withTransaction|new Database|node-cron|user_context|raw_data|apiKey' src/runtime/bounded-task-queue.ts src/runtime/stage-worker.ts src/runtime/index.ts tests/fixtures/runtime.ts tests/runtime/bounded-task-queue.test.ts tests/runtime/stage-worker.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`setTimeout` 仅允许测试等待超时保护，不得出现在队列/Worker 实现。交回须列 base SHA、路径、Case→测试名、队列容量/等待者数量/无残留 handle 证据，仅报 `REVIEW`/`BLOCKED`。

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

## 6. D15-T03 · 有限重试、只重试下游派发与事务外网络边界

### 6.1 依赖与精确允许写集

- 前置：`D15-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 新增且仅允许写：`src/runtime/task-dispatch.ts`。
- 新增且仅允许写：`src/runtime/runtime-logger.ts`。
- 新增且仅允许写：`src/runtime/runtime-errors.ts`。
- 新增且仅允许写：`src/runtime/runtime.ts`。
- 修改且仅允许改：`src/runtime/index.ts`。
- 修改且仅允许改：`tests/fixtures/runtime.ts`。
- 新增且仅允许写：`tests/runtime/task-dispatch.test.ts`。
- 新增且仅允许写：`tests/runtime/runtime-retry-dispatch.test.ts`。
- 新增且仅允许写：`tests/runtime/runtime-transaction-boundary.test.ts`。
- 只读复用：T01/T02、D01 `openDatabase`/`initializeDatabase`/`withTransaction`/`classifySqliteError`、D05～D10 错误类与契约。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §3、§5、§6（drain/stopAccepting 基础）、§8；`RUN-03`、`RUN-04`、`RUN-05`、`RUN-06`、`RUN-07`、`RUN-12`（集成基础）、`RUN-15`、`RUN-16`。

### 6.2 禁止范围

- 不得实现 Cron/Scheduler、超时 shutdown/abort 完整语义、app/server 接线、D11 Published Item/RSS/API。
- 不得修改 D05～D10、D01 DDL/transaction、`src/configuration`、CI、package/lock、Prompt。
- 不得把派发失败放进阶段重试循环；不得因派发失败重新执行业务/LLM。
- 不得新增持久化任务表、Outbox、恢复扫描、Redis 或分布式 Worker。
- 生产 Runtime 不得 `fetch()`、`new Database()`、`withTransaction()`、写 SQL 或读取真实 Prompt/API Key。
- 不得无限重试、不得 `any`、不得 `process.exit()`。
- 不得缓存阶段结果跨重试复用；每次重试只依赖业务模块自身的低成本幂等。

### 6.3 实现要求

1. `createRuntime(dependencies)` 校验默认值：`queueCapacity=8`、`maxAttempts=2`、`dispatchAttempts=2`、`shutdownTimeoutMs=5000`；必须为正整数（超时可为非负整数），非法抛 `RangeError`，不进入业务状态。
2. 创建六条独立 `BoundedTaskQueue` 与六个 `StageWorker`；按 `task.type` 路由到唯一队列；每阶段初始 1 Worker；不共享容量。
3. `submit(task)`：运行时校验六种变体、只含允许 ID 字段、ID 非空白；非法 → `RuntimeInputError`（code `invalid_input`）；`stopAccepting()`/关闭后 → `RuntimeClosedError`（code `runtime_closed`）；接受前递增 pending，入队拒绝时回滚计数。
4. `start()` 幂等启动六个 Worker；`drain()` 等待所有已接受链路（含下游派发/重试）完成，空闲立即 resolve；T03 的 `shutdown()` 为基础版：stopAccepting → drain → close 队列 → 等 Worker done，不含超时 abort（T05 扩展）。
5. `processTask(task)` 的阶段重试循环只包裹 `StageServices` 调用：attempt 从 1 到 `maxAttempts`；取消/不可重试立即记录并结束；可重试且未耗尽则记录 retry 后重试；耗尽记录 exhausted 并结束；绝不派发失败任务的 downstream。
6. 阶段成功后才调用 `mapResultToDownstreamTasks()`；mapping 在阶段重试循环之外；mapping 纯函数抛错属 Runtime 内部错误，记录后结束，不重跑业务。
7. 派发在阶段成功、mapping 之后独立执行：`dispatchDownstreamTasks(tasks, enqueue, { dispatchAttempts, logger, signal })`；每个下游任务独立尝试，已成功入队绝不重复；失败只重试该任务，最多 `dispatchAttempts`；耗尽记录 `dispatch_failed` 并继续剩余下游；`queue_closed`/abort 记录 `dispatch_cancelled` 并停止该下游；派发失败绝不回抛触发阶段重试。
8. 多下游派发顺序稳定：成功者只在首次入队一次；失败者独立重试；其他下游不受牵连；不因一个下游失败丢弃剩余下游。
9. `runtimeTaskId()` 用于日志 `taskId`；`logRuntime()` 只白名单八字段；`stage` 允许任务 type 或 `dispatch|shutdown`；logger 同步抛错/异步拒绝均 best-effort，不改变业务结果。
10. Runtime 不持有数据库，不开启事务；每次阶段调用只传 `{ signal }`。`RUN-16` 用真实 SQLite fixture 证明：阶段等待期间 `db.inTransaction=false`，此时并发短事务可成功；Runtime 源码零 `withTransaction`/`new Database`/SQL。
11. `index.ts` 运行时只导出 `createRuntime`、`RuntimeInputError`、`RuntimeClosedError`；`dispatchDownstreamTasks`/`StageWorker`/logger helper 保持内部路径，测试可直接 import。
12. T03 不宣称 `RUN-10`/`RUN-11` 的完整关闭/超时语义；只宣称重试、派发、drain 与基础关闭。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `DEFAULTS` | 未给参数时 8/2/2/5000；六队列六 Worker |
| `INVALID_OPTIONS` | 0/负数/非整数 capacity/attempts 抛 RangeError，零业务调用 |
| `RUN-03_RETRY` | retryable 第一次失败、第二次成功 → 2 次调用并继续；两次失败 → 2 次后终止，零 downstream |
| `SQLITE_BUSY_RETRY` | `SQLITE_BUSY`/`SQLITE_LOCKED` → 2 次；`LLM JSON/llm_failed` → 2 次 |
| `RUN-04_NON_RETRY` | `invalid_input`/`target_not_found` → 1 次；`aborted`/AbortError/ABORT_ERR/LLM_CANCELLED → 1 次且零 downstream，log cancelled |
| `RUN-05/06_DISPATCH` | A 首次成功、B 首次失败第二次成功：A 入队 1 次、B 2 次、上游 execute 1 次；A 不重复 |
| `DISPATCH_EXHAUST` | B 两次失败仍继续派发 C；A/C 各 1；B 记录 dispatch_failed；不抛回阶段 |
| `DISPATCH_CANCELLED` | 队列关闭/abort 时该下游不重试，记录 dispatch_cancelled；其他已完成下游不受影响 |
| `RUN-07_COMMIT` | 阶段两次失败 → 零 downstream；第二次成功 → downstream 只派发一次 |
| `RUN-15` | 非法引用 `llm_failed` → 2 次；不存在目标 `target_not_found` → 1 次；无非法下游 |
| `RUN-12_DUAL` | PROCESS 双 route；Event 两次失败、Knowledge 成功 → Knowledge 链继续，Event 零下游 |
| `RUN-16` | 阶段等待期间 `db.inTransaction=false`；并发短事务成功；Runtime 零事务/零 SQL |
| `SUBMIT_INVALID` | 额外字段/空白 ID/未知 type → `invalid_input`，零阶段调用 |
| `STOP_ACCEPTING` | stopAccepting 后外部 submit 拒绝 `runtime_closed`；内部下游派发仍可入队 |
| `DRAIN` | 全部链路完成才 resolve；空 Runtime 立即 resolve |
| `RUN-02_RUNTIME` | 空结果 1 次调用、不重试、零 downstream、成功完成 |
| `LOGGER` | 八字段白名单；stage/reason 精确；throw/reject 不改变结果；无正文/Prompt/Token/URL |
| `SIX_QUEUES` | 六队列独立、各 1 Worker；gated 并发 stub 证明无跨阶段共享容量/串行阻塞 |

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/runtime/task-dispatch.test.ts tests/runtime/runtime-retry-dispatch.test.ts tests/runtime/runtime-transaction-boundary.test.ts tests/runtime/bounded-task-queue.test.ts tests/runtime/stage-worker.test.ts tests/runtime/task-mapping.test.ts tests/runtime/task-errors.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/error-classification.test.ts
npm run format
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|process\.exit|fetch\(|withTransaction|new Database|node-cron|user_context|raw_data|apiKey|config/prompts|redis|outbox|INSERT|UPDATE|DELETE' src/runtime/task-dispatch.ts src/runtime/runtime-logger.ts src/runtime/runtime-errors.ts src/runtime/runtime.ts src/runtime/index.ts tests/fixtures/runtime.ts tests/runtime/task-dispatch.test.ts tests/runtime/runtime-retry-dispatch.test.ts tests/runtime/runtime-transaction-boundary.test.ts || true
rg -n 'runtime|BoundedTaskQueue|StageWorker' src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/configuration src/app.ts src/server.ts src/lifecycle.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`withTransaction`/`INSERT` 命中只允许 RUN-16 测试/fixture 的真实 DB 探针；`runtime|BoundedTaskQueue|StageWorker` 反向命中必须为零。交回须附真实 SQLite 探针、事务内外时序、A/B enqueue 次数、上游 execute 次数、六队列并发证据与 logger 白名单，仅报 `REVIEW`/`BLOCKED`。

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

## 7. D15-T04 · Cron 调度 enabled Source、手工触发与表达式/时区校验

### 7.1 依赖与精确允许写集

- 前置：`D15-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 新增且仅允许写：`src/scheduler/contracts.ts`。
- 新增且仅允许写：`src/scheduler/cron-scheduler.ts`。
- 新增且仅允许写：`src/scheduler/index.ts`。
- 新增且仅允许写：`tests/fixtures/scheduler.ts`。
- 新增且仅允许写：`tests/scheduler/cron-scheduler.test.ts`。
- 新增且仅允许写：`tests/scheduler/cron-scheduler-sqlite.test.ts`。
- 只读复用：D03 `SourceRepository.listEnabled()`、`Source` 契约、`node-cron` 4.6.0、T01 `RuntimeTask`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §7、§8（提交边界）；`CFG-03`、`CFG-07`、`RUN-09`（Cron 侧）。

### 7.2 禁止范围

- 不得调用 Adapter、Collection 业务实现、HTTP、LLM、DB 写入或 Runtime 内部队列。
- 不得修改 D03/`src/configuration`、app/server/lifecycle、CI、package/lock、Prompt。
- 不得新增依赖或手写 `setInterval`/轮询式 Cron；必须使用 `node-cron`（生产默认）。
- 不得在非法表达式/时区时产生部分注册；不得静默跳过 enabled Source。
- 不得调度 disabled Source；不得提交 `COLLECT` 之外的任何任务。
- 不得 `process.exit()` 或在 Cron 回调中直接调用业务模块。

### 7.3 实现要求

1. `contracts.ts` 声明 `CronSchedulerOptions { timezone?: string; sources: Pick<SourceRepository, "listEnabled">; submit: (task: RuntimeTask) => Promise<void> }`、`CronScheduler { start(): void; stop(): void; trigger(sourceId: string): Promise<void> }`。
2. `CronSchedulerError` code 固定 `invalid_cron`、安全 message；不保留 cause。`CronBackend` 为最小 `{ validate(expr): boolean; schedule(expr, callback, { timezone, name? }): { stop(); destroy() } }`，默认实现包装真实 `node-cron`。
3. `createCronScheduler(options, dependencies?)`；默认 `timezone="Asia/Shanghai"`，默认 backend 为 node-cron；`dependencies.backend` 仅测试 seam，不新增业务抽象。
4. `start()` 幂等：读取一次 `sources.listEnabled()`；先校验时区（`Intl.DateTimeFormat` 对非法 timezone 的 RangeError → `invalid_cron`）；再对全部 enabled Source 的 `cron` 调 `backend.validate()`；任一非法立即抛 `invalid_cron`，**此阶段零 schedule 调用**；全部合法后才逐个注册。
5. 每个注册回调只执行 `submit({ type: "COLLECT", source_id: source.id })`；回调中 submit 拒绝应被捕获（避免未处理拒绝），不影响其他 Source，不调用业务/Adapter。
6. `stop()` 幂等：停止并 destroy 全部已注册任务，清空注册表；不影响已入队任务，不关闭 Runtime。
7. `trigger(sourceId)`：重新读取 `sources.listEnabled()`；仅当该 ID 当前在 enabled 列表时提交一个 `COLLECT`；不存在/禁用/空白 ID → 不提交（resolve）；不依赖 `start()` 是否调用。
8. `start()` 使用同一快照完成“校验 + 注册”；校验失败不留下任何已注册任务或残留 task；时区默认 `Asia/Shanghai`。
9. 不注册 `disabled` Source；不写第二份 `enabled` SQL；`enabled` 判断只来自 D03 `listEnabled()`。
10. `index.ts` 只导出 `createCronScheduler`、`CronSchedulerError` 与公共类型；`CronBackend` 可从 `contracts.ts` 直接 import 供测试。

### 7.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `CFG-03_ENABLED_ONLY` | fake backend：S-ON/S-ON2 注册；S-OFF 零注册；触发已注册回调只提交 enabled 的 COLLECT |
| `CFG-03_SQLITE` | 真实 SQLite + `SqliteSourceRepository`：仅有 `enabled=1` 行注册；disabled 行零注册/零提交 |
| `MANUAL_ENABLED` | `trigger(enabledId)` 提交一个 `COLLECT` |
| `MANUAL_DISABLED` | `trigger(disabledId)`/不存在/空白 → 零提交 |
| `CFG-07_EXPR_NO_PARTIAL` | [valid, invalid] 启动抛 `invalid_cron`；backend.schedule 调用 0；无部分注册 |
| `CFG-07_TZ` | 非法时区 → `invalid_cron`；schedule 0 |
| `DEFAULT_TZ` | 未提供 timezone 时注册选项为 `Asia/Shanghai` |
| `RUN-09_COLLECT_ONLY` | 所有 submit payload 的 type 均为 `COLLECT`，无其他 type |
| `STOP` | stop 停止/destroy 全部任务；幂等；不触碰已入队任务；trigger 仍可手工提交 enabled |
| `START_IDEMPOTENT` | 重复 start 不重复注册 |
| `REAL_NODE_CRON` | 默认 backend 拒绝非法表达式、接受合法 5 段表达式；不依赖真实时间推进 |
| `ERROR_SHAPE` | `CronSchedulerError` code/message 精确，无 cause |
| `NO_ADAPTER` | 源码无 Adapter/Collection/fetch/DB 写；Cron 只 submit |

### 7.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/scheduler tests/configuration/source-repository.test.ts tests/configuration/contracts.test.ts tests/database/schema-consistency.test.ts
npm run format
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|Adapter|collect\(|withTransaction|new Database|INSERT|UPDATE|DELETE|process\.exit|setInterval' src/scheduler tests/fixtures/scheduler.ts tests/scheduler/cron-scheduler.test.ts tests/scheduler/cron-scheduler-sqlite.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`INSERT` 命中只允许真实 SQLite fixture 建 Source；`collect(` 命中不得出现在生产 Scheduler；`setInterval` 必须为零。交回须附 enabled/disabled 注册数量、schedule 调用次数、submit payload 类型、时区默认值与真实 SQLite 行过滤证据，仅报 `REVIEW`/`BLOCKED`。

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

## 8. D15-T05 · 优雅关闭/超时取消、真实 SQLite 六阶段集成与 P0 Gate

### 8.1 依赖与精确允许写集

- 前置：`D15-T04` 已通过、合并并按门禁归档；base 固定为 T04 merge SHA。
- 修改且仅允许改：`src/runtime/contracts.ts`（仅关闭选项/类型澄清；不得改 Task/Result ID 字段）。
- 修改且仅允许改：`src/runtime/runtime.ts`（stopAccepting/drain/shutdown/abort 完整语义）。
- 修改且仅允许改：`src/runtime/bounded-task-queue.ts`（仅 abort 唤醒接线，不得改背压/FIFO 语义）。
- 修改且仅允许改：`src/runtime/index.ts`。
- 修改且仅允许改：`tests/fixtures/runtime.ts`。
- 修改且仅允许改：`tests/fixtures/scheduler.ts`。
- 新增且仅允许写：`tests/runtime/runtime-shutdown.test.ts`。
- 新增且仅允许写：`tests/runtime/runtime-integration.test.ts`。
- 新增且仅允许写：`tests/scheduler/cron-scheduler-integration.test.ts`。
- 只读复用：T01～T04、D01 `openDatabase`/`initializeDatabase`、D03 `SqliteSourceRepository.listEnabled()`、D05～D10 结果/错误契约、合成 Stub StageServices。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §5、§6、§8、§9；`RUN-10`、`RUN-11`、`RUN-13`（P1）、`RUN-14`（P1），以及集成复验 `RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07`。

### 8.2 禁止范围

- 不得在 app/server/lifecycle 接线；不得实现 D11 Product Generation、Published Item 模板、RSS、云端、API。
- 不得新增持久化任务表、Outbox、恢复扫描、Redis、分布式 Worker；不得新增依赖或改 DDL/CI/package/lock。
- 不得 `process.exit()`；不得在 shutdown 中强制终止进程。
- 不得读取真实 `config/prompts`/`config/prompt/user-context.md`/API Key/Token；只用合成 sentinel。
- 不得用真实模型语义冒充 D15 P0；S0/S1 属 D16。
- 不得用派发重试代替阶段重试；不得因关闭/超时重跑已 COMMIT 业务或 LLM。
- **PM2 范围说明**：V1 实施计划表 D15-T05 提及“PM2 进程守护配置”；本轮已批准 D15 Intent/Spec 冻结边界与任务指令未列 PM2。本 Plan **不实现 PM2 配置**，只保证 Runtime `shutdown()` 不调用 `process.exit()`，由调用方/部署层决定进程生命周期。若 Architect 认为需纳入，请在 G3 前明确；Lead 不擅自扩范围。

### 8.3 实现要求

1. `stopAccepting()` 设置外部提交标志；之后外部 `submit()` 拒绝 `RuntimeClosedError`（code `runtime_closed`）；内部派发继续使用队列 `enqueue`，不受影响；幂等。
2. `drain()` 等待 pending 链路（含排队、执行、背压、有限重试、下游派发）全部结束；空闲立即 resolve；不关闭队列、不停接受。
3. `shutdown({ timeoutMs })` 默认 `shutdownTimeoutMs=5000`：先 `stopAccepting()`；race `drain()` 与超时；成功则关闭六队列、等待 Worker done、幂等 resolve；超时则 `abortController.abort()`、记录 `shutdown_timeout`、关闭队列唤醒所有等待者、在有限 grace 内等待 Worker 退出并 resolve；不得 `process.exit()`。
4. 所有阶段调用与队列构造使用同一 Runtime `AbortController.signal`；abort 后：
   - 等待 enqueue 者以 `QueueClosedError` 拒绝；
   - 等待 dequeue 者以 null 唤醒；
   - 在途阶段服务收到 aborted signal 并抛取消；Runtime 分类 `cancelled`，不重试、不派发。
5. `shutdown()` 二次调用直接 resolve；`drain()` 在 shutdown 后仍可安全 resolve；关闭后的 `submit()` 必须拒绝。
6. 真实 SQLite 六阶段集成 harness：`openDatabase()` + `initializeDatabase()` + 真实 `SqliteSourceRepository` + 真实 Runtime/六队列/六 Worker + 真实 Scheduler（fake CronBackend 控制 tick）+ 六个 Stub StageServices；`publish` 只返回 `{published_item_id}`，不渲染模板。
7. 集成链：真实 Source 行（enabled/disabled）→ Scheduler 触发 enabled 的 `COLLECT` → stub Collection→Process→Event/Knowledge→Topic→Publish；断言每阶段调用次数、下游任务数量、无重复入队、disabled Source 零提交、六队列独立。
8. 覆盖空结果（RUN-02）、双路独立失败（RUN-12）、非法引用 vs 不存在目标（RUN-15）、事务外等待（RUN-16）、Cron 只 COLLECT（RUN-09）、非法表达式/时区零部分注册（CFG-07）。
9. logger 八字段白名单；不记录正文/Prompt/模型原文/Token/URL/SQL；同步/异步 logger 失败不改变结果。
10. P1 边界记录：
   - `RUN-13`：COMMIT→入队崩溃可漏派；D15 无 task table/Outbox/恢复扫描；测试断言 schema 无新增任务表、无恢复 API；不阻断 P0。
   - `RUN-14`：日志量/敏感内容检查用白名单测试覆盖，记录为 P1 非阻断；不得因 P1 未覆盖而宣称 D16/E2E 完成。
11. 所有测试使用合成 Source/Topic/Prompt sentinel；不读取真实私有 Prompt/User Context/API Key；DB 关闭后无 WAL/SHM/unhandled rejection。
12. T05 只宣称“真实 Runtime/SQLite SourceRepository + stub 业务服务”的编排集成；不冒充 D16 真实 D05～D11 端到端或真实模型语义。

### 8.4 关闭与边界测试矩阵

| Case | 必测断言 |
|---|---|
| `RUN-10_DRAIN` | 排队/执行中/背压等待/重试中任务均存在：stopAccepting 后内部继续派发；drain 等全部完成；随后关闭队列/Worker |
| `RUN-11_TIMEOUT` | 阶段永不主动完成但监听 abort：超时后 abort、取消剩余、唤醒等待、日志 shutdown_timeout/cancelled、在界内 resolve、不死锁 |
| `STOP_ACCEPTING` | 外部 submit 拒绝 runtime_closed；内部下游仍入队；二次 stopAccepting 无副作用 |
| `SHUTDOWN_IDEMPOTENT` | 二次 shutdown 直接 resolve；不重复关闭/不抛错 |
| `DRAIN_EMPTY` | 无任务时 drain 立即 resolve |
| `CLOSE_WAKES_ALL` | shutdown/abort 唤醒所有 enqueue/dequeue 等待者；无挂起 Promise |
| `ABORT_NO_RETRY` | 取消任务不二次执行、不派发 downstream；log reason cancelled |
| `NO_PROCESS_EXIT` | 测试 spy/源码扫描证明零 `process.exit()` |
| `RUN-13_BOUNDARY` | schema 无 task/outbox 表；无恢复扫描；记录接受窗口；P1 不阻断 |
| `RUN-14_LOGGER` | 八字段白名单；无正文/Prompt/Token/URL；logger 失败不影响结果；P1 记录 |

### 8.5 真实 SQLite 六阶段集成矩阵

| Case | 必测断言 |
|---|---|
| `RUN-01_CHAIN` | COLLECT→PROCESS×N→EVENT+KNOWLEDGE→TOPIC_MATCHING→PUBLISH 全链；调用次数/后继数量精确；任务只含 ID |
| `RUN-02_CHAIN` | 各阶段空结果均成功；不重试、不派发；链正常结束 |
| `RUN-05/06_CHAIN` | 双下游：A 首次成功、B 首次派发失败第二次成功；上游 execute 1 次；A 1 次、B 2 次 |
| `RUN-07_CHAIN` | 阶段两次失败零 downstream；第二次成功才 downstream |
| `RUN-09_SQLITE` | 真实 enabled Source 触发；disabled Source 零注册/零 submit；Cron 只 COLLECT；API GET/静态 RSS 模拟不进入 Runtime |
| `RUN-12_DUAL` | Event 失败不阻断 Knowledge 链；两分析 Worker 各 1、队列独立 |
| `RUN-15_CHAIN` | `llm_failed` 非法引用 2 次后终止；`target_not_found` 1 次；无非法下游/写入 |
| `RUN-16_CHAIN` | 真实 SQLite 短事务仅在业务写入；阶段等待 `inTransaction=false`；并发短事务成功；Runtime 零事务 |
| `CFG-03_SQLITE` | 真实 `listEnabled()` 只注册 enabled；到达 Cron 回调不触发 disabled |
| `CFG-07_CHAIN` | 非法表达式/时区启动即拒；零部分注册；Runtime 不收到任务 |
| `PUBLISH_STUB` | PublishResult 只有 `published_item_id`；无模板/RSS/云端/API；D11 未冒充 |
| `NO_PERSISTENCE` | 无新增任务表/Outbox/恢复扫描；schema 表集合不变 |

### 8.6 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/runtime tests/scheduler tests/configuration/source-repository.test.ts tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/error-classification.test.ts
npm run format
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|process\.exit|fetch\(|new Database|user_context|raw_data|apiKey|config/prompts|redis|outbox|INSERT|UPDATE|DELETE' src/runtime src/scheduler tests/fixtures/runtime.ts tests/fixtures/scheduler.ts tests/runtime/runtime-shutdown.test.ts tests/runtime/runtime-integration.test.ts tests/scheduler/cron-scheduler-integration.test.ts || true
rg -n 'runtime|BoundedTaskQueue|StageWorker' src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/configuration src/app.ts src/server.ts src/lifecycle.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`INSERT`/`withTransaction`/`new Database` 命中只允许真实 SQLite fixture 与其 RUN-16/source 建数；`process.exit` 必须零；业务模块反向引用必须零。交回须附：RUN-01～12/15/16 + CFG-03/07 的 Case→测试名→命令→PASS、六阶段调用/派发次数、真实 SQLite `inTransaction` 时序、abort/超时/deadlock 证据、logger 白名单、无 task 表/无 D11/无 process.exit 结论；仅报 `REVIEW`/`BLOCKED`。

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

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 HEAD/tree；tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡精确白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case、错误/隐私、禁止路径、no-op、定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch 路径/SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **同次交回硬门禁**：冻结完成后，Lead 必须在同一次回复中给出冻结 tree、patch 路径/SHA-256、路径数、blob、定向/full 验证数字与交回结论。若 Architect 只能从磁盘发现冻结产物，本卡退回流程重做，不接受事后补报。
6. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
7. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
8. **Merge**：Lead 在 D15 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
9. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
10. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

`progress.md` 每卡记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_PATH`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## 10. D15 集成 Gate 与最终验收边界

五卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/runtime tests/scheduler tests/configuration/source-repository.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/error-classification.test.ts tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database/schema.sql src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
rg -n 'runtime|BoundedTaskQueue|StageWorker' src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/configuration src/app.ts src/server.ts src/lifecycle.ts || true
rg -n 'process\.exit|redis|outbox|new Database|withTransaction' src/runtime src/scheduler || true
```

Gate 必须保留：

- `RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07` 逐项 Case→测试文件/命令→PASS。
- `RUN-13`/`RUN-14` 以 P1 边界记录：不阻断 P0，但必须写明崩溃漏派窗口、无持久化恢复、日志白名单与量级边界。
- 六类 Task 只含 ID；每阶段独立队列 + 初始 1 Worker；背压不丢任务；close/abort 唤醒全部等待者。
- 错误三分类精确：`*_failed`/`llm_failed` retryable；`invalid_input`/`target_not_found`/`unsupported_source` non_retryable；`aborted`/AbortError/ABORT_ERR/LLM_CANCELLED cancelled。
- 最多 2 次（含首次）；空结果不重试；取消不重试、不误判为空。
- 上游 COMMIT 后派发失败只重试未入队下游；已成功下游不重复；不重跑业务/LLM；真实 SQLite 事务探针 `RUN-16` P0。
- Cron 只调度 enabled Source、只提交 COLLECT；非法表达式/时区启动即拒且零部分注册；默认 `Asia/Shanghai`。
- 优雅关闭：停新增 → 内部继续派发 → drain → 关队列；超时 abort 剩余工作并记录；不 `process.exit()`。
- 真实 SQLite + 真实 Runtime/队列/Worker/Scheduler + stub StageServices 六阶段集成；`publish` 仅按 Spec §5 stub，不冒充 D11。
- 无 Published Item 模板/RSS/云端/API；无持久化任务表/Outbox/恢复扫描/Redis/分布式 Worker；无新依赖/DDL/CI/package-lock/Prompt 改动。
- 无 app/server/lifecycle 接线；业务模块反向引用 Runtime/队列为零。
- 相对批准基线仅允许 D15 `src/runtime`、`src/scheduler`、`tests/runtime`、`tests/scheduler`、`tests/fixtures/runtime.ts`、`tests/fixtures/scheduler.ts` 与 D15 文档路径；受保护路径 diff=0。

Lead 提交 `D15_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 依持续授权独立复核干净快照、push 已批准 main SHA 并等待精确 SHA CI Success；Lead 不 push、不签发最终 PASS。只有 Architect 独立 Gate 与精确 pushed SHA CI 全部通过后，才可签发 `D15_FINAL_PASS`。

本 Plan 不创建心跳。若 G3 批准并明确启动开发，由 Architect 依项目规范创建唯一 D15 推进心跳并在 `progress.md` 记录准确 ID；Lead 不自行创建。最终验收后由 Architect 核对并归档 Worker/Workspace、删除准确心跳并复查；主工作区与共享角色工作区不归档。

## 11. 风险、回滚与停止条件

- **G3 门禁**：Intent/Spec 已批准，但本 Plan 仍待 Architect G3；未批准不派发 Worker、不写生产代码、不创建 candidate/merge/push。
- **固定基线**：首个执行 base 必须是批准 Plan/Progress 后的精确文档提交；T02～T05 分别固定前卡 merge SHA。不得以浮动 `main` 或 branch 名替代。
- **`stopAccepting` 契约澄清**：Spec §6 明确关闭序列含 `stopAccepting()`，Intent §3 草案未列；Plan 按 Spec 增加该方法。G3 若认为应改回仅 `shutdown` 内部停新增，须由 Architect 在批准前明确，Worker 不得自行二选一。
- **PM2 范围**：V1 实施计划表提及 PM2 进程守护，但已批准 Intent/Spec 与任务指令未纳入；Plan 不实现 PM2，仅保证不 `process.exit()`。如纳入，需 Architect G3 明确并更新 Plan，不静默扩范围。
- **D11 缺失**：`publish` 只按 Spec §5 形状 stub；任何模板/RSS/Published Item 写入均判越界。
- **队列语义**：若关闭时丢弃已接受任务、满时直接抛错、或等待者未全部唤醒，判 BLOCKER。
- **重试边界**：若派发失败触发阶段重跑、已成功下游重复入队、或阶段失败仍派发 downstream，判 BLOCKER。
- **事务边界**：若 Runtime 开启数据库事务、在写事务中等待 HTTP/LLM、或业务模块被复制事务逻辑，判 BLOCKER；`RUN-16` 必须给真实 SQLite 探针。
- **关闭边界**：超时未 abort/未唤醒等待、死锁、`process.exit()`、或关闭后仍接受外部 submit，判 BLOCKER；P1 崩溃窗口除外但必须记录。
- **Cron 边界**：任一部分注册、disabled Source 注册/触发、非 COLLECT submit、非法表达式/时区未拒，判 BLOCKER。
- **数据/隐私**：任务含正文/对象/模型输出/AbortSignal；logger 泄漏正文/Prompt/Token/URL/SQL；读取真实私有 Prompt/API Key，均判 BLOCKER。
- **回滚**：每卡 candidate 以固定 base 单一 parent，必要时 revert merge commit；不得 reset 主线、覆盖其他里程碑或修改已批准上游来“修测试”。
- 同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分、Plan 或 Spec 根因；涉及上游变更重走受影响 Gate。

## 12. G3 门禁结论

- 本 Plan 只把已批准 D15 Intent/Spec 映射为五张严格串行、文件级可执行任务卡，没有新增业务任务类型、公共字段、DDL、Prompt、依赖、Worker 或替代任务 ID。
- T01～T05 均列出精确允许写集、固定 base 规则、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive evidence key。
- 六类 Task 只传 ID；`mapResultToDownstreamTasks()` 纯函数；空结果成功不重试；错误三分类与 2 次上限固定。
- 每阶段独立有界队列 + 1 Worker；满时背压；close/abort 唤醒所有等待者；不在队列中执行业务。
- 派发在阶段 COMMIT/成功之后独立进行；已成功下游不重复；失败下游单独重试；不重跑业务/LLM。
- Cron 只调度 enabled Source、只提交 COLLECT；`node-cron` 4.6.0；非法表达式/时区零部分注册；默认 `Asia/Shanghai`。
- 优雅关闭停新增、内部继续派发、drain、关队列；超时 abort 并记录；不 `process.exit()`；无持久化恢复。
- `RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07` 全覆盖；`RUN-13`/`RUN-14` 按 P1 记录边界、不阻断 P0。
- `RUN-16` 以真实 SQLite + 事务 spy 证明 HTTP/LLM 等待期间无写事务；D15 不新增持久化任务状态。
- 当前结论：`D15_PLAN=G3_PENDING_ARCHITECT_REVIEW`。G3 复核通过前任务状态保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push 或最终验收。
