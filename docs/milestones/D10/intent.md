# D10 Intent：Topic Matching / 关注范围关联

- 状态：`APPROVED · G1`
- 批准日期：2026-11-19
- 依赖基线：D07 Knowledge、D09 Event Analysis 均已最终验收；main `a6934b1`。
- 上游：D01 `topics`/`topic_associations`/`published_items`/DDL，D02 P-05 typed call，D03 Topic 配置仓储，D07 Knowledge，D09 Event/Event Update。

## 1. 目标

对已经形成的 `EVENT`、`EVENT_UPDATE` 或 `KNOWLEDGE`，以当前**启用** Topic 的快照执行一次 P-05 批量语义匹配，并在一个短事务内保存合法关联；返回是否需要下游发布，但不自身派发任务。

D10 是「匹配是唯一发布门槛」的判定点：只有存在至少一条 Topic Association 的目标才有发布资格。

## 2. 业务规则

1. 只匹配 `enabled=1` 的 Topic，顺序按 `id` BINARY 升序，作为本次执行的唯一快照。
2. 目标不存在（合法形式但库中无记录）属于无效业务目标：拒绝、不调 LLM、不写关联、不返回发布资格。
3. 目标已有 Published Item：直接正常结束，不调 LLM，不产生新的发布资格。
4. 目标已有任意 Topic Association：不调 LLM，直接返回可发布，不重复写关联。
5. 没有任何启用 Topic：不调 LLM，不写关联，不可发布。
6. 一次 P-05 调用批量判断全部启用 Topic；不拆分、不逐 Topic 调用、不重试。
7. `matched_topic_ids=[]` 是成功空结果：不保存负结果，不产生发布资格。
8. 返回的 ID 必须全部来自本次启用快照；非法 ID、非数组属于模型输出错误，不写任何关联。
9. 重复 ID 由 D02 或业务层去重，只保存唯一关联。
10. 匹配多个 Topic 只返回一个发布资格，不产生多条下游任务，不设主 Topic、评分或排名。
11. `EVENT_UPDATE` 只以本次进展为主要匹配对象，父 Event 仅作背景；**不继承父 Event 的既有 Topic 关联**。
12. 保存关联后 Topic 被禁用或修改，不删除既有历史关联；后续新目标才读取新快照。
13. 关联写入必须在同一个同步短事务内；事务内不得调用 LLM 或执行网络 I/O。
14. 不修改任何 Prompt、DDL 或既有模块的公共行为。

## 3. 公共契约草案

```ts
type TopicTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

interface TopicMatchingResult {
  should_publish: boolean;
  target_type: TopicTargetType;
  target_id: string;
}

interface TopicMatchingService {
  match(
    targetType: TopicTargetType,
    targetId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TopicMatchingResult>;
}
```

- 稳定错误：`invalid_input | aborted | target_not_found | topic_matching_failed | llm_failed`。
- 不返回关联列表、模型原文、评分或 Prompt；不返回队列或 Published Item。

## 4. 四卡范围

1. 三类目标的最小匹配 DTO 与只读目标仓储；不加载父 Event 全历史。
2. 启用 Topic 快照、P-05 task data/references、单次调用、严格 ID 校验、取消与安全错误。
3. 关联写入短事务、发布资格、多 Topic 单结果、零匹配不写。
4. 公共 factory、复用与跳过、禁用 Topic 不删历史、真实 SQLite 集成与 P0 Gate。

## 5. P0 验收范围

`TOP-01`～`TOP-05`、`TOP-08`～`TOP-12`、`TOP-14`～`TOP-16`、`PMT-07`（Topic 分支）、`PMT-09`（P-05 无 User Context）。

## 6. 不属于 D10 / 不冒充

- `TOP-06`/`TOP-07` 的重复执行与发布复用属于 D10；真正的 PublishTask 派发、队列、重试、Cron 属 Runtime，不在本里程碑。
- Published Item 生成、模板渲染、RSS 属 D11/D12。
- `PMT-06` 真实模型语义为 S0，不用 Stub 冒充。
- 不做历史重匹配、跨目标继承、向量检索、Topic 自动生成或 LLM 二次审核。
