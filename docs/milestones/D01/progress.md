# D01 Progress

## 当前状态

- 前置：D00 修复后基线 `8f56810` 已确认，已 push，远程 [CI #1](https://github.com/NoahShen/pis/actions/runs/43690265810) 成功。
- Intent v0.1：APPROVED。负责人在措辞修订后明确回复“好的，没问题了，继续下一步”。
- Spec v0.1：APPROVED，Architect 完成 G2，见 [spec.md](spec.md)。
- Plan v0.1：Lead 已提交；Architect G3 结论 `CHANGES_REQUIRED`，要求修正 PromiseLike 类型拒绝、干净检出测试不得依赖未构建 `dist`、同步既有精确工具链事实，并收敛 T02/T04 与重复验证边界。
- Plan v0.2：Architect G3 复审 `APPROVED`；上轮类型约束、构建前测试依赖及文件边界问题已解决。实现与原生兼容性仍未验证，用户执行批准为 `APPROVED`，依据负责人审阅 Plan v0.2 后回复“好的，没问题了，继续下一步”。
- 工具链：精确 Node `26.13.1` / npm `11.20.0` 已存在于 `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`；Lead 显式 prepend 后执行 `verify:toolchain` 通过。尚未用该工具链安装 D01 依赖。
- 额外执行门禁：负责人要求“plan制定好了之后，发我看一下，等我审核完了再让worker执行”。负责人执行批准状态为 APPROVED；已满足该额外执行门禁。
- 心跳保持停止；不修改或提交原有 `config/`；当前不 push 后续文档。
- D01-T01 Worker：Agent `23389e56-c3d9-4ac4-bd75-3fb5a7178c38`，Workspace `wks_c62575d3444027e7`，Worktree `/Users/noahshen/.paseo/worktrees/0eapmc43/d01-t01-native-database`，Branch `feat/d01-t01-native-database`，Base SHA `74e25b694d797b1146d2ec2ef7b01ec9558dee6e`。候选 commit `cec9cf4f96adf6e01944592f7b31a361d1bd31e3` 仅含 T01 六个白名单文件；Architect `8d95474b-e07e-43c7-bc7f-92928fe91e71` 唯一批准该候选。
- D01-T01 Lead 独立验证：精确 Node `v26.13.1` / npm `11.20.0` / `darwin-arm64`；clean `npm ci` 安装 93 packages、0 vulnerabilities；定向测试 `4/4`；full verify 全量 `13 files / 61 tests`、build、5 项 smoke、44 文件格式检查均通过；compiled ESM probe exit 0，实测 `wal`、`foreign_keys=1`、`busy_timeout=5000`。实际 `better-sqlite3@13.2.0`、`@types/better-sqlite3@9.6.0`、SQLite `3.54.1` 和随包 `prebuilds/darwin-arm64.node` 已核对；Linux CI/跨平台仍为 `NOT_RUN`。
- D01-T01 合并：Architect 对候选复核 `APPROVED`；Lead 以 `--no-ff` 合入 local `main`，merge SHA `bc5728324e09d4a1473909d51d075d6a95b565ba`。合并后六个功能文件与批准候选逐字节一致；未 push。
- D01-T02 Worker：Agent `62a577b1-5193-4afc-891d-3b65fe4db92b`，Workspace `wks_c39a954e6171fef5`，Worktree `/Users/noahshen/.paseo/worktrees/0eapmc43/d01-t02-schema`，Branch `feat/d01-t02-schema`，Base SHA `d3ad3a478e4dbea1196bd3475f2efdcf8d661504`。Worker 使用 `codex-worker` profile，交付 Candidate `e44403675db0975b76f89a5ac341f74b79551a33`；仅含 9 个实际 T02 白名单文件。
- D01-T02 Lead 独立审核：clean `npm ci` 后定向 verbose `2 files / 9 tests` 全通过；`npm run verify` 全量 `15 files / 70 tests`、typecheck、两次 fresh build、原 5 项进程 smoke、compiled database smoke、50 文件格式检查均通过。权威数据库设计仅 1 个 SQL block，docs/source 规范化一致，source/dist 严格字节一致；schema 7,213 bytes、SHA-256 `49d4b31e671a9b543010ddd53cfd7c232f8044364795207e8f4182608bcc481b`。compiled probe 实测 WAL、`foreign_keys=1`、`busy_timeout=5000`、11 业务表 + `event_search`、11 显式索引、JSON array、trigram MATCH 与空 FK check。Candidate `e44403675db0975b76f89a5ac341f74b79551a33` 仅含 9 个 T02 白名单文件，T01/config/CI/docs 无改动，工作树 clean。
- D01-T02 Architect 复核：Agent `877174d6-70ee-46d4-8f0d-fbeab0d66a75` 对 Candidate `e444036` 结论 `APPROVED`。Architect 独立运行 `npm run verify` 最终 exit 0，15 files / 70 tests、build、原 5 项 smoke、database smoke、50 文件格式检查全通过；首轮仅因受限沙箱 `listen EPERM` 失败，获批后完整重跑通过。确认 DB-13 三类多态表悬空目标、DDL 单事务、连接 PRAGMA 拆分、失败全回滚、build copy 与 cleanup 均符合 Plan。
- D01-T02 合并：Lead 以 `--no-ff` 将 Architect 批准的 Candidate 合入 local `main`，merge SHA `d5b3202067435de6737765bbafed4c1dbbf00015`。合并后 clean-install 工作区 full verify 再次 exit 0，结果与批准候选一致；未 push，Linux/远程 CI/跨平台仍为 `NOT_RUN`。
- D01-T03 Worker：Agent `451e6624-6ada-40a6-92ed-00c95b0f47ff`，Workspace `wks_01810f4dc9742102`，Worktree `/Users/noahshen/.paseo/worktrees/0eapmc43/d01-t03-transactions-time`，Branch `feat/d01-t03-transactions-time`，Base SHA `1f81584f344859c8f0655ff3883acb8c426c5b38`。Worker 使用 `codex-worker` profile，严格限制在 T03 七个白名单文件；尚未提交、合并或标记 PASS。
- D01-T03 Worker 候选：Commit `47e28686b895e11c5c263fff596cdf0ec391c7d3`，严格新增 Plan 授权的 7 文件 / 776 行，分支 worktree clean。Worker 报告 UTC 与 Asia/Shanghai 定向测试均 4 files / 10 tests，full verify 19 files / 80 tests 通过；首次 full verify 仅因受限 `listen EPERM` 失败，获批重跑通过。
- D01-T03 Lead 独立复核：clean `npm ci` 为 93 packages；UTC 与 Asia/Shanghai 定向均 4 files / 10 tests，full `npm run verify` 最终 exit 0，19 files / 80 tests、两次 build、5 项 process smoke、database smoke、57 文件格式检查全通过。独立锁进程 PID `76425` / `76451` 均观察到 attempting→释放→success，退出码 0；源码/测试范围仅 7 文件，无 TODO/skip/only、`@ts-ignore`、trigger、CURRENT_TIMESTAMP 或 dist 单测依赖。Lead 结论 `APPROVED_FOR_ARCHITECT_REVIEW`，尚未合并或标记 PASS。
- D01-T03 Architect 复核：明确裁决 `APPROVED`，Candidate `47e28686b895e11c5c263fff596cdf0ec391c7d3` 可合并，无 BLOCKER。Architect 独立双 TZ 定向各 4 files / 10 tests，锁 PID `79290` / `79417` 正常；四个专用类型负例移除抑制后均为 TS2345，证明 async、Promise、显式 union、条件混合 union 在调用点拒绝。thenable 运行时测试的抑制移除后为外层 `void` 归因的 TS2322，已实际消费且不承担类型拒绝证明，判定为非产品缺陷、非阻塞。
- D01-T03 合并与合并后复验：local `--no-ff` merge commit `5c529e871ad67160f992cebf771a2b3a217a4be0`。合并后 main 重新 clean `npm ci` 93 packages，`npm run verify` exit 0：19 files / 80 tests、typecheck、两次 build、5 项 process smoke（端口 `61666` / `61753`）、database smoke、57 文件格式检查全通过。T03 标记 `PASS`；DB-09 仅基础事务、DB-10 TEXT 基础、DB-12 busy/分类基础，六业务阶段故障注入与 Runtime 重试仍 `NOT_RUN`。
- D01-T04 Worker：Agent `f403be79-6d10-42f4-8f29-18cb0bd9d96d`，Workspace `wks_de4991969e47a6d1`，Worktree `/Users/noahshen/.paseo/worktrees/0eapmc43/feat-d01-t04-event-fts`，Branch `feat/d01-t04-event-fts`，Base SHA `cd9212a70ff2c088f6bbaff23f49136061682a1e`。使用 `codex-worker` profile，严格限制为 event-search 实现/测试、faulty DB fixture、README 共 4 个白名单文件；尚未提交、合并或标记 PASS。

| 任务 | 状态 | 实现与测试证据 |
|---|---|---|
| D01-T01 | PASS | base `74e25b6`; work `cec9cf4`; merge `bc57283`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN` |
| D01-T02 | PASS | base `d3ad3a4`; work `e444036`; merge `d5b3202`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN` |
| D01-T03 | PASS | base `1f81584`; work `47e2868`; merge `5c529e8`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN`；DB-09/10/12 仅接受本卡基础范围 |
| D01-T04 | IN_PROGRESS | 唯一 Worker 已启动；Event FTS 确定性聚合、增量刷新、全量重建和故障回滚尚未提交 |

## 下一步

T03 已按 Lead 独立验证、Architect `APPROVED`、local merge、合并后 full verify 顺序完成。T04 唯一 Worker 正在实现 Event FTS 白名单；心跳保持停止，不 push。
