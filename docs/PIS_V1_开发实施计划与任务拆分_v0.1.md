# PIS 个人情报系统 · V1 开发实施计划与任务拆分

> **版本**：v0.1 · 2026-11-14  
> **状态**：**任务拆分已于 2026-11-14 经用户确认，作为 V1 正式实施基线**；17 个里程碑（D00～D16）、69 个独立任务均已定义。**确认任务拆分不代表任务已开发或测试通过**；各任务默认 `NOT_STARTED`。领域事实与验收以既有三份主设计及《PIS V1 测试用例设计 v0.2》为准。  
> **目的**：把大模块拆成上下文短、改动边界清楚、可独立复核的开发任务；**Knowledge Analysis 和 Event Analysis 独立里程碑**，Event 再拆为检索与判定写入。  
> **任务标识**：`D00-T01` … `D16-T05`；独立于原测试用例的 `DB-/COL-/EVT-…` Case ID。  
> **实施基线**：TypeScript（strict）+ Node.js LTS；Fastify、better-sqlite3 + 直接 SQL、Zod、Node.js 原生 fetch、Promise/async-await 有界内存队列、node-cron、Pino、PM2；SQLite + WAL/FTS5；五个 Prompt + User Context；静态 RSS 云端发布，Gitee Raw/GitHub Pages 仍待选择。

---

## 1. 执行原则

1. **一个 Worker 一张任务卡**：一次只实现一个任务，不把完整 17 个里程碑交给同一个 Worker。单任务只阅读指定章节、少量已有接口与对应测试行；不用反复加载全部 3 份设计和 201 个测试用例。
2. **接口先于集成**：在每个阶段开始时由 Lead 确定输入/输出、已有依赖和错误行为；模块单测采用固定 Stub/Fixture，未实现的上下游通过最小 Fake 隔离。
3. **数据库先行，领域边界不漂移**：以现有 11 张业务表及可重建 FTS5 为准；数据库同步写事务中不做 HTTP/LLM。禁止未经确认新增队列表、Outbox、持久化任务状态、ORM、微服务、审核 Agent。
4. **每个任务都有可执行证据**：至少包含该任务的定向测试和 `npm run typecheck`（脚本名由 D00 固化）；涉及数据库写入检查事务回滚与重复执行；新旧 Case ID 逐项映射。`S0/S1` 的真实模型语义回归与 P0 固定 Stub 测试分开。
5. **阶段交接只传任务 ID**：六类业务任务的结果由 Runtime 负责派发，不让业务模块直接管理下游队列。允许在阶段实现期直接调模块方法测试；D15 再做完整编排。
6. **先本地闭环，再云端发布**：在选定 Gitee/GitHub Pages 前用本地文件与 Fake Publisher 测试生成/归档/恢复；云端真实发布只有 D13 后半段需要服务商决定。
7. **关键用户决策不得猜测**：Source `type/url` PATCH 政策、云端平台与部署协议、API Cursor/错误码、外部访问限制等在明确的任务前收敛。已确认的技术栈不再反复讨论。
8. **明确验收状态**：每项任务标记 `NOT_STARTED / IN_PROGRESS / BLOCKED / REVIEW / PASS / FAIL`。未实现、未执行测试不能算完成；所有里程碑默认 `NOT_STARTED`。

### 1.1 交付与验收分工

- **Architect**：维护领域/架构边界，批准每个里程碑的接口约束，**每项 Lead 验收之后尽早复核**，发现跨模块偏差就退回本任务修正；不等里程碑末才检查。
- **Lead**：一次拆出一张 Worker 任务卡，定义允许修改的目录、最小依赖文件、Case ID；Review 代码、测试与变更范围，保证下一个任务可直接基于已合入结果开展。
- **Worker**：仅完成分派的任务，返回代码/测试/验证命令/变更说明/未决问题，不自行扩大范围或偷偷改变合同。
- **合并门槛**：测试通过、类型检查通过、Architect 认可后合并；同一代码位置尽量串行修改，降低多 Agent 冲突。

### 1.2 建议工程目录（示意，不强制新增抽象）

