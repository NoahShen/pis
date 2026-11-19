# D09 Spec：Event Analysis / 新主线、进展与重复证据

- 状态：`APPROVED · G2`
- 版本：v0.1
- Intent：`docs/milestones/D09/intent.md`（G1 已批准）。
- 实现基线：D08 最终 PASS，D08 closeout `2ab5de8`；当前设计基线 `2484b287`。

## 1. 公共契约

```ts
type EventTargetType = "EVENT" | "EVENT_UPDATE";

interface EventAnalysisTarget {
  target_type: EventTargetType;
  target_id: string;
}

interface EventAnalysisResult {
  new_targets: EventAnalysisTarget[];
}

interface EventAnalysisOptions { readonly signal?: AbortSignal }

interface EventAnalysisService {
  analyze(contentId: string, options?: EventAnalysisOptions): Promise<EventAnalysisResult>;
}

function createEventAnalysis(dependencies: EventAnalysisDependencies): EventAnalysisService;
```

依赖显式包含：Database、只读 ContentRepository、D08 `EventSearchService`、仅 `analyzeEvents` 的 typed calls、EventPersistence/Repository、Clock、IdGenerator、logger。

- D08 实例由调用方构造并注入；D09 可通过同一实例配置 `maxCandidates/maxUpdates`，不在 D09 复制配置。
- 返回目标按 P-03 results 中首次出现的顺序，目标类型 + ID 去重；NO_INCREMENT 和复用 Update 不返回。
- `new_targets` 是 D09 与后续 Runtime 的交接，不在本里程碑自动派发。

## 2. 执行顺序

1. 非字符串或纯空白 Content ID → `invalid_input`，任何 DB/LLM 前。
2. pre-abort → `aborted`，零 DB/LLM。
3. 调用注入的 D08 `search(contentId,{signal})`：Content 缺失、P-02 空 clues 均由 D08 返回 `{candidates:[]}`。
4. **区分两种空候选**：
   - Content 缺失或 P-02 `clues=[]`：D09 不调用 P-03，返回空目标。
   - 有 clues 但无候选：仍调用 P-03。

   为使 D09 不重复调用 P-02 或猜测原因，D08 需在**不破坏现有公共返回**的前提下提供内部状态扩展：`EventSearchResult` 增加可选只读元数据 `reason?: "missing_content" | "empty_clues" | "no_candidates" | "candidates"`。既有候选路径不变；D09 只消费该元数据。该扩展属于 D08 小幅受控修订，需在 T01 同步完成并补回归，不能靠再次 P-02 区分。
5. P-03 task data 固定：
   ```ts
   {
     content: { title, body, summary, author, published_at, completeness },
     candidates: EventCandidate[]
   }
   ```
   不注入 clues、User Context、Topics、Knowledge、raw_data 或额外 Update。
6. 事务外恰好一次 `analyzeEvents(taskData,references,{signal})`；references 由 D08 候选构造：
   ```ts
   {
     candidateEventIds: candidates.map(c => c.id),
     eventIdByUpdateId: Object.fromEntries(
       candidates.flatMap(c => c.updates.map(u => [u.id,c.id]))
     )
   }
   ```
7. D02 负责严格 Schema、候选引用、Update 归属、冲突 Action 和 confirmed_aliases 首次顺序去重。D09 不复制第二份 Zod/JSON Schema。
8. `results=[]` → 空目标，零写。
9. 一个同步短事务持久化全部 results、证据、别名及受影响 FTS；读回验证后 COMMIT。
10. COMMIT 后返回新目标；失败映射稳定错误，不返回部分成功。

## 3. P-03 调用与取消

- pre-abort 零 P-03；调用中 AbortError/ABORT_ERR/LLM_CANCELLED、返回后取消均 `aborted`。
- 非取消 Prompt/模型/JSON/D02 校验错误 → `llm_failed`。
- D08 的错误需在 D09 边界转换为 D09 四码：invalid/aborted 保持；D08 `llm_failed` → D09 `llm_failed`；D08 `event_search_failed` → D09 `event_analysis_failed`。
- 不得把 D08/D02 的 cause、SQL、Zod issues、Prompt、正文、模型原文或 Token 向外暴露。

