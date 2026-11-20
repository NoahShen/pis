# D11 Plan：Published Item 与模板

> 版本：v0.1
> 状态：`G3_PENDING_ARCHITECT_REVIEW`
> 日期：2026-11-20
> 计划基线：main `5d95f8b6eb3e7beff89e3f52498c3b7de203feb1` / tree `e71bad95094e39b1be6b87443267349627a0509b`
> Intent：`docs/milestones/D11/intent.md`（`APPROVED · G1`）
> Spec：`docs/milestones/D11/spec.md`（`APPROVED · G2`）

本文只把已批准的 D11 Intent/Spec 映射为四张文件级、严格串行的任务卡。当前只交付 `plan.md` 与 `progress.md`；**不创建 Worker、心跳、candidate、merge 或生产代码**。Plan 未获 Architect G3 批准前，四卡保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换宿主默认运行时或安装替代版本。

## 1. 目标、公共契约与不可变更边界

D11 交付从已匹配 Topic 的 `EVENT`、`EVENT_UPDATE`、`KNOWLEDGE` 目标生成不可变 Published Item 快照的纯模板发布模块。V1 完全不调用 LLM，不引入 completion client、Prompt、模型输出或私有 User Context。

公共契约固定为：

```ts
import type { TopicTargetType } from "../topic-matching/contracts.js";

export type PublicationTargetType = TopicTargetType;

export interface PublishResult {
  readonly published_item_id: string | null;
  readonly already_published: boolean;
}

export interface PublicationService {
  publish(
    targetType: PublicationTargetType,
    targetId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PublishResult>;
}
```

- `PublicationTargetType` 必须复用 D10 `TopicTargetType`，不得另造第二套字符串联合。
- D11 **成功返回对象**比 D15 `StageServices.publish` 的 `{ published_item_id: string }` 多一个只读布尔字段，按对象结构可被 D15 成功结果形状吸收；但 D11 全量返回允许正常空结果的 `published_item_id:null`，所以完整 `PublicationService.publish()` 返回类型不能直接赋给当前 D15 `StageServices.publish()`。D11 不修改也不接线 D15，G3 必须确认“结构兼容”仅指成功对象形状，或在 D11 范围外另行批准 Runtime 适配。
- 目标缺失或无 Topic Association 返回 `{published_item_id:null, already_published:false}`，是正常空结果，不抛业务错误。
- 已存在 Published Item 返回原 ID 和 `already_published:true`；不得重新读取渲染上下文、来源链接或调用 renderer。
- 稳定错误仅 `invalid_input | aborted | publication_failed`，固定安全 message，无 cause，不携带正文、标题原文、URL、SQL 或底层异常。
- 最终模块入口 `src/publication/index.ts` 的运行时代码导出**仅** `createPublication` 与 `PublicationError`；其余公共类型只以 `export type` 暴露。

不可变更边界：

- 不修改 D01 DDL/schema、D02 LLM、D03～D10、D15 任何生产代码；不修改 `src/database`、`src/time`、`src/id` 的既有实现。
- 不新增表，不修改表约束，不新增依赖，不修改 `package.json`/`package-lock.json`、CI、app/server/lifecycle、配置 API。
- 不实现 RSS XML、归档、云端上传、HTTP API 或 Runtime 接线；不实现 LLM Renderer、Prompt 或 Prompt 文件读取。
- 不读取真实私有 `config/prompts/*.md`、`config/prompt/user-context.md`、API Key 或 Token；测试只用合成 sentinel。
- DTO 不包含 `raw_data`、User Context、历史 Updates、父 Event 的完整 description/历史关联或其他未批准字段。
- 不使用 `any`、`@ts-ignore`、`@ts-expect-error`、`SELECT *`、替换式 upsert 或对已发布快照的 update/delete。
- 渲染器是纯函数：无 I/O、DB、LLM、时钟、随机或环境读取；来源链接与渲染必须在事务外完成，写事务内零网络、零异步。

## 2. 上游只读核对结论与文件布局

### 2.1 上游只读核对结论

- `src/database/schema.sql`：`published_items` 绑定 `id,target_type,target_id,title,summary,body,published_at`，禁止空白 `body`，并有 `UNIQUE(target_type,target_id)`；SQLite 不提供多态目标外键，目标存在性必须由发布服务校验。
- `event_content_links` 以 `(target_type,target_id,content_id)` 为联合主键，只允许 `EVENT`/`EVENT_UPDATE`；`EVENT_UPDATE` 可独立持有自身证据，不能查询父 Event 的证据代替。
- `source_items.content_id` 有部分唯一索引；每个 Content 最多一个 Source Item。`source_items.url` 可空，`contents.url` 可空，来源 URL 必须逐行优先取非空白 Source Item URL，否则取 Content URL。
- `knowledge.content_id` 唯一；Knowledge 来源从 `knowledge.content_id → contents → source_items` 读取，不读取 `raw_data`。
- `topic_associations` 的联合主键允许同一目标有多个 Topic，但 `topic_associations(target_type,target_id)` 索引支持“至少一条”资格检查；发布只检查关联是否存在，不检查 Topic 当前 enabled。
- `src/topic-matching/contracts.ts`：`TopicTargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE"`；D11 必须复用该类型。
- `src/topic-matching/topic-matching-target-repository.ts`：现有 DTO 已证明 Event/Update/Knowledge 的 SQL 字段与 findings JSON 校验方式可复用；D11 新建自己的 PublicationContext DTO，只包含 Spec §2 字段，不修改 D10 文件。
- `src/database/transaction.ts`：`withTransaction()` 使用同步 `BEGIN IMMEDIATE`，拒绝 async function 与 thenable 返回值；D11 只能用其包裹同步复检、时钟/ID 和插入。
- `src/time/*`、`src/id/*`：发布使用注入 `Clock`，仅在事务内成功写入路径调用一次 `now()`；使用注入 `IdGenerator.next()` 一次，并以 `formatTimestamp()` 存储 `+08:00` ISO 时间。
- `src/runtime/contracts.ts`：D15 的 `PublishResult.published_item_id` 为非空 `string`；D11 新增只读 `already_published` 的成功对象可按多余属性规则赋给该成功结果形状，但 D11 的 `string | null` 全量返回与 D15 服务签名存在静态类型差异。D11 不修改 D15，且本轮不做 Runtime 接线；该差异登记为 G3 契约确认项。
- 当前 `src/publication/` 与 `tests/publication/` 不存在；D11 只新增该范围及 `tests/fixtures/publication.ts`。

未发现已批准 D11 Spec 与 D01 schema、D10 target DTO、D15 Runtime 契约之间的实现冲突。若 Worker 在执行时发现实际行为偏离以上只读结论，立即 `BLOCKED`，不得修补上游或复制第二套规则。

