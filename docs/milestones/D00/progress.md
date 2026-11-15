# D00 Progress

更新时间：2026-11-15。

## 当前基线与门禁

- Architect：独立审核方；已于 2026-11-15 完成 v0.3 的 G3 复核。
- 项目开发规范 v0.1：APPROVED，批准记录见 `../../project-development.md` §8。
- Intent v0.1：APPROVED，项目负责人于 2026-11-15 通过 G1。
- Spec v0.1：APPROVED，Architect 于 2026-11-15 完成 G2 复核，见 `spec.md` §9。
- Plan v0.3：`APPROVED`，Architect 独立 G3 复核通过；用户已于 2026-11-15 明确确认“按这份 Plan 启动 D00 开发”。
- G3 记录更正：Architect Round 1 的真实结论为 `CHANGES_REQUIRED`；v0.2 中所谓“Architect 第 2 轮复核”实为 Lead 自查，已撤销错误归因。
- Git：`origin` 为 `git@github.com:NoahShen/pis.git`；本地 `main` 文档基线为 `e708f65f852ceb10472ee04140470c0c99bcb384`，T01 集成 merge 为 `9c3b886d25224205dc383ffba1d1d7cd838028b0`，尚未推送。
- Lead：已委派 `5904a3c3-e232-4f7b-b675-929f9ddac3fb`。
- T01 Worker：`4fe4ad6f-9495-45da-a47d-6526cf8f8304`，已通过 Paseo `codex-worker` profile 完成实现并回报 REVIEW 证据。
- T02 Worker：`a2960bcf-2df0-4e8a-a6bc-f3e80ea8f727`，已通过 Paseo `codex-worker` profile 在独立工作区启动；不复用 T01 Worker。
- `USER_CONFIRMATION`：`APPROVED`（2026-11-15）。
- 项目外工具链：`/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64`。从 `nodejs.org` 官方下载 `node-v26.13.1-darwin-arm64.tar.xz`，实际 SHA-256 为 `af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559`；实测 Node `v26.13.1`、npm `11.20.0`，未修改系统默认（仍为 Node `v26.7.0`、npm `12.0.2`）。
- T01 隔离工作区：`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t01-typescript-bootstrap`；branch `d00-t01-typescript-bootstrap`；base `e708f65f852ceb10472ee04140470c0c99bcb384`；task commit `8a18ded8d9c409c9a9462cf5b54310b0dc80be27`；merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0`。
- T02 隔离工作区：workspace `wks_e0c1d33b7f583305`；`/Users/noahshen/.paseo/worktrees/0eapmc43/d00-t02-deterministic-test-facilities`；branch `d00-t02-deterministic-test-facilities`；base `ed5ebb006b109261624c8c68829166cbd97c6852`。

| 任务 ID | 状态 | 基线/提交 | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D00-T01 | PASS | base `e708f65f852ceb10472ee04140470c0c99bcb384`; work `8a18ded8d9c409c9a9462cf5b54310b0dc80be27`; merge `9c3b886d25224205dc383ffba1d1d7cd838028b0` | Lead 定向验证通过；后续任务设施 NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | APPROVED | 已合入本地 main；未推送 |
| D00-T02 | IN_PROGRESS | base `ed5ebb006b109261624c8c68829166cbd97c6852` | RUNNING | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | — | Worker `a2960bcf-2df0-4e8a-a6bc-f3e80ea8f727` 正在独立分支实现 |
| D00-T03 | NOT_STARTED | — | NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | — | 等待门禁及 T02 |
| D00-T04 | NOT_STARTED | — | NOT_RUN | 5904a3c3-e232-4f7b-b675-929f9ddac3fb | — | 等待门禁及 T03 |

## 待处理事项

- T01 已由 Architect 批准并以 merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0` 合入本地 `main`；项目外精确工具链已落实。
- T02 已从包含 T01 merge 的 `ed5ebb006b109261624c8c68829166cbd97c6852` 建立独立 branch/worktree，并由新的 Paseo Worker 执行；旧 T01 Worker 不继续执行。
- Prompt 实际目录 `config/prompt/` 与设计约定 `config/prompts/` 不一致；最迟 D02-T01 前对齐，当前不阻塞 D00。

## 下一可执行步骤

等待 T02 Worker `a2960bcf-2df0-4e8a-a6bc-f3e80ea8f727` 完成或请求权限；收到回调后由 Lead 独立审核，不轮询。T02 完成前保持 T03 `NOT_STARTED`。

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

### 限制与未执行项

- 本机仅实测 darwin-arm64；`scripts/verify-toolchain.mjs` 的 Windows 路径分支为代码审阅，未实际运行。
- `npm test`、Vitest、smoke、format 检查、聚合 verify 与远程 CI 尚未建立或执行，按 Plan 分别属于 T02、T03、T04 和后续 CI 阶段。
- Plan/Spec 未明确 `package.json#name`；T01 使用 `pis`，作为非阻塞事实交 Architect 在复核时确认。
- Architect 对 D00-T01 `8a18ded` 的设计一致性复核：APPROVED（2026-11-15）。检查全部 10 个文件差异、依赖锁文件及 Lead 验证证据：strict/NodeNext、纯生产构建、版本约束及最小依赖均符合 Spec/Plan，无 BLOCKER。`package.json#name=pis` 属于范围内的常规命名，认可。复核未重复运行已通过的命令；跨平台运行和后续任务测试仍为 NOT_RUN。
- T01 merge commit `9c3b886d25224205dc383ffba1d1d7cd838028b0` 以 `--no-ff` 建立，Architect 审核记录 commit `a29baa5` 保留在 `main` 历史中；merge 仅引入 T01 的 10 个已审核文件。
