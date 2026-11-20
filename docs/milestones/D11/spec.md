# D11 Spec：Published Item 与模板

- 状态：`APPROVED · G2`
- 版本：v0.1
- Intent：`docs/milestones/D11/intent.md`（G1 已批准）。
- 实现基线：`52dc00b35dde4671ec5f18ced59c871cf732315a`。

## 1. 公共契约

```ts
import type { TopicTargetType } from "../topic-matching/contracts.js";
export type PublicationTargetType = TopicTargetType;  // 复用，不另造字符串联合

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

export interface PublicationDependencies {
  readonly database: Database.Database;
  readonly targetRepository: PublicationTargetRepository;
  readonly sourceLinkRepository: PublicationSourceLinkRepository;
  readonly publishedItemRepository: PublishedItemRepository;
  readonly renderer?: PublicationRenderer;      // 默认 TemplatePublicationRenderer
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger?: PublicationLogger;
  readonly notify?: PublicationNotifier;        // COMMIT 后调用，best-effort
  readonly maxSourceLinks?: number;             // 默认 5，1..20
}
```

- `createPublication(deps): PublicationService`；运行时导出仅 `createPublication`、`PublicationError`。
- 错误：`invalid_input | aborted | publication_failed`；固定安全 message、无 cause、不含正文/URL/SQL。
- `invalid_input`（非法 type、空白 ID）与 pre-abort 在任何 DB 访问前拒绝。
- 目标缺失 / 无 Topic Association → `{published_item_id:null, already_published:false}`，**不是错误**。

## 2. 渲染上下文与模板

```ts
export type PublicationContext =
  | { readonly targetType: "EVENT"; readonly event: PublicationEvent; readonly occurredAt: string | null }
  | { readonly targetType: "EVENT_UPDATE"; readonly update: PublicationUpdate; readonly parentEvent: PublicationEventSummary; readonly occurredAt: string | null }
  | { readonly targetType: "KNOWLEDGE"; readonly knowledge: PublicationKnowledge };

export interface PublicationEvent {
  readonly id: string; readonly title: string; readonly entityName: string;
  readonly subject: string; readonly scope: string; readonly description: string;
}
export interface PublicationEventSummary {
  readonly id: string; readonly title: string; readonly entityName: string;
  readonly subject: string; readonly scope: string;
}
export interface PublicationUpdate {
  readonly id: string; readonly eventId: string; readonly title: string; readonly description: string;
}
export interface PublicationKnowledge {
  readonly id: string; readonly title: string; readonly summary: string;
  readonly category: string | null;
  readonly findings: ReadonlyArray<{ readonly title: string; readonly description: string }>;
  readonly value: string;
}

export interface PublicationDraft {
  readonly title: string; readonly summary: string; readonly body: string;
}
```

- DTO 只含上述字段；不携带 `raw_data`、User Context、历史 Updates、父 Event 关联。
- EVENT_UPDATE 的 `parentEvent` 只有五个基础字段（与 D10 一致）。
- `findings` 仅 `title/description`；`category` SQL NULL → `null`。

### 模板输出

| 类型 | title | summary | body 结构 |
|---|---|---|---|
| EVENT | Event.title | Event.description（截断至摘要上限） | 主线标题、核心实体、主题、范围、发生时间、初始事实段落 |
| EVENT_UPDATE | Update.title | Update.description（截断） | 进展标题、所属主线（父 Event 标题/实体/主题）、发生时间、本次进展段落 |
| KNOWLEDGE | Knowledge.title | Knowledge.summary | 标题、分类（可空）、摘要、价值说明、Findings 列表（标题+描述） |

- 摘要上限默认 240 字符（按 UTF-16 code unit 截断，不切断代理对；追加 `…`）。
- 空 `occurredAt` 显示"时间未确定"，不伪造时间。

## 3. HTML 安全

```ts
export function escapeHtml(value: string): string;
export function escapeAttribute(value: string): string;
```

