# D10 Progress：Topic Matching / 关注范围关联

- Plan：`docs/milestones/D10/plan.md` v0.1
- Plan 状态：`APPROVED · G3`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划与首个执行基线：main `c0328e035cc24127d7c3b6ee92e02d68092e8648` / tree `f2fa99b64c38854e60af4c6792fe06e4f58f5c09`
- 执行基线：`dd1ff01373827ad0db783b81e27a605307bbf945` / tree `ba6299221eb3e7ecdb9df19f131b2a41d2a4661b`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · D10-T04 Worker 已归档`
- 开发心跳：`11a58bbe`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前结论：`D10_PLAN=G3_APPROVED`；四卡均 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；`D10_LOCAL_GATE=EVIDENCE_READY`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D10-T01 Targets DTO/只读 Repository | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `dd1ff01373827ad0db783b81e27a605307bbf945` | PASS（merge 后定向 6 files/42 tests；full 78 files/948 tests；format 214 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D10-T02 启用快照/P-05 单次调用 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444` | PASS（merge 后定向 5 files/58 tests；full 79 files/971 tests；format 217 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D10-T03 Association/同步短事务 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `d4f4b49a44fccbdff6738b2028612f349680a61a` | PASS（merge 后定向 7 files/42 tests；full 82 files/986 tests；format 223 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D10-T04 Factory/复用跳过/P0 集成 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `aa0e318d9ef4de28b6ce2c6f0c9f29777e31e6b9` | PASS（merge 后固定回归 17 files/168 tests；full 84 files/1038 tests；format 228 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D10-T01 | `dd1ff01373827ad0db783b81e27a605307bbf945` | `e104f025-a000-4f2d-8c31-9d0bc7a29b5e` | `wks_e0812e29a9de6c98` | `feat/d10-t01-target-repository` | 精确 4 新增，见 Plan §4.1 | `8bba131b857974bd1c5fbe81100d0b15bacf5ce3` | `7b986a8989d0c4ff11e3a60a3988b63d76cc639c97b62c0395f04180bba6f138` | `APPROVED · G4` | `04b26da1ebd6425988cb40e4c96f755be8f62a80` | `5bc0e6857cace69643a836be4e1a9e73b7fa734c` | `8bba131b857974bd1c5fbe81100d0b15bacf5ce3` | PASS（merge 后定向 6/42；full 78/948；format 214） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D10-T02 | `8cca81b7e54eacf9e6feb22e722bdcd4ddbab444` | `b0601168-a575-41ae-8845-7fda84999424` | `wks_21a4115be732ff96` | `feat/d10-t02-p05-call-boundary` | 精确 4 路径：2 新增 src + fixture 修改 + 1 新增测试 | `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b` | `cfbf7dcc2edd1debb42877052fda7406f5153522222ee9d3a5a095b8f11fc58c` | `APPROVED · G4` | `889d3797c1b72cf1e6e20d4e33a506298990e6b9` | `22304bda5b4793c92821ad8ebff715319ba29851` | `2239e8d76931a5d0c9be5bcdbb4c63825bca8f9b` | PASS（merge 后定向 5/58；full 79/971；format 217） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D10-T03 | `d4f4b49a44fccbdff6738b2028612f349680a61a` | `a9a832bf-ce78-4ee4-8dca-15be13f68110` | `wks_91e7a95139dab3a6` | `feat/d10-t03-association-persistence` | 精确 7 路径：3 新增 src + fixture 修改 + 3 新增测试 | `ab4b7566c2f0d8d39f48f47494aa3c5b509ed8b9` | `5654e0f819c1f7aa9b8f75de3f4d3af5ebc1912e3fd6bc05c5217caf6db20807` | `APPROVED · G4` | `92c7e658275189e886e84226918f7aa2ef615e66` | `df7a1bf97d1437fe342b1d074750652deecb0757` | `ab4b7566c2f0d8d39f48f47494aa3c5b509ed8b9` | PASS（merge 后定向 7/42；full 82/986；format 223） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D10-T04 | `aa0e318d9ef4de28b6ce2c6f0c9f29777e31e6b9` | `36e77011-5280-4445-9e07-1d8c3684fa9a` | `wks_9c409e823e94c84b` | `feat/d10-t04-service-integration` | 精确 7 路径：contracts 修改 + 3 新增 src + fixture 修改 + 2 新增测试 | `6fe0c1500b1dab6f26a01187ec36689dbff01284` | `dbc8c64ba4e50b03c71312810d34c3ebe6e8c0ff2958a87e88461dbc81a4584f` | `APPROVED · G4` | `a2a1b5b9c446be750907b5880bfa936e603f498c` | `853be803fc2883f14c92f91768a810d98b9e7251` | `6fe0c1500b1dab6f26a01187ec36689dbff01284` | PASS（merge 后固定回归 17/168；full 84/1038；format 228） | `archive_workspace` success；Agent closed/archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |

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

