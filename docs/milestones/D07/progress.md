# D07 Progress：Knowledge Analysis 知识价值判断与保存

- Plan：`docs/milestones/D07/plan.md` v0.2
- Plan 状态：`APPROVED · Architect G3 PASS`（v0.2）
- 开发心跳：`22b52665`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- 执行基线：main `1836a89028f8ce8290737ffee706790254c25dcb` / tree `e7d8e7b22e4d506336a0568eaabd4bf81acc03e9`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`2b77c1e1-3033-4b8f-931a-eba6d04001ba` / `wks_3360fd32abb031e7` / `feat/d07-t02-knowledge-call`
- 当前结论：`D07_PLAN=APPROVED_G3`、`G1=PASS`、`G2=PASS`、`D07_T01=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D07_T02=IN_PROGRESS`、`D07_LOCAL_GATE=NOT_RUN`、`D07_REMOTE_CI=NOT_RUN`、`D07_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D07-T01 Content 输入 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `1836a89028f8ce8290737ffee706790254c25dcb` | PASS（merge 后定向 3 files/24 tests；full 57 files/669 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D07-T02 严格边界/错误 | `IN_PROGRESS` | `eb9ef1d38ffa2f62455de0498c92dad07fb77a31` | `NOT_RUN` | `IN_PROGRESS` | `PENDING` | Worker 已派发；等待 REVIEW/BLOCKED |
| D07-T03 Repository/事务 | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T02 |
| D07-T04 公共 factory/集成 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T03 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D07-T01 | `1836a89028f8ce8290737ffee706790254c25dcb` | `a88d7a0e-49f2-480b-a16c-04975abd2128` | `wks_f5b697be70db6123` | `feat/d07-t01-content-input` | 精确 2 路径：`src/knowledge/content-input.ts`、`tests/knowledge/content-input.test.ts` | `6797a68b18ed94fd5972ca804bb70c256d700984` | `12763a85062183ef53cb548f9eb7584a79ecba313780405f09c71cd376155c76` | `APPROVED · G4` | `ff1dea429c986038bf9bfd0c95826aa1fe438879` | `00ba917563b902a8731d432366c169450879abf6` | `6797a68b18ed94fd5972ca804bb70c256d700984` | PASS（merge 后定向 3/24；full 57/669；typecheck/build/smoke/database smoke/format PASS） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D07-T02 | `eb9ef1d38ffa2f62455de0498c92dad07fb77a31` | `2b77c1e1-3033-4b8f-931a-eba6d04001ba` | `wks_3360fd32abb031e7` | `feat/d07-t02-knowledge-call` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
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

- T01 已完成 G4、精确 candidate、`--no-ff` merge、合并后 full verify 与 Worker/workspace 归档。
- T02 Worker 正在 `feat/d07-t02-knowledge-call` 执行，只允许新增 Plan §5 的四个文件。
- 当前无 push、无远程 CI、无最终验收。

## 下一可执行动作

1. 等待 T02 Worker 返回 `REVIEW` 或 `BLOCKED`。
2. Lead 独立复核四文件写集、CALL_COUNT、signal/abort、错误安全、logger 与禁止依赖。
3. Lead 精确冻结后立即交回 Architect G4，不得静默等待。

## D07-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；branch tip/HEAD 仍为 `1836a89028f8ce8290737ffee706790254c25dcb`，无 commit/merge/push。
- 精确写集：`src/knowledge/content-input.ts`（35 行新增）、`tests/knowledge/content-input.test.ts`（325 行新增）；无既有文件修改。
- 行为复核：`loadKnowledgeTaskData` 只接受 `Pick<ContentRepository, "getById">`，每个 Content ID 点读一次；缺失返回 `null`；显式投影六字段，无对象 spread，无 id/url/created_at/language/raw_data/Topics/history Knowledge。
- 测试复核：`KNO-06/TASK_DATA`、`CONTENT_READ`、`PROMPT_SOURCE`、`VALUE_SHAPES`、重复调用与不同 Content 均直接断言；Prompt 测试只用临时目录两份合成文件与 D02 StubLLM。
- 独立验证：`verify:toolchain` PASS；typecheck PASS；定向 `3/3` files、`24/24` tests PASS；`npm run verify` PASS（full `57/57` files、`669/669` tests；build、全部 smoke、database smoke、157 文件 format 均 PASS）；`git diff --check` 无输出。
- 环境边界：首次 `npm ci`/Vitest 在沙箱分别因 `node_modules` unlink 与 `.vite-temp` mkdir `EPERM` 失败；受控提升权限后按原命令重跑 PASS，未改测试预期或绕过规格。
- 范围/隐私：`git status --untracked-files=all` 仅两个允许路径；禁止路径 diff 为空；生产文件无真实 LLM/Prompt/DB/HTTP/Topic 依赖；测试未读取真实 Prompt/model。
- 静态扫描逐条解释：`knowledge` 为模块路径/合成 sentinel；`raw_data`、`topics`、`history_knowledge` 为故意注入以证明投影剥离；`expect.any(Object)` 为 Vitest matcher 而非 TS `any`。
- 精确冻结：tree `6797a68b18ed94fd5972ca804bb70c256d700984`；canonical full-index binary patch `/private/tmp/d07-t01-freeze.5T4DFI/t01.patch`，SHA-256 `12763a85062183ef53cb548f9eb7584a79ecba313780405f09c71cd376155c76`；路径数 2；`git diff-tree --check` 无输出。
- 路径 blob：`content-input.ts=3cd0ba5ac9db8de736023427d50e72e2f70b35bf`；`content-input.test.ts=ca818e0e7cf6d7b31bd5089a3b8c826f1b6e430e`；冻结 tree blob 与 Worker 工作文件逐一一致。
- Architect G4：`APPROVED`；独立核验冻结 tree、2 路径、patch SHA、blob、冻结树 typecheck、知识测试与泄漏探针均通过。
- Candidate：`ff1dea429c986038bf9bfd0c95826aa1fe438879`，唯一 parent `1836a89`，tree `6797a68`，精确两条新增路径；Worker branch tip 对齐且 clean。
- Merge：`00ba917563b902a8731d432366c169450879abf6`；第一 parent `1836a89`、第二 parent candidate `ff1dea4`，merge tree `6797a68`，两条 blob 与 candidate 一致。
- Merge 后复验：typecheck PASS；定向 `3/3` files、`24/24` tests PASS；`npm run verify` PASS（full `57/57` files、`669/669` tests；build、全部 smoke、database smoke、157 文件 format 均 PASS）；禁止路径 diff 为空。
- Worker 归档：`archive_workspace(wks_f5b697be70db6123)` 返回 `archivedAgentIds=[a88d7a0e-49f2-480b-a16c-04975abd2128]`、`removedDirectory=true`；Agent `closed`，`archivedAt=2026-11-18T10:43:38.377Z`，活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。

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
