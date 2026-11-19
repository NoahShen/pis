# D15 Progress：六阶段 Runtime 与调度

- Plan：`docs/milestones/D15/plan.md` v0.1
- Plan 状态：`APPROVED · G3`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划基线：main `e25bc2ebc55825e54420b20c3a3cadac42301b62` / tree `83db6072eb5ec565d810827edfec438feb7f0039`
- 执行基线：`1f957a3eb58fb921ac105604f4034565e68d3265` / tree `74bb25609e37dbcfe48281374196db173ce5d6cb`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · D15-T04 Worker 已归档`
- 开发心跳：`c046058f`（`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前结论：`D15_PLAN=G3_APPROVED`；T01/T02/T03/T04 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`，T05 `NOT_STARTED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D15-T01 六类 Task/Result、纯映射、错误分类 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `1f957a3eb58fb921ac105604f4034565e68d3265` | PASS（merge 后定向 2 files/14 tests；full 86 files/1052 tests；format 235 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D15-T02 有界队列/背压/关闭唤醒/单 Worker | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `6b00903053c7df9988eb66780bbd6b5dd014e6bf` | PASS（merge 后定向 4 files/27 tests；full 88 files/1065 tests；format 239 files） | APPROVED | APPROVED · G4（B 方案） | 无；Worker/workspace 已归档；MERGE_TREE_MISMATCH 已按 B 裁决记录 |
| D15-T03 有限重试/只重试下游/事务外边界 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `2a054542c6d4fa15197243a6914106bb3f8993b2` | PASS（merge 后定向 10 files/59 tests；full 91 files/1088 tests；format 246 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D15-T04 Cron enabled Source/手工触发/表达式时区 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `cb367daa92d1d103fb52ea70b3fe7a63433c8f78` | PASS（merge 后定向 5 files/31 tests；full 93 files/1106 tests；format 252 files） | APPROVED | APPROVED · G4（第二次冻结） | 无；Worker/workspace 已归档；CHANGES_REQUIRED 历史保留 |
| D15-T05 优雅关闭/超时取消/六阶段集成/P0 | `NOT_STARTED` | T04 收尾 docs commit（本记录提交，main HEAD） | NOT_RUN | - | - | Architect 已批准继续；Lead 即将创建全新 Worker |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D15-T01 | `1f957a3eb58fb921ac105604f4034565e68d3265` | `2a183989-0338-4cbe-88ca-91a0da6bc7e2` | `wks_464440cbbc9177ce` | `feat/d15-t01-runtime-contracts` | 精确 7 新增，见 Plan §4.1 | `81d30b00039ec88c59870c397dbf9580b1c3d91c` | `/private/tmp/d15-t01-freeze.ypKTbv/d15-t01.patch` | `0c8c6fcc0d39bab22c90ed44ff38247e2a016be3555dad5bc101901b12947167` | `APPROVED · G4` | `ebc4b4fb30699b151b38384edcd1c81cbbceb92f` | `6b00903053c7df9988eb66780bbd6b5dd014e6bf` | `81d30b00039ec88c59870c397dbf9580b1c3d91c` | PASS（merge 后定向 2/14；full 86/1052；format 235） | `archive_workspace` success；archivedAgentIds=[`2a183989-0338-4cbe-88ca-91a0da6bc7e2`]；`removedDirectory=true`；无残留 |
| D15-T02 | `6b00903053c7df9988eb66780bbd6b5dd014e6bf` | `885c13d9-7b31-4167-b583-cf1f8c88f878` | `wks_9d569546b3b351a4` | `feat/d15-t02-bounded-queue` | 精确 6 路径（4 新增 + 2 修改），见 Plan §5.1 | `0e0630c11cb96b4c79336249ddf800ff66fde170` | `/private/tmp/d15-t02-freeze.yR6mSA/d15-t02.patch` | `2cd73de3465dcda2d993062983249e7ec36484fdf98c6d28bfc09bcad048a45b` | `APPROVED · G4`（B 方案：代码子树逐字节一致 + merge 树独立复验） | `b6b5982d655d85c8f69a95eee94b0919889260c8` | `78990037c2cbd49a238b6552f8bfac07c8903866` | `6cde191a2188d360ccadfb2c742e508312ba759d` | PASS（merge 后定向 4/27；full 88/1065；format 239） | `archive_workspace` success；archivedAgentIds=[`885c13d9-7b31-4167-b583-cf1f8c88f878`]；`removedDirectory=true`；无残留 |
| D15-T03 | `2a054542c6d4fa15197243a6914106bb3f8993b2` | `f5280767-9c1f-44e9-9649-0d9246997830` | `wks_9f3f5a1090d490da` | `feat/d15-t03-retry-dispatch` | 精确 9 路径（4 新增 src + 3 新增测试 + 2 修改），见 Plan §6.1 | `186bf6a45c4aecd105305ca621a206e61daaf05f` | `/private/tmp/d15-t03-freeze.9TMMC6/d15-t03.patch` | `24740f3eb149dd74cda2629f7688e6866fa75674d1b1c0c7b8eb0bd04605026f` | `APPROVED · G4` | `94c4efb8c6a89e8ea5799f01db2a632bcccdd91c` | `8c4b9586bb88fff5e3c8d8e4fdaa0a3b9170d36c` | `186bf6a45c4aecd105305ca621a206e61daaf05f` | PASS（merge 后定向 10/59；full 91/1088；format 246） | `archive_workspace` success；archivedAgentIds=[`f5280767-9c1f-44e9-9649-0d9246997830`]；`removedDirectory=true`；无残留 |
| D15-T04 | `cb367daa92d1d103fb52ea70b3fe7a63433c8f78` | `581cece7-d3a3-42ca-985e-ce9d39278ef4` | `wks_32bf706523eaa413` | `feat/d15-t04-cron-scheduler` | 精确 6 新增，见 Plan §7.1 | `654ddf012063ef92bf3d3445a41d3c7f36979b67` | `/private/tmp/d15-t04-refreeze.DR4fS1/d15-t04.patch` | `396366b49d8afd88ce83e2bb75408004fdae5c507ebcba8446b21b2a68c959ff` | `APPROVED · G4`（第二次冻结；首轮 CHANGES_REQUIRED 已修复） | `b823837818bced54969e7afe3644eb30aee5bc2d` | `73e8da767c2d8474587838ee16ee8895762db9f5` | `654ddf012063ef92bf3d3445a41d3c7f36979b67` | PASS（merge 后定向 5/31；full 93/1106；format 252） | `archive_workspace` success；archivedAgentIds=[`581cece7-d3a3-42ca-985e-ce9d39278ef4`]；`removedDirectory=true`；无残留 |
| D15-T05 | `PENDING_T04_DOCS_COMMIT` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；见 Plan §8.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。Lead 冻结完成后必须在同一次回复中给出 tree、patch SHA-256、路径数、blob 与验证数字，不接受事后补报。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `RUN-01` | T01 六类映射；T05 六阶段链与 ID-only 证据 |
| `RUN-02` | T01 空结果→[]；T03 空结果 1 次调用不重试；T05 全链空结果 |
| `RUN-03` | T03 暂时 HTTP/LLM/SQLite busy 最多 2 次；第二次成功/失败两分支 |
| `RUN-04` | T03 invalid_input/target_not_found/cancelled 不重试；取消不误判为空 |
| `RUN-05` | T03 派发 helper：COMMIT 后只重试未入队下游；T05 链级复验 |
| `RUN-06` | T03 A 成功一次、B 单独重试；T05 双下游链 |
| `RUN-07` | T03 阶段失败零 downstream；第二次成功才派发 |
| `RUN-08` | T02 容量满背压；Worker 消费后恢复；不丢任务 |
| `RUN-09` | T04 Cron 只 COLLECT；T05 API/静态 RSS 不进入 Runtime |
| `RUN-10` | T05 停新增、内部继续派发、drain、关队列 |
| `RUN-11` | T05 超时 abort、解除等待、记录、不死锁、不 process.exit |
| `RUN-12` | T01 双 route 映射；T03/T05 Event 失败不阻断 Knowledge |
| `RUN-13` | T05 P1：记录 COMMIT→入队窗口；无持久化恢复；不阻断 P0 |
| `RUN-14` | T03/T05 P1：八字段日志白名单、无敏感内容；不阻断 P0 |
| `RUN-15` | T01 分类；T03 非法引用 2 次、不存在目标 1 次；T05 链级 |
| `RUN-16` | T03/T05 真实 SQLite：HTTP/LLM 等待 `inTransaction=false`；并发短事务成功 |
| `CFG-03` | T04 enabled-only 注册/触发；T05 真实 SQLite Source 行 |
| `CFG-07` | T04 非法表达式/时区启动即拒、零部分注册；T05 链级 |