- T01～T03 均已完成 G4、candidate、`--no-ff` merge、merge 后复验与 Worker 归档；当前唯一门禁为 Architect 核对 D10 main。
- 基线 `c0328e035cc24127d7c3b6ee92e02d68092e8648` 仅比 D09 最终代码基线 `a6934b1` 增加 D10 Intent/Spec 文档，未含生产代码变化。
- D02 既有 P-05 strict Schema/Topic ID 引用/首次顺序去重与 D03 `listEnabled()` enabled + BINARY 顺序均已只读核对，未发现阻止实现的冲突。
- 本轮不读取私有 `config/prompts`/`config/prompt/user-context.md`；实现测试只使用临时合成 Prompt/sentinel。

## 下一可执行动作

1. Architect 核对 T03 merge SHA、merge tree、复验数字与归档证据。
2. 在 Architect 明确批准 T04 启动前，T04 保持 `NOT_STARTED`，不得创建下一个 Worker。
3. 批准后以 T03 merge SHA `df7a1bf97d1437fe342b1d074750652deecb0757` 作为 T04 固定 base。

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

## D10-T03 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `a9a832bf-ce78-4ee4-8dca-15be13f68110`，workspace `wks_91e7a95139dab3a6`，branch `feat/d10-t03-association-persistence`。
- Worker HEAD 保持 `d4f4b49a44fccbdff6738b2028612f349680a61a` / tree `9195935ed9ab2bde9fdf7308f4f32a306868b1ee`；无 commit/stage/amend/merge/push，受保护路径 diff 为空。
- 精确写集：7 路径（3 新增 src、fixture 修改、3 新增测试），仅 Plan §6.1 白名单。
- Association Repository：四字段显式投影与参数绑定；`ON CONFLICT (topic_id,target_type,target_id) DO NOTHING`；changes 仅 0/1；插入后逐字段读回；冲突不覆盖原 matched_at；写方法事务外立即拒绝。
- Published Item Repository：仅 `SELECT 1` 按 `(target_type,target_id)` 判断存在，不加载标题/正文，不写/更新/删除。
- Persistence：一次同步 `withTransaction()`；事务内先重读目标、再查任意 Association；已有关联直接 true、Clock 0 次、零写；目标消失抛 `target_not_found`。
- 实际插入：恰好一次 `clock.now()` + `formatTimestamp()`；按 `enabledTopicIds` 输入顺序过滤 matched IDs；全部关联共用同一 matched_at；不重判 Topic enabled/name/description。
- 原子性：任一 insert/readback/DB 异常原样抛出，D01 外层事务全回滚；未捕获部分结果；无 IdGenerator、logger、LLM、网络或 PublishTask。
- 独立验证：toolchain/typecheck PASS；固定回归 7/7 files、42/42 tests PASS；full `npm run verify` PASS（82/82 files、986/986 tests；build、全部 smoke、database smoke、223 files format PASS）。
- 精确冻结：tree `ab4b7566c2f0d8d39f48f47494aa3c5b509ed8b9`；patch `/private/tmp/d10-t03-freeze.R7AH1g/d10-t03.patch`，SHA-256 `5654e0f819c1f7aa9b8f75de3f4d3af5ebc1912e3fd6bc05c5217caf6db20807`，46146 bytes、7 路径；patch 重建 tree 与冻结 tree 一致。
- 冻结 blob：`published-item-repository.ts`=`54d1d0314fcb7a6bbd9f78eac63610cbc9f23473`；`topic-association-repository.ts`=`b6870908cef481fd64ceee8b96f13a9def082430`；`topic-matching-persistence.ts`=`cb16c8a7175ccd5fda175eac21bf2f7e26f1887b`；fixture=`edf8427d923950dff285289abe040443062b4460`；published 测试=`6506075bca8d8aeb0ae94e7e4a7063c70cd1862b`；association 测试=`39ea8775ffe19fecb6f65f3c6640452fbc4006d7`；persistence 测试=`b20ec484e3734f81a4c4ca8ad3c0bbcc8ef6c6b6`。
- T03 结论：`REVIEW · FROZEN_PENDING_G4`。未创建 candidate、未 merge、未 archive、未 push；等待 Architect G4。

