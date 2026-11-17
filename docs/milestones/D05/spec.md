# D05 Spec：Collection 采集、去重与检查点

- 状态：`APPROVED · G2 PASS`
- 版本：v0.1
- Intent：G1 已批准；负责人确认三项边界。
- 实现基线：D04 最终 PASS，main `98144f3`（仅 D05 Intent 文档推进，生产代码等同 D04）。

## 1. 公共契约

新增 Collection 模块，提供：

```ts
interface CollectResult { new_source_item_ids: string[] }
collect(sourceId: string, options?: { signal?: AbortSignal }): Promise<CollectResult>
```

- Source ID 必须为非空字符串；非法输入抛稳定领域错误，不访问网络/数据库写入。
- Source 不存在或 disabled：正常返回 `{new_source_item_ids:[]}`，不推进 checkpoint，不调用 Adapter。
- enabled Source：读取配置快照和 checkpoint，选择注册 Adapter；当前只支持 RSS。未知类型抛 `unsupported_source`，不推进。
- 返回值只包含本次事务实际插入并提交的 Source Item IDs，顺序与候选保存顺序一致；不得包含旧 ID、Content ID 或派发信息。
- D05 不创建 HTTP route；供后续 Runtime/集成调用。

## 2. 依赖装配

Collection factory 显式接收：Database、SourceRepository、SourceItemRepository、Adapter registry、Clock、logger，以及可选 single-flight 容器。生产装配使用 SystemClock 和现有安全 RSS Adapter；测试注入确定性 clock/fake Adapter/logger。

- 不修改冻结 DDL；使用 `source_items` 与 `sources.last_collected_at`。
- SourceItemRepository 提供按 source+external_id、source+url+published_at 查询、批内所需读取和同步 insert；所有 SQL 参数绑定。
- `raw_data` 为 JSON TEXT 或 null；本 Spec 固定保存 schema_version=1、entry 与 content 的可序列化快照，保留 content_kind/acquired_via/completeness_basis/article 证据。author 可置于 entry/raw_data，不新增表字段。
- discovered_at 使用本次采集开始时间；ID 使用现有 crypto.randomUUID 风格，测试可注入/观察但不得依赖时间排序。

## 3. 身份与去重

同一 Source 内：

1. external_id 非空：只用 `(source_id, external_id)` 判断；URL/published_at 变化不绕过。
2. external_id=null 且 url 非空：用 `(source_id,url,published_at)`；published_at=null 使用 SQL `IS NULL` 或等价明确语义，不用普通 `=`。
3. 两者都缺：不具备可靠身份，V1 允许保存且接受少量重复；若 title 等元数据也完全缺失，按明显非法条目跳过并记录不含正文的原因。
4. 批内按相同规则去重，保留首次出现；库内预筛后，写事务内对每个 draft 再查一次，只插入 fresh。
5. 不跨 Source 去重；不计算 Hash，不增加 entry_key/unique DDL，不判断重新发布。

RSS 列表不按 published_at 与 checkpoint 比较过滤；checkpoint 仅传给 Adapter 供未来可靠增量语义使用。

## 4. 编排与 single-flight

- 每个 Collection factory 持有按 sourceId 的进程内 in-flight Map；同 Source 并发调用复用同一 Promise/结果，finally 清理。不同 Source 独立。
- 已进入执行后，在列表前、每个正文请求前、写事务前检查 abort；调用方取消抛 `aborted`，不提交、不推进。
- startedAt 在实际获得执行权后、列表请求前由 Clock.now() 取得，格式沿用 ISO_OFFSET_DATE_TIME。
- fetchEntries 与逐条 fetchContent 均在写事务外；只对预筛后的新候选调用正文方法。
- 单条 AdapterError（除 aborted）视为该条内容不可用：构造合法 NONE SourceContent 证据并继续保存身份有效的条目；不得吞掉编程错误或取消。若 Adapter 本身返回降级/NONE，原样保存。
- 列表失败、未知 Adapter、DB 写失败向外抛稳定错误；不推进 checkpoint。

## 5. 原子保存与 checkpoint

使用现有同步 `withTransaction`：

1. 对 drafts 逐条 recheck 身份。
2. 插入 fresh Source Items，content_id=null，raw_data 为严格 JSON。
3. 将 Source.last_collected_at 更新为 startedAt。
4. 返回插入 IDs。

约束：
- 事务回调不得 async/await/thenable；任何异常整体回滚。
- 成功无新增也更新 checkpoint 并返回空数组。
- 不允许部分 Source Items 已提交而 checkpoint 未更新，或相反。
- checkpoint 只能由 Collection 内部 repository 方法维护；配置 API 仍拒绝该字段。
- 不等待 Processing；提交后不直接派发队列。

## 6. 错误、日志与隐私

- 稳定错误至少区分 invalid_input、unsupported_source、aborted、collection_failed；底层 DB 细节不泄露到公开消息。
- 日志只记录 sourceId、阶段、reason、计数等安全元数据；不记录 raw_data、正文、摘要、完整 URL 查询串或私有配置。
- raw_data 必须通过 JSON.stringify/parse 往返，禁止 undefined/function/symbol/循环对象；Zod 校验 entry/content 后再保存。
- 不读取真实 User Context，不改五个功能 Prompt，不访问真实公网作为自动测试前提。

## 7. 验收矩阵

覆盖 COL-01～18 的 Collection 部分：首次两条、GUID 重复标题变化、URL+时间 fallback、同 URL 不同时间、跨 Source 独立、旧发布时间新 GUID、批内重复、自带全文不二次 HTTP、摘要补抓、列表/事务失败不推进、成功空批次推进、非法元数据跳过、同 Source 并发单飞、NONE 保存、GUID 优先、null 时间重复。

另验证：disabled/不存在零网络；取消各阶段零提交；事务内 recheck；raw_data JSON 往返；返回 IDs 与 DB 一致；配置 API checkpoint 不可写；DDL/CI/Prompt 不变。

## 8. 门禁与交付

Plan 由新 Lead 编写，Architect G3 批准后才创建 Worker。预计按原计划四卡串行：身份/Repository → 单飞与获取 → 原子保存/checkpoint → raw_data/契约与集成。每卡独立审核、精确 candidate/merge、归档；本地 Gate 后按持续授权 push/CI，最终 PASS 后清理心跳及全部 Lead/Worker workspace。