`RUN-13`/`RUN-14` 为 P1 边界记录，不作为 D15 P0 阻断；`RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07` 为 P0 Gate 硬条件。真实模型语义 S0/S1 属 D16，不在 D15 冒充通过。

## 当前阻塞与待决策事项

- T01/T02/T03/T04 均已完成 G4、candidate、merge、merge 后复验与 Worker 归档；当前唯一门禁为 Architect 核对 T04 merge/main。
- **自 T03 起（并适用于 T04/T05）base 规则修正**：每卡 base = 前一卡收尾后的 docs record commit（main HEAD），不是前一卡 merge commit；merge 前必须 `git merge-tree --write-tree` 预演，若与 frozen tree 不等立即停止报告。此规则取代 Plan 中“前卡 merge SHA”的旧表述。
- T02 发生 `MERGE_TREE_MISMATCH`：candidate parent=T01 merge，main 已含 T01 docs；Architect 裁决 B 授权 merge tree `6cde191a2188d360ccadfb2c742e508312ba759d`，以代码子树逐字节一致 + merge 树独立复验替代整树相等。根因在 Architect 的指令组合，不是 Lead/Worker 实现问题；详见后续章节。
- T03 RUN-16 已用真实 SQLite 证明：阶段等待 `inTransaction=false`，并发短事务 `INSERT INTO sources` 成功并回读；生产 `src/runtime` 零事务/DB/SQL/fetch；`withTransaction`/`INSERT` 仅存在于 RUN-16 fixture。
- T03 G4 裁决：不要求字面 `reason=retry/exhausted`（分类 reason + attempt/maxAttempts 足够）；T03 不强制 Runtime 级故障注入派发测试（唯一 dispatch seam 已覆盖，Runtime 结构上派发在阶段重试循环之外）；基础版 `shutdown()` 无 timeout abort 符合 Plan §6.3 第 4 条，T05 扩展。
- **T04 CHANGES_REQUIRED 历史（保留，不改写成一次通过）**：首轮冻结 `d10d373c…` / patch `5a370159…` 被 Architect 退回。敌对 backend 下 `rollback()` 的 `stop()/destroy()` 无 try/catch，导致：原始 `Error("stop boom")` 掩盖 `CronSchedulerError`；`registered.clear()` 未执行；再次 `start()` 重复注册同一 Source 定时器；公开 `stop()` 抛错。第 1 轮修复后新冻结 `654ddf01…` / patch `396366b4…` 通过 G4。
- T04 修复结构：`stopSchedule()` 对 stop/destroy 各自 best-effort try/catch；`rollback()` 快照 values → 先 clear → 逐个清理；`start()` schedule 失败恒抛 `CronSchedulerError`；`stop()` 恒不抛且幂等。敌对回滚测试 `CFG-07_HOSTILE_ROLLBACK` 断言旧 task stop/destroy 均被尝试、registry 清空、重试 scheduleCalls 增量= enabled 数量且无重复 Source 定时器；`STOP_HOSTILE` 断言 stop/二次 stop 不抛。
- D11 Product Generation 尚未交付：`publish` 只按 Spec §5 `StageServices.publish` 形状 stub 注入；不实现模板/RSS/云端/API/Published Item。
- Spec §6 关闭序列含 `stopAccepting()`，Intent §3 草案接口未列；Plan 以 Spec §6 为准增加该方法，G3 时请 Architect 确认。
- V1 实施计划表 D15-T05 提及 PM2 进程守护；本轮已批准 Intent/Spec 与任务指令未列 PM2。Plan 不实现 PM2，仅保证 `shutdown()` 不 `process.exit()`；如纳入需 G3 明确。
- `RUN-13`/`RUN-14` 为 P1：记录崩溃漏派窗口、无持久化恢复、日志量/敏感内容边界；不阻断 P0，但不得宣称 D16/E2E 完成。
- 本轮不读取私有 `config/prompts`/`config/prompt/user-context.md`；实现测试只使用临时合成 Prompt/sentinel。

