# 运行问题复核与后续改造方案

> 来源：`PIS_运行问题与优化需求_2026-11-22.md`（运维试运行反馈）。  
> 本文性质：Architect 复核与后续设计输入，不是已批准的实施 Spec/Plan，也不代表问题已经修复。  
> 当前决定：`/health` 保持纯 liveness，不在本轮扩展业务健康度、失败统计或告警职责。

## 1. 复核结论

运维报告中的 P0/P1/P2 是影响分级，不等同于《PIS V1 测试用例设计》的 P0/P1 Case 优先级。多数问题真实存在，主要风险是错误定位困难、最终状态不可见、恢复依赖重启/后续通知，以及首轮处理规模不可控；不能据此直接推断已经产生错误业务数据。

| 项目 | 复核结论 | 本轮建议优先级 |
|---|---|---|
| LLM 失败原因不清 | **确认**。底层已有细分类，业务包装层统一成 `llm_failed`，Runtime 丢失原因 | **最高，优先详细设计** |
| 重试与错误类型不匹配 | **部分确认**。分类信息丢失；但 JSON/Schema/引用错误存在偶发性，不能一律禁止重试 | **最高，与错误分类共同设计** |
| 失败目标查询和补跑 | **确认缺口**。当前无失败状态表、失败查询或补跑 API；涉及已批准的“无持久化任务状态”边界 | 第二，需架构审批 |
| 首轮 Feed 处理量不可控 | **确认**。`maxFeedEntries` 是解析上限，不是首轮处理预算 | 第二，扩大 Source 前完成 |
| Pages 通知结果状态不清 | **确认**。只有 best-effort 通知与启动校准，无独立周期恢复和状态查询 | 第三 |
| Source 配置与调度不一致 | **确认**。Scheduler 只在启动时读取配置，enabled/cron 修改不热更新 | 第三 |
| `/health` 不含业务健康度 | 现象存在，但**本轮明确不处理**。health 只负责 liveness，业务可靠性和统计不属其职责 | **忽略，不立项** |
| 模型成本与格式稳定性 | **确认缺少 operation 级指标**；真实模型已观察到偶发格式波动 | 后续持续优化 |
| Event 归并和跨语言质量 | **需真实样本评估**。20 Content→39 Event 是评估信号，不足以证明过度拆分 | 后续独立语义评估 |

## 2. 已确认的实现根因

### 2.1 错误分类在包装层丢失

底层 `ChatCompletionsError` 已区分 HTTP、网络、超时、响应协议、响应大小和取消，并带安全 HTTP status/retryable；`LlmOutputValidationError` 已区分 JSON、Schema、引用和冲突。Processing、Knowledge、Event Search/Analysis、Topic Matching 将它们统一转换成 `llm_failed`，使 Runtime 和日志无法保留这些事实。

### 2.2 当前重试契约

六阶段 Runtime 各任务最多两次（含首次），立即重试，无退避。非法输入/目标不存在/取消不重试；无效 JSON、Schema、引用目前按既定设计属于可重试技术错误。真实模型回归中曾出现一次代码围栏格式错误、同输入复测恢复，因此“格式/Schema 错误一律不重试”不应直接接受。

### 2.3 没有失败结果模型

当前只有内存任务与日志，无持久化任务状态、最终失败清单或手工补跑接口。COMMIT 与下游入队之间的崩溃窗口已接受，不自动扫表恢复。未发布还可能表示无匹配、无需发布、尚未处理或已处理中，不能由 `published_items` 是否存在反推失败。

### 2.4 首轮预算与 Pages/Scheduler

RSS 全量读取是既定行为；`maxFeedEntries` 只限制单 Feed 解析数量，不限制文章正文请求、LLM 调用和下游发布总量。

Pages 通知失败不回滚 Published Item 是正确行为；当前可通过启动校准或后续通知间接补齐，但无独立周期重试、最近公开成功时间或状态接口。Source enabled/cron 修改只写数据库，已注册 Cron 到重启才刷新。

## 3. 后续改造方案（待逐阶段审批）

### 阶段 A：错误摘要与重试分类（最高优先级）

