# OPS-03 Progress

- 状态：IN_PROGRESS · T01
- 类型：线上运行修复与展示修正，非 D 系列版本里程碑
- Intent：APPROVED · G1
- Spec：APPROVED · G2 · Architect
- Plan：G3_APPROVED · Architect
- 当前 Worker：PENDING · T01
- 开发心跳：PENDING
- 基线：main `cbad85b559a82f8398a2caa254f807d875fc424c`
- Candidate/Merge/Push：PENDING
- 新增依赖：NONE
- 真实配置：`group/pis`（仅从私有 env 读取）

| 任务 | 状态 | 验收 |
|---|---|---|
| OPS-03-T01 生产 Prompt 对照/修订 | IN_PROGRESS | 基线复现、最小输出契约、语义不变 |
| OPS-03-T02 Publication HTML 可读性 | NOT_STARTED | 标签加粗、Findings 标题/描述分离 |
| OPS-03-T03 综合真实验收 | NOT_STARTED | 真实 JSON/语义、全量/干净快照/CI |

不剥离代码围栏、不放宽 Schema、不改历史快照或 sealed。生产 6 Source 部署复验由负责人另行执行。
