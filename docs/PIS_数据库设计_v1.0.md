# PIS 个人情报系统 · 数据库设计

> **版本**：v1.0 · 2026-11-13（DB-01～03 基线；静态 RSS 发布说明同步，DDL 未变化）  
> **状态**：DB-01～03 已确认 V1 基线；实际代码集成和迁移测试待开发  
> **本文职责**：SQLite 数据模型、DDL、索引、事务边界、时间规范、数据完整性。  
> **配套文档**：[PIS_总体架构与设计原则_v1.0.md](PIS_总体架构与设计原则_v1.0.md)、[PIS_技术实现设计_v1.0.md](PIS_技术实现设计_v1.0.md)

本文件保存可执行 **SQLite 初始化 DDL**。若与应用代码发生不一致，应先复核本文件与架构文件的领域约束，再修改代码；不得在数据库层新增未经确认的独立业务生命周期。

---

## 1. 存储模型、表结构与短事务设计（DB-01～DB-03）

> 本章整合已确认的 SQLite 存储选型、Source Item／Content 规则、11 张业务表、可执行 DDL 与短事务边界。DDL 是 V1 初始化基线，具体 DAO 与任务衔接在后续实现设计中落实；不新增业务模块。

### 1.1 存储技术与表边界

- **存储引擎**：V1 使用单实例 SQLite，启用 WAL；不预设 PostgreSQL、Redis、独立搜索引擎或向量数据库。
- **表数量与边界**：七张核心业务表 `sources`、`contents`、`events`、`event_updates`、`knowledge`、`topics`、`published_items`；四张辅助表 `source_items`、`event_content_links`、`event_entity_aliases`、`topic_associations`。FTS5 为可重建的派生检索索引，不是新的核心业务表。
- **数据表达**：结构清晰、需要关联检索的内容使用关系字段；Knowledge 的内部 `findings` 可以存为 JSON TEXT；不因 Finding 新增独立表。Processing 不使用 `content_hash` 或类似度字段进行跨 Content 去重。
- **索引方向**：Event 规范实体／已确认别名普通索引 + FTS5 对 Event 和历史 Event Update 的文本召回；时间不能成为排除旧 Event 的硬性边界。
- **约束方向**：普通外键、合法枚举与必要唯一约束由 SQLite 提供；`target_type + target_id` 多态目标存在性、Topic 发布资格、Published Item 结构及可选来源链接合法性等由业务层验证。无持久化任务队列，也不追求跨阶段严格 Exactly-once。
- **时间规范**：统一存储 ISO 8601 `TEXT`，按 `+08:00` 时区格式化；来源时间、发现时间、记录创建时间和 RSS 发布时间分别保留原本语义。

### 1.2 Source 的采集检查点与 Source Item 去重

Source 在核心配置之外保存可空的 `last_collected_at`，表示该来源上次**成功完成采集且已保存发现结果**的检查时间。首次采集时可为空；失败时不得提前推进，以免遗漏尚未保存的条目。

Source Item 继续使用既有字段，不引入 `entry_key`：

```text
source_items
  id
  source_id
  external_id?      # 来源 GUID / Item ID（如有）
  url?              # 原始条目或文章 URL
  title?
  published_at?     # 来源给出的发布时间
  discovered_at     # PIS 首次识别该条目
  content_id?       # Processing 后关联的 Content
  raw_data?         # Adapter 尽力获得的正文／摘要及来源原始数据（可选）
```

**采集与去重原则：**

