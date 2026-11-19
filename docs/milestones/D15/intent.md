# D15 Intent：六阶段 Runtime 与调度

- 状态：`APPROVED · G1`
- 批准日期：2026-11-19
- 依赖基线：D00～D14 业务接口；当前已交付至 D10，main `376e15e`。
- 上游：D05 Collection、D06 Processing、D07 Knowledge Analysis、D09 Event Analysis、D10 Topic Matching；D11 Product Generation 未交付，Runtime 以其已批准接口形状注入。

## 1. 目标

实现 PIS 六阶段 Runtime：把 Collection → Processing → Event/Knowledge Analysis → Topic Matching → Product Generation 串成统一编排，具备：

- 六类任务的 TypeScript 判别联合，输入只传业务 ID
- 每阶段独立**有界内存队列** + 初始 1 个 Worker
- 结果驱动的**统一下游派发**，业务模块不持有其他模块的队列引用
- 技术性错误最多执行 **2 次（含首次）**；正常空结果、非法输入、取消不重试
- 已 COMMIT 后的**下游入队失败**只重试未入队的派发，不重做上游业务/LLM
- Cron 对启用 Source 调度；优雅关闭先停新增，尽力排空后退出
- 超时取消剩余工作，不死锁、不新增持久化任务状态

## 2. 业务规则

1. 六类任务：`CollectTask`、`ProcessTask`、`EventAnalysisTask`、`KnowledgeAnalysisTask`、`TopicMatchingTask`、`PublishTask`。
2. 任务只包含业务 ID，不含对象、正文、模型输出或队列引用。
3. 正常空结果（无新条目、空路由、无增量、价值不足、无匹配、已发布）是**成功**，不重试、不生成下游。
4. 技术性错误（网络、超时、SQLite 短暂锁、LLM 无效 JSON/Schema/引用）最多执行 2 次。
5. 非法输入、无效目标、取消**不重试**；取消必须向上传播，不能误判为空结果。
6. 上游已 COMMIT 而入队失败：只重试尚未成功入队的下游，**不重跑上游业务或 LLM**。
7. 多个下游任务彼此独立派发：第一个成功绝不重复入队，第二个单独重试。
8. 队列满时**背压等待**，正常运行不直接丢弃任务；停止时解除等待。
9. 关闭先停 Cron 与新增外部任务，内部已接受链路仍可派发下游；等待排队、执行、入队等待、有限重试全部结束后才关闭。
10. 超过关闭预算则取消剩余工作并记录，保证进程可退出；不保证重启恢复。
11. 六阶段之外的任务（API GET、静态 RSS 同步）**不进入业务队列**。
12. 崩溃发生在 COMMIT 与入队之间可能漏派，这是 V1 已接受窗口；不新增 Outbox、任务表或扫表恢复。

## 3. 公共契约草案

```ts
type RuntimeTask =
  | { type: "COLLECT"; source_id: string }
  | { type: "PROCESS"; source_item_id: string }
  | { type: "EVENT_ANALYSIS"; content_id: string }
  | { type: "KNOWLEDGE_ANALYSIS"; content_id: string }
  | { type: "TOPIC_MATCHING"; target_type: TargetType; target_id: string }
  | { type: "PUBLISH"; target_type: TargetType; target_id: string };

interface RuntimeOptions {
  queueCapacity?: number;      // 每阶段独立容量，默认有界正整数
  maxAttempts?: number;        // 默认 2（含首次）
  dispatchAttempts?: number;   // 下游入队最大尝试次数，默认 2
  shutdownTimeoutMs?: number;  // 优雅关闭预算
  clock?: Clock;
}

interface Runtime {
  submit(task: RuntimeTask): Promise<void>;
  start(): Promise<void>;
  drain(): Promise<void>;
  shutdown(): Promise<void>;
}
```

- `submit` 在队列满时等待，不抛"队列满"错误。
- `drain()` 等待当前已接受链路全部完成。
- 稳定错误分类：`retryable | non_retryable | cancelled`。
- 不返回业务对象、模型原文或队列内部状态。

## 4. 五卡范围

1. 六类 Task/Result 判别联合、结果→下游任务纯映射、错误分类。
2. 独立有界内存队列 + 单 Worker + 背压等待。
3. 有限重试、派发失败只重试下游、错误边界与事务外网络证明。
4. Cron 调度启用 Source、手工触发适配、时区与表达式校验。
5. 优雅关闭、超时取消、真实 SQLite 六阶段集成与 P0 Gate。

## 5. P0 验收范围

`RUN-01`～`RUN-07`、`RUN-08`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07`。

`RUN-13`/`RUN-14` 为 P1：崩溃窗口与日志量检查，不作为 P0 阻断项，但需记录已接受边界。

## 6. 不属于 D15 / 不冒充

- 不实现 Published Item 模板、RSS 生成、云端上传、API 查询。
- 不实现持久化队列、Outbox、任务恢复、Exactly-once、分布式 Worker、Redis。
- 不让业务模块自行管理 Worker 或持有下游队列。
- 不把云端 RSS 同步变成第七种业务任务。
- 真实模型语义回归属 D16/S0，不在 D15 冒充通过。
