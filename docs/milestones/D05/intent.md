# D05 Intent：Collection 采集、去重与检查点

- 状态：`APPROVED · G1 PASS`
- 负责人确认：2026-11-17 明确回复“确认ok，继续”；批准 §6 三项边界及本 Intent 范围。
- 日期：2026-11-17
- 依赖基线：D04 最终 PASS；main `1735deb577af924afd4066031ec054421225eca8`（实现验收 SHA `f2ae570…`，后续仅收尾文档）；远程 CI Success。
- 上游：D01 数据库/同步事务，D03 Source Repository，D04 通用 SourceAdapter/RSS Adapter。

## 1. 目标

实现 V1 的 `collect(sourceId)`：读取已配置 Source，通过对应 Adapter 获取列表，尽力识别本来源的新发布实例，仅对新条目获取正文/摘要证据，在一个短事务中保存 Source Item 并推进成功采集检查点，返回本次新建 Source Item ID 集合。

D05 把“取得内容”变成“持久化来源记录”，但不创建 Content、不调用分析 LLM、不直接派发队列；后续 Runtime 根据已提交 IDs 派发 ProcessTask。

## 2. 已确认业务规则

1. 输入仅为 Source ID；不存在或 disabled Source 正常返回空结果，disabled 不访问网络。
2. 同一 Source 使用进程内 single-flight，避免正常并发重复采集；不同 Source 可独立执行。V1 不增加分布式锁或新表。
3. 列表请求和正文获取均在数据库写事务外；RSS 不按 `published_at > last_collected_at` 硬过滤，允许晚出现的旧发布时间条目。
4. 去重仅限同一 Source：非空 `external_id` 优先；否则使用 URL + `published_at`，包括双方 published_at 都为 null 的明确语义。没有可靠标识时按 V1 尽力而为，不生成额外 Hash/entry_key，不承诺绝对去重。
5. 批内先去重，写事务内再次检查库内身份，避免正常竞态重复；不跨 Source 去重，不判断“明确重新发布”。同 GUID 即使 URL/时间变化仍视为已采集。
6. 仅对候选新条目调用 `fetchContent`；自带全文由 Adapter 直接采用，只有摘要时尝试文章提取，失败降级。单条正文失败或 NONE 不使整批失败，身份有效即可保存。
7. `raw_data` 保存可序列化 Adapter 来源记录与内容证据；空正文合法。不得把 DOM、Response、Buffer、Error 等运行时对象写入数据库。
8. 一个短事务保存全部 fresh Source Items，并把 `sources.last_collected_at` 推进到本次采集开始时间；无新增但列表成功也推进。列表失败、取消或写事务失败不推进，不允许部分提交。
9. 返回值只含本次已提交的新 Source Item IDs；不返回 Content、routes 或队列信息。提交后派发属于 Runtime，不在 D05 内执行。
10. 沿用 better-sqlite3、冻结 11 表 DDL 与现有同步事务 helper；不新增 ORM、outbox、采集状态表或 Schema 字段。

## 3. 范围

- Collection 公共契约、SourceItem Repository/查询与插入、批内/库内去重、single-flight、采集编排、checkpoint 原子更新。
- Adapter registry 的最小装配边界：按 Source.type 选择已实现 Adapter；当前生产只注册 RSS，未知类型明确失败且不推进 checkpoint。
- 独立 Collection fixtures/测试，覆盖 COL-01～18 中属于 Collection 的规则；真实 HTTP 防护沿用 D04，不重复实现。
- 必要的本地 smoke/集成验证；不要求真实公网作为 CI 门禁。

## 4. 非目标

- 不创建 Content、FULL/PARTIAL 标准化、P-01 路由或任何 LLM 调用（D06）。
- 不实现 Cron、六类 Worker、重试、队列或提交后派发（D15）；不宣称解决 COMMIT 后崩溃漏派。
- 不新增财经 API Adapter；未来在 V1 主链路跑通后另立里程碑。
- 不修改 Source 配置 API 对 checkpoint 的只读约束，不开放任意 checkpoint PATCH。
- 不做跨来源转载去重、正文 Hash、历史回填、删除/回溯或分布式采集协调。

## 5. 验收意向

- 首次两条新记录保存两条并推进一次 checkpoint；重复批次零新增且不对旧条目抓正文。
- GUID 优先、URL+时间 fallback、null 时间、批内重复、跨 Source 独立、旧发布时间新 GUID 均有确定性测试。
- 同 Source 并发触发不会正常路径重复；事务内 recheck 与失败回滚有证据。
- 全文直取、摘要补抓、单条失败降级、NONE 保存分别覆盖；raw_data 可 JSON 往返。
- 列表失败/取消/DB 失败不推进；成功空批次推进；返回 IDs 与数据库提交一致。
- 三文档门禁、逐任务 Worker→Lead→Architect、精确 candidate/merge、干净本地 Gate、远程 CI、心跳及 Worker/workspace 归档按项目持续约定执行。

## 6. 审批记录

负责人已确认 D05 只返回新 Source Item IDs、不直接派发 Processing；无可靠身份时接受少量重复；成功空批次推进 checkpoint。G1 通过，进入 Spec G2。