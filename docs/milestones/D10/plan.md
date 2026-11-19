# D10 Plan：Topic Matching / 关注范围关联

> 版本：v0.1
> 状态：`G3_PENDING_ARCHITECT_REVIEW`
> 日期：2026-11-19
> 计划与首个执行基线：main `c0328e035cc24127d7c3b6ee92e02d68092e8648` / tree `f2fa99b64c38854e60af4c6792fe06e4f58f5c09`
> Intent：`docs/milestones/D10/intent.md`（`APPROVED · G1`）
> Spec：`docs/milestones/D10/spec.md`（`APPROVED · G2`）

本文只把已批准的 D10 Intent/Spec 映射为四张文件级、严格串行的任务卡。当前只交付 `plan.md` 与 `progress.md`；不创建 Worker、心跳、candidate、merge 或生产代码。Plan 未获 Architect G3 批准前，四卡保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标、公共契约与不可变更边界

D10 交付无 HTTP route、无 Runtime 接线的 Topic Matching 服务：

- 入口只接受 `"EVENT" | "EVENT_UPDATE" | "KNOWLEDGE"` 与非空白 `targetId`；非法输入、pre-abort 均在任何 DB/LLM 前失败。
- 目标不存在返回稳定错误 `target_not_found`；零 LLM、零写入。
- 已有 Published Item 返回 `should_publish:false`；零 LLM、零写入。
- 已有任意 Topic Association 返回 `should_publish:true`；零 LLM、零写入，不重判 Topic 当前 `enabled`。
- 启用 Topic 快照只由 D03 `listEnabled()` 提供；语义为 `enabled=1 AND id COLLATE BINARY ASC`。不再写第二份 Topic SQL。
- 无启用 Topic 或 `matched_topic_ids=[]` 均返回 `should_publish:false`；前者零 LLM，后者恰好一次 LLM，二者均零写入。
- P-05 恰好一次批量调用全部启用 Topic；不拆分、不逐 Topic、不重试、不保存负结果。
- P-05 strict Schema、JSON 解析、Topic ID 引用校验及首次顺序去重只由 D02 `parseLlmResponse("topic-matching", ...)` 负责；D10 不复制 Zod/JSON Schema/引用校验。
- 至少一个合法匹配时，在一个同步短事务中重新确认目标、确认尚无关联、按本次快照的 Topic ID BINARY 顺序插入缺失关联并逐行读回；失败全回滚。
- `matched_at` 在关联写入事务内通过注入 `Clock` 取一次，再用 `formatTimestamp()` 格式化；本里程碑不使用 `IdGenerator`。
- 多 Topic 仅形成一次发布资格 `should_publish:true`；D10 不派发 PublishTask。

公共返回契约固定为：

```ts
type TopicTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

interface TopicMatchingResult {
  should_publish: boolean;
  target_type: TopicTargetType;
  target_id: string;
}

interface TopicMatchingOptions {
  readonly signal?: AbortSignal;
}

interface TopicMatchingService {
  match(
    targetType: TopicTargetType,
    targetId: string,
    options?: TopicMatchingOptions,
  ): Promise<TopicMatchingResult>;
}
```

稳定错误及固定 message：

| code | message |
|---|---|
| `invalid_input` | `Invalid topic matching input` |
| `aborted` | `Topic matching was aborted` |
| `target_not_found` | `Topic matching target not found` |
| `topic_matching_failed` | `Topic matching operation failed` |
| `llm_failed` | `Topic matching LLM call failed` |

错误不保留 cause、SQL、Zod issues、Prompt、正文、模型原文或 Token。logger 只允许 `targetType/targetId/enabledTopicCount/matchedTopicCount/stage/reason`；stage 仅 `check|match|persist`，reason 仅上述五码。logger 同步抛错或异步拒绝均为 best-effort，不改变业务结果。

明确不做：DDL/FTS 修改、P-05 Prompt 修改、P-05 第二份 Schema、PublishTask 派发、Published Item/RSS/Runtime/queue/retry/Cron、HTTP route、历史重匹配、父 Event 关联继承、向量检索、新表/列/索引/outbox、新依赖、package/lock/CI 修改。

## 2. 上游只读核对结论与文件布局

### 2.1 上游只读核对结论

- `src/llm/response-validators.ts`：P-05 已使用 `strictObject`；要求 `matched_topic_ids` 为字符串数组、每个元素非空白；`normalizeTopicMatching()` 先保持首次出现顺序去重，再拒绝不属于 references 的 ID。D10 只需把本次启用 Topic ID 快照作为 `enabledTopicIds` 传入。
- `src/llm/llm-calls.ts`：`matchTopics(taskData, references, {signal})` 会分别快照 task data/references，原样透传 signal；非 Knowledge 操作只生成 `{task_data}`，天然不注入 User Context。D10 不修改该实现。
- `src/configuration/topic-repository.ts`：`TopicRepository.listEnabled()` 已执行 `WHERE enabled = 1 ORDER BY id COLLATE BINARY ASC`，并返回 `id/name/description/enabled`。D10 显式投影前三字段，不修改 D03。
- `src/database/schema.sql`：`topics` 有 `enabled` CHECK；`topic_associations` 主键为 `(topic_id,target_type,target_id)`，`target_type` 有 CHECK，多态目标存在性必须由应用层校验；`published_items` 有 `(target_type,target_id)` 唯一约束。无需 DDL 变更。
- `src/event-analysis/event-repository.ts`：Event/Update 可按 ID 点读，但 D10 不应依赖其可变写接口；T01 使用独立只读 target repository，避免耦合 D09 持久化语义。
- `src/knowledge/knowledge-repository.ts`：Repository 有按 Content ID 读取，D10 需要按 Knowledge ID 点读，因此 T01 在 target repository 内使用显式 SQL，并显式投影 `findings_json` 解析结果；不得加载 Content、URL、raw_data 或 Topic。
- `src/database/transaction.ts`：`withTransaction()` 使用 `BEGIN IMMEDIATE`，检查 async callback 与 thenable 返回值，嵌套时使用 savepoint；D10 只复用它，不复制事务实现。
- `tests/database/*` 与 D02 既有测试已覆盖 DDL 多态边界、唯一约束、回滚、thenable 拒绝、strict P-05 Schema、非法 Topic ID 与首次顺序去重；D10 只在这些能力上增加业务编排和真实 SQLite 集成证据。

