# D10 Spec：Topic Matching / 关注范围关联

- 状态：`APPROVED · G2`
- 版本：v0.1
- Intent：`docs/milestones/D10/intent.md`（G1 已批准）。
- 实现基线：D09 最终验收，main `a6934b1`。

## 1. 公共契约

```ts
export type TopicTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

export interface TopicMatchingResult {
  should_publish: boolean;
  target_type: TopicTargetType;
  target_id: string;
}

export interface TopicMatchingOptions {
  readonly signal?: AbortSignal;
}

export interface TopicMatchingService {
  match(
    targetType: TopicTargetType,
    targetId: string,
    options?: TopicMatchingOptions,
  ): Promise<TopicMatchingResult>;
}

export function createTopicMatching(
  dependencies: TopicMatchingDependencies,
): TopicMatchingService;
```

依赖：

| 依赖 | 用途 |
|---|---|
| `database` | 事务与只读复核 |
| `targetRepository` | 按类型读取目标 DTO；含父 Event 基础背景 |
| `topicRepository` | `listEnabled()` 启用快照 |
| `associationRepository` | `existsForTarget`、`insertIfAbsent`、读回 |
| `publishedItemRepository` | `existsForTarget` |
| `typedLlmCalls` | 仅 `matchTopics` |
| `clock` | `matched_at` |
| `logger` | 白名单 best-effort |

- 不依赖 IdGenerator：`topic_associations` 主键为 `(topic_id,target_type,target_id)`，无独立 ID。
- 不新增表、列、索引或状态字段。

## 2. 执行顺序

1. 校验 `targetType` 属于三值枚举、`targetId` 为非空白字符串；否则 `invalid_input`，零 DB/LLM。
2. pre-abort → `aborted`，零 DB/LLM。
3. 读取目标 DTO；不存在 → `target_not_found`，零 LLM、零写入。
4. 读取 Published Item 是否存在；存在 → `{should_publish:false}`，零 LLM。
5. 读取是否已有任意 Topic Association；存在 → `{should_publish:true}`，零 LLM、零写入。
6. 读取启用 Topic 快照（`enabled=1`，`id` BINARY ASC）；为空 → `{should_publish:false}`，零 LLM。
7. 事务外恰好一次 `matchTopics(taskData, references, {signal})`。
8. D02 负责 strict Schema、ID 引用校验与首次顺序去重。
9. `matched_topic_ids` 为空 → `{should_publish:false}`，零写入。
10. 一个同步短事务：重新确认目标存在、重新确认尚无关联、按快照顺序插入缺失关联并读回。
11. COMMIT 后返回 `{should_publish:true}`。

## 3. P-05 输入契约

```ts
taskData = {
  target: <目标上下文 DTO>,
  topics: [{ id, name, description }]   // 仅启用，id BINARY ASC
}

references = { enabledTopicIds: topics.map(t => t.id) }
```

- 不注入 `user_context`、Content 正文、raw_data、历史 Content/Event/Knowledge、评分或 Topic 统计。
- 目标上下文 DTO 见 §4；全部字段显式投影，不 spread 数据库行。

## 4. 三类目标 DTO

```ts
// EVENT
{ target_type:"EVENT", id, title, entity_name, subject, scope, description, occurred_at }

// EVENT_UPDATE：本次进展 + 父 Event 基础背景
{ target_type:"EVENT_UPDATE", id, event_id,
  title, description, occurred_at,
  event: { id, title, entity_name, subject, scope, description } }

// KNOWLEDGE
{ target_type:"KNOWLEDGE", id, title, summary, category, findings, value }
```

- `EVENT_UPDATE` 只取父 Event 的五个基础字段，**不加载任何 Event Update**，不携带父 Event 的 Topic 关联。
- `KNOWLEDGE.findings` 来自 `findings_json` 解析后的数组，元素仅 `title`/`description`。
- `category` 可为 SQL NULL，投影为 `null`。
- 不得携带 `content_id`、`source_id`、`url`、`created_at`、`raw_data`、Token。

## 5. 关联与发布资格

- 关联行：`(topic_id, target_type, target_id, matched_at)`。
- `matched_at = formatTimestamp(clock.now())`，每次事务内取一次，全部关联共用同一时间。
- `insertIfAbsent` 使用 `ON CONFLICT DO NOTHING`；`changes=0` 表示已存在，不覆盖。
- 多 Topic 只产生一个 `should_publish:true`，不返回关联列表。
- 零匹配不写任何行，不写“已检查未命中”状态；后续重跑允许再次调用 LLM。

## 6. 复用与跳过