```text
src/
  app/               # Fastify 启动、进程生命周期、装配
  db/                # better-sqlite3 连接、schema、DAO、事务
  config/            # Source/Topic 管理与配置校验
  adapters/          # RSS Source Adapter、正文获取
  collection/
  processing/
  llm/               # fetch、五类结构化 Schema、Prompt 文件读取
  knowledge/
  event/             # search/ 与 analysis/ 可内部拆分
  topic-matching/
  publication/       # Published Item 与模板
  rss/               # XML、封存归档、Publisher
  retrieval/
  runtime/           # Scheduler / Queue / Worker
config/prompts/      # 唯一 Markdown Prompt 原文
sql/                 # 从已确认数据库文档提取/维护 schema.sql
tests/              # unit / integration / e2e / semantic
```

> 目录仅用于缩短上下文、划分修改所有权；**不得为了对齐目录创建空服务层或通用基类**。源代码中的实际文件名由首个对应任务固定，后续任务引用已存在文件。

---

## 2. 已确认的实施里程碑总览（17 个 / 69 个任务）

| 里程碑 | 独立交付目标 | 前置依赖 | 可验收出口 |
|---|---|---|---|
| **D00 工程骨架** | 可编译、可测试、可启动的 Node.js 工程 | 无 | typecheck/test/build/smoke |
| **D01 数据库基础** | 11 表、FTS5、WAL、事务与 DAO 基础 | D00 | 临时 SQLite 集成测试 |
| **D02 Prompt/LLM 基础** | 五类 Prompt 热读取、Zod、可替换 LLM Stub | D00 | 固定 JSON 与读取失败测试 |
| **D03 Source/Topic 配置** | 配置读写及 Fastify 管理 API | D01 | CFG / API 配置测试 |
| **D04 RSS Adapter 与正文获取** | RSS 列表/可用全文/摘要降级 | D00 | 本地 HTTP Fixture 测试 |
| **D05 Collection** | Source Item 去重、采集检查点、派发结果 | D01,D03,D04 | COL 系列测试 |
| **D06 Processing** | Content-first 保存与路由 | D01,D02,D05 | PRO 系列测试 |
| **D07 Knowledge Analysis** | Knowledge 价值判定、唯一性、返回目标 ID | D02,D06 | KNO 系列测试，**独立验收** |
| **D08 Event Search** | 检索线索、历史候选、FTS/别名、最近 10 条上下文 | D01,D02,D06 | EVT 检索类测试 |
| **D09 Event Analysis** | NEW_EVENT/NEW_UPDATE/NO_INCREMENT 写入、证据、别名 | D08 | EVT 判定类测试，**独立验收** |
| **D10 Topic Matching** | 三种目标统一匹配并保存关联 | D07,D09（接口可先使用 Fake） | TOP 系列测试 |
| **D11 Published Item** | 模板生成、发布门槛、唯一快照 | D10 | PUB 系列测试 |
| **D12 本地静态 RSS** | 两类 XML、主文件与 200 条封存归档 | D11 | RSS 生成/归档测试 |
| **D13 云端 Publisher** | 抽象发布、启动同步、实际云端适配 | D12 | Fake 测试 + 实地人工验证 |
| **D14 Retrieval / HTTP API** | 四类历史查询、Cursor、来源追溯、鉴权 | D03,D09,D11 | API 查询测试 |
| **D15 Runtime 编排** | 六类任务有界 Worker、Cron、重试、关闭 | D05–D14 的业务接口 | RUN 系列测试 |
| **D16 端到端验收** | Knowledge/Event/双路径、云端 RSS 与语义回归 | D13–D15 | E2E + P0 + S0/S1 报告 |

**依赖说明**：D07 与 D08/D09 不互相依赖；可分别交给不同 Lead/Worker，但避免并发编辑 D01/D02 公共代码。D10 可先验证 Knowledge 目标，再接入 Event 类型；正式里程碑验收要求三种目标齐全。D12 的静态 RSS 可以脱离真实云端验证，D13 选择平台之前不阻塞前序任务。

---

## 3. 细分任务卡（每次只派发一行）

