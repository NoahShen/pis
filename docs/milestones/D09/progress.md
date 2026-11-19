# D09 Progress：Event Analysis 新主线、进展与重复证据

- Plan：`docs/milestones/D09/plan.md` v0.1
- Plan 状态：`APPROVED · G3`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划参考基线：main `2484b2876522027b5da4c95ca1b5c03e757d8139` / tree `e995e484a53d4ccbe0f15a90e8f5fbab07679b2c`
- 执行基线：`1e7fba52e5139f6a0bc859c7ade54f0f9e4a26ff` / tree `18bd1c36453db769f69f09acc8b04dac1f050e20`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · D09-T01 Worker 已归档`
- 开发心跳：`06ccf8ea`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前结论：`D09_PLAN=APPROVED_G3`、`D09_DEVELOPMENT=AUTHORIZED_T01_ONLY`、`D09_T01=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D09_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D09-T01 D08 reason/P-03 前置 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `1e7fba52e5139f6a0bc859c7ade54f0f9e4a26ff` | PASS（merge 后定向 7 files/105 tests；full 72 files/870 tests；typecheck/build/smoke/database smoke/format 197 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D09-T02 Repository/基础持久化 | `NOT_STARTED` | `991158bbc8cccd1b7f62d71c55891548b6bc6b4a` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 Architect 核对 main 后另行授权 |
| D09-T03 Reuse/NO_INCREMENT/alias/FTS | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T02 PASS/合并/归档 |
| D09-T04 多结果单事务/回滚 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T03 PASS/合并/归档 |
| D09-T05 Factory/集成/P0 | `NOT_STARTED` | `PENDING_T04_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T04 PASS/合并/归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D09-T01 | `1e7fba52e5139f6a0bc859c7ade54f0f9e4a26ff` | `745f900c-548e-43af-9211-3c5ae9fd2573` | `wks_59b60a0c186a3da0` | `feat/d09-t01-p03-boundary` | 精确 10 路径：4 修改 + 6 新增，见 Plan §4.1 | `9044ac9a76095c3179d73dc3e0624154a2dff4ea` | `17cc714958c42797c74566bfb2e0dbe0a7bba8a36ff1fd2b1eb25452c93f4e86` | `APPROVED · G4` | `36c3474d3066a8ae2dc0cb16c16449c259d59569` | `991158bbc8cccd1b7f62d71c55891548b6bc6b4a` | `9044ac9a76095c3179d73dc3e0624154a2dff4ea` | PASS（merge 后定向 7/105；full 72/870；typecheck/build/smoke/database smoke/format 197） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D09-T02 | `991158bbc8cccd1b7f62d71c55891548b6bc6b4a` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D09-T03 | `PENDING_T02_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D09-T04 | `PENDING_T03_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D09-T05 | `PENDING_T04_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `EVT-01` | T02 NEW_EVENT；T05 真实 SQLite：一 Event 一证据、零初始 Update、目标 EVENT |
| `EVT-02` | T02 首次 NEW_UPDATE；T05：Update+证据、目标 EVENT_UPDATE |
| `EVT-03/04` | T03 指定/null Update 证据；T05 零新目标、不猜 Update |
| `EVT-05` | T01 合法空 results；T05 零写 |
| `EVT-06/07` | D08 多事项边界；T04 多结果单事务；T05 不按实体合并 |
| `EVT-08/09` | T02/T03 单条 Update、保留旧事实；T05 端到端 |
| `EVT-10/11/23` | D08 既有全历史召回/窗口；T05 P-03 输入只含最近窗口且无 clues |
| `EVT-12/13/14/24` | T03 alias/证据/FTS 与 Event 隔离；T05 search_terms 不落库 |
| `EVT-15` | T01 D02 strict/reference/conflict；T03 事务内重读；T05 零部分写 |
| `EVT-16` | T04 中途 DB/FTS/readback 全回滚；T05 端到端 |
| `EVT-17/18` | T03 replay/FTS；T04 影响集合；T05 真实 SQLite 与 rebuild 一致 |
| `EVT-21/22` | T01/T05 reason 分支；empty clues P-03 0、no candidates P-03 1 |
| `PMT-14/15` | T01/T05 strict 自造 ID、缺字段、额外字段、错误类型、引用/冲突 |
| `PMT-09` | T01/T05 P-03 无 User Context |
| `E2E-14_ANALYSIS` | T05 只验证分析部分：同 Entity+Subject+Scope 可归同一 Event，不按机构强拆 |
| `ATOMIC / PRIVACY` | T04/T05 单同步事务、FTS 同事务、thenable 拒绝、隐私边界 |

`EVT-19/20`、`PMT-03/04` 属 S0 真实模型语义回归，不在 D09 P0 Gate 内；本里程碑不得用 Stub 冒充这些 Case PASS。

## 当前阻塞与待决策事项

- D09 G1/G2/G3 已批准；技术实现设计 §17.5 已统一为 P-02 clues 仅用于候选检索，不注入 P-03。
- D08 `EventSearchResult.reason` 可选只读扩展已获 G4；T01 已完成精确冻结、candidate、`--no-ff` merge、合并后复验与归档。
- T01 无阻塞。T02 尚未授权；等待 Architect 核对 main `991158bb…` 后另行启动。
- 未发现 D09 Spec 与当前 D02 strict Schema 或 D01 DDL/FTS 事务能力的冲突。

