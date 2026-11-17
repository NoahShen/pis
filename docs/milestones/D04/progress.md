# D04 Progress

## 当前门禁

- 当前门禁：Plan v0.4 `APPROVED · G3 PASS`；负责人已明确批准执行：“按 Plan v0.4 开始执行”。
- 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，远程 CI Success，D03 心跳已删除，遗留 Worker 工作区已收尾并归档。
- D04 Intent：`APPROVED · G1 PASS`。负责人确认全文/摘要判定，并明确 RSS 仅为一种实现；财经资讯抓取 API Adapter 延期至 V1 全流程走通后另立里程碑。
- D04 Spec v0.1：`APPROVED · G2 PASS`。本里程碑不修改 Spec/Intent。
- D04 Plan：v0.1～v0.3 为历史未批准稿；v0.4 经 Architect 复核四项修订后为 `APPROVED · G3 PASS`。`USER_EXECUTION_APPROVAL=APPROVED`；授权范围为 T01～T03 按 Plan 串行实施，不包含 D04 push。
- D04-T01：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；已从 Architect 批准的精确 tree 创建 candidate 并完成 main `--no-ff` merge，13 路径写集、patch 与 blob 均保持一致。合并后定向/full verify 全部通过；Worker 无唯一未提交成果，工作区归档和目录移除已核验。
- D04-T02：`IN_PROGRESS`；已在全新 Paseo 会话从 T01 PASS 后的 main `d3970ae753bfd241515935bcc2640b8792b46230` 创建独立 worktree 和 Worker，严格限定 Plan §6 的 11 路径写集，尚未 stage/commit/merge。D04-T03：`NOT_STARTED`，仅在 T02 PASS 并归档后串行启动。
- D04 本地测试：`PASS`（frozen tree `bcc6d9d1fe4a306e440e70c6ad7088c7e78da503`；local merge `f8ff76230779c4e2444d1a3e2568d9431b42d123`）。远程 CI：`NOT_RUN`；最终验收：`NOT_ISSUED`。

## Lead 执行身份与恢复记录

- 当前唯一 D04 Lead：`fd8b48f8-2292-4092-8219-b51a03293bab`（Architect 于 2026-11-17 指定）。
- Server：`srv_rWwNLOnyU5IK`；Workspace：`wks_8d25a71ed3ca78af`，主工作区 `/Users/noahshen/workspace/pis`。
- 恢复原因：旧 Lead `b32354fa-d47e-45d5-90ba-84554fd09cdb` 已归档，上游报告旧会话上下文约 134 万 token、超过 105 万窗口且近期发生角色混淆；禁止加载旧会话全文或长日志，恢复到基于实际 Git/diff、批准文档和短证据的独立审核。
- 恢复基线：main `9b7e27e49b479875ddc66b783bc23f242d14031b`、工作区 clean；T01 工作树固定于 base `7218d74f8da376d92d7b36798a40f93d218d8b52`。
- 原 T01 Worker 保留且不重派；已确认其未 commit/push/merge，并冻结 13 个白名单文件变更等待独立复核。
- 首轮 Lead 复核未通过：接受新 Lead 指令的正是原 T01 Worker；纠正项均限于现有白名单文件，禁止借此新增依赖或启动 T02。

## D04-T01 执行记录