> **已确认：以下 69 张任务卡即开发执行清单**，不要重新压缩为旧 M0～M5 大任务。表中的 Case ID 是**优先验收样例**而非模块全部测试；每个里程碑最终仍要覆盖其相关 P0。任务卡的最小阅读材料是《技术实现设计》对应节、数据库对应表定义和**测试文档中引用的 Case ID 行**；其它文件按真实依赖再授权。

### D00 · 工程骨架（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D00-T01** | 初始化 `package.json`、TypeScript strict、Node LTS 版本约束、锁文件；明确 ESM/CJS 一种，不引入框架式脚手架 | `npm run typecheck`、`npm run build` 成功；无 Bun/Kotlin |
| **D00-T02** | 建立测试运行器、Fixture、测试临时目录、可控 Clock 与 ID 生成接口 | 假时钟/ID 测试可重复；时间输出默认 `+08:00`，不把机器本地时区作为隐式依赖 |
| **D00-T03** | 初始化 Fastify 空服务、健康检查、Bearer 配置输入与基础 Pino 日志（不提前实现全部 API） | 应用启动/正常关闭 smoke；健康检查可用；无 Token/完整正文泄漏 |
| **D00-T04** | 搭建 CI/本地统一脚本、代码格式和开发 README；列出已确认技术栈与尚待配置项 | 独立 checkout 能 install/typecheck/test/build；代码审查可复制命令 |

**D00 Gate**：干净环境能从零启动、运行固定测试并关闭；后续任务有稳定测试/类型检查基础。**不要求**这一步打通全部队列、RSS 或真实 LLM。

### D01 · SQLite 与事务基础（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D01-T01** | 集成 `better-sqlite3`、连接参数、WAL、外键、busy timeout；独立临时 DB | `DB-01`,`DB-02`；确认 Node 原生模块与目标运行时能安装 |
| **D01-T02** | 将数据库设计文档中的冻结 DDL 作为唯一初始化源；验证 11 表、索引/枚举/JSON 约束 | `DB-03`～`DB-08`、`DB-15`；不增表/隐式 ORM migration |
| **D01-T03** | 封装最薄事务与同步 SQL 执行辅助；统一 SQLite 错误分类和时间格式 | `DB-09`,`DB-10`,`DB-12` 基础；短事务 rollback，`+08:00` ISO TEXT |
| **D01-T04** | 实现 Event FTS5 trigram 建立、更新一条、全量重建工具；暂不写 Event 语义 | `DB-11`,`DB-14` 初始版；中文词/别名命中；验证无误触发旧数据删除 |

**D01 Gate**：现有 DDL 由真实目标驱动无改表运行；WAL、FTS5 trigram、JSON、短事务验证通过；若 trigram 不可用，**标 BLOCKED 并交 Architect**，不擅改检索模型。

### D02 · Prompt、LLM 客户端与严格 Schema（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D02-T01** | `PromptRepository` 每次调用前从磁盘读取实际 Markdown；Knowledge 分别读取两份文件 | `PMT-08`～`PMT-10`,`PMT-13`；修改文件立即影响下一次调用，不缓存 |
| **D02-T02** | Zod 定义五类 Prompt 响应的严格业务结构与 branch 校验 | `PMT-07`,`PMT-14`,`PMT-15`；拒绝额外字段/非法枚举/缺失 ID，`valuable=false` 合法分支 |
| **D02-T03** | 原生 `fetch` 实现最小 LLM 请求封装，支持 Provider URL/密钥/模型参数；与业务逻辑分离 | HTTP Mock 验证请求、超时/取消、错误分类；密钥不进入日志 |
| **D02-T04** | 固定 StubLLM 和输入 spy，五类指令独立测试；任务数据与 Prompt 指令分离 | 固定 JSON 回归稳定；不使用真实 LLM 作为 P0 测试前提 |

**D02 Gate**：五个 Prompt Markdown 是唯一文本源，代码负责 JSON 合法性；**不**增加 Prompt 数据库/模板管理后台/单独审核 Agent。