| 状态 | LLM | 写入 | 返回 |
|---|---|---|---|
| 目标不存在 | 0 | 0 | `target_not_found` 错误 |
| 已有 Published Item | 0 | 0 | `should_publish:false` |
| 已有任意 Association | 0 | 0 | `should_publish:true` |
| 无启用 Topic | 0 | 0 | `should_publish:false` |
| 匹配为空 | 1 | 0 | `should_publish:false` |
| 匹配非空 | 1 | N 行 | `should_publish:true` |

- 已有关联时不因 Topic 随后禁用而删除；不重判 `enabled`。
- 不自动继承父 Event 关联到 `EVENT_UPDATE`。

## 7. 原子性与读回

- 使用 D01 `withTransaction()`；回调同步，thenable 拒绝。
- 事务内重新读取目标存在性与关联存在性，避免事务外快照竞态。
- 插入后读回每条关联，校验四个字段与 `matched_at`。
- 任一写入或读回失败，全部回滚，不返回 `should_publish:true`。
- 事务内不调用 LLM、网络、异步 logger。

## 8. 错误与日志

| code | 固定 message | 边界 |
|---|---|---|
| `invalid_input` | `Invalid topic matching input` | 非法 targetType/targetId |
| `aborted` | `Topic matching was aborted` | pre-abort、调用中/返回后取消 |
| `target_not_found` | `Topic matching target not found` | 目标不存在 |
| `topic_matching_failed` | `Topic matching operation failed` | DB、关联写入、读回失败 |
| `llm_failed` | `Topic matching LLM call failed` | Prompt、JSON、Schema、ID 引用 |

logger 白名单：`targetType`、`targetId`、`enabledTopicCount`、`matchedTopicCount`、`stage`、`reason`；stage 仅 `check|match|persist`。不记录 Topic 名称/描述、目标标题/正文、模型原文、SQL 或 Prompt。best-effort，logger 失败不改变业务结果。

## 9. 测试矩阵

| Case | 必须证明 |
|---|---|
| `TOP-01` | EVENT 匹配单 Topic：写 1 行关联，`should_publish:true` |
| `TOP-02` | 匹配 2 个 Topic：写 2 行，仍只返回 1 个发布资格 |
| `TOP-03` | 空匹配：零关联、`should_publish:false`、目标保留 |
| `TOP-04` | 无启用 Topic：LLM 0 次、零关联、不可发布 |
| `TOP-05` | 返回禁用 Topic ID：D02 拒绝、零关联 |
| `TOP-06` | 已有关联且未发布：LLM 0 次、不重复写、可发布 |
| `TOP-07` | 已有 Published Item：LLM 0 次、不可发布 |
| `TOP-08` | 父 Event 已关联，Update 匹配为空：不继承 |
| `TOP-09` | Update 只匹配自身相关的另一 Topic |
| `TOP-10` | 读取快照后 Topic 被禁用：本次仍按原快照完成 |
| `TOP-11` | 新增/修改 Topic 不触发历史重匹配 |
| `TOP-12` | 重复 ID 去重；非法 ID/非数组拒绝且零写入 |
| `TOP-14` | Knowledge 上下文含 Title/Summary/Category/Findings/Value |
| `TOP-15` | 不存在的目标 ID：零 LLM、零关联、稳定错误 |
| `TOP-16` | 关联后 Topic 禁用：既有行不删，仍可发布 |
| `PMT-07` | 非 JSON/缺字段/额外字段/错误类型全部拒绝 |
| `PMT-09` | P-05 task data 无 user_context |
| `ATOMIC` | 事务内无 LLM；失败全回滚；thenable 拒绝 |
| `PRIVACY` | 日志/错误无 Topic 名称、正文、Prompt、Token |

`PMT-06` 真实模型语义为 S0，不纳入 P0 Gate。

## 10. 冻结边界

不得修改 D01 DDL/FTS、D02 Schema/Prompt 行为、D03 配置 API、D04～D09 任何模块、app/server/lifecycle、CI、package/lock、真实 Prompt 与 User Context。

不新增依赖、队列、Runtime 派发、Published Item 生成、RSS 或历史重匹配。

## 11. Gate

- 四卡：T01 目标 DTO 与只读仓储；T02 启用快照与 P-05 调用；T03 关联事务与发布资格；T04 公共 factory 与真实 SQLite 集成。
- 每卡 Worker REVIEW → Lead 同回复冻结 → Architect G4 → candidate → `--no-ff` merge → 合并后复验 → 归档。
- 最终 PASS 需 Architect 独立干净快照 Gate 与精确 pushed SHA 远程 CI Success。