- Worker Agent：`c1fe5080-e7ac-44c1-8dd4-916763b1dafd`；profile `codex-worker`，mode `auto-review`，thinking `high`。
- Workspace：`wks_2f570238f5eb4a0c`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-t01-contracts-rss-list`。
- Branch：`feat/d04-t01-contracts-rss-list`；固定 base/初始 HEAD：`7218d74f8da376d92d7b36798a40f93d218d8b52`。
- 该 Worker 只允许 Plan §5 的 T01 写集；保持未提交 `REVIEW` 交接，不得 stage/commit/merge/push。Worker 自报 typecheck、84 项定向测试、33 文件/275 项 full verify、verify/diff-check/npm ls 通过；该摘要不构成 Lead 或 Architect 验收，待独立复核。
- Rework 后 Lead 复核：三文件定向 **95 tests passed**，full verify **33 files / 286 tests passed**，build、SIGINT/SIGTERM/资源清理 smoke、database smoke 与 format check 通过；pinned `npm ls --depth=0` 为 11 项且无 missing/extraneous。
- 首轮冻结（Architect `CHANGES_REQUIRED`，已作废）：base `7218d74f8da376d92d7b36798a40f93d218d8b52`；tree `ee53ff73039af064c5a6d14d3089a38282f60faa`；`git diff --binary --full-index --no-ext-diff` 的 patch SHA-256 `93b813e7111a209bab2c7c4b56b0caaa8963d6ed2852860425a464175f6e5edc`。写集为 package 两文件、7 个 `src/adapters` 文件、3 个 adapter tests 与 1 个 RSS fixture，共 13 路径；`fast-xml-parser@5.12.1` 为唯一新增直接依赖，无 T02/T03 文件。
- Secret 检查仅针对上述冻结 13 路径中的 Git blob 与合成 Fixture，限制为私钥/AWS/GitHub/OpenAI/Slack/Bearer/API key/client secret/access token 高置信模式；命中路径计数为 `0`，未读取 ignored/untracked 私密文件、`node_modules`、数据库或私有目录。
- 第二轮冻结（当前有效）：base `7218d74f8da376d92d7b36798a40f93d218d8b52`；tree `bcc6d9d1fe4a306e440e70c6ad7088c7e78da503`；`git diff --binary --full-index --no-ext-diff` 的 patch SHA-256 `259f29f1f5246b1c3d8eae08227ce0fcd548f5881c77a6906a795898e59ddcb6`。仍为 13 路径；复冻结 tree 与 patch 均逐字匹配。
- Clean snapshot 独立复核：从第二轮冻结 tree 生成无 `.git`/`node_modules` 的归档，执行 `npm ci --offline` 得到 102 个 package、0 vulnerabilities；随后用 Node 26.13.1/npm 11.20.0 执行 full verify，`33/33` test files、`290/290` tests、build、SIGINT/SIGTERM/resource smoke、database smoke 与 100 文件 format check 全部通过。目标 adapter 三文件为 `99/99` tests；取消竞态定向 `3/3` tests；日期/Atom/CDATA/非法 XML/时区定向 `5/5` tests。
- 第二轮 13 路径高置信 secret 模式命中路径计数为 `0`；`git diff-tree --check` 无 whitespace error。Worker 未 stage/commit/merge/push，Lead 未创建 candidate，也未启动 T02。

## G3 CHANGES_REQUIRED 修订记录

1. 默认 HTTP transport 改为每个逻辑 feed/article 请求按该次 `callSignal` 新建，adapter 只共享不可变 policy/factory，不缓存首次绑定的 transport。补同一实例连续两次取消、首次取消后下一次成功、并行 A abort/B success 的 Factory/Controller/Agent/socket 隔离测试。
2. Secret 检查限定为本卡 Git tracked 变更与明确列出的合成 Fixture；禁止读取 ignored/untracked 私有配置、Prompt/user-context、`node_modules`、数据库或私有目录。证据只报路径/计数，不输出正文；错误泄漏要求只聚焦真实/敏感 URL，保留正常合成 Fixture 断言。
3. 每卡补 Worker 收尾：candidate↔merge 逐文件 blob 对照、branch/candidate 对齐、唯一未提交成果与旧 progress 单独处置、确认 clean、通过 Paseo `archive_workspace` 记录 success；主工作区不可归档，旧文档不得覆盖 main。
4. 正文处理顺序改为“原始 DOM 解析 → restricted JSON-LD/itemprop 检测 → 移除 script/清理 DOM → Readability”，并用完整 `fetchContent` 调用链验证含 JSON-LD 的付费信号不会因提前删 script 丢失。

## 下一步

T01 已完整收尾；在后续新会话派发 T02，严格遵循已批准 Plan 和既有门禁。不 push、不新增心跳。

## D04-T01 Lead 第二轮复核记录

- 复核对象为原 Worker 在同一白名单写集内的修复：post-registration aborted 分支删除 listener、拒绝既有 abort promise 并在 `startRequest` 前返回；确定性 Proxy signal 覆盖 aborted 三次读取由 false/false/true 的窗口。
- 第二轮冻结 tree `bcc6d9d1fe4a306e440e70c6ad7088c7e78da503` 与 patch SHA-256 `259f29f1f5246b1c3d8eae08227ce0fcd548f5881c77a6906a795898e59ddcb6` 一致；base 仍为 `7218d74f8da376d92d7b36798a40f93d218d8b52`，写集仍为 package 两文件、7 个 `src/adapters` 文件、3 个 adapter tests 与 1 个 RSS fixture。
- Clean snapshot `npm ci --offline`、full verify 及定向回归全部通过；证据只覆盖合成 Fixture 和已冻结 Git tree。T01 仍未 `PASS`，未创建 candidate，未请求真实互联网，也未进入 T02/T03。

## D04-T01 Architect 第二轮批准记录

- Architect 独立运行 typecheck、adapter 三文件 `99/99` tests 与 build；三个原始失败探针（同步 abort + 永久 pending、无 weekday GMT、Atom 字面量 `<b>`）均确认修复，并审阅晚 reject、CDATA 与 HTML 层级回归。采纳 Lead clean-snapshot full verify `33 files / 290 tests` 及 smoke 证据，未声称 Architect 本轮重跑 full。
- 授权对象严格限定为 tree `bcc6d9d1fe4a306e440e70c6ad7088c7e78da503`、parent/base `7218d74f8da376d92d7b36798a40f93d218d8b52`、canonical full-index binary patch SHA-256 `259f29f1f5246b1c3d8eae08227ce0fcd548f5881c77a6906a795898e59ddcb6` 与 13 白名单路径。
- Architect 通过独立临时 index/object database 和原 objects alternate，从 13 个工作文件重建出相同 tree/patch，解决共享 objects 暂不可直接解析的证据缺口；真实 index 未改。创建 candidate 时必须保证对象可用、全部 13 blob 完全匹配，不得扩写或改动获批源码。

## D04-T01 Candidate、Merge 与 PASS 记录

- 已将完整 tree object closure 导入 local main objects；candidate `a6a12e3a877812666cacde416a65332cfcada08b` 可独立解析，精确 tree 为 `bcc6d9d1fe4a306e440e70c6ad7088c7e78da503`，唯一 parent/base 为 `7218d74f8da376d92d7b36798a40f93d218d8b52`。
- candidate 相对 base 恰 13 路径，canonical full-index binary patch SHA-256 精确为 `259f29f1f5246b1c3d8eae08227ce0fcd548f5881c77a6906a795898e59ddcb6`；13/13 approved-tree blob 与 Worker 工作文件逐字匹配，未扩写或修改获批源码。
- 合并前仅文档批准提交为 `91582488fc389566445e881d39c0bb5e42940fc9`；local main `--no-ff` merge commit 为 `f8ff76230779c4e2444d1a3e2568d9431b42d123`，merge tree 为 `b1c5c0901482b1412fe720402e407238be2634a2`。第一/第二 parent 分别为批准记录与 candidate；第一 parent 到 merge 恰 13 路径，patch SHA-256 仍精确一致，candidate/merge/worktree blob 为 13/13 匹配。
- 合并后以精确 Node `26.13.1` / npm `11.20.0` 执行 `npm ci --offline`：102 packages、0 vulnerabilities；adapter 定向 `3/3` 文件、`99/99` tests；完整 `npm run verify` 为 `33/33` 文件、`290/290` tests，typecheck、build、SIGINT/SIGTERM/占用端口/forced-close/late-listen smoke、Source+Topic 跨重启持久化、database smoke 与 `100` 文件格式检查全部通过。
- `npm ls --all` 退出 `0`；merge tree 与 13 路径 patch 复算一致，`git diff-tree --check` 通过，工作树 clean，默认 `data/` 目录与仓库内 SQLite/WAL/SHM 均不存在。`T01_STATUS=PASS · LOCAL_MERGE_VERIFIED`；`T01_REMOTE_CI=NOT_RUN`；未 push，最终验收尚未签发。
- Worker branch tip 精确等于 candidate parent `7218d74f8da376d92d7b36798a40f93d218d8b52`；归档前未暂存路径集合与 candidate 13 路径精确相同，staged entries 为 `0`，13/13 工作文件 blob 与 candidate 完全匹配，唯一未提交成果为 `0`。
- Paseo `archive_workspace` 返回 `workspaceId=wks_2f570238f5eb4a0c`、`archivedAgentIds=[c1fe5080-e7ac-44c1-8dd4-916763b1dafd]`、`removedDirectory=true`。复核 active workspace 列表已无该 workspace，Worker agent 为 closed/archived，原 worktree 路径已不存在；归档前 main 于 PASS 记录提交 `f4497ecc43c6fa411304cd42363671b40b6c5d5c` clean，candidate object 仍可在 local main objects 解析。

## D04-T02 执行记录

- Worker Agent：`e5a27406-fedf-4d6a-a6b0-c31476b2b0bc`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、thinking `high`），已严格限定为 single-task 实现和 `REVIEW`/`BLOCKED` 交回。
- Workspace：`wks_21f5659a79f35681`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-t02-content-extraction`；Branch：`feat/d04-t02-content-extraction`。
- 固定 base/初始 HEAD：`d3970ae753bfd241515935bcc2640b8792b46230`；tree `4e3995c5b24753a771948bbc237ce257a993918e`，与 local main 一致，worktree clean。Worker 尚未产生提交或改变固定 base。

