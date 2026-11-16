# D03 Spec · Source/Topic 配置与管理 API

> 版本：v0.1
> 状态：APPROVED · Architect G2
> 依据：已获负责人批准的 [Intent v0.1](intent.md)、技术设计 §5.1/5.3、数据库设计 §1.5/1.8、测试设计 CFG 与 API 配置用例。
> 代码基线：`6b5a52c`；生产实现基线为已推送并通过 CI 的 `40d9efe`。

## 1. 边界与负责人决定

仅实现 D03-T01～T03。Source 创建后 type/url 不可修改，覆盖项目设计和测试文档中该项原有“待定”记录，批准来源为负责人原话“已有的 source 不允许修改 type和URL”。不改 D01 DDL，不实现删除、抓取、调度、LLM、历史查询或历史重分析。

## 2. 数据与校验契约

使用现有 sources/topics 表；JSON 字段使用数据库同名 snake_case，enabled 输出为 boolean、入库为 0/1。不新增 created_at/updated_at 字段，不建立名称或 URL 唯一约束；每条记录由既有 IdGenerator 生成稳定独立 ID，重复名称或 URL 仍允许新建记录。

所有写输入使用同一组 Zod strict object 校验，不 strip 未知字段、不强制转换类型。Repository 也执行同一校验，不能仅依赖 HTTP 层。API/Repository 共用类型和规则，不维护两套字段约束。

| 对象 | POST 字段 | PATCH 字段 | 返回字段 |
|---|---|---|---|
| Source | name/type/url/cron 必填；enabled 缺省 true；description 缺省 null | name/cron/enabled/description | id/name/type/url/cron/enabled/description/last_collected_at |
| Topic | name/description 必填；enabled 缺省 true | name/description/enabled | id/name/description/enabled |

- name 和 Topic description：字符串，trim 后非空；保存原始字符串，不静默改写内容。
- Source description：string 或 null；允许空字符串，PATCH null 清空。
- enabled：严格 boolean；不接受 0/1、字符串或 null。
- V1 可创建 Source type 为 `RSS`，与现有 Fixture 和 D04 RSS Adapter 对齐；不为尚未实现的 Adapter 接受虚构类型。后续扩展走相应设计变更。
- url：非空、无首尾空白的绝对 HTTP(S) URL，WHATWG URL 可解析；禁止 userinfo（含解析会消除的空 userinfo）、fragment 和控制字符，禁止 file/data/javascript 等协议。保留合法输入原文，不联网验证，不做 DNS 请求。HTTP(S) 私网来源不在本阶段一刀切封禁；后续 Adapter 在真实访问时承担重定向/DNS/目标访问策略，当前校验不宣称完整 SSRF 防护。
- cron：非空字符串，使用 `node-cron@4.6.0` 的 validate 验证五字段或六字段语法；保存原文。该精确版本 npm 元数据要求 Node >=20，与本项目 Node 26.13.1 兼容，实际安装/typecheck 在 T01 验证。只允许为此新增 node-cron 及其锁文件变化，不调用 schedule/createTask。未来执行时区为 Asia/Shanghai，本阶段不接受逐 Source timezone 字段。
- POST 不接受 id、last_collected_at；新 Source 检查点为 null。PATCH 不接受 id、type、url、last_collected_at，即使提交值与现有值相同，也整单拒绝。Source 普通更新 SQL 不包含这些列。
- PATCH 至少有一个允许字段；空对象、null、数组、未知字段、非法字段组合整单失败；缺省字段保持原值。同值合法 PATCH 返回当前对象，不算错误。
- ID 是不透明非空字符串，按现有生成器生成，不强制 UUID 格式（允许确定性测试 ID）；SQL 全部参数化。

## 3. Repository 与持久化

提供 SourceRepository、TopicRepository 的同步 create/getById/list/update 能力，构造时注入已初始化的 Database 与 IdGenerator。list 返回全部配置（含停用项），按 id ASC 稳定排列；内部另提供 listEnabled，确保后续消费者可明确读取启用配置。HTTP 列表本阶段不提供历史查询 Cursor/过滤 DSL，不接受查询参数；技术设计 §5.2 的历史列表分页留给 D14。

create 返回完整持久化对象；getById/update 对不存在 ID 返回 null，由 HTTP 转 404；list 空结果为 []。校验失败使用安全的配置输入错误，不暴露输入原文、SQL、DB 路径或底层 cause。发生 ID 冲突时不重试生成另一个 ID，按存储错误处理。单对象写入完成后才返回成功；多 SQL 写读组合可使用 D01 同步短事务，失败整体回滚。禁止跨 await 事务。

更新只触及目标配置表；不得改 Source Item、Topic Association、Published Item 或检查点。不添加 Collection 检查点写方法，不派发任务。Repository 不持有/关闭调用者的连接，不直接读取环境变量。

## 4. HTTP 契约

| 方法/路径 | 成功结果 |
|---|---|
| GET /api/sources、GET /api/topics | 200，`{ items: [...] }` |
| GET /api/sources/:id、GET /api/topics/:id | 200，完整对象 |
| POST /api/sources、POST /api/topics | 201，完整对象 |
| PATCH /api/sources/:id、PATCH /api/topics/:id | 200，更新后完整对象 |

两个管理路由组封装在 Fastify 插件范围内，复用 D00 Bearer 逻辑，在 onRequest 鉴权后才解析/验证业务输入和调用 Repository。无 token、错误 token、重复 Authorization 均 401，沿用 `{ error: "unauthorized" }` 和 WWW-Authenticate: Bearer。已有 /health 行为保持兼容。

