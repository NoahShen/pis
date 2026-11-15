# D00 Progress

更新时间：2026-11-15。

## 当前基线与门禁

- Architect：独立审核方；已于 2026-11-15 完成 v0.3 的 G3 复核。
- 项目开发规范 v0.1：APPROVED，批准记录见 `../../project-development.md` §8。
- Intent v0.1：APPROVED，项目负责人于 2026-11-15 通过 G1。
- Spec v0.1：APPROVED，Architect 于 2026-11-15 完成 G2 复核，见 `spec.md` §9。
- Plan v0.3：`APPROVED`，Architect 独立 G3 复核通过；用户已于 2026-11-15 明确确认“按这份 Plan 启动 D00 开发”。
- G3 记录更正：Architect Round 1 的真实结论为 `CHANGES_REQUIRED`；v0.2 中所谓“Architect 第 2 轮复核”实为 Lead 自查，已撤销错误归因。
- Git：`origin` 为 `git@github.com:NoahShen/pis.git`；本地 `main` 文档基线为 `e708f65f852ceb10472ee04140470c0c99bcb384`，T01 集成 merge 为 `9c3b886d25224205dc383ffba1d1d7cd838028b0`，T02 集成 merge 为 `d8172e39da5356cadfd40e6a806ccdbbdc74aa2b`，尚未推送。
- Lead：已委派 `5904a3c3-e232-4f7b-b675-929f9ddac3fb`。
- T01 Worker：`4fe4ad6f-9495-45da-a47d-6526cf8f8304`，已通过 Paseo `codex-worker` profile 完成实现并回报 REVIEW 证据。
- T02 Worker：`a2960bcf-2df0-4e8a-a6bc-f3e80ea8f727`，已通过 Paseo `codex-worker` profile 完成实现并回报 REVIEW 证据；Lead 独立审核无 BLOCKER，Architect 已批准并合入本地 `main`。
- T03 Worker：`909ce093-9a1a-4986-98b5-5725a45381b1`，已通过 Paseo `codex-worker` profile 在独立工作区启动；不复用 T01/T02 Worker。
- `USER_CONFIRMATION`：`APPROVED`（2026-11-15）。
- 项目外工具链：`/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64`。从 `nodejs.org` 官方下载 `node-v26.13.1-darwin-arm64.tar.xz`，实际 SHA-256 为 `af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559`；实测 Node `v26.13.1`、npm `11.20.0`，未修改系统默认（仍为 Node `v26.7.0`、npm `12.0.2`）。
- T01 隔离工作区：`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t01-typescript-bootstrap`；branch `d00-t01-typescript-bootstrap`；base `e708f65f852ceb10472ee04140470c0c99bcb384`；task commit `8a18ded8d9c409c9a9462cf5b54310b0dc80be27`；merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0`。
- T02 隔离工作区：workspace `wks_e0c1d33b7f583305`；`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t02-deterministic-test-facilities`；branch `d00-t02-deterministic-test-facilities`；base `ed5ebb006b109261624c8c68829166cbd97c6852`；task commit `47a138f5f1285c34af038dfd59eb521b75d3cf5f`；merge commit `d8172e39da5356cadfd40e6a806ccdbbdc74aa2b`。
- T03 隔离工作区：workspace `wks_ae6cb03545d25b12`；`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t03-fastify-server-lifecycle`；branch `d00-t03-fastify-server-lifecycle`；base `d13aa340bbb40617a4617bcea92df8a25f2211ac`；初始 task commit `0b60d214e44ee4105a4c700230c31b7d36a32251`；已批准 review-fix commit `09368ceee86ea480aab9101f8cdd6ea1f9fee957`；merge commit `14cc5d59cfc914cef83df5c791db70561e6e55a3`。
- T04 隔离工作区：workspace `wks_99e8875665327b35`；`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t04-verification-ci-readme`；branch `d00-t04-verification-ci-readme`；base `c0856178048b5faba370ba2c3d71a2fa9954ae42`；Worker `54587538-09e7-40dd-a630-2b97972d5b40`。

| 任务 ID | 状态 | 基线/提交 | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D00-T01 | PASS | base `e708f65f852ceb10472ee04140470c0c99bcb384`; work `8a18ded8d9c409c9a9462cf5b54310b0dc80be27`; merge `9c3b886d25224205dc383ffba1d1d7cd838028b0` | Lead 定向验证通过；后续任务设施 NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | APPROVED | 已合入本地 main；未推送 |
| D00-T02 | PASS | base `ed5ebb006b109261624c8c68829166cbd97c6852`; work `47a138f5f1285c34af038dfd59eb521b75d3cf5f`; merge `d8172e39da5356cadfd40e6a806ccdbbdc74aa2b` | Lead 独立审核与 Architect 复核通过：typecheck、全量测试、双 TZ、shuffle repeat、build、ESM import 均通过；后续 smoke/CI NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | APPROVED | 已合入本地 main；未推送 |
| D00-T03 | PASS | base `d13aa340bbb40617a4617bcea92df8a25f2211ac`; work `09368ceee86ea480aab9101f8cdd6ea1f9fee957`; merge `14cc5d59cfc914cef83df5c791db70561e6e55a3` | Lead 独立审核、Architect 复核及合并树复验通过：typecheck、10 文件/44 测试、build、真实信号/端口/超时 smoke 通过；format/CI NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | APPROVED | 已合入本地 main；未推送 |
| D00-T04 | IN_PROGRESS | base `c0856178048b5faba370ba2c3d71a2fa9954ae42` | RUNNING | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | — | Worker `54587538-09e7-40dd-a630-2b97972d5b40` 执行；仅 T04 format/README/CI/verify 范围 |

## 待处理事项

- T01 已由 Architect 批准并以 merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0` 合入本地 `main`；项目外精确工具链已落实。
- T02 `47a138f5f1285c34af038dfd59eb521b75d3cf5f` 已由 Lead 独立审核、Architect 复核批准，并以 merge commit `d8172e39da5356cadfd40e6a806ccdbbdc74aa2b` 合入本地 `main`。
- T03 `09368ce` 已由 Lead 独立审核、Architect 复核批准，并以 merge commit `14cc5d59cfc914cef83df5c791db70561e6e55a3` 合入本地 `main`；合并树复验通过，未推送。
- T04 已从 T03 完成后的 main `c0856178048b5faba370ba2c3d71a2fa9954ae42` 建立独立 branch/worktree，准备使用新的 Paseo Worker 执行。
- Prompt 实际目录 `config/prompt/` 与设计约定 `config/prompts/` 不一致；最迟 D02-T01 前对齐，当前不阻塞 D00。

