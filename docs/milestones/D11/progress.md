# D11 Progress：Published Item 与模板

- Plan：`docs/milestones/D11/plan.md` v0.2
- Plan 状态：`G3_APPROVED`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划基线：main `5d95f8b6eb3e7beff89e3f52498c3b7de203feb1` / tree `e71bad95094e39b1be6b87443267349627a0509b`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE · T02 Worker 已归档`
- 开发心跳：`d13cf26f`（schedule 类型，`*/10 * * * *`，Asia/Shanghai；Architect 创建）
- 当前结论：`D11_PLAN=G3_APPROVED`；T01/T02 均为 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T03 `READY` 但本轮未启动

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D11-T01 Context/Draft DTO、HTML 安全与三类纯模板 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `d780e1bfe5284713f274e538bf4ae4f44f0bbca6` | PASS（merge 后定向 2 files/10 tests；full 98 files/1136 tests；format 261 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D11-T02 已存证据来源链接、URL 校验、去重与追加 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `5a604416ba4a8a2f184f643b09816c88eb5dd319` | PASS（merge 后定向 4 files/21 tests；full 100 files/1147 tests；format 265 files） | APPROVED | APPROVED · G4 | 无；Worker/workspace 已归档 |
| D11-T03 目标资格、Repository、唯一短事务与重复复用 | `READY` | T02 收尾 docs record commit（本轮交回 SHA） | `NOT_RUN` | `PENDING` | `PENDING` | 本轮不启动 |
| D11-T04 不可变性、事务内复检、通知、公共出口与 P0 集成 | `NOT_STARTED` | T03 merge 后的 docs record commit | `NOT_RUN` | `PENDING` | `PENDING` | 未启动 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 `PASS`。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | PATH_COUNT | FROZEN_TREE | FROZEN_BLOBS | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D11-T01 | `d780e1bfe5284713f274e538bf4ae4f44f0bbca6` | `0df2d268-6129-48aa-9490-9389a6bcb6bb` | `wks_aafda88a9976039e` | `feat/d11-t01-publication-templates` | 精确 6 新增，见 Plan §4.1 | `6` | `877ba3f60bf30893e6288a49b3570151125029dc` | 6 blobs；见下方 T01 冻结记录 | `/private/tmp/d11-t01-freeze.aXXLBp/d11-t01.patch` | `e930ab2abdd15c5cd05ac8ecc3abc35724b68daa44c70c2ac072f4cf36faf61a` | `APPROVED · G4` | `6f3fd442a5d63a13ad5a3549d26534fb72482a85` | `477701beb87d8219bf0def28d97366b457be42a1` | `877ba3f60bf30893e6288a49b3570151125029dc` | PASS（merge 后定向 2/10；full 98/1136；format 261） | `archive_workspace` success；archivedAgentIds=[`0df2d268-6129-48aa-9490-9389a6bcb6bb`]；`removedDirectory=true`；无残留 |
| D11-T02 | `5a604416ba4a8a2f184f643b09816c88eb5dd319` | `4e2026fd-759a-4b05-920f-adc20bbbdf28` | `wks_0a92e3e913d4962c` | `feat/d11-t02-source-links` | 精确 6 路径（2 修改 + 4 新增），见 Plan §5.1 | `6` | `86533a4ca39d320db3c5206bd9c83a702220ca3a` | 6 blobs；见下方 T02 记录 | `/private/tmp/d11-t02-freeze.0ijpL9/d11-t02.patch` | `d40b03ff63bae972cefbf2219ae38478536df38a852ef28dda2eca05fe6af38e` | `APPROVED · G4` | `730ef51f440163d0898adf72a524b094e1e3374c` | `7c47b64a5a7c9891a4cf2382336d77d0bc155398` | `86533a4ca39d320db3c5206bd9c83a702220ca3a` | PASS（merge 后定向 4/21；full 100/1147；format 265） | `archive_workspace` success；archivedAgentIds=[`4e2026fd-759a-4b05-920f-adc20bbbdf28`]；`removedDirectory=true`；无残留 |
| D11-T03 | `PENDING_T02_CLOSEOUT` | `PENDING` | `PENDING` | `PENDING` | 待 Plan §6.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D11-T04 | `PENDING_T03_CLOSEOUT` | `PENDING` | `PENDING` | `PENDING` | 待 Plan §7.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结完成后 Lead 必须在同一次回复给出精确 tree、canonical patch SHA-256、路径数、逐路径 blob、定向/full 验证数字与交回结论，不接受事后补报。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `PUB-01` | T01 三类纯模板；T04 三类真实 SQLite Published Item 与零 LLM |
| `PUB-02` | T03 无 Topic Association 空结果；T04 集成复验 |
| `PUB-03` | T03 不存在目标/非法输入；T04 真实 SQLite 悬空目标边界 |
| `PUB-04` | T03 多 Topic 一快照；T04 集成复验 |
| `PUB-05` | T03 UNIQUE/事务复检/重复复用；T04 并发与快速返回 |
| `PUB-06` | T02 URL 去重/追加/SQL；T04 真实快照可点击链接 |
| `PUB-07` | T02 空链接不追加；T04 无 URL 正常发布 |
| `PUB-08` | T02 危险 URL 过滤；T04 发布不阻断 |
| `PUB-09` | T04 补证据/改 Topic/新增 Update 后七列逐字节不变 |
| `PUB-10` | T01 空字段安全渲染；T03 事务前文本校验；T04 三类集成 |
| `PUB-11` | T04 P1：事务内 target/association 撤销与结构注入 |
| `PUB-12` | T03 已发布快速返回；T04 不重新渲染且快照不变 |
| `PUB-13` | T01 HTML 转义；T02 URL 来源/属性安全；T04 真实安全 body |
| `DB-13` | T03 业务目标校验；T04 SQLite 多态无 FK 的业务边界证明 |

`PUB-11` 为 P1，不阻断 D11 P0 Gate；必须保留结构证明与注入测试，不能删除或伪装为 P0。其余 Case 为 D11 P0 Gate 硬条件。

## 当前阻塞与待决策事项

- T02 已完成 G4、candidate、merge、merge 后复验与 Worker 归档；当前不启动 T03，等待本轮 T02 交回确认。
- T01 base 必须固定为包含 G3 批准结论的精确文档提交；T02～T04 base 必须分别固定为前卡 merge 后更新 `progress.md` 的 docs record commit，不使用前卡 merge SHA。
- 每卡候选前必须先以 `git merge-tree --write-tree --no-messages BASE CANDIDATE` 预演；预演 tree 与 frozen tree 不等即停止报告，不实际 merge。
- `PUB-11` 属 P1，不能因为它不阻断 P0 就跳过 T04 的注入测试；`PUB-09/12` 的不可变性必须按七列逐字节断言。
- **D15 契约裁决已落实**：T04 仅允许将 `src/runtime/contracts.ts` 的 `PublishResult.published_item_id` 放宽为 `string | null`，附 D11 完整 publish 到 `StageServices.publish` 的直接类型兼容测试；其他 D15 行为不得修改。
- 不实现 RSS/归档/云端/API/Runtime 接线；不调用 LLM，不读取真实私有 Prompt/User Context；测试只用合成数据。

## 下一可执行动作

1. T03 以本 T02 收尾 docs record commit 为唯一 base，创建全新 Paseo Worker/独立 worktree。
2. T03 只允许修改 Plan §6.1 精确 9 路径，Worker 交回 `REVIEW/BLOCKED`；本轮不启动。
3. T04 继续以前卡 docs record commit 串行推进。

## 本次 Lead 文档交付

- 只写：`docs/milestones/D11/plan.md`、`docs/milestones/D11/progress.md`。
- 四卡严格串行；每卡列精确写集、固定 base、Spec/Case 映射、禁止路径、验证命令及冻结/candidate/merge/archive evidence key。
- 覆盖 `PUB-01`～`PUB-10`、`PUB-12`、`PUB-13`、`DB-13`；`PUB-11` 记录 P1 结构证明 + 注入测试。
- 未创建 Worker、心跳、candidate、merge 或 push；未修改生产代码、测试、DDL、Prompt、config、CI 或 package/lock；未自批 G3。

## G3 批准与执行基线

- 状态：`G3_PENDING_ARCHITECT_REVIEW`。
- 批准前：四卡 `NOT_STARTED`，无 Worker、心跳、candidate、merge、push。
- 批准后：以包含本记录/批准结论的精确文档提交为执行基线；T01 使用全新 Worker、独立 worktree，严格按 Plan §4 写集。

## Architect G3 审核（2026-11-21）

Plan `8feb660f83453bfad95c075db8d9e763698eab65`（tree `de992a0a…`，parent 基线 `5d95f8b6`，精确 2 个新增文档路径）已逐卡核对。四卡拆分、base 规则（前一卡 docs commit）、预演 merge 门禁、冻结证据同次回复、Case 映射与禁止范围均符合 Spec 与 D15 已确立流程。

### Lead G3 待确认项裁决：D15 契约差异

**批准修改 D15 契约，作为 D11-T04 的受控例外**：

- 允许且仅允许修改 `src/runtime/contracts.ts` 一处：`PublishResult.published_item_id` 由 `string` 放宽为 `string | null`。
- 依据：技术设计 §14.2 权威伪代码本来就允许 `publishedItemId: null`（门槛不满足是正常空结果）；D15 当时收窄为非空是契约疏忽。D15 对 PUBLISH 结果不读任何字段（`mapResultToDownstreamTasks` 直接返回 `[]`），该改动纯类型层面、零运行时行为变化。
- D11-T04 必须附类型兼容测试：D11 完整 `PublicationService.publish`（含 null 空结果）可直接赋给 `StageServices.publish`。
- 禁止借该行放宽触碰 D15 其他任何文件、运行时逻辑、映射或错误分类；D15 progress.md 由 Lead 追加一行事后契约更正记录。

### Plan v0.2 修订要求（G3 批准的前置）

当前 Plan 多处显式写"不修改 D15 / `src/runtime` 禁止 diff"，与上述裁决冲突。请提交 Plan v0.2：

1. §7.1 T04 写集增加 `src/runtime/contracts.ts`（仅此一行语义变更）与对应兼容测试文件（可并入既有测试）。
2. §7.2 与 §9/§10 中 `src/runtime` 的禁止/受保护表述改为"仅允许上述单行契约修正"。
3. §2.1/line 49/line 597 的 G3 待确认项标记为已裁决。
4. 除此之外不改任何内容。

v0.2 回传后即签发 `D11_PLAN=G3_APPROVED` 与执行基线；心跳与 Worker 派发在批准后开始。在此之前仍不得开发。

## G3 批准与执行基线（2026-11-21）

Plan v0.2 `a4e6e77dc8e3e186616dad4cca4d3838fd4be65c`（tree `e026b7cd…`）diff 仅 `docs/milestones/D11/plan.md`，全部修订精确落在裁决范围内：T04 写集含 `src/runtime/contracts.ts` 单行例外、`D15_DIRECT_ASSIGNMENT` 类型兼容测试、受保护 diff 断言改为仅允许该行、预期路径数 9→10、G3 待确认项全部标记已裁决。无夹带。

**`D11_PLAN=G3_APPROVED`**。四卡串行开始，T01 base = 本执行基线 commit；后续各卡 base = 前一卡收尾 docs commit。

- 心跳：`d13cf26f`（schedule 类型，Asia/Shanghai */10，目标 Team_Main；清理用 delete_schedule）。

- 用户授权：『D11 全部完成后再向我汇报』，本轮不再逐卡请示，按 G4→candidate→merge→archive 自动推进。

## D11-T01 Lead 复核、G4、Merge 与归档

- Worker 交回：`REVIEW`；Agent `0df2d268-6129-48aa-9490-9389a6bcb6bb`，workspace `wks_aafda88a9976039e`，branch `feat/d11-t01-publication-templates`。
- Worker HEAD/tree 保持 `d780e1bfe5284713f274e538bf4ae4f44f0bbca6` / `945ea46785b638b6b84c8c77edfa76c6e43ef701`；无 commit/stage/amend/merge/push。
- 精确写集：6 个新增路径，仅 Plan §4.1 白名单；受保护路径 diff=0，禁用 token/`any`/未批准标签扫描均为 0；T01 未新增 `index.ts`。
- DTO/模板复核：`PublicationContext` 三态字段精确；Update 父 Event 仅五字段，无父 description/历史 Updates；Knowledge category `string | null`，findings 仅 title/description；`escapeHtml`/`escapeAttribute` 与三类模板均为纯函数。
- 独立验证：`verify:toolchain` PASS；`npm ci --offline` 124 packages/0 vulnerabilities；typecheck PASS；定向 2/2 files、10/10 tests PASS；full `npm run verify` PASS（98/98 files、1136/1136 tests；build、7 项 smoke、database smoke、261 files format PASS）；`git diff --check` PASS。
- 精确冻结：tree `877ba3f60bf30893e6288a49b3570151125029dc`；canonical full-index patch `/private/tmp/d11-t01-freeze.aXXLBp/d11-t01.patch`，SHA-256 `e930ab2abdd15c5cd05ac8ecc3abc35724b68daa44c70c2ac072f4cf36faf61a`，25822 bytes、6 路径；从 base+patch 重建 tree 与冻结 tree 逐字一致。
- 冻结 blob：`contracts.ts`=`c4b33a6c1a0b4c504d547c8cd0fa7192c24e9a93`；`html.ts`=`6e238631782f2af5fc594b4b3cfa3a86587f40db`；`template-renderer.ts`=`c3722463956d25b9da72e2036182f9f199d14d2b`；`tests/fixtures/publication.ts`=`81b89a07518dd31ad178df706925c5bd887bc785`；`html-security.test.ts`=`4efede182daced5edbaf53938fe25d0eecb9c96b`；`template-renderer.test.ts`=`984b23f0fdcc07ad024b8a1ac0a345fbcbe6305d`。
- Architect G4：`APPROVED`；独立核对 frozen tree/patch/blob、隔离回放、6 路径、定向 10/10 与 full 1136/1136。
- Candidate：`6f3fd442a5d63a13ad5a3549d26534fb72482a85`，唯一 parent `d780e1bfe5284713f274e538bf4ae4f44f0bbca6`，tree `877ba3f60bf30893e6288a49b3570151125029dc`，精确 6 路径；Worker branch tip 已对齐 candidate。
- 预演与 Merge：`git merge-tree --write-tree --no-messages d780e1bf 6f3fd442` = `877ba3f60bf30893e6288a49b3570151125029dc`（与 frozen 精确相等）；实际 merge `477701beb87d8219bf0def28d97366b457be42a1`，第一 parent `d780e1bf`、第二 parent `6f3fd442`，merge tree `877ba3f6`。
- Merge 后复验：typecheck PASS；定向 2/2 files、10/10 tests PASS；full `npm run verify` PASS（98/98 files、1136/1136 tests；build、7 项 smoke、database smoke、261 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_aafda88a9976039e)` 返回 `archivedAgentIds=[0df2d268-6129-48aa-9490-9389a6bcb6bb]`、`removedDirectory=true`；活动 workspace/agent 与 `git worktree list` 均无残留；主工作区与 Lead 工作区未归档。
- T01 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T02 尚未启动，以本 T01 收尾 docs record commit 为下一 base。

