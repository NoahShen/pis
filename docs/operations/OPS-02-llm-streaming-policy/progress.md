# OPS-02 Progress

- 状态：IN_PROGRESS · T01
- 类型：线上运行修复，非 D 系列版本里程碑
- Intent：APPROVED · G1
- Spec：APPROVED · G2 · Architect
- Plan：G3_APPROVED · Architect
- 当前 Worker：PENDING · T01
- 开发心跳：PENDING
- 基线：main `c821c7cefe8858d6c81b921885b1ceb737e296d0`
- Candidate/Merge/Push：PENDING
- 新增依赖：NONE
- 真实复验配置：`group/pis`（仅从私有 env 读取）

| 任务 | 状态 | 验收 |
|---|---|---|
| OPS-02-T01 SSE Client | IN_PROGRESS | 流式解析、超时、取消与清理 |
| OPS-02-T02 Operation Policy/装配 | NOT_STARTED | 五类独立配置、继承与生产流式 |
| OPS-02-T03 重试/迟到响应 | NOT_STARTED | 可取消退避、总预算、幂等 |
| OPS-02-T04 自主真实验收 | NOT_STARTED | 合成内容、安全报告、全量/CI |

生产 6 Source 部署复验由负责人另行执行，不在本任务冒充完成。失败补跑、首轮预算、Pages/Scheduler、监控和 `/health` 不在范围。