| 失败 | HTTP | body |
|---|---|---|
| JSON/字段/空 PATCH/不可变字段/查询参数非法 | 400 | `{ error: "invalid_request" }` |
| 详情或合法 PATCH 的 ID 不存在 | 404 | `{ error: "not_found" }` |
| JSON 请求体超默认 1 MiB | 413 | `{ error: "payload_too_large" }` |
| 不支持的 Content-Type | 415 | `{ error: "unsupported_media_type" }` |
| D01 判定 busy/locked 存储错误 | 503 | `{ error: "storage_unavailable" }` |
| 其他未预期存储/内部错误 | 500 | `{ error: "internal_error" }` |

配置路由错误处理覆盖解析与校验错误，不回显 Fastify/Zod 原始 message、字段值、URL query、SQL 或异常 cause。未知路由维持 Fastify 既有 404，不为 DELETE 或 D14 路由提供业务处理。混合合法/非法 PATCH 必须在任何写入前整体拒绝。无授权的有效或非法写请求均不得查询/修改配置数据。

沿用现有安全请求日志，不新增配置正文、Authorization、Source URL 或错误原文日志。错误 handler 限定在管理路由范围，避免改变既有 health/lifecycle 语义。

## 5. 服务装配与资源生命周期

目前 buildApp 只注册 health，main 使用 buildApp。D03 必须把真实持久化路由接入默认启动入口，不能只在测试手工注册。

- loadConfig 增加 `DATABASE_PATH`，默认 `./data/pis.sqlite`，显式空白值拒绝；路径不出现在错误或日志。AppConfig 为兼容既有注入测试可增加可选 databasePath，loadConfig 始终返回已解析配置。生产 DB 不使用 :memory:（D01 要求 WAL），测试使用独立临时文件。
- buildApp 可增加可选 Repository 依赖。传入时由调用者管理其 DB 生命周期；未传入时建立自己的持久化连接：创建父目录、调用 D01 openDatabase/initializeDatabase、创建 repositories，注册管理路由。不改表结构。
- owned DB 初始化/路由装配失败立即关闭；成功装配后注册 onClose 关闭一次。关闭发生在请求处理结束后。普通 app.close、监听失败、SIGINT/SIGTERM 路径复用已有生命周期；不得绕开修复后的 ready/completed 协议，不重复执行 Fastify close hooks。
- 现有 buildApp 测试和进程 smoke 必须显式使用临时 DB 路径或注入 repositories，避免测试创建/污染默认 ./data；清理 WAL/SHM/目录。新增真实进程 smoke 验证默认 main 挂载配置 API、重启后数据保留、退出关闭；集成测试不可只测注入替身。
- `.gitignore` 精确添加 `/data/` 防止默认运行数据库入 Git；不改变真实 User Context 忽略规则。README 说明 DATABASE_PATH、创建/修改 API、type/url 不可变、Cron 仅校验及持久化路径。
- T02 负责默认 Source 路由与 DB 装配/配置/关闭；T03 在同一装配上加入 Topic 路由，复用连接，禁止每请求开库。

## 6. 验收矩阵

| 项 | 证据 | 边界 |
|---|---|---|
| CFG-01/02 | 临时文件 DB 创建、重开后读取、稳定 ID、enabled 映射及缺省值 | 两个 repository |
| CFG-05/06 | 普通更新不改检查点/历史关联/发布；清空可空 description | 不执行 Runtime |
| D03-IMMUTABLE-01 | PATCH type/url 不同值、相同值、与合法字段混合均 400；库完全不变；直接 Repository 非法输入也拒绝 | 用户决定新增专项用例，不冒用旧 Case ID |
| CFG-07/API-10 | 类型、未知字段、非法 URL/Cron、空 PATCH；无部分写入 | Zod 与真实 node-cron 校验 |
| API-01/02 | 两组 GET/POST/PATCH，404、列表排序、空列表、启停及不重复建 ID | Fastify inject + 临时真实 DB |
| API-13 | 缺失/错误/重复 token 的 POST/PATCH，响应 401，配置和检查点不变 | 非法请求体也不能绕过认证 |
| CFG-03/04 | listEnabled 排除停用配置，修改不触发任务 | 调度跳过与真实 Matching 快照仍 NOT_RUN |
| 数据/错误安全 | 注入 busy/internal 错误、非法 body、私密 sentinel；响应/日志不回显；重复 name/url 可保存 | 不使用真实私有数据 |
| 服务集成 | 默认 main 持久化、重启、正常/失败关闭；既有 D00 smoke 回归 | 防止路由仅在测试存在 |

不新增随机/真实网络依赖。复用 D01 临时 DB、ID 替身与 D00 Fastify/logger 基础；新增测试应证明不变量，不镜像内部实现。每卡定向 + 完整 verify；干净快照 npm ci + verify；远程 CI 需本里程碑另行 push 授权。真实模型、实际 RSS 抓取、调度与历史匹配明确 NOT_RUN。

## 7. G2 复核与交接

Architect G2：APPROVED。数据边界沿用冻结 DDL；type/url 决策有负责人授权；API 字段/失败/事务/生命周期均可独立验证；无新增服务、业务表或后台任务。新增 node-cron 仅校验，URL 不联网，Cron 不执行。当前没有需要负责人重新决定的架构取舍。

Lead 按本 Spec 编写三卡文件级 Plan，尤其固定 T02 的装配/配置/关闭测试范围、临时 DB 隔离、依赖引入及锁文件边界。若发现上游约束冲突，应提交可定位问题，由 Architect 修订 Spec，不自行改契约。不委派 Worker，直到 Plan 经 Architect G3 且负责人审阅批准执行。
