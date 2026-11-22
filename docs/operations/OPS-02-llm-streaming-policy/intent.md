# OPS-02 Intent：流式 LLM 与 operation 独立预算/重试

- 类型：线上运行修复（非 D 系列版本功能演进）
- 状态：APPROVED · G1（负责人批准文档后直接开发）
- 来源：6 Source 真实试运行的大量 60 秒取消、响应校验失败和任务积压；负责人确认 Magpie 支持流式。
- 基线：main `c821c7cefe8858d6c81b921885b1ceb737e296d0`

## 目标

1. LLM Client 支持有界、可取消的流式 SSE 响应，区分 reasoning、Content、首包、空闲和完整流状态。
2. 五类 operation 可独立配置模型/endpoint、首包/空闲/总超时、输出大小、最大尝试、退避和总重试预算。
3. 区分本地 deadline、调用方取消、上游断开、HTTP 499、流式协议错误、reasoning-only、空 Content、截断、JSON/Schema/引用和 content_filter。
4. 重试不立即放大上游压力；退避可取消并计入 drain/shutdown；取消后的迟到响应不得提交或覆盖结果。
5. 自主生成合成内容进行真实 Magpie 流式复验；负责人另行在生产环境做 6 Source/实际数据部署验证。

## 固定边界

- 流式只改变响应读取和预算观测，最终仍聚合完整 Content 后执行现有 JSON/Zod/引用校验；不边生成边写库、不接受部分 JSON、reasoning-only 或代码围栏。
- 每 operation 最多一次或两次，保持默认兼容；不增加 Worker 并发，不盲目把全局 60 秒调大。
- 不擅自增加 temperature/top_p/response_format；生产请求只含 operation 对应 model、`stream:true` 和两条 messages。
- 未配置 operation 专用项时继承现有 `PIS_LLM_*` 与 60 秒总预算，避免现有部署失效。
- 不新增数据库表、失败补跑、首轮 Feed 预算、Pages/Scheduler 改造、监控 API 或 `/health` 业务健康度。
- 日志不记录 reasoning/SSE 原文、Prompt、正文、完整 endpoint、Token、model、异常 message、堆栈或原始响应。

## 验收

- SSE 跨 chunk/UTF-8/CRLF/心跳/多行 data/[DONE]、大小限制、取消与资源清理通过。
- 首包/空闲/总超时和重试总预算可区分；退避可中断；第一次迟到结果不覆盖第二次；第二次成功只派发一次。
- 五类 operation 配置正确继承/覆盖，生产装配与既有业务输出保持兼容。
- 自主真实流式测试记录安全延迟/协议统计，不以本地 Stub 冒充真实模型；生产 6 Source 复验由负责人另行执行。
- 每卡 G4、merge 后全量 Gate、最终干净快照和精确 SHA Linux CI Success；完成后交负责人审核。
