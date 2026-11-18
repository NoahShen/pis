# D07 Intent：Knowledge Analysis 知识价值判断与保存

- 状态：`APPROVED · G1 PASS`
- 负责人确认：2026-11-18 回复“确认OK，开始开发吧”，批准 §2 业务规则与 §3 职责边界。
- 日期：2026-11-18
- 依赖基线：D06 最终 PASS；main `5ff151b`；远程 CI Success。
- 上游：D01 数据库/同步事务，D02 Prompt/LLM typed calls，D06 Processing 产出 Content。

## 1. 目标

实现 V1 的 `analyzeKnowledge(contentId)`：读取已提交的 Content，结合用户上下文与 P-04 指令调用一次 LLM，判断其知识价值；`valuable=true` 时在短事务内保存**一份** Knowledge 并返回其 ID，`valuable=false` 时正常返回空结果。

D07 只做 Knowledge 一个阶段：不判断事件、不匹配主题、不派发下游任务。

## 2. 已确认业务规则

1. 输入仅 Content ID；Content 不存在时正常返回空结果，不写库、不调用 LLM。
2. 只读取本次 Content（title、body、summary、author、published_at、completeness）；**不检索既有 Knowledge**，不做跨文章去重或语义归并。
3. 每次判断**只调用一次** P-04；不重试、不串行多次试探。
4. `valuable=false` 是正常结果：不建立 Knowledge，不保存「无价值」记录，Content 保持不变。
5. `valuable=true` 保存**恰好一份** Knowledge；`UNIQUE(content_id)` 保证一份 Content 至多一个 Knowledge。
6. Finding 是 Knowledge 内部的 JSON 数组，不是独立实体：无独立 ID、无独立队列、无独立 RSS 任务。
7. `category` 允许为空；`findings` 允许为空数组——数量由实际内容决定，不机械要求至少一个。
8. 同一 Content 重复执行：若已存在 Knowledge，直接复用并返回同一 ID，不重复调用 LLM、不重复插入。
9. 两个不同 Content 即使正文相同，也各自独立判断并可各自形成 Knowledge，不做跨文章合并。
10. 严格 Schema：`valuable=false` 时出现 `title`/`value` 等额外字段必须拒绝；非法 Category、非法 findings、缺失必需字段均拒绝，且**不写入任何 Knowledge**。
11. 沿用 better-sqlite3、冻结 11 表 DDL、D02 typed calls 与现有同步事务 helper；不新增表、字段或 ORM。

## 3. Knowledge Analysis 具体职责

D07 只做五件事，前两件不调用 LLM。

### 3.1 读取并校验 Content

- 按 Content ID 读取 `contents` 行；不存在返回空结果。
- 取出 title、body、summary、author、published_at、completeness。
- 不读 `raw_data`、不访问网络、不调用 Adapter。

### 3.2 组装 P-04 输入

- 任务数据只含本次 Content 的规范字段，不含 `content_id`、raw_data、原始 HTML。
- 系统指令来自 `config/prompts/knowledge-analysis.md`；用户上下文来自 `config/prompts/user-context.md`。
- **只有 Knowledge Analysis 读取 User Context**；其他四类 Prompt 不注入背景信息（PMT-09）。
- 不加载历史 Knowledge、不加载 Topics、不注入 Topic 白名单。
- Prompt 每次调用前从磁盘读取，不缓存（PMT-08 语义）。

### 3.3 调用与严格校验（唯一 LLM 调用）

- 调用一次 `analyzeKnowledge`，沿用 D02 冻结行为：非流式、总超时 60 秒、响应上限 2 MiB、不自动重试。
- 严格区分两个分支：
  - `valuable=false`：只允许该字段；出现任何额外字段即拒绝。
  - `valuable=true`：必须有 `title`、`summary`、`value`，`category` 可为空，`findings` 为 `{title, description}` 数组且可为空。
