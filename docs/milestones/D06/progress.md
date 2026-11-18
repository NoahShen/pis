# D06 Progress：Processing 内容标准化与路由

- Plan：`docs/milestones/D06/plan.md` v0.3
- Plan 状态：`REVIEW · PENDING ARCHITECT G3`（v0.3 追加复核）
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- G3 追加审查基线：`835c9de2e98d12815d7ca3751de1835886c11cca`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 开发心跳：`NOT_CREATED · 等待追加 G3 批准`
- 当前 Worker：`NONE · Lead 未创建 Worker`
- 当前结论：`D06_PLAN_G3=PENDING`；无任务 READY/PASS，未开始开发

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D06-T01 | NOT_STARTED | 追加 G3 批准后的精确基线 | NOT_RUN | PENDING | PENDING · G4 | 等待追加 G3 与执行授权 |
| D06-T02 | NOT_STARTED | D06-T01 merge SHA | NOT_RUN | PENDING | PENDING · G4 | 等待 T01 PASS 与归档 |
| D06-T03 | NOT_STARTED | D06-T02 merge SHA | NOT_RUN | PENDING | PENDING · G4 | 等待 T02 PASS 与归档 |
| D06-T04 | NOT_STARTED | D06-T03 merge SHA | NOT_RUN | PENDING | PENDING · G4 | 等待 T03 PASS 与归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT / WORKSPACE / BRANCH | CHANGED_PATHS | FROZEN_TREE / PATCH_SHA256 | ARCHITECT APPROVAL | CANDIDATE / MERGE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|
| D06-T01 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |
| D06-T02 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |
| D06-T03 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |
| D06-T04 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |

另需在逐卡记录中补齐 `MERGE_TREE`。未发生门禁只能写 `PENDING`/`NOT_RUN`，不得用 `N/A` 冒充已完成证据。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `PRO-01` | T01 FULL；T02 同事务关联；T04 真实 SQLite |
| `PRO-02` | T01 PARTIAL；T02 持久化；T04 路由快照 |
| `PRO-03` | T01 无内容；T04 零 Content/LLM/HTTP |
| `PRO-04` | T02 recheck/复用；T04 重复 process |
| `PRO-05` | T02 独立 Content；T04 同文双 Source Item |
| `PRO-06` | T02 回写前异常回滚；T04 DB 回归 |
| `PRO-07` | T03 路由错误边界；T04 Content 保留与复用 |
| `PRO-08` | T03 四类 routes；T04 空路由保留；派发归 D15 |
| `PRO-09` | T04 `fetchContent` 与 `globalThis.fetch` spy 均 0 |
| `PRO-10` | T03 合法去重；T04 经 D02 拒绝未知值 |
| `PRO-11` | T01 清洗/Unicode；T02 SQLite 存储 |
| `PRO-12` | T01 PARTIAL；T03/T04 路由快照 |

## 当前阻塞与待决策事项

- 唯一当前门禁：Architect 审核 Plan v0.3 的 COMMIT/LLM 直接时序证明及 T04 调用次数、入参、sentinel、失败重试证据，并签发 G3 `APPROVED`/`CHANGES_REQUIRED`。
- G3 通过前不得创建开发心跳、不得创建 Worker、不得开始编码或创建 candidate。
- 若 Architect 要求修改 Plan，Lead 只修订 `plan.md`/`progress.md` 并重新提交精确 commit/tree，不自行批准。

## 下一可执行动作

1. 将仅含 `docs/milestones/D06/plan.md` 与本 `progress.md` 的 docs-only commit/tree 交 Architect G3。
2. Architect G3 批准后，记录批准 commit/tree；由 Architect 创建唯一 D06 推进心跳。
3. G3 与心跳完成后，Lead 再按 Plan 通过 Paseo 创建 T01 全新 Worker；本进度当前不授权该动作。

## Plan G3 审核记录

- 提交者：D06 Lead
- 日期：2026-11-18
- 基线：`835c9de2e98d12815d7ca3751de1835886c11cca`
- 结论：`PENDING · Architect G3`
- v0.1（`dba67c9e5a20adf2c8d72445a9eacb85aaa904c6`）：`CHANGES_REQUIRED`。唯一阻塞为 Plan §2.2 错误要求对 D04 已清洗纯文本 body/summary 再次调用 `cleanHtmlValue()`，会删除合法尖括号文字并违反 `PRO-11`。
- v0.2 修订：title/body/summary 只允许 `normalizeCleanText()` / `cleanTextValue()` 纯文本规范化；禁止 `cleanHtmlValue()`、`cleanReadabilityContent()`、`parseHtmlDocument()` 或任何 DOM 解析。T01 增加 `<algorithm>`、`List<T>`、`<Foo/>` 逐字保留、误用 HTML 清洗的负向对照和静态禁用检查。
- v0.2 历史审批：曾在 `835c9de` 记录 `APPROVED · Architect G3 PASS`，批准输入为 `017a6f7` / tree `0b63e06`；该状态已被追加 G3 要求重新打开。
- v0.3 追加修订：T03/T04 增加 COMMIT 先于 LLM 的时序矩阵；T04 强制在真实 SQLite 的 StubLLM.complete 回调内断言 `db.inTransaction === false`、Content/关联已可见且 count=1，并补充 requests 1/0、精确七字段 userContent、raw_data/Token sentinel、合成 Prompt 来源及 `llm_failed` 后复用同一 Content（requests=2、count=1）。
- 当前阻塞项：等待 Architect 追加复核 v0.3；通过前无开发授权。