**交付状态：OPS-01 实现及离线验收脚本已交付；真实模型复验 PENDING，未签发最终验收。**

1. 在各业务 Error 上保留原稳定 `code`，新增安全的 failure summary：`operation/category/reason/retryable/httpStatus?`。
2. Runtime 日志白名单增加 operation、category、reason、HTTP status、attempt/maxAttempts、final、durationMs；记录每次尝试与最终耗尽。
3. 重试建议：
   - 网络、超时、429、5xx：retryable。
   - JSON/Schema/引用/冲突：保留最多两次，覆盖偶发格式波动。
   - 配置错误、非法输入、目标不存在、确定性 4xx：non-retryable。
   - 取消：cancelled，不重试。
4. 不记录原始异常 message、Prompt、正文、完整 endpoint、Token、模型响应或私有配置。
5. 验收要求：无需重放即可区分 HTTP 200+Schema 错误与 429/500；配置错误只调用一次；格式错误最多两次且业务幂等。

**本阶段先另行详细讨论数据结构和兼容性，再编写正式 Spec/Plan。**

### 阶段 B：失败结果查询与安全补跑

需先审批是否突破“无持久化任务状态”边界。推荐最小阶段执行结果记录，而非通用持久化队列：

- 任务类型/业务目标键、running/succeeded/failed/cancelled、尝试次数、最后安全类别/原因、开始/结束/更新时间。
- 不保存正文、Prompt、模型输出或 endpoint；不用于重启后自动扫表重跑。
- 查询区分未处理、处理中、最终失败、正常无需发布、已发布和 Pages 公开状态。
- 补跑仅提交既有 RuntimeTask，Bearer 鉴权、同目标 single-flight，复用现有事务复检和唯一约束。
- 不重复 Event、Knowledge、Association 或 Published Item；返回真实提交/执行结果，不盲报成功。

### 阶段 C：首轮处理预算

不简单“只取最新 N 条”以免永久漏采。建议 Source 首轮策略支持 full 与有界预算：

- 首轮只处理 N 个候选，其余记录为有意跳过，不能写成已采集 Source Item。
- 后续仍全量读取并依靠 Source Item 身份去重；提供预算递增/补采历史入口。
- 无日期、乱序、迟到条目不得因时间过滤永久漏掉。
- 记录首轮总数/处理数/跳过数，首批启用 Source 采用分批上线。

### 阶段 D：Pages 恢复与 Scheduler 热更新

Pages：

- 有界周期校准，不新增第七种 Runtime 任务；保持单 Feed 串行和 queued rerun 合并。
- 每 Feed 记录本地快照、通知失败类别、最近尝试、最近 commit、最近匿名公开成功时间。
- 只有匿名 origin bytes 匹配才算公开成功，Git push/PM2 online 不算。

Scheduler：

- 配置写成功后协调调度快照刷新，避免重复注册与并发刷新。
- 新快照注册成功后再销毁旧配置；失败保留旧调度并返回明确错误。
- 禁用停止未来 Cron，不取消已经接受的 Runtime 任务。

### 阶段 E：独立运行指标与质量评估（非 health）

如后续需要，另行设计独立运行状态接口，包含队列、Source、LLM operation 和 Pages 指标；不得改变 `/health` 的 liveness 语义。本轮不展开实施。

Event/跨语言质量用真实样本区分合理的一文多主线、跨来源重复拆分、共享实体错误合并，以及数字/否定/归因/时间/证据强度变化。样本不足时不通过 Prompt 强行降低 Event 数量。

## 4. 统一验收边界

- 错误日志、运行状态和指标不得包含秘密、Prompt、正文、完整私有 URL 或原始异常 message。
- 重试与补跑必须保持业务幂等，不重复创建业务资产或发布快照。
- PM2 online、health 200、Git push 成功均不代表业务链路或 Pages 公开成功。
- 真实 RSS、真实 LLM、公开 Pages 和真实阅读器证据分别记录，不用 Stub smoke 替代。
- 本轮不修改 `last_collected_at` 语义或 RSS 全量抓取方式。
- 每阶段先完成相应 Intent/Spec/Plan 门禁，再进入开发；本文不签发任何完成状态。
