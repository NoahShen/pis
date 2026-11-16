# D04 Progress

## 当前门禁

- 当前角色：Architect。
- 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，远程 CI Success，D03 心跳已删除，遗留 Worker 工作区已收尾并归档。
- D04 Intent：`APPROVED · G1 PASS`。负责人确认全文/摘要判定，并明确 RSS 仅为一种实现；财经资讯抓取 API Adapter 延期至 V1 全流程走通后另立里程碑。
- D04 Spec v0.1：`APPROVED · G2 PASS`，Architect 已固定通用契约、RSS/Atom 映射、正文提取依据与受限 HTTP；Plan 尚未生成，G3 未通过。
- D04-T01/T02/T03：`NOT_STARTED`。
- D04 Lead/Worker：未委派；无活动 D04 心跳。
- D04 测试/远程 CI：`NOT_RUN`；最终验收：`NOT_ISSUED`。

## 下一步

通过 Paseo 委派新 Lead，根据已批准 Spec 编写文件级 Plan，提交 Architect 及负责人审阅后实施。后续财经 API Adapter 不进入本里程碑。

## 证据边界

本次仅交付 D04 三文档门禁中的 Intent 与 Spec，不修改生产代码、依赖或测试。npm registry 只读查询确认 fast-xml-parser 5.12.1、@mozilla/readability 0.6.0、linkedom 0.18.15、undici 8.12.4、ipaddr.js 2.5.0 的发布元数据；未安装依赖，未验证互操作，不将元数据视为实现证据。沿用 D03 已通过的配置和持久化基础；未宣称 RSS 输入或正文获取已经实现。

## G2 审核记录

- Architect 已对照 Intent、技术设计 §2.3/2.4/10.1、任务卡及 COL 组件用例完成 Spec 一致性复核，结论 APPROVED。
- 全文判定明确区分 SOURCE_DECLARED 与 ARTICLE_EXTRACTED；description/summary 不因长度升级，受限片段/HTTP 206 不当作全文。
- 原生 fetch 的 DNS 结果固定至连接，redirect 每跳重新校验；不存在生产 allowPrivate 开关。
- 财经 API Adapter 延期；通用接口不依赖 XML/DOM，当前不扩充 Source.type。
- Spec 已固定默认预算、内容大小、编码范围及依赖版本；兼容性、性能、网络与资源清理均须在任务实现时验证。
- Worker 未派发，无 D04 push 或开发执行授权。
