# D08 Progress：Event Search 历史候选召回

- Plan：`docs/milestones/D08/plan.md` v0.2
- Plan 状态：`APPROVED · Architect G3 PASS`
- Intent：`G1 PASS`
- Spec：`G2 PASS`
- 参考基线：main `8c58cdd2b005633fd7aec7792799bded384d4a8a` / tree `01cf0cf8e27eb27512479ad168499b662e57e1b0`
- 执行基线：`257f3c98b0e2840686b3e3d102c71a77b16d4be0`
- 开发心跳：`c85e2b88`（`*/10 * * * *`，Asia/Shanghai，Architect 创建）
- 当前 Worker：`NONE · T04 Worker 已归档`
- 当前结论：`G1=PASS`、`G2=PASS`、`G3=PASS`、`D08_DEVELOPMENT=AUTHORIZED`、`D08_T01=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D08_T02=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D08_T03=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D08_T04=PASS_LOCAL_MERGE_VERIFIED_ARCHIVED`、`D08_LOCAL_GATE=EVIDENCE_READY`、`D08_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D08-T01 Content/P-02 输入边界 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `0958ec081e3350e04f64081ee6bda0c09fd32f7e` | PASS（merge 后定向 5 files/51 tests；full 64 files/761 tests） | APPROVED · FROZEN | APPROVED · G4 | 无；candidate/merge 已验证，Worker/workspace 已归档 |
| D08-T02 三路候选 Repository | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `54a61b1bfbf4c808b964c3e827d395277c3aafd4` | PASS（merge 后定向 3 files/25 tests；full 66 files/776 tests） | APPROVED · FROZEN | APPROVED · G4 | 无；candidate/merge 已验证，Worker/workspace 已归档 |
| D08-T03 排序/候选上限/可配置 Update 窗口 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `bbdbbf2df59c70914f611afeb6bb4132349ebf64` | PASS（merge 后定向 4 files/28 tests；full 68 files/793 tests） | APPROVED · FROZEN | APPROVED · G4 | 无；candidate/merge 已验证，Worker/workspace 已归档 |
| D08-T04 公共 factory/真实 SQLite 集成 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | `8c58cdd2b005633fd7aec7792799bded384d4a8a` | PASS（merge 后定向 11 files/134 tests；DB+Processing+Knowledge 22 files/186；full 70 files/844） | APPROVED · FROZEN | APPROVED · G4 | 无；candidate/merge 已验证，Worker/workspace 已归档 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D08-T01 | `0958ec081e3350e04f64081ee6bda0c09fd32f7e` | `a05fddd2-8e66-4489-907e-73c5701816fe` | `wks_149bc381d82cb54a` | `feat/d08-t01-content-input` | 精确 5 路径：`src/event-search/content-input.ts`、`src/event-search/event-search-errors.ts`、`src/event-search/event-search-call.ts`、`tests/event-search/content-input.test.ts`、`tests/event-search/event-search-call.test.ts` | `a9044c94118c375381e5655eb86845beccef2940` | `/private/tmp/d08-t01-freeze.Lq63K5/d08-t01.patch` | `e5d2f86ab01365919e52ef8781ae30638e6866b6f5de53e5490eb3b521fcc8a5` | `APPROVED · G4` | `a1eb0f1d7058bb4e41a691bba266317b0c89b19e` | `7f66fb6305d5688e9b3ec04a9d1aabe8bf682dc6` | `a9044c94118c375381e5655eb86845beccef2940` | PASS（merge 后定向 5/51；full 64/761；typecheck/build/smoke/database smoke/format PASS） | `archive_workspace` success；Agent archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D08-T02 | `54a61b1bfbf4c808b964c3e827d395277c3aafd4` | `c28660cd-8afb-4137-99be-dc03c9f516de` | `wks_a2b6f1cb3b0a019e` | `feat/d08-t02-candidate-repository` | 精确 4 新增路径：`src/event-search/fts-phrase.ts`、`src/event-search/event-candidate-repository.ts`、`tests/event-search/fts-phrase.test.ts`、`tests/event-search/event-candidate-repository.test.ts` | `7c54a86fdc8685fa9562f926fc7585c16c7a42a9` | `/private/tmp/d08-t02-freeze.zXO2bE/d08-t02.patch` | `e5a2295df340f0b20407c67465c4732c10d107ec8573dc7d6ed381d7b298b316` | `APPROVED · G4` | `0eec11f489e9d3daa82dd942003729ab75348120` | `4152751f4c329d46307db23bc5505b67a82caf17` | `7c54a86fdc8685fa9562f926fc7585c16c7a42a9` | PASS（merge 后定向 3/25；full 66/776；typecheck/build/smoke/database smoke/format PASS） | `archive_workspace` success；Agent archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D08-T03 | `bbdbbf2df59c70914f611afeb6bb4132349ebf64` | `c3dfcfb9-5f40-4b27-b285-2b2f2e3ebc5f` | `wks_6d5e7d1a94c60972` | `feat/d08-t03-candidate-context` | 精确 4 新增路径：`src/event-search/candidate-ranking.ts`、`src/event-search/candidate-context.ts`、`tests/event-search/candidate-ranking.test.ts`、`tests/event-search/candidate-context.test.ts` | `10140fcdec30efe20dd8c98ca3be829b1ff99904` | `/private/tmp/d08-t03-freeze.HJBiZn/d08-t03.patch` | `f73941e346be29ebec4367e48b80af7b7ef85b320254c6cefd7d0951df91ed68` | `APPROVED · G4` | `74c53687a3d60f4a6e118cba6747bd093cd71eed` | `b58e94d0c6f67d3f976c608ab98ca3373c0e3da2` | `10140fcdec30efe20dd8c98ca3be829b1ff99904` | PASS（merge 后定向 4/28；full 68/793；typecheck/build/smoke/database smoke/format PASS） | `archive_workspace` success；Agent archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |
| D08-T04 | `8c58cdd2b005633fd7aec7792799bded384d4a8a` | `fd9d461a-8f79-4d9c-bced-086f29011189` | `wks_e0a18d56ab78f0a6` | `feat/d08-t04-service-integration` | 精确 7 新增路径：`src/event-search/contracts.ts`、`src/event-search/event-search-logger.ts`、`src/event-search/event-search.ts`、`src/event-search/index.ts`、`tests/fixtures/event-search.ts`、`tests/event-search/event-search-service.test.ts`、`tests/event-search/event-search-integration.test.ts` | `a7bf0e9b7026ec5fd994de23bcad73800256e5bf` | `/private/tmp/d08-t04-freeze.DzLPEZ/d08-t04.patch` | `5d48af3bb7f2d6fd16bb0bf981e6f490db9f6eb21b050b0b197f1e82e2bf75e9` | `APPROVED · G4` | `41a745974c107643d7410b762a53719894f4d9b6` | `257f3c98b0e2840686b3e3d102c71a77b16d4be0` | `a7bf0e9b7026ec5fd994de23bcad73800256e5bf` | PASS（merge 后定向 11/134；DB+Processing+Knowledge 22/186；full 70/844；build/smoke/database smoke/format PASS） | `archive_workspace` success；Agent archived；`removedDirectory=true`；活跃 workspace/worktree 无残留 |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。candidate/merge 只记录精确 SHA，不以 branch 名或目录代替。

冻结后必须在同一 Lead 回复中交回 tree、patch 路径/SHA-256、路径/blob、定向/full 验证数字与结论；Architect 若只能从磁盘发现冻结产物，本卡退回流程重做。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `EVT-06` | T02 同实体不同 Subject 的 clue 证据；T04 端到端两事项 |
| `EVT-10` | T02 标准名/别名/FTS 全历史；T04 十年前 Event |
| `EVT-11` | T03 默认窗口 10、0/1/10/100 窗口、时间/ID 决胜、旧→新；T04 真实 DB 与实例隔离 |
| `EVT-21` | T01 空 clues 合法；T04 P-02 1 次、Repository 0、零写入 |
| `EVT-22` | T02 空命中；T04 空候选成功且不虚构 |
| `EVT-23` | T02 第 1 条 Update 召回；T03/T04 不偷加旧 Update |
| `EVT-24` | T02 同 alias 两 Event；T03/T04 各自上下文 |
| `CANDIDATE_LIMIT` | T03 五级排序后截断；T04 `maxCandidates` 默认 10、可配 1..50 |
| `UPDATE_LIMIT` | T03/T04 `maxUpdates` 默认 10、可配 0..100、0 零 Update SQL、非零参数绑定 |
| `PMT-09` | T01/T04 P-02 只含 `task_data`，无 User Context |
| `PMT-15` | T01/T04 D02 strict Schema 拒绝非法输出 |

`PMT-02` 为 S0 真实 P-02 语义回归，不纳入 D08 P0 Gate；EVT-19/20 也不由 D08 冒充。

## 当前阻塞与待决策事项

- D08-T01 已完成 G4、candidate、`--no-ff` merge、合并后复验和 Worker/workspace 归档。
- D08-T02 已完成 G4、candidate、`--no-ff` merge、合并后复验和 Worker/workspace 归档。
- D08-T03 已完成 G4、candidate、`--no-ff` merge、合并后复验和 Worker/workspace 归档。
- D08-T04 已完成 G4、candidate、`--no-ff` merge、合并后复验和 Worker/workspace 归档。
- 四张任务卡均已本地合并并通过；下一步执行 D08 本地集成 Gate，尚未 push。
- 未发现已冻结 DDL/D02 与 Spec 的已确认直接冲突；D02 strict Schema、`searchEvents` task-data-only、D01 全历史聚合文本均支持当前计划边界。
- Plan 内的实现口径已显式写成 G3 可审条目：`firstClueIndex` 不入五级排序；`maxCandidates` 默认 10/`1..50`，`maxUpdates` 默认 10/`0..100`，二者分别构造期校验且不得混淆；`maxUpdates=0` 零 Update SQL；非零 `LIMIT ?` 参数绑定；FTS 命中词按 clue 内唯一字面量、跨 clue 取并集计数。

## 下一可执行动作

1. 从最终 T04 merge 的干净快照执行 D08 本地集成 Gate：typecheck、full verify、build、smoke、database smoke、format。
2. 记录 tar SHA、相对 D07 closeout `09640c3` 的变更路径数和受保护路径 diff=0。
3. 将 Gate 证据提交 Architect；远程 CI 与最终 PASS 由 Architect 执行，Lead 不 push。

## Lead 计划编制记录

- 角色确认：PIS D08 唯一 Lead；职责仅 Plan/Progress，不编码、不创建 Worker、不创建心跳、不自批 G3。
- 参考基线：先以 `--ff-only` 将 Lead 分支快进至 main `4104f15ad706b3165358b3f0108ae9bff282809c` / tree `69089c9993577bdb8c8a25dded4b4c95da3b607f`；修订前工作树 clean。
- 只读核对：D08 Intent/Spec、D07 Plan/Progress 结构、通用规范 v1.0、项目规范、D01 Schema/FTS、D02 EventSearchResponse/searchEvents、PromptRepository、ContentRepository、D01 event-search tests，以及权威技术/数据库/实施/测试文档的相关章节。
- 工具链：`node v26.13.1`、`npm 11.20.0`，`npm run verify:toolchain` PASS。
- 文件范围：v0.2 只修改 `docs/milestones/D08/plan.md` 与 `docs/milestones/D08/progress.md`；不改 Intent/Spec、源文件、测试、Prompt、CI、package 或真实 config。
- 四卡：T01 → T02 → T03 → T04 串行；每卡均包含精确允许写集、固定 base、Spec/Case、禁止范围、验证命令和冻结/candidate/merge/archive evidence key。
- 只读核心：一次 P-02；clues=[]/空候选成功；三路全历史召回；FTS 参数短语；同 Event 去重/同 alias 不同 Event 独立；五级排序后按 `maxCandidates` 默认 10/可配 `1..50` 截断；Update 上下文按每实例 `maxUpdates` 默认 10/可配 `0..100`，0 零 Update SQL；全链路零业务/FTS 写。
- v0.2 修订：同步上游 `maxUpdates` 契约、T03 `LIMIT ?`/0 窗口、T04 独立 factory 配置及默认/调大/调小/0/窗口外 FTS 召回测试；四卡写集、禁止范围、冻结即交回硬门禁未变。
- 非 P0：`PMT-02` 保持 S0；D07 RSS 清理时序失败保留观察项，若复现不弱化断言。
- G3 提交：本次最终提交 SHA 由 Lead 返回给 Architect；提交前参考基线不构成批准。G3 通过前 D08 开发保持 `NOT_AUTHORIZED`。

## D08 开发启动

- G1/G2/G3 均已通过；T01/T02/T03 已由 Architect ff 合入 main `8c58cdd2b005633fd7aec7792799bded384d4a8a`。
- 开发心跳：`c85e2b88`（`*/10 * * * *`，Asia/Shanghai，Architect 创建）。
- T01 固定 base：`0958ec081e3350e04f64081ee6bda0c09fd32f7e`。
- T02 固定 base：`54a61b1bfbf4c808b964c3e827d395277c3aafd4`。
- T03 固定 base：`bbdbbf2df59c70914f611afeb6bb4132349ebf64`。
- T04 固定 base：`8c58cdd2b005633fd7aec7792799bded384d4a8a`。

## D08-T01 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；HEAD 仍为 `0958ec081e3350e04f64081ee6bda0c09fd32f7e`，无 commit/merge/push。
- 精确写集：五个新增文件，合计 901 行；所有禁止路径 diff 为空。
- 行为复核：当前 Content 仅一次 `getById`，缺失返回 `null`；六字段显式投影，无 spread、id/url/created_at/language/raw_data/HTML/Topic/history/Token。
- 调用边界：pre-abort 零调用；否则恰好一次 `searchEvents(taskData, { signal })`；signal 原样透传；`clues=[]` 原样成功；无重试、无其他 operation。
- 错误/取消：AbortError、ABORT_ERR、LLM_CANCELLED、调用中取消、返回后取消均映射 `aborted`；其他 D02/Prompt/模型错误映射 `llm_failed`；四码 message 固定，cause 不保留，无敏感串。
- 隐私验证：合成目录仅含 `event-search.md`；真实 PromptRepository + D02 + StubLLM 证明 user JSON 顶层仅 `task_data`，无 `user_context`。
- 独立验证：`npm run verify:toolchain`、`npm ci --offline`、typecheck PASS；定向 `5/5` files、`51/51` tests PASS；full `npm run verify` PASS（`64/64` files、`761/761` tests；build、smoke、database smoke、176 文件 format 均 PASS）；`git diff --check` 无输出。
- 静态扫描：生产三文件无 `any`、TS 抑制、fetch、数据库写、候选索引、历史 Event/Topic/knowledge、adapter/collection 或非 `searchEvents` operation；测试禁止路径 diff 为空。
- 精确冻结：tree `a9044c94118c375381e5655eb86845beccef2940`；canonical full-index binary patch `/private/tmp/d08-t01-freeze.Lq63K5/d08-t01.patch`，SHA-256 `e5d2f86ab01365919e52ef8781ae30638e6866b6f5de53e5490eb3b521fcc8a5`；路径数 5；`git diff-tree --check` 无输出。
- 路径 blob：`content-input.ts=f70f20406279ec003b98ea39a533490fdb8c97a6`；`event-search-errors.ts=73cbb71df1078189956bd8e1f9aa2b94d354ccec`；`event-search-call.ts=b0ab4d7ccd054a4d0aae239a0eb510bcba8c0001`；`content-input.test.ts=ba15c44c8a2f8e9b3e1420c3435b7c540a26b5ac`；`event-search-call.test.ts=7625ae5cdef3f1bd5d4a4c9175b7d5cac749f065`。
- 冻结一致性：patch 应用于干净 base 归档后得到的 tree 与冻结 tree 一致；逐文件工作树 hash 与冻结 blob 一致。
- Architect G4：`APPROVED`；独立核验冻结 tree、5 blob、patch SHA、冻结树 typecheck、`tests/event-search` 2 files/23 tests，以及 pre-abort/错误安全/operation spy/六字段隐私探针均通过。
- Candidate：`a1eb0f1d7058bb4e41a691bba266317b0c89b19e`，唯一 parent `0958ec081e3350e04f64081ee6bda0c09fd32f7e`，tree `a9044c94118c375381e5655eb86845beccef2940`，精确 5 条新增路径；Worker branch tip 对齐且 clean。
- Merge：`7f66fb6305d5688e9b3ec04a9d1aabe8bf682dc6`；第一 parent `0958ec081e3350e04f64081ee6bda0c09fd32f7e`、第二 parent candidate `a1eb0f1d7058bb4e41a691bba266317b0c89b19e`，merge tree `a9044c94118c375381e5655eb86845beccef2940`。
- Merge 后复验：定向 `5/5` files、`51/51` tests PASS；`npm run verify` PASS（full `64/64` files、`761/761` tests；build、全部 smoke、database smoke、176 文件 format 均 PASS）；禁止路径 diff 为空。
- Worker 归档：`archive_workspace(wks_149bc381d82cb54a)` 返回 `archivedAgentIds=[a05fddd2-8e66-4489-907e-73c5701816fe]`、`removedDirectory=true`；活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- 结论：`D08-T01=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。