## 心跳行为更正（2026-11-21 · 用户指令「只提醒不代审」）

- 已删除 `d13cf26f`（`delete_schedule`，schedule 列表现为 `schedules_count=0`）。
- 新建 **`cb945e27`**，使用 **`create_heartbeat`**（向当前主会话 Architect 发送提醒）而非 `create_schedule`（新建独立 agent）。
- 此前 `create_schedule` 的目标类型为 `new-agent`：它每次新建独立 agent 实例，实际行使了 G4 批准、merge 与归档职责。D11-T01 的 G4 即由该实例完成，并非主会话 Architect。D15 收尾时 `delete_heartbeat` 报 not found 亦因类型不符。
- 新心跳 `cb945e27` 明确禁止：G3/G4 批准、candidate/merge/push、修改源码或 progress.md、归档 workspace、删除自身、代替 Lead 创建 agent。所有审核与收尾由主会话 Architect 亲自执行。
- T01 已按完整证据链合并（tree `877ba3f6`，预演与 merge tree 一致，1136 用例通过），内容经主会话复核无问题，不追溯重审；**自 T02 起 G4 全部由主会话 Architect 执行**。
- 后续里程碑的心跳统一使用 `create_heartbeat`，清理用 `delete_heartbeat`。

## D11-T02 Lead 复核、G4、Merge 与归档

