# D14 Plan — Retrieval 与历史查询 HTTP JSON API

- 状态：G3_APPROVED · Architect
- 基线：G3 文档 closeout C0；顺序 T01 → T02 → T03 → T04
- 固定约束：新增依赖 NONE；禁止改 schema/迁移/索引、六阶段任务、Prompt、RSS/发布行为；仅 GET 参数化 SELECT，不调用 LLM，不启动流水线。

## T01 Repository 契约、实现与真实 SQLite Fixtures

**Base / 文件**
- Base：G3 文档 closeout C0；独立实现，路由集成前可合入。
- `src/retrieval/contracts.ts`：Repository 输入/输出契约、固定 DTO、错误类型。
- `src/retrieval/repositories/topic-repository.ts`
- `src/retrieval/repositories/event-repository.ts`
- `src/retrieval/repositories/knowledge-content-repository.ts`
- `src/retrieval/repositories/published-item-repository.ts`
- `src/retrieval/repositories/shared.ts`：参数化 SELECT、固定列/排序映射、DTO 组装、异常关联保护。
- `tests/fixtures/retrieval.ts`：真实临时 SQLite fixtures。
- `tests/retrieval/topic-repository.test.ts`
- `tests/retrieval/event-repository.test.ts`
- `tests/retrieval/knowledge-content-repository.test.ts`
- `tests/retrieval/published-item-repository.test.ts`

**范围 / 验证**
- 实现 Topic 关联、Event/Updates/evidence、Knowledge/Content 可空来源链、Published Item target/topics；`findings_json` 安全解析，损坏详情 target 为 null，必要对象缺失走 not-found。
- 列表先实现确定性时间/ID 降序和基础 limit 查询；T03 统一增量补游标，禁止另造分页协议。
- 定向：`npm test -- tests/retrieval/topic-repository.test.ts tests/retrieval/event-repository.test.ts tests/retrieval/knowledge-content-repository.test.ts tests/retrieval/published-item-repository.test.ts`；覆盖 API-03～06/14 数据语义及 query-only 数据库可读。

**禁止**
- 禁止路由/生产装配、写 SQL、运行时写库、修改既有模型/任务、现场匹配/抓取/发布/重渲染。
- 禁止 `any`/隐式 any、字符串拼接 SQL 值、吞掉必要 not-found、额外依赖和 schema 改动。

## T02 Routes、轻量装配、生产装配与 Route/Integration Tests

**Base / 文件**
- Base：T01 已 Lead/Architect 验收的合并提交。
- `src/retrieval/routes.ts`：全部只读 GET routes、基本详情 404、统一 `{error}` DTO。
- `src/retrieval/dto.ts`（如确需路由响应转换；不得复制 Repository 查询）。
- `src/retrieval/index.ts`：修改，导出并装配 retrieval routes。
- `src/configuration/route-registry.ts`：修改，注册 retrieval routes 并沿用既有 Bearer 保护。
- `src/configuration/app-assembly.ts`：注入同一 SQLite 连接并完成轻量装配。
- `src/production/application.ts`：完成生产装配。
- `tests/retrieval/routes.test.ts`
- `tests/retrieval/routes.integration.test.ts`

**范围 / 验证**
- 实现 spec §2 全部列表/详情响应；详情内嵌 updates 全量稳定排序，evidence/topics 和可空来源链符合契约。
- 基本 ID 校验、父对象缺失优先 404、空列表 200、404 DTO 精确；响应 JSON 类型正确。过滤参数及完整严格输入协议统一在 T03 实现。
- 轻量 buildApp 与 production assembly 均注入同一连接，关闭责任仍在既有装配层；GET 不改库。安全与鉴权全量验证统一在 T04 完成。
- 定向：`npm test -- tests/retrieval/routes.test.ts tests/retrieval/routes.integration.test.ts`；覆盖 API-03～06/14 基本 GET DTO、详情及生产 integration。

**禁止**
- 禁止新增写端点、`/feeds/...` 动态接口、公开绕权、Runtime/Scheduler/LLM/RSS Publisher。
- 禁止改变既有路由鉴权与写配置行为；禁止 Repository 外另写 SQL；禁止宽松接受未定义参数。

