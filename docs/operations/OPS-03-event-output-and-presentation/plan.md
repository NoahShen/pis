# OPS-03 Plan：Event 输出契约与发布可读性

- 状态：G3_APPROVED · Architect
- Intent：APPROVED · G1；Spec：APPROVED · G2
- 执行基线：包含本文件与 progress 的文档提交；T01→T02→T03 串行。
- 固定 Node `26.13.1` / npm `11.20.0`；新增依赖 NONE。

## 通用协议

每卡新 Paseo Worker、独立 worktree、固定 base、精确写集；Worker 不 commit/stage/merge/push/progress/PASS。Architect 独立 diff/typecheck、canonical patch/tree、独立重放、G4、candidate/merge、merge 后全量 verify 和归档。真实配置只从 `~/.config/pis/llm.env` 读取，使用 `group/pis`；原始响应只存私有 600，公开报告不含模型名/endpoint/正文/秘密。默认 Gate 清除 `RSS_PAGES_*`。

## OPS-03-T01 生产 Prompt 对照与最小修订

**Base**：OPS-03 文档执行基线。

精确写集：

- 新增 `scripts/event-prompt-compatibility.mjs`
- 新增 `tests/llm/event-prompt-compatibility.test.ts`（仅离线 fixture/参数/安全输出）
- 新增 `docs/operations/OPS-03-event-output-and-presentation/prompt-baseline.md`
- 仅在真实对照证明必要时修改 `config/prompts/event-search.md`、`config/prompts/event-analysis.md` 的输出要求段

交付：使用生产 Prompt 与 `group/pis` 对自主合成输入做基线复验；Architect 单独执行真实调用，Worker 不读凭证。若生产 Prompt 稳定则不改，若复现代码围栏则最小修订输出段并做第二轮。不得修改其他 Prompt 业务段、Schema 或生产代码。

## OPS-03-T02 Publication HTML 可读性

**Base**：T01 closeout 文档提交。

精确写集：

- 修改 `src/publication/template-renderer.ts`
- 修改 `tests/publication/template-renderer.test.ts`
- 可最小修改 `tests/publication/publication-integration.test.ts`、`tests/rss/xml-renderer.test.ts`
- 新增 `docs/operations/OPS-03-event-output-and-presentation/presentation.md`

交付：Event/Update/Knowledge 标签 `<strong>`，Findings 标题 `<strong>` 与描述独立 `<p>`；HTML 转义、注入负断言、RSS 可读性和 sealed 不变边界。不得更新历史数据库行或改业务事实。

## OPS-03-T03 综合真实验收与交付

**Base**：T02 closeout 文档提交。

精确写集：

- 新增 `docs/operations/OPS-03-event-output-and-presentation/acceptance.md`
- 可修改 `scripts/event-prompt-compatibility.mjs`（仅最终报告安全字段/复验需要）
- 可修改 `tests/llm/event-prompt-compatibility.test.ts`
- 可修改 `docs/operations/llm-timeout-structured-output-review-2026-11-22.md`（仅记录对应交付）

交付：生产 Prompt 最终版连续真实调用，覆盖事件事实、NEW_UPDATE/NO_INCREMENT、跨语言、公司≠产品、空结果和非法引用；模板全量/RSS 回归；干净 `git archive` 与精确 SHA Linux CI；归档 Agent/Workspace、删除心跳、交负责人审核。生产 6 Source 由负责人另行复验。

## 退出状态

只有在生产 Prompt 最终真实 JSON 契约达标、语义检查通过、模板 Gate 和 CI 全通过后，才签发 `OPS-03_FINAL_PASS`。若生产模型仍不稳定，记录 REAL_MODEL_BLOCKED，不用剥离围栏或 Stub 冒充完成。
