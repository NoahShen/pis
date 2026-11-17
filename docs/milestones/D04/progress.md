# D04 Progress

## 当前门禁

- 当前门禁：Plan v0.4 `APPROVED · G3 PASS`；负责人已明确批准执行：“按 Plan v0.4 开始执行”。
- 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，远程 CI Success，D03 心跳已删除，遗留 Worker 工作区已收尾并归档。
- D04 Intent：`APPROVED · G1 PASS`。负责人确认全文/摘要判定，并明确 RSS 仅为一种实现；财经资讯抓取 API Adapter 延期至 V1 全流程走通后另立里程碑。
- D04 Spec v0.1：`APPROVED · G2 PASS`。本里程碑不修改 Spec/Intent。
- D04 Plan：v0.1～v0.3 为历史未批准稿；v0.4 经 Architect 复核四项修订后为 `APPROVED · G3 PASS`。`USER_EXECUTION_APPROVAL=APPROVED`；授权范围为 T01～T03 按 Plan 串行实施，不包含 D04 push。
- D04-T01：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；已从 Architect 批准的精确 tree 创建 candidate 并完成 main `--no-ff` merge，13 路径写集、patch 与 blob 均保持一致。合并后定向/full verify 全部通过；Worker 无唯一未提交成果，工作区归档和目录移除已核验。Architect 后续复核发现了归档时 branch tip 未按 Plan 对齐到 candidate 的收尾缺陷；工作区已无引用后已把 branch ref 精确指向 `a6a12e3a877812666cacde416a65332cfcada08b`，生产代码与 main 未变。
- D04-T02：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；Architect 批准的 11 路径 tree 已形成 candidate `b6566b0a60940e3593b84b7d8af29c0e57e4a084`，并以 main `--no-ff` merge commit `19f7973f27a4a78a8f867c64c0823c0e245e5658` 合入。合并后定向 `57/57`、full verify `347/347`、candidate↔merge blob `11/11` 和 Worker 归档均通过。
- D04-T03：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；Architect G4 已批准 tree `aecccde31c1cd2aeca1cc60df816198c43c4f70d`。精确 candidate `16cd09a56daa50b1b88a6325dbee5f02ddf9ce15` 已以 main `--no-ff` merge commit `c44237814a1171bd78f69b7ab4432502807737f7` 合入；合并后定向/full verify、branch/candidate 对齐、Worker/workspace 归档与目录移除均通过。
- D04 本地测试：`PASS`（T03 merge commit `c44237814a1171bd78f69b7ab4432502807737f7`；合并后定向 `3/3` 文件、`175/175` tests，full verify `39/39` 文件、`522/522` tests；干净集成快照同结果）。D04 本地集成 Gate：`PASS`。远程 CI：`NOT_RUN`；最终里程碑验收：`PENDING · FINAL_PASS_NOT_ISSUED`。

## Lead 执行身份与恢复记录

- 当前唯一 D04 Lead：`7f55dda5-ddca-4b75-95da-5935d9236e05`（Architect 于 2026-11-17 指定，接替已归档的 `fd8b48f8-2292-4092-8219-b51a03293bab`）。
- D04 推进心跳：`b31a1236`，`*/10 * * * *`，`Asia/Shanghai`；持续授权已记录于 `docs/project-development.md` §7。本卡不得重复创建心跳；最终验收或负责人停止时删除并核实。
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

