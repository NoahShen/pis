# D09 Progress：Event Analysis 新主线、进展与重复证据

- Plan：`docs/milestones/D09/plan.md` v0.1
- Plan 状态：`DRAFT · G3_PENDING_ARCHITECT_REVIEW`
- Intent：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- Spec：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 计划参考基线：main `2484b2876522027b5da4c95ca1b5c03e757d8139` / tree `e995e484a53d4ccbe0f15a90e8f5fbab07679b2c`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE`
- 开发心跳：`NONE`（Lead 不创建；G3 批准且正式开发触发后由 Architect 创建）
- 当前结论：`D09_PLAN=G3_PENDING_ARCHITECT_REVIEW`、`D09_DEVELOPMENT=NOT_AUTHORIZED`、`D09_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D09-T01 D08 reason/P-03 前置 | `NOT_STARTED` | `PENDING_G3_EXECUTION_BASELINE` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 G1/G2/G3 与执行授权 |
| D09-T02 Repository/基础持久化 | `NOT_STARTED` | `PENDING_T01_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T01 PASS/合并/归档 |
| D09-T03 Reuse/NO_INCREMENT/alias/FTS | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T02 PASS/合并/归档 |
| D09-T04 多结果单事务/回滚 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T03 PASS/合并/归档 |
| D09-T05 Factory/集成/P0 | `NOT_STARTED` | `PENDING_T04_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 等待 T04 PASS/合并/归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D09-T01 | `PENDING_G3_EXECUTION_BASELINE` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D09-T02 | `PENDING_T01_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
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

- D09 Intent/Spec 在 Git 中仍为 G1 待批准，G2 未记录；G3 未审核。当前不进入开发。
- D09 Intent/Spec 头部仍写旧基线 `2ab5de8`；本轮 Architect 固定基线为 `2484b2876522027b5da4c95ca1b5c03e757d8139`，待 Architect 在 G1/G2 同步。
- 技术实现设计 §17.5 写有 P-02 clues 进入 P-03；D09 当前 Spec 与本次任务边界只允许 Content 六字段 + candidates。Lead 不自行改权威文档，待 Architect 在 G2/G3 明确处理。
- D08 `EventSearchResult.reason` 是 Spec 允许的受控可选只读扩展。Lead 审核认为它在“不重调 P-02、不暴露 clues”约束下最小且自洽；仍需 Architect 随 G2/G3 批准。
- 未发现 D09 Spec 与当前 D02 strict Schema 或 D01 DDL/FTS 事务能力的冲突。

## 下一可执行动作

1. Architect 审核本 Plan 的 G3；同时处理 G1/G2 状态、基线头部和技术设计 P-03 输入冲突。
2. G3 通过且正式开发授权后，由 Architect 创建唯一 D09 心跳并记录 ID；Lead 再按 T01→T05 串行准备全新 Paseo Worker。
3. T01 固定执行基线必须是批准文档后的精确 SHA，且为 `2484b2876522027b5da4c95ca1b5c03e757d8139` 的后代；不得使用 branch 名代替。

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
- Intent/Spec/Plan 的 G1/G2/G3 批准点待负责人统一确认；未启动 Worker、心跳或编码。

## G1/G2/G3 批准与执行基线

- 负责人明确批准 Intent、Spec、五卡 Plan；批准时间：2026-11-19。
- G1/G2/G3 状态已写入文档；仅允许按已批准范围开发。
- 开发心跳：`06ccf8ea`，`*/10 * * * *`，Asia/Shanghai。
- D09 首个执行基线为本批准提交 SHA；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。
- 本提交后启动 T01，不并行启动其他卡。
