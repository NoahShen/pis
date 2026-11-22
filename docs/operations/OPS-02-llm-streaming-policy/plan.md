# OPS-02 Plan：流式 LLM 与 operation 独立预算/重试

- 状态：G3_APPROVED · Architect
- Intent：APPROVED · G1；Spec：APPROVED · G2
- 执行基线：包含本文件与 progress 的文档提交；T01→T02→T03→T04 串行。
- 固定 Node `26.13.1` / npm `11.20.0`；新增依赖 NONE。

## 通用协议

每卡新 Paseo Worker、独立 worktree、固定 base、精确写集；Worker 不 commit/stage/merge/push/progress/PASS。Architect 独立 diff/typecheck、canonical full-index patch/tree、独立重放、G4、candidate/merge、merge 后全量 verify 和归档。默认 Gate 清除 `RSS_PAGES_*`。真实配置只从 `~/.config/pis/llm.env` 读取，使用已更新的 `group/pis`，不输出秘密；原始 SSE 仅私有 600 文件。

禁止修改 schema、Prompt、Published Item、Pages/Scheduler、六类 RuntimeTask、API DTO、package/lock。生产真实流式在 T01/T02 完成兼容验证后才启用，不做静默非流式 fallback。

## OPS-02-T01 SSE Client

**Base**：OPS-02 文档执行基线。

精确写集：

- 新增 `src/llm/streaming-chat-completions-client.ts`
- 新增 `src/llm/stream-protocol.ts`
- 修改 `src/llm/failure-summary.ts`（仅新增流式安全分类）
- 新增 `tests/llm/streaming-chat-completions-client.test.ts`
- 新增 `tests/llm/stream-protocol.test.ts`
- 可最小修改 `tests/llm/failure-summary.test.ts`

交付：`stream:true` 请求、SSE/UTF-8/CRLF/心跳/多行 data/[DONE]、Content 聚合、reasoning-only/空 Content/截断/不完整流、大小和取消清理。首包/空闲/总超时及安全状态；不修改生产装配，不启用生产流式，不改五类业务输出。

## OPS-02-T02 Operation Policy 与生产装配

**Base**：T01 closeout 文档提交。

精确写集：

- 新增 `src/llm/operation-policy.ts`
- 修改 `src/config.ts`
- 修改 `src/production/application.ts`
- 修改 `src/llm/llm-calls.ts`（仅按 operation 注入 client/policy）
- 可修改 `src/llm/failure-summary.ts`
- 修改 `tests/config.test.ts`
- 新增 `tests/llm/operation-policy.test.ts`
- 修改 `tests/application/production-assembly.test.ts`
- 可修改 `tests/fixtures/app-config.ts`、`tests/fixtures/production-assembly.ts`（仅必要兼容）

交付：五类独立 endpoint/model/预算、缺省继承、配置校验、生产按 operation 使用流式 Client；日志安全字段。未配置保持现有部署与超时行为，生产请求不增加 temperature/response_format。若现有 TextCompletionClient 接口需要流式扩展，只在本写集内做向后兼容扩展。

## OPS-02-T03 受控重试与迟到响应

**Base**：T02 closeout 文档提交。

精确写集：

- 修改 `src/runtime/contracts.ts`、`runtime.ts`、`task-errors.ts`、`runtime-logger.ts`
- 修改 `src/production/application.ts`（仅传递 operation retry policy）
- 修改 `src/llm/operation-policy.ts`
- 新增 `tests/runtime/retry-policy.test.ts`
- 新增 `tests/llm/stream-cancellation.test.ts`
- 修改 `tests/runtime/llm-failure-logging.test.ts`、`runtime-shutdown.test.ts`
- 可修改 `tests/application/production-assembly.test.ts`

交付：每 operation maxAttempts/retryDelay/retryTotalBudget，可取消退避、drain/shutdown、attempt 身份与迟到响应无副作用；第二次成功单下游、无第三次、无重复业务资产。普通任务与既有 dispatch 行为不回归。

## OPS-02-T04 自主真实流式验收

**Base**：T03 closeout 文档提交。

精确写集：

- 新增 `scripts/llm-streaming-acceptance.mjs`
- 新增 `tests/llm/streaming-acceptance.test.ts`（仅离线）
- 新增 `docs/operations/OPS-02-llm-streaming-policy/acceptance.md`
- 可修改 `docs/operations/llm-timeout-structured-output-review-2026-11-22.md`（仅记录对应交付）

交付：

1. 离线 SSE fixtures、超时/取消/重试自测，私有输出权限。
2. Architect 使用 `group/pis` 对自主合成输入执行五类真实流式调用，记录安全首包/Content/总耗时、协议与重试统计；不读取真实 Source/User Context。
3. 原始 SSE 仅私有 600 文件；报告不含模型名/endpoint/正文/秘密。真实外部不可用则 BLOCKED，不以 Stub 替代。
4. 全量 verify、干净 `git archive`、精确 SHA Linux CI；归档 Agent/Workspace、删除心跳、交负责人审核。生产 6 Source 复验明确由负责人另行执行。

## 退出状态

四卡 G4/merge、流式/预算/取消测试、真实自主复验和 CI 通过方可签发 `OPS-02_FINAL_PASS`。生产 6 Source 部署验证另列，不冒充完成。失败补跑、首轮 Feed 预算、Pages/Scheduler、运行监控和 `/health` 不在本任务范围。