1. 来源 API 支持明确的时间增量接口时，可以结合 `last_collected_at` 缩小请求范围；具体应遵守该来源的时间语义。
2. RSS 等仅暴露近期列表时，读取当前可见条目，优先利用来源自身的 `external_id` 识别已有条目；无法获得稳定标识时，可结合 URL、发布时间等已有数据做**尽力去重**。
3. **不能直接用 `published_at > last_collected_at` 过滤所有条目**：延迟上架、来源回填或晚同步的旧发布时间条目可能是在上次采集后才出现。
4. `isCollected` **不设置“明确重新发布”特殊判断分支**：优先依据 `external_id`，没有时依据 URL 与发布时间；若来源复用旧标识，V1 可能漏掉实际重发，若换了标识，可能重复接入原文。允许少量漏采／重复。
5. **只有本次采集成功、采集结果已经持久化后**，才更新 `last_collected_at`；不要求下游 Processing / Event / Knowledge 全部完成才推进采集检查点。

因此，`last_collected_at` 用于**采集增量检查点**，而 Source Item 的已保存标识用于**避免同一可见发布记录反复处理**；两者互补，不建立额外身份生成算法。

**来源正文持久化边界**：`SourceAdapter.fetchContent(entry)` 在 Collection 阶段尽力提供正文。entry 已含全文则直接使用；否则 Adapter 尝试按来源规则访问原文 URL，失败时回退至 entry 已有的可用正文或摘要。Source Item 的 `raw_data`（SQLite `TEXT`）保存可供 Processing 解析的来源数据与取得的正文／摘要（例如 JSON 序列化），**不新增文章正文字段或新表**。Processing 不负责外部 HTTP 抓取。

### 1.3 Content 字段与时间语义

```text
contents
  id
  title
  url?
  author?
  published_at?      # 原文发布时间
  created_at         # PIS 创建该 Content 记录的时间
  body
  summary?
  language?
  completeness
```

- 原 `Content.discovered_at` **正式改名为 `Content.created_at`**（注意采用 `created_at`，而不是 `create_at`），用于表达数据库记录的创建时间。
- `Source Item.discovered_at` 继续表示首次发现来源条目的时间；`Event` / `Event Update.discovered_at` 继续表示首次识别信息主线／有效进展的时间。
- **V1 一条成功处理的 Source Item 对应一份独立 Content**，不跨来源复用。`source_items.content_id` 在 Processing 完成前允许为空，成功保存后指向该 Source Item 的 Content。
- `contents.url` 不设置唯一约束；同一 URL 或正文被不同来源转载或明确重发，仍允许形成新的 Content。V1 **删除 `content_hash` 字段及索引**。

### 1.4 其他表与约束的延续

- `event_updates.event_id` 引用 Event；`knowledge.content_id` 唯一，确保一份 Content 最多一份 Knowledge。
- `event_content_links` 保留 `{target_type, target_id, content_id}`，支持 Event／Event Update 的多来源证据，正常执行中同一组合不重复。
- `event_entity_aliases` 保留 `{event_id, alias, content_id}`，同一 Event 的 LLM 已确认别名保存一条可追溯的 Content 来源；语义识别由分析 LLM 直接负责，程序只检查字符串结构并去重，无额外语义校验器；无需实体注册表或复杂多证据管理。
- `topic_associations` 保留 `{topic_id, target_type, target_id, matched_at}`；`published_items` 保留 `{id, target_type, target_id, title, summary, body, published_at}`。正常执行中同一源情报只发布一次，并要求至少匹配一个 Topic；`body` 中真实来源链接为可选，有链接则由业务层验证并附加，缺失不阻断发布。
- RSS Feed 是从已保存 Published Item 生成并上传云端的**静态 XML 投影**，不建立单独 RSS Item、归档成员或阅读器投递状态业务表；上传不在 SQLite 写事务内执行，SQLite 为唯一权威数据源。

### 1.5 SQLite 初始化 DDL（DB-03）

下列 SQL 是 V1 初始化结构，包含 **7 张核心表、4 张辅助表、必要索引及一组可重建的 FTS5 检索索引**。`event_search` 不是新的业务资产表。Source Item 不新增 `entry_key`，Collection 基于来源已有标识尽力避免重复采集；**Processing 不做跨文章去重，正常成功处理的 Source Item 与 Content 为一对一关系**。

