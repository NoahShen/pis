# OPS-01 Spec：LLM 错误摘要与重试分类

- 状态：APPROVED · G2 · Architect
- Intent：APPROVED · G1

## 1. 内部 Failure Summary

新增内部只读契约：

```ts
type LlmFailureCategory =
  | "configuration"
  | "cancellation"
  | "timeout"
  | "network"
  | "http"
  | "response_protocol"
  | "response_size"
  | "output_validation";

interface LlmFailureSummary {
  readonly operation: LlmOperation | null;
  readonly category: LlmFailureCategory;
  readonly reason: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
}
```

`reason` 必须来自固定白名单，不能复制异常 message。`httpStatus` 仅允许 100～599 整数。`operation` 为五类固定 LLM operation；Client 尚未绑定 operation 时可为 null，由 typed call/业务包装层补齐。不得保存原始 Error、cause、URL、model、正文或响应。

## 2. Client 与协议子原因

保留 `ChatCompletionsError.code/category/retryable/status` 兼容字段，增加可生成安全摘要的信息。`LLM_RESPONSE_PROTOCOL_ERROR` 必须至少区分：

| 新安全 reason | 场景 | retryable |
|---|---|---:|
| `LLM_RESPONSE_MALFORMED` | choices/JSON/消息结构不可识别 | true |
| `LLM_CONTENT_EMPTY` | 空 Content 或 reasoning-only，无可用文本 | true |
| `LLM_FINISH_REASON_INVALID` | 非 length 的非预期 finish reason | true |
| `LLM_OUTPUT_TRUNCATED` | finish reason=length 或明确截断 | true |
| `LLM_REFUSAL` | 明确 refusal | false |
| `LLM_TOOL_CALL_UNEXPECTED` | 非空 tool/function call | false |

`LLM_RESPONSE_TOO_LARGE` 为 response_size、false。网络、超时、429/5xx 为 true；其他 HTTP 4xx 为 false。取消单独为 cancelled，不进入 retryable。

## 3. 输出校验与业务传递

`LlmOutputValidationError` 保留现有 code，映射：

- `LLM_OUTPUT_JSON_INVALID` → output_validation / true
- `LLM_OUTPUT_SCHEMA_INVALID` → output_validation / true
- `LLM_OUTPUT_REFERENCE_INVALID` → output_validation / true
- `LLM_OUTPUT_CONFLICT` → output_validation / true

新增 `summarizeLlmFailure(error, operation?)`，只识别允许类型/字段，恶意 getter 或未知输入返回安全 `unknown_error`，不得因摘要生成再次抛错或读取敏感值。

Processing、Event Search、Event Analysis、Knowledge、Topic Matching 的业务 Error 保留原 `code`（含 `llm_failed`），可选携带 `llmFailure`。包装时不得将原始异常直接放入 cause；operation 必须固定为该业务对应 operation。

## 4. Runtime 分类与日志

`classifyTaskError()` 在取消优先之后，若存在合法 `llmFailure`，按 summary.retryable 决定 retryable/non_retryable，并保留 summary 供日志；非法 summary 不得绕过白名单或导致 Runtime 崩溃。无 summary 时保持现有 SQLite、`*_failed`、非法输入和未知错误行为。

每次失败日志记录：

- 既有 taskType/taskId/stage/attempt/maxAttempts/durationMs。
- 新增 operation/category/reason/httpStatus/retryable/final。
- `final=true` 仅用于取消、non_retryable 或达到 maxAttempts 的终止记录；允许再次尝试为 false。
- 成功任务不伪造失败日志；第二次成功只派发一次下游。

logger 继续 best-effort，自身失败不改变任务结果。禁止新增任何非白名单字段。

## 5. 重试矩阵

| 类别 | 最大业务调用次数 |
|---|---:|
| 网络、超时、429、5xx | 2 |
| JSON/Schema/引用/冲突 | 2 |
| 空 Content、reasoning-only、非预期 finish reason、截断、不可识别响应结构 | 2 |
| SQLite busy/locked、既有暂时性 `*_failed` | 2 |
| 配置、非法输入、目标不存在、确定性 HTTP 4xx | 1 |
| 响应超限、明确 refusal/tool call | 1 |
| 取消 | 1（终止，不再重试） |

本轮不增加 backoff，不重试已 COMMIT 的上游业务；下游 dispatch 规则不变。

## 6. 验收与隐私

- 五类业务调用均验证 summary 不丢失，Runtime 日志含正确 operation。
- 覆盖每种重试分支、第一次失败第二次成功、第二次失败 final、零/重复下游。
- 对敏感 message、endpoint、Token、Prompt、正文、Zod issue、SQL、堆栈做负断言。
- 真实模型只做有限针对性复验，记录 operation/类别/次数/结果，不保存公开原文；不要求消除所有自然格式波动。
- 全量 verify、干净快照、精确 SHA Linux CI 通过。
