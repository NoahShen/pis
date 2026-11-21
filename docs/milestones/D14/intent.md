# D14 Intent — Retrieval 与历史查询 HTTP JSON API

- 状态：APPROVED（负责人于 2026-11-21 授权编写文档并直接进入开发）
- 前置：D03、D09、D11 已合并；D11A～D13 提供可运行的真实数据基线。
- 基线：main `c42995235a0d4cbf18313340861712ed64c57ad1`。

## 目标

为 Web、Agent 和 CLI 提供只读历史查询 API，直接读取 SQLite 中既有 Topic、Event、Knowledge、Content 和 Published Item 资产，支持稳定分页、详情和来源追溯，无需读取静态 RSS 文件。

## 范围

1. 四类查询 Repository：Topic 关联、Event/Updates、Knowledge/Content、Published Item。
2. Fastify GET 列表与详情路由、统一对象和错误 DTO。
3. 一致的 `limit`/cursor 分页、确定性排序及连续新增数据边界。
4. Bearer 鉴权、输入校验、SQL 参数化和敏感日志边界。
5. Content → Source Item → Source 的可空来源链及 Event 证据 Content 引用。

## 固定约束

- 只读查询，不在请求中启动 Collection、Processing、分析、匹配、发布或 RSS 同步，不调用 LLM。
- 不改数据库 schema、六阶段任务、Prompt、Published Item、RSS XML 或云端发布行为。
- 不新增依赖；沿用 TypeScript strict、Fastify、better-sqlite3 直接 SQL、Zod。
- 动态 JSON API 使用 Bearer Token；RSS 随机公开目录不能替代 API 鉴权。
- 不新增 `/feeds/...` 动态接口，不把 RSS 游标语义套用到 JSON API。

## 非目标

不做全文/自然语言/语义搜索、复杂查询 DSL、物理删除、OAuth、多租户、每 Topic Feed、写操作或前端页面。D13 延期人工验收和 D16 系统级验收不在本里程碑补签。

## 验收

API-03～API-15 对应自动化证据通过；超过 200 条可完整分页且不漏不重；可空/异常来源链安全处理；非法输入受控 4xx 且无 SQL/堆栈泄漏；全部受保护路由拒绝无/错 Bearer；merge 后全量 Gate、精确 SHA Linux CI Success。生产装配与干净快照 smoke 验证查询可使用既有真实数据库。