## T03 Pagination Helper、Repository/Routes 增量与分页测试

**Base / 文件**
- Base：T02 已验收合并提交。
- `src/retrieval/pagination.ts`：严格 limit、base64url JSON v1 cursor 编解码、过滤绑定、固定排序键校验。
- `src/retrieval/repositories/shared.ts` 及 T01 四个 Repository：limit+1、确定性 keyset WHERE、next cursor。
- `src/retrieval/contracts.ts`、`src/retrieval/routes.ts`：接入统一分页、过滤上下文及全部严格 query/枚举/时间校验。
- `tests/retrieval/pagination.test.ts`
- `tests/retrieval/routes-pagination.test.ts`
- 必要时仅增量修改 T01/T02 对应测试，不重写既有数据语义断言。

**范围 / 验证**
- 完整过滤与输入协议：未知/重复 query、非法 ID/枚举/ISO offset 时间、after>before 均 400；只允许 spec 定义的参数。
- limit 默认 50、1～200，拒绝空值/符号/小数/前导空白/非数字/越界；cursor 无 padding，仅 v1 + 排序键 + tie-breaker ID + 已绑定过滤。
- 非法 base64url/JSON/大小/类型/版本/键值/跨过滤复用均 400；仅存在下一行时给 cursor，末页 null。
- 覆盖 Topic items、Events、Event Updates、Knowledge、Published Items 五类列表；知识按 Content created_at，过滤闭区间且 after>before 400。
- 超过 200 条、默认/上限、同刻 ID、连续新增、跨页不漏不重；历史页不重复/错位。
- 定向：`npm test -- tests/retrieval/pagination.test.ts tests/retrieval/routes-pagination.test.ts`，再跑 T01/T02 retrieval 全部定向测试；覆盖 API-07/08/10～12/15 中过滤、分页与受控 400 项。

**禁止**
- 禁止 offset 分页、RSS 游标语义、事务快照承诺、客户端排序列/SQL、cursor 携带正文/Token/任意查询。
- 禁止放宽输入协议、改变排序方向/时间键、为通过测试补数据或修改 schema/依赖。

## T04 Security、Production Smoke、README 与 Full Final

**Base / 文件**
- Base：T03 已验收合并提交。
- `tests/retrieval/security.test.ts`：危险输入、错误泄漏、只读与全受保护路由鉴权。
- `tests/retrieval/production.integration.test.ts`：生产装配和隔离临时数据库副本查询 smoke（T02 已覆盖则只增量补缺）。
- `README.md`：retrieval API、鉴权、严格过滤/分页、来源链与只读边界的使用说明。
- `docs/milestones/D14/progress.md`：逐卡证据、最终验证、精确 SHA CI 记录。
- 仅在定向安全证据暴露缺陷时修改 D14 已列文件；不得借机扩展范围。

**范围 / 验证**
- 安全全量：SQL 参数化、危险字符串仅绑定、400/401/404 无 SQL/堆栈/Bearer/配置秘密/内部绝对路径；所有新旧受保护 API 无/错 Bearer 均拒绝且 401 带 `WWW-Authenticate: Bearer`，RSS 路径不赋权，写配置不变，GET 前后数据库不变。
- 生产：将既有真实数据库复制到隔离临时位置，仅以该副本执行查询；不得打开或修改默认数据库；`query_only` 可完成查询，资源关闭行为不变。
- 干净快照：用 `git archive` 导出精确候选 SHA，可复用既有依赖、不必 `npm ci`；必须执行 `npm run verify` 及隔离临时副本生产查询 smoke。
- 最终门禁：全部 retrieval 定向测试 + `npm run verify`；合并 main 后记录精确 SHA，确认 GitHub Linux CI Success，方可标 PASS。

**禁止**
- 禁止新增依赖/schema 变更、写入真实数据库、启动 Collection/Processing/分析/匹配/发布/RSS、补签 D13/D16 验收。
- 禁止虚构 smoke/CI 证据、以未合并 SHA 代替最终 main SHA、修改 Published Item/RSS 行为或扩大查询 DSL。
