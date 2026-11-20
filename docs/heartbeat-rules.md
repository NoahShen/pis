# 心跳推进规则（供 Agent.md / 项目规范引用）

## 1. 创建时机

里程碑 Plan 获执行批准、开始正式开发时，由 **Architect** 创建推进心跳：

- 接口：`create_heartbeat`
- 频率：默认 `*/10 * * * *`，时区 `Asia/Shanghai`
- 同一里程碑只保留一个活动心跳；恢复会话先核对 `progress.md` 中记录的心跳 ID，避免重复创建。
- 心跳 ID 记入该里程碑 `progress.md`。

## 2. 只提醒，不代审（硬性边界）

心跳的职责是**提醒主会话 Architect 回来处理**，不是替 Architect 决策。心跳不得：

- 批准 G1/G2/G3/G4；
- 创建 candidate、merge、push；
- 修改任何源码、测试或 `progress.md`；
- 归档 workspace/agent、删除自身；
- 代替 Lead 创建 Worker 或工作区。

G4 审核、合并、本地 Gate、归档等一切审核与收尾操作，**均由主会话 Architect 亲自执行**。

## 3. 接口类型不可混用

| 接口 | 行为 | 后果 |
|---|---|---|
| `create_heartbeat` | 向当前主会话发提醒 | 正确：Architect 亲自审核 |
| `create_schedule` | 每次新建独立 agent（`new-agent`） | **禁止**：独立实例会自行批准、merge、归档，绕过 Architect |

- 误用 `create_schedule` 曾导致 D11-T01 的 G4 由独立实例而非 Architect 批准。
- 清理接口须与类型匹配：心跳用 `delete_heartbeat`；历史遗留的 schedule 对象用 `delete_schedule`（对 `delete_heartbeat` 会报 not found）。

## 4. 提醒内容

每次只依据最新 `progress.md`、Plan、Git 与必要的 Paseo 状态判断：

- 有待 Architect 审核的冻结交回 → 提醒去审；
- Lead/Worker BLOCKED 或长时间无进展 → 提醒具体阻塞；
- 正常推进 → 简短报告，不打断工作。

只在进度变化或实际阻塞时报告；等待 CI 或负责人授权时不反复催问。心跳不构成 push 授权。

## 5. 收尾

最终验收完成或负责人要求停止时：

1. 用 `delete_heartbeat` 删除准确 ID 并核实成功；
2. 归档该里程碑全部 Worker 与 Lead workspace（`removedDirectory=true`），保留共享主工作区；
3. 在交付说明中同时写明：验收结论、心跳删除结果、归档结果。