### D03 · Source/Topic 配置与管理 API（3 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D03-T01** | Source/Topic Repository，启用/停用/修改与唯一标识；Source `last_collected_at` 只由采集维护 | `CFG-01`,`CFG-02`,`CFG-05`,`CFG-06` |
| **D03-T02** | Source 管理端点 GET/POST/PATCH + 输入校验；只改配置，不触发六阶段业务任务 | `API-01`,`API-10`,`API-13`；在本任务前决定 `type/url` PATCH 策略 |
| **D03-T03** | Topic 管理端点 GET/POST/PATCH + 认证和校验；修改不回溯旧对象 | `API-02`,`CFG-04`,`CFG-07`；未授权不写数据 |

**D03 Gate**：API 能维护真实 Source/Topic；不写删除接口、不回溯历史、不允许配置 API 篡改采集检查点。

### D04 · RSS Source Adapter（3 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D04-T01** | `SourceAdapter` 接口 + RSS 列表/entry 基础解析与完整元数据映射 | 本地 RSS XML Fixture；外部请求不进入事务；`COL-01` 的适配器前半部分 |
| **D04-T02** | `fetchContent`：条目自带全文直接复用；否则在必要时抓原文网页 | `COL-08`,`COL-09`；已含正文不再请求原文 |
| **D04-T03** | 抓取失败时保留来源部分正文/摘要；超时、重定向、大小、MIME、私网边界 | `COL-10`,`COL-15`,`COL-16`；阈值在任务中登记为部署配置，不臆定业务规则 |

**D04 Gate**：对可用原文与仅有摘要的源均得到稳定可序列化 SourceContent；本阶段不写 Source Item 表。

### D05 · Collection（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D05-T01** | 以 `external_id` 优先、否则 URL+发布时间进行库内已采集判断和批内去重 | `COL-02`～`COL-07`,`COL-17`,`COL-18`；不跨 Source 去重 |
| **D05-T02** | 来源采集单飞控制、获取新 entry 并仅对新条目调 Adapter 的正文方法 | `COL-08`,`COL-14`；禁用 Source 不请求网络（`CFG-03`） |
| **D05-T03** | 一个短事务保存新 Source Item 与采集开始检查点，提交后返回 IDs | `COL-01`,`COL-11`,`COL-12`；异常不推进检查点、无部分提交 |
| **D05-T04** | Source Item `raw_data` 边界、空正文合法输入、收集结果的任务契约；增加独立 Collection fixture 测试 | `COL-13`,`COL-16`,`E2E-13` 的采集部分；结果仅含新 Source Item ID |

**D05 Gate**：`collect(sourceId)` 输入 Source ID，返回新 Source Item ID 集合；阶段本身不建 Content、不调分析 LLM、不直接派发队列。

### D06 · Processing（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D06-T01** | `raw_data` 提取/清洗、规范 Content DTO 与 FULL/PARTIAL 判定 | `PRO-01`～`PRO-03`,`PRO-11`,`PRO-12`；不访问网络 |
| **D06-T02** | 单事务创建 Content 并回写 Source Item 关系；已存在 Content 直接复用 | `PRO-04`～`PRO-06`；Source Item→Content 一对一 |
| **D06-T03** | 已提交 Content 后调用 P-01 Route，校验 EVENT/KNOWLEDGE/BOTH/空 | `PRO-07`,`PRO-08`,`PRO-10`；空路由保留 Content |
| **D06-T04** | 返回 `{contentId,routes}`，建立 Test Spy 防止 Processing 中原文 HTTP、验证二次路由 | `PRO-09`,`PRO-12`,`E2E-11` 的 Processing 部分 |

**D06 Gate**：Content 已 COMMIT 才运行 LLM 路由；失败重试复用旧 Content，而不是重复插入；下一阶段依据 routes 决定分析。

### D07 · Knowledge Analysis（独立里程碑，4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D07-T01** | 组装 Knowledge 模型输入：Content + P-04 + User Context，不混入 Topic | `KNO-06`,`PMT-09`；spy 可验证读取文件与输入分离 |
| **D07-T02** | 严格解析 `valuable=true/false`、Category、Findings 与可空合法值 | `KNO-02`,`KNO-08`,`KNO-11`,`KNO-12` |
| **D07-T03** | `valuable=true` 写入一份 Knowledge（Findings JSON 内嵌）；唯一约束、短事务 | `KNO-01`,`KNO-03`,`KNO-04`,`KNO-05`；回滚/重复执行 |
| **D07-T04** | Knowledge 模块返回新 `knowledgeId` 或空；固定 Stub 端到端到模块边界 | `KNO-01`,`KNO-02`；新 ID 可交给 Topic Matching；`KNO-07`,`KNO-09`,`KNO-10` 留到语义回归 |

