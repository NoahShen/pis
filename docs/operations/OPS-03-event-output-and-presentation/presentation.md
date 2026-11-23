# OPS-03-T02：Publication HTML 可读性

## 范围与实现

基于 `8ae251999f18604031495e278522df3440456442`，仅调整 Publication 模板展示与相应测试：

- Event / Event Update 的所属主线（Update）、核心实体、主题、范围、发生时间标签使用 `<strong>`。
- Knowledge 的分类、摘要、价值标签使用 `<strong>`；Findings 保留 `<ul><li>`，每条标题使用 `<strong>`，描述使用独立 `<p>`。
- 所有业务值继续由 `escapeHtml` 转义；Event/Update 的标题、事实标题和描述结构保持不变，Knowledge 无 Findings 的空状态保持不变。
- 模板标签 allowlist 与 SQLite 集成安全断言纳入 `strong`，危险 HTML 注入负断言继续生效。
- RSS 回归通过真实 Knowledge 模板快照验证 XML 可解析、`<strong>` 与 Findings 结构保持为 HTML、特殊字符不生成可执行标签。既有 head/pending/sealed 字节一致及 sealed 漂移拒绝逻辑未修改。

未修改历史数据库或 Published Item 快照、业务事实、Prompt、sealed 归档及 package 配置。

## 验证

固定 Node `26.13.1` / npm `11.20.0`：

- `npm run verify:toolchain`：通过。
- `npm test -- tests/publication/template-renderer.test.ts tests/publication/publication-integration.test.ts tests/rss/xml-renderer.test.ts tests/publication/html-security.test.ts`：4 个文件、35 项测试通过。
- `npm run typecheck`：通过。
- `npm run verify`：通过；153 个测试文件、1583 项测试，build、运行/生产/database/RSS/Pages smoke 与 380 个文件的格式检查全部通过。

覆盖既有 `PUB-01_EVENT_RENDER`、`PUB-01_UPDATE_RENDER`、`PUB-01_KNOWLEDGE_RENDER`、`PUB-01_SQLITE_THREE_KINDS`、`PUB-13_SQLITE_SAFE_BODY`、RSS HTML/转义与 sealed 归档回归。
