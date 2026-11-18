# D08 Spec：Event Search / 历史 Event 候选召回

- 状态：`DRAFT · G1_PENDING_OWNER_APPROVAL`
- 版本：v0.1
- Intent：`docs/milestones/D08/intent.md`（G1 待负责人批准）。
- 实现基线：D07 最终 PASS，main `09640c3`。

## 1. 公共契约

```ts
interface EventSearchOptions { readonly signal?: AbortSignal }

interface EventSearchResult {
  candidates: EventCandidate[];
}

interface EventSearchService {
  search(contentId: string, options?: EventSearchOptions): Promise<EventSearchResult>;
}

function createEventSearch(
  dependencies: EventSearchDependencies,
): EventSearchService;
```

依赖显式包含：Database、只读 ContentRepository、EventCandidateRepository、仅 `searchEvents` 的 typed calls、logger；不需要 Clock 或 IdGenerator，因为本服务不创建任何业务记录。

候选 DTO：

```ts
interface EventCandidate {
  id: string;
  title: string;
  entity_name: string;
  subject: string;
  scope: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
  updates: EventCandidateUpdate[];
}

interface EventCandidateUpdate {
  id: string;
  event_id: string;
  title: string;
  description: string;
  occurred_at: string | null;
  discovered_at: string;
}
```

- `updates.length <= 10`。
- 对外不暴露 clues、FTS 查询、SQL、bm25 分数或内部排序依据。
- Content 缺失与合法空 clues 都返回 `{candidates: []}`。
- 候选为空同样是成功结果。

## 2. 执行顺序

1. 非字符串或纯空白 Content ID → `invalid_input`，任何 DB/LLM 之前。
2. pre-abort → `aborted`，零 DB、零 LLM。
3. 只点读当前 Content 一次；缺失返回空结果。
4. 显式投影六字段，禁止对象 spread：`title/body/summary/author/published_at/completeness`。
5. 事务外恰好一次 `searchEvents`；pre-abort 零调用，取消优先 `aborted`。
6. D02 严格校验 P-02 输出；非法 JSON、缺字段、额外字段、错误类型映射 `llm_failed`。
7. `clues=[]` → 空结果，候选 Repository 调用次数为 0。
8. 对每个 clue 独立执行候选检索，跨 clue、跨检索来源按 Event ID 去重。
9. 确定性排序、截断，再为每个入选候选读取基本资料和最近 10 条 Update。
10. 返回候选 DTO；不写任何业务数据。

## 3. 检索契约

### 3.1 输入线索

每个 clue 固定为：

```ts
{ entity_name: string; subject: string; search_terms: string[] }
```

- 原样用于本次检索，不持久化、不自动注册别名。
- 不合并 entity_name 相同但 subject 不同的 clue。
- 完全相同的 clue 可按稳定序列化去重，减少重复 SQL；不同 clue 的结果仍按 Event ID 合并。
- 不将空字符串变成 FTS 通配查询；空/纯空白检索词跳过。

### 3.2 三路只读召回

1. **Event 标准名**：`events.entity_name` 与 clue.entity_name 做精确、区分大小写的匹配。
2. **已确认别名**：`event_entity_aliases.alias` 与 clue.entity_name 做精确、区分大小写的匹配。
3. **FTS5**：用 clue 的 `entity_name`、`subject` 和每个 `search_terms` 分别查询 `event_search MATCH ?`。

FTS 查询使用**参数绑定的短语字面量**：把每个检索词作为独立双引号短语，内部双引号替换为两个双引号；不拼接用户 SQL，不把空格拆成 OR，不注入 `*`、`NEAR`、列过滤或操作符。这样保持 trigram 子串语义，同时避免标点导致 FTS 语法错误。

- 每个检索词独立查询，任一命中即把 Event 加入该 clue 的候选来源集合。
- 不自行刷新或重建 FTS；D01 已提供 Event 写入时的同步刷新与重建工具。
- 候选必须仍能读回 Event；派生索引中的悬空 ID 忽略并记录安全日志，不创建业务实体。

### 3.3 去重、排序、上限

- 同一 Event 无论被多少 clue/索引命中，只保留一个候选。
- 保存内部命中证据：直接实体命中、别名命中、FTS 命中次数与首次出现的 clue 序号，仅用于确定性排序，不对外暴露。
- 排序依次：
  1. 直接实体或别名命中的候选优先于仅 FTS 命中；
  2. 命中不同 clue 数多者优先；
  3. FTS 命中检索词数多者优先；
  4. Event `discovered_at DESC`；
  5. Event `id ASC` 最终决胜。
- 时间只用于第 4 级排序，不用于过滤旧 Event。
- 默认 `maxCandidates=10`，依赖注入可配置整数 `1..50`；生产默认 10。只对去重后的 Event 集合截断，不限制 SQL 检索的历史范围。
- 该规则是 D08 的确定性实现定案，不引入第二次 LLM、向量、bm25 语义分数或新依赖。

## 4. 最近 10 条 Update

对每个入选候选：

