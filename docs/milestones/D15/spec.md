# D15 Spec：六阶段 Runtime 与调度

- 状态：`APPROVED · G2`
- 版本：v0.1
- Intent：`docs/milestones/D15/intent.md`（G1 已批准）。
- 实现基线：D10 最终验收，main `376e15e`。

## 1. 任务契约

```ts
export type TargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

export type RuntimeTask =
  | { readonly type: "COLLECT"; readonly source_id: string }
  | { readonly type: "PROCESS"; readonly source_item_id: string }
  | { readonly type: "EVENT_ANALYSIS"; readonly content_id: string }
  | { readonly type: "KNOWLEDGE_ANALYSIS"; readonly content_id: string }
  | { readonly type: "TOPIC_MATCHING"; readonly target_type: TargetType; readonly target_id: string }
  | { readonly type: "PUBLISH"; readonly target_type: TargetType; readonly target_id: string };

export type RuntimeTaskType = RuntimeTask["type"];
```

- 六种且仅六种；序列化/反序列化后不得携带额外字段。
- 任务不含正文、对象、模型输出、AbortSignal 或函数。

## 2. 阶段结果与下游映射（纯函数）

| 任务 | 业务服务调用 | 结果 | 下游任务 |
|---|---|---|---|
| COLLECT | `collect(source_id)` | `new_source_item_ids[]` | 每个新 ID → `PROCESS` |
| PROCESS | `process(source_item_id)` | `{content_id, routes[]}` | 按 routes → `EVENT_ANALYSIS` 和/或 `KNOWLEDGE_ANALYSIS` |
| EVENT_ANALYSIS | `analyze(content_id)` | `new_targets[]` | 每个目标 → `TOPIC_MATCHING` |
| KNOWLEDGE_ANALYSIS | `analyze(content_id)` | `{knowledge_id}` | 非空 → `TOPIC_MATCHING(KNOWLEDGE)` |
| TOPIC_MATCHING | `match(type,id)` | `{should_publish}` | true → `PUBLISH` |
| PUBLISH | `publish(type,id)` | `{published_item_id}` | 无 |

- 纯函数 `mapResultToDownstreamTasks(task, result): RuntimeTask[]`。
- 空数组/空 ID/false → `[]`，这是成功空结果。
- `PROCESS` 的 `content_id=null` 或 `routes=[]` → `[]`。
- 业务模块只被调用，不持有 Runtime、队列或其他模块引用。

## 3. 错误分类

| 类别 | 判定 | 行为 |
|---|---|---|
| `retryable` | 网络/超时/SQLite 短暂锁/LLM JSON、Schema、引用错误 | 最多 2 次（含首次） |
| `non_retryable` | 非法输入、目标不存在、配置无效 | 立即终止，不重试 |
| `cancelled` | AbortError、ABORT_ERR、LLM_CANCELLED、显式取消 | 向上传播，不重试，不算空结果 |
| `success_empty` | 空结果 | 正常完成，不重试、不派发 |

各业务模块错误码映射：

| 模块错误 | 分类 |
|---|---|
| `*_failed`（llm_failed、collection_failed、processing_failed、event_analysis_failed、knowledge_failed、topic_matching_failed） | `retryable` |
| `invalid_input`、`target_not_found` | `non_retryable` |
| `aborted` | `cancelled` |

- 重试前不重置业务状态；模块自身的低成本重复保护（复用 Content/Knowledge/Association）负责幂等。
- 耗尽后记录日志并结束该任务；不新增失败状态表。

## 4. 有界内存队列

```ts
interface BoundedQueueOptions {
  readonly capacity: number;   // 正整数，默认 8
  readonly signal?: AbortSignal;
}

class BoundedTaskQueue {
  enqueue(task: RuntimeTask): Promise<void>;  // 满则等待
  dequeue(): Promise<RuntimeTask | null>;      // 空则等待
  close(): void;                               // 唤醒所有等待者
  readonly size: number;
  readonly isClosed: boolean;
}
```

- `enqueue` 在容量满时等待空位，不抛"队列满"。
- `close()` 后 `enqueue` 拒绝新任务，`dequeue` 返回 `null`，等待者全部唤醒。
- 队列内部不执行任务、不调用业务模块。

## 5. Worker 与 Runtime

```ts
interface RuntimeDependencies {
  readonly services: StageServices;   // 六阶段业务服务
  readonly queueCapacity?: number;    // 默认 8
  readonly maxAttempts?: number;      // 默认 2
  readonly dispatchAttempts?: number; // 默认 2
  readonly shutdownTimeoutMs?: number;// 默认 5000
  readonly logger?: RuntimeLogger;
}

interface StageServices {
  collect(sourceId: string, options: { signal?: AbortSignal }): Promise<CollectResult>;
  process(sourceItemId: string, options: { signal?: AbortSignal }): Promise<ProcessResult>;
  analyzeEvent(contentId: string, options: { signal?: AbortSignal }): Promise<EventAnalysisResult>;
  analyzeKnowledge(contentId: string, options: { signal?: AbortSignal }): Promise<KnowledgeResult>;
  matchTopics(type: TargetType, id: string, options: { signal?: AbortSignal }): Promise<TopicMatchingResult>;
  publish(type: TargetType, id: string, options: { signal?: AbortSignal }): Promise<PublishResult>;
}
```

