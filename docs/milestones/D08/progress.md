# D08 Progress：Event Search 历史候选召回

- Plan：`docs/milestones/D08/plan.md` v0.1
- Plan 状态：`DRAFT · G3_PENDING_ARCHITECT_APPROVAL`
- Intent：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- Spec：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 参考基线：main `717897f375ef3eff3cb24f48da5a0317701df70e` / tree `921c70201e6b503cce4bd59be91dcc0c07ec8955`
- 执行基线：`PENDING_G3_APPROVAL`
- 开发心跳：`NONE · 未获 G3 授权`
- 当前 Worker：`NONE`
- 当前结论：`D08_PLAN=DRAFT_READY_FOR_ARCHITECT_G3`、`G1=PENDING`、`G2=NOT_STARTED`、`G3=PENDING`、`D08_DEVELOPMENT=NOT_AUTHORIZED`、`D08_FINAL_PASS=NOT_ISSUED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D08-T01 Content/P-02 输入边界 | `NOT_STARTED` | `PENDING_G3_EXECUTION_BASELINE` | `NOT_RUN` | `PENDING` | `PENDING` | G1/G2/G3 未完成 |
| D08-T02 三路候选 Repository | `NOT_STARTED` | `PENDING_T01_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T01 |
| D08-T03 排序/上限/最近 10 条上下文 | `NOT_STARTED` | `PENDING_T02_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T02 |
| D08-T04 公共 factory/真实 SQLite 集成 | `NOT_STARTED` | `PENDING_T03_MERGE_SHA` | `NOT_RUN` | `PENDING` | `PENDING` | 串行依赖 T03 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计/外部依赖缺失转 `BLOCKED`。Worker 不得自行写 PASS。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | FROZEN_TREE | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D08-T01 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；允许集见 Plan §4.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D08-T02 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；允许集见 Plan §5.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D08-T03 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；允许集见 Plan §6.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D08-T04 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING`；允许集见 Plan §7.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |

任一 evidence 缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。candidate/merge 只记录精确 SHA，不以 branch 名或目录代替。

冻结后必须在同一 Lead 回复中交回 tree、patch 路径/SHA-256、路径/blob、定向/full 验证数字与结论；Architect 若只能从磁盘发现冻结产物，本卡退回流程重做。

## Spec / Case 覆盖

| Case | 计划责任 |
|---|---|
| `EVT-06` | T02 同实体不同 Subject 的 clue 证据；T04 端到端两事项 |
| `EVT-10` | T02 标准名/别名/FTS 全历史；T04 十年前 Event |
| `EVT-11` | T03 最近 10 条、时间/ID 决胜、旧→新；T04 真实 DB |
| `EVT-21` | T01 空 clues 合法；T04 P-02 1 次、Repository 0、零写入 |
| `EVT-22` | T02 空命中；T04 空候选成功且不虚构 |
| `EVT-23` | T02 第 1 条 Update 召回；T03/T04 不偷加旧 Update |
| `EVT-24` | T02 同 alias 两 Event；T03/T04 各自上下文 |
| `PMT-09` | T01/T04 P-02 只含 `task_data`，无 User Context |
| `PMT-15` | T01/T04 D02 strict Schema 拒绝非法输出 |

`PMT-02` 为 S0 真实 P-02 语义回归，不纳入 D08 P0 Gate；EVT-19/20 也不由 D08 冒充。

## 当前阻塞与待决策事项

- G1 未批准：负责人尚未批准 `intent.md`。
- G2 未推进：Spec 仍与 G1 草案关联；本 Lead 不自行批准 Spec。
- G3 未批准：本 Plan 仅为待审草案；未创建 Worker、开发心跳、candidate 或 merge。
- 未发现已冻结 DDL/D02 与 Spec 的已确认直接冲突；D02 strict Schema、`searchEvents` task-data-only、D01 全历史聚合文本均支持当前计划边界。
- Plan 内的实现口径已显式写成 G3 可审条目：`firstClueIndex` 不入五级排序；非法 `maxCandidates` 为构造期 RangeError；FTS 命中词按 clue 内唯一字面量、跨 clue 取并集计数。

## 下一可执行动作

1. 负责人先完成 D08 Intent G1；Architect 完成 Spec G2。
2. Architect 审核本 Plan；若有变更，Lead 只修订 `plan.md`/`progress.md` 并重新提交 G3。
3. G3 PASS 后由 Architect 创建唯一 D08 推进心跳、记录 ID 并派发全新 T01 Worker；Lead 不自行开发或创建心跳。

## Lead 计划编制记录

- 角色确认：PIS D08 唯一 Lead；职责仅 Plan/Progress，不编码、不创建 Worker、不创建心跳、不自批 G3。
- 参考基线：main `717897f375ef3eff3cb24f48da5a0317701df70e`，tree `921c70201e6b503cce4bd59be91dcc0c07ec8955`；分支/工作树编写前 clean。
- 只读核对：D08 Intent/Spec、D07 Plan/Progress 结构、通用规范 v1.0、项目规范、D01 Schema/FTS、D02 EventSearchResponse/searchEvents、PromptRepository、ContentRepository、D01 event-search tests，以及权威技术/数据库/实施/测试文档的相关章节。
- 工具链：`node v26.13.1`、`npm 11.20.0`，`npm run verify:toolchain` PASS。
- 文件范围：本轮只新增 `docs/milestones/D08/plan.md` 与 `docs/milestones/D08/progress.md`；不得改 Intent/Spec、源文件、测试、Prompt、CI、package 或真实 config。
- 四卡：T01 → T02 → T03 → T04 串行；每卡均包含精确允许写集、固定 base、Spec/Case、禁止范围、验证命令和冻结/candidate/merge/archive evidence key。
- 只读核心：一次 P-02；clues=[]/空候选成功；三路全历史召回；FTS 参数短语；同 Event 去重/同 alias 不同 Event 独立；五级排序后截断；默认 10、可配 1..50；最近 10 条 Update；全链路零业务/FTS 写。
- 非 P0：`PMT-02` 保持 S0；D07 RSS 清理时序失败保留观察项，若复现不弱化断言。
- G3 提交：本次最终提交 SHA 由 Lead 返回给 Architect；提交前参考基线不构成批准。G3 通过前 D08 开发保持 `NOT_AUTHORIZED`。
