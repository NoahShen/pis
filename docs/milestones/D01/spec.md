# D01 Spec · SQLite 与事务基础

> 版本：v0.1 · 2026-11-15
> 状态：APPROVED · Architect G2 审核通过
> 依据：[D01 Intent v0.1](intent.md)，项目负责人已通过 G1。
> 前置代码基线：D00 `8f5681081507a738d072fd9c965f037e7facebd0`，本地及远程 CI 已通过。

## 1. 范围与设计依据

本规格落实既有 D01-T01～T04，不改变业务模型。权威 DDL 为 [数据库设计](../../PIS_数据库设计_v1.0.md) §1.5；事务、时间和 FTS 规则来自该文档 §1.6～§1.8。任务边界沿用 [任务拆分](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) D01，验收映射沿用 [测试设计](../../PIS_V1_测试用例设计_v0.2.md) §4.10。

提供数据库连接、初始化、SQL 执行、事务和 FTS 维护函数。业务代码直接写 SQL，不引入 ORM、通用 Repository 基类、依赖注入框架或业务服务。D01 不把数据库接入 HTTP 服务的启动/关闭路径，不新增 API 或 DB 环境变量；未来组合根显式传入数据库路径和连接。模块导入不打开文件、不初始化数据库。

## 2. 工具链、连接和资源管理（T01）

- 沿用 Node 26.13.1 / npm 11.20.0、TypeScript strict、NodeNext ESM。运行依赖使用 better-sqlite3，必要类型包作为开发依赖，均固定精确版本并更新锁文件。
- Lead 在 Plan 中提供候选精确版本与 Node 支持依据；T01 实际验证 native 模块安装、加载、SQLite 版本、JSON 和 FTS5 trigram。依赖声明不能替代实测；不兼容时报告 BLOCKED，不擅自切换 Node 或驱动。
- `openDatabase(path)` 接收明确的文件路径，返回 better-sqlite3 连接；设置 WAL、`foreign_keys=ON`、`busy_timeout=5000`，并确认设置生效。配置失败时关闭已创建的连接，再向调用方报告错误。
- WAL 的验收使用真实文件数据库，不能以 `:memory:` 的结果替代。路径的父目录由调用方准备；不创建全局数据库或私密配置目录。
- 连接创建与建表分开；打开既有数据库不自动执行初始化或迁移。调用者拥有连接，必须在 finally 中关闭；不缓存全局连接。
- 测试复用 D00 的临时目录工具，每次创建独立 DB，先关闭全部连接，再清理目录及 WAL/SHM 文件。连接失败及断言失败也须清理。
- 需要真实锁竞争的测试使用独立进程或 Worker thread；不能在同一事件循环阻塞等待时依赖定时器释放另一连接的锁。保持生产 busy_timeout=5000，测试预算包含等待和清理。

## 3. 初始化与冻结 DDL（T02）

- 将数据库设计 §1.5 唯一 SQL 代码块原样保存为工程 SQL 文件。该文件是可运行副本，权威仍为设计文档；自动化测试比较二者内容，仅允许换行符规范化，不维护第二份可独立改动的结构定义。
- Plan 确定 SQL 文件的源码位置、构建复制步骤与产物路径。生产模块从自身模块位置解析 SQL 文件，编译产物不依赖当前工作目录或 docs 目录。构建只复制必要 SQL 资源，不复制整个文档目录。
- `initializeDatabase(db)` 显式初始化数据库。WAL 等连接设置在事务外完成，建表、索引与 FTS 创建作为同一事务完成；执行冻结 DDL 前，连接已按 §2 配置。冻结 DDL 中重复设置相同 PRAGMA 不得用来替代每连接配置。
- 空库初始化成功；在本阶段已创建且未改结构的库上重复调用应保留原数据。失败回滚本次结构写入，不留部分初始化的业务结构。此接口不是历史库升级器，不承诺修复任意旧 schema。
- 精确验证以下 11 张业务表：sources、contents、events、event_updates、knowledge、topics、published_items、source_items、event_content_links、event_entity_aliases、topic_associations；另有 event_search 虚拟表。SQLite 自动生成的 FTS shadow tables 和 autoindexes 不计作新增业务表。
- 验证冻结索引、CHECK、普通外键、唯一约束及联合主键，不增加 content_hash、entry_key、状态表或 schema 版本表。测试不得通过改 DDL 放宽失败断言。
- `findings_json` 在 SQL 层只要求有效 JSON 数组；数组元素字段校验由后续业务层负责。多态 target_type/target_id 不具备普通外键，D01 用测试明确这一事实，不添加虚构的数据库约束。

