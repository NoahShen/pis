# D09 Intent：Event Analysis / 新主线、进展与重复证据

- 状态：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 日期：2026-11-19
- 依赖基线：D08 最终 PASS；D08 closeout `2ab5de8`；当前设计基线 `2484b287`；远程 CI Success。
- 上游：D01 Event/Update/证据/别名/FTS，D02 P-02/P-03 typed calls，D06 Content，D08 EventSearchService。

## 1. 目标

实现完整 Event Analysis：以 Content ID 为输入，经 D08 完成一次 P-02 线索提取与全历史候选召回，再以一次 P-03 判断 `NEW_EVENT / NEW_UPDATE / NO_INCREMENT`，并在一个短事务内保存本次全部结果、来源证据、确认别名及受影响 Event 的 FTS。

本里程碑返回真正新建的 Event/Update 目标集合，供后续 Runtime 派发 Topic Matching；D09 自身不创建队列或执行任务。

## 2. 业务规则

1. Content 不存在返回成功空目标集合，不调用 LLM、不写库。
2. D08 负责唯一 P-02 调用和候选上下文；D09 不另写第二套候选检索。
3. P-02 `clues=[]` → 成功空结果，**不调用 P-03**，不写 Event/Update/证据/别名。
4. 有 clues 但无候选 → **仍调用 P-03**，允许 NEW_EVENT；候选为空不是错误。
5. P-03 只调用一次，输入含当前 Content 六字段及 D08 候选 DTO；不注入 User Context、Topics、Knowledge、raw_data 或全历史 Update。
6. `results=[]` → 正常空结果，不强造 NO_INCREMENT，不写库。
7. `NEW_EVENT`：业务层生成 Event ID，保存初始事实与 `(EVENT,eventId,contentId)` 证据，**不创建首条 Update**。
8. `NEW_UPDATE`：必须引用本次合法候选 Event；业务层生成 Update ID，保存独立进展及本 Content 证据，不覆盖旧事实。
9. 同一 Content 对同一 Event 的 NEW_UPDATE 重放：根据 Event + Content 证据复用已有关联 Update；没有则创建。只降低明显重复，不宣称语义 Exactly-once。
10. `NO_INCREMENT`：只补证据和确认别名，不新建 Event/Update，不返回新目标。
11. NO_INCREMENT 的 `event_update_id` 非空时必须属于当前候选上下文且归属同一 Event；为 null 时只关联 Event，不猜 Update。
12. 一篇 Content 可对不同 Event 产生多项结果；同一 Event 不接受重复 NEW_UPDATE 或 NEW_UPDATE 与 NO_INCREMENT 的冲突组合。
13. `confirmed_aliases` 在三种 Action 中均可保存：以当前 Content ID 作为证据，按 Event 去重；P-02 临时 search_terms 不自动成为别名。
14. Event、Update、证据、别名和受影响 Event 的 FTS 必须在**同一个同步短事务**中成功或全部回滚。
15. 所有 LLM 调用、候选检索和上下文读取都在写事务外；事务内不得调用 LLM、网络、Clock 之外的异步依赖或异步 logger。

## 3. 公共契约草案

```ts
type EventTargetType = "EVENT" | "EVENT_UPDATE";

interface EventAnalysisResult {
  new_targets: Array<{
    target_type: EventTargetType;
    target_id: string;
  }>;
}

interface EventAnalysisService {
  analyze(
    contentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EventAnalysisResult>;
}
```

- 只返回本次真正新建的 Event/Update；NO_INCREMENT 和复用已有 Update 不返回新目标。
- 不返回队列、Published Item、Content、模型原文或内部分析决策。
- 不自动重试；技术失败由后续 Runtime 按策略处理。
- 稳定错误：`invalid_input | aborted | event_analysis_failed | llm_failed`。

## 4. 事务与幂等

- 事务开始时重新验证候选 Event 和所需 Update 仍存在且归属正确；不信任事务外快照。
- NEW_EVENT 的证据、NEW_UPDATE 的 Update 与证据、NO_INCREMENT 的证据、别名及 FTS 更新均同事务。
- `event_content_links` 主键保证同一目标/Content 证据去重。
- `event_entity_aliases` 主键保证同一 Event/alias 去重；重复别名保留原证据 Content，不覆盖。
- 任一写入、读回或 FTS 刷新失败，全部回滚且 `new_targets=[]` 不对外返回成功。
- 事务 COMMIT 后才返回新目标；D09 不派发，故不存在本模块的 COMMIT 后入队窗口。

## 5. 五卡范围

1. P-03 输入组装、单次调用、严格引用/冲突拒绝、取消与安全错误。
2. Event/Update/证据 Repository 与 NEW_EVENT/NEW_UPDATE 基础持久化。
3. NO_INCREMENT、确认别名、FTS 同事务和重复执行复用。
4. 多结果单事务、失败全回滚与持久化读回。
5. 公共 factory、D08 + P-03 + SQLite 集成及 P0 Gate。

实际文件级拆分由 Lead Plan 确定，但不得把 P-03 或 FTS 刷新放进写事务。

## 6. P0 验收范围

- `EVT-01`～`EVT-18`、`EVT-21`～`EVT-24` 的 Event Analysis 责任。
- `PMT-14`：NEW_EVENT 自造 ID、NO_INCREMENT 缺合法 Event ID 等严格 Schema/引用拒绝。
- `PMT-15`：P-03 非法 JSON、额外字段、错误类型拒绝。
- `E2E-14` 的分析部分：同公司同主题不同监管机构新调查可归属同一 Event，由 P-03 判断，不按机构名称强拆。
- `PMT-09`：P-03 不注入 User Context。

## 7. 不属于 D09 / 不冒充

- 真实模型语义质量 `EVT-19/20`、`PMT-03/04` 属 S0，不用 Stub 冒充。
- 不实现 Topic Matching、PublishTask、Published Item、RSS、Runtime 队列/重试/Cron/HTTP route。
- 不修改 D08 候选算法、maxCandidates/maxUpdates 契约或 D01 DDL。
- 不做跨文章语义去重、历史摘要、额外 LLM 审核、来源 URL 生成。
- 不宣称严格语义 Exactly-once 或崩溃恢复。

## 8. 持续授权

沿用项目已批准规则：G3 后 Architect 创建 10 分钟心跳；本地 Gate 后 push 并核验精确 SHA CI；最终验收后删除心跳并归档 Lead/Worker/workspace。每卡冻结与交回必须同一次回复给出。