- 校验失败不写库，返回稳定错误，不透出模型原始输出或 Prompt 内容。

### 3.4 事务内保存 Knowledge

- 同一短事务：插入 `knowledge` 行（`findings_json` 为 JSON 数组文本）。
- 事务内重新读取该 Content 是否已有 Knowledge；已存在则复用，不插入第二份。
- 任一步失败整体回滚，不留下半完成状态。
- `category` 为空时写入 `NULL`，不得用空字符串冒充。

### 3.5 返回结果

```ts
{ knowledge_id: string | null }
```

`valuable=false`、Content 不存在、已有 Knowledge 复用等情形统一用该结构表达。D07 不派发 TopicMatching，由 D15 Runtime 依据返回值决定。

### 3.6 明确不做

- 不做事件识别、事件检索、事件写入（D08/D09）。
- 不做 Topic 匹配、不读 topics 表、不判断关注主题归属。
- 不做 Published Item 生成、RSS 发布、Retrieval API。
- 不做跨文章去重、正文 Hash、语言识别、翻译。
- 不修改 DDL、Prompt、CI、Collection、Processing 或配置 API。
- 不实现 Runtime、队列、重试调度、提交后派发。

## 4. 范围

- Knowledge 公共契约、Content 读取、P-04 输入组装、严格响应校验。
- Knowledge Repository：按 `content_id` 读取、插入、事务内 recheck。
- Knowledge 编排：复用已有 Knowledge、价值判断分支、稳定错误与安全日志。
- 独立 fixtures/测试，覆盖 KNO-01～KNO-06、KNO-08、KNO-11、KNO-12 中属于 D07 的规则。

### LLM 调用边界

- D07 **只**调用 D02 已实现的 `analyzeKnowledge`（P-04），使用已批准且不可修改的 `knowledge-analysis.md` 与 `user-context.md`。
- 调用发生在事务之外；不得在事务内调用 LLM，不得用 LLM 结果决定事务边界。
- 测试一律注入 stub typed calls 与合成 Prompt 目录，不访问真实模型、不读取真实 `config/prompt/user-context.md`。

## 5. 非目标

- 不实现 Event Search、Event Analysis、Topic Matching、Published Item、RSS、Retrieval。
- 不实现 LLM 重试、限流、缓存、并发控制或降级策略。
- 不实现 Runtime、队列、提交后派发；不宣称解决 COMMIT 后崩溃漏派。
- 不实现跨 Knowledge 去重、语义合并、价值评分或排序。
- 不改 Collection、Processing、Adapter、配置 API、DDL 或 CI。

## 6. 验收意向

- `valuable=true` → 保存 1 条 Knowledge，字段来自模型校验后的值；返回新 ID。
- `valuable=false` → 不保存、不写「无价值」记录，Content 保留，返回空。
- 3 个 findings → 1 条 Knowledge + 3 个内部 Finding，无独立 Finding 实体。
- 同 Content 重复执行 → 复用同一 Knowledge，不重复调用 LLM、不重复插入。
- 两个不同 Content 相同正文 → 各自独立 Knowledge。
- `valuable=true` 但缺字段 / findings 非法 / category 非法 → 校验失败，零写入。
- `valuable=true, category=null, findings=[]` → 合法，保存 1 条。
- `valuable=false` 带额外字段 → 拒绝，不部分写入。
- 输入组装 spy：只含当前 Content + 两份 Prompt，不含历史 Knowledge 或 Topics。
- 三文档门禁、逐任务 Worker→Lead→Architect、精确 candidate/merge、干净本地 Gate、远程 CI、心跳及归档按项目持续约定执行。

## 7. 待负责人确认

请确认 D07 边界，尤其是：D07 是 **Knowledge Analysis**（计划原编号），Event Analysis 属 D09 且需 D08 先实现候选召回；D07 只返回 `knowledge_id`，TopicMatching 派发归 D15；`valuable=false` 不落任何记录。确认后进入 Spec G2。
