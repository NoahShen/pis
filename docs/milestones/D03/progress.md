# D03 Progress

## 当前门禁

- 当前角色：D03 Lead（实现阶段门禁与审核；不代 Worker 编码）。
- 文档基线：`a8571c76e661f75c6a9ff2318631454ce5f3e1ed`；生产实现基线：`40d9efeb21e8c94480dbdc644f09be0ac17d7a9f`（已推送且远程 CI Success）。
- D02 四卡、本地集成、远程 CI 已通过，Architect 已记录最终 PASS。
- `SOURCE_TYPE_URL_POLICY=IMMUTABLE_AFTER_CREATE`：负责人明确批准；同值 PATCH 亦整单拒绝。
- Intent v0.1：`APPROVED`，负责人 G1 通过。
- Spec v0.1：`APPROVED`，Architect G2 通过。
- Plan v0.2：`APPROVED`；Architect G3 复核提交为 `753322a`，三项 G3 阻塞已解决。
- `USER_EXECUTION_APPROVAL=APPROVED`：负责人审阅 Plan v0.2 后明确回复“确认，开始执行吧”；授权记录提交为 `48585e2801754cc74124f8031e42829d65e361bb`。批准 T01～T03 按计划串行执行，不包含 push 授权。
- D03-T01：`PASS · LOCAL_MERGE_VERIFIED`；D03-T02：`PASS · LOCAL_MERGE_VERIFIED`；D03-T03：`IN_PROGRESS · ARCHITECT_APPROVED_AWAITING_CANDIDATE_MERGE`。
- 此前未创建推进心跳；Architect 现已按用户要求创建 active heartbeat `21df46f8`（名称：PIS D03 执行推进与分级验收；`*/10 * * * *`；`Asia/Shanghai`），由 Architect 在最终验收完成或用户要求停止时删除并核对。Lead 未代 Worker 编码，未修改生产代码、测试、依赖、锁文件、Prompt、Spec 或权威设计。
- 规划核验：未发现需要重定 Spec 契约的矛盾；现有 `startServer` 的 listen rejection 与 bound-address 失败分支均未调用 `app.close()`，已作为 T02 的双分支生命周期缺口纳入单一总预算、单次 cleanup/flush 与竞态回归证据。

## 计划摘要

- D03-T01：共享 strict Zod/Repository 双边界、Source/Topic Repository、稳定 ID 排序、不可变 Source `type/url` 与只读 `last_collected_at`、唯一新增精确依赖 `node-cron@4.6.0`（仅 `validate()`，只允许 `package.json`/`package-lock.json` 依赖变化）。
- D03-T02：Source API、`DATABASE_PATH`（默认 `./data/pis.sqlite`）、默认 `buildApp/main` 真实 DB 装配、owned `onClose`、初始化/监听失败一次回收、严格 JSON Content-Type、现有测试与 process smoke 全部临时 DB 隔离。
- D03-T03：Topic API 复用同一连接与 T02 装配缝，验证配置更新不改历史关联/发布及下游表，并完成 Topic process smoke 与 README。
- 每卡门禁：新 Worker 会话、独立 worktree、固定 Node 26.13.1/npm 11.20.0、`npm ci`；Worker `REVIEW` → Lead 审核并冻结精确 tree → Architect `APPROVED` → 精确 candidate commit → `--no-ff` merge → 合并 commit 定向测试/full verify → PASS → 下一卡。
- 集成 Gate：干净 worktree 精确 `npm ci` + `npm run verify`，真实临时 SQLite 与 Source/Topic 真实进程 smoke。通过后只记 `D03_LOCAL_GATE=APPROVED`。
- 最终验收分离：只有负责人另行授权 push 且精确 SHA 的远程 CI Success 后记 `D03_REMOTE_CI=PASS`；本地 Gate 与远程 CI 同时满足才可 `D03_FINAL_PASS=ISSUED`。

## 当前证据边界

- Architect G3：v0.1 `CHANGES_REQUIRED` → v0.2 `APPROVED`；独立核对完整修订 diff、仅两文档范围、clean 状态及 diff-check，通过。
- D03-T01/T02 实现测试：`PASS`；D03-T03 Worker、Lead、Architect 已审核同一冻结 tree，等待精确 candidate merge 与合并后复验。
- D03 本地集成 Gate：`NOT_RUN`。
- `D03_LOCAL_GATE=NOT_APPROVED`；`D03_REMOTE_CI=NOT_RUN`；`D03_FINAL_PASS=NOT_ISSUED`。不得以本地规划、本地测试或既有 D02 CI 代替远程与最终验收。
- 真实 RSS、Scheduler 执行、Topic Matching 快照、LLM、历史回溯及发布：`NOT_RUN`，不属于 D03 配置 API 验收。