## 下一可执行步骤

将 T04 派发提交写入 `main` 后，创建新的 Paseo Worker，从 `c0856178048b5faba370ba2c3d71a2fa9954ae42` 执行 format、README、聚合 verify 与 CI 配置；T04 完成后由 Lead 审核并交 Architect 复核，不自行标最终 PASS。

## 验证证据

### 工具链

- 官方 archive：`node-v26.13.1-darwin-arm64.tar.xz`，重新下载并以官方 `SHASUMS256.txt` 校验，SHA-256 为 `af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559`。
- 隔离路径：`/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64`；实测 Node `v26.13.1`、npm `11.20.0`。系统默认仍为 Node `v26.7.0`、npm `12.0.2`，未修改。
- `scripts/verify-toolchain.mjs` 在 PATH 不含 Node/npm 时仍从当前 Node 安装前缀定位 npm `11.20.0` 并成功校验。

### D00-T01 Lead 独立验证

- 变更范围：10 个文件，全部属于 T01 允许清单；`git diff --cached --check` 通过；任务 commit 后 worktree clean。
- 直接依赖仅 `typescript@7.0.2`、`@types/node@26.6.6`；`npm ls --depth=0` 无额外顶层包；锁文件直接依赖 exact，package entries 无 install script。
- `npm install --package-lock-only` 退出 0，命令前后 `package-lock.json` SHA-256 均为 `6475a12e30fcd1f966240fcd17fd9afea72b02be8954c6491ae7ea2ca6604ec7`。
- `npm ci` 退出 0：`added 4 packages`、`audited 5 packages`、`0 vulnerabilities`。
- `npm run typecheck` 退出 0，无诊断输出。
- `npm run build` 连续两次退出 0；第二次前放置的 stale 标记被 clean 删除；最终 `dist` 仅含 `dist/version.js`。
- ESM 动态导入 `dist/version.js` 退出 0，实测 `APP_VERSION=0.1.0`。
- `scripts/clean.mjs` 与 `scripts/verify-toolchain.mjs` 的 `node --check` 均退出 0。

### D00-T02 Lead 独立验证