## 4. 持久化契约

### 4.1 NEW_EVENT

- `IdGenerator.next()` 生成 Event ID；模型提供的任何 ID 均被 D02 strict Schema 拒绝。
- Event 字段来自模型：`title/entity.name/subject/scope/description/occurred_at`。
- `discovered_at=formatTimestamp(clock.now())`；`occurred_at` 缺省/null 写 SQL NULL。
- 插入 `(EVENT,eventId,contentId)` 证据。
- 不创建 Event Update。
- 返回 `{target_type:"EVENT",target_id:eventId}`。

### 4.2 NEW_UPDATE

- 事务内按 event_id 读取并验证候选 Event 仍存在。
- 先按以下现有关系查找复用：
  ```sql
  SELECT u.*
  FROM event_updates u
  JOIN event_content_links l
    ON l.target_type='EVENT_UPDATE' AND l.target_id=u.id
  WHERE u.event_id=? AND l.content_id=?
  ORDER BY u.discovered_at ASC,u.id ASC
  ```
- 已有则复用该 Update，确保本 Content 证据存在，不新建 Update、不返回新目标。
- 没有则生成 Update ID，字段来自模型，`discovered_at` 使用同一 Clock；插入 Update 与证据并返回新目标。
- 同一 Content 同 Event 重复执行只复用，不覆盖原 Update 文本。
- 新的事实修正/矛盾声明由 P-03 决定 NEW_UPDATE，程序不改写旧 Update。

### 4.3 NO_INCREMENT

- 事务内重新验证 Event；`event_update_id` 非空时验证 Update 存在且 `event_id` 相符。
- 有 Update ID：仅插入/复用 `(EVENT_UPDATE,updateId,contentId)` 证据。
- 无 Update ID：仅插入/复用 `(EVENT,eventId,contentId)` 证据。
- 不创建 Update，不返回新目标。

### 4.4 confirmed_aliases

- 对当前 result 对应的 Event 保存每个 alias；D02 已做首次顺序去重，数据库 `(event_id,alias)` 再做约束去重。
- 保存 `content_id` 为当前 Content；已有别名不覆盖旧证据。
- 别名插入或已存在均不创造新目标。
- 不 trim 后另存不同形式、不自动吸收 P-02 search_terms、不做 source_excerpt 或第二次 LLM 审核。
- 只有实际新增别名时才把 Event 加入 FTS 受影响集合；重复别名无变化。

### 4.5 FTS

- NEW_EVENT、实际新增 Update、实际新增别名会影响 FTS。
- NO_INCREMENT 仅新增证据不影响 FTS 文本，不额外刷新。
- 对受影响 Event ID 去重后按 ID BINARY ASC 调用 D01 `refreshEventSearch(db,eventId)`；该函数加入调用方事务。
- 事务失败时 Event/Update/证据/别名/FTS 全部回滚。
- 不调用全量 rebuild 作为正常写入路径；EVT-18 的重建一致性用 D01 rebuild 工具验证。

## 5. 原子性与读回

- 使用 D01 `withTransaction()`，回调同步；thenable 必须被拒绝。
- 事务内逐 result 执行并读回：Event/Update、证据、别名和 FTS 受影响行。
- 任一结果失败，之前结果也回滚，不返回部分 `new_targets`。
- 不在事务内调用 LLM、网络、异步 logger、IdGenerator 之外的异步服务；Clock 仅同步 now()。
- `event_content_links` 允许同一 Content 同时关联 Event 与 Update，不做业务级唯一限制。
- 不新增表、列、索引、状态字段或 outbox。

## 6. 错误与日志

