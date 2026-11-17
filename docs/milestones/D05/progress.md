# D05 Progress：Collection 采集、去重与检查点

- Plan：`docs/milestones/D05/plan.md` v0.2
- Plan 状态：`APPROVED · Architect G3 PASS`（v0.2）
- 执行批准：`fab28a51449ec1c04afed589515065e5423bdebe`
- Intent：`APPROVED · G1 PASS`
- Spec：`APPROVED · G2 PASS`
- Plan/执行基线：`366d3d19c6dfe5cc4ef18057c4c17c6986a88bf2`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 开发心跳：`1a12839e`（已由 Architect 通过 `delete_heartbeat` 删除，`success=true`）
- 当前 Worker：`NONE`；T01/T02/T03/T04 与 D05-CI01 共五个 Worker 均已归档
- 当前结论：`D05_PLAN_G3=APPROVED`、`D05_TASKS=PASS`、`D05_LOCAL_GATE=PASS`、`D05_REMOTE_CI=PASS`（run `44133078537`，commit `85ea2ef`）、`D05_FINAL_PASS=ISSUED`。旧 run `44128064463` 的测试时序失败已由 D05-CI01 修复并复验。

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D05-T01 | PASS · LOCAL_MERGE_VERIFIED | `fab28a51449ec1c04afed589515065e5423bdebe` | PASS（merge 后定向 2/2 files、8/8 tests；full 41/41 files、530/530 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D05-T02 | PASS · LOCAL_MERGE_VERIFIED | `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e` | PASS（merge 后专项 4/4 files、30/30 tests；D04 2/2 files、172/172；full 45/45 files、560/560 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D05-T03 | PASS · LOCAL_MERGE_VERIFIED | `34339c19499e37d92a796e67c80a63159c7b3405` | PASS（merge 后专项 2/2 files、14/14 tests；full 47/47 files、574/574 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D05-T04 | PASS · LOCAL_MERGE_VERIFIED | `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1` | PASS（merge 后 Collection 3/3 files、23/23 tests；配置/RSS 3/3 files、31/31；full 49/49 files、585/585 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D05-CI01 | PASS · LOCAL_MERGE_VERIFIED | `fc7e35312a64a4993c1162c08e25b8020c812a11` | PASS（目标单测 10/10；merge 后 full 49/49 files、585/585 tests） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档；新 main CI 待重跑 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT / WORKSPACE / BRANCH | CHANGED_PATHS | FROZEN_TREE / PATCH_SHA256 | ARCHITECT APPROVAL | CANDIDATE / MERGE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|
| D05-T01 | `fab28a51449ec1c04afed589515065e5423bdebe` | `7e411882-85a0-44c0-baba-725d5d5ce89f` / `wks_e8ae11c2dc19977d` / `feat/d05-t01-identity-repository` | 精确 4 路径：identity/repository 两生产文件 + 两测试文件 | `6f50ecb9446af94c8070dd1f610a75c0cbd512fa` / `279b9db5ebe55f216231345609aa683d9286f2c1aef644f1cd8b0c42a4007564` | APPROVED · G4 | `41cc8597db8115b7b286ca2aea7621a67c2fecf7` / `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e` | PASS（merge 后 typecheck/target/full verify/build/smoke/format/diff-check） | `archive_workspace` success；agent closed；directory removed |
| D05-T02 | `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e` | `8f593e43-483a-4bb3-938b-12ac22ecb8a0` / `wks_68a47bc1f56d9690` / `feat/d05-t02-single-flight-acquisition` | 精确 9 路径：errors/registry/single-flight/raw-data/collector + 四专项测试 | `af0b8d015a616411f51d2e9b12bdfd52f13b34ed` / `27583c4e7d690aaceb161d683b815dc6912b7a9b8182f316fbad385c423e01b8` | APPROVED · G4 | `3ec4ee1ef6cb6850fe835435043b8eed64255b6b` / `34339c19499e37d92a796e67c80a63159c7b3405` | PASS（merge 后 typecheck/专项/D04/full verify/build/smoke/format/diff-check） | `archive_workspace` success；agent closed；directory removed |
| D05-T03 | `34339c19499e37d92a796e67c80a63159c7b3405` | `93faad84-feac-401e-94bd-9aa0d197ec18` / `wks_e14b152cb3581a7e` / `feat/d05-t03-transaction-checkpoint` | 精确 4 路径：persistence 新增、collector 接线、两事务测试 | `e5f9980d576f4f9caad68318da1e21b8d6fbf697` / `32723195e01978a700b1e46840b6c1039983bf0aa423b2e7cec8e78a719014a1` | APPROVED · G4 | `fb3631c297e792a766748c95861371cf97cb2139` / `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1` | PASS（merge 后 typecheck/专项/full verify/build/smoke/format/diff-check） | `archive_workspace` success；agent closed；directory removed |
| D05-T04 | `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1` | `58438af5-eb91-42d2-9a2f-21fdd618251e` / `wks_cd84ce831f63f6e0` / `feat/d05-t04-public-contract-integration` | 精确 7 路径：公共 contracts/index、RSS registry/collector 接线、service/integration 测试与独立 fixture | `d5f50e66f0ce91b904d1b63022763162f6a5a92a` / `44afcd9e0919b42165637832c6892bf2538355a449bc50e6b7efdc08755dd7ba` | APPROVED · G4 | `5cbabc3ffcfe7a69a7f6df1046c2e4a4ecf8ca32` / `d83c1aaffae1e2ca6ff4584d913a9724a8babea8` | PASS（merge 后 Collection/配置/RSS/full verify/build/smoke/format/diff-check） | `archive_workspace` success；agent closed；directory removed |
| D05-CI01 | `fc7e35312a64a4993c1162c08e25b8020c812a11` | `adb5dc7e-5b56-449f-9449-5eb53fac6a7d` / `wks_d98e75523e89ca07` / `fix/d05-ci01-restricted-http-close-race` | 精确 1 路径：`tests/adapters/restricted-http.test.ts`（2 insertions/2 deletions） | `643b3bf240812c4b5c4887aa4a574c9b22800526` / `68d3fe3ca5dccba41f61746c92165e69ddbd130936a85eef481fdedff0cc24ef` | APPROVED · G4 | `25d22bcf2aaf3cc6da60acab4db5590d34f9d001` / `16052b516fd5e9e84481e2960aca1afefd68b383` | PASS（merge 后 full verify/build/smoke/format/diff-check） | `archive_workspace` success；agent closed；directory removed |