```sql
-- PIS V1 / DB-03: SQLite schema baseline (2026-11-11)
-- 7 core tables + 4 auxiliary tables + one rebuildable FTS5 index.
-- All application timestamps use ISO-8601 TEXT normalized to +08:00.
-- Generate IDs and timestamp values in the application; do not rely on SQLite UTC CURRENT_TIMESTAMP.
-- Run PRAGMA foreign_keys=ON and PRAGMA busy_timeout on EVERY new connection.
-- WAL mode is a database-level setting; set during initialization.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 01 / Source: subscription configuration and Collection checkpoint.
CREATE TABLE IF NOT EXISTS sources (
    id                TEXT PRIMARY KEY NOT NULL,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    url               TEXT NOT NULL,
    cron              TEXT NOT NULL,
    enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    description       TEXT,
    last_collected_at TEXT
);

-- 02 / Content: one normalized result per successfully processed Source Item.
CREATE TABLE IF NOT EXISTS contents (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    author       TEXT,
    published_at TEXT,
    created_at   TEXT NOT NULL,
    body         TEXT NOT NULL,
    summary      TEXT,
    language     TEXT,
    completeness TEXT NOT NULL CHECK (completeness IN ('FULL', 'PARTIAL'))
);

-- 03 / Event: a continuing storyline, NOT a single incident.
CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY NOT NULL,
    title         TEXT NOT NULL,
    entity_name   TEXT NOT NULL,
    subject       TEXT NOT NULL,
    scope         TEXT NOT NULL,
    description   TEXT NOT NULL,
    occurred_at   TEXT,
    discovered_at TEXT NOT NULL
);

-- 04 / Event Update: substantive progression belonging to an Event.
CREATE TABLE IF NOT EXISTS event_updates (
    id            TEXT PRIMARY KEY NOT NULL,
    event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    occurred_at   TEXT,
    discovered_at TEXT NOT NULL
);

-- 05 / Knowledge: exactly zero or one primary Knowledge for a Content.
CREATE TABLE IF NOT EXISTS knowledge (
    id            TEXT PRIMARY KEY NOT NULL,
    content_id    TEXT NOT NULL UNIQUE REFERENCES contents(id) ON DELETE RESTRICT,
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL,
    category      TEXT CHECK (category IS NULL OR category IN ('Insight', 'Experience', 'Method', 'Resource')),
    findings_json TEXT NOT NULL CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
    value         TEXT NOT NULL
);

-- 06 / Topic: intentionally no focus, priority or scoring fields.
CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

-- 07 / Published Item: immutable readable snapshot; source links optional and validated when present.
CREATE TABLE IF NOT EXISTS published_items (
    id           TEXT PRIMARY KEY NOT NULL,
    target_type  TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE', 'KNOWLEDGE')),
    target_id    TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL,
    body         TEXT NOT NULL CHECK (length(trim(body)) > 0),
    published_at TEXT NOT NULL,
    UNIQUE (target_type, target_id)
);

-- A1 / Source Item: source identity is resolved from existing fields in application.
-- raw_data stores Adapter-acquired body/summary + source data when available.
-- No entry_key and NO uniqueness on URL, external_id, or publication time.
CREATE TABLE IF NOT EXISTS source_items (
    id            TEXT PRIMARY KEY NOT NULL,
    source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    external_id   TEXT,
    url           TEXT,
    title         TEXT,
    published_at  TEXT,
    discovered_at TEXT NOT NULL,
    content_id    TEXT REFERENCES contents(id) ON DELETE RESTRICT,
    raw_data      TEXT
);

-- A2 / Evidence: EVENT or EVENT_UPDATE to supporting Content.
-- The polymorphic target (type,id) is checked in application code.
CREATE TABLE IF NOT EXISTS event_content_links (
    target_type TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE')),
    target_id   TEXT NOT NULL,
    content_id  TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    PRIMARY KEY (target_type, target_id, content_id)
);

-- A3 / Confirmed core Entity aliases: one supporting Content per alias for V1.
CREATE TABLE IF NOT EXISTS event_entity_aliases (
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    alias      TEXT NOT NULL,
    content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE RESTRICT,
    PRIMARY KEY (event_id, alias)
);

-- A4 / Topic Association: only successfully matched targets are recorded.
-- The polymorphic target (type,id) is checked in application code.
CREATE TABLE IF NOT EXISTS topic_associations (
    topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
    target_type TEXT NOT NULL CHECK (target_type IN ('EVENT', 'EVENT_UPDATE', 'KNOWLEDGE')),
    target_id   TEXT NOT NULL,
    matched_at  TEXT NOT NULL,
    PRIMARY KEY (topic_id, target_type, target_id)
);

-- Normal relation / candidate lookup indexes (exclude duplicates of PRIMARY KEY / UNIQUE).
CREATE INDEX IF NOT EXISTS idx_source_items_ext
    ON source_items(source_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_items_url_pub
    ON source_items(source_id, url, published_at) WHERE url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_items_content
    ON source_items(content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_entity_name
    ON events(entity_name);
CREATE INDEX IF NOT EXISTS idx_event_updates_history
    ON event_updates(event_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_content_links_content
    ON event_content_links(content_id);
CREATE INDEX IF NOT EXISTS idx_event_entity_aliases_alias
    ON event_entity_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_topic_associations_target
    ON topic_associations(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_topic_associations_history
    ON topic_associations(topic_id, matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_published_items_feed
    ON published_items(target_type, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_published_items_latest
    ON published_items(published_at DESC, id DESC);

-- Rebuildable Event candidate index; one FTS row per Event containing its
-- fields, confirmed aliases, and all previous Event Updates' descriptions.
-- Rebuild this row inside the same short write transaction when the Event,
-- any Event Update, or its confirmed Entity aliases change.
-- trigram MATCH is not effective for short (1-2 character) expressions;
-- fallback to indexed entity/alias lookup and application-specific short queries.
CREATE VIRTUAL TABLE IF NOT EXISTS event_search USING fts5(
    event_id UNINDEXED,
    search_text,
    tokenize = 'trigram'
);
```