## D10-T03 G4、Candidate、Merge 与归档

- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、7 路径、tsc、topic-matching + transaction/schema 7 files/64 tests、真实 SQLite Clock/幂等/target_not_found/Published Item 探针与受保护路径 diff=0。
- Candidate：`92c7e658275189e886e84226918f7aa2ef615e66`，唯一 parent `d4f4b49a44fccbdff6738b2028612f349680a61a`，tree `ab4b7566c2f0d8d39f48f47494aa3c5b509ed8b9`，精确 7 路径；Worker branch tip 对齐且 clean。
- 首次 merge 尝试 `675a3455a2877aea973a7534c38529f2bad29a51` 错误使用文档提交 `52c4791` 为第一 parent，导致 merge tree `7eb485de…` 不等于冻结 tree；该提交对象保留但未作为主线，未 push。
- 正确 Merge：`df7a1bf97d1437fe342b1d074750652deecb0757`；第一 parent `d4f4b49a`、第二 parent candidate `92c7e658`，merge tree `ab4b7566c2f0d8d39f48f47494aa3c5b509ed8b9`，与 candidate 逐字一致。
- Merge 后复验：toolchain/typecheck PASS；定向 7/7 files、42/42 tests PASS；full `npm run verify` PASS（82/82 files、986/986 tests；build、全部 smoke、database smoke、223 files format PASS）。
- Worker 归档：`archive_workspace(wks_91e7a95139dab3a6)` 返回 `archivedAgentIds=[a9a832bf-ce78-4ee4-8dca-15be13f68110]`、`removedDirectory=true`；Agent `closed/archived`，活跃 workspace 列表与 Git worktree 均无该项。
- T03 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未启动 T04、未 push、未签发 D10 最终 PASS。

## D10-T04 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `36e77011-5280-4445-9e07-1d8c3684fa9a`，workspace `wks_9c409e823e94c84b`，branch `feat/d10-t04-service-integration`。
- Worker HEAD 保持 `aa0e318d9ef4de28b6ce2c6f0c9f29777e31e6b9` / tree `788a949119b1a754ed605039b0c8836a9a90f993`；无 commit/stage/amend/merge/push，受保护路径 diff 为空。
- 精确写集：7 路径（contracts 修改、3 新增 src、fixture 修改、2 新增测试），仅 Plan §7.1 白名单。
- 编排顺序：输入校验 → pre-abort → target → Published Item → Association → D03 `listEnabled()` → 空快照 → T02 payload → P-05 → P-05 后 abort → 空匹配 → pre-persist abort → T03 单事务 → COMMIT 后 abort。
- 复用/跳过：Published Item false 零 LLM；已有 Association true 零 LLM/零写；无启用 Topic false 零 LLM；空匹配 P-05 1 次、零写；目标不存在 target_not_found。
- D02 保持唯一 strict Schema/引用校验/首次顺序去重；T04 只防御检查 `matched_topic_ids` 为数组，并按 D03 快照顺序传入 T03。
- 错误：五码精确且无 cause；取消优先；DB/Repository/事务/readback→topic_matching_failed，P-05→llm_failed。
- logger 六字段白名单，stage 仅 check/match/persist，reason 仅五码；同步抛错/异步拒绝均 best-effort；错误与日志不含目标正文、Topic 名称/描述、Prompt、模型原文或 Token。
- 公共边界：index 运行时仅 createTopicMatching/TopicMatchingError；其余 DTO/Options/Service/Dependencies/Logger/ErrorCode 均为 type export。
- 集成：真实 SQLite + 真实 T01/T03 Repository + 真实 D03 listEnabled + 真实 D02 typed calls/StubLLM + synthetic Prompt；三类目标、多 Topic、零匹配、复用、TOP-10 延迟禁用、TOP-16 历史关联、ATOMIC 回滚、PRIVACY、RESOURCE_CLEANUP 均有证据。
- 独立验证：toolchain/typecheck PASS；固定回归 17/17 files、168/168 tests PASS；full `npm run verify` PASS（84/84 files、1038/1038 tests；build、全部 smoke、database smoke、228 files format PASS）。
- 精确冻结：tree `6fe0c1500b1dab6f26a01187ec36689dbff01284`；patch `/private/tmp/d10-t04-freeze.S5UrRG/d10-t04.patch`，SHA-256 `dbc8c64ba4e50b03c71312810d34c3ebe6e8c0ff2958a87e88461dbc81a4584f`，90437 bytes、7 路径；patch 重建 tree 与冻结 tree 一致。
- 冻结 blob：`contracts.ts`=`b535703cd343d484282fb8e993df607217f097f4`；`index.ts`=`cbd482e14f461a11eed577baee89a14347b9ae92`；logger=`19399c26ca714bd29808c2f7e9c17016f33e3c18`；service=`e722dbc780c38e02408520f0256f71a8f2f13752`；fixture=`c1896bd70595902ea1a60f8ebc46ab6643eba023`；integration 测试=`06b4d4017f93d05ee1e31a2cda23ff1dc652215b`；service 测试=`e4a783890715a14e9c09a0669b2c1f6f99e6ec8f`。
- T04 结论：`REVIEW · FROZEN_PENDING_G4`。未创建 candidate、未 merge、未 archive、未 push；等待 Architect G4。