**D07 Gate**：无须 Event、RSS、Topic Matching 已开发；给定一份 Content 和 Stub P-04，即可判定是否保存一份 Knowledge 并返回 ID。**此时单独验收并冻结 Knowledge 模块接口**。

### D08 · Event Search / 候选召回（独立里程碑，4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D08-T01** | P-02 提取多组 `{entity_name, subject, search_terms}`；允许合法空线索 | `EVT-06`,`EVT-21`；不持久化临时检索词 |
| **D08-T02** | 实体标准名、确认别名与 Event 全历史 FTS5 候选检索；结果去重/相关性排序 | `EVT-10`,`EVT-22`,`EVT-23`,`EVT-24` 的搜索部分；不以时间硬排除旧事件 |
| **D08-T03** | 给 P-03 组装 Event 基本信息 + **最近 10 条** Update 的稳定排序上下文 | `EVT-11`,`EVT-23`；检索用所有历史，模型上下文仅最近 10 条 |
| **D08-T04** | `EventSearchService` 对外输出候选 DTO 与最小可复现 Mock 测试，包含多事项与无候选 | `EVT-06`,`EVT-21`,`EVT-22`；不写 Event/Update |

**D08 Gate**：搜索是只读能力；测试能证明多年未更新且线索只在较早 Update 的 Event 仍被召回。此阶段不实现 NEW_EVENT 等写入。

### D09 · Event Analysis / 新主线与进展（独立里程碑，5 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D09-T01** | P-03 决策 JSON 验证：NEW_EVENT/NEW_UPDATE/NO_INCREMENT，候选 ID/Update 归属、冲突 Action | `EVT-05`,`EVT-15`,`PMT-14`；非法不写库 |
| **D09-T02** | NEW_EVENT 写入 Event 初始事实和 Content 证据；不额外建初始 Update | `EVT-01`,`EVT-07` 的新主线分支 |
| **D09-T03** | NEW_UPDATE 写入独立进展，归属已有 Event，同 Content 同 Event 重复执行复用记录 | `EVT-02`,`EVT-08`,`EVT-09`,`EVT-17` |
| **D09-T04** | NO_INCREMENT 只增证据、不新建进展；confirmed_aliases 有证据、去重、刷新 FTS | `EVT-03`,`EVT-04`,`EVT-12`～`EVT-14`,`EVT-18`,`EVT-24` |
| **D09-T05** | 将 P-02 候选与 P-03 决策组合，短事务提交多个结果后返回新目标 ID 集合 | `EVT-07`,`EVT-16`,`EVT-21`～`EVT-23`,`E2E-14` 的分析部分；失败全部回滚 |

**D09 Gate**：Event 初始、进展、无增量三种分支单独通过；多个 Event 可在一篇 Content 中并存；数据库证据/别名/FTS 同事务。**与 D07 分离验收**，不要求 RSS 已实现。

### D10 · Topic Matching（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D10-T01** | 三类目标构造最小匹配 DTO：Event、Event Update（含父 Event 基础）、Knowledge | `TOP-01`,`TOP-09`,`TOP-14`; 不载入 Event 全历史 |
| **D10-T02** | 一次 P-05 对启用 Topic 快照批量匹配；严格校验返回 ID/重复/非法 | `TOP-03`～`TOP-05`,`TOP-10`,`TOP-12` |
| **D10-T03** | 匹配成功在短事务建立 Topic Association；多 Topic 不多次派发 | `TOP-02`,`TOP-08`,`TOP-11`,`TOP-15`；无匹配不写关联 |
| **D10-T04** | 已关联或已发布的目标重复运行，按既有关系复用/跳过；禁用 Topic 不删除历史 | `TOP-06`,`TOP-07`,`TOP-13`,`TOP-16` |