建表约束中：`knowledge.content_id` 唯一，`published_items(target_type, target_id)` 唯一，Topic Association 采用组合主键；对明确的普通引用使用外键；`target_type + target_id` 多态目标由业务层校验，不拆出多套业务表。`findings_json` 的 JSON 结构由业务层验证；Published Item 可没有来源链接，有真实来源链接时由业务层校验并附加。

### 1.6 各阶段短事务边界（DB-03）

**原则：先在事务外执行网络抓取、内容理解与 LLM 调用；再开启短写事务提交业务数据；提交成功后才派发下游内存任务。** 不在持有写锁时等待外部调用，也不跨业务阶段维持长事务。

| 阶段 | 短事务内必须作为一组提交的操作 | 事务外处理 |
|---|---|---|
| **Collection** | 写入本次新识别的 Source Item（包括 Adapter 尽力获取的正文／摘要 `raw_data`），并推进 `sources.last_collected_at` | Adapter 获取条目及原文、对照来源现有标识判断重复、请求失败时回退已有内容 |
| **Processing** | 为本次新 Source Item 创建独立 Content，并回写该 Source Item 的 `content_id`（同一短事务） | 读取 `raw_data`、正文解析和清洗；**事务提交后执行 `routeContent`**；不做网络原文补全或跨 Content 去重 |
| **Event Analysis** | 同一 Content 的全部 Event 判断结果、证据关联、`confirmed_aliases`（含 `content_id`）及受影响 Event 的 FTS 刷新作为一组提交 | 全历史候选召回、最近 10 条 Update 上下文、LLM 归属与新进展判断以及别名语义确认；程序仅格式校验与去重 |
| **Knowledge Analysis** | 保存有效 Knowledge；依靠 `UNIQUE(content_id)` 限制一份 Content 一条 Knowledge | LLM 判断阅读价值及 Findings |
| **Topic Matching** | 将本次成功的 Topic Association 批量插入；以当前有效 Topic 配置为本次判定依据 | 读取业务结果、LLM 批量判定相关 Topic |
| **Product Generation** | 校验目标情报和至少一条 Topic Association 存在，保存唯一 Published Item | V1 用模板生成正文快照；可选提取真实来源链接，缺失不阻断发布；不调用 LLM |

