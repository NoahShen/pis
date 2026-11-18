# D06 Intent：Processing 内容标准化与路由

- 状态：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 日期：2026-11-18
- 依赖基线：D05 最终 PASS；main `7d23c4a`（实现验收 SHA `23908b1`）；远程 CI Success。
- 上游：D01 数据库/同步事务，D02 Prompt/LLM typed calls，D05 Collection 与 `raw_data v1`。

## 1. 目标

实现 V1 的 `process(sourceItemId)`：读取 D05 已保存的 Source Item，从 `raw_data` 提取并清洗可用内容，生成规范 Content 并回写 `source_items.content_id`；在 Content **已提交**之后调用 P-01 路由，返回 `{contentId, routes}`。

D06 把“已采集的来源条目”变成“可分析的规范内容”，但不调用事件分析、知识分析或主题匹配，也不直接派发下游任务。

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

## 3. 范围

- Processing 公共契约、`raw_data` 读取与解析、内容清洗与规范化 DTO、FULL/PARTIAL 判定。
- Content Repository：按 `source_items.content_id` 读取、插入 Content、回写关联、事务内 recheck。
- Processing 编排：复用已有 Content、提交后路由、稳定错误与安全日志。
- 独立 Processing fixtures/测试，覆盖 PRO-01～12 中属于 Processing 的规则；用 Test Spy 证明 Processing 期间零原文 HTTP。

## 4. 非目标

- 不实现 Event/Knowledge/Topic 分析，不写 events、knowledge、published_items。
- 不实现 Runtime、队列、重试调度或提交后派发（D15）；不宣称解决 COMMIT 后崩溃漏派。
- 不新增或修改 Prompt；P-01 使用已批准的五份功能 Prompt 之一，内容不变。
- 不实现跨 Content 去重、正文 Hash、语言识别或翻译。
- 不改 Collection、Adapter、配置 API、DDL 或 CI。

## 5. 验收意向

- 全文 `raw_data` → FULL Content、回写关联、同事务提交；摘要/片段 → PARTIAL，且正文只含实际取得内容。
- 无可用内容 → 无 Content、无路由调用、正常空结果。
- 重复执行同一 Source Item → 复用同一 Content，不新增第二份，可再次路由。
- 两个内容相同的 Source Item → 各自独立 Content。
- 插 Content 后回写前注入异常 → 全部回滚。
- 路由失败后重试 → 先读同一 Content 再路由，不重新抓取或插入。
- 四种路由结果 → 返回 EVENT/KNOWLEDGE/两者/空，空路由保留 Content；重复 enum 去重、非法 enum 拒绝。
- Processing 期间 `fetchContent` spy 调用次数为 0。
- 三文档门禁、逐任务 Worker→Lead→Architect、精确 candidate/merge、干净本地 Gate、远程 CI、心跳及 Worker/workspace 归档按项目持续约定执行。

## 6. 待负责人确认

请确认 D06 边界，尤其是：Processing 完全不访问网络；`NONE` 内容不创建 Content 且不路由；路由结果不落库，只作为任务返回值交给 Runtime。确认后进入 Spec G2。