## D04-T01 Architect G4 审核记录

- Architect 已确认首轮 13 个文件 blob、tree `ee53ff73039af064c5a6d14d3089a38282f60faa` 与 full-index patch `93b813e7111a209bab2c7c4b56b0caaa8963d6ed2852860425a464175f6e5edc` 一致；独立 typecheck、3 文件 95 tests 与 build 通过。
- 结论 `CHANGES_REQUIRED`：`raceWithAbort` 在 transport 调用后才监听 signal，同步 abort + 永久 pending 不能有限终止；RFC822 regex 错误要求 weekday；Atom HTML 在 XML 解码后再次解码并去标签，导致合法字面量丢失。必须补同步 abort+永久 pending/late reject、无 weekday GMT/数值 offset、Atom title/content/summary 嵌套实体/CDATA 回归。
- 首轮 tree 不形成 candidate，真实 index 仍为空、HEAD 仍为 base；Architect 明确未授权 candidate 或 merge，已退回原 Worker 在同一白名单内修复。

## Architect G3 审核记录

- 审核候选：`83e307b8ceef028a5a1106d57e5ef4451dddf25a`；tree：`c5a6dc4ad3e96c4a54252fbcf037a3a58fe70467`；parent 与 Spec 基线 `b87594a742f4440eaf49a5daeac74bd2ca622e51` 一致。
- Architect 独立检查四项阻塞修复、Spec 一致性、仅两文档写集、worktree clean 与 diff-check；结论 `APPROVED`。取消信号/连接隔离、原始 DOM 限制信号检测、受限隐私扫描与逐卡归档均有明确验证要求。
- main 已以 fast-forward 整合候选；仅文档，无需重跑生产测试。npm 安装、互操作测试与 full verify 均未在本轮运行。
- 本记录为计划批准，不代表实现通过或执行授权；后续按负责人决定进入开发。

## 证据边界

T01 Lead 复核阶段只更新本 Progress；Worker 分支独立承载生产候选，不得覆盖 main 的 Progress。全部证据以 Worker 收据、隔离 tree/patch、实际 diff 和 Lead 复核命令为准。未请求真实互联网，不读取或复制 User Context/私密配置；Architect G4 结论仍待签发。

## 历史 G2 审核记录

- Architect 已对照 Intent、技术设计 §2.3/2.4/10.1、任务卡及 COL 组件用例完成 Spec 一致性复核，结论 APPROVED。
- 全文判定明确区分 SOURCE_DECLARED 与 ARTICLE_EXTRACTED；description/summary 不因长度升级，受限片段/HTTP 206 不当作全文。
- 原生 fetch 的 DNS 结果固定至连接，redirect 每跳重新校验；不存在生产 allowPrivate 开关。
- 财经 API Adapter 延期；通用接口不依赖 XML/DOM，当前不扩充 Source.type。
- Spec 已固定默认预算、内容大小、编码范围及依赖版本；兼容性、性能、网络与资源清理均须在任务实现时验证。
- Worker 未派发，无 D04 push 或开发执行授权。