Collection 的检查点表示**已成功采集并保存本次发现结果**，不需要等待 Processing、Event 或 Knowledge 全部完成。保存条目与推进检查点必须在同一事务；采集失败不得推进。对仅提供近期条目列表的来源，不以 `published_at > last_collected_at` 作为硬性过滤条件。

上述业务步骤可按需要使用 `BEGIN IMMEDIATE` 开始写事务、遇异常 `ROLLBACK`，成功则 `COMMIT`；短事务实际实现由应用的数据访问层负责。与 PIS V1 已确认的容错要求一致：**COMMIT 与下游内存队列入队之间的进程故障可能造成遗漏**，目前不引入持久化任务、跨阶段事务或全链路 Exactly-once。

### 1.7 Event 检索索引维护（DB-03）

- `event_search` 是 SQLite FTS5 虚拟表，`event_id` 为不参与全文分词的业务引用字段，`search_text` 是由 Event 标题、Entity 规范名及已确认别名、Subject、Scope、Description、全部历史 Event Update 的标题／描述等拼接出的派生文本。
- **每个 Event 在逻辑上维护一条 FTS 检索行**。创建 Event、添加 Update 或确认 Entity 新别名时，对该 Event 重新汇总搜索文本，在保存业务数据的同一事务中更新该行；FTS5 本身不为 `event_id` 提供普通表的唯一约束，应用层需按约定先删除旧搜索行再插入一行。
- 如果派生索引丢失或损坏，可以由 `events`、`event_updates`、`event_entity_aliases` **重新构建**；原始业务事实只保存在普通表。
- 候选 Event 搜索同时使用规范名称／别名普通索引与 FTS5，合并候选后由 LLM 判断。对于短中文词语、同义表达和拼写变体，保留普通索引与必要的检索兜底；不限制旧 Event 被召回。
- `event_search` 是 Event Analysis 的内部候选召回设施，与模块 06 面向用户的历史检索不是同一业务模块。
- 对 `NO_INCREMENT` 的证据关联，确认具体旧 `EVENT_UPDATE` 时关联该 Update；无法确认对应的旧 Update 时关联 `EVENT`。`event_content_links` 联合主键去重；应用层还需核对多态引用类型、Update 所属 Event、同一 Content 的冲突动作。没有新的任务处理状态字段。

### 1.8 SQLite 连接、字段约定与校验

- **初始化**：启用 WAL；每个连接显式执行 `PRAGMA foreign_keys = ON` 和 `PRAGMA busy_timeout = 5000`。SQLite 的 WAL、单写者模型不代表全链路事务或并行写入。
- **主键与时间**：稳定字符串 ID 由应用生成；所有时间字段存 ISO 8601 `TEXT`，规范化为 `+08:00`（如 `2026-11-11T15:30:00+08:00`），不依赖 SQLite `CURRENT_TIMESTAMP` 生成业务时间。
- **布尔与 JSON**：布尔字段使用 0 / 1 和 `CHECK`；Finding 存 `knowledge.findings_json`，由 SQL 校验 JSON 数组形式、应用校验每项业务字段。
- **发布前校验**：检验来源情报存在、至少匹配一个 Topic、正文必填且可读。原始来源 URL 为**可选**；有则校验合法性并附加到正文，没有也允许发布，不允许伪造链接。
- **测试范围**：SQLite DDL 需通过建表、外键、Source Item / Content 一对一唯一约束及 FTS5 基础测试；项目集成测试还需验证 Collection 重复采集识别、Processing 独立创建 Content、Event 进展归并、事务提交与 RSS 客户端行为。