记录要求：

- 每卡记录精确 base、Worker Agent/Workspace/branch、允许路径、冻结 tree、canonical patch SHA-256、逐卡 Architect 审批、candidate/merge SHA、合并后 full verify 与 `archive_workspace` 返回。
- Worker 不自报 PASS，不 stage/commit/merge/push；candidate 只能在 Architect 批准冻结 tree 后由 Lead 创建。
- 任一源文件变化使既有冻结 tree/patch 和测试证据失效；必须重新冻结、复核并记录。

## D05 集成与远程门禁

| 门禁 | 状态 | 证据 |
|---|---|---|
| `COL-01`～`18` D05 映射 | PASS | 全部 COL Case ID 已映射；COL-15 引用 D04 restricted/RSS 回归，详见本地集成 Gate |
| fresh 条目 + checkpoint 原子事务 | PASS · T03/T04 | 事务/recheck/checkpoint 与公共 SQLite 集成均通过 |
| raw_data v1 strict schema / JSON round-trip | PASS · T02/T04 | T02 冻结；T04 公共真实 SQLite 集成复用通过 |
| 真实 SQLite + D04 RSS Adapter 本地集成 | PASS · T04 | 独立 fixture + in-memory RSS transport，无公网 |
| 配置 API checkpoint 不可写 / DDL / Prompt / CI 不变 | PASS · T04 | 配置/RSS 回归通过；T02 raw-data、D04、DDL/Prompt/CI diff 均为空 |
| D05 本地集成 Gate | PASS · PENDING ARCHITECT REVIEW | final merge `d83c1aa` clean snapshot `49/49` files、`585/585` tests |
| 远程 CI | FAIL · NEW CI PENDING | 旧 run `44128064463` @ `fc7e353` 因 socket close 时序失败；CI01 已本地合并复验，新 main push 后必须重跑 |
| D05 最终 PASS | NOT_ISSUED | 本地 Gate、远程 CI、Architect 验收均未完成 |
| D05 心跳删除 / Lead+Worker 归档 | PASS | T01～T04、CI01 五个 Worker Agent/Workspace 已归档并移除目录；Lead `1b7165af…` 已归档，workspace `wks_c149e16251f350e0` 归档且 `removedDirectory=true`；heartbeat `1a12839e` 删除成功。仅保留主工作区 |