## D03-T01 执行记录

- Workspace：`wks_b489061f89b70ff0` / `D03-T01 配置输入与 Repository`。
- Worktree：`/Users/noahshen/.paseo/worktrees/0eapmc43/d03-t01-configuration-repositories`。
- Branch：`d03-t01-configuration-repositories`。
- Base SHA：`48585e2801754cc74124f8031e42829d65e361bb`；创建时核对 worktree HEAD、分支 tip 与 local `main` 均为该 SHA，工作树 clean。
- Worker Agent：`dd923381-9532-4340-be38-66cf6a59223b`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、`thinking=high`）。
- Worker 门禁：只允许 T01 白名单文件与精确 `node-cron@4.6.0`；先验证 Node 26.13.1/npm 11.20.0、toolchain 与初始 `npm ci`，自测后只回报 `REVIEW` 或 `BLOCKED`，不得 stage/commit/merge/push。
- Worker 首轮审核形成 tree `619b143450be325105a928e9eeaf3d18f0af698c`，未提交。Lead 独立发现 PATCH 类型约束仍可接受仅含 `undefined` 的字段；Architect 另以真实内存 SQLite + 确定性 SELECT 回读故障复现 Source/Topic create 在 INSERT 成功后回读失败时仍保留记录。该 tree 随即作废，不形成 candidate。
- Worker 仅在同一 9 文件写集修复并补测：选中至少一个 PATCH 键时，该键 required 且排除 `undefined`；Source/Topic create 在 parser 校验后，把 ID 生成、INSERT、按 ID 回读和 domain 映射全部置于同一 D01 同步事务。
- 新 create 故障 Fixture 仅独立识别配置表 INSERT/SELECT：确认 INSERT 成功且在事务内取得新行后再抛确定性回读错误；Source/Topic 测试分别证明失败后 ID 仅调用一次、无重试、异常未被包装、事务外整表快照与 create 前精确相等。
- Lead 定向复核：3/3 文件、19/19 tests 通过；完整 `npm run verify`：27/27 文件、155/155 tests 通过，精确 toolchain、typecheck、build、SIGINT+SIGTERM/监听失败 smoke、database smoke 与 78 文件格式检查全部通过。
- `T01_ARCHITECT_AGENT_ID=8d95474b-e07e-43c7-bc7f-92928fe91e71`；`WORKER_VERDICT=REVIEW`；`LEAD_REVIEW=APPROVED`；`ARCHITECT_REVIEW=APPROVED`。
- `T01_APPROVED_TREE=e3f4b66897c134febf4794e763c8d8649a287488`；`T01_PATCH_SHA256=98d8841a86aca0fcc2d9c51582d79038cd06a214bd7355ed71a344d6177ea807`。Architect 独立核对 9 个白名单路径、逐文件 blob、依赖 diff、toolchain/typecheck/定向 19/19 和 diff-check；仅批准该精确 T01 tree。
- `T01_CANDIDATE_SHA=3248df14a6fd7a8ad7eaa179d5931c204b4ee49f`；candidate tree 与实际 stage tree 均为 Architect 批准的 `e3f4b66897c134febf4794e763c8d8649a287488`。
- local main 的 `--no-ff` merge commit 为 `205324c91b98192135a21cd22042a1599ecbd63e`，merge tree 为 `c5b91748b36701e10c0e68f9831d7bb8ddbf1ff7`；第一父提交包含仅文档的 T01 委派记录 `2b5ffbca40ff31265d08dd7739a6312aec35b909`，第二父为 candidate。
- 合并后 main 重新执行 `npm ci`：94 packages、0 vulnerabilities；随后定向仍为 3/3 文件、19/19 tests，完整 verify 仍为 27/27 文件、155/155 tests，toolchain/typecheck/build/smokes/database smoke/78 文件格式检查全部通过。`T01_REMOTE_CI=NOT_RUN`；未 push。
- T02 `WORKSPACE_ID=wks_314e88f78e20a7ab`；`WORKER_AGENT_ID=e5b9be93-86e3-49e1-9023-b78e45f1d6b1`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、`thinking=high`）。
- `T02_BRANCH=d03-t02-source-api-app-assembly`；`T02_BASE_SHA=ff9e9cb0238e5f91cca913bfe906c7c8540b90fe`；`T02_WORKTREE=/Users/noahshen/.paseo/worktrees/0eapmc43/d03-t02-source-api-app-assembly`。创建后核对 branch HEAD、独立 worktree HEAD 与 local main 均为该 SHA。
- T02 门禁：只允许 Plan 的 18 路径，不新增依赖，不修改 T01 contracts/repositories、DDL、依赖、CI、README 或三份权威文档；只实现 Source 路由，不提前暴露 Topic。用户批准的 Source `type`/`url` 创建后不可修改规则必须进入 PATCH 拒绝和数据库 no-side-effect 测试。
- Lead 首轮审核将 Worker 退回两项：`DATABASE_PATH` 约束改为只拒绝空或全空白且保留原文；异步路由注册阶段的 `app.ready()` 失败必须让 owned DB 恰好关闭一次，后续 `app.close()` 不得二次关闭。Worker 均在原 18 路径写集内修复并补测。
- Worker 最终自测：typecheck 退出 `0`；config/app-assembly 定向 `2/2` 文件、`11/11` tests 退出 `0`；T02 五文件定向 `5/5` 文件、`61/61` tests 退出 `0`；`npm run verify` 退出 `0`，`29/29` 文件、`183/183` tests。新增用例名包含 `loadConfig accepts a non-blank DATABASE_PATH with surrounding spaces without trimming it` 与 `closes an owned database once when a registered plugin fails during app.ready()`。
- Lead 独立复核：config/app-assembly verbose `11/11` tests 退出 `0`；`npm run verify` 退出 `0`，toolchain/typecheck、`29/29` 文件 `183/183` tests、build、既有 SIGINT/SIGTERM/监听失败 smoke、Source 重启持久化 process smoke、database smoke 及 `86` 文件格式检查全部成功。`git diff --check` 退出 `0`。
- `WORKER_VERDICT=REVIEW`；`LEAD_REVIEW=APPROVED`；`T02_ARCHITECT_AGENT_ID=8d95474b-e07e-43c7-bc7f-92928fe91e71`；`ARCHITECT_REVIEW=APPROVED`。Architect 独立重算精确 tree、18 路径逐文件 blob/hash 与 patch SHA-256，确认真实 index 为空且 HEAD 未变；Plan 定向 `5/5` 文件 `61/61` tests、full verify `29/29` 文件 `183/183` tests 及全部 smoke/format/diff-check 均通过，无生产阻塞。
- `T02_CANDIDATE_TREE=5ac735e759145742e21639bfa1061490c28a154f`；`T02_PATCH_SHA256=4b1bda51dcc3a0fbd3e12ddae5a027bea0037acd21337b49e90cedc79982a848`。冻结方法为以 `HEAD=ff9e9cb0238e5f91cca913bfe906c7c8540b90fe` 读入隔离临时 index，只 add Plan 的 18 路径后 `write-tree`；patch hash 对 `git diff --cached --binary --full-index --no-ext-diff HEAD` 计算。
- 冻结 tree 相对 base 恰好 `18` 个路径；`docs/milestones/D03/progress.md` 为门禁记录，不在 candidate 内。真实 index 为空，未 stage、未 commit、未 push、未创建 candidate commit。
- `T02_CANDIDATE_SHA=0decc8466afe726c5e87080249d8bf78cf57c5ac`；candidate tree 精确为 Architect 批准的 `5ac735e759145742e21639bfa1061490c28a154f`，唯一 parent 为 `ff9e9cb0238e5f91cca913bfe906c7c8540b90fe`，diff-tree 恰 `18` 路径，真实 index 清空。T02 worktree 中未纳入候选的旧 `progress.md` 改动保持未 stage，未使用 `git add -A`。
- T02 合并前文档提交 `a293d3f0a201f3ab78084938bf9eece52b247760`；local `main` 的 `--no-ff` merge commit 为 `1212107c685bc080709efaa140b1fd03ef5e81d4`，merge tree 为 `ea39fae15197b0178de70860fa6f8fd15daf7649`，第一父为前述文档提交、第二父为 candidate。第一父到 merge 的 diff 恰 `18` 路径，patch SHA-256 仍为 `4b1bda51dcc3a0fbd3e12ddae5a027bea0037acd21337b49e90cedc79982a848`，diff-check 为 `0`。
- 合并后 local `main` 以精确 Node `26.13.1` / npm `11.20.0` 执行 `npm ci`：94 packages、0 vulnerabilities；Plan 定向 `5/5` 文件、`61/61` tests 退出 `0`；完整 `npm run verify` 退出 `0`，typecheck、`29/29` 文件 `183/183` tests、build、SIGINT/SIGTERM/占用端口/forced-close/late-listen smoke、Source 跨重启持久化、database smoke 与 `86` 文件格式检查全部通过。
- 合并后工作树 clean，默认 `data/` 不存在，未出现真实配置/DB/Token 污染。`T02_STATUS=PASS · LOCAL_MERGE_VERIFIED`；`T02_REMOTE_CI=NOT_RUN`；未 push。
- T03 `WORKSPACE_ID=wks_4f99c8228f3873c2`；`WORKER_AGENT_ID=c4dccc92-be2b-4c09-8300-e09065baeccf`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、`thinking=high`）。
- `T03_BRANCH=d03-t03-topic-api-integration`；`T03_BASE_SHA=511b37d053b1e53693a656d6a315dd12d3f77de7`；`T03_BASE_TREE=0e690944533e5d61df047bf1808465e9ab6bacaa`；`T03_WORKTREE=/Users/noahshen/.paseo/worktrees/0eapmc43/d03-t03-topic-api-integration`。创建后核对 branch HEAD 与该 SHA 一致、工作树 clean。
- T03 Worker 门禁原预期 5 路径（`topic-routes.ts`、`route-registry.ts`、`topic-api.test.ts`、`smoke-configuration-topics.mjs`、`README.md`）；Worker 回报 `REVIEW` 并增加第 6 路径 `source-api.test.ts`。该文件仅把 T02 的“Topic 路由应 404 / hasRoute=false”过时负向断言同步为 Topic 路由已注册，Source 生产路由未改。Lead 判定这是启用已批准 Topic 路由所必需的测试同步、无契约扩张，接受写集 deviation 并提交 Architect 裁断；不得以 Worker 自报代替审核。
- T03 Worker 自测：干净安装后定向与 full verify 均 PASS；`npm run verify` 为 `30/30` 文件、`191/191` tests，build、Source+Topic 真实重启 smoke、database smoke、`89` 文件格式检查全部通过；无 SQLite/WAL/SHM 残留。Worker 未 stage/commit/merge/push，源码 worktree 为非暂存改动。
- Lead 独立复验：固定 Node `26.13.1` / npm `11.20.0`；`npm ci` 94 packages、0 vulnerabilities；Topic/TopicRepository/Source/app 定向 `4/4` 文件 `35/35` tests；full verify 退出 `0`，`30/30` 文件 `191/191` tests，真实进程依次输出 Source 与 Topic 跨重启持久化 PASS，格式覆盖 `89` 文件。
- `T03_CANDIDATE_TREE=e51a86a9f6a663ab41d1fc9cbf8658e5ad0bbfff`；`T03_PATCH_SHA256=3672acac1a027350f4b9e31899fe4394211526d78e36955f59fbbc54b1f5c1fb`。冻结方法为从 base 读入隔离临时 index，只显式 add 上述 6 路径后 `write-tree`；patch hash 对 `git diff --cached --binary --full-index --no-ext-diff 511b37d...` 计算。真实 index 为空，HEAD 未变，未创建 candidate commit。
- `T03_ARCHITECT_AGENT_ID=8d95474b-e07e-43c7-bc7f-92928fe91e71`；`ARCHITECT_REVIEW=APPROVED`。Architect 独立核对 base/HEAD、真实 index 为空、6 路径逐文件 hash/blob、tree 与 patch SHA-256、diff-check；Plan 原定向 `3/3` 文件 `28/28` tests、full verify `30/30` 文件 `191/191` tests 与全部 build/smoke/format 均 PASS，无阻塞。
- Architect 明确批准本次 Plan 写集例外：仅额外 `tests/configuration/source-api.test.ts` 的最后一项过时 Topic 未注册断言同步，启用已批准 Topic 路由必需，Source 行为断言保留；不得将该追认扩大为任意 T02 修改。仅批准精确 tree `e51a86a9f6a663ab41d1fc9cbf8658e5ad0bbfff`，不代表 candidate/merge/T03 PASS。

## 下一步

以 base `511b37d053b1e53693a656d6a315dd12d3f77de7` 为唯一 parent、tree `e51a86a9f6a663ab41d1fc9cbf8658e5ad0bbfff` 创建 candidate commit，核对 tree/parent/6-path patch 后 `--no-ff` 合并到 local `main`，再执行 `npm ci`、定向和 full verify。只有合并后复验通过才记 T03 `PASS`；随后进入 Plan §6 干净集成 Gate。不 push。
