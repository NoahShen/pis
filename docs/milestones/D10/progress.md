# D10 Progress：Topic Matching / 关注范围关联

- Plan：`docs/milestones/D10/plan.md` v0.1
- Plan 状态：`APPROVED · G3`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划与首个执行基线：main `c0328e035cc24127d7c3b6ee92e02d68092e8648` / tree `f2fa99b64c38854e60af4c6792fe06e4f58f5c09`
- 执行基线：`dd1ff01373827ad0db783b81e27a605307bbf945` / tree `ba6299221eb3e7ecdb9df19f131b2a41d2a4661b`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · D10-T02 Worker 已归档`
- 开发心跳：`11a58bbe`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前结论：`D10_PLAN=G3_APPROVED`；T01/T02 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`，T03～T04 `NOT_STARTED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D10-T01 Targets DTO/只读 Repository | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `dd1ff01373827ad0db783b81e27a605307bbf945` | PASS（merge 后定向 6 files/42 tests；full 78 files/948 tests；format 214 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D10-T02 启用快照/P-05 单次调用 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444` | PASS（merge 后定向 5 files/58 tests；full 79 files/971 tests；format 217 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D10-T03 Association/同步短事务 | `NOT_STARTED` | `22304bda5b4793c92821ad8ebff715319ba29851` | NOT_RUN | PENDING | PENDING | 等待 Architect 核对 main |
| D10-T04 Factory/复用跳过/P0 集成 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | NOT_RUN | PENDING | PENDING | 等待 T03 PASS |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D10-T01 | `dd1ff01373827ad0db783b81e27a605307bbf945` | `e104f025-a000-4f2d-8c31-9d0bc7a29b5e` | `wks_e0812e29a9de6c98` | `feat/d10-t01-target-repository` | 精确 4 新增，见 Plan §4.1 | `8bba131b857974bd1c5fbe81100d0b15bacf5ce3` | `7b986a8989d0c4ff11e3a60a3988b63d76cc639c97b62c0395f04180bba6f138` | `APPROVED · G4` | `04b26da1ebd6425988cb40e4c96f755be8f62a80` | `5bc0e6857cace69643a836be4e1a9e73b7fa734c` | `8bba131b857974bd1c5fbe81100d0b15bacf5ce3` | PASS（merge 后定向 6/42；full 78/948；format 214） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D10-T02 | `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444` | `b0601168-a575-41ae-8845-7fda84999424` | `wks_21a4115be732ff96` | `feat/d10-t02-p05-call-boundary` | 精确 4 路径：2 新增 src + fixture 修改 + 1 新增测试 | `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b` | `cfbf7dcc2edd1debb42877052fda7406f5153522222ee9d3a5a095b8f11fc58c` | `APPROVED · G4` | `889d3797c1b72cf1e6e20d4e33a506298990e6b9` | `22304bda5b4793c92821ad8ebff715319ba29851` | `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b` | PASS（merge 后定向 5/58；full 79/971；format 217） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D10-T03 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |
| D10-T04 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | NOT_RUN | PENDING |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `TOP-01` | T01 EVENT DTO；T04 真实 SQLite 单 Topic、1 行关联、一次 true；不声称派发 PublishTask |
| `TOP-02` | T03 多 Topic 快照顺序写入/同一 matched_at；T04 只返回一次 true |
| `TOP-03` | T02 空数组成功；T04 P-05 1 次、零关联、false、目标保留 |
| `TOP-04` | T02/T04 空启用 Topic、P-05 0、零关联、false |
| `TOP-05` | T02 D02 拒绝禁用 ID；T04 llm_failed、零关联 |
| `TOP-08` | T01 Update 上下文不含历史/继承；T04 父 Event 已关联、Update 空匹配不继承 |
| `TOP-09` | T01/T04 Update 只写自身匹配 Topic |
| `TOP-10` | T02 快照；T04 读取后真实 disable，本次仍按原快照完成 |
| `TOP-11` | T04 新建/修改 Topic 无自动 Matching、旧关联/Published Item 不变 |
| `TOP-12` | T02/T04 D02 去重重复 ID；非法 ID/非数组零写 |
| `TOP-14` | T01 Knowledge DTO 精确；T04 真实 task data 使用 Title/Summary/Category/Findings/Value |
| `TOP-15` | T01 三类不存在返回 null；T04 target_not_found、零 LLM/零写 |
| `TOP-16` | T03/T04 已关联后禁用 Topic，不删历史、重复执行 true、P-05 0 |
| `TOP-06` | T04 已有关联的 D10 zero-LLM 复用、零写、true；不冒充 PublishTask |
| `TOP-07` | T04 已有 Published Item 的 zero-LLM 跳过、零写、false |
| `PMT-07` | T02/T04 D02 strict JSON/Schema/引用；非 JSON、缺字段、额外字段、错误类型零写 |
| `PMT-09` | T02/T04 P-05 user JSON 仅 task_data，无 user_context |
| `ATOMIC` | T03/T04 LLM 事务外、单同步事务、同 matched_at、失败全回滚、thenable 拒绝 |
| `PRIVACY` | T02/T04 error/logger 无 Topic 名称/描述、正文、Prompt、模型原文或 Token |