## 当前阻塞与待决策事项

- 无代码阻塞；D05 四卡、本地 Gate 与 CI01 定向稳定化均已完成。
- 唯一当前门禁：Architect 推送新 main 后，核验该精确 SHA 的 CI Success。

## 下一可执行动作

1. 将 D05-CI01 PASS、candidate/merge、post-merge verify 与归档证据交 Architect。
2. Architect push 新 main 后核验远程分支 SHA 与该精确 SHA 的 CI Success。
3. CI 成功且最终验收后才可删除 heartbeat `1a12839e` 并归档 D05 Lead；当前不得签发 FINAL PASS。

## Plan G3 审核记录

- 提交者：D05 Lead
- 日期：2026-11-17
- v0.1：`CHANGES_REQUIRED`。阻塞为：raw_data 构造归属前移与路径自洽；single-flight 逐调用取消及 token 清理语义；`config/prompt` tracked-diff 检查与事务 helper 表述。
- v0.2：`APPROVED`。Architect 确认 T02 raw_data 前移、逐调用取消/token 清理、正确路径与同步事务表述均闭合；批准 commit `21d97b1e123fe405690474a28f0a3b7083c08008`，tree `4d0fcc593da7b69bcc6653f880825f70b1611869`。
- 执行批准：main 已 fast-forward 至 `fab28a51449ec1c04afed589515065e5423bdebe`；T01 Worker 固定从该 commit 启动。
- T01 G4：Architect `APPROVED` tree `6f50ecb9446af94c8070dd1f610a75c0cbd512fa`、base `fab28a51449ec1c04afed589515065e5423bdebe`、patch SHA-256 `279b9db5ebe55f216231345609aa683d9286f2c1aef644f1cd8b0c42a4007564`、精确 4 路径；Architect 独立 typecheck/build/8 tests PASS，采纳 Lead 同一 tree full verify `41/41` files、`530/530` tests。
- T02 G4：Architect `APPROVED` tree `af0b8d015a616411f51d2e9b12bdfd52f13b34ed`、base `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e`、patch SHA-256 `27583c4e7d690aaceb161d683b815dc6912b7a9b8182f316fbad385c423e01b8`、精确 9 路径；Architect 独立 typecheck/build/4 files 30 tests PASS，采纳 Lead 同一 tree D04 172 与 full verify `45/45` files、`560/560` tests 证据。
- T03 G4：Architect `APPROVED` tree `e5f9980d576f4f9caad68318da1e21b8d6fbf697`、base `34339c19499e37d92a796e67c80a63159c7b3405`、patch SHA-256 `32723195e01978a700b1e46840b6c1039983bf0aa423b2e7cec8e78a719014a1`、精确 4 路径；Architect 独立 typecheck/build/14 tests PASS，采纳 Lead 同一 tree full verify `47/47` files、`574/574` tests 证据。
- T04 G4：Architect `APPROVED` tree `d5f50e66f0ce91b904d1b63022763162f6a5a92a`、base `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1`、patch SHA-256 `44afcd9e0919b42165637832c6892bf2538355a449bc50e6b7efdc08755dd7ba`、精确 7 路径；Architect 独立 typecheck/build/Collection 23 tests PASS，采纳 Lead 同一 tree full verify `49/49` files、`585/585` tests 证据。
- 远程 CI 失败：run `44128064463` @ `fc7e353`，`tests/adapters/restricted-http.test.ts:321` 在 dispatcher close 回调先于 socket close 事件时立即断言 socket 为 0；生产实现与本机 8 次重复未见失败。Architect 裁决仅稳定化该测试 waitFor 条件。CI01 已按该裁决完成并经 G4 批准。