## 4. SQL、事务、错误与时间（T03）

### 4.1 SQL 执行

SQL 通过 better-sqlite3 的 prepare/get/all/run 执行；业务输入使用参数绑定，不拼接进 SQL。可直接复用驱动接口，公共函数仅用于本阶段实际重复的事务、错误分类等操作，不必另造一套通用查询语言。函数同步返回结果或抛错，不返回 Promise。

### 4.2 事务行为

- `withTransaction(db, callback)` 同步执行回调并返回其结果。顶层写事务使用 BEGIN IMMEDIATE；多条写入全部成功才提交，任一步异常则整体回滚并向调用者抛出原错误，不返回伪成功。
- 回调只包含数据库和必要的内存计算，不包含 HTTP、LLM、队列派发或 await。TypeScript 接口禁止 Promise 返回值；运行时在调用前拒绝可识别的 async 函数，回调意外返回 thenable 时拒绝并回滚，不能把 Promise 当作成功结果提交。
- 对返回 thenable 的回调，不能声称回滚能够取消它已启动的异步副作用。接口文档明确禁止这类调用，测试验证提交未发生；不引入异步事务支持。
- 已有事务内的嵌套调用使用 SAVEPOINT，成功只释放自己的保存点，不提交外层事务；外层失败必须同时撤销内层写入。复用驱动的事务机制，避免手工重造状态机。
- 锁竞争由驱动按 busy timeout 等待，之后抛出错误；本层不循环重试、不派发任务。Runtime 重试留到后续里程碑。

### 4.3 错误和时间

- 提供纯函数按 SQLite 错误 code 区分 busy/locked、constraint、其他 SQLite 错误与未知错误，保留原错误供调用方处理；不按易变的 message 字符串分类。分类名称与 TypeScript 类型由 Plan 固定。
- 错误分类不自动记录 SQL 参数、正文、完整数据库路径或配置；本阶段无需新增日志事件。后续日志只使用安全操作名和错误类别。
- 复用 D00 Clock、IdGenerator 和 formatTimestamp；业务时间写入使用参数值，格式为 `YYYY-MM-DDTHH:mm:ss.SSS+08:00`。不依赖 SQLite CURRENT_TIMESTAMP，不为已有字段强制填入同一个时间。
- 数据库仍是冻结的 TEXT 结构，不额外加入时间 CHECK 或触发器。D01 验证基础格式与存取，完整字段语义随业务模块验收。

## 5. Event FTS 维护（T04）

### 5.1 派生文本

对每个 Event 聚合 title、entity_name、subject、scope、description、已确认 alias，以及全部历史 Event Update 的 title/description。字段之间使用明确分隔符；别名和 Update 以稳定顺序读取，重复重建得到相同文本。排序规则由 Plan 明确，不依赖数据库默认行序。

不读取未确认别名，不调用 LLM，不使用“最近 10 条”截断历史索引。最近 10 条仅属于后续提供给模型的候选上下文，不适用于 FTS 文本。

### 5.2 单条刷新与全量重建

- `refreshEventSearch(db, eventId)` 以参数化 `DELETE ... WHERE event_id = ?` 清理该 Event 的全部旧索引行，再插入一条重新聚合的行；其他 Event 不受影响。Event 不存在时只清理其残留索引，不创建虚构业务记录。
- 刷新在同一事务内完成；调用方已有事务时使用 §4 的保存点，允许未来业务写入与 FTS 更新一起提交或回滚。
- `rebuildEventSearch(db)` 在一个事务中清空派生 FTS 行，从全部 Event/Update/Alias 重新生成。中途失败恢复旧索引，不删除任何原始业务数据。空数据库重建成功且得到空索引。
- 反复刷新不能制造重复行；全量重建能消除人为注入的重复/过时索引行。event_id 为 UNINDEXED 字段，不把它当作 SQLite UNIQUE 约束。
- 不新增触发器自动维护业务语义，不采用 contentless FTS 的特殊删除指令；严格按现有普通 FTS5 DDL 操作。

### 5.3 检索能力边界

