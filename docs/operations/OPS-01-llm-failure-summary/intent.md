# OPS-01 Intent：LLM 错误摘要与重试分类

- 类型：线上运行修复（非 D 系列版本功能演进）
- 状态：APPROVED · G1（负责人已批准创建文档后直接开发）
- 来源：`docs/operations/runtime-improvement-review-2026-11-22.md` 阶段 A
- 基线：main `4e50ccb8667b3e51a18dd3abc5948da3e2dc1f98`

## 问题

底层 LLM Client 已区分网络、HTTP、超时、响应协议与输出校验错误，但五类业务调用统一包装为 `llm_failed`，Runtime 无法准确记录失败原因或按底层类型决定是否重试。线上 HTTP 200 后的输出校验失败与 429/5xx、配置错误难以区分。

## 目标

1. 建立不含秘密的结构化 LLM failure summary，贯穿 Client、五类业务调用与 Runtime。
2. 保留既有模块错误 code 和六阶段任务/事务契约，新增安全分类、operation、HTTP status、retryable、final 日志字段。
3. 网络/超时/429/5xx 与偶发 JSON/Schema/引用/冲突允许最多两次；配置、非法输入、确定性 4xx、响应超限、明确取消不重试。
4. 每次尝试及最终失败可定位 operation、目标任务和原因，无需重放即可判断失败类别。
5. 重试继续依赖既有事务复检和唯一约束，不重复 Event、Knowledge、Association 或 Published Item。

## 固定边界

- 每阶段最多两次（含首次），本轮不引入 backoff/Retry-After。
- JSON/Schema/引用/冲突可重试，是因为真实回归已证明偶发格式波动；不得剥离代码围栏、修复 JSON 或放宽 Zod。
- 不改变 temperature/top_p/max_tokens/response_format；生产请求继续只发送 model、stream:false 和两条 messages。
- 不新增数据库表、失败状态查询、补跑、持久化队列、监控接口、Pages/Scheduler 改造或 `/health` 业务健康度。
- 不修改 Prompt、Published Item、RSS、Source/Topic 配置、API DTO、package/lock。
- 日志不得含异常 message、正文、Prompt、User Context、完整 endpoint、Token、model、SQL、堆栈、原始响应或 Zod issue 内容。

## 验收

- HTTP 200+Schema 错误与 HTTP 429/500 在日志中可明确区分。
- 配置错误、非法输入、确定性 4xx 和取消只执行一次；允许重试的错误最多两次，第二次成功只派发一次下游。
- 空 Content/reasoning-only、非预期 finish reason、截断等响应协议问题具有安全子原因和明确重试行为。
- 全部既有测试及新增分类/日志/幂等测试通过；真实模型做有限针对性复验，不追求消除正常格式波动。
- 每卡 G4、merge 后全量 Gate、最终干净快照和精确 SHA Linux CI Success；完成后交负责人审核。