### 2.2 模块职责与文件布局

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/publication/contracts.ts` | Target/Result/Service、三类 Context、Draft、Repository、Notifier、Logger 依赖契约 | T01/T02/T03 |
| `src/publication/html.ts` | `escapeHtml()` / `escapeAttribute()` | T01 |
| `src/publication/template-renderer.ts` | `TemplatePublicationRenderer` 与三类纯模板 | T01 |
| `src/publication/source-links.ts` | URL 规范化、过滤去重、来源小节追加 | T02 |
| `src/publication/source-link-repository.ts` | 按目标读取已存 Source Item/Content URL | T02 |
| `src/publication/publication-target-repository.ts` | 目标 Context 与 Topic 资格 SQL | T03 |
| `src/publication/published-item-repository.ts` | 不可变快照查询、事务内插入、Feed 只读列举 | T03 |
| `src/publication/publication-errors.ts` | 稳定 `PublicationError` | T03 |
| `src/publication/publication-logger.ts` | 白名单 best-effort 日志 | T03/T04 |
| `src/publication/publication.ts` | 发布门槛、短事务保存、复检、通知、`createPublication()` | T03/T04 |
| `src/publication/index.ts` | 最终公共导出边界 | T04 |
| `tests/fixtures/publication.ts` | 合成 DTO、真实 SQLite seed、snapshot、故障注入与 notifier | T01～T04 |
| `tests/publication/*.test.ts` | 纯函数、Repository、服务、事务、不可变性与真实 SQLite 集成 | 各卡 |

### 2.3 内部不变量

- 发布流程固定为：输入/pre-abort 校验 → 已发布快速返回 → 目标与 Topic 资格检查 → 来源 URL 读取 → renderer → 来源追加与文本校验 → 同步短事务内复检/写入 → COMMIT 后通知。
- 目标缺失和无 Topic Association 均返回空结果；不得转成 `target_not_found`、不得写失败记录。
- `(target_type,target_id)` 唯一，多 Topic 只产生一份快照；重复/并发执行只复用原快照。
- Published Item 没有 update/delete 路径；重复发布不得调用 renderer、来源链接读取或时钟/ID。
- 来源 URL 只来自 Repository 返回的已存证据；公式、描述、Findings、Topic 与模型字段都不得生成 URL。
- `EVENT_UPDATE` 来源 SQL 只查自身 `target_type='EVENT_UPDATE'`，禁止回退到父 Event。
- 无来源链接仍发布；有链接时只追加合法、去重、稳定排序、最多 `maxSourceLinks` 条的 `<section>`。
- `title`、`summary` 是纯文本语义；`body` 是程序生成的受限安全 HTML，全部内容值经转义，标签仅 `h2/h3/p/ul/li/section/a(href)`。
- 通知只在实际插入并 COMMIT 后调用；同步抛错和异步拒绝都被吞掉并记录，不改变快照、结果或事务状态。
- 日志只允许 `targetType,targetId,stage,reason,sourceLinkCount,publishedItemId,durationMs`，不记录正文、标题原文、URL、SQL、Prompt、模型输出或 Topic 名称。

## 3. 四卡串行、能力边界与 Case 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | PublicationContext/Draft DTO、HTML 转义、三类模板 renderer | 无 SQL、来源链接、服务、事务、通知、Published Item |
| T02 合并后 | 三类目标的证据 URL 读取、规范化、去重、来源章节 | 无发布门槛、目标 Context、写事务、通知、公共工厂 |
| T03 合并后 | 目标 Context/Topic 资格、基础发布服务、唯一短事务、重复复用 | 无提交后通知、无事务内目标/关联复检注入证明、无完整真实 SQLite 三目标矩阵 |
| T04 合并后 | 不可变性、事务内复检、COMMIT 后通知、公共入口、真实 SQLite P0 集成 | 无 RSS/归档/云端/API/Runtime 接线；无 LLM Renderer；PUB-11 仍为 P1 |

四卡严格串行。每卡使用全新 Paseo Worker、独立 worktree，不跨卡并行；Worker 不 stage/commit/amend/merge/push，只交 `REVIEW`/`BLOCKED`。每卡 base = **前一卡 merge 后更新的 D11 docs record commit（main HEAD）**，不是前一卡 merge SHA，也不是浮动分支名。

| Case | 主责任卡 | D11 必测断言 |
|---|---|---|
| `PUB-01` | T01/T04 | 三类目标各自生成 title/summary/body 并落库；无 completion client/LLM import |
| `PUB-02` | T03/T04 | 目标存在但零 Topic Association → null 结果，零 Published Item |
| `PUB-03` | T03/T04 | 不存在目标/非法 type → 空结果或 `invalid_input`，零悬空快照 |
| `PUB-04` | T03/T04 | 同目标两个 Association → 仅一条快照 |
| `PUB-05` | T03/T04 | 重复/并发执行 → UNIQUE + 事务复检，返回原 ID，不重复渲染 |
| `PUB-06` | T02/T04 | 重复合法 http(s) URL 去重并成为可点击真实链接 |
| `PUB-07` | T02/T04 | 无来源 URL 正常发布，无占位链接/空来源小节 |
| `PUB-08` | T02/T04 | javascript/data/file、userinfo、空串、控制字符被过滤且不阻断发布 |
| `PUB-09` | T04 | 发布后补证据/改 Topic/建 Update，原快照逐字节不变 |
| `PUB-10` | T01/T03/T04 | 缺 title/summary、空白 body → 事务前 `publication_failed`，零写入 |
| `PUB-11` | T04（P1） | 外部检查后目标/关联撤销 → 事务内复检为空，零插入；结构性注入证明 |
| `PUB-12` | T03/T04 | 已发布后改字段/补证据/加 Topic，重复任务不重新渲染，快照逐字节一致 |
| `PUB-13` | T01/T02/T04 | Content HTML/JS 仅作为转义文本；URL 只来自已存证据 |
| `DB-13` | T03/T04 | SQLite 多态无 FK；业务服务拒绝不存在目标，无部分记录；不把直接 SQL 误写成 FK 拦截 |

## 4. D11-T01 · Context/Draft DTO、HTML 安全与三类纯模板

### 4.1 依赖与精确允许写集

- 前置：D11 Plan 已获 G3 批准并明确启动 T01；base 固定为包含 G3 批准结论的精确文档提交 SHA。
- 新增且仅允许写：`src/publication/contracts.ts`。
- 新增且仅允许写：`src/publication/html.ts`。
- 新增且仅允许写：`src/publication/template-renderer.ts`。
- 新增且仅允许写：`tests/fixtures/publication.ts`。
- 新增且仅允许写：`tests/publication/html-security.test.ts`。
- 新增且仅允许写：`tests/publication/template-renderer.test.ts`。
- 只读复用：D10 `TopicTargetType` 及现有 target DTO 形状、测试 FakeClock/SequenceId 的构造思路。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1（目标类型别名、DTO 边界）、§2、§3；Intent §4；`PUB-01`（模板部分）、`PUB-10`（草稿语义）、`PUB-13`（HTML 安全基础）。

### 4.2 禁止范围

- 不得新增 Repository、发布服务、SQLite SQL、事务、通知、日志实现或 `index.ts`。
- 不得 import LLM、Prompt、HTTP、数据库、时钟、随机或环境配置；模板文件不得有 I/O。
- 不得读取 `raw_data`，不得把历史 Updates、父 Event description 或 User Context 加进 DTO。
- 不得输出 `h1/h4/div/span/img/script/style` 等未批准标签；不得直接拼接未转义的内容值。
- 不得用 `escapeHtml()` 代替纯文本 title/summary 转义值本身；title/summary 保持纯文本，body 才生成安全 HTML。
- 不得修改 D01～D10/D15、配置、CI、package/lock、Prompt。

### 4.3 实现要求

1. `contracts.ts` 精确声明 Spec §2 的 `PublicationContext` 判别联合、`PublicationEvent`、`PublicationEventSummary`、`PublicationUpdate`、`PublicationKnowledge`、`PublicationDraft`、`PublicationRenderer`；`PublicationTargetType` 复用 `TopicTargetType` 别名。
2. Event DTO 精确字段为 `id,title,entityName,subject,scope,description`；Update DTO 精确 `id,eventId,title,description`；父 Event summary 精确 `id,title,entityName,subject,scope`；Knowledge DTO 精确 `id,title,summary,category,findings,value`，finding 仅 `title,description`，空 SQL 分类映射为 `null`。
3. `escapeHtml()` 将 `& < > " '` 依次转为 `&amp; &lt; &gt; &quot; &#39;`；`escapeAttribute()` 使用同一安全字符映射，供双引号 href 使用。两者不解析 HTML、不执行 URL、不产生未转义输入。
4. 新建 `TemplatePublicationRenderer implements PublicationRenderer`；`render(context)` 使用穷尽 `switch`，分别调用 Event、Event Update、Knowledge 模板纯函数，不写 default 吞掉未知类型。
5. Event 模板：`title=event.title`，`summary=truncateSummary(event.description)`；body 使用 `<section><h2>` 标题、核心实体、主题、范围、发生时间、`<h3>初始事实</h3>` 和 description 段落。
6. Event Update 模板：`title=update.title`，`summary=truncateSummary(update.description)`；body 使用 Update 标题、父 Event 标题/实体/主题/范围、自身发生时间、`<h3>本次进展</h3>` 和 Update description。禁止引用父 Event description 或历史 Update。
7. Knowledge 模板：`title=knowledge.title`，`summary=knowledge.summary` 原样；body 使用标题、`分类：{category ?? "未分类"}`、摘要、价值、Findings 列表。每个 finding 输出 escaped title 与 description；空列表显示明确的“暂无 Findings”文本。
8. `truncateSummary(value, max=240)`：长度不超过上限时原样返回；超限时保留前 `max-1` 个 UTF-16 code unit，若截断点落在高/低代理对之间则退一位，再追加 `…`，最终字符串不超过 `max`。不按字节、字素或码点重写输入。
9. 三类 body 的所有字段值（含标题、实体、主题、范围、时间、正文、category、value、finding）必须经 `escapeHtml()`；固定标签和中文标签文字由程序生成。`occurredAt` 为 null/空串时只显示 `时间未确定`。
10. `tests/fixtures/publication.ts` T01 只建立合成三类 Context 与断言辅助；不得含 SQL、LLM、网络、私有 sentinel。后续卡在同一 fixture 上递增 helper，不得改变 T01 已冻结的合成语义。

### 4.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `PUB-01_EVENT_RENDER` | Event title/summary/body 与字段一致；时间 null 显示“时间未确定” |
| `PUB-01_UPDATE_RENDER` | Update 使用自身 title/description；只包含父 Event 的五字段背景，不出现父 description/历史 Update |
| `PUB-01_KNOWLEDGE_RENDER` | Knowledge title/summary/category/value/findings 完整；category null 显示未分类 |
| `PUB-10_SUMMARY_BOUND` | 短文本不变；超 240 输出 ≤240 且以 `…` 结束；代理对不被切半 |
| `PUB-13_ESCAPE` | `<script>`、`onerror=`、`<img onload=`、`& < > " '` 全部作为文本转义，无可执行原样标签 |
| `PUB-13_ATTR` | href 属性值中的引号/尖括号/`&` 被属性安全编码 |
| `TAGS_ALLOWLIST` | 输出标签只出现 `section/h2/h3/p/ul/li`；T01 不生成 `<a>` |
| `DTO_KEYS` | 三类 Context 与 findings 的枚举键精确等于 Spec；无 raw_data/User Context/历史 Updates/额外父描述 |
| `PURE_RENDER` | renderer 两次同输入深相等；源码无 DB/I/O/LLM/clock/random；FakeClock/ID 调用为 0 |
| `EMPTY_FIELD_VALUES` | 空字段安全渲染为可读文本，不抛错；最终服务文本校验由 T03/T04 证明 |

### 4.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/publication/html-security.test.ts tests/publication/template-renderer.test.ts
npm run format
npm run verify
git diff --check
rg -n 'fetch\(|new Database|withTransaction|completionClient|TypedLlmCalls|config/prompts|user-context|raw_data|Date\.now|Math\.random|randomUUID' src/publication/contracts.ts src/publication/html.ts src/publication/template-renderer.ts tests/fixtures/publication.ts tests/publication/html-security.test.ts tests/publication/template-renderer.test.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/runtime src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。扫描命中只允许测试中刻意构造的危险输入或不参与运行的字段名断言，并须逐条解释。交回须列 base SHA、实际路径、Case→测试名、定向/full 测试数字、format 文件和已知限制，仅报 `REVIEW`/`BLOCKED`。

### 4.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_G3_EXECUTION_BASELINE` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §4.1 |
| `PATH_COUNT` | `PENDING · expected 6` |
| `FROZEN_TREE` | `PENDING` |
| `FROZEN_BLOBS` | `PENDING`；逐路径 blob |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 5. D11-T02 · 已存证据来源链接、URL 校验、去重与追加

### 5.1 依赖与精确允许写集

- 前置：D11-T01 已 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；base 固定为 T01 merge 后的 D11 docs record commit SHA。
- 修改且仅允许改：`src/publication/contracts.ts`（仅新增 Source Link Repository 契约）。
- 新增且仅允许写：`src/publication/source-links.ts`。
- 新增且仅允许写：`src/publication/source-link-repository.ts`。
- 修改且仅允许改：`tests/fixtures/publication.ts`。
- 新增且仅允许写：`tests/publication/source-links.test.ts`。
- 新增且仅允许写：`tests/publication/source-link-repository.test.ts`。
- 只读复用：`src/database/open-database.ts`、`initializeDatabase()`、schema 的 contents/source_items/event_content_links/knowledge；T01 HTML helper。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §3、§4、§5（附件部分）；Intent §2.6～§2.8、§5；`PUB-06`、`PUB-07`、`PUB-08`、`PUB-13`（来源 URL 侧）。

### 5.2 禁止范围

- 不得新增发布服务、目标 Context Repository、Published Item Repository、事务、通知或 `index.ts`。
- 不得从 description、summary、finding、Topic、raw_data 或模型字段中提取 URL；不得发 HTTP 请求验证可达性。
- 不得执行 URL、解析内容、跟随重定向或加入域名/端口白名单；只校验 URL 语法与 http/https 协议。
- 不得使用 `coalesce(NULLIF(...))` 掩盖空白 Source Item URL 的 fallback 测试，也不得读取父 Event 证据覆盖 Update 来源。
- 不得修改任何上游文件、DDL、测试基线、package/lock、CI、Prompt。

### 5.3 实现要求

1. `contracts.ts` 新增且仅新增 `PublicationSourceLinkRepository { listSourceUrls(targetType,targetId): readonly string[] }`；不得把 SQL 行类型暴露到公共契约。
2. `normalizeHttpUrl(raw: unknown)`：仅接受字符串；`trim()` 后为空返回 null；在任何 `new URL()` 解析前拒绝 C0 控制字符（`\u0000-\u001F` 和 `\u007F`）；解析失败、协议非 `http:`/`https:`、非空 username/password、空 hostname 均返回 null，不抛错。
3. 成功返回规范化的 `url.toString()`；输入首尾空白通过先 `trim()` 忽略，但内部 C0 控制字符必须被拒绝，不能依赖 URL API 自动清理。
4. `collectSourceLinks(urls, max)`：要求 `max` 为 1..20 的整数；逐项 normalize，丢弃 null；按规范化字符串去重并保持首次出现顺序；截取前 max 条。输入不得被修改。
5. `appendSourceLinks(body, links)`：空链接原样返回 body，不追加空 section；非空时仅在末尾追加 `<section><h2>来源</h2><ul><li><a href="...">...</a></li></ul></section>`，链接文本也是转义后的 URL 本身，不编造标题。
6. `source-link-repository.ts` 实现 `SqlitePublicationSourceLinkRepository`，SQL 只用绑定参数，不出现 `SELECT *`：
   - EVENT/EVENT_UPDATE：`event_content_links` 精确匹配目标自身类型/ID，join `contents`，并左连接该 content 的 `source_items`；不得把 `EVENT_UPDATE` 改成父 `EVENT` 查询。
   - KNOWLEDGE：`knowledge.id` → `contents`，再左连接该 content 的 `source_items`。
   - 每行优先取 trim 后非空的 `source_items.url`，否则取 `contents.url`；两者均 null 时返回空串候选供 `collectSourceLinks()` 丢弃，保证空值行为可测。
   - `ORDER BY source_items.discovered_at ASC, source_items.id ASC`；无 Source Item 时仍保留 Content URL 候选。
7. fixture 增加真实 SQLite seed/helper：content URL、source URL、重复 URL、空串、恶意协议/userinfo/控制字符、EVENT/EVENT_UPDATE/KNOWLEDGE 证据、父 Event 独立证据；不得用网络或真实 Prompt。
8. T02 不渲染 body；只证明 helper 与 Repository 的输出位。T04 才把 `collectSourceLinks()` + `appendSourceLinks()` 接入发布服务。

### 5.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `PUB-06_NORMALIZE_DEDUPE` | 等价 URL 规范化后去重；首次顺序保持；点击文本/属性为真实 URL |
| `PUB-06_APPEND` | 两链接只生成一个来源 section、两个 li/a；无标题编造 |
| `PUB-07_EMPTY` | 空数组 body 逐字节不变；不生成空 href、占位域名或来源 heading |
| `PUB-08_PROTOCOLS` | javascript/data/file/ftp/相对 URL 全拒绝，原输入内容不进入链接 |
| `PUB-08_USERINFO_CONTROL` | userinfo、空 host、NUL/CR/LF/TAB/DEL 拒绝；合法 URL 首尾空白可规范 |
| `PUB-08_NO_BLOCK` | 全部坏链接/无链接仍返回有限空数组，调用方可继续发布 |
| `PUB-13_URL_ESCAPE` | href/text 的 `&`、引号、尖括号被转义，不形成注入属性 |
| `EVENT_SOURCE_SQL` | Event 证据只读自身；URL 优先 Source Item，空白回退 Content |
| `UPDATE_SOURCE_SQL` | Update 只读自身证据；父 Event 证据不出现 |
| `KNOWLEDGE_SOURCE_SQL` | knowledge.content_id 路径正确；空白 Source URL 回退 Content URL；排序稳定 |
| `SOURCE_LINK_DTO` | Repository 返回纯字符串数组，不泄漏 raw_data 或 SQL row 字段 |

### 5.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/publication/source-links.test.ts tests/publication/source-link-repository.test.ts tests/publication/html-security.test.ts tests/publication/template-renderer.test.ts
npm run format
npm run verify
git diff --check
rg -n 'fetch\(|withTransaction|new Database|completionClient|TypedLlmCalls|config/prompts|user-context|raw_data|description|summary' src/publication/source-links.ts src/publication/source-link-repository.ts || true
rg -n "target_type = 'EVENT'|target_type = \"EVENT\"|parent|event_updates" src/publication/source-link-repository.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/runtime src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。扫描命中必须解释为参数化 EVENT/EVENT_UPDATE 分支或不参与运行字段，不得有网络/LLM/正文提取。交回须列 URL 规范化/拒绝样本、三类 SQL 的读取行与顺序、Case→测试、定向/full 数字，仅报 `REVIEW`/`BLOCKED`。

### 5.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T01_CLOSEOUT_DOCS_COMMIT` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §5.1 |
| `PATH_COUNT` | `PENDING · expected 6` |
| `FROZEN_TREE` | `PENDING` |
| `FROZEN_BLOBS` | `PENDING`；逐路径 blob |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 6. D11-T03 · 目标资格、Repository、唯一短事务与重复复用

### 6.1 依赖与精确允许写集

- 前置：D11-T02 已 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；base 固定为 T02 merge 后的 D11 docs record commit SHA。
- 修改且仅允许改：`src/publication/contracts.ts`（补齐 Spec §1 最终依赖、Published/Target Repository、Logger/Notifier 类型）。
- 新增且仅允许写：`src/publication/publication-errors.ts`。
- 新增且仅允许写：`src/publication/publication-target-repository.ts`。
- 新增且仅允许写：`src/publication/published-item-repository.ts`。
- 新增且仅允许写：`src/publication/publication-logger.ts`。
- 新增且仅允许写：`src/publication/publication.ts`。
- 修改且仅允许改：`tests/fixtures/publication.ts`。
- 新增且仅允许写：`tests/publication/publication-gate.test.ts`。
- 新增且仅允许写：`tests/publication/publication-persistence.test.ts`。
- 只读复用：T01 renderer/HTML、T02 source link helper/repository、`withTransaction`、`Clock`、`IdGenerator`、`formatTimestamp`、D01 open/init、schema fixture helpers。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2 DTO 落地、§5、§7 通知类型（仅契约）、§8；Intent §2.1～§2.5、§2.7～§2.10；`PUB-02`～`PUB-05`、`PUB-07`、`PUB-10`、`PUB-12`（重复快速返回部分）、`DB-13`。

### 6.2 禁止范围

- 不得实现 COMMIT 后 notifier 调用或其故障注入；通知行为留 T04。可以声明 `notify?` 类型，但本卡不得宣称通知已验证。
- 不得新增完整事务内目标/关联撤销注入测试；T03 只保证已发布唯一性复检，PUB-11 完整证明留 T04。
- 不得新增 `src/publication/index.ts`，不得接线 app/server/runtime/RSS。
- 不得修改 D01 schema、D10 target repository、D15 Runtime 或复用 D10 的 `PublishedItemRepository` 作为 D11 数据层。
- 不得在事务外已有 Published Item 时读取 target/source/render；不得在事务内做 URL 读取、renderer、日志或任何 async/thenable。
- 不得用 upsert/insert-or-replace 吞冲突；不得 update 已存在快照或根据后加分录篡改快照。
- 不得读取 `raw_data`、历史 Updates、User Context、Prompt、网络。

### 6.3 实现要求

1. `contracts.ts` 补齐 `PublicationDependencies`（database、targetRepository、sourceLinkRepository、publishedItemRepository、可选 renderer 默认 Template、clock、idGenerator、可选 logger、可选 notify、maxSourceLinks 默认 5/1..20）、`PublishedItem`/`PublishedItemInsert`、`PublishedItemRepository { findByTarget; insert; listForFeed }`、`PublicationTargetRepository { getContext; hasAnyTopicAssociation }`、`PublicationFeed`、`PublicationNotifier`、PublicationLogger/LogEntry 与 code 类型。
2. `publication-errors.ts` 导出仅三 code 的 `PublicationError`，message 映射 `invalid_input`/`aborted`/`publication_failed`；读取 abort-like `name=AbortError` / `code=ABORT_ERR|LLM_CANCELLED|aborted` 只用于将依赖错误归一为 `aborted`，不得暴露 cause。
3. `publication-target-repository.ts` 以绑定参数实现 `getContext()`；Event/Update/Knowledge 分别查询精确字段，Update join父 Event 但只返回五字段 summary；Knowledge 解析并校验 findings JSON；`hasAnyTopicAssociation()` 只查 `target_type,target_id`，不读取 Topic enabled 或名称。
4. `published-item-repository.ts`：`findByTarget()` 精确读 7 列；`insert()` 只写 7 绑定列，必须 `database.inTransaction===true`，changes=1 后读回并逐字段校验；`listForFeed()` 只读并按 `published_at DESC,id DESC`；无 update/delete 方法。
5. `createPublication()` 在构造时固定默认 renderer 和 maxSourceLinks；`maxSourceLinks` 非 1..20 整数应在任何 DB 访问前以 `publication_failed` 拒绝。
6. `publish()` 先校验 targetType 与 trim 非空 targetId，再检查 pre-abort；非法/pre-abort 必须零 DB。随后 `findByTarget` 命中即返回原 ID/true，不读取 target、source 或 renderer。
7. 门禁：`getContext()` null 或 `hasAnyTopicAssociation()` false 返回 `{null,false}`；目标存在但无关联不得渲染。依赖查询/解析异常统一 `publication_failed`（若 signal abort 则 `aborted`）。
8. 通过门禁后读取 URL，`collectSourceLinks(urls,max)`；调用 renderer；`appendSourceLinks(draft.body,links)`；`validatePublicationText()` 要求 title/summary/body trim 非空，失败在事务前抛 `publication_failed`。校验后不得对文本 trim/改写。
9. 在同步 `withTransaction()` 内再次 `findByTarget`：已存在则返回原 ID 且 `already_published:true`；否则只调用一次 clock.now、idGenerator.next、formatTimestamp，插入并读回。事务体不得含 Promise/async/await、renderer、source 或 notify。T04 再在此事务中补齐 target/association 复检。
10. 本卡 COMMIT 后不调用 notify；返回新建 `{id,false}`。logger best-effort，白名单仅允许 Spec §8 字段；不得记录正文/标题/URL/SQL。
11. fixture 增加真实 SQLite 初始化、seed three target kinds、关联、证据、Published 查询、计数时钟/ID、可失败 Published Repository；所有合成 sentinel 仅用于泄漏断言。

### 6.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `PUB-02_NO_ASSOCIATION` | target 存在但零 association → null/false；published 行 0；renderer/links 零调用 |
| `PUB-03_MISSING_TARGET` | 不存在 Event/Update/Knowledge → null/false；无悬空快照 |
| `PUB-03_INVALID_INPUT` | 非法 type/空白 ID `invalid_input`；pre-abort `aborted`；DB 读取 0 |
| `PUB-04_MULTI_TOPIC` | 两个 association 只插入一条；Topic 数不改变快照 ID |
| `PUB-05_REPEAT` | 第二次相同 publish 返回同 ID/true；renderer、links、clock、ID 均不再调用 |
| `PUB-05_TX_UNIQUE` | 构造事务内已有快照的注入场景，不插入第二行，返回原 ID/true |
| `PUB-07_NO_URL` | 合法关联但无 URL 仍插入；body 无来源 section/占位 URL |
| `PUB-10_VALIDATE` | renderer 返回空 title/summary/body 任一空白 → `publication_failed`；事务、clock、ID、insert 全 0 |
| `PUB-12_FAST_REUSE` | 已存在时先返回原快照，不重新渲染，不改 Published 行 |
| `DB-13_BUSINESS_GUARD` | 直接 SQL 可插多态悬空行；D11 服务对不存在目标返回空且业务表无新行 |
| `TX_ROLLBACK` | 插入后注入抛错 → 事务回滚，published 行 0，`inTransaction=false` |
| `TX_SYNC_ONLY` | 事务路径无 async/thenable；renderer/source 在 `inTransaction=false` 时调用 |
| `TARGET_DTO` | 三类 getContext 只含 Spec 字段；Knowledge findings/category 映射正确；无 raw_data |
| `PUBLISHED_REPO` | insert 必须事务内；`(target_type,target_id)` UNIQUE 冲突；listForFeed 排序稳定且只读 |
| `MAX_LINKS_CONFIG` | 默认 5；1/20 接受；0/21/NaN/小数在 DB 前拒绝 |

### 6.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/publication/publication-gate.test.ts tests/publication/publication-persistence.test.ts tests/publication/source-links.test.ts tests/publication/source-link-repository.test.ts tests/publication/template-renderer.test.ts tests/publication/html-security.test.ts
npm run format
npm run verify
git diff --check
rg -n 'fetch\(|completionClient|TypedLlmCalls|config/prompts|user-context|raw_data|UPDATE published_items|DELETE FROM published_items|INSERT OR REPLACE' src/publication || true
rg -n 'async|await|Promise' src/publication/publication.ts || true
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/runtime src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。扫描命中只允许公共 `Promise<PublishResult>` 返回类型和注入 Notifier 类型，必须逐条解释；事务文件不得出现 `await`。交回须列门禁/重复/回滚/事务外时序、Case→测试、定向/full 数字，仅报 `REVIEW`/`BLOCKED`。

### 6.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T02_CLOSEOUT_DOCS_COMMIT` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §6.1 |
| `PATH_COUNT` | `PENDING · expected 9` |
| `FROZEN_TREE` | `PENDING` |
| `FROZEN_BLOBS` | `PENDING`；逐路径 blob |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 7. D11-T04 · 不可变性、事务内复检、COMMIT 后通知、公共出口与 P0 集成

### 7.1 依赖与精确允许写集

- 前置：D11-T03 已 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`；base 固定为 T03 merge 后的 D11 docs record commit SHA。
- 修改且仅允许改：`src/publication/publication.ts`（事务内 target/association 复检、COMMIT 后通知、最终工厂行为）。
- 修改且仅允许改：`src/publication/publication-logger.ts`（新增 notify stage 与 notify_failed 白名单）。
- 新增且仅允许写：`src/publication/index.ts`（最终运行时代码只导出 `createPublication`、`PublicationError`）。
- 修改且仅允许改：`tests/fixtures/publication.ts`（事务复检注入、notifier、真实 SQLite P0 harness）。
- 新增且仅允许写：`tests/publication/publication-immutability.test.ts`。
- 新增且仅允许写：`tests/publication/publication-transaction-recheck.test.ts`。
- 新增且仅允许写：`tests/publication/publication-notification.test.ts`。
- 新增且仅允许写：`tests/publication/publication-integration.test.ts`。
- 新增且仅允许写：`tests/publication/publication-export-boundary.test.ts`。
- 只读复用：T01～T03 全部、D01 open/init、schema fixture、D10 target DTO 形状、D15 `PublishResult` 结构兼容断言。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：Spec §1、§2、§5、§6、§7、§8、§9；Intent §2.1～§2.10；`PUB-01`～`PUB-10`、`PUB-12`、`PUB-13`、`DB-13` 的集成收口及 `PUB-11` P1。

### 7.2 禁止范围

- 不得新增 RSS XML、Feed 文件、归档、云端、HTTP API、Runtime/app/server/lifecycle 接线或持久化通知任务。
- 不得实现 LLM/Completion/Prompt、读取任何 Prompt 或 User Context，不得从模型输出取 URL。
- 不得修改 schema、D01～D10/D15、D10 target repository、package/lock、CI、config。
- 不得在事务内调用 renderer、source repository、notifier、logger 中的异步操作或任何 await；通知应在 COMMIT 后且不阻塞返回值。
- 不得 update/delete/upsert Published Item，不得新增第二份 Published Item，不得用后补证据重构 body。
- 不得通过放宽 `PUB-11` 为 P0 或删除注入测试冒充 P0；它必须忠实记录为 P1 结构证明。

### 7.3 实现要求

1. 在 T03 的同步事务体中最先再次 `findByTarget`；随后再次 `getContext()` 与 `hasAnyTopicAssociation()`。任一复检失败返回空结果，不调用 clock/id/insert；真实 DB 异常才 `publication_failed`。复检失败不得执行 notify。
2. 事务内顺序固定：find → context → association → clock.now 一次 → idGenerator.next 一次 → formatTimestamp 一次 → insert/readback。`withTransaction()` 的返回值携带“新建/复用/空结果”状态供 COMMIT 后分支，不得用外部可变全局值猜测。
3. 仅当状态为“实际新建”时，在 `withTransaction()` 返回后调用 `notify(feed)`；`EVENT`/`EVENT_UPDATE → "EVENT"`，`KNOWLEDGE → "KNOWLEDGE"`。无 notify 可跳过；重复/空结果不通知。
4. `notify` 允许 `void | Promise<void>`。同步抛错或异步拒绝都被吞掉，并通过 logger 记录 `stage=notify`、`reason=notify_failed`；不得回滚、重试 Publish 或重新渲染。返回值不得等待 notify 完成。
5. 公共 `createPublication()` 使用默认 `TemplatePublicationRenderer`、默认 `maxSourceLinks=5`；`PublicationDependencies` 不暴露 completionClient/Prompt/User Context。公共 DTO 不增加 `raw_data` 或历史字段。
6. `index.ts` 仅运行时代码导出 `createPublication` 与 `PublicationError`；所有 Context/Draft/Result/Repository/Logger/Notifier 等以 `export type` 暴露。不得导出具体 SQLite Repository、renderer helper 或 source helper 的运行时代码。
7. 不可变性：Repository 无 update/delete；发布后修改 Event/Update/Knowledge 显示字段、补证据、添加 Topic、新增 Update，再执行 publish 仍返回原 ID/true，renderer/source/clock/ID/notify 不再触发，七列逐字节一致。
8. 真实 SQLite 集成：`openDatabase` + `initializeDatabase` + 真实 D11 Repository + 一线程发布服务；用合成 Source/Content/Event/EventUpdate/Knowledge/Topic/Association/Evidence 数据验证 Event、Update、Knowledge 各一份快照。HTTP/LLM/completion client 均以零依赖断言而非 stub 冒充分支。
9. 通知时序：notifier 被调用时 `database.inTransaction===false`；notify 同步抛错/异步拒绝后 published 行仍在、返回 `already_published:false`、同 ID 快照可读。重复 publish 不通知。
10. `PUB-11` P1 注入：外部 getContext/hasAnyTopicAssociation 成功后，事务内下一次复检分别返回 null/false；断言 insert/clock/id/notify 均为 0，业务表除既有种子外不变。再注入“事务内发现已存在”场景，返回既有 ID/true、零竞态第二行。
11. 集成测试必须断言 body 标签 allowlist、恶意 HTML 转义、真实 http(s) 链接只来自证据；无 URL 仍发布；重复 URL 去重；无 Topic 不发布；多 Topic 一快照；三目标 DTO 无 raw_data；SQLite 唯一约束不被绕过。
12. `publication-export-boundary.test.ts` 以命名空间 import 检查最终运行时值导出集合精确为 `PublicationError`、`createPublication`，类型导出不产生运行时代码；同时断言无 `completionClient`/LLM/Prompt 文件读取。

### 7.4 测试矩阵

| Case | 必测断言 |
|---|---|
| `PUB-01_SQLITE_THREE_KINDS` | Event/Update/Knowledge 各生成快照；title/summary/body 可读；无 LLM 依赖/调用 |
| `PUB-02_SQLITE_GATE` | 无 association 三类型均零行、null/false |
| `PUB-03_SQLITE_GUARD` | 不存在目标零行；非法 type 零 DB；无悬空记录 |
| `PUB-04_SQLITE_MULTI_TOPIC` | 多加 association 后仍一目标一行 |
| `PUB-05_REUSE_AND_UNIQUE` | 重复调用同 ID/true；DB UNIQUE 存在；新插入不覆盖 |
| `PUB-06_SQLITE_LINK` | 重复证据 URL 只链接一次；body 含真实 href；重排稳定 |
| `PUB-07_SQLITE_NO_LINK` | 无 URL 仍发布且无来源 section/占位 URL |
| `PUB-08_SQLITE_FILTER` | 恶意协议/userinfo/控制字符/空串被丢弃，规则不阻断发布 |
| `PUB-09_IMMUTABLE_EVIDENCE` | 发布后补证据/改 Topic/新增 Update，原七列逐字节不变 |
| `PUB-10_INVALID_DRAFT` | 三类空 title/summary/body 写入前失败；published 数不变；事务/ID/clock/notify 0 |
| `PUB-11_TARGET_REMOVED` | 事务内 target null → 空结果；零插入/通知；P1 记录 |
| `PUB-11_ASSOC_REMOVED` | 事务内 association false → 空结果；零插入/通知；P1 记录 |
| `PUB-12_NO_RERENDER` | 已存在快速返回原 ID；修改显示字段/证据/Topic 后仍不重新渲染 |
| `PUB-13_SAFE_BODY` | `<script>/<img onerror>` 转义；标签 allowlist；URL 仅来自已存证据 |
| `DB-13_SERVICE_BOUNDARY` | 直接 SQL 证明 DDL 不拒绝多态目标；服务拒绝且无部分业务数据 |
| `TX_RECHECK_ORDER` | 事务内 find→context→association→clock/id→insert；复检失败不取时钟/ID |
| `NOTIFY_AFTER_COMMIT` | `inTransaction=false` 时通知；仅新建一次；重复/空结果 0 次 |
| `NOTIFY_BEST_EFFORT` | 同步 throw/异步 reject 不影响返回值、快照与后续复用 |
| `NO_LLM_PRIVACY` | 生产源码无 completionClient/TypedLlmCalls/Prompt/User Context；DTO 无 raw_data/历史 Updates |
| `EXPORT_BOUNDARY` | 运行时值导出恰为 `createPublication`/`PublicationError`；无 Repository/helper 值导出 |
| `D15_SUCCESS_SHAPE` | D11 新建成功对象 `{published_item_id:string,already_published:boolean}` 可赋给 D15 成功结果形状；不冒充完整空结果服务可直连 D15 |

### 7.5 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/publication
npx vitest run tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/topic-matching/topic-matching-target-repository.test.ts tests/runtime/task-mapping.test.ts
npm run format
npm run verify
git diff --check
rg -n 'completionClient|TypedLlmCalls|ChatCompletion|config/prompts|user-context|apiKey|Authorization|fetch\(|raw_data' src/publication || true
rg -n 'UPDATE published_items|DELETE FROM published_items|INSERT OR REPLACE|ON CONFLICT.*published_items' src/publication || true
rg -n 'await|Promise' src/publication/publication.ts || true
rg -n 'published_items|event_content_links|source_items|topic_associations|knowledge' src/publication/*.ts | sed -n '1,240p'
git diff --name-only <BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/runtime src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

禁止 diff 必须为空。`Promise`/`async` 仅允许公共 `Publish` API 与不阻塞 notifier 调用，`publication.ts` 事务体必须无可执行 await；SQL 扫描必须只对应七个绑定列、唯一查询和只读 Feed 列表。交回须列三目标行数、重复/并发渲染计数、事务内复检注入、`inTransaction` 时序、通知故障结果、标签/URL 安全证据、full 测试与 format 数字，仅报 `REVIEW`/`BLOCKED`。

### 7.6 冻结与交付证据

| key | 初始值 |
|---|---|
| `BASE_SHA` | `PENDING_T03_CLOSEOUT_DOCS_COMMIT` |
| `WORKER_AGENT` | `PENDING` |
| `WORKER_WORKSPACE` | `PENDING` |
| `WORKER_BRANCH` | `PENDING` |
| `CHANGED_PATHS` | `PENDING`；允许路径见 §7.1 |
| `PATH_COUNT` | `PENDING · expected 9` |
| `FROZEN_TREE` | `PENDING` |
| `FROZEN_BLOBS` | `PENDING`；逐路径 blob |
| `PATCH_PATH` | `PENDING` |
| `PATCH_SHA256` | `PENDING` |
| `ARCHITECT_TREE_APPROVAL` | `PENDING` |
| `CANDIDATE_SHA` | `PENDING` |
| `MERGE_SHA` | `PENDING` |
| `MERGE_TREE` | `PENDING` |
| `VERIFICATION` | `NOT_RUN` |
| `ARCHIVE_RESULT` | `PENDING` |

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，按以下顺序执行；Lead 不得代替 Worker 编码，Worker 不得自行创建 candidate/merge/push。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 HEAD/tree；tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡精确白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：独立检查 diff、行为、Spec/Case、错误/隐私、禁止路径、no-op 与 directed/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch 路径/SHA-256、逐路径 blob、路径数、`git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **同次交回硬门禁**：Lead 必须在同一次回复中给出冻结 tree、canonical patch SHA-256、路径数、逐路径 blob、定向/full 测试数字、format 文件数和交回结论。Architect 只能从磁盘发现冻结产物时，本卡退回流程重做。
6. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
7. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先/未审提交。
8. **预演**：实际 merge 前先在 D11 主线执行 `git merge-tree --write-tree --no-messages <BASE_SHA> <CANDIDATE_SHA>`；预演 tree 必须逐字等于 `FROZEN_TREE`。不等时立即停止、记录并报告，不得实际 merge、不得继续后卡。
9. **Merge**：预演通过后由 Lead 以 `--no-ff` 合并 candidate；核验第一 parent 为当前 base、第二 parent 为 candidate、merge tree 等于 frozen tree，并记录 merge SHA/tree。
10. **合并后复验**：从 merge commit 独立执行本卡定向命令与 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
11. **收尾 docs commit**：在 main 更新 `progress.md`，记录本卡 evidence、合并后复验、私有/越界扫描；该 docs commit 是下一卡唯一 base。不得用前卡 merge SHA 代替 docs commit。
12. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 无该项。主工作区永不归档。

`progress.md` 每卡记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`PATH_COUNT`、`FROZEN_TREE`、`FROZEN_BLOBS`、`PATCH_PATH`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结/candidate/merge 只记录精确 SHA，不以 branch 名或工作目录代替证据。

## 9. D11 集成 Gate 与最终验收边界

四卡全部 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` 后，Lead 从最后一个 merge commit 后的 D11 docs record commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/publication tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/topic-matching/topic-matching-target-repository.test.ts tests/runtime/task-mapping.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/llm src/prompt src/adapters src/configuration src/config.ts src/time src/id src/runtime src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
rg -n 'completionClient|TypedLlmCalls|ChatCompletion|config/prompts|user-context|apiKey|Authorization|fetch\(|raw_data|historical_updates' src/publication || true
rg -n 'UPDATE published_items|DELETE FROM published_items|INSERT OR REPLACE|ON CONFLICT.*published_items' src/publication || true
rg -n 'await|Promise' src/publication/publication.ts || true
rg -n 'completionClient|TypedLlmCalls|ChatCompletion|fetch\(|new Database|withTransaction|published_items' src/collection src/processing src/knowledge src/event-analysis src/event-search src/topic-matching src/runtime src/app.ts src/server.ts src/lifecycle.ts || true
```

Gate 必须保留：

- `PUB-01`～`PUB-10`、`PUB-12`、`PUB-13`、`DB-13` 逐项 Case→测试文件/命令→PASS；`PUB-11` P1 的 target/association 撤销与结构注入证据必须保留，但不阻断 P0。
- 三类目标真实 SQLite 各生成可读快照；目标不存在/无 Topic Association 均为空结果，零写入。
- `(target_type,target_id)` 唯一；多 Topic 一快照；重复/并发 publish 返回原 ID，不重新渲染。
- 来源 URL 只来自已存证据；EVENT_UPDATE 不继承父 Event；仅 http/https；userinfo/控制字符/危险协议过滤；去重保序、最多 5；无 URL 正常发布，无占位地址。
- body 全部转义，标签仅 `h2/h3/p/ul/li/section/a(href)`；title/summary 是纯文本；renderer 纯函数。
- 事务外完成目标/来源读取、渲染和链接收集；事务内同步复检 target/association/unique 后才写；事务内零网络/零异步。真实 SQLite 测试采样 `database.inTransaction` 时序。
- COMMIT 后仅新建时 notify，EVENT/UPDATE→EVENT、KNOWLEDGE→KNOWLEDGE；同步 throw/异步 reject 不回滚、不重渲染、不重试 Publish。
- 已发布快照七列逐字节不变；任何后补证据/字段/关联/Update 均不改写。
- 公共运行时值导出仅 `createPublication`/`PublicationError`；无 completion client、LLM、Prompt、User Context、RSS/API/Runtime 接线。
- 相对批准基线仅允许 D11 `src/publication`、`tests/publication`、`tests/fixtures/publication.ts` 与 D11 文档路径；受保护路径 diff=0，schema/package/lock/CI=0。

Lead 提交 `D11_LOCAL_GATE=EVIDENCE_READY` 后交 Architect。Architect 独立复核干净快照，按持续授权 push 已批准 main SHA 并等待精确 SHA CI Success；Lead 不 push、不签发最终 PASS。只有 Architect 独立 Gate 与精确 pushed SHA CI 都通过后，才可签发 `D11_FINAL_PASS`。

本 Plan 不创建心跳。若 G3 批准并明确启动开发，由 Architect 依项目规范创建唯一 D11 推进心跳并在 `progress.md` 记录准确 ID；Lead 不自行创建。最终验收后由 Architect 核对并归档 Worker/Workspace、删除准确心跳并复查；主工作区与共享角色工作区不归档。

## 10. 风险、回滚与停止条件

- **G3 门禁**：Intent/Spec 已批准，但本 Plan 仍待 Architect G3；未批准不派发 Worker、不写生产代码、不创建 candidate/merge/push。
- **D15 结构兼容确认**：D11 成功对象可赋给 D15 的 `{published_item_id:string}`，但 D11 正常空结果的 `published_item_id:null` 使完整服务返回类型不能直接赋给当前 D15 `StageServices.publish()`。本 Plan 不修改、不接线 D15；G3 若要求服务级直接赋值，必须由 Architect 明确在 D11 范围外调整 D15 契约或批准适配策略，Worker 不得自行改类型。
- **固定基线**：T01 base 必须是批准后的精确文档提交；T02～T04 必须是前卡 merge 后的 docs record commit。不得用浮动 `main`、branch 名或前卡 merge SHA 代替。
- **公共出口**：`index.ts` 若把 helper/Repository/renderer 作为运行时值导出，违反 Spec；若 createPublication 暴露 completionClient/Prompt 依赖，判 BLOCKER。
- **LLM 越界**：任何 Completion/Prompt/User Context 读取、模型 URL 或模板块调用，判 BLOCKER；T01～T04 只使用合成数据。
- **来源越界**：从正文/摘要/finding/模型输出抽 URL，或 Update 继承父 Event 证据，判 BLOCKER。
- **事务越界**：在事务内读 URL、render、notify、等待 Promise，或不再次 recheck target/association/unique，判 BLOCKER。
- **幂等/不可变**：重复 publish 重渲染、覆盖七列、生成第二条、多 Topic 多快照，判 BLOCKER。
- **通知边界**：在 COMMIT 前通知、空/重复结果通知、通知失败回滚或重渲染、把同步通知失败写入快照，判 BLOCKER。
- **安全**：未转义内容值、未批准标签、恶意 URL 进入 href、正文脚本可执行，判 BLOCKER。
- **数据/隐私**：DTO 含 raw_data/User Context/历史 Updates；日志泄漏正文/标题原文/URL/SQL/Prompt/Token；读取私有 Config/Prompt，判 BLOCKER。
- **回滚**：每卡 candidate 以固定 base 单一 parent，必要时 revert merge commit；不得 reset 主线、覆盖其他里程碑或修改已批准上游来“修测试”。
- 同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分、Plan 或 Spec 根因；涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 只把已批准 D11 Intent/Spec 映射为四张严格串行、文件级可执行任务卡，没有新增业务任务类型、公共字段、DDL、Prompt、依赖、Worker 或替代任务 ID。
- T01～T04 均列出精确允许写集、固定 base 规则、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive evidence key。
- V1 零 LLM；发布门槛为目标存在 + 至少一条 Topic Association；已有快照原 ID 返回且不重新渲染。
- 多 Topic 一快照；事务外渲染/链接收集；事务内同步复检目标/关联/唯一性；COMMIT 后 best-effort 通知。
- `PUB-01`～`PUB-10`、`PUB-12`、`PUB-13`、`DB-13` 有 P0 测试归属；`PUB-11` 为 P1 结构证明 + 注入测试。
- `PUB-07`/`PUB-08` 无链接与坏链接均不阻断；`PUB-13` 内容转义与真实 URL 来源分离；三目标 DTO 无 raw_data/User Context/历史 Updates/父关联。
- D15 结构兼容按“成功对象可吸收”记录；正常 null 空结果与 D15 当前非空返回签名的差异已显式提交 G3 决策，不通过改 D15 或删除空结果规避。
- 当前结论：`D11_PLAN=G3_PENDING_ARCHITECT_REVIEW`。G3 复核通过前四卡保持 `NOT_STARTED`，不创建 Worker、心跳、candidate、merge、push 或最终验收。
