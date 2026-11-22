# OPS-01 Plan：LLM 错误摘要与重试分类

- 状态：G3_APPROVED · Architect
- Intent：APPROVED · G1；Spec：APPROVED · G2
- 执行基线：包含本文件与 progress 的文档提交；T01→T02→T03 串行。
- 固定 Node `26.13.1` / npm `11.20.0`；新增依赖 NONE。

## 通用协议

- 每卡新 Paseo Worker、独立 worktree、固定 base、精确写集；Worker 不 commit/stage/merge/push/progress/PASS。
- Architect 独立 diff/typecheck、canonical full-index patch/tree、独立重放、G4、candidate/merge-tree、merge 后 `npm run verify`、归档。
- 默认 Gate 清除 `RSS_PAGES_*`；真实模型凭证仅从 `~/.config/pis/llm.env` 读取，原始响应仅私有临时目录，不进入 Git/公开报告。
- 禁止修改 schema、Prompt、API DTO、六阶段任务、Pages/Scheduler、package/lock；不重写测试预期掩盖问题。

统一命令：

```sh
export PATH=/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH
npm run typecheck
npm test -- <本卡测试>
npm run verify
```

## OPS-01-T01 Client 与安全摘要

**Base**：OPS-01 文档执行基线。

精确写集：

- 新增 `src/llm/failure-summary.ts`
- 修改 `src/llm/chat-completions-client.ts`
- 可最小修改 `src/llm/response-validators.ts`（仅 summary 所需兼容字段）
- 修改 `tests/llm/chat-completions-client.test.ts`
- 修改 `tests/llm/response-validators.test.ts`
- 新增 `tests/llm/failure-summary.test.ts`

交付：安全分类/reason/retryable/status/operation，协议子原因，summarizeLlmFailure 的未知/恶意输入边界与秘密负断言；请求体仍无 temperature/response_format 等新增字段。此卡不接业务 Runtime。

## OPS-01-T02 五类业务传递与 Runtime 日志

**Base**：T01 closeout 文档提交。

精确写集：

- 修改 `src/processing/processing-errors.ts`、`content-router.ts`
- 修改 `src/event-search/event-search-errors.ts`、`event-search-call.ts`
- 修改 `src/event-analysis/event-analysis-errors.ts`、`event-analysis-call.ts`
- 修改 `src/knowledge/knowledge-errors.ts`、`knowledge-call.ts`
- 修改 `src/topic-matching/topic-matching-errors.ts`、`topic-matching-call.ts`
- 修改 `src/runtime/contracts.ts`、`task-errors.ts`、`runtime.ts`、`runtime-logger.ts`
- 修改对应 `tests/{processing,event-search,event-analysis,knowledge,topic-matching}/*call.test.ts` 或最小必要 service 测试
- 修改 `tests/runtime/task-errors.test.ts`、`runtime-retry-dispatch.test.ts`
- 新增 `tests/runtime/llm-failure-logging.test.ts`

交付：五类 Error 保留原 code 并携带 summary；Runtime 重试矩阵、每次/最终日志、operation、HTTP status、final 与第二次成功单下游；既有错误行为与秘密边界回归。若某模块现有错误类型不适合直接携带，仅在本写集内做最小兼容扩展，不改公共业务 DTO。

## OPS-01-T03 真实复验与交付

**Base**：T02 closeout 文档提交。

精确写集：

- 新增 `scripts/llm-failure-acceptance.mjs`
- 新增 `tests/llm/failure-acceptance.test.ts`（仅离线 harness）
- 新增 `docs/operations/OPS-01-llm-failure-summary/acceptance.md`
- 可修改 `docs/operations/runtime-improvement-review-2026-11-22.md`（仅标记 OPS-01 对应阶段已交付，不改其他优先级）

交付：

1. 离线自测覆盖错误矩阵、安全输出与私有 raw 保存；真实模型由 Architect 单独执行，针对合法调用及可控格式/协议错误，不主动制造高额调用。
2. 报告操作、类别、尝试次数、最终结果与波动；凭证/正文/完整 endpoint 不入 Git。
3. 全量 verify、干净 `git archive`、精确 main SHA Linux CI Success；Agent/Workspace 归档，心跳删除，交负责人审核。

## 退出状态

仅当三卡 G4/merge、分类与秘密测试、真实复验和 CI 全部通过，签发 `OPS-01_FINAL_PASS`。真实上游不可用则保留 BLOCKED，不用 Stub 冒充真实复验。失败目标补跑、首轮预算、Pages/Scheduler、运行监控、Event 质量与 `/health` 均不在本任务验收范围。
