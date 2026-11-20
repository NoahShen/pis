# D12 Progress：本地静态 RSS 生成与归档

- 状态：`G3_APPROVED · DEVELOPMENT`
- 当前 Plan：v0.3
- 计划基线：main `d3a86fb8c2ee1571978058d69fe636c13da84796`
- G1：`APPROVED`（`intent.md`；负责人授权文档完成后直接开发；pending 覆盖修订随 `d3a86fb8` 基线）
- G2：`APPROVED · Architect`（`spec.md` pending 覆盖修订；依赖 D00～D11、D11A、D15，不依赖 D13）
- G3：`APPROVED · Architect · Plan v0.3`
- 当前阶段：T01～T04 已合并归档；D12 Final Gate
- 当前写集：仅 `docs/milestones/D12/plan.md`、`docs/milestones/D12/progress.md`
- 当前 Lead：`380573ec-d799-42ad-a7fd-2baa83a166f5` / `wks_32173d9a41b654ff`
- Worker：T01～T04 已归档；当前 `NONE`
- 开发心跳：`4d068a00`（active，10 分钟，只提醒主 Architect）
- Candidate/Merge/Push：T01 `d50fd08a50a8d9b8ee8074ade9b34870a05e589c` / `e75aea987d9ec70f96626602b9ee4073c4c7b0ca`；T02 `3fac986bc66927801b91eb22465dc1e2d1d408cf` / `547794d6912c9707abad6959f318acde36855086`；T03 `e57e7f926d8bf02ecf3993b529c0416876caa2eb` / `ad939f28b367ccfd324eabb10b72f81f9e32e260`；T04 `4cf385708291b8f37422624580c2265346850066` / `8b98aba618bd65215a209d7ec0616e3c6d20e398`；尚未 push

## 任务状态

| 卡片 | 状态 | 前置 base | 定向 Case | 交接/证据 |
|---|---|---|---|---|
| `D12-T01` RSS contracts/renderer | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `06ac6dafe380939a7da0d1b15b27898ae48384ac` | `RSS-01`～`RSS-07` | G4 APPROVED；定向 3/25；full 114/1260；tree `b623047fb85ed5922a6ecb79d00e541355e7fa78` |
| `D12-T02` pending/归档规划/RFC 5005 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `a508e0920a074deae8fecb6ad10fefa29ce78459` | `RSS-08`～`RSS-10`、`RSS-17` | G4 APPROVED；定向 3/27；full 117/1287；tree `4dcad1ef98d37805b09fd92c1f297de8803322c5` |
| `D12-T03` 本地 Store/pending 原子替换 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `ab82dad56caa3c5acd6ccb748b620f3efa3e4764` | `RSS-11`、`RSS-24`；原语支撑 12/14 | G4 APPROVED；定向 3/31；full 119/1304；tree `d48ae430ddd8aa890fa95921cdf2a60b3aec41a7` |
| `D12-T04` pending 文件集/smoke/只读验收 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `f0c7e94045f4858ff879fa1ad772f4c7482fc053` | `RSS-12`～`RSS-14`、`RSS-18` | G4 APPROVED；定向 2/4；full 121/1308；tree `e7a11f5850fb05207a9c1153d5fa705bed849296` |

## 当前验证与基线核对

- 已读取 `AGENTS.md`、`docs/project-development.md`、D12 Intent/Spec、D11A Plan/Progress、技术设计 §4/§14.3、实施计划 D12、测试用例 `RSS-01`～`RSS-24`、D11 Publication contracts/repository/source-link，以及 package/scripts/test fixture 基线。
- 当前 Git HEAD：`d3a86fb8c2ee1571978058d69fe636c13da84796`；该提交只同步 D12 `intent.md`/`spec.md`。worktree 未带入其他改动，当前未跟踪变化仅 `plan.md`/`progress.md`。
- 现有依赖已包含 `fast-xml-parser 5.12.1`、`linkedom 0.18.15`；D12 Plan 规定新增依赖 `NONE`、`package-lock.json` 不变。
- 现有 D11 `PublishedItemRepository.listForFeed` 已按 `(published_at DESC,id DESC)` 提供 EVENT+EVENT_UPDATE 与 KNOWLEDGE；D12 只读复用，不新增 SQL 表/Repository 业务语义。
- 当前默认运行时前置为 Node `v26.13.1`/npm `11.20.0`；所有任务先运行 `npm run verify:toolchain`。

## T01 Closeout