T03 已 PASS、合并验证并完成 Worker/workspace 归档；D04 干净 `npm ci --offline` + full verify 本地集成 Gate 已通过。下一步仅交 Architect 做 D04 最终里程碑验收；不 push、不创建新 Agent、不重复 full verify。远程 CI 保持 `NOT_RUN`，`FINAL_PASS` 未签发，心跳 `b31a1236` 保留至最终验收。

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
- 归档时历史观察：Worker branch tip 为 candidate parent `7218d74f8da376d92d7b36798a40f93d218d8b52`，**不满足** Plan 的 branch tip=candidate 收尾要求；当时未暂存路径集合与 candidate 13 路径精确相同，staged entries 为 `0`，13/13 工作文件 blob 与 candidate 完全匹配，唯一未提交成果为 `0`。该缺陷按历史事实保留，不以后续修正覆盖。
- Paseo `archive_workspace` 返回 `workspaceId=wks_2f570238f5eb4a0c`、`archivedAgentIds=[c1fe5080-e7ac-44c1-8dd4-916763b1dafd]`、`removedDirectory=true`。复核 active workspace 列表已无该 workspace，Worker agent 为 closed/archived，原 worktree 路径已不存在；归档前 main 于 PASS 记录提交 `f4497ecc43c6fa411304cd42363671b40b6c5d5c` clean，candidate object 仍可在 local main objects 解析。
- T01 branch 引用收尾纠正：确认 `git worktree list` 中已无 `feat/d04-t01-contracts-rss-list` 引用后，以 compare-and-swap 将 branch ref 从 `7218d74f8da376d92d7b36798a40f93d218d8b52` 更新为已合入 candidate `a6a12e3a877812666cacde416a65332cfcada08b`；复核两者完全相等，main 与生产代码未改变。该操作仅补齐分支引用，不创建提交；后续每卡必须在归档前完成同一对齐。

## D04-T02 执行记录

- Worker Agent：`e5a27406-fedf-4d6a-a6b0-c31476b2b0bc`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、thinking `high`），已严格限定为 single-task 实现和 `REVIEW`/`BLOCKED` 交回。
- Workspace：`wks_21f5659a79f35681`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-t02-content-extraction`；Branch：`feat/d04-t02-content-extraction`。
- 固定 base/初始 HEAD：`d3970ae753bfd241515935bcc2640b8792b46230`；tree `4e3995c5b24753a771948bbc237ce257a993918e`，与 local main 一致，worktree clean。Worker 尚未产生提交或改变固定 base。

## D04-T02 Lead 复冻结与 Architect 批准记录

- Worker 首轮 `REVIEW` 后，Lead 独立复核并退回两项证据/行为问题：受限正文片段不得被普通最小字符阈值二次丢弃；`addEventListener` 后发生的晚到 abort 必须确定拒绝且不得启动 transport。Worker 在同一 11 路径白名单内修复，未修改 T01 文件。
- Lead 复核后冻结 tree `66a486f0873bf71c61bc1af9a3f5ea787575328f`，归档 SHA-256 `c0a54a9cbf107cd1b259ca7b0274d97127957927430b1eef67c2ab2c12539cdb`；写集精确为 11 路径，T01 diff 为 `0`，staged 外无 tracked/untracked 变更。独立 `npm run verify` 为 `36/36` 文件、`347/347` tests，typecheck、build、lifecycle/database smoke 和 109 文件格式检查全部通过；定向正文套件 `3/3` 文件、`57/57` tests 通过。
- 冻结 11 路径高置信私钥/云厂商/GitHub/OpenAI/Slack/Bearer secret 模式命中路径计数为 `0`；`git diff --cached --check` 通过；新增生产代码未引入 `any`/`ts-ignore` 或额外网络实现，除注入 transport 的 `fetch` 调用外无网络入口。
- Architect 对同一 tree 完成独立复冻结，结论 `D04-T02 ARCHITECT REFREEZE: APPROVE 66a486f0873bf71c61bc1af9a3f5ea787575328f`。Lead 随即以该精确 tree 创建 candidate `b6566b0a60940e3593b84b7d8af29c0e57e4a084`，parent/base 与 tree 均逐字核验一致，Worker branch tip 已对齐 candidate；candidate archive SHA-256 为 `92787cf3252811972cb4c600ac764858108e18bf450a52db1c0b0637520b3b3b`。

## D04-T02 Candidate、Merge 与 PASS 记录

- candidate `b6566b0a60940e3593b84b7d8af29c0e57e4a084` 的 tree 为 `66a486f0873bf71c61bc1af9a3f5ea787575328f`，唯一 parent/base 为 `d3970ae753bfd241515935bcc2640b8792b46230`；candidate 相对 base 与 merge 第一 parent 均为精确 11 路径。合并前批准记录提交为 `028b70e7c5a0299e0165d2f6a3c234642cc02293`。
- local main `--no-ff` merge commit 为 `19f7973f27a4a78a8f867c64c0823c0e245e5658`，merge tree 为 `6e071157c4be2102039a3eba667a03fdd4db9c8d`；第一/第二 parent 分别为批准记录与 candidate。candidate↔merge 的 11/11 生产 blob 完全一致，branch tip 精确等于 candidate，主工作区与归档前 Worker worktree 的 tracked/staged/untracked 变更均为 `0`。
- 合并后以精确 Node `26.13.1` / npm `11.20.0` 执行 `npm ci --offline`：123 packages、0 vulnerabilities；定向正文 `3/3` 文件、`57/57` tests；完整 `npm run verify` 为 `36/36` 文件、`347/347` tests，typecheck、build、lifecycle/database smoke 与 109 文件格式检查全部通过。`git diff-tree --check` 通过。
- Paseo `archive_workspace` 返回 `workspaceId=wks_21f5659a79f35681`、`archivedAgentIds=[e5a27406-fedf-4d6a-a6b0-c31476b2b0bc]`、`removedDirectory=true`。复核 active workspace 列表已无该 workspace，Worker agent 为 closed/archived，原 worktree 目录与 `git worktree list` 条目均已移除；branch 仍精确指向 candidate。`T02_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；`T02_REMOTE_CI=NOT_RUN`。

