# D06 Intent：Processing 内容标准化与路由

- 状态：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 日期：2026-11-18
- 依赖基线：D05 最终 PASS；main `7d23c4a`（实现验收 SHA `23908b1`）；远程 CI Success。
- 上游：D01 数据库/同步事务，D02 Prompt/LLM typed calls，D05 Collection 与 `raw_data v1`。

## 1. 目标

实现 V1 的 `process(sourceItemId)`：读取 D05 已保存的 Source Item，从 `raw_data` 提取并清洗可用内容，生成规范 Content 并回写 `source_items.content_id`；在 Content **已提交**之后调用 P-01 路由，返回 `{contentId, routes}`。

D06 把“已采集的来源条目”变成“可分析的规范内容”，并只执行一次 P-01 路由 LLM 调用；不调用事件分析、知识分析或主题匹配，也不直接派发下游任务。

## 2. 已确认业务规则
1. 输入仅 Source Item ID；不存在时正常返回空结果，不写库。
2. Processing **不再访问网络**：正文完全来自 D05 保存的 `raw_data`；不得调用 Adapter 或任何 HTTP。
3. 内容判定沿用 D04 证据，不做字符数猜测：`content_kind=FULL_BODY` → `completeness=FULL`；`SUMMARY`/`FRAGMENT` → `PARTIAL`；`NONE` 或无可用文本 → 不创建 Content，正常空结果，Source Item 保留。
4. 标准化只做确定性的结构整理与清洗，不得新增事实、不得补写文章未给出的结论、不得虚构标题或时间。
5. 已存在 `content_id` 时直接复用该 Content，**不新增第二份**；不同 Source Item 即使正文相同也各自拥有独立 Content，不做 Hash/相似度去重。
6. 创建 Content 与回写 `source_items.content_id` 在同一短事务提交；任一步失败整体回滚，不留下半完成状态。
7. **只有 Content 已 COMMIT 后才调用 `routeProcessing`**；路由是本次任务结果，不落库为字段。路由失败不回滚已保存 Content，重试时复用旧 Content 再路由。
8. 路由结果只允许 EVENT、KNOWLEDGE 两者或空；合法重复值去重，未知或非法值由既有 D02 校验拒绝，不得派发非法任务。
9. 返回 `{contentId, routes}`；空路由时 Content 仍保留。D06 不提交队列任务，派发由 D15 Runtime 依据返回值完成。
10. 沿用 better-sqlite3、冻结 11 表 DDL、D02 typed calls 与现有同步事务 helper；不新增表、字段或 ORM。

## 3. Processing 具体职责

D06 只做五件事，前四件不调用 LLM。

### 3.1 读回并解析 `raw_data`

- 输入只有 Source Item ID；从 `source_items.raw_data` 读取 D05 保存的 v1 信封。
- 取出 `entry`（标题、URL、作者、发布时间）与 `content`（body、summary、content_kind、acquired_via、completeness_basis、article）。
- 不访问网络，不调用 Adapter，不重新抓取原文。

### 3.2 判定可用性与完整性

只按 D04 已给出的证据归类，不以字符数或经验阈值猜测：

| `content_kind` | 处理结果 |
|---|---|
| `FULL_BODY` | 创建 Content，`completeness=FULL` |
| `SUMMARY` / `FRAGMENT` | 创建 Content，`completeness=PARTIAL` |
| `NONE` 或清洗后无有效文字 | 不创建 Content，不调用路由，返回空结果 |

### 3.3 生成规范 Content DTO

按 `contents` 表固定字段生成：

- `title`、`url`、`author`、`published_at` 来自 `entry`；缺失时保持为空，不虚构。
- `body` 为清洗后正文；`summary` 为清洗后摘要，可为空。
- `completeness` 取 §3.2 结果；`created_at` 为本次处理时间；`language` 在 V1 不识别，保持为空。
- 清洗只做确定性处理：去除脚本/样式/标签、规范空白与换行、保留 Unicode 与有效文字；不得改写事实、补写结论或生成标题。

### 3.4 事务内持久化并回写关联

- 同一短事务：插入 `contents` 行，并更新 `source_items.content_id`。
- 事务内重新读取该 Source Item；若已被并发处理并关联 Content，则复用该 Content，不插入第二份。
- 任一步失败整体回滚，不允许“有 Content 未关联”或“关联指向不存在 Content”。
- 已有 `content_id` 时直接读取并复用，不进入插入路径。

### 3.5 提交后路由（唯一的 LLM 调用）