- Architect 独立 G4：frozen patch SHA-256 `83834686f3eb7c15ad20f307eaa02edacb749f2de5463c665dec55f39db9c71e`；tree `b623047fb85ed5922a6ecb79d00e541355e7fa78`；10 paths/blobs 精确。
- 定向 3 files/25 tests；merge 后 full 114 files/1260 tests；全部 smoke/database/format 297 files 通过。
- Workspace `wks_e2e03a8daad6f71b` 与 Worker 已归档，目录已移除；无生产 D11/schema/Runtime/package 变更。

## T02 Closeout

- Architect 独立 G4：patch SHA-256 `c0333006656bba8d843b01fcdbabd25431c1ff77e84d43f45bf2f17d08b5ec7e`；frozen tree `4dcad1ef98d37805b09fd92c1f297de8803322c5`；8 paths/blobs 精确。
- 定向 3 files/27 tests；merge 后 full 117 files/1287 tests；全部 smoke/database/format 303 files 通过。
- Lead 中间发现同名 sealed payload 漂移漏检，已增加写前重建 bytes 比较及回归；冲突 pending/head 零写。
- Workspace `wks_b63bc3fa2a4e36a0` 与 Worker 已归档，目录已移除。

## T03 Closeout

- Architect 独立 G4：patch SHA-256 `dfbaf9c2488fbd3289cfc84385adce326b896625ded88cb5d6cab0b49f975781`；frozen tree `d48ae430ddd8aa890fa95921cdf2a60b3aec41a7`；6 paths/blobs 精确。
- 定向 3 files/31 tests；merge 后 full 119 files/1304 tests；全部 smoke/database/format 307 files 通过。
- only-if-absent 使用独占 link；head/pending 原子 rename；路径/symlink containment 与失败清理符合 Plan。
- Workspace `wks_a216c01a24c6ca91` 与 Worker 已归档，目录已移除。

## T04 Closeout

- Architect 独立 G4：patch SHA-256 `a63d2ce2f65fe2c3589758868c24740e35fe04dbda40524fa68d8bdd52b489f4`；frozen tree `e7a11f5850fb05207a9c1153d5fa705bed849296`；7 paths/blobs 精确。
- 定向 2 files/4 tests；merge 后 full 121 files/1308 tests；全部 smoke（含 RSS）、database/format 312 files 通过。
- D11A 真实临时库只读验收通过：EVENT_UPDATES=12、CURATED_CONTENT=12，head/pending/XML/static 均通过；DB main/WAL/SHM pre/post SHA-256 完全一致，临时输出已清理。
- 真实证据：`/private/tmp/d12-real-readonly-summary.json`；未记录正文、完整 URL、secret 或私有配置。
- Workspace `wks_3ff9a2d8c071f3f9` 与 Worker 已归档，目录已移除；package-lock 不变。

## G3 复核摘要

- 四卡严格串行、文件写集互斥；T01 冻结 contracts/Feed definition 与 head/pending/archive renderer，T02 冻结 pending/归档算法，T03 只落本地文件系统，T04 完成 head+pending+archive 文件集与验收层。
- 每个 Feed 固定根级 `<feed>-pending.xml`，保存 0～199 条当前未封存余量；它是可重建、可原子替换且包含 `<fh:archive/>` 的 RFC 5005 archive document。head 不含 `<fh:archive/>`，满 200 条封存 archive 含；pending 不是满 200 条不可变封存批次、业务队列或 Outbox。
- 归档 URI/GUID/bytes 以既有 XML 恢复边界；冲突保留旧 archive/pending/head；写序固定新 archive→pending→head，任意快照 head+pending+archive 按 GUID 去重覆盖当前全集。
- D11A 真实临时库只读验收位于 T04 G4 后人工阶段；缺失时只能 `BLOCKED`，不能用合成 Stub 替代。
- 旧 safety-pending 延迟方案已删除；极旧迟到项必须立即出现在 pending 并从静态链可达，不得仅以计数报告代替实际条目。

## 当前阻塞与待决策事项

- 唯一门禁：等待 Architect G3 审核 `plan.md` 与 `progress.md`。G3 前不派发 Worker。
- 无实现阻塞、无 Worker 阻塞、无云端平台阻塞；D13 Gitee/GitHub Pages 决策不进入 D12。

## 下一可执行任务

1. Architect 审核 Plan v0.3 的文件级写集、串行依赖、Case 映射、pending RFC 5005 文档语义/链/写序、冻结/G4/merge/归档流程。
2. G3 通过后，Architect 创建并登记 D12 开发心跳，交由 Lead 更新 Progress 并派发 `D12-T01` 的新会话 Worker。
3. T01 完成后按 Worker→Lead→Architect→candidate/merge-tree/merge→full verify/归档串行推进。