## D08-T02 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；HEAD 仍为 `54a61b1bfbf4c808b964c3e827d395277c3aafd4`，无 commit/merge/push。
- 精确写集：四个新增文件，合计 964 行；T01 五文件与所有禁止路径 diff 为空。
- 三路召回：标准名与别名均以 `? COLLATE BINARY` 精确匹配；FTS 对 entity/subject/唯一 search terms 独立使用 `toFtsPhrase(term)` 参数绑定；三路均关联真实 events。无时间过滤、无召回 LIMIT、无 bm25。
- FTS 字面量：完整包裹为双引号短语，内部双引号翻倍，空格不拆 OR，不追加 `*`/NEAR/列过滤；引号、括号、冒号、星号与 SQL 样式文本测试无语法错/注入。
- 去重与孤儿：Event ID 为唯一 hit 键；clue evidence 合并 direct/alias/FTS；firstClueIndex 取最小；同一 clue 重复 terms 不重复计证据；无法关联 events 的物理 FTS rowid 只计入 `ignoredIndexRows`，不进入 hits。
- 空 clues：立即返回 `{hits: [], ignoredIndexRows: 0}`，测试证明不 prepare/execute SQL。
- 只读：所有业务表与 event_search 调用前后快照一致；globalThis.fetch 零调用；生产文件无 SQL 写、refresh/rebuild、fetch、bm25 或 LIMIT。
- 独立验证：`npm run verify:toolchain`、`npm ci --offline`、typecheck PASS；定向 `3/3` files、`25/25` tests PASS；full `npm run verify` PASS（`66/66` files、`776/776` tests；build、smoke、database smoke、180 文件 format 均 PASS）；`git diff --check` 无输出。
- 静态扫描：生产两文件无 `any`、TS 抑制、fetch、SQL 写、refresh/rebuild、bm25、LIMIT；测试 fixture 的 INSERT/refresh/rebuild 为允许建数，生产代码零命中。
- 精确冻结：tree `7c54a86fdc8685fa9562f926fc7585c16c7a42a9`；canonical full-index binary patch `/private/tmp/d08-t02-freeze.zXO2bE/d08-t02.patch`，SHA-256 `e5a2295df340f0b20407c67465c4732c10d107ec8573dc7d6ed381d7b298b316`；路径数 4；`git diff-tree --check` 无输出。
- 路径 blob：`fts-phrase.ts=cc0d73d7b2a84aad4f5263647e702ec28a70c6ba`；`event-candidate-repository.ts=3a1e176f5625d770995d4415e10a94c44a425e8f`；`fts-phrase.test.ts=1b72b0c0d6cbd025fc3aa9f7e89e1ed9a3fabd0e`；`event-candidate-repository.test.ts=0b56e8a0d2e5600ee8207e8d11e804fda8436feb`。
- 冻结一致性：patch 应用于干净 base 归档后得到的 tree 与冻结 tree 一致；逐文件工作树 hash 与冻结 blob 一致。
- Architect G4：`APPROVED`；独立核验冻结 tree、4 blob、patch SHA、冻结树 typecheck、`tests/event-search` 4 files/38 tests，以及 2016 年 Event/12 Update、同 alias 两 Event、FTS 危险文本与只读探针均通过。
- Candidate：`0eec11f489e9d3daa82dd942003729ab75348120`，唯一 parent `54a61b1bfbf4c808b964c3e827d395277c3aafd4`，tree `7c54a86fdc8685fa9562f926fc7585c16c7a42a9`，精确 4 条新增路径；Worker branch tip 对齐且 clean。
- Merge：`4152751f4c329d46307db23bc5505b67a82caf17`；第一 parent `54a61b1bfbf4c808b964c3e827d395277c3aafd4`、第二 parent candidate `0eec11f489e9d3daa82dd942003729ab75348120`，merge tree `7c54a86fdc8685fa9562f926fc7585c16c7a42a9`。
- Merge 后复验：定向 `3/3` files、`25/25` tests PASS；`npm run verify` PASS（full `66/66` files、`776/776` tests；build、全部 smoke、database smoke、180 文件 format 均 PASS）；受限路径 diff 为空。
- Worker 归档：`archive_workspace(wks_a2b6f1cb3b0a019e)` 返回 `archivedAgentIds=[c28660cd-8afb-4137-99be-dc03c9f516de]`、`removedDirectory=true`；活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- 结论：`D08-T02=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。

## D08-T03 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；HEAD 仍为 `bbdbbf2df59c70914f611afeb6bb4132349ebf64`，无 commit/merge/push。
- 精确写集：四个新增文件，合计 1052 行；T01/T02 九文件与所有禁止路径 diff 为空。
- 排序：五级比较严格为 direct/alias 优先、clueEvidence.length DESC、跨 clue FTS 唯一字面量并集 DESC、discoveredAt DESC、eventId BINARY ASC；firstClueIndex 不参与；无 bm25/浮点/时间/插入顺序补充键。
- 上限：全部 hits 完整排序后 slice；1/10/50 测试通过；maxUpdates 不改变 hits、候选顺序或 maxCandidates。
- 上下文：按 rankedHits 顺序读取；Event 八字段参数绑定；Event 不存在跳过；maxUpdates>0 使用 `LIMIT ?` 绑定 ID/窗口，maxUpdates=0 不 prepare Update statement且仍返回 Event 与 `updates: []`。
- DTO：Update 查询后 reverse 为旧→新；同 discovered_at 由 id DESC 选取，反转后 id ASC；窗口外 Update 不进入 DTO；无候选零 SQL。
- 取消/只读：SQL 前后取消均抛 aborted；其他 SQLite 错误不吞；业务表/event_search 快照不变，无 transaction、写表、FTS 刷新、LLM/Adapter/HTTP/Clock/IdGenerator。
- 独立验证：`npm run verify:toolchain`、`npm ci --offline`、typecheck PASS；定向 `4/4` files、`28/28` tests PASS；full `npm run verify` PASS（`68/68` files、`793/793` tests；build、smoke、database smoke、184 文件 format 均 PASS）；`git diff --check` 无输出。
- 静态扫描：生产两文件无 `any`、TS 抑制、fetch、SQL 写、transaction、refresh/rebuild、bm25、当前时间、Clock/IdGenerator；测试仅命中允许的 Event/Update fixture seeding。
- 精确冻结：tree `10140fcdec30efe20dd8c98ca3be829b1ff99904`；canonical full-index binary patch `/private/tmp/d08-t03-freeze.HJBiZn/d08-t03.patch`，SHA-256 `f73941e346be29ebec4367e48b80af7b7ef85b320254c6cefd7d0951df91ed68`；路径数 4；`git diff-tree --check` 无输出。
- 路径 blob：`candidate-ranking.ts=8000a0b5291895f976b17b06de47d32c1b54baa5`；`candidate-context.ts=902e2b512c8eafaa58c7f36cab06bddcabe1eb1c`；`candidate-ranking.test.ts=6c6a59c128a2a68da067c84c7920eab650ac91a8`；`candidate-context.test.ts=9ca2a97d700c0500afff955a15dcf8e713456bcd`。
- 冻结一致性：patch 应用于干净 base 归档后得到的 tree 与冻结 tree 一致；逐文件工作树 hash 与冻结 blob 一致。
- Architect G4：`APPROVED`；独立核验冻结 tree、4 blob、patch SHA、冻结树 typecheck、`tests/event-search` 6 files/55 tests，以及五级排序、0/2/10/100 窗口和旧到新探针均通过。
- Candidate：`74c53687a3d60f4a6e118cba6747bd093cd71eed`，唯一 parent `bbdbbf2df59c70914f611afeb6bb4132349ebf64`，tree `10140fcdec30efe20dd8c98ca3be829b1ff99904`，精确 4 条新增路径；Worker branch tip 对齐且 clean。
- Merge：`b58e94d0c6f67d3f976c608ab98ca3373c0e3da2`；第一 parent `bbdbbf2df59c70914f611afeb6bb4132349ebf64`、第二 parent candidate `74c53687a3d60f4a6e118cba6747bd093cd71eed`，merge tree `10140fcdec30efe20dd8c98ca3be829b1ff99904`。
- Merge 后复验：定向 `4/4` files、`28/28` tests PASS；`npm run verify` PASS（full `68/68` files、`793/793` tests；build、全部 smoke、database smoke、184 文件 format 均 PASS）；受限路径 diff 为空。
- Worker 归档：`archive_workspace(wks_6d5e7d1a94c60972)` 返回 `archivedAgentIds=[c3dfcfb9-5f40-4b27-b285-2b2f2e3ebc5f]`、`removedDirectory=true`；活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- 结论：`D08-T03=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。

