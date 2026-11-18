# D08 Intent：Event Search / 历史 Event 候选召回

- 状态：`APPROVED · G1 PASS`
- 负责人确认：2026-11-18 批准开发，并要求每候选 Update 数量可配置；已落实 `maxUpdates` 默认 10、`0..100`。
- 日期：2026-11-18
- 依赖基线：D07 最终 PASS；main `09640c3`；远程 CI Success。
- 上游：D01 Event FTS5，D02 P-02 typed call，D06 Content。

## 1. 目标

为 D09 Event Analysis 提供独立、只读、可复现的历史 Event 候选召回服务：当前 Content 经一次 P-02 提取多组检索线索，再从全部历史 Event、已确认别名及 Event/Update 聚合 FTS 文本召回候选，为每个候选组装基本信息与可配置数量的最近 Update。

本里程碑只产生候选 DTO，不做 Event 归属或事实增量判断，不调用 P-03，不写业务表。

## 2. 业务规则

1. 公共入口接收 Content ID；Content 不存在返回成功空结果，不调用 P-02、不查询候选。
2. P-02 是唯一线索提取模型调用；输入只含当前 Content 的 `title/body/summary/author/published_at/completeness`，不含历史 Event、Topics、User Context、Knowledge 或 raw_data。
3. `clues=[]` 是合法结果：直接返回空候选，不执行无意义数据库检索；不得强造线索。
4. 多组线索分别检索；同一实体的不同 Subject 不得因主体相同而合并。
5. `entity_name`、`subject`、`search_terms` 均为临时检索线索，不写入 `event_entity_aliases`，也不成为已确认别名。
6. 搜索覆盖全部历史 Event。时间只参与候选排序和上下文展示，绝不作为召回的硬排除条件。
7. 组合实体标准名、已确认别名普通索引与 Event FTS5 聚合文本召回；Event FTS 聚合包含 Event 基本资料、全部别名、全部 Update 文本。
8. 命中同一 Event 的多个线索或多条索引只产生一个候选；不同 Event 即使别名文字相同也保持独立。
9. 每个候选包含 Event 基本字段及可配置数量的最近 Update：默认 10 条，允许 `0..100` 的整数；选择按 `discovered_at DESC, id DESC`，输出按旧→新排列。配置为 0 时只返回 Event 基本资料。无论窗口大小，检索仍覆盖窗口以外的全部历史。
10. 无候选是正常结果，不是错误，不虚构 Event ID；D09 可据此继续 P-03 判断 NEW_EVENT。
11. 候选上限只限制最终输出，不限制历史检索范围；去重后再执行确定性排序和截断。

## 3. 职责边界

### 属于 D08

- Content 点读与 P-02 六字段输入组装。
- 一次 P-02 调用、严格响应错误映射与取消。
- 只读候选检索、跨线索去重、确定性排序和上限。
- Event 候选 DTO 与可配置数量的最近 Update 上下文。
- 真实 SQLite + StubLLM + 合成 Prompt 的端到端测试。

### 不属于 D08

- P-03 Event Analysis、NEW_EVENT/NEW_UPDATE/NO_INCREMENT。
- Event、Update、证据、确认别名、FTS 写入或重建。
- Topic Matching、Knowledge Analysis、Published Item、RSS。
- Runtime 队列、重试、派发、HTTP route、Cron 或生产配置接线。
- 真实模型语义质量验收；PMT-02 属 S0，EVT-19/20 属后续真实模型判断。

## 4. 技术契约草案

```ts
interface EventSearchService {
  search(
    contentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    candidates: EventCandidate[];
  }>;
}

interface EventCandidate {
  id: string;
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
  updates: EventCandidateUpdate[]; // 默认最多 10 条，可配置 0..100
}
```

- 不返回临时 clues 或检索分数；它们只在本次调用内部使用。
- 不返回 Event 全历史 Update；模型上下文数量由 `maxUpdates` 控制，默认 10，可配置 `0..100`。
- 候选上限和排序规则由 Spec 固定为确定性配置，不由模型决定。
- 稳定错误：`invalid_input | aborted | event_search_failed | llm_failed`。
- P-02 调用在任何写事务之外；D08 正常路径零业务写、零 FTS 写。

## 5. P0 验收范围

- `EVT-06`：同一实体两个不同事项分别检索，不自动合并。
- `EVT-10`：多年未更新 Event 仍可由别名或 FTS 命中。
- `EVT-11`：默认窗口下 12 条 Update 只输出最近 10 条，同时间按 ID 稳定决胜；另验证窗口调大、调小和 0。
- `EVT-21`：合法空 clues 返回空候选、无无意义检索、零写入。
- `EVT-22`：有线索但无候选正常返回；不得虚构 Event。
- `EVT-23`：第 11 条以前的线索仍召回，但模型上下文不偷加旧 Update。
- `EVT-24`：相同别名文字的不同 Event 保持独立候选与各自上下文。
- `PMT-09`：P-02 不注入 User Context。
- `PMT-15`：非法 P-02 JSON/Schema/额外字段拒绝且不产生候选。

## 6. 明确不冒充

- 不把固定 Stub 的 clues 当作真实模型语义质量。
- 不把 FTS 命中当作 Event 归属正确；最终归 P-03。
- 不宣称 D08 已能创建 Event、Update、证据或别名。
- 不将 D09、D10、Runtime 的 Case 标为 D08 PASS。

## 7. 持续授权

沿用项目已批准规则：G3 后 Architect 创建 10 分钟心跳；本地 Gate 后 push 并核验精确 SHA CI；最终验收后删除心跳并归档 Lead/Worker/workspace。
