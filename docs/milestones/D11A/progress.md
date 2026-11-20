# D11A Progress：运行整合与环境适配

- 状态：`G3_APPROVED`
- 计划基线：main `be98bccc68a81a61ebbc2b216c78da8d72aefa7b`
- G1：`APPROVED`（`intent.md`）
- G2：`APPROVED`（`spec.md`，含 Node 26 单值 zstd 口径）
- G3：`APPROVED · Architect · 2026-11-21`
- 当前交付：T01～T04 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；ASM-08 `PASS`；D11A Local Gate `READY`
- 当前 Lead：`f2cdf8e5-c3ec-46bb-9bd8-a6e9c58d1d8f` / `wks_1b975dad53475f31`
- 固定执行 base：T04 `354367a2affc5a6f033a16a9b3dcd413320c57ef`
- 当前写集：仅 `docs/milestones/D11A/plan.md`、`docs/milestones/D11A/progress.md`
- Worker：T01～T04 已归档；当前 `NONE`
- Candidate/Merge/Push：T01 `7ee1c99d9ef3551ff5da72eec20264757227e0d4` / `6f1e4e419c3a66453b1df758df00d01e65f9c858`；T02 `a11774fa0b3d68ef032b6ae9536e7bb34e073e60` / `82a0c97ae9292c0a320097c0c62ac14ea3627635`；T03 `d0da981a340746bd372da87c117053f5fae6987b` / `93da31ceb7201659cfac82cbf832da9a12be5c49`；T04 `9baa315f06b4569981b54b86b2b0e6c8674ba5e0` / `46f572ddb94d1ea784c3c4c4f50610ceb395bd09`；尚未 push
- 开发心跳：`ca6cd3ae`（active，10 分钟，只提醒主 Architect）

## 任务状态

| 卡片 | 状态 | 前置 base | 交接/证据 |
|---|---|---|---|
| `D11A-T01` 配置与 smoke 兼容 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `5765bd7a362988e82caf0f506e15446dd4339e85` | G4 APPROVED；定向 9/93；full 107/1198；merge tree `9b02c4911b3841a7291b41354e9c827e2988bbc7` |
| `D11A-T02` SSRF 与 zstd | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `a8f8dcc2cb193ecf0c40d9813cfc34924cf01c47` | G4 APPROVED；定向 4/197；full 108/1220；merge tree `b26eee4c675cc629bcf32791570dea576d72145b` |
| `D11A-T03` 生产装配与生命周期 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `a9ea7aab380d0ef4fb88a8fe2251349b2594f4d9` | G4 APPROVED；定向 15/131；full 110/1233；merge tree `0d19d0a9e3887685abd8e673dabbcbbdfe7cc1f4` |
| `D11A-T04` 集成、smoke、文档 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `354367a2affc5a6f033a16a9b3dcd413320c57ef` | G4 APPROVED；定向 1/2；full 111/1235；merge tree `7cc8f193b3a2684cdb6ae788251c7e4335429bc0` |

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
- T03 Architect G4 独立复核通过：frozen tree `3a866b0a1cea92e20f2aedb3667c0a418b5078ab`；patch `/tmp/d11a-t03-freeze.NB1Lfk/d11a-t03-frozen.patch`；SHA-256 `0d32aa17aea4de4e336b99ac0c89019c846caf519adccb7460e48373ccd96908`；5 blobs 与 Lead 清单一致。
- T03 合并后独立复验：定向 15 files/131 tests；full 110 files/1233 tests；typecheck/build/全部 smoke/format 284 files 通过。
- T03 六阶段真实 factory/共享依赖/配置 API/单 Runtime+Scheduler 接线通过；正常与失败路径均按 Scheduler→Runtime→HTTP→DB 清理，listen Promise/callback 兼容，SSRF false 警告恰好一次。
- T03 Worker/Workspace `wks_1051e6b982b31a7f` 已归档，目录已移除。
- T04 Architect G4 独立复核通过：frozen tree `fe52a2500baedc3663fa954485fe25c16b8c1e95`；patch `/tmp/d11a-t04-freeze.4IbM1X/d11a-t04-frozen.patch`；SHA-256 `45339aca72c43a37470d91999d7e11c6f0353ca8a81c60ec1dfda3f7bc557bbc`；8 blobs 与 Lead 清单一致。
- T04 合并后 main 完整 `npm run verify` 通过：111 files/1235 tests，既有+production+database smoke，format 287 files。
- T04 正式 Runtime/Scheduler 纵向链无手工阶段调用；production smoke 使用真实 dist/server.js；原 69 卡与三份索引一致；package-lock 不变。
- T04 Worker/Workspace `wks_df025aa7808606c5` 已归档，目录已移除。
- ASM-08 真实双 RSS/LLM 已通过：正式 `createProductionAssembly` + Scheduler + Runtime，生产 Restricted RSS Transport，无临时 DoH/Transport 适配；Fake-IP 调试显式 SSRF=false。
- ASM-08 第二次正式运行：65 次真实模型调用；独立临时库累计 40 Source Items/Contents、12 Events、17 Knowledge、32 Topic Associations、24 Published Items（EVENT/KNOWLEDGE 各 12）。结果 `SUCCESS`，无 blocked_url、unsupported_encoding、模型失败或关闭失败。
- ASM-08 证据：`/private/tmp/pis-d11a-real-e2e/summary.json`、`/private/tmp/pis-d11a-real-e2e-rerun.log`；未记录密钥、完整私有 URL、正文或 User Context。
- 首次 harness 在 app.close 后查询 DB 导致汇总 TypeError，已修正为关闭前快照并独立只读复核；不属于生产缺陷，第二次正式运行通过。
- 下一步：Architect 干净快照最终 Gate、push 精确 main SHA、远程 CI。

## 关键风险

- T01 将 `PIS_LLM_*` 变为生产必填，必须同步全部真实进程 smoke 的合成配置，不能通过放宽 `verify` 或空 Runtime 规避。
- `AppConfig` 新增必填字段会触发轻量测试/fixture 的类型面更新；必须保持 `buildApp` 可注入且不构造 LLM/Runtime。
- SSRF false 只能扩大解析地址范围，不能放宽 URL/redirect/port/DNS/size/cancel；警告只通过既有 `Logger.error` 安全事件输出。
- zstd 修复必须由 Node 26 真实 HTTP fixture 证明自动解压形状；只保证解压后上限，不宣称限制压缩网络字节。
- 生产 hook 的 scheduler/runtime/HTTP/DB 顺序及失败聚合需精确测试；close failure 不得跳过后续资源清理。
- T04 文档索引同步必须保留原 D00～D16/69 卡语义，只加入 G1 批准的 D11A 前置例外。
- `ASM-08_REAL_E2E` 与 P0/CI 严格分离；真实输入缺失或失败时不得用 Stub 结果替代。