## D04-T03 执行记录

- Worker Agent：`0e8e7175-670c-443e-ad93-5c7b60f79269`；全新 Paseo Worker，采用 `codex-worker` profile（`codex-magpie/group/worker`、`auto-review`、thinking `high`），已严格限定为 single-task 实现和 `REVIEW`/`BLOCKED` 交回。
- Workspace：`wks_a80d292a6f275ae7`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-t03-restricted-http`；Branch：`feat/d04-t03-restricted-http`。
- 固定 base/初始 HEAD：`de0a2143c0f1c68721a09878f614df518b3238ed`；tree `e8352d02e3352d24fbd1935c294253aa5d62b494`，与 local main 一致，worktree clean。Worker 尚未产生提交或改变固定 base。
- 首轮 Lead 复核发现 Worker 违反 §9.1，已将 11 路径写入提前提交 `9253cf0721760778e4a3ace7c88d98dee4ec591e`（parent `de0a2143c0f1c68721a09878f614df518b3238ed`，tree `b150e7d7ee17cf50c966fb3a4a5c1d6ea127ffbf`，初始 worktree clean），当时仅 `36/36` 定向测试、full suite `382/383`。Architect 裁决保留该提交作为**未批准审计对象**，不重置/改写历史、不据此合并；Worker 后续禁止 stage/commit/amend，由 Lead 对最终完整变更重新冻结和提交 G4。
- 首轮 Lead 阻断：§7.3 的 redirect/status/encoding/byte/deadline/cancel/cleanup/并发/tracker/error-leak 矩阵大量缺失；实现还允许 WHATWG 静默剥离原始 URL 控制字符、redirect 后 destroy 而非 cancel+close、已收到 response 的 status/MIME/encoding 拒绝未取消 body、dispatcher 未检查 close/destroy capability、close rejection 未 fallback destroy、BOM 可旁路 charset 声明。已要求同一 Worker 在批准写集内完成修复与矩阵。
- Architect 已批准一项最小写集例外：只允许修正 `tests/adapters/rss-content.test.ts:798` 的旧“缺少 transport 抛 TypeError”装配断言及直接关联描述/调用，使 `createRssAdapter()` 零参契约与 approved T03 一致；其他 T01/T02 映射和覆盖不变，已记录于 Plan §7.1 下方。该批准不代表 T03 实现通过。

## D04-T03 A/B 裁决与 G4 精确冻结交接

- A/B 裁决已固定：旧提交 `9253cf0721760778e4a3ace7c88d98dee4ec591e` 仅保留作**审计对象**，不是已批准 candidate，绝不据此 merge；Worker 自该裁决起不得再 commit/amend；修复后的最终 tree 必须作为新对象重新提交 Architect 审批；可审范围只能是原 11 路径加已批准的 `tests/adapters/rss-content.test.ts` 单条断言例外，不得扩大。
- 任务原始 base：`de0a2143c0f1c68721a09878f614df518b3238ed`，tree `e8352d02e3352d24fbd1935c294253aa5d62b494`。旧审计提交：`9253cf0721760778e4a3ace7c88d98dee4ec591e`（唯一 parent 为上述 base，tree `b150e7d7ee17cf50c966fb3a4a5c1d6ea127ffbf`）。准确状态应表述为“旧审计 commit 之后的修复尚未提交”，不得简写为“全部尚未提交”。
- 历史旧冻结（已作废，不得作为 G4 或 candidate 依据）：tree `feadd152eaea21969b22ac8c676fc0aaff65fac9`、patch `92,554` bytes / `7237ffaf6dc022c76bfca514dd5d00a2221eed2b42fe9105601c925ebb4953ee`，当时记录为相对旧审计提交之后的 7 个修改与旧提交合计 12 路径。该记录仅保留历史，已被下方最终 13 路径完整冻结取代；旧 `f766f4e6567d6673c1a0f2c86a01dc9185beda57` 及旧 9 修改补充 hash 同样只作历史审计线索，不能代替 base→最终 tree 证据。
- 当前 Worker HEAD 仍为旧审计提交 `9253cf0721760778e4a3ace7c88d98dee4ec591e`；index 与 HEAD 一致、staged entries 为 `0`；worktree 相对 HEAD 有 9 个 tracked 修改，untracked 为 `0`。这 9 个修改与旧审计提交的既有变更合并后，相对原始 base 形成最终 13 路径冻结集。
- 最终冻结 tree：`aecccde31c1cd2aeca1cc60df816198c43c4f70d`。tree 包含 157 个路径；在独立冻结对象库中 `git cat-file -t` 返回 `tree`，`git rev-parse <tree>^{tree}` 精确等于该 SHA。13 个当前工作文件 blob 均与最终 tree 对应 blob 完全一致，worktree 相对原始 base 的写集也精确为下述 13 路径。
- 最终冻结目录：`/private/tmp/d04-t03-final-freeze.Ltdlhk`；隔离 index：`/private/tmp/d04-t03-final-freeze.Ltdlhk/index`；canonical patch：`/private/tmp/d04-t03-final-freeze.Ltdlhk/patch.bin`；自包含 bare 对象库：`/private/tmp/d04-t03-final-freeze.Ltdlhk/repo.git/objects`。对象闭包共 190 个 reachable objects，均逐对象读取通过；tree 枚举为 157 路径。对象库 pack ID 为 `a8a0085e259f11d5fb160c44d5bc5df7ce6b3e45`，pack SHA-256 为 `4262879771d8944280f0939453b367cfb2e02bf16f4e0cda5d4edd90e9b7694e`。
- canonical patch 命令与结果：从原始 base 对最终冻结 tree 执行 `git diff --binary --full-index --no-ext-diff de0a2143c0f1c68721a09878f614df518b3238ed aecccde31c1cd2aeca1cc60df816198c43c4f70d`，输出 `136125` bytes，SHA-256 为 `436d48c1e056f0631038c013e699e951bda1a8ea6a3eb3f5ecc8c929e2a1369e`。现场重新生成的 patch 与 `patch.bin` 逐字节一致；该 base→完整 tree 结果是唯一 canonical 交接对象。
- 最终冻结路径共 13 个：`M README.md`、`M package-lock.json`、`M package.json`、`A src/adapters/http/address-policy.ts`、`A src/adapters/http/encoding.ts`、`A src/adapters/http/restricted-client.ts`、`M src/adapters/rss-adapter.internal.ts`、`M src/adapters/rss-adapter.ts`、`A tests/adapters/restricted-http.test.ts`、`M tests/adapters/rss-content.test.ts`、`A tests/adapters/rss-http.test.ts`、`A tests/adapters/security.test.ts`、`A tests/fixtures/http-fixture.ts`。其中 `rss-content` 例外文件只有已批准的 `2 insertions/2 deletions`：一处测试标题随语义更新，一处断言由旧 `toThrow(TypeError)` 改为 `not.toThrow()`；没有其他业务覆盖修改。
- 两个最终阻塞均已闭合。其一，生产 connector factory 校验 Agent 实际传入的 pinned `lookup`，测试经过生产 dispatcher 构造路径并在更低层映射 loopback；移除生产 `connect.lookup` 的内存变异会以 `The production dispatcher lost its pinned lookup` 失败，证明测试能识别 pin 丢失，同时保留 Host、端口与 HTTPS SNI 语义断言。其二，redirect 层先区分 URL 语法解析失败与安全策略拒绝：畸形 authority/IPv6、非法端口、控制字符等为 `invalid_redirect`；可解析但被策略阻止的 localhost、`.localhost`、userinfo、非默认端口等保留 `blocked_url`。两条路径均保留最后已验证 URL，并断言无下一跳 DNS/dispatcher/request；完整 article 调用链在策略拒绝时为 `BLOCKED` 且摘要回退。未扩大已批准 DNS/字节设计范围。
- 依赖差异相对原始 base：直接依赖新增 `ipaddr.js@2.5.0` 与 `undici@8.12.4`；lockfile 新增 package path 仅 `node_modules/undici@8.12.4`（`resolved=https://registry.npmjs.org/undici/-/undici-8.12.4.tgz`，integrity `sha512-8Mx+uNKKER2bA4AdtedkqRbwUCIJFr2nJckXRe5yrDqzePqwLP7VNcctN8/XdmDSbF7mS+jJKIszlL+vbam1VA==`），移除路径为 `0`；`ipaddr.js` 已存在于 base lockfile，本卡仅提升为直接依赖。Node `26.13.1`/npm `11.20.0` 下 `npm ls --depth=0` 退出 `0`，无 missing/extraneous。
- Worker 自测证据（不构成验收）：最终报告同一工作树 3 个定向套件 `172/172` PASS、typecheck/build/full verify `39/39` files `522/522` tests、process/database smoke 与 `116` 文件格式检查通过；该结果仅作 Worker 交付线索，最终验收仍以 Lead 独立证据和 Architect G4 为准。
- Lead 证据（最终冻结 tree）：精确 Node `26.13.1`/npm `11.20.0` 下 `npm run verify` 为 `PASS`；完整测试 `39/39` files、`522/522` tests；typecheck、build、SIGINT/SIGTERM/占用端口/forced-close/late-listen smoke、Source+Topic 跨重启持久化、database smoke 与 `116` 文件格式检查全部通过；`git diff --check` 通过。该 full verify 只对应最终 tree/patch，若 tree 或 patch 变化则失效，本次不再重复运行。
- 附加 reviewer 证据（不替代 Architect）：reviewer agent `d9963d99-fe00-4c97-b164-97a526f2a24c` 对同一精确 patch 独立执行 3 个定向套件 `175/175` PASS、typecheck PASS，并完成 redirect 分类与生产 lookup 内存变异探针；其 PASS 仅作附加 review 证据，且其未独立重跑 full verify。Architect 本会话 G4 仍是唯一批准权威，不得以该 reviewer 或旧 Architect 报告替代。
- 测试矩阵定位（冻结 tree 行号）：`tests/adapters/restricted-http.test.ts:71-218` 覆盖 URL/公网地址/DNS；`:220-1390` 覆盖 exact undici dispatcher、真实 Fixture、redirect、decompressed byte limit、stream cancel、status/MIME/encoding、dispatcher capability/cleanup、deadline/caller abort、DNS/fetch late settle 与 socket teardown；`tests/adapters/rss-http.test.ts:11-57` 覆盖 production seam 的 feed+article 本地集成；`tests/adapters/security.test.ts:18-49` 覆盖无全局 mutation/proxy、地址 pin、redirect downgrade 与公共导出边界；`tests/adapters/rss-content.test.ts:530-926` 覆盖取消/并发/默认 factory/transport 隔离，单条装配例外位于 `:781` 及其断言 `:798`。
- 上述冻结交接时仅由 Lead 更新文档并提交到 main 文档历史；当时未修改生产代码、未创建 candidate、未 merge、未 push。该记录保留为 G4 前的历史状态；后续批准、candidate、merge、验证与归档见下节。

