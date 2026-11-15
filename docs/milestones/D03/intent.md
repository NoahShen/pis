# D03 Intent · Source/Topic 配置与管理 API

> 版本：v0.1
> 状态：REVIEW · 等待项目负责人 G1 审核
> 起草：Architect
> 实现基线：`40d9efeb21e8c94480dbdc644f09be0ac17d7a9f`；D01 数据库与 D02 Prompt/LLM 基础均已验收，远程 CI 已通过。

## 1. 问题与目标

系统已有 HTTP 与数据库基础，但尚不能通过管理 API 维护采集源和关注主题。D03 让经认证的调用方创建、查询、修改、启用及停用 Source/Topic，并将配置持久化，为后续采集和 Topic Matching 提供配置入口。

权威依据：

- [项目开发规范](../../project-development.md) §3～§6。
- [任务拆分](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) §3 D03、§4.1。
- [技术实现设计](../../PIS_技术实现设计_v1.0.md) 的 HTTP API、Collection 与 Topic Matching 契约。
- [数据库设计](../../PIS_数据库设计_v1.0.md) 的 Source/Topic 定义；沿用 D01 已冻结的表结构。
- [测试设计](../../PIS_V1_测试用例设计_v0.2.md) CFG-01～07、API-01/02/10/13；仅落实本阶段配置行为，不把后续调度或匹配执行声明为已验收。

## 2. 范围

| 任务 | 交付目标 | 验收映射 |
|---|---|---|
| D03-T01 | Source/Topic Repository：创建、查询、修改及启停；稳定 ID；保护采集检查点 | CFG-01/02/05/06 |
| D03-T02 | Source 列表/详情 GET、POST、PATCH；输入验证及创建后 type/url 不可修改 | API-01/10/13；新增不可变字段专项用例在 Spec 固定 |
| D03-T03 | Topic 列表/详情 GET、POST、PATCH；认证、校验；修改不回溯历史对象 | API-02/13、CFG-04/07 的配置侧行为 |

使用既有 Fastify、Bearer 认证和 better-sqlite3；不新增业务表、ORM 或迁移框架。

## 3. 已确认决策与不变量

1. 项目负责人明确要求：“已有的 source 不允许修改 type和URL”。Source 创建时设置 type/url，后续更新不能改变它们；需要不同来源时创建新 Source，可停用旧 Source。Spec 固定 PATCH 携带这两个字段时的拒绝行为，禁止静默忽略或部分更新。
2. Source 的 last_collected_at 初始可空，允许读取，只由后续 Collection 维护；配置写接口不得允许调用方伪造或修改检查点。
3. Topic 修改、重新启用只影响后续实际匹配，不回放历史情报、不修改既有 Topic Association、不补发 Published Item。
4. 配置 API 仅管理配置，不发起采集、HTTP 抓取、模型分析、匹配、发布或 Runtime 任务。
5. 未授权请求不得读取受保护配置或写入数据。非法请求须完整拒绝，不得发生部分持久化。

## 4. 成功标准

- 有效 Bearer Token 下可创建、列出和读取 Source/Topic；重开数据库后配置仍存在，ID 稳定。
- 支持修改允许的配置字段及 enabled；未提供字段保持原值。type/url 不可变、检查点只读的约束在 API 和 Repository 边界保持一致。
- 非法必填值、错误类型、非法枚举、危险 URL、非法 Cron 及未知字段有明确错误结果；返回码、字段规则及 URL/Cron 验证契约在 Spec 固定。
- Source/Topic 的 POST/PATCH 鉴权失败时，数据库配置和采集检查点完全不变。
- Topic 配置更新不引发历史修改或下游任务。真实调度器跳过停用 Source、真实匹配读取启用 Topic 快照的执行验证留给对应后续里程碑。
- 使用临时 SQLite 数据库和 Fastify 注入进行确定性测试；覆盖创建、读取、更新、启停、不可变字段、无部分写入及鉴权失败。D00～D02 回归继续通过。
- 每卡依次通过 Worker 自测、Lead 审核、Architect 复核；集成验证包含干净安装及完整 verify。远程 CI 在另行授权推送后实际核对，不以本地通过替代远程证据。

## 5. 非目标与约束

不提供 DELETE API、管理网页、批量历史重分析、真实 Source Adapter、Cron 调度执行、完整 Runtime、真实模型或 RSS 发布。不提前实现 D14 的历史检索接口和 Cursor 契约。

沿用 Node 26.13.1/npm 11.20.0 与现有依赖基线；若 Cron 校验需要新增调度依赖，须在 Spec/Plan 明确用途、版本与范围，不由 Worker 临时决定。

真实 config/prompt/user-context.md 继续仅本地私有，不读正文、不复制到 worktree、不 stage；本阶段不修改五份功能 Prompt。

## 6. 审核记录

- 负责人已授权继续 D03 准备工作，并明确批准 Source type/url 创建后不可修改。
- 本文为该目标的可审核落档，G1 结论待负责人确认；不把“继续”扩展为尚未形成的 Spec/Plan 或 Worker 执行批准。
- G1 通过后由 Architect 准备 Spec，再委派新的 Paseo Lead 编写 Plan；负责人审阅 Plan 后才进入 Worker 开发。