## D08-T04 Lead 复核与冻结记录

- Worker 交回：`REVIEW`；HEAD 仍为 `8c58cdd2b005633fd7aec7792799bded384d4a8a`，无 commit/merge/push。
- 精确写集：七个新增文件，合计 3051 行；T01～T03 十三文件与所有禁止路径 diff 为空。
- 公共契约：Dependencies 只含 database/content/candidate/typedLlmCalls/logger/maxCandidates/maxUpdates；无 Clock/IdGenerator。index 运行时只导出 createEventSearch/EventSearchError。
- Factory：maxCandidates 默认 10、整数 1..50，非法抛固定 RangeError；maxUpdates 默认 10、整数 0..100，非法抛固定 RangeError；实例配置独立。
- 编排：invalid → pre-abort → Content 一次 → 事务外 searchEvents 一次 → 空 clues → 精确 clue 稳定去重 → T02 全历史召回 → T03 排序/截断 → 本实例 maxUpdates 上下文 → `{candidates}`；只在实际有 clues 时调用候选 Repository。
- 错误/取消：DB/Content/候选/上下文错误映射 event_search_failed；LLM/Prompt/JSON/Schema 映射 llm_failed；取消优先 aborted，错误不保留 cause/敏感内容。
- 日志：仅 contentId/candidateCount/clueCount/stage/reason；运行时白名单重组；ignoredIndexRows>0 只写 search stage；logger throw/reject 不改变结果。
- 集成硬证据：StubLLM、候选 Repository、上下文 SQL wrapper 均断言 `database.inTransaction=false` 且 transactionCalls=0；maxUpdates=0 零 Update SQL，非零参数绑定；真实 SQLite 覆盖三路召回、去重、同 alias 两 Event、旧 Update、五级排序、CANDIDATE_LIMIT/UPDATE_LIMIT 两配置与全历史截断。
- 隐私/只读：合成 Prompt 仅 event-search.md；task_data 六字段、无 user_context；业务表/event_search 前后一致；fetch/Adapter spy 零调用；关闭 DB 后无 WAL/SHM。
- 独立验证：`npm run verify:toolchain`、`npm ci --offline`、typecheck PASS；定向 `11/11` files、`134/134` tests PASS；Database+Processing+Knowledge `22/22` files、`186/186` tests PASS；full `npm run verify` PASS（`70/70` files、`844/844` tests；build、双向 smoke、database smoke、191 文件 format 均 PASS）；`git diff --check` 无输出。
- 静态扫描：生产文件无 `any`、TS 抑制、fetch、SQL 写、transaction、refresh/rebuild、bm25、当前时间、Clock/IdGenerator；测试中的 fixture seeding 属允许建数。
- 精确冻结：tree `a7bf0e9b7026ec5fd994de23bcad73800256e5bf`；canonical full-index binary patch `/private/tmp/d08-t04-freeze.DzLPEZ/d08-t04.patch`，SHA-256 `5d48af3bb7f2d6fd16bb0bf981e6f490db9f6eb21b050b0b197f1e82e2bf75e9`；路径数 7；`git diff-tree --check` 无输出。
- 路径 blob：`contracts.ts=d29d47be435bcda44da5c9d41ce2f390e6577327`；`event-search-logger.ts=76b49ad003643d90c4fd6c90abb5cec97d35d579`；`event-search.ts=71ffe082e05d20cd16a4c987ca29d61180e2e1d7`；`index.ts=91fd5b07e3bf92e0fe9b7aece89dd9da8858fd60`；fixture `3e9d28af18d79c08d666afd1e3d806522e49b2c5`；service test `0e37462503526440ead2f2616d81506a34683778`；integration test `5758061bf3c448c602d922bfe3495836de1a9b77`。
- 冻结一致性：patch 应用于干净 base 归档后得到的 tree 与冻结 tree 一致；逐文件工作树 hash 与冻结 blob 一致。
- Architect G4：`APPROVED`；独立核验冻结 tree、7 blob、patch SHA、冻结树 typecheck、`tests/event-search` 8 files/106 tests，以及运行时导出、配置 RangeError、maxUpdates=0/clues=[] 探针均通过。
- Candidate：`41a745974c107643d7410b762a53719894f4d9b6`，唯一 parent `8c58cdd2b005633fd7aec7792799bded384d4a8a`，tree `a7bf0e9b7026ec5fd994de23bcad73800256e5bf`，精确 7 条新增路径；Worker branch tip 对齐且 clean。
- Merge：`257f3c98b0e2840686b3e3d102c71a77b16d4be0`；第一 parent `8c58cdd2b005633fd7aec7792799bded384d4a8a`、第二 parent candidate `41a745974c107643d7410b762a53719894f4d9b6`，merge tree `a7bf0e9b7026ec5fd994de23bcad73800256e5bf`。
- Merge 后复验：定向 `11/11` files、`134/134` tests PASS；Database+Processing+Knowledge `22/22` files、`186/186` tests PASS；`npm run verify` PASS（full `70/70` files、`844/844` tests；build、双向 smoke、database smoke、191 文件 format 均 PASS）；受限路径 diff 为空。
- Worker 归档：`archive_workspace(wks_e0a18d56ab78f0a6)` 返回 `archivedAgentIds=[fd9d461a-8f79-4d9c-bced-086f29011189]`、`removedDirectory=true`；活跃 workspace 列表无该项，Git worktree 条目与目录均已移除。
- 结论：`D08-T04=PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；未 push。

## D08 本地集成 Gate

- Gate 输入 commit：`2c7bede2f46eb1e53c1282eb8ac46181f45a0746`，tree `29431b12137e0bcea2bd10bc08cc2311ebde8746`。
- 干净快照：`git archive` tar `/private/tmp/d08-local-gate.r3sND2/d08-gate.tar`，SHA-256 `7d43e4b65738ad342f05f547116b4a264563362b9ac1e70d2ea5ed1b13429477`；解包目录 `/private/tmp/d08-local-gate.r3sND2/source`，不含 `.git` 或 `node_modules`。
- 依赖与类型：快照内 `npm ci --offline` PASS（124 packages，0 vulnerabilities）；`npm run typecheck` PASS。
- 快照 full Gate：`npm run verify` PASS；full `70/70` files、`844/844` tests；build、SIGINT/SIGTERM smoke、database smoke、191 文件 format check 全部 PASS。
- 变更范围：相对 D07 closeout `09640c3` 共 24 个 tracked 路径（4 D08 docs、11 src/event-search、9 tests）；受保护路径 diff 数量为 0。
- Case Gate：EVT-06/10/11/21/22/23/24、DEDUPE、CANDIDATE_LIMIT、UPDATE_LIMIT、FTS_LITERAL、MISSING/INVALID/ABORT、ERROR、PMT-09、PMT-15、PRIVACY、PUBLIC_SHAPE 的 D08 P0 责任均有服务/集成或既有验证证据；PMT-02 保持 S0，不算 P0 PASS。
- 结论：`D08_LOCAL_GATE=EVIDENCE_READY`；等待 Architect 独立 Gate、push/远程 CI 与最终验收；Lead 不 push。

## D08 本地集成 Gate（Architect 独立复核）

- Gate 输入：`5fd5478e7ed6b4b3a7005b3a3af9dcb2397f698f`；tree `cf1a164ddddab49bc8cbb436de96b15de405d896`。
- Architect 独立快照：`git archive HEAD` 至 `/private/tmp/d08-arch-gate`；无 `.git`、无 `node_modules`；tar SHA-256 `fe3d2656b64bb358f7ea60c6bf2e58a276b15e65633944843752d66e023895d1`（与 Lead 不同打包命令，内容基于同一 commit tree）。
- 快照独立验证：`npm ci --offline` 退出 0；typecheck 退出 0；`npm run verify` 全绿：`70/70` 文件、`844/844` 用例、build、全部 smoke、database smoke、`191` 文件 format PASS。
- 相对 D07 closeout `09640c3`：**24** 个 tracked 路径；受保护路径 diff = **0**。
- 五个功能 Prompt 哈希与 D06/D07 基线一致；真实 `config/prompt/user-context.md` 未跟踪。
- 结论：`D08_LOCAL_GATE=APPROVED`。

## D08 远程 CI 与最终验收

- 推送 SHA：`e1c23ceed888d408a587b53ea1876e732ec60db0`。
- 精确 SHA 远程 CI：run #27 / `44350077255`，`WORKFLOW_RUN_CONCLUSION_SUCCESS`。
- 双重条件满足：Architect 独立干净快照 Gate + 精确 pushed SHA CI Success。
- `D08_FINAL_PASS=ISSUED`。
- 四卡均 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；24 个 tracked 路径，受保护路径 diff=0。
- 未纳入：PMT-02（S0 真实模型语义回归）、D09 Event Analysis 写入与归属、Topic/Runtime。
