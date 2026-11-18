# D07 Progress：Knowledge Analysis 知识价值判断与保存

- Plan：`docs/milestones/D07/plan.md` v0.2
- Plan 状态：`APPROVED · Architect G3 PASS`（v0.2）
- 开发心跳：`22b52665`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- 执行基线：main `1836a89028f8ce8290737ffee706790254c25dcb` / tree `e7d8e7b22e4d506336a0568eaabd4bf81acc03e9`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`a88d7a0e-49f2-480b-a16c-04975abd2128` / `wks_f5b697be70db6123` / `feat/d07-t01-content-input`
- 当前结论：`D07_PLAN=APPROVED_G3`、`G1=PASS`、`G2=PASS`、`D07_T01=IN_PROGRESS`、`D07_LOCAL_GATE=NOT_RUN`、`D07_REMOTE_CI=NOT_RUN`、`D07_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D07-T01 Content 输入 | `IN_PROGRESS` | `1836a89028f8ce8290737ffee706790254c25dcb` | `NOT_RUN` | `IN_PROGRESS` | `PENDING` | Worker 已派发；等待 REVIEW/BLOCKED |
| D07-T02 严格边界/错误 | `NOT_STARTED` | `PENDING_T01_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T01 |
| D07-T03 Repository/事务 | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T02 |
| D07-T04 公共 factory/集成 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T03 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D07-T01 | `1836a89028f8ce8290737ffee706790254c25dcb` | `a88d7a0e-49f2-480b-a16c-04975abd2128` | `wks_f5b697be70db6123` | `feat/d07-t01-content-input` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D07-T02 | `PENDING_T01_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D07-T03 | `PENDING_T02_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D07-T04 | `PENDING_T03_MERGE_SHA` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。candidate/merge 只记录精确 SHA，不以 branch 名或目录代替。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `KNO-01` | T02 valuable=true；T03 单行插入；T04 端到端与字段来源 |
| `KNO-02` | T02 valuable=false；T04 零写入与 Content 保留 |
| `KNO-03` | T03 3 findings 单行 JSON；T04 无独立 Finding 实体 |
| `KNO-04` | T03 recheck/唯一；T04 重复执行零 LLM |
| `KNO-05` | T03 不同 Content 独立；T04 相同正文两 Knowledge |
| `KNO-06` | T01 六字段投影；T04 当前 Content + 两份 Prompt spy |
| `KNO-08` | T02 D02 strict 拒绝；T04 零部分写入 |
| `KNO-11` | T02 null/[] 合法；T03 SQL NULL/[]；T04 真实 DB |
| `KNO-12` | T02 valuable=false 额外字段拒绝；T04 零写入 |

`KNO-07/09/10` 属 S0/S1 真实模型语义回归，不在 D07 P0 Gate 内。本里程碑不得用 Stub 测试冒充这些 Case PASS。

## 当前阻塞与待决策事项

- T01 Worker 正在 `feat/d07-t01-content-input` 执行，只允许新增 `src/knowledge/content-input.ts` 与 `tests/knowledge/content-input.test.ts`。
- 当前无候选、无 merge、无归档、无 push、无 CI、无最终验收。

## 下一可执行动作

1. 等待 T01 Worker 返回 `REVIEW` 或 `BLOCKED`。
2. Lead 独立复核 diff、测试、隐私与禁止路径，生成精确冻结 tree/patch。
3. 将 T01 冻结证据交 Architect G4；批准后才创建 candidate/merge，并决定 T02。

## Plan G3 审核记录

- 提交者：D07 Lead
- 日期：2026-11-18
- 参考基线：`9f70eac273fabc498cf7c8dce9607ad74f3340bf`
- 结论：`APPROVED · Architect G3 PASS`
- v0.1 `3b64bb7`：`CHANGES_REQUIRED`；Architect 已修正上游 Clock 错误与文档状态，并要求 Plan 删除全部 Clock 依赖。
- v0.2 修订：`KnowledgeDependencies` 不含 Clock；同步清理任务卡、fixture、测试与风险段相关表述，并明确禁止以时间列/时间戳/日志时间字段凑依赖。
- v0.2 批准：批准 commit `5bfe30c88824caff12dda972084b164f2ba7bc93`，tree `aa40531a6a322078f8f4f53746e65a2186c4cf3e`；随后由 main `1836a89` 记录 G1/G2 批准与开发心跳。
- Plan 提交：本次最终提交 SHA 由 Lead 返回给 Architect；本文件提交前的参考基线不是 G3 批准。
- G3 已通过；已按授权创建 T01 Worker。Worker 不得自批，Lead 与 Architect 审核仍待完成。

## D07 边界确认

- D07 是 Knowledge Analysis；Event Search/Event Analysis 属 D08/D09，不在本里程碑。
- D07 只调用 P-04 `analyzeKnowledge` 一次，且事务外调用；不派发 TopicMatching。
- `valuable=false` 不写任何记录；`valuable=true` 只写一份 Knowledge。
- Finding 为 `findings_json` 内嵌数组；无独立实体、ID、表、队列或 RSS。
- `UNIQUE(content_id)` 支持同一 Content 复用；不同 Content 相同正文不合并。
- 只有 Knowledge Analysis 读取 User Context；测试不读取真实 Prompt/config/user-context。
