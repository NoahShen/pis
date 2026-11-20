# D11A Progress：运行整合与环境适配

- 状态：`G3_APPROVED`
- 计划基线：main `be98bccc68a81a61ebbc2b216c78da8d72aefa7b`
- G1：`APPROVED`（`intent.md`）
- G2：`APPROVED`（`spec.md`，含 Node 26 单值 zstd 口径）
- G3：`APPROVED · Architect · 2026-11-21`
- 当前交付：T01/T02 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T03 `READY`
- 当前 Lead：`f2cdf8e5-c3ec-46bb-9bd8-a6e9c58d1d8f` / `wks_1b975dad53475f31`
- 固定执行 base：T02 `a8f8dcc2cb193ecf0c40d9813cfc34924cf01c47`
- 当前写集：仅 `docs/milestones/D11A/plan.md`、`docs/milestones/D11A/progress.md`
- Worker：T01/T02 已归档；当前 `NONE`
- Candidate/Merge/Push：T01 `7ee1c99d9ef3551ff5da72eec20264757227e0d4` / `6f1e4e419c3a66453b1df758df00d01e65f9c858`；T02 `a11774fa0b3d68ef032b6ae9536e7bb34e073e60` / `82a0c97ae9292c0a320097c0c62ac14ea3627635`；尚未 push
- 开发心跳：`ca6cd3ae`（active，10 分钟，只提醒主 Architect）

## 任务状态

| 卡片 | 状态 | 前置 base | 交接/证据 |
|---|---|---|---|
| `D11A-T01` 配置与 smoke 兼容 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `5765bd7a362988e82caf0f506e15446dd4339e85` | G4 APPROVED；定向 9/93；full 107/1198；merge tree `9b02c4911b3841a7291b41354e9c827e2988bbc7` |
| `D11A-T02` SSRF 与 zstd | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `a8f8dcc2cb193ecf0c40d9813cfc34924cf01c47` | G4 APPROVED；定向 4/197；full 108/1220；merge tree `b26eee4c675cc629bcf32791570dea576d72145b` |
| `D11A-T03` 生产装配与生命周期 | `READY` | T02 closeout 文档提交 | 待 Lead 派发 |
| `D11A-T04` 集成、smoke、文档 | `NOT_STARTED` | T03 closeout 文档提交 | 未派发 |

## 当前验证

- 已核对固定 base、G1/G2、当前 `src`/`tests`/`scripts` 基线及文档索引冲突。
- T01 Architect G4 独立 patch/tree/merge-tree 复核通过；定向 9 files/93 tests，typecheck/build/7 项 smoke/database smoke/format 279 files 通过。
- T01 合并后独立复验：full 107 files/1198 tests；typecheck/build/全部 smoke/format 通过。
- T01 frozen tree `5b61cf5f5b89a00337170b3d4d7871c31e82193d`；patch `/tmp/d11a-t01-freeze.s1UkIn/d11a-t01-frozen.patch`；SHA-256 `9d0647324c72d792490bd62ac65f7ae28f0511f4ec4f61726804e5224048ebd4`；11 blobs 与 Lead 清单一致。
- T01 Worker/Workspace `wks_366bb3154631565a` 已归档，目录已移除。
- T02 Architect G4 独立复核通过：frozen tree `7301fd660db58a93360cc2d1d8a12949e7706c84`；patch `/tmp/d11a-t02-freeze.lI01ha/d11a-t02-frozen.patch`；SHA-256 `f98ea3e38d83021b5360a23e5f4137b1a50648e7334f52d2100d724921cdff32`；7 blobs 与 Lead 清单一致。
- T02 合并后独立复验：定向 4 files/197 tests；full 108 files/1220 tests；typecheck/build/全部 smoke/format 280 files 通过。
- T02 relax 保留 public unicast，只放宽明确地址范围；zstd 单值支持仍走流式 readBody，未知/多值拒绝，解压后上限与取消有效。
- T02 Worker/Workspace `wks_e6a7e7a1c257783e` 已归档，目录已移除。
- T03 尚无实现或测试结果。

## 关键风险

- T01 将 `PIS_LLM_*` 变为生产必填，必须同步全部真实进程 smoke 的合成配置，不能通过放宽 `verify` 或空 Runtime 规避。
- `AppConfig` 新增必填字段会触发轻量测试/fixture 的类型面更新；必须保持 `buildApp` 可注入且不构造 LLM/Runtime。
- SSRF false 只能扩大解析地址范围，不能放宽 URL/redirect/port/DNS/size/cancel；警告只通过既有 `Logger.error` 安全事件输出。
- zstd 修复必须由 Node 26 真实 HTTP fixture 证明自动解压形状；只保证解压后上限，不宣称限制压缩网络字节。
- 生产 hook 的 scheduler/runtime/HTTP/DB 顺序及失败聚合需精确测试；close failure 不得跳过后续资源清理。
- T04 文档索引同步必须保留原 D00～D16/69 卡语义，只加入 G1 批准的 D11A 前置例外。
- `ASM-08_REAL_E2E` 与 P0/CI 严格分离；真实输入缺失或失败时不得用 Stub 结果替代。
