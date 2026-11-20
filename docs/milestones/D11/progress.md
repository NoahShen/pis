# D11 Progress：Published Item 与模板

- Plan：`docs/milestones/D11/plan.md` v0.1
- Plan 状态：`G3_PENDING_ARCHITECT_REVIEW`
- Intent：`APPROVED · G1`
- Spec：`APPROVED · G2`
- 计划基线：main `5d95f8b6eb3e7beff89e3f52498c3b7de203feb1` / tree `e71bad95094e39b1be6b87443267349627a0509b`
- 固定运行时：Node `v26.13.1` / npm `11.20.0`
- 当前 Worker：`NONE`
- 开发心跳：`NOT_CREATED · G3 前禁止创建`
- 当前结论：`D11_PLAN=G3_PENDING_ARCHITECT_REVIEW`；T01～T04 均 `NOT_STARTED`

## 任务状态

| 任务 ID | 状态 | 前置/固定 base | 测试结果 | Lead | Architect | 阻塞说明 |
|---|---|---|---|---|---|---|
| D11-T01 Context/Draft DTO、HTML 安全与三类纯模板 | `NOT_STARTED` | 待 G3 批准后的精确文档提交 | `NOT_RUN` | `PENDING` | `PENDING` | 未启动 |
| D11-T02 已存证据来源链接、URL 校验、去重与追加 | `NOT_STARTED` | T01 merge 后的 docs record commit | `NOT_RUN` | `PENDING` | `PENDING` | 未启动 |
| D11-T03 目标资格、Repository、唯一短事务与重复复用 | `NOT_STARTED` | T02 merge 后的 docs record commit | `NOT_RUN` | `PENDING` | `PENDING` | 未启动 |
| D11-T04 不可变性、事务内复检、通知、公共出口与 P0 集成 | `NOT_STARTED` | T03 merge 后的 docs record commit | `NOT_RUN` | `PENDING` | `PENDING` | 未启动 |

状态语义：`NOT_STARTED → READY → IN_PROGRESS → REVIEW → PASS`；失败转 `FAIL/IN_PROGRESS`，设计或外部依赖缺失转 `BLOCKED`。Worker 不得自行写 `PASS`。

## 每卡交付证据

| 任务 ID | BASE_SHA | WORKER_AGENT | WORKER_WORKSPACE | WORKER_BRANCH | CHANGED_PATHS | PATH_COUNT | FROZEN_TREE | FROZEN_BLOBS | PATCH_PATH | PATCH_SHA256 | ARCHITECT_TREE_APPROVAL | CANDIDATE_SHA | MERGE_SHA | MERGE_TREE | VERIFICATION | ARCHIVE_RESULT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D11-T01 | `PENDING_G3` | `PENDING` | `PENDING` | `PENDING` | 待 Plan §4.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
| D11-T02 | `PENDING_T01_CLOSEOUT` | `PENDING` | `PENDING` | `PENDING` | 待 Plan §5.1 | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `PENDING` | `NOT_RUN` | `PENDING` |
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

- 当前唯一门禁为 Architect G3 审核 Plan。批准前不得创建 Worker、心跳、candidate、merge、push 或生产代码。
- T01 base 必须固定为包含 G3 批准结论的精确文档提交；T02～T04 base 必须分别固定为前卡 merge 后更新 `progress.md` 的 docs record commit，不使用前卡 merge SHA。
- 每卡候选前必须先以 `git merge-tree --write-tree --no-messages BASE CANDIDATE` 预演；预演 tree 与 frozen tree 不等即停止报告，不实际 merge。
- `PUB-11` 属 P1，不能因为它不阻断 P0 就跳过 T04 的注入测试；`PUB-09/12` 的不可变性必须按七列逐字节断言。
- **G3 契约确认项**：D11 成功返回对象可赋给 D15 `{published_item_id:string}`，但正常空结果的 `published_item_id:null` 使完整 D11 服务返回类型不能直接赋给 D15 `StageServices.publish()`。D11 不修改/不接线 D15；若要求服务级直接兼容，需 Architect 在 G3 明确 D11 范围外调整或适配策略。
- 不实现 RSS/归档/云端/API/Runtime 接线；不调用 LLM，不读取真实私有 Prompt/User Context；测试只用合成数据。

## 下一可执行动作

1. Architect 审核本 Plan，确认四卡依赖、精确写集、Case 映射、事务/通知边界和公开导出边界。
2. G3 批准后，以批准文档提交为执行 base；由 Architect 依项目规范创建唯一 D11 推进心跳并记录准确 ID。
3. Lead 为 T01 创建全新 Paseo Worker/独立 worktree；Worker 只改 Plan §4.1 精确六路径，交回 `REVIEW`/`BLOCKED`。

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