## D05-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；base/HEAD 均 `fab28a51449ec1c04afed589515065e5423bdebe`，真实 index 为空，无 commit/merge/push。
- 写集：四路径精确，无其他 tracked/untracked 文件；`git diff-tree --check` 通过。
- 行为复核：external_id 优先、URL+published_at fallback、NULL 时间 `IS NULL`、批内首次保留、跨 Source 隔离、明显空元数据过滤、title-only 保留、bare parameterized insert、`content_id=NULL`、raw_data 原样；无事务、checkpoint、Adapter、Content 或派发调用。
- Lead 验证：定向 `2/2` files、`8/8` tests；full `npm run verify` 为 `41/41` files、`530/530` tests，typecheck/build/smoke/format 全部 PASS。沙箱内 Vitest 首次因 `.vite-temp` 写入 EPERM，受控沙箱外同一 tree 重跑通过，未改代码。
- 精确冻结：tree `6f50ecb9446af94c8070dd1f610a75c0cbd512fa`；patch `20084` bytes；SHA-256 `279b9db5ebe55f216231345609aa683d9286f2c1aef644f1cd8b0c42a4007564`；冻结目录 `/private/tmp/d05-t01-final-freeze.TPR4rL`。
- 路径 blob：`source-item-identity.ts=a8b5143`、`source-item-repository.ts=9d6a2d9`、`source-item-identity.test.ts=a21d770`、`source-item-repository.test.ts=1c4fbc5`；四工作文件 blob 与冻结 tree 一致，独立重生成 patch 字节一致。
- 安全/范围：变更路径高置信 secret 模式 0 命中；无 `any`/`ts-ignore`/`ts-expect-error`；无 DDL、Prompt、configuration、adapter 或 package 变更。
- G4 后执行：candidate `41cc8597db8115b7b286ca2aea7621a67c2fecf7`，唯一 parent/base 为 `fab28a5`、tree 为 `6f50ecb`、精确 4 路径。local main `--no-ff` merge commit `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e`，tree `6f50ecb`，第一/第二 parent 分别为 `fab28a5` / candidate；四路径 blob 与 candidate 完全一致。
- Merge 后复验：固定 Node `26.13.1`/npm `11.20.0`；`npm ci --offline` 124 packages、0 vulnerabilities；定向 `2/2` files、`8/8` tests；full `npm run verify` 为 `41/41` files、`530/530` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/format 全部 PASS；`git diff --check` PASS。
- Worker 收尾：branch `feat/d05-t01-identity-repository` 与 `candidate/d05-t01-identity-repository` 均对齐 candidate `41cc8597`，index empty、worktree clean。Paseo `archive_workspace(wks_e8ae11c2dc19977d)` 返回 `archivedAgentIds=[7e411882-85a0-44c0-baba-725d5d5ce89f]`、`removedDirectory=true`；活跃 workspace 列表已无该项，Git worktree 条目与目录已移除，Worker agent `closed/archivedAt=2026-11-17T15:02:39.778Z`。
- T01 结论：`T01_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。T02 base 固定为 T01 merge `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e`。

## D05-T02 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；base/HEAD 均 `5af3d2c89851f5e0ea1bb9fbab14bf34ae54962e`，真实 index 为空，无 commit/merge/push。
- 写集：九路径精确，无其他 tracked/untracked 文件；`git diff-tree --check` 通过。
- 行为复核：`CollectionError` 四码安全消息；精确 Adapter registry；single-flight 首调用共享 abort、后续等待者独立取消、token-aware 清理、listener 移除与 late rejection 消费；raw_data strict v1、JSON 安全守卫、NONE 降级和 round-trip；collector 透传 checkpoint、不过滤 published_at、批内/库内预筛、只对新候选取正文、单条 AdapterError 降级、未知编程错误透传；无 DB 写入、checkpoint、Content、LLM、派发或公共 index。
- Lead 验证：专项 `4/4` files、`30/30` tests；D04 restricted HTTP/RSS 回归 `2/2` files、`172/172` tests；full `npm run verify` 为 `45/45` files、`560/560` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/format 全部 PASS；`git diff --check` PASS。
- 精确冻结：tree `af0b8d015a616411f51d2e9b12bdfd52f13b34ed`；patch `53383` bytes；SHA-256 `27583c4e7d690aaceb161d683b815dc6912b7a9b8182f316fbad385c423e01b8`；冻结目录 `/private/tmp/d05-t02-final-freeze.wivSBY`。
- 路径 blob：`collection-errors.ts=35db5a3`、`adapter-registry.ts=56416f1`、`single-flight.ts=4adf555`、`raw-data.ts=7cc025f`、`collector.ts=cf33d5c`、`adapter-registry.test.ts=204766c`、`single-flight.test.ts=8a2423b`、`raw-data.test.ts=e549f0e`、`collector-acquisition.test.ts=005b98f`；九工作文件 blob 与冻结 tree 一致，独立重生成 patch 字节一致。
- 安全/范围：变更路径高置信 secret 模式 0 命中；无 `any`/`ts-ignore`/`ts-expect-error`；无 DDL、Prompt、configuration、adapter 生产文件或 package 变更。
- G4 后执行：candidate `3ec4ee1ef6cb6850fe835435043b8eed64255b6b`，唯一 parent/base `5af3d2c8`、tree `af0b8d0`、精确 9 路径。local main `--no-ff` merge commit `34339c19499e37d92a796e67c80a63159c7b3405`，tree `af0b8d0`，第一/第二 parent 分别为 `5af3d2c8` / candidate；九路径 blob 与 candidate 完全一致。
- T02 merge 后复验：`npm ci --offline` 124 packages、0 vulnerabilities；专项 `4/4` files、`30/30` tests；D04 `2/2` files、`172/172` tests；full verify `45/45` files、`560/560` tests；typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/129 文件 format 全部 PASS；diff-check PASS。
- T02 Worker 收尾：branch `feat/d05-t02-single-flight-acquisition` 与 candidate 分支均对齐 `3ec4ee1e`，index empty、worktree clean。Paseo `archive_workspace(wks_68a47bc1f56d9690)` 返回 `archivedAgentIds=[8f593e43-483a-4bb3-938b-12ac22ecb8a0]`、`removedDirectory=true`；活跃列表无该项，worktree 条目/目录已移除，Agent `closed/archivedAt=2026-11-17T15:24:17.105Z`。
- T02 结论：`T02_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。T03 base 固定为 T02 merge `34339c19499e37d92a796e67c80a63159c7b3405`。

