# OPS-02-T04 流式 LLM 验收

- 基线：`d1d2beb`
- Worker 交付状态：确定性验收工具已实现；真实外部复验由 Architect 使用私有 `group/pis` 配置另行执行。
- 安全边界：本卡未读取 `llm.env`，未执行真实模型调用，未读取真实 Source/User Context，未修改生产代码、Prompt、package、schema 或 API。

## 1. 验收工具

`scripts/llm-streaming-acceptance.mjs` 复用真实 `resolveLlmOperationPolicies()`、`streamingConfigForOperation()`、`createStreamingChatCompletionsClient()` 和 `createTypedLlmCalls()`，不是另写一份协议解析或 DTO 校验。

五类自主合成 task data 覆盖：

| Operation | 合成目标 | 引用上下文 |
| --- | --- | --- |
| `processing-route` | 合成 Source Item 工程记录 | 无外部引用 |
| `event-search` | 合成项目里程碑 Content | 无外部引用 |
| `event-analysis` | 合成项目更新 | `synthetic-event` / `synthetic-update` |
| `knowledge-analysis` | 合成测量笔记 | `userContext=null`，不加载真实背景 |
| `topic-matching` | 合成 Event 目标 | `synthetic-topic` |

真实模式只从显式 `--env-file` 加载配置，要求全局三项凭据和 HTTPS endpoint，并允许真实生产 operation policy 覆盖。脚本不继承进程中的隐式 LLM 配置，不自动读取 `.env`，不输出 model、endpoint、key、Prompt 或正文。每 operation 最多按真实 policy 执行两次，Client 不自行重试；总预算、可取消退避和安全错误分类均来自生产组件。

安全报告只包含 operation、category/reason、HTTP 状态（若适用）、尝试次数、总耗时、首包/首 Content 耗时及白名单 stream state。真实原始 SSE 写入 `<output>.raw.sse.jsonl`；报告和 raw 都必须在仓库外，文件权限均为 600。raw 不得提交或复制到公开验收材料。

## 2. 离线确定性证据

执行：

```sh
npm run build
node scripts/llm-streaming-acceptance.mjs --self-test
npx vitest run tests/llm/streaming-acceptance.test.ts
```

Worker 结果：

- self-test：`PASS`，10 项，6 次预期成功、4 次预期失败；五类正常 typed call 各一次成功，专门的不完整流用例第二次成功。
- 定向测试：1 file、13 tests 全通过；真实模式的本地注入替身额外验证私有 raw/report 权限、安全 allowlist 与首包/首 Content 计时，不发网络请求、不计作真实模型验收。
- fixture 覆盖跨 chunk UTF-8、CRLF、心跳、多行 data、`[DONE]`、完整 Content 聚合及五类真实 DTO/reference 校验。
- 故障覆盖首包超时、有效 reasoning 数据后的空闲超时、单次总超时、调用方取消和不完整流重试。
- 私有 JSON 写入为 600；self-test 临时 raw/report 在结束后删除。返回报告不含合成请求正文、原始 SSE、endpoint、model 或秘密 sentinel。

完整 `npm run verify`：152 files、1558 tests 全通过；toolchain、typecheck、build、全部 smoke、378-file format check 均通过。`git diff --check` 通过。最终复验后交付记录为 153 files、1558 tests。

## 3. 真实模式执行方式

先构建，再由获授权审核者执行：

```sh
npm run build
node scripts/llm-streaming-acceptance.mjs \
  --env-file /absolute/private/llm.env \
  --output /absolute/private/ops-02-streaming-report.json
```

stdout 仅输出 mode、五类计数、成功/失败数、总耗时和 COMPLETE/FAILED。报告写入仓库外私有路径。失败时进程非零，不得以 self-test 替代真实结果。真实报告由 Architect 判读并另行记录安全结论；当前 Worker 状态为 **REAL_ACCEPTANCE=NOT_RUN**，不是 PASS，也不宣称 `OPS-02_FINAL_PASS`。

## 4. 独立范围

生产 6 Source、真实 Source/User Context、P50/P90 业务吞吐、失败补跑、Pages/Scheduler、运行监控和 `/health` 均未在本卡执行，由负责人或相应后续任务另行验收。
