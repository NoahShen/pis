# D06 Progress：Processing 内容标准化与路由

- Plan：`docs/milestones/D06/plan.md` v0.3
- Plan 状态：`APPROVED · Architect G3 PASS`（v0.3）
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- G3 追加审查基线：`835c9de2e98d12815d7ca3751de1835886c11cca`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 开发心跳：`145d2753`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前 Worker：`NONE · T01 Worker 已归档`
- 当前结论：`D06_PLAN_G3=APPROVED`、`D06-T01=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T02 等待派发

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D06-T01 | PASS · LOCAL_MERGE_VERIFIED · ARCHIVED | `2b1fec673cd1af27498013d6dd08776944eaaac1` | PASS（merge 后定向 1/1 files、16/16 tests；full 50/50 files、601/601 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D06-T02 | NOT_STARTED | D06-T01 merge SHA `a16ba1e095ba7f283c310d4b44530b08c42df1e6` | NOT_RUN | PENDING | PENDING · G4 | 等待 Architect 确认 T01 并派发 |
| D06-T03 | NOT_STARTED | D06-T02 merge SHA | NOT_RUN | PENDING | PENDING · G4 | 等待 T02 PASS 与归档 |
| D06-T04 | NOT_STARTED | D06-T03 merge SHA | NOT_RUN | PENDING | PENDING · G4 | 等待 T03 PASS 与归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT / WORKSPACE / BRANCH | CHANGED_PATHS | FROZEN_TREE / PATCH_SHA256 | ARCHITECT APPROVAL | CANDIDATE / MERGE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|
| D06-T01 | `2b1fec673cd1af27498013d6dd08776944eaaac1` | `870214c3-7db5-48d2-8b8a-902ce765d935` / `wks_4c994b6425ebaab9` / `feat/d06-t01-normalization` | 精确 2 路径：`src/processing/content-normalization.ts`、`tests/processing/content-normalization.test.ts` | `7136e91e0ac75becd25972b78f84daf068a00d31` / `3813fc544c46a49d7023bdfeb0a0c9e39d196fbdd3770cfc575b12e71d3e5ad3` | APPROVED · G4 | `87a2370334299e89ecf223de923ecc72f7512984` / `a16ba1e095ba7f283c310d4b44530b08c42df1e6` | PASS（merge tree `7136e91`；定向 1/1 files、16/16 tests；full 50/50 files、601/601 tests；typecheck/build/smoke/database smoke/format PASS） | `archive_workspace` success；agent closed/archived；directory removed |
| D06-T02 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |
| D06-T03 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |
| D06-T04 | PENDING | PENDING / PENDING / PENDING | PENDING | PENDING / PENDING | PENDING · G4 | PENDING / PENDING | NOT_RUN | PENDING |

T01 `MERGE_TREE=7136e91e0ac75becd25972b78f84daf068a00d31`。其余未发生门禁只能写 `PENDING`/`NOT_RUN`，不得用 `N/A` 冒充已完成证据。

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

- T01 本地复核、G4、candidate、merge、合并后 full verify 与 Worker 归档均已完成，无代码阻塞。
- T01 保留一个低风险 `FOLLOW_UP`：`FULL_BODY + body=null + summary` 矛盾输入没有独立命名测试；同一分支已由 summary-only 测试覆盖，Architect 已裁定不阻塞、不追加任务。
- T02 尚未获得派发授权；不得在 Architect 确认前创建 Worker 或开始编码。

## 下一可执行动作

1. 将本 progress 的 T01 合并与归档证据交 Architect。
2. Architect 确认后，Lead 固定 T01 merge `a16ba1e095ba7f283c310d4b44530b08c42df1e6` 并创建 T02 全新 Worker。
3. 不 push；push 与远程 CI 由 Architect 按持续授权执行。

## Plan G3 审核记录

- 提交者：D06 Lead
- 日期：2026-11-18
- 基线：`835c9de2e98d12815d7ca3751de1835886c11cca`
- 结论：`PENDING · Architect G3`
- v0.1（`dba67c9e5a20adf2c8d72445a9eacb85aaa904c6`）：`CHANGES_REQUIRED`。唯一阻塞为 Plan §2.2 错误要求对 D04 已清洗纯文本 body/summary 再次调用 `cleanHtmlValue()`，会删除合法尖括号文字并违反 `PRO-11`。
- v0.2 修订：title/body/summary 只允许 `normalizeCleanText()` / `cleanTextValue()` 纯文本规范化；禁止 `cleanHtmlValue()`、`cleanReadabilityContent()`、`parseHtmlDocument()` 或任何 DOM 解析。T01 增加 `<algorithm>`、`List<T>`、`<Foo/>` 逐字保留、误用 HTML 清洗的负向对照和静态禁用检查。
- v0.2 历史审批：曾在 `835c9de` 记录 `APPROVED · Architect G3 PASS`，批准输入为 `017a6f7` / tree `0b63e06`；该状态已被追加 G3 要求重新打开。
- v0.3 追加修订：T03/T04 增加 COMMIT 先于 LLM 的时序矩阵；T04 强制在真实 SQLite 的 StubLLM.complete 回调内断言 `db.inTransaction === false`、Content/关联已可见且 count=1，并补充 requests 1/0、精确七字段 userContent、raw_data/Token sentinel、合成 Prompt 来源及 `llm_failed` 后复用同一 Content（requests=2、count=1）。
- v0.3 审批：`APPROVED · Architect G3 PASS`，批准输入 `5a99ea0200adf1117d0dea10015385ac4cfea46f` / tree `461a9c9e4d2c170f1af61c7b3ea098d960246ef1`。
- 执行批准：main `2b1fec673cd1af27498013d6dd08776944eaaac1`；开发心跳 `145d2753`。

## D06-T01 Lead 复核、冻结、合并与归档记录

- Worker 交回：`REVIEW`；固定 base/HEAD 初始 `2b1fec673cd1af27498013d6dd08776944eaaac1`，真实 index 为空，仅两路径 untracked，无 commit/merge/push。
- 精确写集：`src/processing/content-normalization.ts` 与 `tests/processing/content-normalization.test.ts`；无第三路径。
- 行为复核：生产文件仅 import `cleanTextValue`、`parseRawDataSourceItemV1` 及其类型；NONE→`content_unavailable`，空标题→`title_missing`，FULL_BODY+正文→FULL，SUMMARY/FRAGMENT→PARTIAL，无正文有摘要→PARTIAL 且 body 使用实际摘要，两者都空→`content_unavailable`；元数据只来自 raw_data entry。
- PRO-11：`<algorithm>`、`List<T>`、`<Foo/>` 与 Unicode/emoji 逐字保留；负向测试真实调用 `cleanHtmlValue()` 并证明三个 sentinel 丢失，断言未弱化；生产文件禁止 import 扫描无匹配。
- Lead 定向验证：首次 Vitest 仅因沙箱写 `.vite-temp` EPERM；受控权限重跑 PASS `1/1` file、`16/16` tests。Lead full verify PASS `50/50` files、`601/601` tests，typecheck/build/smoke/database smoke/format 全部 PASS。
- 精确冻结：tree `7136e91e0ac75becd25972b78f84daf068a00d31`；canonical patch SHA-256 `3813fc544c46a49d7023bdfeb0a0c9e39d196fbdd3770cfc575b12e71d3e5ad3`；冻结目录 `/private/tmp/d06-t01-freeze.VhOYds`。
- 路径 blob：`content-normalization.ts=46144b743337c0d0cf8a7d83781fd738452e0377`；`content-normalization.test.ts=e16622f1d820b09991b753ea7084c7f3824a97d9`；路径数 2；`git diff-tree --check` 无输出。
- Architect G4：`APPROVED`；独立验证冻结 tree 对象、2 路径、patch SHA、target tests、typecheck、D04/D05 合并回归与边界探针均通过。
- Candidate：`87a2370334299e89ecf223de923ecc72f7512984`，唯一 parent `2b1fec6`，tree `7136e91`，精确两路径；Worker branch tip 对齐且 clean。
- Merge：`a16ba1e095ba7f283c310d4b44530b08c42df1e6`；第一 parent `2b1fec6`、第二 parent candidate `87a2370`，merge tree `7136e91`，两个 blob 与 candidate 一致。
- Merge 后复验：定向 `1/1` files、`16/16` tests；full `50/50` files、`601/601` tests；typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/139 文件 format 全部 PASS；工作区 clean。
- Worker 归档：`archive_workspace(wks_4c994b6425ebaab9)` 返回 `archivedAgentIds=[870214c3-7db5-48d2-8b8a-902ce765d935]`、`removedDirectory=true`；Agent `closed`、`archivedAt=2026-11-18T05:49:55.794Z`，活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。