## D05-T03 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；base/HEAD 均 `34339c19499e37d92a796e67c80a63159c7b3405`，真实 index 为空，无 commit/merge/push。
- 写集：四路径精确，无其他 tracked/untracked 文件；`git diff-tree --check` 通过。
- 行为复核：现有同步 `withTransaction`、事务内逐 draft recheck、逐行参数化 insert、checkpoint UPDATE/read-back、任一步异常整体回滚；空 fresh 推进一次；`content_id=NULL`、raw_data 原样、IDs 顺序与 DB 一致；`discovered_at`/checkpoint 共用 startedAt；collector 将获取+保存置于同一 single-flight，事务前取消零写入；无 Content、LLM、派发或公共 index。
- Lead 验证：专项 `2/2` files、`14/14` tests；full `npm run verify` 为 `47/47` files、`574/574` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/132 文件 format 全部 PASS；`git diff --check` PASS。
- 精确冻结：tree `e5f9980d576f4f9caad68318da1e21b8d6fbf697`；patch `44347` bytes；SHA-256 `32723195e01978a700b1e46840b6c1039983bf0aa423b2e7cec8e78a719014a1`；冻结目录 `/private/tmp/d05-t03-final-freeze.njKF96`。
- 路径 blob：`collection-persistence.ts=dcaf451`、`collector.ts=afa9ff4`、`collection-persistence.test.ts=3e17f51`、`collector-transaction.test.ts=c1e58d5`；四工作文件 blob 与冻结 tree 一致，独立重生成 patch 字节一致。
- 安全/范围：变更路径高置信 secret 模式 0 命中；无 `any`/`ts-ignore`/`ts-expect-error`；无 DDL、Prompt、configuration、adapter 生产文件或 package 变更。
- G4 后执行：candidate `fb3631c297e792a766748c95861371cf97cb2139`，唯一 parent/base `34339c19`、tree `e5f9980`、精确 4 路径。local main `--no-ff` merge commit `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1`，tree `e5f9980`，第一/第二 parent 分别为 `34339c19` / candidate；四路径 blob 与 candidate 完全一致。
- T03 merge 后复验：`npm ci --offline` 124 packages、0 vulnerabilities；专项 `2/2` files、`14/14` tests；full verify `47/47` files、`574/574` tests；typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/132 文件 format 全部 PASS；diff-check PASS。
- T03 Worker 收尾：branch `feat/d05-t03-transaction-checkpoint` 与 candidate 分支均对齐 `fb3631c2`，index empty、worktree clean。Paseo `archive_workspace(wks_e14b152cb3581a7e)` 返回 `archivedAgentIds=[93faad84-feac-401e-94bd-9aa0d197ec18]`、`removedDirectory=true`；活跃列表无该项，worktree 条目/目录已移除，Agent `closed/archivedAt=2026-11-17T15:42:08.936Z`。
- T03 结论：`T03_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。T04 base 固定为 T03 merge `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1`。

## D05-T04 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；base/HEAD 均 `c0e1cdeb1a5b2ed314612053a1100e6b663b89c1`，真实 index 为空，无 commit/merge/push。
- 写集：七路径精确，无其他 tracked/untracked 文件；`git diff-tree --check` 通过。
- 公共边界：运行时代码仅导出 `CollectionError`、`createCollection`、`createRssAdapterRegistry`；CollectResult 仅含 new_source_item_ids；factory 组合 T01/T02/T03，projection 保持 D04 strict adapter source，公共无内部 SQL/Map/draft seam。
- 行为复核：重复调用的 factory 私有 single-flight 可清理；invalid/missing/disabled/unsupported/abort/DB failure 符合安全错误与零副作用；T02 raw-data 无修改且被直接复用；RSS registry 每次独立创建默认安全 adapter；集成使用真实 SQLite + D04 RSS transport，无 Content/下游/LLM/ProcessTask。
- Lead 验证：Collection 定向 `3/3` files、`23/23` tests；配置/RSS 回归 `3/3` files、`31/31` tests；full `npm run verify` 为 `49/49` files、`585/585` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/137 文件 format 全部 PASS；diff-check PASS；DDL/Prompt/CI 指定 diff 输出为空。
- 精确冻结：tree `d5f50e66f0ce91b904d1b63022763162f6a5a92a`；patch `44747` bytes；SHA-256 `44afcd9e0919b42165637832c6892bf2538355a449bc50e6b7efdc08755dd7ba`；冻结目录 `/private/tmp/d05-t04-final-freeze.YdFFRf`。
- 路径 blob：`contracts.ts=239765a`、`index.ts=fa6d3c1`、`adapter-registry.ts=eac931d`、`collector.ts=255fd29`、`collection-service.test.ts=0b7fada`、`collection-integration.test.ts=031cea5`、`collection.ts=f5067a2`；七工作文件 blob 与冻结 tree 一致，独立重生成 patch 字节一致。
- 安全/范围：变更路径高置信 secret 模式 0 命中；无 `any`/`ts-ignore`/`ts-expect-error`；T02 raw-data、D04 adapter、DDL、Prompt、configuration/API、package 与 CI 均无变更。
- G4 后执行：candidate `5cbabc3ffcfe7a69a7f6df1046c2e4a4ecf8ca32`，唯一 parent/base `c0e1cdeb`、tree `d5f50e6`、精确 7 路径。local main `--no-ff` merge commit `d83c1aaffae1e2ca6ff4584d913a9724a8babea8`，tree `d5f50e6`，第一/第二 parent 分别为 `c0e1cdeb` / candidate；七路径 blob 与 candidate 完全一致。
- T04 merge 后复验：Collection `3/3` files、`23/23` tests；配置/RSS `3/3` files、`31/31` tests；full verify `49/49` files、`585/585` tests；typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/137 文件 format 全部 PASS；diff-check PASS。
- T04 Worker 收尾：branch `feat/d05-t04-public-contract-integration` 与 candidate 分支均对齐 `5cbabc3f`，index empty、worktree clean。Paseo `archive_workspace(wks_cd84ce831f63f6e0)` 返回 `archivedAgentIds=[58438af5-eb91-42d2-9a2f-21fdd618251e]`、`removedDirectory=true`；活跃列表无该项，worktree 条目/目录已移除，Agent `closed/archivedAt=2026-11-17T16:10:35.324Z`。
- T04 结论：`T04_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。final local main 固定为 `d83c1aaffae1e2ca6ff4584d913a9724a8babea8`。

