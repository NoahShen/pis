# D14 Spec — Retrieval 与历史查询 HTTP JSON API

- 状态：APPROVED · Architect
- Intent：`docs/milestones/D14/intent.md`（APPROVED）
- 权威映射：技术实现设计 §5.2～5.3；测试 API-03～API-15；实施计划 D14-T01～T04。

## 1. 模块与只读边界

新增独立 `src/retrieval/`，通过 `src/configuration/app-assembly.ts` 和生产装配注入同一 SQLite 连接。Repository 只执行参数化 SELECT，不修改业务表、不构造 Runtime/Scheduler/LLM/RSS Publisher。轻量 `buildApp` 与 `createProductionAssembly` 均可查询；资源仍由现有装配层唯一关闭。

禁止新增表、索引、迁移、写事务、任务类型或 npm 依赖。查询失败使用现有受控错误映射；不得向客户端或日志返回 SQL、堆栈、Bearer、配置秘密或内部绝对路径。

## 2. 路由与最小 DTO

所有路由均为 GET，响应 `application/json`，时间字符串和 ID 按数据库原值返回，布尔/数组/对象使用 JSON 类型而非序列化字符串。

| 路由 | 返回 |
|---|---|
| `/api/topics/:id/items` | `{items,next_cursor}`；每项含 `topic_id,target_type,target_id,matched_at,target`；target 为对应 Event/Update/Knowledge 快照 |
| `/api/events` | Event 列表；每项含全部 Event 字段及 `update_count` |
| `/api/events/:id` | Event 基础字段、`updates`（该 Event 全量按固定顺序）和 `evidence_contents` |
| `/api/events/:id/updates` | Update 分页列表，每项含 Update 字段和 `evidence_contents` |
| `/api/event-updates/:id` | Update 字段、`event` 摘要及 `evidence_contents` |
| `/api/knowledge` | Knowledge 列表；含 `id,content_id,title,summary,category,findings,value` |
| `/api/knowledge/:id` | Knowledge 字段及 `content` |
| `/api/contents/:id` | Content 全字段、`source_item`、`source`；后两者整体可空，安全处理断链 |
| `/api/published-items` | Published Item 列表；含快照字段及 `topics` |
| `/api/published-items/:id` | Published Item 快照、来源 `target` 及 `topics` |

`evidence_contents` 至少含 `id,title,url,author,published_at,created_at`；`topics` 含 `id,name,matched_at`。`findings_json` 必须解析为数组；存储层损坏或异常关联不得导致未捕获异常，损坏详情目标以 `target:null` 表示，必要顶层对象不存在按 404。Published Item 的 body 是不可变历史快照，查询不得重新渲染。

## 3. 分页与排序

所有列表包括 Topic items、Events、Event Updates、Knowledge、Published Items 使用：

- `limit`：十进制整数字符串，默认 50，范围 1～200；缺省以外空值、符号、小数、前导空白、非数字或越界均 400。
- `cursor`：可选不透明 **base64url JSON**，无 padding；JSON 仅含 `v:1`、端点排序键值和 tie-breaker ID。解码、大小、类型、版本或排序键非法均 400；cursor 不携带 SQL、Token、正文或任意用户查询。
- 查询键 `target_type` 等过滤条件也属于游标上下文；同一下一页请求更换过滤条件必须 400，避免串用游标。
- 响应 `{items:[...],next_cursor:string|null}`；仅实际存在下一行时返回 cursor，最后页为 null。Repository 以 `limit+1` 判定下一页。

固定降序时间 + 降序 ID 作为确定性全序：

| 列表 | 时间键 |
|---|---|
| Topic items | `matched_at` |
| Events | `discovered_at` |
| Event Updates | `discovered_at` |
| Knowledge | 对应 Content `created_at` |
| Published Items | `published_at` |

时间均为规范化 ISO 字符串，按数据库文本排序；同刻由 ID 决定。cursor 行使用 `(time < cursor.time) OR (time=cursor.time AND id<cursor.id)`。Event 详情内嵌 updates 与 evidence/topics 数组同样使用稳定时间/ID 排序；详情内嵌 updates 不受模型最近 10 条限制。

连续新增数据的保证限定为：已翻过的历史页不因新记录插入而重复/错位；新数据是否出现在已开始的快照中不作事务快照承诺。过滤条件在 cursor 中绑定，客户端必须原样传递。

## 4. 过滤与输入协议

P0 仅支持以下简单过滤，不扩展查询 DSL：

- `/api/topics/:id/items?target_type=EVENT|EVENT_UPDATE|KNOWLEDGE`
- `/api/published-items?target_type=EVENT|EVENT_UPDATE|KNOWLEDGE`
- `/api/published-items?published_after=<ISO 8601>&published_before=<ISO 8601>`，闭区间；两者可独立使用。

其他列表只允许 `limit,cursor`；未知 query key、重复 key、非法枚举/时间/ID（空、控制字符、超过 256 字符）均 400。父 Topic/Event 不存在优先按 404；父存在但空列表返回 200。路由详情对象不存在返回 404 `{error:"not_found"}`；非法请求返回 400 `{error:"invalid_request"}`；无/错 Bearer 返回 401 `{error:"unauthorized"}` 且 `WWW-Authenticate: Bearer`。

时间过滤要求带明确 `Z` 或 `+/-HH:MM` offset 的 ISO 8601，转换为时间含义后比较；after>before 为 400。过滤只影响 Published Items，其他端点不暗中支持未定义参数。

## 5. 来源链与安全

- Content 详情通过 `source_items.content_id` 找 Source Item，再经 `source_id` 找 Source；Content 无 Source Item 时二者均 null；Source Item 存在但 Source 异常缺失时 `source:null`，不抛未捕获异常。
- Event/Update evidence 来自 `event_content_links`，只读既有 Content，不补抓来源。
- Topic 关联和 Published Item topics 只来自既有 `topic_associations`，不现场匹配、不回填。
- SQL 全部参数化，排序/列名只能来自代码固定映射；危险字符串仅作为绑定值，JSON 自动转义。
- GET 失败不得改变数据库；用只读 `query_only` 数据库连接也可完成全部查询。

## 6. 测试与出口

- API-03～06/14：真实临时 SQLite 四类查询、详情、证据、Topic、可空来源链。
- API-07/11/12：超过 200 条、默认/上限/越界 limit、时间/类型过滤、同刻 ID、连续新增和跨页不漏不重。
- API-08/10/15：非法 ID/枚举/query/cursor/时间、危险字符串、404/400、无 SQL/堆栈和数据库不变。
- API-09/13：所有新旧受保护 API 的无/错 Bearer，RSS 路径不能赋权，写配置仍不变。
- 每卡定向测试 + `npm run verify`；生产装配 integration 与 `git archive` 干净快照 smoke；最终精确 main SHA GitHub Linux CI Success。