**D10 Gate**：Topic 是唯一关注条件；已记录 Association 不追溯变更；零匹配则没有 PublishTask 资格；可单独测 Event/Knowledge 三类目标。

### D11 · Published Item 与模板（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D11-T01** | `PublicationRenderer` 模板接口，Event / Update / Knowledge 三种渲染，不调用 LLM | `PUB-01`,`PUB-10`,`PUB-13`；正文 HTML 安全编码 |
| **D11-T02** | 收集真实来源 HTTP(S) 链接、去重/校验；来源 URL 缺失不阻断发布 | `PUB-06`～`PUB-08`,`PUB-13` |
| **D11-T03** | Published Item 的目标存在性/Topic 资格验证及 `(target_type,target_id)` 唯一短事务保存 | `PUB-02`～`PUB-05`,`DB-13`；多 Topic 只发布一份 |
| **D11-T04** | Published Item 不可变性、重复 PublishTask、事务回滚与提交后的 RSS 同步通知接口 | `PUB-09`,`PUB-11`,`PUB-12`；通知失败不重写快照 |

**D11 Gate**：合法的已匹配目标能生成独立可阅读快照；没有 Topic 匹配绝不发布。此时可先手工驱动模块形成本地 Knowledge 纵向链路。

### D12 · 本地静态 RSS 生成与归档（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D12-T01** | Published Item → RSS 2.0 + `content:encoded`，区分 Event Updates 与 Curated Content | `RSS-01`～`RSS-07`，中文/HTML/时间稳定 |
| **D12-T02** | 主 Feed 最新 200 条、固定 200 条封存批次、RFC 5005 静态归档链 | `RSS-08`～`RSS-10`,`RSS-17`；两类独立计算 |
| **D12-T03** | 不可变归档 URI/字节、迟到数据/时钟回拨、同名冲突安全拒绝 | `RSS-11`,`RSS-24`；不得重写已封存字节 |
| **D12-T04** | 使用本地文件/FakeObjectStore 生成完整可部署文件集，验证 UTF-8 XML、秘密路径、安全引用 | `RSS-12`～`RSS-14`,`RSS-18`；不依赖实际云端 |

**D12 Gate**：`Published Item → 文件集合` 完整工作；200/200 归档和静态 URI 验收通过；**不必决定 Gitee/GitHub Pages**。已存在历史资产不因新数据而修改旧 Archive。

### D13 · 云端 RSS Publisher（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D13-T01** | `RssArtifactStore`/Publisher 适配接口：列举、读、暂存、原子版本发布意图 | Fake Publisher 验证主文件最后对外可见、失败不删数据库（`RSS-20`,`RSS-22`） |
| **D13-T02** | 同类 Feed 串行/合并通知、发布冲突保护、启动重新同步 | `RSS-19`～`RSS-21`,`RSS-23`；不反向覆盖新版本 |
| **D13-T03** | **决策门槛**：实际 RSS 阅读器和中国大陆网络实测 Gitee Raw / GitHub Pages；二选一并记录具体仓库/分支/更新延迟 | `RSS-15`,`RSS-16`（P1 人工证据）；未决定时 **BLOCKED**，不让 Agent 单方选择 |
| **D13-T04** | 只为最终选中的平台编写一个 Git/API/Pages 发布适配器与操作文档 | 实际固定 URL、匿名 XML、完整归档、上传失败与重试、迁移演练（`RSS-23`） |

**D13 Gate**：在线订阅地址正常，主 Feed/归档可读；公开仓库的随机路径**不是访问控制**，禁止把密钥/数据库推送到发布仓库。D13-T03/T04 是唯一必须先做平台决策的任务。

### D14 · Retrieval 与 HTTP JSON API（4 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D14-T01** | 四类查询 Repository：Topic 关联、Event/Updates、Knowledge/Content、Published Item | `API-03`～`API-06`,`API-14`；能由 Content 追溯 Source Item/Source |
| **D14-T02** | Fastify GET/详情路由与对象/错误 DTO，不在请求中启动业务队列 | `API-04`～`API-06`,`API-08`; 与配置端点保持一致 |
| **D14-T03** | 一致分页 `limit`/cursor 和排序规则，规定 Cursor 编码与 400/404 等协议细节 | `API-07`,`API-11`,`API-12`; 端点间一致，不允许重复/漏页 |
| **D14-T04** | 全量 API Bearer 权限、过滤/异常输入与敏感响应/日志边界 | `API-09`,`API-10`,`API-13`,`API-15`；RSS 随机路径不能替代 Bearer |