## 下一可执行动作

1. Architect 核对 main `991158bbc8cccd1b7f62d71c55891548b6bc6b4a` 与进度记录。
2. 收到 T02 明确授权后，再以全新 Paseo Worker、独立 worktree 和固定 base `991158bb…` 启动 T02。
3. T02 及其他后续卡不得与当前 T01 并行，也不得在授权前创建。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D09/plan.md`、`docs/milestones/D09/progress.md`。
- 参考树：`2484b2876522027b5da4c95ca1b5c03e757d8139` / tree `e995e484a53d4ccbe0f15a90e8f5fbab07679b2c`。
- 五卡严格串行；每卡已列精确写集、固定 base 规则、Spec/Case、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- `D08 reason` 审核：最小、兼容、必要；无更小替代方案，不自行改 Spec。
- `PMT-14/15`、`PMT-09`、`E2E-14` 分析部分列入 P0；`EVT-19/20`、`PMT-03/04` 明确为 S0 非 P0。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。

## Architect 设计复核修订

- 统一技术设计 §17.5：P-02 clues 仅用于候选检索，不注入 P-03；P-03 输入为当前 Content + 候选 DTO，与 D09 Spec 一致。
- D08 可选 `reason` 扩展经 Lead 审核为最小兼容方案；D09 对缺失/矛盾 reason 保守失败，不重复 P-02。
- 上述修订随后由负责人统一批准 G1/G2/G3；该时点尚未启动 Worker、心跳或编码。

## G1/G2/G3 批准与执行基线

- 负责人明确批准 Intent、Spec、五卡 Plan；批准时间：2026-11-19。
- G1/G2/G3 状态已写入文档；仅允许按已批准范围开发。
- 开发心跳：`06ccf8ea`，`*/10 * * * *`，Asia/Shanghai。
- D09 首个执行基线为本批准提交 SHA；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。
- 本提交后启动 T01，不并行启动其他卡。

## D09-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；HEAD 保持 `1e7fba52e5139f6a0bc859c7ade54f0f9e4a26ff`，无 commit/merge/push。
- 精确写集：10 路径（4 修改 + 6 新增），仅 Plan §4.1 白名单；受保护路径 diff 为空。
- D08：四个成功返回精确设置 `missing_content/empty_clues/no_candidates/candidates`；候选 DTO、排序、窗口、P-02/P-03 调用次数与只读行为未改。
- D09：Content 六字段与 candidate/update 显式投影；P-03 task data 顶层仅 `{content,candidates}`；references 仅 `candidateEventIds/eventIdByUpdateId`；无 clues/user_context/Topic/Knowledge/raw/URL/Token。
- 错误/取消：四码精确 message、无 cause；`AbortError`/`ABORT_ERR`/`LLM_CANCELLED` 与 pre/during/post 取消均映射 `aborted`；非取消调用失败映射 `llm_failed`；D02 返回不二次解析。
- 独立验证：typecheck PASS；定向 7/7 files、105/105 tests PASS；full `npm run verify` PASS（72/72 files、870/870 tests；build、全部 smoke、database smoke、197 files format PASS）；`git diff --check` 无输出；禁止路径与 `.only/.skip` 为空；静态扫描 9 个命中均为测试禁止字段/action 字面量或 `EVENT_UPDATE` 类型字符串。
- 精确冻结：tree `9044ac9a76095c3179d73dc3e0624154a2dff4ea`；canonical full-index binary patch `/private/tmp/d09-t01-freeze.6ERboG/d09-t01.patch`，SHA-256 `17cc714958c42797c74566bfb2e0dbe0a7bba8a36ff1fd2b1eb25452c93f4e86`，39786 bytes、10 路径；从干净 base 应用 patch 重建 tree 与冻结 tree 一致。
- Architect G4：`APPROVED`；独立复核冻结 tree、patch SHA/10 路径、tsc、11 files/142 tests 与额外隐私/abort/references 探针通过。
- Candidate：`36c3474d3066a8ae2dc0cb16c16449c259d59569`，唯一 parent `1e7fba52e5139f6a0bc859c7ade54f0f9e4a26ff`，tree `9044ac9a76095c3179d73dc3e0624154a2dff4ea`，精确 10 路径；Worker branch tip 对齐且 clean。
- Merge：`991158bbc8cccd1b7f62d71c55891548b6bc6b4a`；第一 parent `1e7fba52`、第二 parent candidate `36c3474`，merge tree `9044ac9a76095c3179d73dc3e0624154a2dff4ea`，与候选逐字一致。
- Merge 后复验：typecheck PASS；定向 7/7 files、105/105 tests PASS；full `npm run verify` PASS（72/72 files、870/870 tests；build、全部 smoke、database smoke、197 files format PASS）。
- Worker 归档：`archive_workspace(wks_59b60a0c186a3da0)` 返回 `archivedAgentIds=[745f900c-548e-43af-9211-3c5ae9fd2573]`、`removedDirectory=true`；Agent `closed/archived`，活跃 workspace 列表与 Git worktree 均无该项。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未启动 T02、未 push、未签发 D09 最终 PASS。