## D04-T03 G4 批准、合并与收尾

- Architect 独立 G4 已批准精确 tree `aecccde31c1cd2aeca1cc60df816198c43c4f70d`、base `de0a2143c0f1c68721a09878f614df518b3238ed`、canonical patch SHA-256 `436d48c1e056f0631038c013e699e951bda1a8ea6a3eb3f5ecc8c929e2a1369e` 和 13 路径；Architect 核对 13 工作 blob、`rss-content` 单条授权例外及 `internal` 晚拒绝消费修复，并独立通过 typecheck/build/175 tests 与 redirect 探针。Architect 未重跑 full verify，采纳同一 tree 的 Lead `522/522` 证据；附加 reviewer 不替代该批准。
- Candidate：`16cd09a56daa50b1b88a6325dbee5f02ddf9ce15`，tree 精确 `aecccde31c1cd2aeca1cc60df816198c43c4f70d`，唯一 parent 为原始 base `de0a2143c0f1c68721a09878f614df518b3238ed`。candidate 分支为 `candidate/d04-t03-restricted-http`；旧审计 commit `9253cf0721760778e4a3ace7c88d98dee4ec591e` 不是其祖先，历史对象保留且未改写。
- Merge：main `c44237814a1171bd78f69b7ab4432502807737f7`，tree `69f13634613bd00f742d9d18632a596863cc7d94`，第一父 `b882e867bfdad2726a93163803d908618c120c60`、第二父 candidate。candidate→merge 的批准 13 文件 blob 全部一致；merge 仅额外保留 main 文档进展，无生产路径漂移。
- 合并后验证：固定工具链 `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`（Node `v26.13.1` / npm `11.20.0`）；`npm ci --offline` 安装 124 packages、0 vulnerabilities；定向 `3/3` 文件 `175/175` tests；full `npm run verify` 为 `39/39` 文件 `522/522` tests，typecheck、build、SIGINT/SIGTERM/占用端口/forced-close/late-listen smoke、Source+Topic 跨重启持久化、database smoke 与 `116` 文件格式检查全通过。初始沙箱内定向运行因禁止 loopback 绑定在 fixture 启动阶段返回 `EPERM`，未进入业务断言；同一命令在受控沙箱外重跑通过，未改代码或测试。
- 分支与归档：确认 worker worktree 全 tracked 内容等于 candidate tree、tracked 修改仅对应旧 HEAD 且 untracked 为 `0` 后，将 `feat/d04-t03-restricted-http` branch/index/worktree 对齐 candidate；candidate 与 feat tip 均为 `16cd09a…`，worktree clean。Paseo `archive_workspace` 返回 `workspaceId=wks_a80d292a6f275ae7`、`archivedAgentIds=[0e8e7175-670c-443e-ad93-5c7b60f79269]`、`removedDirectory=true`；活动 workspace 列表已无该 workspace，Worker `archivedAt=2026-11-17T13:44:25.857Z`，目录与 Git worktree 条目均已移除。`T03_STATUS=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`。
- D04 干净集成 Gate：使用 `git archive` 从精确 merge commit `c44237814a1171bd78f69b7ab4432502807737f7` 生成 190-entry tar，快照 `/private/tmp/pis-d04-integration.55hmxG/tree`，source tar SHA-256 `ffad8481ca36355b1d896ca980594fe820422647b39b2445b2a5264b0de4208a`；快照无 `.git`、`node_modules` 或私有 `config/prompt/user-context.md`。固定工具链校验通过，干净 `npm ci --offline` 安装 124 packages、0 vulnerabilities；唯一一次 full verify 为 `39/39` 文件、`522/522` tests，typecheck、build、全部 process/database smoke 与 `116` 文件格式检查全部 PASS。`D04_LOCAL_INTEGRATION_GATE=PASS`；远程 CI `NOT_RUN`，`FINAL_PASS` 未签发，交 Architect 最终验收。

