# D04 Progress

## 当前门禁

- 当前门禁：Plan v0.4 `APPROVED · G3 PASS`；负责人已明确批准执行：“按 Plan v0.4 开始执行”。
- 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，远程 CI Success，D03 心跳已删除，遗留 Worker 工作区已收尾并归档。
- D04 Intent：`APPROVED · G1 PASS`。负责人确认全文/摘要判定，并明确 RSS 仅为一种实现；财经资讯抓取 API Adapter 延期至 V1 全流程走通后另立里程碑。
- D04 Spec v0.1：`APPROVED · G2 PASS`。本里程碑不修改 Spec/Intent。
- D04 Plan：v0.1～v0.3 为历史未批准稿；v0.4 经 Architect 复核四项修订后为 `APPROVED · G3 PASS`。`USER_EXECUTION_APPROVAL=APPROVED`；授权范围为 T01～T03 按 Plan 串行实施，不包含 D04 push。
- D04-T01：`IN_PROGRESS`；已创建独立 Worker/worktree，正在固定白名单内实现与自测。D04-T02/T03：`NOT_STARTED`。
- D04 测试/远程 CI：`NOT_RUN`；最终验收：`NOT_ISSUED`。

## Lead 执行身份与交付位置

- Agent：`b32354fa-d47e-45d5-90ba-84554fd09cdb`。
- Server：`srv_rWwNLOnyU5IK`。
- Workspace：`wks_a734c952ac2dbc82`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-lead-plan`。
- Branch：`d04-lead-plan`；文档提交基线：`b87594a742f4440eaf49a5daeac74bd2ca622e51`。
- 本轮只提交 `docs/milestones/D04/plan.md` 与 `docs/milestones/D04/progress.md`，提交主题为 `docs(d04): revise plan for G3 blockers`；精确提交 SHA 由 Lead 交回 Architect 时固定。

## D04-T01 执行记录

- Worker Agent：`c1fe5080-e7ac-44c1-8dd4-916763b1dafd`；profile `codex-worker`，mode `auto-review`，thinking `high`。
- Workspace：`wks_2f570238f5eb4a0c`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-t01-contracts-rss-list`。
- Branch：`feat/d04-t01-contracts-rss-list`；固定 base/初始 HEAD：`7218d74f8da376d92d7b36798a40f93d218d8b52`。
- 该 Worker 只允许 Plan §5 的 T01 写集；保持未提交 `REVIEW` 交接，不得 stage/commit/merge/push。安装依赖与测试结果待 Worker 收据和 Lead 独立复核。

## G3 CHANGES_REQUIRED 修订记录

1. 默认 HTTP transport 改为每个逻辑 feed/article 请求按该次 `callSignal` 新建，adapter 只共享不可变 policy/factory，不缓存首次绑定的 transport。补同一实例连续两次取消、首次取消后下一次成功、并行 A abort/B success 的 Factory/Controller/Agent/socket 隔离测试。
2. Secret 检查限定为本卡 Git tracked 变更与明确列出的合成 Fixture；禁止读取 ignored/untracked 私有配置、Prompt/user-context、`node_modules`、数据库或私有目录。证据只报路径/计数，不输出正文；错误泄漏要求只聚焦真实/敏感 URL，保留正常合成 Fixture 断言。
3. 每卡补 Worker 收尾：candidate↔merge 逐文件 blob 对照、branch/candidate 对齐、唯一未提交成果与旧 progress 单独处置、确认 clean、通过 Paseo `archive_workspace` 记录 success；主工作区不可归档，旧文档不得覆盖 main。
4. 正文处理顺序改为“原始 DOM 解析 → restricted JSON-LD/itemprop 检测 → 移除 script/清理 DOM → Readability”，并用完整 `fetchContent` 调用链验证含 JSON-LD 的付费信号不会因提前删 script 丢失。

## 下一步

等待 T01 Worker 提交 `REVIEW`/`BLOCKED`。Lead 随后独立检查写集、依赖、Case 覆盖与未提交 diff，运行必要验证并冻结精确 base/patch/tree/blob，交 Architect G4 复核；批准后才可创建 candidate 与合并。T02 仅在 T01 PASS、收尾并归档后启动，不 push。

## Architect G3 审核记录

- 审核候选：`83e307b8ceef028a5a1106d57e5ef4451dddf25a`；tree：`c5a6dc4ad3e96c4a54252fbcf037a3a58fe70467`；parent 与 Spec 基线 `b87594a742f4440eaf49a5daeac74bd2ca622e51` 一致。
- Architect 独立检查四项阻塞修复、Spec 一致性、仅两文档写集、worktree clean 与 diff-check；结论 `APPROVED`。取消信号/连接隔离、原始 DOM 限制信号检测、受限隐私扫描与逐卡归档均有明确验证要求。
- main 已以 fast-forward 整合候选；仅文档，无需重跑生产测试。npm 安装、互操作测试与 full verify 均未在本轮运行。
- 本记录为计划批准，不代表实现通过或执行授权；后续按负责人决定进入开发。

## 证据边界

T01 派发阶段只更新本 Progress；Worker 分支独立承载生产候选，不得覆盖 main 的 Progress。Lead 尚未替 Worker 声称依赖安装或测试通过；全部证据以 Worker 收据、实际 diff 和 Lead 复核命令为准。未请求真实互联网，不读取或复制 User Context/私密配置。

## 历史 G2 审核记录

- Architect 已对照 Intent、技术设计 §2.3/2.4/10.1、任务卡及 COL 组件用例完成 Spec 一致性复核，结论 APPROVED。
- 全文判定明确区分 SOURCE_DECLARED 与 ARTICLE_EXTRACTED；description/summary 不因长度升级，受限片段/HTTP 206 不当作全文。
- 原生 fetch 的 DNS 结果固定至连接，redirect 每跳重新校验；不存在生产 allowPrivate 开关。
- 财经 API Adapter 延期；通用接口不依赖 XML/DOM，当前不扩充 Source.type。
- Spec 已固定默认预算、内容大小、编码范围及依赖版本；兼容性、性能、网络与资源清理均须在任务实现时验证。
- Worker 未派发，无 D04 push 或开发执行授权。