**阶段状态**：数据库表结构与事务约束继续作为冻结基线；Collection、Processing、Event、Knowledge、Topic Matching、Product Generation 和 Runtime 的复核结果由《技术实现设计》维护；五个功能 Prompt 和独立 User Context 已确认并由 Markdown/Git 管理，不增加 Prompt 相关数据库表。P0 API 新增限制仍以用户确认结果为准。


---

## 2. 跨文档一致性约束

| 业务概念 | 数据库规则 |
|---|---|
| Source Item → Content | Collection 的 Adapter 将尽力获取的正文放入 `source_items.raw_data`；每条成功处理的 Source Item 生成自己的 Content；`source_items.content_id` 可空（未处理），非空时唯一；不跨来源复用 |
| Content 标识 | `contents.created_at` 是 PIS 记录创建时间；不使用 `contents.discovered_at` 或 `content_hash` |
| Event 首次发现 | `events.description` 保存初始事实；初始 Event 不额外建立第一条 Update |
| Event 新进展 | `event_updates.event_id` 为真实外键；证据关系可追溯多个 Content |
| Knowledge | `knowledge.content_id` 唯一；Finding 保存在 `findings_json` 而不是独立表 |
| Topic 匹配 | `topic_associations` 仅保存成功关联，不保存分数或无匹配结果 |
| Published Item | `UNIQUE(target_type,target_id)`；存在 Topic Association 且正文有效即可发布，来源 URL 可选，存在时才校验合法性 |
| 静态 RSS 归档 | 使用现有 `published_items` 的稳定排序索引生成最新 200 条及静态归档，不新增 RSS 分页状态表或阅读状态表；云端封存归档自身保存 GUID 边界 |

**跨阶段一致性边界**：业务事务 `COMMIT` 后才派发下游内存任务；Processing 先提交 Content 后才做 `routeContent`，路由失败时可复用既有 Content 重试。RW-03 已确认：上游已成功提交而下游入队失败时，**只重试尚未入队的任务，不重新执行业务处理**。进程崩溃仍可能漏派，属于 V1 已接受的限制；外键和短事务约束照常执行。

## 3. SQLite DDL 验收项

- [ ] 用实际运行的 SQLite 版本执行整份初始化 DDL，检查 FTS5 trigram 与 JSON 函数可用。
- [ ] 验证主外键约束、`knowledge.content_id` 唯一、`published_items(target_type,target_id)` 唯一。
- [ ] 验证相同 `source_items.content_id` 非 NULL 时被唯一索引拒绝，多个 NULL 允许存在。
- [ ] 验证事件全文索引可在一次写事务中随 Event / Update / 确认别名更新，且可从业务表重建。
- [ ] 验证基于 `(published_at, id)` 的静态 RSS 生成排序，主文件最新 200 条与封存归档联合覆盖全部历史（跨文件按 GUID 去重）；封存归档 URI/字节稳定性、云端同步恢复由技术设计和测试用例验收。
- [ ] 验证 `last_collected_at` 只随采集结果在同一事务中成功提交。
- [ ] 验证 Adapter 已有全文直接使用、缺少时抓原文、抓取失败退回已有正文／摘要；Processing 不发起 HTTP。
- [ ] 验证 Content 成功提交后 `routeContent` 失败的 ProcessTask 重试不会新建第二份 Content。

> 本 DDL 是**新建数据库的初始化结构**，不是针对历史运行库的自动迁移脚本。若未来存在旧库，请单独设计迁移并验收，不能简单重复执行 `CREATE TABLE IF NOT EXISTS` 视为完成结构变更。