- `escapeHtml`：`& < > " '` 全部转义（`&amp; &lt; &gt; &quot; &#39;`）。
- `escapeAttribute` 在 `escapeHtml` 基础上处理 URL；属性值一律双引号包裹。
- 允许的输出标签仅限：`h2 h3 p ul li section a`（`a` 仅带 `href`）。
- 内容值**绝不**拼接为原始 HTML；含 `<script>`、`onerror=`、`<img onload=` 等输入一律作为纯文本转义出现。
- 渲染是**纯函数**：无 I/O、无 DB、无 LLM、无时钟、无随机。

## 4. 来源链接

```ts
export interface PublicationSourceLinkRepository {
  listSourceUrls(targetType: PublicationTargetType, targetId: string): readonly string[];
}

export function normalizeHttpUrl(raw: unknown): string | null;
export function collectSourceLinks(urls: readonly string[], max: number): readonly string[];
```

### 提取 SQL

- EVENT：`event_content_links(target_type='EVENT', target_id)` → `contents` → `source_items.content_id`。
- EVENT_UPDATE：`event_content_links(target_type='EVENT_UPDATE', target_id)`，**只用自身证据**，不查父 Event。
- KNOWLEDGE：`knowledge.content_id` → `source_items.content_id`。
- 取 `source_items.url`，若为 NULL/空白则回退 `contents.url`。
- 排序：`source_items.discovered_at ASC, source_items.id ASC`，稳定可复现。

### 校验（`normalizeHttpUrl`）

- 输入必须为非空白字符串且 `trim()` 后非空。
- `new URL()` 可解析；协议仅 `http:`/`https:`。
- 拒绝 `username`/`password` 非空；拒绝包含 `\r\n\t` 等控制字符；拒绝空 hostname。
- 返回 `url.toString()`；失败返回 `null`（**不抛错**，坏链接被静默丢弃）。
- `collectSourceLinks`：过滤 → 规范化 → 按规范化字符串去重 → 保持首次出现顺序 → 截取 `max`。
- **绝不**从模型输出、描述文本、findings 中提取或生成 URL。

### 附加

```ts
export function appendSourceLinks(body: string, links: readonly string[]): string;
```

- 无链接 → 原样返回 `body`。
- 有链接 → 追加 `<section><h2>来源</h2><ul><li><a href="…">…</a></li></ul></section>`；链接文本使用转义后的 URL 本身，不编造标题。

## 5. 持久化

```ts
export interface PublishedItemRepository {
  findByTarget(targetType, targetId): PublishedItem | null;
  insert(item: PublishedItemInsert): PublishedItem;      // 必须在事务内
}

export interface PublicationTargetRepository {
  getContext(targetType, targetId): PublicationContext | null;
  hasAnyTopicAssociation(targetType, targetId): boolean;
}
```

### `publish()` 流程

1. 校验输入与 signal（pre-abort 零 DB）。
2. `findByTarget` 已存在 → 返回 `{原ID, already_published:true}`，**不渲染**。
3. `getContext` 为 null → `{null,false}`；`hasAnyTopicAssociation` false → `{null,false}`。
4. `listSourceUrls` → `collectSourceLinks`；`renderer.render(context)` → `appendSourceLinks` → `validatePublicationText`。
5. **同步短事务** `withTransaction()`：
   - 再次 `findByTarget`，存在则返回既有 ID；
   - 再次 `getContext`，缺失则返回 null 结果；
   - 再次 `hasAnyTopicAssociation`，false 则返回 null 结果；
   - `clock.now()` 一次、`idGenerator` 一次、`formatTimestamp` 一次 → `insert` → 读回。
6. COMMIT 后 `notify(targetType)`，**best-effort**：同步抛错或异步拒绝都被吞掉并记日志，不影响返回值。
7. 返回 `{published_item_id, already_published:false}`。

- 事务内复检失败返回**空结果**（不抛错）；真正 DB 失败才抛 `publication_failed`。
- 渲染与链接收集在事务外；事务内不执行任何网络/LLM/异步操作。
- 拒绝 thenable 事务体（沿用 D01 `withTransaction`）。
- `insert` 只写 7 个绑定列：`id,target_type,target_id,title,summary,body,published_at`。
- `validatePublicationText`：`title`/`summary` trim 非空，`body` trim 非空；失败抛 `publication_failed`，**在事务前**。