- 严格在 Content COMMIT 之后调用 D02 的 `routeProcessing`（P-01）；不得在事务内调用 LLM。
- 返回值只允许 EVENT、KNOWLEDGE、两者或空；合法重复去重，未知值由 D02 校验拒绝。
- 路由结果不写入数据库，只作为本次任务返回值；空路由时 Content 仍保留。
- 路由失败不回滚 Content；调用方重试时复用旧 Content 再路由。
- 单次调用沿用 D02 冻结行为：非流式、总超时 60 秒、响应上限 2 MiB、不自动重试；D06 不新增重试或退避。

### 3.6 返回结果

```ts
{ contentId: string | null, routes: Array<"EVENT" | "KNOWLEDGE"> }
```

D06 到此结束；不派发任何任务，由 D15 Runtime 依据 `routes` 决定后续分析。

### 3.7 明确不做

- 不抓取网页、不做文章提取或正文补全（归 D04/D05）。
- 不做跨 Content 去重、正文 Hash、相似度计算。
- 不做事件判断、知识提炼、主题匹配。
- 不实现队列、重试调度、限流、缓存或提交后派发。
- 不修改 DDL、Prompt、CI、Collection 或配置 API。

## 4. 范围

- Processing 公共契约、`raw_data` 读取与解析、内容清洗与规范化 DTO、FULL/PARTIAL 判定。
- Content Repository：按 `source_items.content_id` 读取、插入 Content、回写关联、事务内 recheck。
- Processing 编排：复用已有 Content、提交后调用 P-01 `routeProcessing`、稳定错误与安全日志。
- 独立 Processing fixtures/测试，覆盖 PRO-01～12 中属于 Processing 的规则；用 Test Spy 证明 Processing 期间零原文 HTTP，并证明路由调用次数与时机正确。

### LLM 调用边界

- D06 **只**调用 D02 已实现的 `routeProcessing`（P-01），使用已批准且不可修改的 `config/prompts/processing-route.md`。
- 输入只含本次 Content 的规范字段（标题、正文/摘要、completeness 等），不含原始 HTML 全量、凭据或私有上下文。
- 调用时机严格在 Content COMMIT 之后；不得在事务内调用 LLM，不得用 LLM 结果决定是否插入 Content。
- 单次调用沿用 D02 已冻结行为：非流式、总超时 60 秒、响应上限 2 MiB、不自动重试；D06 不新增重试或退避策略。
- 路由失败不回滚已保存 Content；重试由调用方再次 `process` 时复用旧 Content 再路由。
- 测试一律注入 stub typed calls，不访问真实模型、不读取真实 API Key 或私有 Prompt 上下文。

## 5. 非目标

- 不实现 Event/Knowledge/Topic 分析，不写 events、knowledge、published_items。
- 不新增或修改 Prompt；P-01 只读取已批准文件，内容与哈希不得变化。
- 不实现 LLM 重试、限流、缓存、并发控制或降级策略（属 Runtime/后续里程碑）。
- 不实现 Runtime、队列、重试调度或提交后派发（D15）；不宣称解决 COMMIT 后崩溃漏派。
- 不实现跨 Content 去重、正文 Hash、语言识别或翻译。
- 不改 Collection、Adapter、配置 API、DDL 或 CI。

§3.7 已列出更细的“不做”清单，与本节不重复展开。

## 6. 验收意向

- 全文 `raw_data` → FULL Content、回写关联、同事务提交；摘要/片段 → PARTIAL，且正文只含实际取得内容。
- 无可用内容 → 无 Content、无路由调用、正常空结果。
- 重复执行同一 Source Item → 复用同一 Content，不新增第二份，可再次路由。
- 两个内容相同的 Source Item → 各自独立 Content。
- 插 Content 后回写前注入异常 → 全部回滚。
- 路由失败后重试 → 先读同一 Content 再路由，不重新抓取或插入。
- 四种路由结果 → 返回 EVENT/KNOWLEDGE/两者/空，空路由保留 Content；重复 enum 去重、非法 enum 拒绝。
- Processing 期间 `fetchContent` spy 调用次数为 0。
- 三文档门禁、逐任务 Worker→Lead→Architect、精确 candidate/merge、干净本地 Gate、远程 CI、心跳及 Worker/workspace 归档按项目持续约定执行。

## 7. 待负责人确认

请确认 D06 边界，尤其是：Processing 自身不访问任何原文 HTTP，但会在 Content 提交后调用一次 P-01 路由 LLM；`NONE` 内容不创建 Content 且不调用路由；路由结果不落库，只作为任务返回值交给 Runtime。确认后进入 Spec G2。