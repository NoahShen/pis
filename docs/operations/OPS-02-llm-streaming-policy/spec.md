# OPS-02 Spec：流式 LLM 与 operation 独立预算/重试

- 状态：APPROVED · G2 · Architect
- Intent：APPROVED · G1

## 1. Operation Policy

```ts
interface LlmOperationPolicy {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly stream: true;
  readonly firstByteTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxAttempts: 1 | 2;
  readonly retryDelayMs: number;
  readonly retryTotalBudgetMs: number;
}
```

五类键：`processing-route`、`event-search`、`event-analysis`、`knowledge-analysis`、`topic-matching`。专用配置可覆盖 endpoint/apiKey/model 和各预算；缺省继承 `PIS_LLM_*`，总超时 60 秒、最大响应 2 MiB、最多两次、无退避，保持现有行为。配置值须正整数且有安全上限，不允许无限等待。

`firstByteTimeoutMs` 是首个有效 SSE 数据的等待上限；`idleTimeoutMs` 是有效数据包间上限；`totalTimeoutMs` 是单次绝对上限；`retryTotalBudgetMs` 包含首次、退避与第二次。首包 reasoning 与首包 Content 分开记录，心跳只证明连接活跃，不证明 Content 已开始。

## 2. 流式协议

请求体仅 operation model、`stream:true` 与 system/user 两条 messages，不新增 temperature/response_format。

SSE 必须支持：

- 跨 chunk UTF-8、CR/LF/CRLF、跨 chunk event 和多行 `data:`。
- 注释/心跳、多个 data 行、`data: [DONE]`。
- `choices[].delta.content` 增量聚合，以及 Provider 最终 message.content（若存在）。
- reasoning 字段只用于安全状态，不进入业务 Content/日志。
- finish_reason=stop 才能成功；length 为截断；缺失完成标记/异常结束为流不完整。
- 有界字节、事件数和 Content 长度；reader/body/timer/listener 在成功、错误和取消时全部清理。

聚合完整 Content 后仍走 `parseLlmResponse()`。不得返回流式部分结果或在流中写业务数据库。

## 3. 错误与可观测性

新增安全原因（可映射到 OPS-01 category）：

| 场景 | reason | retryable |
|---|---|---:|
| 首包超时 | `LLM_FIRST_BYTE_TIMEOUT` | true（受总预算） |
| 数据包空闲超时 | `LLM_STREAM_IDLE_TIMEOUT` | true（受总预算） |
| 本地总超时 | `LLM_TIMEOUT_LOCAL` | true（退避后） |
| 上游流异常断开 | `LLM_STREAM_ABORTED` | true |
| 流缺 `[DONE]`/有效完成标记 | `LLM_STREAM_INCOMPLETE` | true |
| reasoning-only | `LLM_REASONING_ONLY` | true |
| 空 Content | `LLM_CONTENT_EMPTY` | true |
| 输出截断 | `LLM_OUTPUT_TRUNCATED` | true |
| 上游 content_filter | `LLM_CONTENT_FILTERED` | false |
| HTTP 499 | `LLM_UPSTREAM_CANCELED` + status 499 | true（退避后） |
| 调用方取消/关闭 | `LLM_CANCELLED` | false |

HTTP 200 仍需完成流、Content 和 Schema 校验。content_filter 仅允许白名单错误类型，不记录响应正文。保留 OPS-01 其他分类。

日志白名单可新增 firstByteMs、firstContentMs、timeoutMs、retryDelayMs、streamState，禁止 SSE/reasoning/Prompt/正文/秘密。状态仅 request_started、first_chunk_received、reasoning_started、content_started、stream_done、local_deadline、upstream_closed、cancelled。

## 4. 重试与取消

Client 只负责单次流式请求、超时/取消、聚合和协议错误；Runtime/operation policy 负责第二次、退避和总预算，禁止双层 2×2 重试。

- 网络/429/5xx、超时、流异常：可取消退避后第二次。
- reasoning-only/空 Content/流不完整/JSON/Schema/引用/冲突：允许第二次。
- content_filter、配置、确定性 4xx、非法输入、响应超限：一次终止。
- 取消/关闭：立即终止，不再调用。
- retryDelay 必须有界、可 Abort，计入 drain/shutdown；总预算不足不得开始第二次。
- 每次 attempt 有独立身份；abort 后迟到事件不能成功聚合、覆盖第二次、写业务数据或派发下游。
- 第二次成功只派发一次，所有业务幂等依赖既有事务/唯一约束。

## 5. 真实验收与范围

T04 使用自主合成内容，验证 Magpie 流式协议、五类 operation、延迟、格式/取消和资源清理；真实原始 SSE 仅私有 600 文件。公开报告只有安全计数和耗时，不包含模型名/endpoint/正文。生产 6 Source 验证由负责人另行执行，不作为 OPS-02 自动完成的前置条件，但必须在交付中明确未执行。