## D04-T01 Architect G4 审核记录

- Architect 已确认首轮 13 个文件 blob、tree `ee53ff73039af064c5a6d14d3089a38282f60faa` 与 full-index patch `93b813e7111a209bab2c7c4b56b0caaa8963d6ed2852860425a464175f6e5edc` 一致；独立 typecheck、3 文件 95 tests 与 build 通过。
- 结论 `CHANGES_REQUIRED`：`raceWithAbort` 在 transport 调用后才监听 signal，同步 abort + 永久 pending 不能有限终止；RFC822 regex 错误要求 weekday；Atom HTML 在 XML 解码后再次解码并去标签，导致合法字面量丢失。必须补同步 abort+永久 pending/late reject、无 weekday GMT/数值 offset、Atom title/content/summary 嵌套实体/CDATA 回归。
- 首轮 tree 不形成 candidate，真实 index 仍为空、HEAD 仍为 base；Architect 明确未授权 candidate 或 merge，已退回原 Worker 在同一白名单内修复。
- 合并后 Architect 复核确认 candidate tree、merge 第二父、worktree 移除和 T02 基线记录正确；同时指出归档前 branch/candidate 未对齐，并要求仅修正 branch ref 与当前进度记录。该缺陷现已关闭，无遗留 T01 代码或 merge 阻塞；原两轮 `CHANGES_REQUIRED` 记录继续保留作为历史证据。