| code | 固定 message | 边界 |
|---|---|---|
| `invalid_input` | `Invalid event analysis input` | 非法 Content ID |
| `aborted` | `Event analysis was aborted` | pre-abort、LLM/读取/提交阶段取消 |
| `event_analysis_failed` | `Event analysis operation failed` | D08 检索、DB、持久化、FTS 失败 |
| `llm_failed` | `Event analysis LLM call failed` | P-02/P-03、Prompt、JSON、Schema、引用/冲突 |

logger 白名单：`contentId`、`candidateCount`、`resultCount`、`newTargetCount`、`stage`、`reason`；stage 仅 `check|search|analyze|persist`。不记录正文、clues、候选标题、Event/Update ID、别名、SQL、Prompt 或模型输出。best-effort，自身失败不改变业务结果。

## 7. 测试矩阵

| Case | 必须证明 |
|---|---|
| `EVT-01` | NEW_EVENT 一 Event 一证据，零初始 Update，新目标 EVENT |
| `EVT-02` | NEW_UPDATE 新进展与证据，目标 EVENT_UPDATE |
| `EVT-03` | NO_INCREMENT 指定 Update 只增该证据，零新 Update/目标 |
| `EVT-04` | NO_INCREMENT null Update 只关联 Event |
| `EVT-05` | results=[] 零写零目标 |
| `EVT-07` | 同篇 NEW_UPDATE + NEW_EVENT 一个事务，两目标，COMMIT 后返回 |
| `EVT-08/09` | 一条 NEW_UPDATE 合法保存；不拆两条，不改旧事实 |
| `EVT-12/13` | 新别名含当前 Content 证据、去重、FTS 同事务；NO_INCREMENT 无新目标 |
| `EVT-14` | P-02 推测词不落别名；P-03 confirmed_aliases=[] 时零别名 |
| `EVT-15` | 候选外 Event、错归属 Update、冲突 Action 在写事务前由 D02 拒绝 |
| `EVT-16` | 多结果中途 DB/FTS 失败，所有表和 FTS 全回滚 |
| `EVT-17` | 同 Content 同 Event NEW_UPDATE 重放复用，不新增、不返回目标 |
| `EVT-18` | 新 Update/别名后 FTS 一行；旧文本和新别名可召回；全量重建一致 |
| `EVT-21` | P-02 空 clues → 不调 P-03、零写 |
| `EVT-22` | 有 clues 无候选 → 仍调 P-03，可 NEW_EVENT |
| `EVT-23` | D08 全历史召回但 P-03 只见配置窗口内 Update |
| `EVT-24` | 同 alias 不同 Event 独立；新增别名只影响指定 Event |
| `PMT-14/15` | 自造 ID、缺字段、额外字段、非法 enum/类型严格拒绝 |
| `ATOMIC` | 事务内无 LLM/HTTP；FTS/证据/别名同事务；thenable 拒绝 |
| `PRIVACY` | P-03 无 User Context；日志/错误无正文/Prompt/Token/模型原文 |

## 8. 冻结边界

除 §2.4 的 D08 可选只读元数据扩展外，不得修改 D01 DDL/FTS 实现、D02 LLM/Prompt、D04 Adapter、D05 Collection、D06 Processing、D07 Knowledge、D08 检索/排序/Update 窗口算法、配置 API、app/server/lifecycle、CI、package/lock、真实 Prompt/User Context。

不新增依赖、第二次 P-03、向量、历史摘要、语义去重、任务状态或队列。

## 9. Gate

- 每卡 Worker REVIEW → Lead 独立复核和精确冻结 → Architect G4 → candidate → merge → 合并后验证 → 归档。
- 冻结 tree、patch SHA、验证数字与交回报告必须同一回复；否则退回流程重做。
- 最终 PASS 同时要求 Architect 独立干净快照 Gate 与精确 pushed SHA 远程 CI Success。
- `EVT-19/20`、`PMT-03/04` 为 S0 真实模型语义回归，不纳入 D09 P0 Gate。