## D05 本地集成 Gate

- 精确输入：final merge `d83c1aaffae1e2ca6ff4584d913a9724a8babea8`，tree `d5f50e66f0ce91b904d1b63022763162f6a5a92a`。local main clean、无 tracked/untracked 变化。
- 干净快照：`/private/tmp/pis-d05-gate-full.YjA4Yy`；`git archive` source tar SHA-256 `c5d3d621b1369717d6abae1cf2445afd68e7ac065416c983eeb589b33a8236ce`。快照刚生成时无 `.git`、无既有 `node_modules`、无 SQLite/WAL/SHM；`npm ci` 后 snapshot 内存在受控安装的 `node_modules`。快照只含 tracked synthetic `config/prompts/user-context.md`。
- Baseline 说明：该 user-context 自 D02 起 tracked，Prompt 测试明确名称为 `public synthetic prompt context`；D05 未修改、未读取其正文。初次过滤掉该 synthetic fixture 的快照只失败 Prompt 文件存在性测试；完整 tracked snapshot 通过全部测试。
- 依赖/验证：快照内 `npm ci --offline` 安装 124 packages、0 vulnerabilities；`npm run verify` 为 `49/49` files、`585/585` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/Source+Topic 持久化/database smoke/137 文件 format 全部 PASS。
- COL 映射：`COL-01/07/11/12/16` → T01/T03/T04 identity、事务、checkpoint、NONE service/persistence；`COL-02/03/04/05/13/17/18` → T01 identity/repository + T04 service；`COL-06/08/09/10/14` → T02 acquisition/single-flight + T04 RSS integration；`COL-15` → D04 restricted HTTP/RSS 安全回归。`COL-01` 的 Processing 派发部分按 D05 边界归 D15。
- 边界 diff：执行批准 `fab28a5` → final `d83c1aa` 仅新增 `src/collection/**` 与对应 `tests/collection/**`、`tests/fixtures/collection.ts`；`src/database/schema.sql`、`config/prompts`、`config/prompt`、`.github`、`src/adapters` tracked diff 均为空，无 package/lock 变更。
- 资源：T01～T04 Worker 全部 archived，独立 worktree 条目/目录均已移除；主工作区 clean，无 SQLite/WAL/SHM 残留。未 push。
- Gate 结论：`D05_LOCAL_GATE=PASS`、`D05_ARCHITECT_GATE_REVIEW=PASS`、`D05_REMOTE_CI=PASS`、`D05_FINAL_PASS=ISSUED`。

