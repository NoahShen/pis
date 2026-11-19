# D10 Progress：Topic Matching / 关注范围关联

- Plan：`docs/milestones/D10/plan.md` v0.1
- Plan 状态：`G3_PENDING_ARCHITECT_REVIEW`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划与首个执行基线：main `c0328e035cc24127d7c3b6ee92e02d68092e8648` / tree `f2fa99b64c38854e60af4c6792fe06e4f58f5c09`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE`
- 开发心跳：`NONE · 等待 Architect 在 G3 批准并明确启动开发后创建`
- 当前结论：`D10_PLAN=G3_PENDING_ARCHITECT_REVIEW`；四卡均 `NOT_STARTED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D10-T01 Targets DTO/只读 Repository | `NOT_STARTED` | `PENDING_G3_EXECUTION_BASELINE` | NOT_RUN | PENDING | PENDING | 等待 G3 批准 |
| D10-T02 启用快照/P-05 单次调用 | `NOT_STARTED` | `PENDING_T01_MERGE_SHA` | NOT_RUN | PENDING | PENDING | 等待 T01 PASS |
| D10-T03 Association/同步短事务 | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | NOT_RUN | PENDING | PENDING | 等待 T02 PASS |
| D10-T04 Factory/复用跳过/P0 集成 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | NOT_RUN | PENDING | PENDING | 等待 T03 PASS |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D10-T01 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D10-T02 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D10-T03 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D10-T04 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `TOP-01` | T01 EVENT DTO；T04 真实 SQLite 单 Topic、1 行关联、一次 true；不声称派发 PublishTask |
| `TOP-02` | T03 多 Topic 快照顺序写入/同一 matched_at；T04 只返回一次 true |
| `TOP-03` | T02 空数组成功；T04 P-05 1 次、零关联、false、目标保留 |
| `TOP-04` | T02/T04 空启用 Topic、P-05 0、零关联、false |
| `TOP-05` | T02 D02 拒绝禁用 ID；T04 llm_failed、零关联 |
| `TOP-08` | T01 Update 上下文不含历史/继承；T04 父 Event 已关联、Update 空匹配不继承 |
| `TOP-09` | T01/T04 Update 只写自身匹配 Topic |
| `TOP-10` | T02 快照；T04 读取后真实 disable，本次仍按原快照完成 |
| `TOP-11` | T04 新建/修改 Topic 无自动 Matching、旧关联/Published Item 不变 |
| `TOP-12` | T02/T04 D02 去重重复 ID；非法 ID/非数组零写 |
| `TOP-14` | T01 Knowledge DTO 精确；T04 真实 task data 使用 Title/Summary/Category/Findings/Value |
| `TOP-15` | T01 三类不存在返回 null；T04 target_not_found、零 LLM/零写 |
| `TOP-16` | T03/T04 已关联后禁用 Topic，不删历史、重复执行 true、P-05 0 |
| `TOP-06` | T04 已有关联的 D10 zero-LLM 复用、零写、true；不冒充 PublishTask |
| `TOP-07` | T04 已有 Published Item 的 zero-LLM 跳过、零写、false |
| `PMT-07` | T02/T04 D02 strict JSON/Schema/引用；非 JSON、缺字段、额外字段、错误类型零写 |
| `PMT-09` | T02/T04 P-05 user JSON 仅 task_data，无 user_context |
| `ATOMIC` | T03/T04 LLM 事务外、单同步事务、同 matched_at、失败全回滚、thenable 拒绝 |
| `PRIVACY` | T02/T04 error/logger 无 Topic 名称/描述、正文、Prompt、模型原文或 Token |

`PMT-06` 为 S0 真实模型语义，不属于 D10 P0 Gate；`TOP-13` 为 P1，不用 Stub 冒充真实模型语义质量。D10 不派发 PublishTask、不生成 Published Item、不实现 RSS/Runtime。

## 当前阻塞与待决策事项

- 当前唯一门禁为 Architect G3 Plan 审核；在明确批准前不得创建 Worker、心跳、candidate、merge、push 或生产代码。
- 基线 `c0328e035cc24127d7c3b6ee92e02d68092e8648` 仅比 D09 最终代码基线 `a6934b1` 增加 D10 Intent/Spec 文档，未含生产代码变化。
- D02 既有 P-05 strict Schema/Topic ID 引用/首次顺序去重与 D03 `listEnabled()` enabled + BINARY 顺序均已只读核对，未发现阻止实现的冲突。
- 本轮不读取私有 `config/prompts`/`config/prompt/user-context.md`；实现测试只使用临时合成 Prompt/sentinel。

## 下一可执行动作

1. Architect 审核本 Plan 与 Progress，给出 `APPROVED · G3` 或具体 `CHANGES_REQUIRED`。
2. G3 批准后由 Architect 另行通知启动；届时创建唯一 D10 心跳并记录准确 ID。
3. Lead 使用全新 Paseo Worker 从批准文档 base 串行启动 T01；T01 未 PASS/merge/archive 前不得启动 T02。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D10/plan.md`、`docs/milestones/D10/progress.md`。
- 四卡严格串行；每卡列精确写集、固定 base、Spec/Case 映射、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。
