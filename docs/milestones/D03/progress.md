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
- D03-T01：`PASS · LOCAL_MERGE_VERIFIED`；D03-T02：`IN_PROGRESS · ARCHITECT_APPROVED_AWAITING_CANDIDATE_MERGE`；D03-T03：`NOT_STARTED`，严格串行且不得提前派发。
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
- D03-T01 实现测试：`PASS`；D03-T02 Worker、Lead、Architect 已审核同一冻结 tree，等待精确 candidate merge 与合并后复验；D03-T03 实现测试：`NOT_RUN`。
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

## 下一步

将 `T02_CANDIDATE_SHA=0decc8466afe726c5e87080249d8bf78cf57c5ac` 以 `--no-ff` 合并到 local `main`，核对 merge tree、双亲与候选范围后重跑定向和 full verify。合并后复验通过才记 T02 `PASS`；T02 PASS 前不得派发 T03，不 push。
