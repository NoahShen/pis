# LLM 响应超时与结构化输出问题复核

> 来源：`PIS_LLM响应超时与结构化输出问题_2026-11-22.md`（6 个新增 RSS Source 的真实试运行）。  
> 性质：运维问题记录与优先级调整，不是已批准实施 Spec/Plan。  
> 关联：OPS-01 已完成错误摘要代码 Gate；真实合法调用因旧私有凭证 401 尚待补验。

## 1. 证据确认

- 网关共核对 261 次 PIS 请求：82 次 HTTP 499/agent canceled，中位约 60 秒；178 次 HTTP 200，中位约 35 秒、P90 约 55 秒、最大约 59.9 秒；另 1 次 HTTP 400 content_filter。
- 6 个新增 Source 产生 90 个 Source Item，但最终仅 60 个新 Content，30 个停留于未生成 Content 的不明状态。
- 多 operation 均出现 `llm_failed`，监控约一小时后仍未达到完整 E2E 条件。
- 日志计数不等于唯一目标/请求数，HTTP 200 也不等于协议、Schema 或业务成功。Pages 最终恢复一致不能证明业务链已完成。

这些证据足以确认**响应预算、吞吐、超时放大和失败恢复是真实生产阻塞**，不是单 Source 或单模型阶段问题。

## 2. 与现有实现的关系

1. 当前生产 Chat Completions 总超时固定默认 60 秒，无 operation 级时间/输出预算，也没有环境变量配置。
2. 每次请求等待完整响应后才读取首个 choice；没有流式增量处理，长 reasoning 与最终 Content 共用同一 60 秒预算。
3. Runtime 每阶段最多两次且立即重试，无退避；超时、网络、429/5xx 与格式/Schema 错误均可第二次。慢上游下这会放大延迟和请求量。
4. OPS-01 已能区分 timeout/network/http/response_protocol/output_validation，并记录 operation、attempt、durationMs、final；499 与本地 deadline 的具体归因仍需补充，不可把所有取消都称为上游超时。
5. 当前没有失败结果表、目标终态查询或安全补跑；因此 30 个 Source Item 未生成 Content 的状态无法通过业务 API 清晰解释和恢复。
6. `/health` 只负责 liveness，本轮仍不扩展其职责；业务可靠性需要独立状态/恢复设计。

## 3. 不能采取的简单方案

- **不能只把 60 秒调大**：HTTP 200 已普遍接近上限，简单延长会继续占用单 Worker、扩大队列与成本。
- **不能提高并发**：六阶段各一个 Worker 是背压边界，提高并发会放大上游限流和请求风暴。
- **不能立即重复补跑全部目标**：在响应预算和重试策略未修正前，可能再次产生同类超时。
- **不能把 HTTP 200 当成功**：必须继续通过 finish reason、Content、JSON、Schema 和引用校验。
- **不能强制换模型/网关**：应先做同配置测量与受控对照，再决定是否调整路由或模型。
- **不能牺牲 Schema**：不得剥离围栏、接受 reasoning-only 或放宽非法 Topic/Event ID。

## 4. 调整后的优先级

### OPS-02（建议）：LLM 响应预算、超时归因与重试放大治理

先于失败补跑实施，目标是在正常模型配置下恢复可控吞吐：

1. 按 operation 测量并设定有界响应预算，记录首次/重试耗时、deadline 类别和安全上游状态；不能全局盲目加时。
2. 区分 PIS 主动 deadline、调用方取消、上游断开、网关 499、HTTP 错误和 HTTP 200 后校验错误。
3. 对超时采用受控重试预算/退避，避免立即第二次造成请求风暴；确定性格式错误仍按 OPS-01 矩阵最多两次。
4. 评估结构化任务的 reasoning/输出成本，必要时做同输入模型路由对照；temperature、response_format 不擅自引入，Provider 兼容性需先验证。
5. 验证取消后迟到响应不会提交结果，重试不重复 Content/Event/Knowledge/Association/Published Item。
6. 用同一批或等效样本测量吞吐、P50/P90、499 和业务完成度，再进入补跑。

### OPS-03：失败目标查询与安全补跑

在 OPS-02 后实施。需审批最小阶段执行结果记录，区分未处理、处理中、取消、最终失败、正常无需发布和已完成；对指定目标安全补跑现有 RuntimeTask，保持 single-flight 和幂等，不自动扫表恢复。

### OPS-04：首轮 Feed 处理预算

限制首轮候选处理量并提供预算递增/补采，避免首次启用大量 Source 形成数千任务；不把跳过项写成已采集，不改 `last_collected_at` 和全量读取语义。

### OPS-05：Pages 自动恢复与 Scheduler 热更新

有界周期 Pages 校准、公开状态记录，以及 Source enabled/cron 配置的安全调度刷新。Pages 最终一致不能替代业务完成度。

## 5. 验收方向

- 90 个 Source Item 均有明确终态，不再长期停留于未生成 Content 的不明状态。
- 常见请求不再普遍贴近 60 秒；若仍存在超时，必须有明确 operation、目标、尝试、耗时和 deadline 归因。
- 499、上游断开、本地取消、HTTP 错误、空 Content、截断、JSON/Schema、非法 ID 和 content_filter 分开统计。
- 重试和补跑不重复业务资产；Pages 公开与业务目标完成分别验收。
- 所有日志/指标不泄漏秘密、Prompt、正文或私有配置。
