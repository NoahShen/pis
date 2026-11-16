# D04 Progress

## 当前门禁

- 当前门禁：Architect 已完成 Plan v0.4 的 G3 复核，`APPROVED`；等待负责人明确批准执行。
- 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，远程 CI Success，D03 心跳已删除，遗留 Worker 工作区已收尾并归档。
- D04 Intent：`APPROVED · G1 PASS`。负责人确认全文/摘要判定，并明确 RSS 仅为一种实现；财经资讯抓取 API Adapter 延期至 V1 全流程走通后另立里程碑。
- D04 Spec v0.1：`APPROVED · G2 PASS`。本里程碑不修改 Spec/Intent。
- D04 Plan：v0.1～v0.3 为历史未批准稿；v0.4 经 Architect 复核四项修订后为 `APPROVED · G3 PASS`。执行授权仍为 `PENDING`。
- D04-T01/T02/T03：`NOT_STARTED`；未创建 Worker，未安装依赖，未执行开发测试。
- D04 测试/远程 CI：`NOT_RUN`；最终验收：`NOT_ISSUED`。

## Lead 执行身份与交付位置

- Agent：`b32354fa-d47e-45d5-90ba-84554fd09cdb`。
- Server：`srv_rWwNLOnyU5IK`。
- Workspace：`wks_a734c952ac2dbc82`，`/Users/noahshen/.paseo/worktrees/0eapmc43/d04-lead-plan`。
- Branch：`d04-lead-plan`；文档提交基线：`b87594a742f4440eaf49a5daeac74bd2ca622e51`。
- 本轮只提交 `docs/milestones/D04/plan.md` 与 `docs/milestones/D04/progress.md`，提交主题为 `docs(d04): revise plan for G3 blockers`；精确提交 SHA 由 Lead 交回 Architect 时固定。

## G3 CHANGES_REQUIRED 修订记录

1. 默认 HTTP transport 改为每个逻辑 feed/article 请求按该次 `callSignal` 新建，adapter 只共享不可变 policy/factory，不缓存首次绑定的 transport。补同一实例连续两次取消、首次取消后下一次成功、并行 A abort/B success 的 Factory/Controller/Agent/socket 隔离测试。
2. Secret 检查限定为本卡 Git tracked 变更与明确列出的合成 Fixture；禁止读取 ignored/untracked 私有配置、Prompt/user-context、`node_modules`、数据库或私有目录。证据只报路径/计数，不输出正文；错误泄漏要求只聚焦真实/敏感 URL，保留正常合成 Fixture 断言。
3. 每卡补 Worker 收尾：candidate↔merge 逐文件 blob 对照、branch/candidate 对齐、唯一未提交成果与旧 progress 单独处置、确认 clean、通过 Paseo `archive_workspace` 记录 success；主工作区不可归档，旧文档不得覆盖 main。
4. 正文处理顺序改为“原始 DOM 解析 → restricted JSON-LD/itemprop 检测 → 移除 script/清理 DOM → Readability”，并用完整 `fetchContent` 调用链验证含 JSON-LD 的付费信号不会因提前删 script 丢失。

## 下一步

负责人审阅 Plan v0.4 并明确批准执行后，Lead 才可创建首张 T01 Worker；当前不创建 Worker、不开始实现、不 push。

## Architect G3 审核记录

- 审核候选：`83e307b8ceef028a5a1106d57e5ef4451dddf25a`；tree：`c5a6dc4ad3e96c4a54252fbcf037a3a58fe70467`；parent 与 Spec 基线 `b87594a742f4440eaf49a5daeac74bd2ca622e51` 一致。
- Architect 独立检查四项阻塞修复、Spec 一致性、仅两文档写集、worktree clean 与 diff-check；结论 `APPROVED`。取消信号/连接隔离、原始 DOM 限制信号检测、受限隐私扫描与逐卡归档均有明确验证要求。
- main 已以 fast-forward 整合候选；仅文档，无需重跑生产测试。npm 安装、互操作测试与 full verify 均未在本轮运行。
- 本记录为计划批准，不代表实现通过或执行授权；后续按负责人决定进入开发。

## 证据边界

本轮仅交付两份 D04 文档，不修改生产代码、依赖、测试、Spec 或 Intent。未执行 npm/install/typecheck/verify，未请求真实互联网；文档提交后的状态、准确 SHA 与 `git diff --check` 结果由 Lead 交回 Architect 时记录。

## 历史 G2 审核记录

- Architect 已对照 Intent、技术设计 §2.3/2.4/10.1、任务卡及 COL 组件用例完成 Spec 一致性复核，结论 APPROVED。
- 全文判定明确区分 SOURCE_DECLARED 与 ARTICLE_EXTRACTED；description/summary 不因长度升级，受限片段/HTTP 206 不当作全文。
- 原生 fetch 的 DNS 结果固定至连接，redirect 每跳重新校验；不存在生产 allowPrivate 开关。
- 财经 API Adapter 延期；通用接口不依赖 XML/DOM，当前不扩充 Source.type。
- Spec 已固定默认预算、内容大小、编码范围及依赖版本；兼容性、性能、网络与资源清理均须在任务实现时验证。
- Worker 未派发，无 D04 push 或开发执行授权。
