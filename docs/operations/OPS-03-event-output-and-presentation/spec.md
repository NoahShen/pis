# OPS-03 Spec：Event 输出契约与发布可读性

- 状态：APPROVED · G2 · Architect
- Intent：APPROVED · G1

## 1. Event JSON 兼容性验证

使用同一组合成 Content、生产 `event-search.md`/`event-analysis.md`、`group/pis` 与流式 Client，先执行未修改 Prompt 的对照组。记录安全的首包/Content/总耗时、attempt、category/reason、输出形态（valid/fenced/prose/schema/reference），原文只存私有 600。

- 若生产 Prompt 稳定，验收工具指令是问题来源，不修改生产 Prompt。
- 若生产 Prompt 也频繁围栏，允许在 `## 输出要求` 内做最小文本修订：整个响应仅一个 JSON 文档、首字符 `{`、末字符 `}`、禁止 Markdown/代码围栏/解释/前后缀，其他业务规则不变。
- 若最小 Prompt 修订仍不稳定，评估 Provider 支持的 JSON mode 或 Event 专用低推理路由；不得未验证即启用 `response_format=json_schema`，不得剥离围栏接受结果。
- 每种修订均保留对照结果，不通过更换预期隐藏模型错误。

## 2. 语义与程序边界

修订不得改变：

- Event/Update ID 由程序生成、候选 Event/Topic 引用严格校验。
- NEW_EVENT 不建初始 Update、NEW_UPDATE 的进展自身标题、NO_INCREMENT 证据语义。
- Entity/Subject/Scope 归并和 confirmed_aliases。
- 中文输出的数字、时间、否定、归因、证据强度、适用条件和技术专名。
- Zod/JSON/Schema/引用/冲突错误分类与 operation 重试预算。

真实复验至少覆盖事件事实、跨语言同指、公司与产品非别名、合法 NEW_UPDATE/NO_INCREMENT 和无事实空结果；不得只验证 JSON 可解析。

## 3. Publication HTML 展示

### Event / Event Update

以下标签用 `<strong>标签</strong>` 与值分隔，值继续 `escapeHtml`：

- 所属主线（Update）
- 核心实体
- 主题
- 范围
- 发生时间

保持标题 `<h2>`、事实标题 `<h3>` 和描述 `<p>`，不插入原始 Markdown 或 HTML。

### Knowledge

- 分类、摘要、价值标签使用 `<strong>`。
- Findings 使用 `<ul><li>`；每条标题使用 `<strong>${escapeHtml(finding.title)}</strong>`，详细描述使用独立 `<p>${escapeHtml(finding.description)}</p>`。
- 标题与描述不得再只是同一文本节点的 `标题：描述`。无 Findings 时保留安全的空状态。
- 不改变 title/summary/body 的事实内容，只允许展示结构变化。

### 快照与 RSS

已存 Published Item 是不可变历史事实，不做数据库更新。合法 RSS 重建可使用当前模板将同一快照投影成新 head/pending；同名 sealed 仍只能同 bytes 复用，内容漂移必须失败，禁止借展示变化重写 sealed 历史。

## 4. 验收

- 生产 Prompt 对照/修订/真实复验完整，报告不含正文、模型名、endpoint、秘密。
- 模板单测覆盖三类目标、全部标签、Findings 标题/描述结构、特殊字符和 HTML 注入负断言。
- RSS 测试验证 XML 可解析、HTML 结构可读、sealed 不被重写。
- 全量 verify、干净快照、精确 SHA Linux CI Success；真实外部不可用保持 BLOCKED。