## 下一可执行动作

1. Architect 核对 T04 merge SHA `73e8da767c2d8474587838ee16ee8895762db9f5`、merge tree `654ddf012063ef92bf3d3445a41d3c7f36979b67`、复验数字与归档证据。
2. 以 T04 收尾 docs commit（本记录提交，main HEAD）作为 T05 固定 base，创建全新 Paseo Worker 与独立 worktree；只按 Plan §8.1 写集实现。
3. T05 Worker 只交 `REVIEW`/`BLOCKED`；Lead 独立复跑并同次回复冻结证据，等 G4 后才 candidate/merge。T05 必须覆盖 RUN-10 四类在途任务、RUN-11 超时 abort + grace 显式上限并进日志、禁止 process.exit、scheduler+Runtime 真实 SQLite 六阶段集成、PUBLISH_STUB 不写 Published Item 表、NO_PERSISTENCE schema 不变、RUN-13/14 P1 记录。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D15/plan.md`、`docs/milestones/D15/progress.md`。
- 五卡严格串行；每卡列精确写集、固定 base、Spec/Case 映射、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- 覆盖 `RUN-01`～`RUN-12`、`RUN-15`、`RUN-16`、`CFG-03`、`CFG-07`；`RUN-13`/`RUN-14` 记录 P1 边界。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。

## G3 批准与执行基线

- 待 Architect 审核。
- 批准前：`D15_PLAN=G3_PENDING_ARCHITECT_REVIEW`，五卡 `NOT_STARTED`。
- 批准后：以包含本记录/批准结论的精确文档提交为执行基线；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。

## Architect G3 审核（2026-11-19）

Plan `5cc3fc86cdb8558746ef38aaf07f7f12e3911619`（tree `470a1a55f92ea2771f2dd2b7dedf8296e23e0ae0`，parent 固定基线 `e25bc2e`，精确 2 个新增文档路径）已逐卡核对：**`D15_PLAN=G3_APPROVED`**。

核对要点：六类任务只传 ID、`mapResultToDownstreamTasks()` 纯函数且 PUBLISH 不信任服务返回替换目标、错误三分类含 `unsupported_source`→non_retryable 与 `classifySqliteError()=busy_locked`→retryable、六条独立有界队列 + 各 1 Worker、派发重试与阶段重试严格分离、`RUN-16` 真实 SQLite 事务外探针、Cron 先全量校验后注册（零部分注册）、关闭超时 abort 且零 `process.exit()`、`RUN-13/14` 按 P1 记录不阻断。受保护路径零改动。

### Lead 三点裁决

1. **`stopAccepting()`：采纳。** Spec §6 关闭序列为准，Intent §3 只是草案接口；属契约澄清，非范围扩张。
2. **PM2：不纳入 D15。** 已批准 Intent/Spec 均未纳入，PM2 属部署配置而非本里程碑代码。D15 只保证 `shutdown()` 不调用 `process.exit()`，把进程生命周期交给宿主。PM2 部署与 `ecosystem.config.js` 归 D16 部署交付总结；如后续要求纳入，须另走门禁，不在 D15 静默扩范围。
3. **D11 Publish：采纳 stub 注入。** 只按 Spec §5 `StageServices.publish` 形状返回 `{ published_item_id }`；模板渲染、RSS、云端、API 均属越界。`PUBLISH_STUB` 测试须显式断言不产生 Published Item 表写入。

### 补充边界

- `RUN-16` 必须证明 Runtime 源码零 `withTransaction`/`new Database`/SQL，且阶段等待期间 `db.inTransaction=false` 时并发短事务可成功；不接受仅靠源码 grep 的替代证据。
- 关闭 `grace` 期必须有显式上限并进入日志；不得出现无界等待。
- `dispatch_cancelled` 与 `dispatch_failed` 必须区分，前者不重试。

执行基线固定为本文档提交 SHA。T01 base 为该 SHA；T02～T05 依次固定前卡 merge SHA。每卡冻结证据与交回必须在同一次回复。

## 执行授权（用户，2026-11-19）

用户指令：“下一步开发 Runtime……老样子，写文档后，直接开发，Runtime 验收成功后再找我确认。”据此记录 G1/G2/G3 已由负责人批准并进入正式开发；Runtime 最终验收后再向负责人汇报确认。

- 唯一推进心跳：`c046058f`（`*/10 * * * *` Asia/Shanghai，目标 Team_Main / Architect 8d95474b）。

## D15-T04 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `581cece7-d3a3-42ca-985e-ce9d39278ef4`，workspace `wks_32bf706523eaa413`，branch `feat/d15-t04-cron-scheduler`。
- Worker HEAD 保持 `cb367daa92d1d103fb52ea70b3fe7a63433c8f78` / tree `d1ed218aee29d7cec8901fbf4bd15247e84f8ebd`；无 commit/stage/amend/merge/push。
- 精确写集：6 个新增路径，仅 Plan §7.1 白名单；受保护路径 diff=0，生产 scheduler 零 Adapter/collect/fetch/DB/SQL/setInterval/process.exit。
- 首轮冻结：tree `d10d373c6a977037d835f9dfd6288496172e2dba`，patch `/private/tmp/d15-t04-freeze.JDnSf7/d15-t04.patch`，SHA-256 `5a37015921fb7ee982e8363db4a504391b470c506a7fe9f823b32dc36a2319cb`；G4 退回（hostile rollback 缺陷）。
- 修复后新冻结：tree `654ddf012063ef92bf3d3445a41d3c7f36979b67`；patch `/private/tmp/d15-t04-refreeze.DR4fS1/d15-t04.patch`，SHA-256 `396366b49d8afd88ce83e2bb75408004fdae5c507ebcba8446b21b2a68c959ff`，32693 bytes、6 路径；从 base+patch 重建 tree 逐字一致；`git diff --check` 通过。
- 新冻结 blob：`contracts.ts`=`ca7d5d0426b40594fa2efdab3be6686b34e2ed82`；`cron-scheduler.ts`=`e79a23b76dfde55800e058ab2db9abd404a072cc`；`index.ts`=`9b091eb1a0ad66111c8d64f2ee4b7b4617097a36`；`tests/fixtures/scheduler.ts`=`7e5b5c5b776d369a34ba3bf461e1a02fb3e32451`；`cron-scheduler.test.ts`=`498b6bf84808b893e4ed013b94da9d216c191d7f`；`cron-scheduler-sqlite.test.ts`=`1cefe9417ff3edb80ad67079f5c3440952d5c696`。
- 独立验证（修复后）：typecheck PASS；定向 5/5 files、31/31 tests PASS（scheduler 2/18）；full `npm run verify` PASS（93/93 files、1106/1106 tests；build、全部 smoke、database smoke、252 files format PASS）；`git diff --check` PASS；指定扫描 0 命中。
- 十项：零部分注册 `[valid, invalid]`→schedule 0；`CFG-07_REGISTRATION_ROLLBACK` 回滚清空；真实 SQLite `SqliteSourceRepository.listEnabled()` 仅 S-ON；回调仅 COLLECT + rejection 捕获；trigger disabled/missing resolve；stop 幂等/destroy；默认 Asia/Shanghai；start 幂等；真实 node-cron validate；错误 shape；NO_ADAPTER。
- T04 Lead 冻结结论：`REVIEW · FROZEN_PENDING_G4`（第二次冻结）；冻结证据保持有效。

## D15-T04 G4（第二次冻结）、Candidate、Merge 与归档

- Architect G4：`APPROVED`（第二次冻结 `654ddf01…`）；敌对 backend 探针 6/6 PASS（错误形状、无泄漏、重试不重复、全部 stop/destroy 抛错下 stop 不抛、首 schedule 失败后 stop 幂等）；旧 `d10d373c…` 作废。
- Candidate：`b823837818bced54969e7afe3644eb30aee5bc2d`，唯一 parent `cb367daa92d1d103fb52ea70b3fe7a63433c8f78`，tree `654ddf012063ef92bf3d3445a41d3c7f36979b67`，精确 6 新增路径。
- 预演与 Merge：`git merge-tree --write-tree --no-messages cb367da b8238378` = `654ddf01`（整树相等）；实际 merge `73e8da767c2d8474587838ee16ee8895762db9f5`，第一 parent `cb367da`、第二 parent candidate `b8238378`，merge tree `654ddf01`，整树相等。
- Merge 后复验：typecheck PASS；定向 5/5 files、31/31 tests PASS；full `npm run verify` PASS（93/93 files、1106/1106 tests；build、全部 smoke、database smoke、252 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_32bf706523eaa413)` 返回 `archivedAgentIds=[581cece7-d3a3-42ca-985e-ce9d39278ef4]`、`removedDirectory=true`；Agent `closed/archived`，活跃 agent/worktree 无残留。
- 遗留本地 branch 清理：`feat/d15-t04-cron-scheduler` 以 `git branch -d` 安全删除（tip `cb367da`，已交付/归档）；main 未动。
- T04 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T05 尚未启动；未 push、未签发 D15 最终 PASS。

