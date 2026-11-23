# OPS-03 最终验收

- 状态：**OPS-03_FINAL_PASS=ISSUED**
- 最终代码：`cb5fd783099bbcf1a3754c9892ab5d4dcb51ceac`
- 精确 SHA Linux CI run `45086704446`：Success
- 生产 6 Source 部署复验：由负责人另行执行，不在本任务冒充完成。

## 1. Event 输出契约

首次生产 Prompt 对照的 28 次失败并非模型格式问题：私有 SSE 证明 Magpie 在 stop 前后发送 `choices: []` 的 usage-only 事件，流式 Client 误判为 `LLM_RESPONSE_MALFORMED`。

修复允许带对象 `usage` 的空 choices 事件，继续拒绝其他非法空事件和 `[DONE]` 后业务数据：

- 生产修复 merge：`666238634205e710ca345feff7dcdca24aad9e7b`
- 回归测试 merge：`38c94bc7d22af9b538cb61e5113c2a0c7f8583d9`

修复后及最终两轮真实生产 Prompt 复验均为 **14/14 SUCCESS**，outputShape=valid，无代码围栏、Schema 或引用失败。场景覆盖 event fact、NEW_UPDATE、NO_INCREMENT、跨语言同指、公司≠产品、空结果和非法引用拒绝。

**生产 `event-search.md` 与 `event-analysis.md` 未修改**，无需新增输出约束、启用 response_format 或剥离代码围栏。OPS-02 极简验收指令与生产 Prompt 已明确区分。

## 2. 发布可读性

`src/publication/template-renderer.ts` 已更新：

- Event/Update 的所属主线、核心实体、主题、范围、发生时间使用 `<strong>`。
- Knowledge 的分类、摘要、价值使用 `<strong>`。
- Findings 标题使用 `<strong>`，详细描述使用独立 `<p>`，保留 `ul/li`。
- 所有动态文本继续 HTML 转义，危险标签/onerror/script 负断言通过。
- 历史 Published Item、业务事实和 sealed 未修改；只改变新发布及合法投影的 HTML 结构。

## 3. 工程 Gate

- 独立 `git archive` 干净快照：153 files / 1583 tests，typecheck、build、全部 smoke、380 文件格式检查通过。
- Event Prompt 离线 self-test：19 attempts，13 成功、6 预期失败，零网络。
- 生产 Prompt 最终真实复验：14/14 成功，累计约 49 秒，原始 SSE 与报告仅私有 600 文件。
- 全部 Agent/Workspace 归档，开发心跳删除。

## 4. 边界

本任务完成 Event JSON 契约与展示修正，不包含失败目标补跑、首轮 Feed 预算、Pages/Scheduler 热更新、运行监控、生产 6 Source 部署验收或 `/health` 业务健康度。真实模型输出仍可能自然波动，后续生产复验继续使用现有严格 JSON/Zod/引用校验，不放宽契约。
