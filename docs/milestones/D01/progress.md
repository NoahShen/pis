# D01 Progress

## 当前状态

- 最新远程验收：D01 最终提交 `5bf17f5b2b21783746b7d1144a1212e73aa24847` 已按负责人授权推送至 origin/main；[GitHub Actions #43716255990](https://github.com/NoahShen/pis/actions/runs/43716255990) 整体 Success，verify 作业通过。D01 ubuntu-latest CI 更新为 PASS；下文 NOT_RUN 为推送前历史状态。未逐行下载远程日志，其他平台不外推。
- 后续阶段：已准备 [D02 Intent](../D02/intent.md)，待负责人 G1 审批；尚未移动 Prompt 或启动 D02 开发。


- 前置：D00 修复后基线 `8f56810` 已确认，已 push，远程 [CI #1](https://github.com/NoahShen/pis/actions/runs/43690265810) 成功。
- Intent v0.1：APPROVED。负责人在措辞修订后明确回复“好的，没问题了，继续下一步”。
- Spec v0.1：APPROVED，Architect 完成 G2，见 [spec.md](spec.md)。
- Plan v0.1：Lead 已提交；Architect G3 结论 `CHANGES_REQUIRED`，要求修正 PromiseLike 类型拒绝、干净检出测试不得依赖未构建 `dist`、同步既有精确工具链事实，并收敛 T02/T04 与重复验证边界。
- Plan v0.2：Architect G3 复审 `APPROVED`；上轮类型约束、构建前测试依赖及文件边界问题已解决。实现与原生兼容性仍未验证，用户执行批准为 `APPROVED`，依据负责人审阅 Plan v0.2 后回复“好的，没问题了，继续下一步”。
- 工具链：精确 Node `26.13.1` / npm `11.20.0` 已存在于 `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`；四卡均在精确工具链下完成依赖安装和验证。
- 任务推进心跳 `335b9883` 在 D01 集成验收完成后已删除；不修改或提交原有 `config/`；当前不 push 后续文档。
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
- D01-T04 Worker 候选：最终 commit `94cf7e3db9ca154130ee988e5613e6107d4d2dc8`，由实现 `0130278`、补强 caller transaction/错误白名单测试 `7bf194e`、补齐未确认 alias fixture `94cf7e3` 三个逐步候选组成。相对 base 只改 4 个白名单文件，+751/−2 行，worktree clean。Worker 报告 UTC/Asia-Shanghai 定向各 1 file / 10 tests、full verify 20 files / 90 tests 通过。
- D01-T04 Lead 独立复核：固定 Node `26.13.1` / npm `11.20.0`；UTC 与 Asia/Shanghai 定向均 1 file / 10 tests，full `npm run verify` exit 0，20 files / 90 tests、两次 build、5 项 process smoke、database smoke、60 文件格式检查全通过。源码/测试仅 4 文件；无 trigger、skip/only、`@ts-ignore`、额外生产 API、LLM 或候选排序。未确认 alias 真实存在于 Contents title/body、但不在确认 alias 表，错误拼接 Contents 文本会导致精确全文失败。
- D01-T04 Architect 复核：首轮判定 `CHANGES_REQUIRED`，唯一 blocker 原“未确认别名”否定断言无实际 fixture、恒真；Worker 以 `94cf7e3` 补齐 Contents 原始候选、确认 alias 表空查询及同一 alias 的索引查询计划后，Architect 最终裁决 `APPROVED`，无 Blocker/Warning，Candidate `94cf7e3` 可合并。
- D01-T04 合并与合并后复验：local `--no-ff` merge commit `618d86a88934a029730217ffe5dd9894d5ce5702`，4 个功能文件与批准候选逐字节一致。合并后 main clean `npm ci` 93 packages、0 vulnerabilities，`npm run verify` exit 0：20 files / 90 tests、typecheck、两次 build、5 项 process smoke（端口 `61870` / `61876`）、database smoke、60 文件格式检查全通过。T04 标记 `PASS`；DB-11、DB-14 仅接受本卡初始范围，业务事务显式调用 FTS 的集成及完整候选召回/排序仍 `NOT_RUN`。
- D01 集成 Gate Lead 验证：基线 `f6667676392f8bd3d26278ca302c6c7d8850ae01` / tree `5e7038355a9936d2d30f6adc0b17edea51277de4`，`git archive` 生成 83 个 tracked files 的独立快照 `/private/tmp/pis-d01-integration.UIczF1/tree`，archive SHA-256 `aa995b8fa94139908d587a4133e93f06d2a74101002d76ce53f9093ab4ef61b5`；初始快照无 `node_modules/dist/coverage/config`。精确 PATH 下 `verify:toolchain=0`（Node `26.13.1` / npm `11.20.0`）、clean `npm ci=0`（93 packages、0 vulnerabilities）、唯一一次 `npm run verify=0`（20 files / 90 tests、两次 build、5 项 process smoke 端口 `56904` / `56907`、database smoke、60 文件格式检查）。
- D01 集成 Gate 数据库/派生边界：UTC 与 Asia/Shanghai 独立聚焦均 `9 files / 33 tests`、exit 0；真实锁进程 UTC PID `13210`（attempted +2 ms、released +52 ms、exit +15 ms）与 Asia/Shanghai PID `13285`（+2 ms、+51 ms、+13 ms）均 awaiting→release→success、exit 0。darwin-arm64（Darwin `25.6.0` / macOS `26.6.2` / Node `26.13.1`）实测；native prebuild 为 Mach-O arm64。compiled probe 得到 12 张非 shadow 表（11 业务 + `event_search` 虚拟 FTS5）、5 张 FTS shadow tables、11 个显式索引、0 个触发器、0 FK 违规，fresh DB 中 Event/Update/Alias/派生索引均 0 行。`src/database/schema.sql` 与 `dist/database/schema.sql` 严格一致（7,213 bytes、SHA-256 `49d4b31e671a9b543010ddd53cfd7c232f8044364795207e8f4182608bcc481b`）；除 `event-search.ts` 外无生产 FTS 调用者，检索 API/候选排序仍属后续。
- D01 集成 Gate tracked/config 审计：验证后快照与 archive reference 排除生成目录后 `diff=0`，`package-lock.json` 未变化、无遗留 DB/WAL/SHM；`cd9212a..f666767` 仅 README、progress、event-search 实现/测试及 faulty fixture，未改 spec/plan/schema 或 tracked config。local main tracked clean，既有 6 个 untracked `config/prompt/*.md` 未进入快照。remote ubuntu-latest CI 与跨平台执行仍 `NOT_RUN`，未 push。Lead 结论 `INTEGRATION_REVIEW`，交 Architect 独立复核，不自行宣布整个 D01 `APPROVED`/`PASS`。

- D01 Architect 最终集成验收：`APPROVED`。独立复核四卡批准/merge 链、冻结 DDL 和 Plan 成功标准，在 local main `c7ed56c` 运行精确工具链检查及一次 `npm run verify` exit 0（20 files / 90 tests、两次 build、5 process smoke、compiled database smoke、60 文件格式）；另以 UTC / Asia/Shanghai 分别执行 `tests/database`，各 9 files / 33 tests 通过。本地 darwin-arm64 集成结论只覆盖 D01 范围；remote Linux CI / 其他平台 NOT_RUN，未 push。心跳已完成本轮推进并于验收后删除。
|---|---|---|
| D01-T01 | PASS | base `74e25b6`; work `cec9cf4`; merge `bc57283`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN` |
| D01-T02 | PASS | base `d3ad3a4`; work `e444036`; merge `d5b3202`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN` |
| D01-T03 | PASS | base `1f81584`; work `47e2868`; merge `5c529e8`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN`；DB-09/10/12 仅接受本卡基础范围 |
| D01-T04 | PASS | base `cd9212a`; work `94cf7e3`; merge `618d86a`；Lead 独立复验与 Architect `APPROVED`；darwin-arm64 实测通过，Linux/跨平台 `NOT_RUN`；DB-11/14 仅接受本卡初始范围 |
| D01 集成 Gate | PASS | 功能基线 `f666767`；Lead 干净快照验证及 Architect 独立复验通过；remote CI/跨平台 `NOT_RUN` |
| D01 里程碑 | APPROVED | Architect 最终验收通过；以 `f666767` 为批准功能基线，验收记录基于 `c7ed56c` |

## 下一步

D01 四项任务及 Architect 集成验收均已完成，里程碑为 APPROVED。D01 只覆盖数据库基础，不冒称全业务事务、Runtime 重试、完整检索或跨平台测试已完成；远程 CI 待后续 push 时验证。等待项目负责人决定是否启动下一里程碑，不自动扩大开发范围。