未发现 D10 已批准 Spec 与当前 D02 strict Schema、D03 `listEnabled()` 或 D01 transaction 能力之间的实现冲突。若 Worker 发现实际行为偏离以上只读结论，立即 `BLOCKED`，不得在 D10 修补上游或复制第二份规则。

### 2.2 模块职责

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/topic-matching/contracts.ts` | 公共 target/result/options/service 与最终 Dependencies 类型 | T01/T04 |
| `src/topic-matching/topic-matching-target-repository.ts` | 三类目标只读 DTO、显式字段投影、父 Event 基础背景 | T01 |
| `src/topic-matching/topic-matching-errors.ts` | 五码稳定错误与安全 Abort 识别 | T02 |
| `src/topic-matching/topic-matching-call.ts` | P-05 task data/references 组装、单次调用、错误/取消边界 | T02 |
| `src/topic-matching/topic-association-repository.ts` | Association 存在性、幂等插入、单行读回 | T03 |
| `src/topic-matching/published-item-repository.ts` | Published Item 按目标存在性只读判断 | T03 |
| `src/topic-matching/topic-matching-persistence.ts` | 同步短事务、事务内复核、BINARY 快照顺序写入、读回与发布资格 | T03 |
| `src/topic-matching/topic-matching-logger.ts` | 六字段白名单、三阶段、五 reason 的 best-effort logger | T04 |
| `src/topic-matching/topic-matching.ts` | 完整顺序、复用/跳过、错误映射与公共 factory | T04 |
| `src/topic-matching/index.ts` | 唯一公共导出边界 | T04 |
| `tests/fixtures/topic-matching.ts` | 合成三目标/Topic/Prompt、harness、快照与故障探针 | T01～T04 递进 |
| `tests/topic-matching/*.test.ts` | T01～T04 的单元、真实 SQLite 与 P0 集成证据 | 各卡 |

### 2.3 内部不变量

- Repository 只使用参数绑定和显式列；不得把数据库 row、模型输出、cause 或任意额外属性 spread 到公共 DTO。
- `EVENT_UPDATE` DTO 只含当前 Update 的 `id/event_id/title/description/occurred_at` 和父 Event 的 `id/title/entity_name/subject/scope/description`；不返回 Update 数组、父 Event 的任何历史 Update、父 Event 关联或 `discovered_at`。
- Knowledge `findings` 只保留 `{title, description}`；数据库 JSON 中额外键在投影时剥离。`category=null` 必须保留为 `null`。
- `TopicMatchingTaskData` 顶层严格为 `{target, topics}`；topics 项严格为 `{id,name,description}`。references 严格为 `{enabledTopicIds}`。
- D02 返回的重复 ID 已按首次出现去重；T03 写入顺序服从 `enabledTopicIds` 的 BINARY 快照顺序，不另造主 Topic、评分或排名。
- 事务外读取目标、Published Item、Association、Topic 快照并调用 LLM；事务内不调用 LLM、网络、Clock 之外的异步 API或 logger。
- COMMIT 后返回唯一发布资格；不得返回关联数组、Published Item、模型原文或队列对象。

## 3. 四卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | 三类目标最小只读 DTO 与显式投影 | 无 P-05 调用、无关联/发布资格、无公共 factory |
| T02 合并后 | 启用 Topic task data/references、P-05 单次调用、D02 严格输出、错误/取消 | 无数据库写入、无事务、无复用/跳过 |
| T03 合并后 | Association/Published Item 读仓储、同步短事务、读回、回滚、发布资格原语 | 无公共 factory、无完整复用/跳过编排 |
| T04 合并后 | 公共 factory、完整分支、真实 SQLite P0、复用/跳过与隐私边界 | 无 PublishTask、Published Item、RSS、Runtime；仍待 G4/集成 Gate/CI |

四卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 和独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。

| Case | 主责任卡 | D10 必测断言 |
|---|---|---|
| `TOP-01` | T01/T04 | EVENT DTO 精确；真实 SQLite 写 1 行并返回一次 `should_publish:true`；不声称派发 PublishTask |
| `TOP-02` | T03/T04 | 2 Topic 按快照顺序写 2 行，仍只有一个 true |
| `TOP-03` | T02/T04 | 合法空数组成功、P-05 1 次、零关联、false、目标保留 |
| `TOP-04` | T02/T04 | 空启用快照 P-05 0 次、零关联、false |
| `TOP-05` | T02/T04 | 禁用 Topic ID 经 D02 拒绝、`llm_failed`、零关联 |
| `TOP-08` | T01/T04 | 父 Event 已关联不进入 Update DTO；Update 空匹配不继承 |
| `TOP-09` | T01/T04 | Update 只匹配自身相关 Topic，不要求与父 Event 一致 |
| `TOP-10` | T02/T04 | 快照读取后禁用/修改 Topic，本任务仍按原快照完成并写入 |
| `TOP-11` | T04 | 新建/修改 Topic 不自动调用 Matching，不改旧关联/Published Item |
| `TOP-12` | T02/T04 | D02 去重重复 ID；非法 ID/非数组/错误结构拒绝且零写 |
| `TOP-14` | T01/T04 | Knowledge Title/Summary/Category/Findings/Value 精确投影；不重做 valuable 判断 |
| `TOP-15` | T01/T04 | 三类不存在目标均 `target_not_found`、零 LLM/零写 |
| `TOP-16` | T04 | 已关联后禁用 Topic，不删既有行；重复匹配仍直接 true、P-05 0 次 |
| `PMT-07` | T02/T04 | 非 JSON、缺字段、额外字段、错误类型、非法 Topic 引用全部 D02 拒绝 |
| `PMT-09` | T02/T04 | P-05 user JSON 顶层仅 `task_data`；无 `user_context` |
| `ATOMIC` | T03/T04 | LLM 在事务外；同步事务；中途写入/读回失败全回滚；D01 thenable 拒绝有效 |
| `PRIVACY` | T02/T04 | error/logger 无 Topic 名称/描述、正文、Prompt、模型原文或 Token |

`TOP-06/TOP-07` 的 D10 本地行为也纳入 T04：已有关联时 0 LLM/0 写/true，已有 Published Item 时 0 LLM/0 写/false。`TOP-01/02/06` 中真正的一个 PublishTask 派发属于 D11/Runtime，D10 只证明唯一 `should_publish`。`TOP-13` 属 P1，不是本卡 P0 Gate；`PMT-06` 属 S0 真实模型语义，不用 Stub 冒充。

## 4. D10-T01 · 三类目标最小 DTO 与只读 Targets Repository

### 4.1 依赖与精确允许写集

- 前置：D10 Plan 已获 G3 批准并明确启动 T01；base 固定为批准 `plan.md`/`progress.md` 后的精确文档提交 SHA。
- 新增且仅允许写：`src/topic-matching/contracts.ts`。
- 新增且仅允许写：`src/topic-matching/topic-matching-target-repository.ts`。
- 新增且仅允许写：`tests/fixtures/topic-matching.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-matching-target-repository.test.ts`。
- 只读复用：D01 open/schema、D03 Topic types、D07 Knowledge types、D09 Event/Update 表契约、临时 SQLite/fault fixtures。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2.1～§2.3、§4、§10；`TOP-01`、`TOP-08`、`TOP-09`、`TOP-14`、`TOP-15` 的目标 DTO/存在性基础。

### 4.2 禁止范围

- 不得修改 D01/D02/D03/D07/D09、app/server/lifecycle、配置、CI、package/lock。
- 不得实现启用 Topic 快照、P-05 调用、错误映射、事务、Association/Published Item 写读或公共 factory。
- 不得写任何业务表；Target Repository 只有 SELECT。
- 不得读取 Knowledge 的 Content/URL/raw_data，不得读取 Event 全部历史 Update，不得读取任何 Topic Association 或 Published Item。
- 不得使用 `SELECT *`、对象 spread 或运行时额外属性把数据直接传给模型。

### 4.3 实现要求

1. `contracts.ts` 声明 `TopicTargetType`、`TopicMatchingResult`、`TopicMatchingOptions`、`TopicMatchingService` 与三类 target DTO 的只读类型；不在本卡声明最终 Dependencies。
2. `EVENT` DTO 精确为 `{target_type,id,title,entity_name,subject,scope,description,occurred_at}`；排除 `discovered_at`。
3. `EVENT_UPDATE` DTO 精确为 `{target_type,id,event_id,title,description,occurred_at,event:{id,title,entity_name,subject,scope,description}}`；只 JOIN 父 Event，不查询 `event_updates` 历史，不加载父 Event Topic Association。
4. `KNOWLEDGE` DTO 精确为 `{target_type,id,title,summary,category,findings,value}`；findings 从 `findings_json` 解析后仅投影 `title/description`，category 可空。
5. `TopicMatchingTargetRepository.getTarget(targetType,targetId)` 只返回最小 DTO 或 `null`；三类查询均按 ID 参数绑定并显式列。未知运行时 type 由调用边界处理，不在 Repository 写入或返回宽泛 row。
6. malformed Knowledge findings、非法 category 或字段形状不是“目标不存在”，必须抛错交给 T04 映射 `topic_matching_failed`；不得返回部分 DTO。
7. fixture 只建立合成 Contents/Events/Update/Knowledge/Topics 与业务表快照读取工具；不读取真实 config/Prompt/API Key。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `EVENT_DTO` | 全字段、null/字符串 occurred_at、排除 discovered_at；不存在返回 null |
| `EVENT_UPDATE_DTO` | 当前 Update 全字段 + 父 Event 五基础字段；不返回任何 Update 数组/历史 Update/discovered_at |
| `KNOWLEDGE_DTO` | Title/Summary/Category/Findings/Value；category null；findings 仅 title/description |
| `EXPLICIT_PROJECTION` | 四类数据库额外字段/JSON 额外键均不出现在 DTO 键集 |
| `TOP-08/09_CONTEXT` | 父 Event 即使有关联或历史 Update，Update DTO 也不携带关联或历史 |
| `TOP-14_CONTEXT` | Knowledge 上下文可直接满足 Spec §4，且不触发 valuable 判断 |
| `TOP-15_NOT_FOUND` | 三类合法形式 ID 均 null；零写、无 LLM/事务 |
| `MALFORMED_KNOWLEDGE` | findings 非对象数组/元素缺字段立即抛错，不部分返回 |
| `READ_ONLY` | Repository 源码无 INSERT/UPDATE/DELETE/transaction/LLM/fetch；全业务表前后快照不变 |

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/topic-matching/topic-matching-target-repository.test.ts tests/event-analysis/event-repository.test.ts tests/knowledge/knowledge-repository.test.ts tests/configuration/topic-repository.test.ts tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|matchTopics|withTransaction|INSERT|UPDATE|DELETE|user_context|raw_data|published_items|topic_associations' src/topic-matching/contracts.ts src/topic-matching/topic-matching-target-repository.ts tests/fixtures/topic-matching.ts tests/topic-matching/topic-matching-target-repository.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/event-analysis src/event-search src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。静态扫描命中仅允许 fixture 建数 SQL、读取目标所需 SELECT/table 名称或测试禁止字段断言，并须逐条解释。交回必须列 base SHA、实际路径、Case→测试名、命令结果和已知限制，仅报 `REVIEW`/`BLOCKED`。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §4.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 5. D10-T02 · 启用 Topic 快照、P-05 task data/references、单次调用与严格错误

### 5.1 依赖与精确允许写集

- 前置：`D10-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增且仅允许写：`src/topic-matching/topic-matching-errors.ts`。
- 新增且仅允许写：`src/topic-matching/topic-matching-call.ts`。
- 修改且仅允许改：`tests/fixtures/topic-matching.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-matching-call.test.ts`。
- 只读复用：T01 contracts、D02 `TypedLlmCalls.matchTopics`/`parseLlmResponse`/strict P-05 Schema、D03 `Topic` 与 `listEnabled()` 契约、临时合成 Prompt/StubLLM、D01 abort 测试。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2.1～§2.3、§3、§5、§6、§8；`TOP-03/04/05/10/12`、`PMT-07`、`PMT-09` 的调用边界。

### 5.2 禁止范围

- 不得修改 T01、D02 Prompt/Schema/validator、D03 Repository/DTO、D01 DDL/transaction、其他 D04～D09 模块、app/server/lifecycle、CI、package/lock。
- 不得实现数据库读取/写入、Transaction、Association/Published Item Repository、公共 factory 或 Runtime。
- 不得创建第二份 Zod schema、手工 JSON 解析器、Topic 引用校验、去重、评分、重试、超时、Provider 切换或响应修复。
- 不得把 Topic `enabled`、目标 `content_id/discovered_at`、历史 Update、raw_data、URL、User Context 或 Token 送入 P-05。

### 5.3 实现要求

1. `topic-matching-errors.ts` 精确实现 Spec §8 五码与 message；安全识别 `AbortError`、`ABORT_ERR`、`LLM_CANCELLED` 及既有 TopicMatching aborted，不保留 cause。
2. `buildTopicMatchingTaskData(target,topics)` 只返回 `{target, topics}`；topics 显式投影为 `{id,name,description}` 并保持 D03 传入顺序。不得 spread `Topic`。
3. `buildTopicMatchingReferences(topics)` 只返回 `{enabledTopicIds: topics.map(({id}) => id)}`，保持原顺序；不自行去重或校验引用。
4. `callTopicMatching(taskData,references,typedLlmCalls,signal)` pre-abort 零调用；否则恰好一次 `matchTopics(taskData,references,{signal})`。调用中/返回后 signal 已中止或底层取消均映射 `aborted`。
5. 除取消外的 Prompt load/JSON/Schema/引用/Provider 错误统一映射 `llm_failed`；D02 成功响应原样返回，不二次解析、改写或补充结果。
6. task data/references 必须是本次调用快照；外部之后修改原 Topic 数组或对象不得改变已构造 payload。D02 typed call 内部再次快照属于既有行为，不重复实现。
7. 本卡不直接实现 `listEnabled()`；service 在 T04 调用 D03 并把返回值交给 builder。测试必须证明 D03 顺序契约下的 topics/references 精确形状。
8. 不新增 User Context 读取路径。P-05 合成测试 Prompt 目录可含 `user-context.md` sentinel，但 `matchTopics` user JSON 必须仍只有 `{task_data}`。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `P05_TASK_DATA` | 顶层精确 target/topics；Topic 项仅 id/name/description；顺序保持传入快照 |
| `P05_REFERENCES` | enabledTopicIds 精确同序；不包含额外字段 |
| `SNAPSHOT` | 构造后 mutation 原 topics/target 不改变 payload；每次调用前再次快照 |
| `CALL_ONCE` | 仅 matchTopics 1 次；task data/references/signal 原样透传；无重试/其他 operation |
| `TOP-03` | `{matched_topic_ids:[]}` 原样成功，不补错误/负状态 |
| `TOP-05/12_PRE` | D02 对禁用 ID、非法 ID、非数组、重复 ID 的引用/去重行为被真实 typed call 调用一次并保留其结果/错误 |
| `PMT-07` | 非 JSON、缺字段、额外字段、错误类型均 D02 拒绝并映射 `llm_failed` |
| `PMT-09` | 合成 `topic-matching.md` 调用时 user JSON 顶层仅 `task_data`，无 user_context |
| `PRIVACY_TASK` | task data 无 User Context、目标正文/URL/raw/discovered_at、Topic enabled 或 Token sentinel |
| `ABORT_ERROR` | pre-abort 零调用；AbortError/ABORT_ERR/LLM_CANCELLED 映射 aborted；非取消错误恰一次且 llm_failed；error 无 cause/敏感串 |

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/topic-matching/topic-matching-call.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/transaction.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|withTransaction|INSERT|UPDATE|DELETE|matchTopics|user_context|raw_data|published_items|topic_associations|enabledTopicIds|matched_topic_ids' src/topic-matching/topic-matching-errors.ts src/topic-matching/topic-matching-call.ts tests/fixtures/topic-matching.ts tests/topic-matching/topic-matching-call.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/event-analysis src/event-search src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。静态命中的既有 operation/Schema 字段/合成 Prompt sentinel 必须逐条解释；生产代码不得出现 DB 写、事务、其他 operation、User Context 或手工 P-05 校验。交回格式同 T01；本卡通过只表示 P-05 前置边界 PASS。

### 5.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T01_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §5.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 6. D10-T03 · Association/Published Item Repository 与同步短事务发布资格

### 6.1 依赖与精确允许写集

- 前置：`D10-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 新增且仅允许写：`src/topic-matching/topic-association-repository.ts`。
- 新增且仅允许写：`src/topic-matching/published-item-repository.ts`。
- 新增且仅允许写：`src/topic-matching/topic-matching-persistence.ts`。
- 修改且仅允许改：`tests/fixtures/topic-matching.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-association-repository.test.ts`。
- 新增且仅允许写：`tests/topic-matching/published-item-repository.test.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-matching-persistence.test.ts`。
- 只读复用：T01 Target Repository、D01 open/schema/transaction、Clock/formatTimestamp、临时 SQLite/fault fixture。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §2.5、§2.7、§5、§6、§7；`TOP-02` 持久化、`TOP-08/09/10/14` 的关联原语、`ATOMIC`、`TOP-16` 的既有关系基础。

### 6.2 禁止范围

- 不得修改 T01/T02、D01/D02/D03/D07/D09、app/server/lifecycle、配置、CI、package/lock。
- 不得实现公共 factory、完整 match 顺序、P-05 调用、logger、Runtime/PublishTask、Published Item 生成或 RSS。
- 不得新增 IdGenerator，不得写 Published Item，不得写 Topic 配置或 Event/Knowledge 表。
- 不得在事务内调用 LLM、网络、异步 logger；不得把 async callback/thenable 传给 `withTransaction()`。
- 不得创建第二份 Topic 启用判断或引用校验；Topic disabled 后仍按已传入快照写入。

### 6.3 实现要求

1. `TopicAssociationRepository` 提供 `existsForTarget()`、`get()`、`insertIfAbsent()`；SQL 显式选择/绑定四字段，查询按 `target_type,target_id`，读取单行按联合主键。
2. `insertIfAbsent()` 使用 `ON CONFLICT DO NOTHING`，`changes` 只能是 0/1；新插入必须立即读回并核对 `topic_id/target_type/target_id/matched_at`。已存在时不得覆盖原 `matched_at`。
3. `PublishedItemRepository.existsForTarget()` 只执行存在性 SELECT；不加载标题/正文，不写、不更新、不删除。
4. `persistTopicAssociations()` 必须是同步原语，通过一次 `withTransaction(database, callback)` 执行；callback 不得 async、不得返回 PromiseLike。
5. 事务内按顺序重新读取目标并确认存在；目标已消失时抛 TopicMatching `target_not_found`。随后再次检查任意 Association：已存在则直接返回 `should_publish:true`，不取 Clock、不写。
6. 无关联时只调用一次 `clock.now()` 和一次 `formatTimestamp()`；按传入 `enabledTopicIds` 的 BINARY 快照顺序过滤 matched IDs，逐个 `insertIfAbsent()` 并读回。多个关联共用同一 `matched_at`。
7. 不重新检查 Topic 当前 `enabled` 或名称/描述；它们只在 T02 生成 P-05 payload 时使用。Topic 在快照后被禁用/修改不影响本次合法关联写入。
8. 任一 insert/readback/数据库异常原样抛出，由外层事务全回滚；不得捕获后返回部分资格。事务成功只返回内部 `{should_publish:true}`，不返回关联数组。
9. Repository 写方法必须断言 `database.inTransaction===true`；事务外调用立即失败。Repository 不接收 Clock/LLM/logger/TopicRepository。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `ASSOCIATION_ROUNDTRIP` | 四字段 round-trip；三类 target/多个 Topic 独立；`matches` 查询精确 |
| `ASSOCIATION_IDEMPOTENT` | 同联合键第二次 changes=0、原 matched_at 不覆盖；不同 Topic/target 独立 |
| `PUBLISHED_EXISTS` | 已有该 target 行返回 true；其他 target 返回 false；零写/零模型 |
| `TOP-02_PERSIST` | 2 Topic 写 2 行，matched_at 完全相同，仅返回一个 true |
| `SNAPSHOT_ORDER` | 插入按 enabledTopicIds BINARY 快照顺序；重复由 D02 先行处理，本卡不复制去重规则 |
| `TOP-10/16_PERSIST` | Topic 在快照后禁用仍可插入；已有关联即使 Topic disabled 仍返回 true 且不改行 |
| `TARGET_RECHECK` | 事务内目标消失抛 target_not_found；零部分关联 |
| `CLOCK_ONCE` | 实际插入时 Clock 1 次、formatTimestamp 1 次；已有关系/目标失败 0 次 |
| `ROLLBACK` | 第 2 个 insert 或任一 readback 失败时第 1 行也回滚；业务表快照恢复 |
| `SYNC_TRANSACTION` | `db.inTransaction` 探针显示精确一次 immediate 事务；LLM/logger/fetch 调用 0；D01 thenable 测试仍 PASS |
| `READ_ONLY_PUBLISHED` | Published Item 仓库仅 SELECT；任何分支不新增/修改 Published Item |

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/topic-matching/topic-association-repository.test.ts tests/topic-matching/published-item-repository.test.ts tests/topic-matching/topic-matching-persistence.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/schema-constraints.test.ts tests/topic-matching/topic-matching-target-repository.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|matchTopics|user_context|raw_data|INSERT|UPDATE|DELETE|CURRENT_TIMESTAMP|datetime\(|strftime\(|IdGenerator|PublishTask|rss' src/topic-matching/topic-association-repository.ts src/topic-matching/published-item-repository.ts src/topic-matching/topic-matching-persistence.ts tests/fixtures/topic-matching.ts tests/topic-matching/topic-association-repository.test.ts tests/topic-matching/published-item-repository.test.ts tests/topic-matching/topic-matching-persistence.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/event-analysis src/event-search src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。INSERT 命中只允许本卡 Association 写和 fixture 建数；UPDATE/DELETE/时间 SQL/PublishTask/RSS 命中必须逐条证明为禁止测试或零命中。交回同 T01；本卡通过只表示持久化原语与发布资格原语 PASS。

### 6.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T02_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §6.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 7. D10-T04 · 公共 factory、复用/跳过、真实 SQLite 集成与 P0 Gate

### 7.1 依赖与精确允许写集

- 前置：`D10-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 修改且仅允许改：`src/topic-matching/contracts.ts`。
- 新增且仅允许写：`src/topic-matching/topic-matching-logger.ts`。
- 新增且仅允许写：`src/topic-matching/topic-matching.ts`。
- 新增且仅允许写：`src/topic-matching/index.ts`。
- 修改且仅允许改：`tests/fixtures/topic-matching.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-matching-service.test.ts`。
- 新增且仅允许写：`tests/topic-matching/topic-matching-integration.test.ts`。
- 只读复用：T01～T03、D01 SQLite/transaction、D02 typed P-05 calls/strict validator、D03 `SqliteTopicRepository.listEnabled()`、D07/D09 三类目标数据、FakeClock、StubLLM、临时合成 Prompt。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1～§10；D10 P0 的最终服务与真实 SQLite 证据，`TOP-01`～`TOP-05`、`TOP-08`～`TOP-12`、`TOP-14`～`TOP-16`、`PMT-07`、`PMT-09`、`ATOMIC`、`PRIVACY`。

### 7.2 禁止范围

- 不得修改 T01～T03、D01/D02/D03/D07/D09、app/server/lifecycle、配置、CI、package/lock。
- 不得实现 PublishTask 派发、Published Item 生成、RSS、Runtime/queue/retry/Cron、HTTP route、历史重匹配、向量检索或 Topic 自动生成。
- 不得在 app/server 中接线，不得读取真实 `config/prompts`/`config/prompt/user-context.md`、API Key 或网络。
- 不得在事务内调用 LLM/Repository 之外的外部 I/O、logger；不得复制 D02 Schema/引用规则或 T03 事务实现。
- 不得返回 Conversation/Prompt/模型原文/关联列表/Published Item/队列；不得修改已有关联或 Topic enabled。

### 7.3 实现要求

1. `contracts.ts` 补全 Dependencies：`database`、`targetRepository`、`topicRepository`、`associationRepository`、`publishedItemRepository`、仅 `matchTopics` 的 typed calls、`clock`、`logger`。不得依赖 IdGenerator、Runtime、PromptRepository、Adapter 或其他模块 service。
2. `createTopicMatching()` 返回 `TopicMatchingService`；`index.ts` 运行时只导出 factory/error，DTO/Options/Service/Dependencies 仅 type export，不导出 SQL/Repository/persistence/logger helper。
3. 顺序固定：运行时校验 targetType/targetId → pre-abort → targetRepository 点读 → published exists → association exists → `topicRepository.listEnabled()` 快照 → 空快照短路 → T02 task data/references → 恰好一次 P-05 → P-05 返回后 abort 检查 → 空结果短路 → pre-persist abort → T03 单事务 → COMMIT 后 abort 检查 → `{should_publish:true}`。
4. `targetType` 只允许三值且 `targetId` 为非空白字符串；非法时零 DB/LLM。pre-abort 同样零 DB/LLM。目标缺失为 `target_not_found`，不是空结果。
5. 已有 Published Item 优先返回 false；已有 Association 其次返回 true。两分支均不取启用 Topic、不调用 P-05、不写关联。已有 Association 不重判 Topic enabled。
6. DB/Repository/事务/读回异常映射 `topic_matching_failed`；P-05 Prompt/JSON/Schema/引用/Provider 异常映射 `llm_failed`；signal 中止优先映射 `aborted`。错误均新建为 `TopicMatchingError`，不保留 cause。
7. 成功 P-05 由 D02 typed call 返回；T04 只能检查 `matched_topic_ids` 是数组的防御性形状，不得重建 Schema、引用集合或去重逻辑。空数组不调用 T03、不取 Clock、不写。
8. 非空匹配只调用 T03 `persistTopicAssociations()` 一次，并传入本次启用 Topic ID 的 BINARY 快照及 D02 返回 ID；Topic 在快照后禁用/修改仍按快照完成。COMMIT 后 signal 已中止则稳定返回 `aborted`，已提交关联不回滚。
9. logger 使用精确六字段白名单，stage 仅 `check|match|persist`，reason 仅五错误码；不记录 Topic 名称/描述、目标标题/正文、模型原文、SQL、Prompt 或 Token。同步/异步 logger 失败不得改变结果。
10. fixture 提供三类合成目标、启用/禁用 Topic、Published Item、synthetic `topic-matching.md`、可选 `user-context.md` sentinel、StubLLM、FakeClock、真实 SQLite harness、业务表快照与事务内/外探针；不得包含真实私密 sentinel。
11. 集成使用真实 T01/T03 Repository、真实 D03 `SqliteTopicRepository.listEnabled()`、真实 SQLite、真实 D02 `createTypedLlmCalls` + StubLLM；不 mock P-05 validator。TOP-10 的延迟 wrapper 必须先让 service 读取快照，再在 P-05 返回前执行真实 D03 update disable，最后仍走真实 D02 typed call。
12. 所有 P0 断言直接检查 `topic_associations`、`published_items`、Topics、目标表和全业务表快照；`globalThis.fetch`/Adapter 零调用。数据库关闭后无 WAL/SHM/unhandled rejection。

### 7.4 服务测试矩阵

| Case | 必测断言 |
|---|---|
| `INVALID_INPUT` | 非法 type、空/空白/非字符串 ID：invalid_input、零 DB/LLM/write |
| `PRE_ABORT` | 已中止 signal：aborted、零 DB/LLM/write |
| `TOP-15` | 三类不存在目标：target_not_found、P-05 0、零写 |
| `TOP-07` | 已有 Published Item：false、P-05 0、零写 |
| `TOP-06_LOCAL` | 已有 Association：true、P-05 0、零写；disabled Topic 不改变 |
| `TOP-04` | 空启用 Topic：false、P-05 0、零写 |
| `TOP-03` | 非空快照但 P-05 空数组：false、P-05 1、零写 |
| `ERROR_MAP` | DB/Repository→topic_matching_failed；P-05→llm_failed；取消优先 aborted；无 cause |
| `LOGGER` | 六字段白名单；stage/reason 精确；Topic 名/正文/Prompt/Token 不出现；throw/reject 不改变结果 |
| `PUBLIC_SHAPE` | 结果只含三字段；true/false 均精确；runtime exports 仅 factory/error |
| `ABORT_AFTER_LLM` | P-05 返回后取消不进入持久化；pre-abort 与调用中取消均零写 |

### 7.5 真实 SQLite 集成矩阵

| Case | 必测断言 |
|---|---|
| `TOP-01` | EVENT 匹配单 Topic：1 行关联、一次 true；不创建 PublishTask/Published Item |
| `TOP-02` | EVENT_UPDATE 或 KNOWLEDGE 两 Topic：2 行关联、一次 true、无主 Topic/评分 |
| `TOP-03` | 空匹配：target 保留、0 关联、false；再次显式调用仍可再取 P-05（P1 行为不作硬 Gate） |
| `TOP-04` | 仅 disabled Topic：P-05 0、0 关联、false |
| `TOP-05` | model 返回 disabled ID：llm_failed、0 关联、无其他表写 |
| `TOP-08` | 父 EVENT 已关联，EVENT_UPDATE 空匹配：无继承、0 Update 关联 |
| `TOP-09` | 父 EVENT=`T-AI`，Update 仅匹配 `T-TECH`：只写 Update+T-TECH |
| `TOP-10` | 读取快照后真实 D03 disable 该 Topic、P-05 返回该 ID：仍写原 Topic，matched_at 有效 |
| `TOP-11` | 创建/启用/修改 Topic 后无自动 Matching：P-05 0、旧关联/Published Item 不变 |
| `TOP-12` | 重复 ID 去重后只写一行；非法/非数组零写；D02 成功后顺序已规范化 |
| `TOP-14` | KNOWLEDGE 的 Title/Summary/Category null/Findings/Value 精确进入 task_data；不读取 Content 正文 |
| `TOP-15` | 三类目标不存在：稳定错误、0 LLM、0 关联、0 Published |
| `TOP-16` | 先关联再 disable Topic：既有行不删；重复执行 true、P-05 0、行不变 |
| `PMT-07` | 集成覆盖非 JSON/缺字段/额外字段/错误类型/非法引用：llm_failed、全表不变 |
| `PMT-09` | user JSON 顶层仅 task_data；task_data 只含 target/topics；无 user_context/raw/URL/Token |
| `ATOMIC` | P-05 时 `db.inTransaction=false`；插入/读回时 true；中途失败/readback 故障全回滚；D01 thenable 测试 PASS |
| `PRIVACY` | error/logger/request sentinel 不泄漏正文、Topic 描述、Prompt、模型原文或 Token |

另测：启用 Topic 的 `id` BINARY 顺序、Knowledge/Update/Event 三类均真实 round-trip；`published_items` 在任何 D10 路径零新增/零修改；clock 只在实际写入时一次；日志 best-effort；关闭 DB 无资源残留。

### 7.6 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/topic-matching tests/configuration/topic-repository.test.ts tests/knowledge/knowledge-repository.test.ts tests/event-analysis/event-repository.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|routeProcessing|searchEvents|analyzeEvents|analyzeKnowledge|user_context|raw_data|apiKey|process\.env|new .*Repository|CryptoIdGenerator|SystemClock|PublishTask|rss|topic_associations|published_items|INSERT|UPDATE|DELETE' src/topic-matching/topic-matching.ts src/topic-matching/topic-matching-logger.ts src/topic-matching/index.ts src/topic-matching/contracts.ts tests/fixtures/topic-matching.ts tests/topic-matching/topic-matching-service.test.ts tests/topic-matching/topic-matching-integration.test.ts || true
rg -n 'config/prompts|config/prompt|process\.env|apiKey|new .*Repository|CryptoIdGenerator|SystemClock' src/topic-matching tests/topic-matching tests/fixtures/topic-matching.ts || true
git diff --name-only <BASE_SHA> -- src/database src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/event-analysis src/event-search src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。静态命中只允许 factory 合法注入/new Repository、service 合法引用 matchTopics/Topic Repository、测试 fixture 建数与禁止 sentinel；必须逐条解释。交回须附真实 SQLite + 真实 D03 + D02 StubP05 的 Case→测试名→命令→PASS、P-05 次数、事务内外探针、全表/Published/Topic 快照、隐私与关闭资源证据，并只报 `REVIEW`/`BLOCKED`。

### 7.7 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T03_MERGE_SHA` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §7.1 |
| `FROZEN_TREE` | `PENDING` |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；不得由 Lead 代替 Worker 编码，也不得让 Worker 自行创建 candidate。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 HEAD/tree；tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡精确白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case、错误/隐私、禁止路径、no-op、定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch 路径/SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **同次交回硬门禁**：冻结完成后，Lead 必须在同一次回复中给出冻结 tree、patch 路径/SHA-256、路径数、blob、定向/full 验证数字与交回结论。若 Architect 只能从磁盘发现冻结产物，本卡退回流程重做，不接受事后补报。
6. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
7. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
8. **Merge**：Lead 在 D10 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
9. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
10. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

`progress.md` 每卡记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_PATH`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## 9. D10 集成 Gate 与最终验收边界

四卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/topic-matching tests/configuration/topic-repository.test.ts tests/knowledge/knowledge-repository.test.ts tests/event-analysis/event-repository.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts tests/prompt/prompt-repository.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database/schema.sql src/llm src/prompt src/adapters src/collection src/processing src/knowledge src/event-analysis src/event-search src/config.ts src/configuration src/time src/id src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

Gate 必须保留：

- `TOP-01`～`TOP-05`、`TOP-08`～`TOP-12`、`TOP-14`～`TOP-16`、`PMT-07`、`PMT-09` 逐项 Case→测试文件/命令→PASS；`PMT-06` 明确为 S0 非 P0。
- `TOP-01/02` 只证明 D10 的一次发布资格，不冒充 PublishTask 派发；`TOP-06/07` 只证明本地 zero-LLM 复用/跳过。
- D03 `listEnabled()` 的 `enabled=1` 与 BINARY 顺序；Task data/references 只含 Spec 字段；P-05 调用恰好一次；空数组成功且零写。
- D02 对非 JSON/严格 Schema/非法 Topic ID/重复 ID 的唯一校验责任；D10 无第二份 Schema。
- 已有关联、已发布、无启用 Topic、目标不存在四类低成本分支的 DB/LLM/write 次数精确。
- Association 写入单同步事务；Clock 1 次；多 Topic 同一 matched_at；事务内重验 target/association；插入后逐行读回；中途失败全回滚。
- Event Update DTO 不含历史 Update，不继承父 Event 关联；Knowledge 字段精确；Topic 快照后禁用/修改仍完成本次关联。
- Published Item 在任何 D10 路径零新增/零修改；无 PublishTask/RSS/Runtime/HTTP/queue/vector/history rematch。
- 真实 SQLite + 真实 D03 + D02 StubP05 集成；fetch/Adapter 零调用；error/logger 无敏感内容；DB 关闭无 WAL/SHM/unhandled rejection。
- 相对批准基线仅允许 D10 `src/topic-matching`、对应 `tests/topic-matching`/fixture 与 D10 文档路径；D01 DDL/FTS、D02/Prompt、D03/D07/D09、D04～D08 算法、CI/package/lock 零未批准 diff。

Lead 提交 `D10_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 依持续授权独立复核干净快照、push 已批准 main SHA 并等待精确 SHA CI Success；Lead 不 push、不签发最终 PASS。只有 Architect 独立 Gate 与精确 pushed SHA CI 全部通过后，才可签发 `D10_FINAL_PASS`。

本 Plan 不创建心跳。若 G3 批准并明确启动开发，由 Architect 依项目规范创建唯一 D10 推进心跳并在 `progress.md` 记录准确 ID；Lead 不自行创建。最终验收后由 Architect 核对并归档 Worker/Workspace、删除准确心跳并复查，主工作区与共享角色工作区不归档。

## 10. 风险、回滚与停止条件

- **G3 门禁**：Intent/Spec 已批准，但本 Plan 仍待 Architect G3；未批准不派发 Worker、不写生产代码、不创建 candidate/merge/push。
- **固定基线**：首个执行 base 必须是批准 Plan/Progress 后的精确文档提交；T02～T04 分别固定前卡 merge SHA。不得以浮动 `main` 或 branch 名替代。
- **D02 漂移**：P-05 strict Schema、引用校验或首次顺序去重若与只读结论不符，立即 `BLOCKED`；不得在 D10 修补或复制 validator。
- **D03 漂移**：`listEnabled()` 必须仍是 enabled=1 + BINARY 顺序；若不符交 Architect 处理，不在 D10 写替代 Topic SQL。
- **快照语义**：Topic 在 P-05 调用前读取后，本次 references、task data 和 persistence 顺序均只使用该快照；禁用/修改不回滚本次合法关联。不得在事务内重读 enabled 并拒绝。
- **事务边界**：任何 LLM、网络、Prompt、logger 或异步操作进入写事务；或 callback 返回 thenable；或 insert/readback 失败未触发全回滚，均判 BLOCKER。
- **多态目标**：DDL 不提供 `(target_type,target_id)` 物理外键；必须在事务内重验目标，测试不得把直接 SQL dangling 行当成会被数据库拒绝。
- **复用语义**：Published Item 优先于 Association；两个分支都不调用 P-05。已有 Association 即使 Topic 后续禁用也返回 true，不得删除历史。
- **发布范围**：D10 只返回发布资格；创建 Published Item、派发任务、Runtime、RSS 属后续里程碑。任何提前实现均判越界。
- **隐私**：只使用临时合成 Prompt/User Context sentinel；真实 `config/prompts`、`config/prompt/user-context.md`、API Key、Token、正文或模型原文不得读取、记录或提交。
- **回滚**：每卡 candidate 以固定 base 单一 parent，必要时 revert merge commit；不得 reset 主线、覆盖其他里程碑或修改已批准上游来“修测试”。
- 同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分、Plan 或 Spec 根因；涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 只把已批准 D10 Intent/Spec 映射为四张严格串行、文件级可执行任务卡，没有新增公共字段、DDL、Prompt、依赖、Worker 或替代任务 ID。
- T01～T04 均列出精确允许写集、固定 base 规则、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive evidence key。
- D02 独占 P-05 strict Schema/JSON/引用校验/首次顺序去重；D03 `listEnabled()` 独占 enabled + BINARY 快照；D01 `withTransaction()` 独占同步短事务；D10 只编排和持久化 Association。
- `EVENT_UPDATE` 只带本次进展与父 Event 五基础字段；不加载历史 Update，不继承父 Event 关联。
- `TOP-01/02` 的 PublishTask 派发、D11 Published Item、D12 RSS、Runtime/queue/retry 均明确排除；`PMT-06` 保持 S0，不用 Stub 冒充。
- 当前结论：`D10_PLAN=G3_PENDING_ARCHITECT_REVIEW`。G3 复核通过前任务状态保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push 或最终验收。