## D10-T04 G4、Candidate、Merge 与归档

- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、7 路径、tsc、tests/topic-matching 7 files/101 tests、六类短路探针、公共导出与受保护路径 diff=0。
- Candidate：`a2a1b5b9c446be750907b5880bfa936e603f498c`，唯一 parent `aa0e318d9ef4de28b6ce2c6f0c9f29777e31e6b9`，tree `6fe0c1500b1dab6f26a01187ec36689dbff01284`，精确 7 路径；Worker branch tip 对齐且 clean。
- Merge：`853be803fc2883f14c92f91768a810d98b9e7251`；第一 parent `aa0e318d`、第二 parent candidate `a2a1b5b9`，merge tree `6fe0c1500b1dab6f26a01187ec36689dbff01284`，与 candidate 逐字一致。
- Merge 后复验：toolchain/typecheck PASS；固定回归 17/17 files、168/168 tests PASS；full `npm run verify` PASS（84/84 files、1038/1038 tests；build、全部 smoke、database smoke、228 files format PASS）。
- Worker 归档：`archive_workspace(wks_9c409e823e94c84b)` 返回 `archivedAgentIds=[36e77011-5280-4445-9e07-1d8c3684fa9a]`、`removedDirectory=true`；Agent `closed/archived`，活跃 workspace 列表与 Git worktree 均无该项。
- T04 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；四卡全部 PASS，进入 D10 本地集成 Gate；未 push、未签发 D10 最终 PASS。

## D10 本地集成 Gate

- Gate 输入：`5c5ca1bc0e99b40a2751621b267c9347e615e197` / tree `3ceb99fc18ab71f3c2bb1d452e27e2ec3dee534e`；工作区/index clean。
- 独立快照：`git archive` tar `/private/tmp/d10-local-gate.c0d4SW/d10-gate.tar`，SHA-256 `e258a81b03368009d414f9704be059d791ce9b92bd7fd1cab14c6de38ceaf9f4`，3358720 bytes；解包目录 `/private/tmp/d10-local-gate.c0d4SW/source`，293 files，不含 `.git`/`node_modules`。
- 相对 D09 closeout `a6934b1`：22 个 tracked 路径；受保护路径 diff = 0；`git diff-tree --check` PASS。
- 依赖/类型：快照内 `npm ci --offline` PASS（124 packages，0 vulnerabilities）；`npm run verify:toolchain` PASS；`npm run typecheck` PASS。
- P0 定向：17/17 files、168/168 tests PASS。
- 快照 full Gate：`npm run verify` PASS；84/84 files、1038/1038 tests；build、SIGINT/SIGTERM/端口/关闭预算/信号前监听/Source/Topic smoke、database smoke、228 files format 全部 PASS。
- 快照完整性复验：测试后源码与同 commit 新导出快照逐文件一致；新 tar SHA-256 仍为 `e258a81b03368009d414f9704be059d791ce9b92bd7fd1cab14c6de38ceaf9f4`。
- Case Gate：`TOP-01`～`TOP-05`、`TOP-08`～`TOP-12`、`TOP-14`～`TOP-16`、`PMT-07`、`PMT-09`、`ATOMIC`、`PRIVACY` 均有服务/真实 SQLite 集成证据；`TOP-06/07` D10 本地复用/跳过通过；`PMT-06` 保持 S0，不用 Stub 冒充。
- 范围：仅新增 D10 `src/topic-matching`、对应 `tests/topic-matching`/fixture 与 D10 文档路径；无 DDL/Prompt/配置/CI/package/lock 变更；无 PublishTask、Published Item、RSS、Runtime/HTTP/历史重匹配/向量检索。
- 结论：`D10_LOCAL_GATE=EVIDENCE_READY`；等待 Architect 独立 Gate、push 与精确 SHA CI。Lead 不 push、不签发 D10 最终 PASS。