- 六阶段各有独立队列与 1 个 Worker，互不共享容量。
- Worker 串行消费本阶段队列，处理完成后由 Runtime 统一派发下游。
- 派发失败按 `dispatchAttempts` 重试，**不重新执行业务服务**。
- 多下游任务：已成功的绝不重复入队，失败的单独重试。
- `submit` 在 Runtime 停止接受新任务后拒绝；内部派发不受此限制。

## 6. 优雅关闭

```ts
await runtime.stopAccepting();  // 停 Cron + 拒绝外部 submit
await runtime.drain();          // 等待已接受链路完成
await runtime.shutdown();       // 关队列、Worker、释放资源
```

- `shutdown({timeoutMs})` 超时则 `abort()` 剩余工作并记录，随后强制退出等待。
- 已取消的任务按 `cancelled` 处理，不重试。
- 关闭后再次 `submit` 必须拒绝；内部已接受链路可继续派发直至排空或超时。
- 不调用 `process.exit()`，由调用方决定进程生命周期。

## 7. Cron 调度

```ts
interface CronSchedulerOptions {
  readonly timezone: string;            // 默认 "Asia/Shanghai"
  readonly sources: Pick<SourceRepository,"listEnabled">;
  readonly submit: (task: RuntimeTask) => Promise<void>;
}

interface CronScheduler {
  start(): void;
  stop(): void;
  trigger(sourceId: string): Promise<void>;  // 手工触发
}
```

- 使用已确认的 `node-cron`；启动时校验每个启用 Source 的 Cron 表达式与时区。
- 只调度 `enabled=1` 的 Source；禁用 Source 不注册、不触发。
- Cron 触发只向 Collection 提交 `COLLECT` 任务，不直接调用 Adapter。
- 非法表达式在启动时抛 `invalid_cron`；不产生部分注册。
- `stop()` 只停调度，不影响已入队任务。

## 8. 日志与隐私

白名单：`taskType`、`taskId`、`stage`、`attempt`、`maxAttempts`、`queueSize`、`reason`、`durationMs`。

- 不记录正文、Prompt、模型原文、Token、URL、SQL。
- 重试、派发失败、关闭取消均记录类型/ID/次数。
- logger best-effort，自身失败不改变业务结果。

## 9. 测试矩阵

| Case | 必须证明 |
|---|---|
| `RUN-01` | 六类任务返回新结果 → 正确后继任务；业务模块无队列引用 |
| `RUN-02` | 无新条目/空路由/无增量/价值不足/无匹配 → 正常空结果，不重试、不派发 |
| `RUN-03` | 技术错误最多执行 2 次；第二次成功继续，第二次失败终止 |
| `RUN-04` | 非法输入/无效目标/取消不重试；取消向上传播 |
| `RUN-05` | COMMIT 后入队失败一次：只重试未入队下游，不重新运行上游/LLM |
| `RUN-06` | 两个下游任务：第一个成功不重复，第二个单独重试 |
| `RUN-07` | 上游提交失败不派发；可按技术规则重试上游 |
| `RUN-08` | 队列满时背压等待，Worker 消费后恢复，不丢任务 |
| `RUN-09` | Cron 只向 Collection 排队；API GET/静态同步不进业务队列 |
| `RUN-10` | 关闭前已有排队/执行/背压/重试任务：停新增、内部继续派发、排空后关闭 |
| `RUN-11` | 关闭超时后取消剩余工作、解除等待、不死锁 |
| `RUN-12` | Event/Knowledge 双路独立，一路失败不影响另一路 |
| `RUN-15` | 非法 Event/Topic 引用是 retryable；不存在的业务目标 ID 是 non_retryable |
| `RUN-16` | HTTP/LLM 等待期间无写事务；短事务仅在写入阶段 |
| `CFG-03` | 禁用 Source 到达 Cron 时间不触发采集 |
| `CFG-07` | 非法 Cron 表达式拒绝，无部分注册 |

`RUN-13`/`RUN-14` 为 P1，记录已接受崩溃窗口与日志边界，不阻断 P0 Gate。

## 10. 冻结边界

- 不修改 D00～D10 任何业务实现、DDL、Prompt、配置 API、CI、package/lock。
- 不新增持久化任务表、Outbox、恢复扫描、Redis、分布式 Worker。
- 不实现 Published Item 模板、RSS 生成、云端上传或 API 查询。
- `node-cron` 已在依赖中；不新增其他依赖。

## 11. Gate

- 五卡严格串行：T01 任务契约与纯映射；T02 有界队列与 Worker；T03 重试与派发；T04 Cron 调度；T05 优雅关闭与六阶段集成。
- 每卡 Worker REVIEW → Lead 同回复冻结 → Architect G4 → candidate → `--no-ff` merge → 复验 → 归档。
- 最终 PASS 需 Architect 独立干净快照 Gate + 精确 pushed SHA 远程 CI Success。