- SQL 取数按 `discovered_at DESC, id DESC`，`LIMIT 10`。
- DTO 输出将结果反转为旧→新；因此输出中最新一条在最后。
- `occurred_at` 原样可空，不造值。
- 同一 discovered_at 必须按 ID 决胜，不能依赖 SQLite 自然顺序。
- 不加载第 11 条及更早 Update 到 DTO，但它们已通过 D01 聚合 FTS 参与召回。

## 5. 错误、取消与日志

| code | 固定 message | 边界 |
|---|---|---|
| `invalid_input` | `Invalid event search input` | 非法 Content ID |
| `aborted` | `Event search was aborted` | pre-abort、LLM 中/返回后取消、读取阶段取消 |
| `event_search_failed` | `Event search operation failed` | Content/候选/Update 点读、FTS/SQLite 失败 |
| `llm_failed` | `Event search LLM call failed` | Prompt、模型、JSON、D02 Schema 失败 |

- 公共 Error 不保留 cause、SQL、Zod issues、模型输出、Prompt、正文或 Token。
- logger 白名单：`contentId`、`candidateCount`、`clueCount`、`stage`、`reason`；stage 仅 `check|extract|search|context`。
- logger best-effort，自身失败不改变结果；不记录正文、检索词、候选标题、模型输出或 Prompt。
- LLM 调用与所有读取均在写事务外；本服务从不开启写事务。

## 6. 只读与隐私证明

1. 对 `events`、`event_updates`、`event_entity_aliases`、`event_content_links`、`contents`、`knowledge`、`topics`、`topic_associations`、`published_items` 前后做快照，调用后逐字节/逐字段不变。
2. `event_search` 调用前后不变。
3. `globalThis.fetch` 与 Adapter spy 零调用。
4. StubLLM 捕获请求证明：只有 P-02 被调用一次，system 为合成 event-search 指令，user 只含 task_data；`user_context` 不存在。
5. task_data 精确六字段；Content ID、raw_data、Topic、历史 Event、Knowledge、Token sentinel 不出现。
6. 不读取真实 `config/prompts`、真实 `config/prompt/user-context.md`、真实模型或 API Key。

## 7. 测试矩阵

| Case | 必须证明 |
|---|---|
| `EVT-06` | 同实体两个 Subject 分别检索；两个不同 Event 不被主体相同合并 |
| `EVT-10` | 10 年前 Event 仍由标准名/确认别名/FTS 召回 |
| `EVT-11` | 12 条 Update 只输出 10 条；同 discovered_at 按 id DESC 取数，DTO 旧→新 |
| `EVT-21` | clues=[] 返回空；Repository 零调用、LLM 恰一次、零业务写 |
| `EVT-22` | 有 clues 但无候选返回空成功；不虚构 Event、不写库 |
| `EVT-23` | 线索只在第 11 条以前 Update 仍经 FTS 召回；DTO 仅最近 10 条 |
| `EVT-24` | 两个 Event 同别名文字均独立召回，各自 Update 不混淆 |
| `DEDUPE` | 同 Event 被标准名、别名、多 search_terms、多 clue 命中仍只输出一次 |
| `LIMIT` | 超过上限的候选按 §3.3 稳定截断；检索覆盖全历史 |
| `FTS_LITERAL` | 引号、括号、冒号、星号、NEAR、SQL 样式文本不造成语法错误或注入 |
| `MISSING/INVALID/ABORT` | 缺失空结果；非法 ID 在 DB 前拒绝；pre-abort 零 DB/LLM |
| `ERROR` | DB 失败映射 event_search_failed；LLM/Schema 失败映射 llm_failed；错误不透底 |
| `PRIVACY` | P-02 无 User Context；日志与 task_data 无禁止 sentinel |

## 8. 四卡建议

1. T01 Content 点读、P-02 六字段输入与单次调用/错误/取消。
2. T02 三路候选 Repository、FTS 字面量、安全只读与跨来源去重。
3. T03 确定性排序、上限、最近 10 条 Update 与候选上下文。
4. T04 公共 factory/contracts/index、真实 SQLite + StubLLM + 合成 Prompt 集成。

四卡串行，Worker 不修改已批准上游。若接口缺陷暴露，由 Lead 重走受影响任务卡。

## 9. 冻结边界

不得修改：D01 DDL/FTS 刷新实现、D02 LLM/Prompt、D04 Adapter、D05 Collection、D06 Processing、D07 Knowledge、配置 API、app/server/lifecycle、CI、package/lock、真实 Prompt/User Context。

不新增表、列、索引、依赖、第二次模型调用或语义评分器。

## 10. Gate

- 每卡 Worker REVIEW → Lead 独立复核和精确冻结 → Architect G4 → candidate → merge → 合并后验证 → 归档。
- 冻结与交回报告必须在同一次 Lead 回复中给出；否则退回流程重做。
- D07 报告的 RSS 时序失败保留为观察项；若复现，按 D05 先例单独处理，不弱化断言。
- 最终 PASS 同时要求 Architect 独立干净快照 Gate 与精确 pushed SHA 远程 CI Success。
- `PMT-02` 为 S0 真实模型语义回归，不纳入 D08 P0 Gate；不得用 Stub 冒充。
