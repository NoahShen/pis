# D15 Progress：六阶段 Runtime 与调度

- Plan：`docs/milestones/D15/plan.md` v0.1
- Plan 状态：`G3_PENDING · ARCHITECT_REVIEW`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划基线：main `e25bc2ebc55825e54420b20c3a3cadac42301b62` / tree `83db6072eb5ec565d810827edfec438feb7f0039`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · G3 前未创建 Worker`
- 开发心跳：`NONE · G3 前未创建心跳`
- 当前结论：`D15_PLAN=G3_PENDING_ARCHITECT_REVIEW`；五卡均 `NOT_STARTED`；无生产代码改动

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D15-T01 六类 Task/Result、纯映射、错误分类 | `NOT_STARTED` | `PENDING_G3_EXECUTION_BASELINE` | NOT_RUN | - | - | 待 G3 批准 Plan |
| D15-T02 有界队列/背压/关闭唤醒/单 Worker | `NOT_STARTED` | `PENDING_T01_MERGE_SHA` | NOT_RUN | - | - | 待 T01 PASS |
| D15-T03 有限重试/只重试下游/事务外边界 | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | NOT_RUN | - | - | 待 T02 PASS |
| D15-T04 Cron enabled Source/手工触发/表达式时区 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | NOT_RUN | - | - | 待 T03 PASS |
| D15-T05 优雅关闭/超时取消/六阶段集成/P0 | `NOT_STARTED` | `PENDING_T04_MERGE_SHA` | NOT_RUN | - | - | 待 T04 PASS；待 G3 后按序启动 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D15-T01 | `PENDING_G3_EXECUTION_BASELINE` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §4.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D15-T02 | `PENDING_T01_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §5.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D15-T03 | `PENDING_T02_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §6.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D15-T04 | `PENDING_T03_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §7.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D15-T05 | `PENDING_T04_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §8.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。Lead 冻结完成后必须在同一次回复中给出 tree、patch SHA-256、路径数、blob 与验证数字，不接受事后补报。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `RUN-01` | T01 六类映射；T05 六阶段链与 ID-only 证据 |
| `RUN-02` | T01 空结果→[]；T03 空结果 1 次调用不重试；T05 全链空结果 |
| `RUN-03` | T03 暂时 HTTP/LLM/SQLite busy 最多 2 次；第二次成功/失败两分支 |
| `RUN-04` | T03 invalid_input/target_not_found/cancelled 不重试；取消不误判为空 |
| `RUN-05` | T03 派发 helper：COMMIT 后只重试未入队下游；T05 链级复验 |
| `RUN-06` | T03 A 成功一次、B 单独重试；T05 双下游链 |
| `RUN-07` | T03 阶段失败零 downstream；第二次成功才派发 |
| `RUN-08` | T02 容量满背压；Worker 消费后恢复；不丢任务 |
| `RUN-09` | T04 Cron 只 COLLECT；T05 API/静态 RSS 不进入 Runtime |
| `RUN-10` | T05 停新增、内部继续派发、drain、关队列 |
| `RUN-11` | T05 超时 abort、解除等待、记录、不死锁、不 process.exit |
| `RUN-12` | T01 双 route 映射；T03/T05 Event 失败不阻断 Knowledge |
| `RUN-13` | T05 P1：记录 COMMIT→入队窗口；无持久化恢复；不阻断 P0 |
| `RUN-14` | T03/T05 P1：八字段日志白名单、无敏感内容；不阻断 P0 |
| `RUN-15` | T01 分类；T03 非法引用 2 次、不存在目标 1 次；T05 链级 |
| `RUN-16` | T03/T05 真实 SQLite：HTTP/LLM 等待 `inTransaction=false`；并发短事务成功 |
| `CFG-03` | T04 enabled-only 注册/触发；T05 真实 SQLite Source 行 |
| `CFG-07` | T04 非法表达式/时区启动即拒、零部分注册；T05 链级 |

`RUN-13`/`RUN-14` 为 P1 边界记录，不作为 D15 P0 阻断；`RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07` 为 P0 Gate 硬条件。真实模型语义 S0/S1 属 D16，不在 D15 冒充通过。

## 当前阻塞与待决策事项

- 当前唯一门禁：Architect G3 审核本 Plan/Progress。G3 前五卡保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push。
- 首个执行 base 为批准本 Plan/Progress 后的精确文档提交；T02～T05 分别固定前卡 merge SHA，不用浮动 `main`。
- D11 Product Generation 尚未交付：`publish` 只按 Spec §5 `StageServices.publish` 形状 stub 注入；不实现模板/RSS/云端/API/Published Item。
- Spec §6 关闭序列含 `stopAccepting()`，Intent §3 草案接口未列；Plan 以 Spec §6 为准增加该方法，G3 时请 Architect 确认。
- V1 实施计划表 D15-T05 提及 PM2 进程守护；本轮已批准 Intent/Spec 与任务指令未列 PM2。Plan 不实现 PM2，仅保证 `shutdown()` 不 `process.exit()`；如纳入需 G3 明确。
- `RUN-13`/`RUN-14` 为 P1：记录崩溃漏派窗口、无持久化恢复、日志量/敏感内容边界；不阻断 P0，但不得宣称 D16/E2E 完成。
- 本轮不读取私有 `config/prompts`/`config/prompt/user-context.md`；实现测试只使用临时合成 Prompt/sentinel。

## 下一可执行动作

1. Architect 核对本 Plan/Progress 的 commit、tree、精确 2 个文档路径，并给 G3 `APPROVED`/`CHANGES_REQUIRED`。
2. G3 批准后，由 Architect 依项目规范创建唯一 D15 推进心跳并在本文件记录准确 ID；Lead 不自行创建。
3. 以批准文档提交为 T01 固定 base，创建全新 Paseo Worker 与独立 worktree，只按 Plan §4.1 写集实现；Worker 只交 `REVIEW`/`BLOCKED`。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D15/plan.md`、`docs/milestones/D15/progress.md`。
- 五卡严格串行；每卡列精确写集、固定 base、Spec/Case 映射、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- 覆盖 `RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07`；`RUN-13`/`RUN-14` 记录 P1 边界。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。

