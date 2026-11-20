# D11A Progress：运行整合与环境适配

- 状态：`G3_APPROVED`
- 计划基线：main `be98bccc68a81a61ebbc2b216c78da8d72aefa7b`
- G1：`APPROVED`（`intent.md`）
- G2：`APPROVED`（`spec.md`，含 Node 26 单值 zstd 口径）
- G3：`APPROVED · Architect · 2026-11-21`
- 当前交付：T01 `IN_PROGRESS`；Lead 已派发独立 Worker
- 当前 Lead：`f2cdf8e5-c3ec-46bb-9bd8-a6e9c58d1d8f` / `wks_1b975dad53475f31`
- 固定执行 base：`5765bd7a362988e82caf0f506e15446dd4339e85`
- 当前写集：仅 `docs/milestones/D11A/plan.md`、`docs/milestones/D11A/progress.md`
- Worker：`23dce48a-2ff0-4369-9878-c0c09bc7ac88` / `d11a-t01-worker`（T01，全量验证中）
- Candidate/Merge/Push：`NONE`
- 开发心跳：`ca6cd3ae`（active，10 分钟，只提醒主 Architect）

## 任务状态

| 卡片 | 状态 | 前置 base | 交接/证据 |
|---|---|---|---|
| `D11A-T01` 配置与 smoke 兼容 | `IN_PROGRESS` | `5765bd7a362988e82caf0f506e15446dd4339e85` | Lead 已派发 |
| `D11A-T02` SSRF 与 zstd | `NOT_STARTED` | T01 closeout 文档提交 | 未派发 |
| `D11A-T03` 生产装配与生命周期 | `NOT_STARTED` | T02 closeout 文档提交 | 未派发 |
| `D11A-T04` 集成、smoke、文档 | `NOT_STARTED` | T03 closeout 文档提交 | 未派发 |

## 当前验证

- 已核对固定 base、G1/G2、当前 `src`/`tests`/`scripts` 基线及文档索引冲突。
- T01 Worker 正在执行全量门禁；Lead 初审确认配置、测试 helper、smoke 合成环境和敏感 key 负断言均已覆盖，未发现写集外改动。
- T01 尚无完整测试结果或冻结候选，不得标记 REVIEW/PASS。

## 关键风险

- T01 将 `PIS_LLM_*` 变为生产必填，必须同步全部真实进程 smoke 的合成配置，不能通过放宽 `verify` 或空 Runtime 规避。
- `AppConfig` 新增必填字段会触发轻量测试/fixture 的类型面更新；必须保持 `buildApp` 可注入且不构造 LLM/Runtime。
- SSRF false 只能扩大解析地址范围，不能放宽 URL/redirect/port/DNS/size/cancel；警告只通过既有 `Logger.error` 安全事件输出。
- zstd 修复必须由 Node 26 真实 HTTP fixture 证明自动解压形状；只保证解压后上限，不宣称限制压缩网络字节。
- 生产 hook 的 scheduler/runtime/HTTP/DB 顺序及失败聚合需精确测试；close failure 不得跳过后续资源清理。
- T04 文档索引同步必须保留原 D00～D16/69 卡语义，只加入 G1 批准的 D11A 前置例外。
- `ASM-08_REAL_E2E` 与 P0/CI 严格分离；真实输入缺失或失败时不得用 Stub 结果替代。