- 变更范围：17 个文件，全部属于 T02 允许清单；任务 commit `47a138f5f1285c34af038dfd59eb521b75d3cf5f` 的父提交为 base `ed5ebb006b109261624c8c68829166cbd97c6852`；commit 后 worktree clean；`git diff --check HEAD^ HEAD` 通过。
- 唯一新增直接依赖为 `vitest@5.1.0`；`npm ls --depth=0` 仅 `@types/node@26.6.6`、`typescript@7.0.2`、`vitest@5.1.0`。T01 既有 24 个 lock package entries 零缺失，version/resolved/integrity 零变化；新增 67 个必要 transitive entries。
- `npm install --package-lock-only` 退出 0；前后 `package-lock.json` SHA-256 均为 `8aa42532a5efeb957ca50e5e5eeb67675afdf559994f943042fa777cff4d2d3f`。
- `npm ci` 退出 0：`added 40 packages`、`audited 41 packages`、`0 vulnerabilities`。`fsevents@2.3.3` 仅由 `vite@8.3.8` 作为 macOS optional peer 引入；npm 报告其 install script 未纳入 allowScripts，未执行该脚本，不影响本次测试。
- `npm run typecheck` 退出 0，覆盖 src、tests 与 `vitest.config.ts`；无诊断。
- `npm test` 退出 0：5 个测试文件、9 个测试；使用 seed `20251115` 随机顺序连续运行两次，均为 5/5 文件、9/9 测试通过，无共享状态失败。
- `TZ=UTC` 与 `TZ=Asia/Shanghai` 的 Plan 指定测试矩阵均退出 0：各 5 个测试文件、9 个测试通过；固定 +08:00 输出在普通、UTC 跨日、跨月、跨年边界一致。
- Plan 指定的九个可定位 Case 名称均逐字存在并通过；Clock/FakeClock 覆盖 defensive Date、显式推进；ID 覆盖精确序列、持续耗尽失败和 Node `randomUUID` 委托；临时目录覆盖成功/失败清理与原异常重抛。
- `npm run build` 退出 0；`dist` 仅含 `dist/id/crypto-id-generator.js`、`dist/id/id-generator.js`、`dist/time/clock.js`、`dist/time/format-time.js`、`dist/time/system-clock.js`、`dist/version.js`，不含 tests、fixtures 或测试配置。
- Node ESM 直接导入全部生产产物退出 0：`APP_VERSION=0.1.0`，`formatTimestamp(2025-03-10T18:30:00.000Z)=2025-03-11T02:30:00.000+08:00`，连续 UUID 为字符串且不同，SystemClock 返回 Date。

### D00-T02 Architect 复核

- 日期：2026-11-15；结论：APPROVED；目标 commit：`47a138f5f1285c34af038dfd59eb521b75d3cf5f`。
- 依据：Spec §3 / Plan T02。检查生产接口、实现、全部新增测试及 TS/Vitest 配置差异，对照 Lead 独立验证和锁文件核验记录；Clock/ID 注入、固定偏移时间、临时目录清理与构建隔离符合范围，无 BLOCKER。
- 已有 5 文件/9 测试、双 TZ、重复执行、类型检查及构建证据充分，复核未重复执行相同命令。批准 Lead 合并，实际合并前保持 REVIEW；下一任务为 T03，smoke/CI 仍 NOT_RUN。
- Lead 以 `--no-ff` merge commit `d8172e39da5356cadfd40e6a806ccdbbdc74aa2b` 合入 `47a138f`；父提交为 `3f49652155c26282a2346703abfe3a321e6abdb9` 与 `47a138f5f1285c34af038dfd59eb521b75d3cf5f`，仅引入已批准的 17 个 T02 文件。

### D00-T03 Lead 独立审核

- 日期：2026-11-15；环境：Node `v26.13.1`、npm `11.20.0`、Darwin arm64；唯一待审提交：`09368ceee86ea480aab9101f8cdd6ea1f9fee957`（父提交 `0b60d214e44ee4105a4c700230c31b7d36a32251`）；base `d13aa340bbb40617a4617bcea92df8a25f2211ac` 是 task commit 祖先。
- 变更范围：16 个路径全部属于 T03 允许清单；`git diff --check` 通过；commit 后 worktree clean。直接依赖实测仅为 `fastify@5.12.8`、`pino@10.4.0`、`zod@4.6.7`，未夹带其他直接依赖。
- `npm install --package-lock-only` 与 `npm ci` 均退出 0；`npm ci` 前后 `package-lock.json` SHA-256 均为 `1a78aad2ef9ab1dc7a5eabba2eafb30a37aa1e55cd6c84bfc3bcf4ed50126c07`。npm 仅提示 `fsevents@2.3.3` 的 install script 未纳入 allowScripts，未执行该脚本，不影响本次审核。
- `npm run typecheck` 退出 0；Plan 的 21 个可定位测试名称已逐字核对，全部存在。
- `npm test -- tests/config.test.ts tests/auth.test.ts tests/app.test.ts tests/logger.test.ts tests/lifecycle.test.ts --repeats 5` 退出 0：5 文件/35 测试通过；`npm test -- --repeats 5` 退出 0：10 文件/44 测试通过；固定 shuffle seed `17`、`43`、`101` 各自全量通过。
- `npm run build` 退出 0；`dist` 仅含生产模块，不含 tests/fixtures/测试配置；Node ESM 导入 `dist/server.js` 成功且未启动监听。`npm run smoke` 退出 0：SIGINT 与 SIGTERM 均自然退出 0、捕获 `shutdown closed/forced:false` 并释放实际端口；占用端口产生有界 listen failure；悬挂 close 在 5 秒预算后以 code 1 退出且 `signal === null`。
- 上一轮 BLOCKER 已闭合：`tests/fixtures/forced-exit-entry.mjs` 从编译后的 `dist/server.js` 导入并调用 `main`，未注入 `forceExit`，因此 smoke 覆盖真实默认强制退出路径；`close failure resolves forced code one and production main calls default force exit` 同时直接验证 close 拒绝后的默认 `process.exit(1)`。
- Lead 结论：`APPROVED`，无 BLOCKER；批准进入 Architect 独立复核。复核批准前不合并，不将本记录视为 Architect 结论。
- 当时 NOT_RUN：Architect 复核、merge、push、远程 CI、T04 format/aggregate verify；非 Linux/Windows 平台运行未执行。Architect 复核与 merge 随后已完成，见下一条。