## D15-T03 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `f5280767-9c1f-44e9-9649-0d9246997830`，workspace `wks_9f3f5a1090d490da`，branch `feat/d15-t03-retry-dispatch`。
- Worker HEAD 保持 `2a054542c6d4fa15197243a6914106bb3f8993b2` / tree `c953f9ebb2048a4e8cc19cb3ccd893da08665d16`；无 commit/stage/amend/merge/push。
- 精确写集：9 路径（4 新增 src + 3 新增测试 + 2 修改），仅 Plan §6.1 白名单；受保护路径 diff=0，业务模块反向 Runtime/Queue/Worker 引用=0。
- 阶段重试：retryable 首败次成 2 次继续；两次失败 2 次终止零 downstream；SQLITE_BUSY/LOCKED/llm_failed 2 次；invalid_input/target_not_found/aborted/AbortError/ABORT_ERR/LLM_CANCELLED 1 次。
- 派发：A enqueue 1、B 首败次成 2、C 1，上游 execute 1，已成功 A 不重复；B 两次失败 log `dispatch_failed` 且 C 继续；queue_closed/pre-aborted log `dispatch_cancelled` 不重试。
- RUN-12_DUAL：Event 2 次失败，Knowledge 链仍完成 1 次 Topic + 1 次 Publish。SIX_QUEUES：capacity=1 下六阶段首任务并发、每阶段 3 任务完成、maxActive=1、第三任务背压。
- RUN-16 真实 SQLite：`openDatabase`→`initializeDatabase`→`withTransaction`；阶段门期间 `inTransaction=false`，并发短事务 `INSERT INTO sources` 成功并回读 `["concurrent-short-transaction"]`；最终采样 `[false,false]`；Runtime 随后派发 PROCESS 1 次；阶段 options 仅 `{ signal }`。
- 独立验证：typecheck PASS；定向 10/10 files、59/59 tests PASS；full `npm run verify` PASS（91/91 files、1088/1088 tests；build、全部 smoke、database smoke、246 files format PASS）；`git diff --check` PASS；生产 `src/runtime` 事务/DB/SQL/fetch 扫描 0 命中。
- 精确冻结：tree `186bf6a45c4aecd105305ca621a206e61daaf05f`；canonical full-index binary patch `/private/tmp/d15-t03-freeze.9TMMC6/d15-t03.patch`，SHA-256 `24740f3eb149dd74cda2629f7688e6866fa75674d1b1c0c7b8eb0bd04605026f`，56374 bytes、9 路径；从 base+patch 重建 tree 与冻结 tree 逐字一致；`git diff --check` 通过。
- 冻结 blob：`task-dispatch.ts`=`d69bee89bdfd992a53b68b2d6a6d5e55a023bf49`；`runtime-logger.ts`=`eaa1b88d282e2d93c7e1eebefe1bb57880c8f17f`；`runtime-errors.ts`=`5f1c43744da4a4e2714d92b9501f42c69f65aa82`；`runtime.ts`=`52f0976526c2279108b56e1ec7cf3377511d239f`；`index.ts`=`e3d8e77b080c7a71b6e1a722f2868feedfe07661`；`tests/fixtures/runtime.ts`=`79be0c7273731c36ba885371f3f4bd6609040bc8`；`task-dispatch.test.ts`=`7509aa1f9a9c9ee4bf1fceeed2e4f6a7fbcdbfd2`；`runtime-retry-dispatch.test.ts`=`e7721f0944a21fe092fc16e3ca2c480ae43d4bc6`；`runtime-transaction-boundary.test.ts`=`ccbbfce5d1a4da70a22908ebdbbf0c8aa51329e6`。
- T03 Lead 冻结结论：`REVIEW · FROZEN_PENDING_G4`；冻结证据保持有效。