**D14 Gate**：Web/Agent/CLI 能查询既有情报，无需读取 RSS 文件；RSS 通过外部静态服务提供，PIS 不加 `/feeds/...` 动态接口。

### D15 · 六阶段 Runtime 与调度（5 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D15-T01** | 定义六类 Task/Result 的 TypeScript 判别联合；统一纯结果到下游任务映射 | `RUN-01`,`RUN-02`,`RUN-12`；仅传 ID，无模块私自操作队列 |
| **D15-T02** | 每阶段独立有界内存队列、初始一个 Worker；启动并处理背压 | `RUN-08`,`RUN-09`；不死锁，处理结果仍由 Runtime 派发 |
| **D15-T03** | 任务业务最多 2 次技术重试，非技术空结果/取消不重试；已 COMMIT 只重试未入队的下游 | `RUN-03`～`RUN-07`,`RUN-15`,`RUN-16`；不重复业务写入 |
| **D15-T04** | `node-cron` 对启用 Source 调度，校验时区与 Cron 规则、手工触发适配 | `CFG-03`,`CFG-07`,`RUN-09`；不调用未启用 Source |
| **D15-T05** | 停止新增任务、继续内部派发、队列与执行中排空、超时取消、PM2 进程守护配置 | `RUN-10`,`RUN-11`,`RUN-13`,`RUN-14`；可接受崩溃漏派，不新增持久化状态 |

**D15 Gate**：六阶段完整编排可运行；背压、错误分类、下游入队重试与停机边界独立验证。云端 RSS 同步通知不成为第七种业务任务。

### D16 · 端到端验收与真实模型回归（5 个任务）

| ID | 单任务范围 / 输入 | 验收证据 |
|---|---|---|
| **D16-T01** | **Knowledge 主路径**：RSS → Collection → Processing → Knowledge → Topic → Published Item → 本地/云端 RSS | `E2E-04`,`E2E-05`,`E2E-07`,`E2E-11`；Mock 模型可重复 |
| **D16-T02** | **Event 主路径**：NEW_EVENT → NEW_UPDATE → NO_INCREMENT、别名与来源证据 | `E2E-01`～`E2E-03`,`E2E-08`,`E2E-10`,`E2E-14` |
| **D16-T03** | **跨路径/发布历史**：同文双路径、多 Topic 唯一 GUID、两 Feed 归档完整性 | `E2E-06`,`E2E-09`,`E2E-12`,`E2E-13` |
| **D16-T04** | 真实模型的独立语义回归：固定输入、可控模型参数、人工判读标签和错误记录 | `PMT-01`～`PMT-06`,`PMT-11`,`PMT-12`,`EVT-19`,`EVT-20`,`KNO-07`,`KNO-09`,`KNO-10`；不并入 P0 硬性全字匹配 |
| **D16-T05** | 输出全部 P0 覆盖矩阵、未通过/阻塞项、部署/迁移文档、真实 RSS 客户端人工验收记录 | 逐项 Case ID → PASS/FAIL/BLOCKED/NOT_RUN + 测试路径；P0 未覆盖不宣称 V1 完成 |

**D16 Gate**：固定 Stub 的所有对应 P0 可重复通过；语义误判和平台兼容性有独立报告；业务边界不被“为了让测试通过”私自修改。

---

## 4. 关键先后策略：尽早得到可用成果

**第一轮只推进 D00～D07（Knowledge）**：不需要一次实现 Event 全链路。达成 D07 Gate 后，可用固定 Content/Topic 和 Fake 按后续接口演示 Knowledge 的价值判断、唯一持久化及下游 ID；D10～D12 完成后再做 RSS 纵向串通。这样将模型输入、数据库与发布的职责分开验收。

