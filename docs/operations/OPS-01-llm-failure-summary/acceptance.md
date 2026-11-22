# OPS-01 真实模型错误复验

- 状态：**DEVELOPMENT_COMPLETE · REAL_LLM_BLOCKED**
- 任务：OPS-01-T03
- 最终代码：`5c731c9b90b518349901d0fde5c40bbad137aabd`
- 真实复验：已执行；当前私有上游凭证返回 HTTP 401，合法真实调用待有效凭证后补验。

## 离线验证

- `scripts/llm-failure-acceptance.mjs --self-test`：五类 operation、16 类失败分支，共 85 项通过。
- 独立干净 `git archive`：146 files / 1493 tests、typecheck、build、全部 smoke、368 文件格式检查通过。
- 精确 SHA Linux CI run `45034988952`：Success。
- 真实调用与本地故障注入分开记录；Stub 不冒充真实模型。

## 真实调用结果

使用显式私有 env/output，最多五次调用，原始响应仅存私有 `0600` 文件。五类 operation 均被上游以 **HTTP 401** 拒绝，分类准确且按契约不进行第二次业务重试：

| operation | category | reason | httpStatus | attempt | final | count |
|---|---|---|---:|---:|---|---:|
| processing-route | http | LLM_HTTP_ERROR | 401 | 1 | true | 1 |
| event-search | http | LLM_HTTP_ERROR | 401 | 1 | true | 1 |
| event-analysis | http | LLM_HTTP_ERROR | 401 | 1 | true | 1 |
| knowledge-analysis | http | LLM_HTTP_ERROR | 401 | 1 | true | 1 |
| topic-matching | http | LLM_HTTP_ERROR | 401 | 1 | true | 1 |

上游响应表明网关 key 被禁用/删除或不可用；本文不记录 key、完整 endpoint、原始响应或任何秘密。该结果证明新的分类链可以准确区分确定性鉴权失败，但不构成合法真实模型成功调用证据。

## 本地故障注入

| operation | category | reason | 判定 |
|---|---|---|---|
| event-analysis | output_validation | LLM_OUTPUT_JSON_INVALID | PASS |
| knowledge-analysis | output_validation | LLM_OUTPUT_JSON_INVALID | PASS |
| topic-matching | response_protocol | LLM_CONTENT_EMPTY | PASS |
| processing-route | response_protocol | LLM_CONTENT_EMPTY | PASS |

本地注入未访问网络，不计入真实模型失败率。

## 历史执行问题

- 初次验收脚本将直接底层错误误标为 harness，已修复为统一 `summarizeLlmFailure()`；随后真实结果准确显示 HTTP 401。
- 独立干净快照发现验收测试依赖预建 dist，已改为同一 src 模块组件并重跑通过；未掩盖失败历史。
- 合法真实调用因 401 外部凭证状态保持 BLOCKED，不以 Stub 或脚本 `COMPLETE` 冒充最终真实成功。

## 结论

OPS-01 的代码、错误摘要、重试矩阵、日志白名单和 CI Gate 已完成。整体状态为 **DEVELOPMENT_COMPLETE · REAL_LLM_BLOCKED**；更新有效私有凭证后，使用同一命令补做五类合法调用复验，再交负责人决定是否关闭该外部项。