## D15-T03 G4、Candidate、Merge 与归档

- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、9 路径、full 91/1088、format 246；补充探针 11/11 PASS（派发失败不触发上游重跑、重试耗尽零派发、RUN-12 双路、真背压、外部 submit 拒绝边界、非法输入/配置、capacity=1 长链无死锁、logger 八字段）。
- G4 裁决：不要求字面 `reason=retry/exhausted`；不强制 T03 Runtime 级故障注入派发测试（唯一 dispatch seam 已覆盖）；基础版 shutdown 无 timeout abort 允许，T05 扩展。
- Candidate：`94c4efb8c6a89e8ea5799f01db2a632bcccdd91c`，唯一 parent `2a054542c6d4fa15197243a6914106bb3f8993b2`，tree `186bf6a45c4aecd105305ca621a206e61daaf05f`，精确 9 路径。
- 预演与 Merge：`git merge-tree --write-tree --no-messages 2a054542 94c4efb8` = `186bf6a4`（与 frozen 整树相等）；实际 merge `8c4b9586bb88fff5e3c8d8e4fdaa0a3b9170d36c`，第一 parent `2a054542`、第二 parent candidate `94c4efb8`，merge tree `186bf6a4`，整树相等。
- Merge 后复验：typecheck PASS；定向 10/10 files、59/59 tests PASS；full `npm run verify` PASS（91/91 files、1088/1088 tests；build、全部 smoke、database smoke、246 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_9f3f5a1090d490da)` 返回 `archivedAgentIds=[f5280767-9c1f-44e9-9649-0d9246997830]`、`removedDirectory=true`；Agent `closed/archived`，活跃 agent/worktree 无残留。
- 遗留本地 branch 清理：`feat/d15-t03-retry-dispatch` 以 `git branch -d` 安全删除（tip `2a05454`，已交付/归档）；main 未动。
- T03 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T04 尚未启动；未 push、未签发 D15 最终 PASS。

## D15-T02 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `885c13d9-7b31-4167-b583-cf1f8c88f878`，workspace `wks_9d569546b3b351a4`，branch `feat/d15-t02-bounded-queue`。
- Worker HEAD 保持 `6b00903053c7df9988eb66780bbd6b5dd014e6bf` / tree `81d30b00039ec88c59870c397dbf9580b1c3d91c`；无 commit/stage/amend/merge/push。
- 精确写集：6 路径（4 新增 + 2 修改），仅 Plan §5.1 白名单；受保护路径 diff=0，业务模块反向 Runtime/Queue/Worker 引用=0。
- FIFO 队列：enqueue 满时真背压等待；多 enqueuer 按提交顺序唤醒；`size` 只计缓冲任务，等待 dequeuer 时直接 handoff 不增加 size；100 任务 cap=1 全部消费且顺序 `[0..99]`，maxConcurrency=1。
- close：幂等；全部等待 enqueuer 以 `QueueClosedError(queue_closed)` 拒绝、等待 dequeuer 以 null 唤醒；已接受缓冲任务按 FIFO 排空后再 null；close 后 enqueue 立即拒绝。
- abort：唤醒双方、`isClosed=true`、缓冲可排空、listener 移除；已 abort signal 构造即关闭。实现零 setInterval/setTimeout。
- StageWorker：单循环串行；start 幂等；同步 handler 异常与 onError 自身抛错均不终止循环；done 在 handler 完成 + 队列关闭 + 缓冲排空后 resolve。
- 独立验证：typecheck PASS；定向 4/4 files、27/27 tests PASS；full `npm run verify` PASS（88/88 files、1065/1065 tests；build、全部 smoke、database smoke、239 files format PASS）；`git diff --check` PASS；指定扫描 0 命中。
- 精确冻结：tree `0e0630c11cb96b4c79336249ddf800ff66fde170`；canonical full-index binary patch `/private/tmp/d15-t02-freeze.yR6mSA/d15-t02.patch`，SHA-256 `2cd73de3465dcda2d993062983249e7ec36484fdf98c6d28bfc09bcad048a45b`，19755 bytes、6 路径；从 base+patch 重建 tree 与冻结 tree 逐字一致；`git diff --check` 通过。
- 冻结 blob：`bounded-task-queue.ts`=`1554a4f375a0571242e722e072725f53c0e87a70`；`stage-worker.ts`=`0611f7057f261e801c1b29430f32ac2e67dc9667`；`index.ts`=`47a22bad65e465d47c54d828b6b8fa2d604d14ec`；`tests/fixtures/runtime.ts`=`e40bb2897f0e26b7f46f13214cb65e1a95ddf932`；`bounded-task-queue.test.ts`=`6dd9145982aecd945d584b91185c99a2a33daf47`；`stage-worker.test.ts`=`21a2c8414c2039c6b109d33873ed83d3963be562`。
- T02 Lead 冻结结论：`REVIEW · FROZEN_PENDING_G4`；冻结证据保持有效。

## D15-T02 MERGE_TREE_MISMATCH 与 B 方案裁决

- Architect G4 已 `APPROVED` 冻结树 `0e0630c11cb96b4c79336249ddf800ff66fde170`、patch SHA `2cd73de3…`、6 路径；独立快照 typecheck PASS、27/27 PASS；补充探针 13/13 PASS。
- 实际收尾前预演发现：main 当前 `abc257572786e95ac1eb04301443b0faaee31f18`（T01 docs record），T02 candidate `b6b5982d655d85c8f69a95eee94b0919889260c8` 唯一 parent `6b009030`、tree `0e0630c1`；`git merge-tree --write-tree --no-messages abc2575 b6b5982d` 得到 `6cde191a2188d360ccadfb2c742e508312ba759d`，不等于冻结 tree。
- 差异仅 `docs/milestones/D15/plan.md`、`docs/milestones/D15/progress.md`；`git diff --name-only 0e0630c1 6cde191a -- src/runtime tests` 为空；6 个 T02 文件在 `0e0630c1` 与 `6cde191a` 中逐字节一致。
- 根因：Architect 的“T01 收尾记录 docs”与“T02 base = T01 merge SHA”两条指令组合必然产生 mismatch；不是 Lead/Worker 实现问题。
- 按 Architect 硬性“merge tree 不等则停止报告”，Lead 在实际 merge 前停止；未 archive、未更新 progress、未 push；main 保持 `abc2575`，candidate 不在任何 branch。
- Architect 裁决 B：保留 candidate parent=`6b009030`，授权 merge tree `6cde191a`；以“6 个代码文件逐字节一致 + `6cde191a` 独立快照 27/27 复验”替代“merge tree 整树等于 frozen tree”断言。B 的理由：A 需在新 base 重冻并重跑 G4，但 6 个文件一字节未变，重冻只换 base，不产生新的代码审查价值。
- 自 T03 起 base 规则修正：base = 前一卡收尾 docs record commit（main HEAD），不是前一卡 merge commit；merge 前必须 `git merge-tree --write-tree` 预演，不等则停止报告。此规则保留在 progress，不改写为一次通过。

## D15-T02 G4、B 方案 Merge 与归档

- Candidate：`b6b5982d655d85c8f69a95eee94b0919889260c8`，唯一 parent `6b00903053c7df9988eb66780bbd6b5dd014e6bf`，tree `0e0630c11cb96b4c79336249ddf800ff66fde170`，精确 6 路径。
- 实际 Merge：`78990037c2cbd49a238b6552f8bfac07c8903866`；第一 parent `abc257572786e95ac1eb04301443b0faaee31f18`、第二 parent candidate `b6b5982d`；merge tree `6cde191a2188d360ccadfb2c742e508312ba759d`，与预演树逐字一致。
- 硬断言：merge tree = `6cde191a` PASS；`git diff --name-only 6cde191a HEAD -- src tests` 为空 PASS；`0e0630c1 vs HEAD -- src/runtime tests` 为空 PASS；T02 6 文件逐字节一致 PASS。
- Merge 后复验：typecheck PASS；定向 4/4 files、27/27 tests PASS；full `npm run verify` PASS（88/88 files、1065/1065 tests；build、全部 smoke、database smoke、239 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_9d569546b3b351a4)` 返回 `archivedAgentIds=[885c13d9-7b31-4167-b583-cf1f8c88f878]`、`removedDirectory=true`；Agent `closed/archived`，活跃 agent/worktree 无残留。
- 遗留本地 branch 清理：`feat/d15-t01-runtime-contracts`、`feat/d15-t02-bounded-queue` 均以 `git branch -d` 安全删除（分别为 `1f957a3`、`6b00903`，均已交付/归档）；main 未动。
- T02 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T03 尚未启动；未 push、未签发 D15 最终 PASS。

