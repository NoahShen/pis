# D05 Progress：Collection 采集、去重与检查点

- Plan：`docs/milestones/D05/plan.md` v0.2
- Plan 状态：`APPROVED · Architect G3 PASS`（v0.2）
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- Plan/执行基线：`366d3d19c6dfe5cc4ef18057c4c17c6986a88bf2`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 开发心跳：`NOT_CREATED`；G3 批准并开始开发后由 Architect 创建，本 Lead 未创建
- Worker：`NONE`；G3 批准前不得创建
- 当前结论：`D05_PLAN_G3=APPROVED`、`D05_DEVELOPMENT=STARTING`；T01 READY，其余等待前卡。

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D05-T01 | READY | G3 批准后的 Plan merge SHA | NOT_RUN | PENDING | PENDING | 等待 Plan G3 |
| D05-T02 | NOT_STARTED | D05-T01 merge SHA | NOT_RUN | PENDING | PENDING | 等待 T01 PASS |
| D05-T03 | NOT_STARTED | D05-T02 merge SHA | NOT_RUN | PENDING | PENDING | 等待 T02 PASS |
| D05-T04 | NOT_STARTED | D05-T03 merge SHA | NOT_RUN | PENDING | PENDING | 等待 T03 PASS |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT / WORKSPACE / BRANCH | CHANGED_PATHS | FROZEN_TREE / PATCH_SHA256 | ARCHITECT APPROVAL | CANDIDATE / MERGE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|
| D05-T01 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D05-T02 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D05-T03 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D05-T04 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |

记录要求：

- 每卡记录精确 base、Worker Agent/Workspace/branch、允许路径、冻结 tree、canonical patch SHA-256、逐卡 Architect 审批、candidate/merge SHA、合并后 full verify 与 `archive_workspace` 返回。
- Worker 不自报 PASS，不 stage/commit/merge/push；candidate 只能在 Architect 批准冻结 tree 后由 Lead 创建。
- 任一源文件变化使既有冻结 tree/patch 和测试证据失效；必须重新冻结、复核并记录。

## D05 集成与远程门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| `COL-01`～`18` D05 映射 | NOT_RUN | 四卡测试与最终矩阵待执行 |
| fresh 条目 + checkpoint 原子事务 | NOT_RUN | T03/T04 待执行 |
| raw_data v1 strict schema / JSON round-trip | NOT_RUN | T02 基础实现，T04 复用并集成 |
| 真实 SQLite + D04 RSS Adapter 本地集成 | NOT_RUN | T04 待执行 |
| 配置 API checkpoint 不可写 / DDL / Prompt / CI 不变 | NOT_RUN | T04 与 D05 Gate 待执行 |
| D05 本地集成 Gate | NOT_RUN | 四卡 PASS 后执行 |
| 远程 CI | NOT_RUN | 本地 Gate 后由 Architect 按持续授权推送并核验精确 SHA |
| D05 最终 PASS | NOT_ISSUED | 本地 Gate、远程 CI、Architect 验收均未完成 |
| D05 心跳删除 / Lead+Worker 归档 | NOT_STARTED | 最终验收后由 Architect 组织 |

## 当前阻塞与待决策事项

- 无设计阻塞。
- 唯一当前门禁：Architect 审核 v0.2 `plan.md`；v0.1 三项 G3 定位阻塞已在文档中修正，待 Architect 复核。
- G3 前禁止：创建 Worker、修改生产代码、创建 heartbeat、candidate、merge、push 或标记任务 READY。

## 下一可执行动作

1. Architect 审核本 Plan 的文件边界、四卡依赖、测试矩阵、冻结/candidate/merge/归档证据字段。
2. G3 `APPROVED` 后将 T01 标 `READY`，由 Lead 使用全新 Paseo Worker 从精确 Plan merge SHA 启动。
3. 若 G3 退回，Lead 只修订本 Plan/Progress，并按定位项重新提交审核。

## Plan G3 审核记录

- 提交者：D05 Lead
- 日期：2026-11-17
- v0.1：`CHANGES_REQUIRED`。阻塞为：raw_data 构造归属前移与路径自洽；single-flight 逐调用取消及 token 清理语义；`config/prompt` tracked-diff 检查与事务 helper 表述。
- v0.2：`APPROVED`。Architect 确认 T02 raw_data 前移、逐调用取消/token 清理、正确路径与同步事务表述均闭合；批准 commit `21d97b1e123fe405690474a28f0a3b7083c08008`，tree `4d0fcc593da7b69bcc6653f880825f70b1611869`。