**第二轮推进 D08～D09（Event）**：重点验证历史候选召回和事实新进展逻辑。因为 Event 源自多个阶段且语义风险最高，拆为纯检索与决策落库两个里程碑，尽可能用固定 P-02/P-03 输出分别验收。

**第三轮推进 D10～D12（匹配→产品→本地 RSS）**：先让 PIS 在本地生成真实可读的 RSS XML。D13 的平台选择与上线在这一轮末单独决策，不影响前面工作。

**第四轮推进 D13～D16（接入云端、查询、编排和系统验收）**：Runtime 不必等到此时才设计六种任务类型；D00 的工程骨架与每阶段 Result DTO 已为它准备必要接口，D15 主要解决统一队列和生命周期。

### 4.1 里程碑阻塞规则

- D01 FTS5 trigram 不兼容：标记 D01 阻塞，向 Architect 提交驱动/DDL/构建环境证据，**不可自行改成 LIKE/向量检索**。
- D03 `type/url` PATCH 规则没定：只阻塞 D03-T02，不阻塞 Source Repository/Topic API。
- D13 未选 Gitee Raw 或 GitHub Pages：只阻塞 D13-T03/T04 与实际线上验收，不阻塞本地 RSS 和 API。
- LLM Provider 或模型暂缺：使用固定 Stub 完成 P0；独立标记真实 S0/S1 无法运行。
- D14 精确 Cursor 编码/错误码没定：由 Lead 记录最小规范并交 Architect 审核后开发，不擅自推断为旧系统的动态 RSS Cursor。

### 4.2 每个任务必须交回的最小验收包

```text
任务 ID / 所属里程碑：D09-T03 / D09
前置任务及其已合并版本：D08-T04, D09-T01, D09-T02
允许修改目录/文件：<Lead 指定>
读取的设计材料：技术实现设计 §11.2；数据库设计 Event/Update/证据；测试 EVT-02/08/09/17
实现说明：<最多 5 行>
测试清单：<Case ID → 自动化测试文件 + PASS/FAIL>
执行证据：<typecheck/test 命令与摘要>
影响数据结构或 Prompt：否；如是必须逐项说明并复核
已知限制/未决问题：<无需处理的本任务以外事项>
Lead Review / Architect Review：PASS / FAIL / REVIEW
```

### 4.3 可直接交给 Lead 的初始任务指令

> 仅处理 `Dxx-Tyy` 一个任务；先确认其前置任务已合并，读取本任务所指定的设计章节、数据库表、测试 Case ID 和实际依赖代码。输出最小实现方案（接口、修改文件、测试），再指派 Worker 编码与自测；合并前跑定向测试与 typecheck，核对相应 Case ID。严禁扩展到其他里程碑、修改已确认的领域行为、增加持久化队列或重选已确认技术栈。Lead Review 后立即提交 Architect 复核，不等整个里程碑完结。

---

## 5. 文档与基线关系

| 文档 | 在开发中的作用 | 本计划的处理方式 |
|---|---|---|
| `PIS_总体架构与设计原则_v1.0.md` | 领域边界与对象语义 | **权威业务基线**；仅补实施计划入口，不更改领域语义 |
| `PIS_数据库设计_v1.0.md` | 11 表 DDL、FTS5、约束与事务 | **权威 DDL 基线**，不得随 Agent 任意改表 |
| `PIS_技术实现设计_v1.0.md` | TypeScript 实施契约、六阶段、Prompt、静态 RSS/API | 已同步 2026-11-14 技术选型与 TS 风格伪代码 |
| `PIS_V1_测试用例设计_v0.2.md` | 201 个 V1 Case ID、P0/P1/S0/S1、验证证据 | **不更改 Case ID**；§5.3 已同步 D00～D16，旧 M0～M5 不再作为执行入口 |
| `config/prompts/*.md` | 五个功能 Prompt + User Context | 唯一维护源，任务实施期按需读取 |

**最终约束**：每个任务小、可复核、能回滚；每个里程碑有独立 Gate；真实 LLM 质量与确定性业务测试分离；首版不追求复杂的运行一致性保证。目标是提高每一轮 Agent 的成功率，而不是引入新的系统复杂度。