## D15-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；Agent `2a183989-0338-4cbe-88ca-91a0da6bc7e2`，workspace `wks_464440cbbc9177ce`，branch `feat/d15-t01-runtime-contracts`。
- Worker HEAD 保持 `1f957a3eb58fb921ac105604f4034565e68d3265` / tree `74bb25609e37dbcfe48281374196db173ce5d6cb`；无 commit/stage/amend/merge/push。
- 精确写集：7 个新增路径，仅 Plan §4.1 白名单；受保护路径 diff=0，业务模块反向 Runtime 引用=0。
- 六类 Task 仅 flat ID 字段；`TargetType` 复用 D10 `TopicTargetType`；D05～D10 结果类型只 `import type`；`PublishResult` 本地按 Spec §5 声明。
- `mapResultToDownstreamTasks()` 纯函数：COLLECT 保序；PROCESS 固定 EVENT 在前、KNOWLEDGE 在后并去重；EVENT targets 保序；KNOWLEDGE 非空；TOPIC true 使用本任务 target；PUBLISH→[]；空白/null/false→[]。
- `classifyTaskError()` 取消优先；`*_failed`/`llm_failed`→retryable；`invalid_input`/`target_not_found`/`unsupported_source`→non_retryable；SQLITE_BUSY/LOCKED→retryable；SQLITE_CONSTRAINT→non_retryable；未知→retryable；不泄漏 message/cause/SQL/URL。
- 独立验证：typecheck PASS；定向 2/2 files、14/14 tests PASS；full `npm run verify` PASS（86/86 files、1052/1052 tests；build、全部 smoke、database smoke、235 files format PASS）；`git diff --check` PASS；指定扫描 0 命中。
- 精确冻结：tree `81d30b00039ec88c59870c397dbf9580b1c3d91c`；canonical full-index binary patch `/private/tmp/d15-t01-freeze.ypKTbv/d15-t01.patch`，SHA-256 `0c8c6fcc0d39bab22c90ed44ff38247e2a016be3555dad5bc101901b12947167`，27314 bytes、7 路径；从 base+patch 重建 tree 与冻结 tree 逐字一致；`git diff --check` 通过。
- 冻结 blob：`contracts.ts`=`0670ce74743888ebd0ce140dba3fc77142477b37`；`index.ts`=`e5b8cf519072297c4421b9c6d24ed1ae91773c8b`；`task-errors.ts`=`91b63a0447f484888e7ade716bf9a9b54849897e`；`task-mapping.ts`=`a43e358f76f9dc0bc0e13fa4637c79dfa27c1a6d`；`tests/fixtures/runtime.ts`=`7ba760fd7ff341e49441cb8976fb9df39bca7331`；`tests/runtime/task-errors.test.ts`=`2a5dd520c2072ea62550e76b1167d4d4f7aea68f`；`tests/runtime/task-mapping.test.ts`=`862cb3e962ce0eb852558f701a4e8342fc75bf8e`。
- T01 Lead 冻结结论：`REVIEW · FROZEN_PENDING_G4`；冻结证据保持有效。