## Architect G3 审核记录

- 审核候选：`83e307b8ceef028a5a1106d57e5ef4451dddf25a`；tree：`c5a6dc4ad3e96c4a54252fbcf037a3a58fe70467`；parent 与 Spec 基线 `b87594a742f4440eaf49a5daeac74bd2ca622e51` 一致。
- Architect 独立检查四项阻塞修复、Spec 一致性、仅两文档写集、worktree clean 与 diff-check；结论 `APPROVED`。取消信号/连接隔离、原始 DOM 限制信号检测、受限隐私扫描与逐卡归档均有明确验证要求。
- main 已以 fast-forward 整合候选；仅文档，无需重跑生产测试。npm 安装、互操作测试与 full verify 均未在本轮运行。
- 本记录为计划批准，不代表实现通过或执行授权；后续按负责人决定进入开发。

## 证据边界

T01 Lead 复核阶段只更新本 Progress；Worker 分支独立承载生产候选，不得覆盖 main 的 Progress。全部证据以 Worker 收据、隔离 tree/patch、实际 diff 和 Lead 复核命令为准。未请求真实互联网，不读取或复制 User Context/私密配置。原文“Architect G4 结论仍待签发”属于历史阶段状态；后续 Architect 已确认 candidate/merge/worktree/T02 基线，branch 引用与文档状态亦已按指正更新，该项已不再 pending。T02 保持 `IN_PROGRESS`，本纠正未打断或重复派发 Worker。

## 历史 G2 审核记录

- Architect 已对照 Intent、技术设计 §2.3/2.4/10.1、任务卡及 COL 组件用例完成 Spec 一致性复核，结论 APPROVED。
- 全文判定明确区分 SOURCE_DECLARED 与 ARTICLE_EXTRACTED；description/summary 不因长度升级，受限片段/HTTP 206 不当作全文。
- 原生 fetch 的 DNS 结果固定至连接，redirect 每跳重新校验；不存在生产 allowPrivate 开关。
- 财经 API Adapter 延期；通用接口不依赖 XML/DOM，当前不扩充 Source.type。
- Spec 已固定默认预算、内容大小、编码范围及依赖版本；兼容性、性能、网络与资源清理均须在任务实现时验证。
- Worker 未派发，无 D04 push 或开发执行授权。