## 6. 不可变性

- 无任何 update 方法；`PublishedItemRepository` 只暴露 `findByTarget`/`insert`/`listForFeed`（只读）。
- 重复 `publish` 返回同一 `id`，且 `title/summary/body/published_at` 逐字节等于首次。
- 测试：发布后修改 Event 字段、追加证据、追加 Topic Association、新增 Update，再次 `publish` → 快照完全不变。

## 7. 通知接口

```ts
export type PublicationFeed = "EVENT" | "KNOWLEDGE";
export interface PublicationNotifier {
  notify(feed: PublicationFeed): void | Promise<void>;
}
```

- `EVENT`/`EVENT_UPDATE` → `"EVENT"`；`KNOWLEDGE` → `"KNOWLEDGE"`。
- 仅在**实际新建**时通知；`already_published=true` 与空结果不通知。
- 在 COMMIT 之后调用；失败不回滚、不重试渲染、不写任务表。

## 8. 日志与隐私

白名单：`targetType`、`targetId`、`stage`、`reason`、`sourceLinkCount`、`publishedItemId`、`durationMs`。
stage：`check|render|persist|notify`。
不记录正文、标题原文、URL、SQL、模型输出、Topic 名称。logger best-effort。

## 9. 测试矩阵

| Case | 必须证明 |
|---|---|
| `PUB-01` | 三类目标各生成 title/summary/body 与 Published Item；零 LLM（无 completionClient 依赖） |
| `PUB-02` | 无 Topic Association → 不创建，返回 null |
| `PUB-03` | 目标不存在/非法 type → 拒绝或空结果，无悬空 Published Item |
| `PUB-04` | 同一目标两个 Association → 仅 1 条 Published Item |
| `PUB-05` | 重复/重试 → UNIQUE 与事务复检保证唯一；返回原 ID |
| `PUB-06` | 重复 http(s) URL 去重并附加；正文含可点击真实链接 |
| `PUB-07` | 无任何来源 URL 仍正常发布，无占位 URL |
| `PUB-08` | javascript:/data:/file:/空串/userinfo/控制字符被过滤；不阻断发布 |
| `PUB-09` | 创建后补证据/改 Topic/新建 Update → 原快照完全不变 |
| `PUB-10` | 空白 body / 缺 title / 缺 summary → 写入前失败，不存不可读条目 |
| `PUB-12` | 已发布后改显示字段/补证据/加 Topic，重复 PublishTask → 不重新渲染，快照逐字节一致 |
| `PUB-13` | Content 含 HTML/JS → 转义为文本，无可执行脚本；URL 仅来自已存证据 |
| `PUB-11` (P1) | 草稿构造后撤销关联/目标 → 事务内复检拦截，不插入 |
| `DB-13` | `(target_type,target_id)` 唯一约束；重复插入冲突被复用而非产生第二条 |
| 事务 | 插入中途失败全回滚；`inTransaction=false` after；通知在 COMMIT 后 |
| 通知 | 仅新建通知一次；通知抛错/拒绝不影响结果与快照 |
| 隐私 | DTO 不含 raw_data/User Context/历史 Updates/父关联；无 LLM 调用 |

## 10. 冻结边界

- 不修改 D01 DDL、D02 LLM、D03～D10、D15 任何生产代码、Prompt、CI、package/lock。
- 不新增表、不实现 RSS XML/归档/云端/API/Runtime 接线、不实现 LLM Renderer。
- 不读取真实私有 `config/prompt/user-context.md`；不调用模型；测试只用合成数据。

## 11. Gate

四卡严格串行：T01 模板与 HTML 安全；T02 来源链接；T03 发布门槛与唯一事务保存；T04 不可变性/复检/通知/集成。
每卡 Worker REVIEW → Lead 同回复冻结 → Architect G4 → candidate → `--no-ff` merge → 复验 → 归档。
每卡 base = **前一卡收尾 docs commit**（D15 已确立规则）。
最终 PASS 需 Architect 独立干净快照 Gate + 精确 pushed SHA 远程 CI Success。