## D15-T01 G4、Candidate、Merge 与归档

- Architect G4：`APPROVED`；独立复核 frozen tree、patch SHA、7 路径、typecheck、14/14 目标用例与受保护路径 diff=0；补充探针 8/8 PASS（PUBLISH 使用本任务 target、恶意 error getter 不崩溃、SQLITE_BUSY→retryable、SQLITE_CONSTRAINT_UNIQUE→non_retryable、AbortError 优先 cancelled、routes 去重/EVENT 在前、空白 ID 过滤、纯函数深相等）。
- Candidate：`ebc4b4fb30699b151b38384edcd1c81cbbceb92f`，唯一 parent `1f957a3eb58fb921ac105604f4034565e68d3265`，tree `81d30b00039ec88c59870c397dbf9580b1c3d91c`，精确 7 新增路径。
- Merge：`6b00903053c7df9988eb66780bbd6b5dd014e6bf`；第一 parent `1f957a3`、第二 parent candidate `ebc4b4fb`，merge tree `81d30b00039ec88c59870c397dbf9580b1c3d91c`，与冻结 tree 逐字一致。
- Merge 后复验：typecheck PASS；定向 2/2 files、14/14 tests PASS；full `npm run verify` PASS（86/86 files、1052/1052 tests；build、全部 smoke、database smoke、235 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_464440cbbc9177ce)` 返回 `archivedAgentIds=[2a183989-0338-4cbe-88ca-91a0da6bc7e2]`、`removedDirectory=true`；Agent `closed/archived`，活跃 agent/worktree 无残留。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T02 尚未启动；未 push、未签发 D15 最终 PASS。