使用真实 trigram MATCH 验证至少三个字符的合成中文词及别名能命中，历史线索超过最近十条仍能索引。1～2 字符词通过既有 entity_name/alias 普通索引的精确查询验证；不要求 trigram 命中短词，也不将任意短子串模糊搜索作为 D01 承诺。

这些是数据库层的检索验证，不实现公开搜索 API、候选排序或模型上下文；完整候选合并、去重与检索策略由 D08 负责。trigram 不可用必须 BLOCKED，不替换为 LIKE 或向量库。

## 6. 测试与分阶段证据

| 任务 | 必须验证的行为 | Case 映射 |
|---|---|---|
| T01 | 锁文件安装和 compiled ESM 导入原生模块；SQLite/JSON/trigram 能力；两个真实连接的 PRAGMA；异常清理 | DB-01 运行时部分、DB-02 |
| T02 | DDL 副本一致；11 表及索引；重复初始化保留数据；初始化失败回滚；枚举/布尔/JSON、唯一、普通外键及联合主键 | DB-01、DB-03～08 数据库部分、DB-15；DB-13 仅说明数据库能力边界 |
| T03 | 成功提交、故障全部回滚、嵌套事务、拒绝异步回调；真实锁竞争与错误分类；时区独立的时间存取 | DB-09/10/12 基础部分 |
| T04 | 单 Event 恰好一行；全历史及别名；刷新不影响另一 Event；删除索引不删业务事实；全量重建一致及失败回滚；短词索引查询 | DB-11、DB-14 初始版 |

- 使用真实隔离 SQLite 数据库和最小合成数据；不能用 mock SQL 执行结果冒充约束、回滚或 FTS 验证。
- 复用 D00 确定性时钟/ID 与临时目录工具，不访问真实外部服务。故障注入不向生产接口添加测试专用参数或公开端点。
- 现有 D00 服务测试与 5 个真实进程 smoke 保持通过。数据库能力另以编译产物导入/运行验证，不能仅靠源码测试证明 SQL 资源打包可用。
- `npm run verify` 保持本地和 CI 的统一入口；新增数据库测试进入 npm test。必要构建资源复制及 compiled DB 验证由 Plan 明确，不能因新增文件被格式脚本遗漏而绕过格式检查。
- 干净 checkout 执行 npm ci + npm run verify，本地 darwin-arm64 和既有 ubuntu-latest CI 均需真实证据；远程未执行时标 NOT_RUN，不能宣称最终跨平台验收通过。
- DB-09 六阶段事务、DB-10 全业务时间语义、DB-12 Runtime 重试、DB-13 业务拒绝悬空目标等保留到对应模块。进度逐条注明部分覆盖，不能把基础测试标为整项业务 PASS。

## 7. Plan 与变更控制

Lead 在新的 Paseo 会话编写文件级 Plan，列出：四卡依赖、允许修改路径、精确依赖版本、固定接口、SQL 文件复制与一致性校验方式、真实锁竞争方法、失败注入方法、测试与 compiled DB 验证命令、格式白名单必要变更、每卡审核证据。

T01 可先验证运行时能力，完整 DDL 在 T02 集成；不为提前满足 DB-01 而把 T02 全部实现塞入 T01。不得在 G3 前派发正式编码 Worker。项目负责人另明确要求：Plan 完成后先交其审核；即使 Architect 已通过 G3，也必须等待负责人明确批准执行后才能委派 Worker。批准后每卡新 Worker，会同 Lead/Architect 逐项审核，未通过不合并或标 PASS。

不修改原有未跟踪 config/、Prompt、权威 DDL或 D00 生命周期代码。Node/驱动替换、结构变化或测试基线冲突须先报告并重走受影响门禁。批准的普通实现选择由 Lead/Worker 自主落实，不重复请求负责人确认。

## 8. G2 审核记录

- 审核者：Architect（当前会话）。
- 结论：APPROVED。
- 依据：已批准 Intent；冻结 DDL、事务与 Event 索引契约；现有 D01 任务与 DB 验收项。
- 复核结果：未变更业务结构、技术选型或里程碑范围；明确同步事务边界、嵌套提交规则、SQL 资源打包及 FTS 原子维护；区分数据库能力测试与后续业务测试。
- 未决实施项：依赖精确版本及安装方式、文件路径和测试细节由 Lead 在 Plan 中落实并经 G3 审核。实际兼容性由 T01/T02/T04 验证，不预先宣称通过。
- 下一步：委派 Paseo Lead 编写 Plan；未过 G3 不进入正式开发。