## D05-CI01 Lead 复核与冻结记录

- 触发：远程 CI run `44128064463` @ `fc7e353` 的目标测试在 Linux 上仅因 dispatcher close 与 socket close 事件顺序不确定而失败；本机重复 8 次通过，生产实现未失败。
- Worker 交回：`REVIEW`；base/HEAD `fc7e35312a64a4993c1162c08e25b8020c812a11`，真实 index 为空，无 commit/merge/push。
- 精确 diff：仅 `tests/adapters/restricted-http.test.ts` 2 insertions/2 deletions；waitFor 条件为 `dispatchersClosed === 1 && fixture.sockets.size === 0`，描述同步更新；默认 1 秒 timeout 与全部原断言保留。
- 边界：生产代码、fixture、其他测试、package、DDL、Prompt、CI 均无 diff。
- Lead 验证：目标单测连续 `10/10` PASS；full `npm run verify` 为 `49/49` files、`585/585` tests，typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/137 文件 format 全部 PASS；diff-check PASS。
- 精确冻结：tree `643b3bf240812c4b5c4887aa4a574c9b22800526`；patch `688` bytes；SHA-256 `68d3fe3ca5dccba41f61746c92165e69ddbd130936a85eef481fdedff0cc24ef`；冻结目录 `/private/tmp/d05-ci01-final-freeze.EWuzXf`；blob `5be0688d70aa87eba548a10980986d8bb450e27a`。
- G4 后执行：candidate `25d22bcf2aaf3cc6da60acab4db5590d34f9d001`，唯一 parent/base `fc7e353`、tree `643b3bf`、唯一测试路径。local main `--no-ff` merge commit `16052b516fd5e9e84481e2960aca1afefd68b383`，tree `643b3bf`，第一/第二 parent 分别为 `fc7e353` / candidate；test blob 精确 `5be0688d70aa87eba548a10980986d8bb450e27a`。
- Post-merge verify：`npm ci --offline` 124 packages、0 vulnerabilities；full verify `49/49` files、`585/585` tests；typecheck/build/SIGINT/SIGTERM/端口/关闭/持久化/database smoke/137 文件 format 全部 PASS；diff-check PASS。
- Worker 收尾：branch `fix/d05-ci01-restricted-http-close-race` 与 candidate 分支均对齐 `25d22bcf`，index empty、worktree clean。Paseo `archive_workspace(wks_d98e75523e89ca07)` 返回 `archivedAgentIds=[adb5dc7e-5b56-449f-9449-5eb53fac6a7d]`、`removedDirectory=true`；活跃列表无该项，worktree 条目/目录已移除，Agent `closed/archivedAt=2026-11-17T17:03:29.433Z`。
- D05-CI01 结论：`D05-CI01_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。production-layer tree 为 `643b3bf240812c4b5c4887aa4a574c9b22800526`。