### D00-T03 Architect 独立复核

- 日期：2026-11-15；结论：APPROVED；唯一批准代码：`09368ceee86ea480aab9101f8cdd6ea1f9fee957`。无 BLOCKER。
- 审查范围：配置/鉴权/HTTP/日志/生命周期、真实进程 smoke、测试与依赖变更，依据 Spec §4/§5 与 Plan T03；对 Lead 审核记录和 Worker 自述作区分。
- 生产鉴权使用 raw header 数量及严格单 Bearer 值校验；配置字段/范围校验，请求与生命周期日志仅输出白名单字段。关闭为单次操作，close/flush 共享 5 秒预算，正常退出自然结束，异常结果进入默认 `process.exit(1)`；模块导入无启动副作用。
- 前一轮 fixture BLOCKER 闭合：`forced-exit-entry.mjs` 经编译后的 `dist/server.js` 调用生产 `main`，未注入 `forceExit`，真实悬挂 close 在预算后由进程自身退出 1。
- Architect 在任务分支上实测 `npm run typecheck`、`npm test`、`npm run smoke`：typecheck 退出 0；10 文件/44 测试通过；SIGINT/SIGTERM 自然退出 0 并释放端口，监听失败非零退出，悬挂关闭 5 秒自退 1、无外部强杀，敏感 sentinel 无输出。构建与真实 smoke 由 `npm run smoke` 执行。
- 批准 Lead 合并及后续 T04 派发；T04、format/aggregate verify、远程 CI 仍 NOT_RUN。首次误在未安装依赖的主工作区运行 typecheck 失败，随后以绝对路径进入任务 worktree 完成有效验证；主工作区失败不是 T03 代码诊断。
- Lead 先提交 Architect progress 记录 `332e6e1e605d1225e5a3a9c353274140c725a66c`，再以 `--no-ff` merge commit `14cc5d59cfc914cef83df5c791db70561e6e55a3` 合入已批准的 `09368ce`；父提交为 `332e6e1e605d1225e5a3a9c353274140c725a66c` 与 `09368ceee86ea480aab9101f8cdd6ea1f9fee957`，仅引入审核过的 16 个 T03 文件。
- 合并树相对 `09368ce` 仅多 progress 文档，生产代码无差异。主工作区按锁文件 `npm ci` 后，`npm run typecheck`、`npm test`（10 文件/44 测试）、`npm run build`、`npm run smoke` 均退出 0；首次因主工作区尚未安装依赖而 typecheck 失败，安装后重跑通过，不构成代码诊断。T03 标记 PASS。

### 限制与未执行项

- 本机仅实测 darwin-arm64；`scripts/verify-toolchain.mjs` 的 Windows 路径分支为代码审阅，未实际运行。
- T03 smoke 与合并树验证已通过；format 检查、聚合 verify、T04 与远程 CI 仍为 NOT_RUN，按 Plan 分别属于 T04 和后续 CI 阶段。
- Plan/Spec 未明确 `package.json#name`；T01 使用 `pis`，作为非阻塞事实交 Architect 在复核时确认。
- Architect 对 D00-T01 `8a18ded` 的设计一致性复核：APPROVED（2026-11-15）。检查全部 10 个文件差异、依赖锁文件及 Lead 验证证据：strict/NodeNext、纯生产构建、版本约束及最小依赖均符合 Spec/Plan，无 BLOCKER。`package.json#name=pis` 属于范围内的常规命名，认可。复核未重复运行已通过的命令；跨平台运行和后续任务测试仍为 NOT_RUN。
- T01 merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0` 以 `--no-ff` 建立，Architect 审核记录 commit `a29baa5` 保留在 `main` 历史中；merge 仅引入 T01 的 10 个已审核文件。