- Worker 交回：`REVIEW`；Agent `4e2026fd-759a-4b05-920f-adc20bbbdf28`，workspace `wks_0a92e3e913d4962c`，branch `feat/d11-t02-source-links`。
- Worker HEAD/tree 保持 `5a604416ba4a8a2f184f643b09816c88eb5dd319` / `a92af46c55f2ef14df067b8a8cb4f69e19e0931b`；无 commit/stage/amend/merge/push。
- 精确写集：6 路径（2 修改 + 4 新增），仅 Plan §5.1 白名单；`contracts.ts` 仅新增 7 行 Source Link Repository 契约；T01 fixture 原 118 行 0 删除，T02 fixture 纯增 342 行。
- 静态复核：URL trim/规范化/去重/顺序、http(s) 限制、userinfo/控制字符/空 host 拒绝、坏链接静默丢弃、无链接 body 逐字节不变、链接/属性转义均符合 Spec；EVENT/EVENT_UPDATE/Knowledge SQL 只用绑定参数，Update 不继承父 Event 证据，无 `SELECT *`/coalesce/NULLIF。
- 独立验证：`verify:toolchain` PASS；`npm ci --offline` 124 packages/0 vulnerabilities；typecheck PASS；定向 4/4 files、21/21 tests PASS；full `npm run verify` PASS（100/100 files、1147/1147 tests；build、7 项 smoke、database smoke、265 files format PASS）；`git diff --check` PASS。
- 精确冻结：tree `86533a4ca39d320db3c5206bd9c83a702220ca3a`；canonical full-index patch `/private/tmp/d11-t02-freeze.0ijpL9/d11-t02.patch`，SHA-256 `d40b03ff63bae972cefbf2219ae38478536df38a852ef28dda2eca05fe6af38e`，25948 bytes、6 路径；从 base+patch 重建 tree 与冻结 tree 逐字一致。
- 冻结 blob：`contracts.ts`=`7a810405eedc65271f5eeadebb17393c906cb6a3`；`source-link-repository.ts`=`cd465e88a9baa6d521c6dac20225118c4b868896`；`source-links.ts`=`2f3e2be942c1f27f11c7abc44213061690f44989`；`tests/fixtures/publication.ts`=`b0a120cb824edcacbf1da3c5c43f445525c88cf7`；`source-link-repository.test.ts`=`6fdc0b5c3b92c5acf823ac34106519779b577245`；`source-links.test.ts`=`b00bad2585fabee4d9fddee3d713df41f81e8332`。
- Architect G4：`APPROVED`；独立核对 base、frozen tree、patch SHA/bytes、隔离回放、6 路径与 blob；实现/测试符合 Plan §5 与 Spec。
- Candidate：`730ef51f440163d0898adf72a524b094e1e3374c`，唯一 parent `5a604416ba4a8a2f184f643b09816c88eb5dd319`，tree `86533a4ca39d320db3c5206bd9c83a702220ca3a`，精确 6 路径；Worker branch tip 已对齐 candidate。
- 预演与 Merge：`git merge-tree --write-tree --no-messages 5a604416 730ef51f` = `86533a4ca39d320db3c5206bd9c83a702220ca3a`（与 frozen 精确相等）；实际 merge `7c47b64a5a7c9891a4cf2382336d77d0bc155398`，第一 parent `5a604416`、第二 parent `730ef51f`，merge tree `86533a4c`。
- Main docs 前进：Architect 在 T02 执行期间把 main 从 `5a604416` 文档推进到 `7aae4a51`（`docs/heartbeat-rules.md`、`D11/progress.md`、`project-development.md`，无源码/测试差异）。Lead 保留原 candidate/merge 不动，将 `7c47b64` 与该 docs-only main 集成为 `ebcad6da9532ed6fed62ac81ec74d03e42c9979e`（第一 parent `7c47b64`、第二 parent `7aae4a51`）；集成对 `src/`、`tests/`、config、package 的差异为 0。
- Merge 后复验：typecheck PASS；定向 4/4 files、21/21 tests PASS；full `npm run verify` PASS（100/100 files、1147/1147 tests；build、7 项 smoke、database smoke、265 files format PASS）；`git diff --check` PASS。
- Worker 归档：`archive_workspace(wks_0a92e3e913d4962c)` 返回 `archivedAgentIds=[4e2026fd-759a-4b05-920f-adc20bbbdf28]`、`removedDirectory=true`；活动 workspace 与 `git worktree list` 均无残留；主工作区与 Lead 工作区未归档。
- T02 结论：`PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；T03 尚未启动，以本 T02 收尾 docs record commit 为下一 base。