`PMT-06` 为 S0 真实模型语义，不属于 D10 P0 Gate；`TOP-13` 为 P1，不用 Stub 冒充真实模型语义质量。D10 不派发 PublishTask、不生成 Published Item、不实现 RSS/Runtime。

## 当前阻塞与待决策事项

- T01/T02 均已完成 G4、candidate、`--no-ff` merge、merge 后复验与 Worker 归档；当前唯一门禁为 Architect 核对 D10 main。
- 基线 `c0328e035cc24127d7c3b6ee92e02d68092e8648` 仅比 D09 最终代码基线 `a6934b1` 增加 D10 Intent/Spec 文档，未含生产代码变化。
- D02 既有 P-05 strict Schema/Topic ID 引用/首次顺序去重与 D03 `listEnabled()` enabled + BINARY 顺序均已只读核对，未发现阻止实现的冲突。
- 本轮不读取私有 `config/prompts`/`config/prompt/user-context.md`；实现测试只使用临时合成 Prompt/sentinel。

## 下一可执行动作

1. Architect 核对 T02 merge SHA、merge tree、复验数字与归档证据。
2. 在 Architect 明确批准 T03 启动前，T03 保持 `NOT_STARTED`，不得创建下一个 Worker。
3. 批准后以 T02 merge SHA `22304bda5b4793c92821ad8ebff715319ba29851` 作为 T03 固定 base。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D10/plan.md`、`docs/milestones/D10/progress.md`。
- 四卡严格串行；每卡列精确写集、固定 base、Spec/Case 映射、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。

## G3 批准与执行基线

- Architect 核对 Lead Plan 提交 `1aee9c472e3d21f384cbae3531b6e62f61bdf02e`，tree `7c926279161875836aa109f7da38fba968273948`，精确 2 个文档路径。
- 核对结论：四卡写集精确、冻结字段完整、Case 映射覆盖 TOP-01～05/08～12/14～16、PMT-07、PMT-09、ATOMIC、PRIVACY；P-05 全在事务外、`matched_at` 单次 Clock、`EVENT_UPDATE` 不带历史 Update 与父关联、D02 为唯一 Schema/引用校验。
- `D10_PLAN=G3_APPROVED`。
- 执行基线为包含本记录的提交；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。
- 开发心跳：`G3 后创建`，`*/10 * * * *`，Asia/Shanghai。

## D10-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `e104f025-a000-4f2d-8c31-9d0bc7a29b5e`，workspace `wks_e0812e29a9de6c98`，branch `feat/d10-t01-target-repository`。
- Worker HEAD 保持 `dd1ff01373827ad0db783b81e27a605307bbf945` / tree `ba6299221eb3e7ecdb9df19f131b2a41d2a4661b`；无 commit/stage/amend/merge/push。
- 精确写集：4 个新增路径，仅 Plan §4.1 白名单；禁止路径 diff 为空。
- DTO：EVENT 8 字段、EVENT_UPDATE 当前进展 + 父 Event 六基础字段、KNOWLEDGE 6 字段；所有映射逐字段显式重建，无 row spread 或 `SELECT *`。
- Update Repository 只 JOIN 父 Event，不查询历史 Update 或父 Event Association；反向测试插入历史 Update 与父 Event Association 后 DTO 仍无相关字段。
- Knowledge `findings_json` 只投影 `title/description`；缺字段/非对象元素、非法 category、malformed row 均抛错，不返回部分 DTO；SQL NULL category 保持 null。
- 生产源码仅 SELECT；无 LLM、写 SQL、事务、logger、发布资格、Runtime 或网络。静态扫描命中仅为 fixture 建数 `INSERT`、只读快照表名及 `EVENT_UPDATE`/`SELECT_EVENT_UPDATE_TARGET` 标识符。
- 独立验证：typecheck PASS；定向 6/6 files、42/42 tests PASS；full `npm run verify` PASS（78/78 files、948/948 tests；build、全部 smoke、database smoke、214 files format PASS）。
- 精确冻结：tree `8bba131b857974bd1c5fbe81100d0b15bacf5ce3`；canonical full-index binary patch `/private/tmp/d10-t01-freeze.SBshiA/d10-t01.patch`，SHA-256 `7b986a8989d0c4ff11e3a60a3988b63d76cc639c97b62c0395f04180bba6f138`，31944 bytes、4 路径。
- 冻结 blob：`contracts.ts`=`d3735f42c38671888c3eb488f08747c6d93a50f0`；`topic-matching-target-repository.ts`=`b354ad5b347a905fe9fb5d32cc55aedd25f864d8`；`tests/fixtures/topic-matching.ts`=`4c50ac5819782e735de2bd7e28200be61612b8c4`；目标 Repository 测试=`85157bcdb555c4412afc0dcb2e95d4b49dd96ada`。
- patch 可从固定 base 重建；重建 tree `8bba131b857974bd1c5fbe81100d0b15bacf5ce3` 与冻结 tree 逐字一致；`git diff-tree --check` 通过。
- T01 Lead 冻结结论：`REVIEW · FROZEN_PENDING_G4`；冻结证据保持有效。

## D10-T01 G4、Candidate、Merge 与归档

- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、4 路径、tsc、11/11 目标用例、真实 SQLite DTO 键集与受保护路径 diff=0。
- Candidate：`04b26da1ebd6425988cb40e4c96f755be8f62a80`，唯一 parent `dd1ff01373827ad0db783b81e27a605307bbf945`，tree `8bba131b857974bd1c5fbe81100d0b15bacf5ce3`，精确 4 新增路径；Worker branch tip 对齐且 clean。
- Merge：`5bc0e6857cace69643a836be4e1a9e73b7fa734c`；第一 parent `dd1ff013`、第二 parent candidate `04b26da1`，merge tree `8bba131b857974bd1c5fbe81100d0b15bacf5ce3`，与 candidate 逐字一致。
- Merge 后复验：typecheck PASS；定向 6/6 files、42/42 tests PASS；full `npm run verify` PASS（78/78 files、948/948 tests；build、全部 smoke、database smoke、214 files format PASS）。
- Worker 归档：`archive_workspace(wks_e0812e29a9de6c98)` 返回 `archivedAgentIds=[e104f025-a000-4f2d-8c31-9d0bc7a29b5e]`、`removedDirectory=true`；Agent `closed/archived`，活跃 workspace 列表与 Git worktree 均无该项。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未启动 T02、未 push、未签发 D10 最终 PASS。

## D10-T02 Lead 复核、冻结与完成记录

- Worker 交回：`REVIEW`；Agent `b0601168-a575-41ae-8845-7fda84999424`，workspace `wks_21a4115be732ff96`，branch `feat/d10-t02-p05-call-boundary`。
- Worker HEAD 保持 `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444` / tree `653087f5ea196c88409852c26066366436100a18`；无 commit/stage/amend/merge/push，受保护路径 diff 为空。
- 精确写集：4 路径（2 新增 src、fixture 修改、1 新增测试），仅 Plan §5.1 白名单。
- Payload：target 三型逐字段快照；Topic 仅 `id/name/description`，保持输入顺序；references 仅 `enabledTopicIds` 同序且不复制 D02 去重/引用校验。
- 调用：恰好一次 `matchTopics(taskData,references,{signal})`，原样透传并返回 D02 成功结果；pre-abort 0 次，调用中/返回后取消优先 `aborted`，普通失败映射 `llm_failed`。
- 错误：五码/message 精确；`AbortError`、`ABORT_ERR`、`LLM_CANCELLED` 与既有 aborted 安全识别，不保留 cause。
- 真实 D02 测试覆盖 strict P-05、非 JSON、缺失/额外字段、错误类型、非法/禁用 Topic ID 与首次顺序去重；P-05 user JSON 仅 `task_data`，无 User Context。
- 独立验证：toolchain/typecheck PASS；固定回归 5/5 files、58/58 tests PASS；full `npm run verify` PASS（79/79 files、971/971 tests；build、全部 smoke、database smoke、217 files format PASS）。
- 精确冻结：tree `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b`；patch `/private/tmp/d10-t02-freeze.udQrd2/d10-t02.patch`，SHA-256 `cfbf7dcc2edd1debb42877052fda7406f5153522222ee9d3a5a095b8f11fc58c`，27979 bytes、4 路径；patch 重建 tree 与冻结 tree 一致。
- 冻结 blob：`topic-matching-errors.ts`=`d43b0de643a5cfba425c2ee7aedb48d6a7425299`；`topic-matching-call.ts`=`993ffa097b4ebd00d133364256bb8d0c88b66307`；fixture=`ae2be9cfdc3d491c5db7ddb7e5bf81138c62c40b`；call 测试=`a8125f054692fc3447719c9488fb1d6ff6ac7a58`。
- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、4 路径、tsc、D02/调用边界 3 files/44 tests、payload 顺序/快照/abort 探针及受保护路径 diff=0。
- Candidate：`889d3797c1b72cf1e6e20d4e33a506298990e6b9`，唯一 parent `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444`，tree `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b`，精确 4 路径；Worker branch tip 对齐且 clean。
- Merge：`22304bda5b4793c92821ad8ebff715319ba29851`；第一 parent `8cca81b7`、第二 parent candidate `889d3797`，merge tree `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b`，与 candidate 逐字一致。
- Merge 后复验：toolchain/typecheck PASS；定向 5/5 files、58/58 tests PASS；full `npm run verify` PASS（79/79 files、971/971 tests；build、全部 smoke、database smoke、217 files format PASS）。
- Worker 归档：`archive_workspace(wks_21a4115be732ff96)` 返回 `archivedAgentIds=[b0601168-a575-41ae-8845-7fda84999424]`、`removedDirectory=true`；Agent `closed/archived`，活跃 workspace 列表与 Git worktree 均无该项。
- T02 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未启动 T03、未 push、未签发 D10 最终 PASS。