## G3 批准与执行基线

- 待 Architect 审核。
- 批准前：`D15_PLAN=G3_PENDING_ARCHITECT_REVIEW`，五卡 `NOT_STARTED`。
- 批准后：以包含本记录/批准结论的精确文档提交为执行基线；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。

## Architect G3 审核（2026-11-19）

Plan `5cc3fc86cdb8558746ef38aaf07f7f12e3911619`（tree `470a1a55f92ea2771f2dd2b7dedf8296e23e0ae0`，parent 固定基线 `e25bc2e`，精确 2 个新增文档路径）已逐卡核对：**`D15_PLAN=G3_APPROVED`**。

核对要点：六类任务只传 ID、`mapResultToDownstreamTasks()` 纯函数且 PUBLISH 不信任服务返回替换目标、错误三分类含 `unsupported_source`→non_retryable 与 `classifySqliteError()=busy_locked`→retryable、六条独立有界队列 + 各 1 Worker、派发重试与阶段重试严格分离、`RUN-16` 真实 SQLite 事务外探针、Cron 先全量校验后注册（零部分注册）、关闭超时 abort 且零 `process.exit()`、`RUN-13/14` 按 P1 记录不阻断。受保护路径零改动。

### Lead 三点裁决

1. **`stopAccepting()`：采纳。** Spec §6 关闭序列为准，Intent §3 只是草案接口；属契约澄清，非范围扩张。
2. **PM2：不纳入 D15。** 已批准 Intent/Spec 均未纳入，PM2 属部署配置而非本里程碑代码。D15 只保证 `shutdown()` 不调用 `process.exit()`，把进程生命周期交给宿主。PM2 部署与 `ecosystem.config.js` 归 D16 部署交付总结；如后续要求纳入，须另走门禁，不在 D15 静默扩范围。
3. **D11 Publish：采纳 stub 注入。** 只按 Spec §5 `StageServices.publish` 形状返回 `{ published_item_id }`；模板渲染、RSS、云端、API 均属越界。`PUBLISH_STUB` 测试须显式断言不产生 Published Item 表写入。

### 补充边界

- `RUN-16` 必须证明 Runtime 源码零 `withTransaction`/`new Database`/SQL，且阶段等待期间 `db.inTransaction=false` 时并发短事务可成功；不接受仅靠源码 grep 的替代证据。
- 关闭 `grace` 期必须有显式上限并进入日志；不得出现无界等待。
- `dispatch_cancelled` 与 `dispatch_failed` 必须区分，前者不重试。

执行基线固定为本文档提交 SHA。T01 base 为该 SHA；T02～T05 依次固定前卡 merge SHA。每卡冻结证据与交回必须在同一次回复。

## 执行授权（用户，2026-11-19）

用户指令：“下一步开发 Runtime……老样子，写文档后，直接开发，Runtime 验收成功后再找我确认。”据此记录 G1/G2/G3 已由负责人批准并进入正式开发；Runtime 最终验收后再向负责人汇报确认。

- 唯一推进心跳：`c046058f`（`*/10 * * * *` Asia/Shanghai，目标 Team_Main / Architect 8d95474b）。

