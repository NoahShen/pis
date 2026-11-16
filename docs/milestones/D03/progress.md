# D03 Progress

## 当前门禁

- 当前角色：D03 Lead（仅规划）。
- 文档基线：`a8571c76e661f75c6a9ff2318631454ce5f3e1ed`；生产实现基线：`40d9efeb21e8c94480dbdc644f09be0ac17d7a9f`（已推送且远程 CI Success）。
- D02 四卡、本地集成、远程 CI 已通过，Architect 已记录最终 PASS。
- `SOURCE_TYPE_URL_POLICY=IMMUTABLE_AFTER_CREATE`：负责人明确批准；同值 PATCH 亦整单拒绝。
- Intent v0.1：`APPROVED`，负责人 G1 通过。
- Spec v0.1：`APPROVED`，Architect G2 通过。
- Plan v0.2：`APPROVED`；Architect 已复核 `2b305005e2206118b01eb1c3b30001aad31185a1` 的订正，三项 G3 阻塞已解决；等待负责人审核批准执行。
- `USER_EXECUTION_APPROVAL=PENDING`：负责人尚未在 G3 后明确批准正式执行。
- D03-T01 / T02 / T03：`NOT_STARTED`，严格串行且不得并行。
- 未创建或委派 Worker，未创建推进心跳；未修改生产代码、测试、依赖、锁文件、Prompt、Spec 或权威设计。
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
- D03 实现测试：`NOT_RUN`。
- D03 本地集成 Gate：`NOT_RUN`。
- `D03_LOCAL_GATE=NOT_APPROVED`；`D03_REMOTE_CI=NOT_RUN`；`D03_FINAL_PASS=NOT_ISSUED`。不得以本地规划、本地测试或既有 D02 CI 代替远程与最终验收。
- 真实 RSS、Scheduler 执行、Topic Matching 快照、LLM、历史回溯及发布：`NOT_RUN`，不属于 D03 配置 API 验收。

## 下一步

Plan v0.2 已通过 Architect G3，交项目负责人审阅并明确批准执行。负责人批准前保持三卡 NOT_STARTED，不创建 Worker 或推进心跳，不实现、不 push。
