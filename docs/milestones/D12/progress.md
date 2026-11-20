# D12 Progress：本地静态 RSS 生成与归档

- 状态：`G3_APPROVED · DEVELOPMENT`
- 当前 Plan：v0.3
- 计划基线：main `d3a86fb8c2ee1571978058d69fe636c13da84796`
- G1：`APPROVED`（`intent.md`；负责人授权文档完成后直接开发；pending 覆盖修订随 `d3a86fb8` 基线）
- G2：`APPROVED · Architect`（`spec.md` pending 覆盖修订；依赖 D00～D11、D11A、D15，不依赖 D13）
- G3：`APPROVED · Architect · Plan v0.3`
- 当前阶段：T01 派发；G3 已批准四卡串行开发，进入开发后创建只提醒心跳
- 当前写集：仅 `docs/milestones/D12/plan.md`、`docs/milestones/D12/progress.md`
- 当前 Lead：`380573ec-d799-42ad-a7fd-2baa83a166f5` / `wks_32173d9a41b654ff`
- Worker：`NONE`
- 开发心跳：`NOT_CREATED`；只在 Architect G3 批准并开始正式开发后创建
- Candidate/Merge/Push：`NONE`

## 任务状态

| 卡片 | 状态 | 前置 base | 定向 Case | 交接/证据 |
|---|---|---|---|---|
| `D12-T01` RSS contracts/renderer | `READY` | `C0`（G3 后 plan/progress 文档提交） | `RSS-01`～`RSS-07` | G3 APPROVED；待新 Worker |
| `D12-T02` pending/归档规划/RFC 5005 | `NOT_STARTED` | `C1`（T01 PASS closeout） | `RSS-08`～`RSS-10`、`RSS-17` | 待 T01 |
| `D12-T03` 本地 Store/pending 原子替换 | `NOT_STARTED` | `C2`（T02 PASS closeout） | `RSS-11`、`RSS-24`；原语支撑 12/14 | 待 T02 |
| `D12-T04` pending 文件集/smoke/只读验收 | `NOT_STARTED` | `C3`（T03 PASS closeout） | `RSS-12`～`RSS-14`、`RSS-18` | 待 T03 |

## 当前验证与基线核对

- 已读取 `AGENTS.md`、`docs/project-development.md`、D12 Intent/Spec、D11A Plan/Progress、技术设计 §4/§14.3、实施计划 D12、测试用例 `RSS-01`～`RSS-24`、D11 Publication contracts/repository/source-link，以及 package/scripts/test fixture 基线。
- 当前 Git HEAD：`d3a86fb8c2ee1571978058d69fe636c13da84796`；该提交只同步 D12 `intent.md`/`spec.md`。worktree 未带入其他改动，当前未跟踪变化仅 `plan.md`/`progress.md`。
- 现有依赖已包含 `fast-xml-parser 5.12.1`、`linkedom 0.18.15`；D12 Plan 规定新增依赖 `NONE`、`package-lock.json` 不变。
- 现有 D11 `PublishedItemRepository.listForFeed` 已按 `(published_at DESC,id DESC)` 提供 EVENT+EVENT_UPDATE 与 KNOWLEDGE；D12 只读复用，不新增 SQL 表/Repository 业务语义。
- 当前默认运行时前置为 Node `v26.13.1`/npm `11.20.0`；所有任务先运行 `npm run verify:toolchain`。

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
