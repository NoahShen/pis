# D05 Plan：Collection 采集、去重与检查点

> 版本：v0.1
> 状态：`REVIEW · Architect G3 待审核`
> 版本轨迹：v0.1 首版 Lead Plan。
> Intent：`docs/milestones/D05/intent.md`（APPROVED · G1 PASS）
> Spec：`docs/milestones/D05/spec.md`（APPROVED · G2 PASS）
> 实现基线：`366d3d19c6dfe5cc4ef18057c4c17c6986a88bf2`
> D04 代码验收基线：`98144f3`（`366d3d1` 相对其仅新增 D05 Spec）
> 本文不构成 Worker 或开发执行授权。Architect G3 批准前不得创建 Worker、编码、合并或启动开发心跳。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
```

以下命令均隐含该前置。版本不符时直接 `BLOCKED`，不得改用宿主默认运行时或安装替代版本。

## 1. 目标与不可变更边界

D05 交付一个可独立调用、无 HTTP route 的 Collection 组件：

- 读取 Source 配置及 checkpoint，按 `Source.type` 选择 Adapter。
- 同 Source 进程内 single-flight；不同 Source 独立执行。
- 在数据库写事务外获取列表并仅对新候选获取内容；RSS 不按发布时间硬过滤。
- 同一 Source 内按 `external_id` 优先，否则 URL + `published_at` 做批内和库内尽力去重。
- 一个短事务插入 fresh Source Items 并推进 `sources.last_collected_at`，全部成功或全部回滚。
- 仅返回本次已提交的新 Source Item IDs；Processing 派发留给 D15 Runtime。

明确不做：

- 不创建 Content，不做 FULL/PARTIAL 标准化，不实现 P-01 路由。
- 不调用任何 LLM，不读取 User Context，不修改五份 Prompt。
- 不实现 Cron、Worker、队列、重试或提交后派发；不宣称修复 COMMIT 后进程崩溃漏派。
- 不修改冻结 11 表 DDL、`Source.type`、配置 API、Source `type/url` 不可变规则或 checkpoint 只读规则。
- 不新增 Hash、`entry_key`、唯一索引、outbox、采集状态表、分布式锁、财经 API Adapter 或跨 Source 去重。
- 不复制 D04 HTTP/正文防护；D05 只消费 `SourceAdapter`，真实 HTTP 安全继续由 D04 负责。
- 不请求真实公网、真实模型或私密配置作为自动测试前提。

若实现需要改变 Spec 的公共契约、`raw_data` 版本、错误码、DDL 或去重语义，停止该卡并交 Architect；Worker 不得现场扩写设计。

## 2. 冻结的 D05 契约与实现布局

### 2.1 最终公共入口

最终公共入口固定为 `src/collection/index.ts`，由 T04 交付：

```ts
interface CollectOptions {
  signal?: AbortSignal;
}

interface CollectResult {
  new_source_item_ids: string[];
}

interface CollectionService {
  collect(sourceId: string, options?: CollectOptions): Promise<CollectResult>;
}

interface CollectionFactoryDependencies {
  database: Database.Database;
  sourceRepository: SourceRepository;
  sourceItemRepository: SourceItemRepository;
  adapters: SourceAdapterRegistry;
  clock: Clock;
  logger: CollectionLogger;
  singleFlight?: SingleFlight;
}

function createCollection(
  dependencies: CollectionFactoryDependencies,
): CollectionService;

function createRssAdapterRegistry(): SourceAdapterRegistry;
```

- `createCollection` 显式接收 Spec 列出的依赖；未传 `singleFlight` 时创建 factory 私有实例，不能使用模块级全局 Map。
- `createRssAdapterRegistry` 每次调用创建独立 registry，并仅注册 `RSS -> createRssAdapter()`；不启动网络或服务。
- D05 不修改 `app.ts`、`server.ts`、`lifecycle.ts` 或 configuration route；供 D15/Runtime 后续装配。
- 公共入口不导出 repository insert、checkpoint 更新、single-flight Map、raw-data 构造器或任何测试 seam。

### 2.2 Source Item 身份与 Repository

T01 冻结内部身份规则：

- `external_id !== null` 时，身份键仅为 `(source_id, external_id)`。
- `external_id === null && url !== null` 时，身份键为 `(source_id, url, published_at)`；`published_at === null` 必须用 `IS NULL` 或等价明确语义。
- 两者都缺失时没有可靠身份。只要 `title` 也缺失，就作为明显非法条目跳过并记录安全 reason；`title` 存在时允许保存且接受少量重复。
- 批内去重保留首次出现；不生成 Hash/entry_key，不跨 Source 比较。

`SourceItemRepository` 只提供参数绑定的窄能力：

```ts
existsByExternalId(sourceId: string, externalId: string): boolean;
existsByUrlAndPublishedAt(
  sourceId: string,
  url: string,
  publishedAt: string | null,
): boolean;
insert(draft: SourceItemDraft): SourceItemRecord;
```

`SourceItemDraft` 固定包含 `source_id`、`external_id`、`url`、`title`、`published_at`、`discovered_at`、`content_id: null`、`raw_data: string`；插入由现有 `IdGenerator` 生成 ID。所有值参数化，不拼接 URL、GUID 或 raw_data。

### 2.3 raw_data v1

T04 最终冻结 `raw_data` 为严格 JSON TEXT，形状如下：

```ts
interface RawDataSourceItemV1 {
  schema_version: 1;
  entry: SourceEntry;
  content: {
    body: string | null;
    summary: string | null;
    content_kind: "FULL_BODY" | "SUMMARY" | "FRAGMENT" | "NONE";
    acquired_via:
      | "SOURCE_FULL_FIELD"
      | "ARTICLE_EXTRACT"
      | "SOURCE_FALLBACK"
      | "NONE";
    completeness_basis:
      | "SOURCE_DECLARED"
      | "ARTICLE_EXTRACTED"
      | "PARTIAL_ONLY"
      | "NO_CONTENT";
    article: {
      status: "NOT_REQUESTED" | "SUCCESS" | "FAILED" | "BLOCKED";
      reason: AdapterReason | null;
      final_url: string | null;
    };
  };
}
```

- `entry` 使用 D04 严格 `SourceEntry` schema；`content` 只去掉已经位于顶层的 `schema_version`/`entry`，其余证据原样保留。
- 空正文合法：`body=null`、`content_kind=NONE`、`acquired_via=NONE`、`completeness_basis=NO_CONTENT`。
- 单条 `fetchContent` 抛非 abort 的 `AdapterError` 时，D05 构造上述 NONE 证据，`article.status=FAILED`、保留固定 `reason`、`final_url=null`，继续保存该身份有效条目。
- 保存前完成 Zod 校验和 `JSON.stringify`；禁止 DOM、Response、Buffer、Error、undefined、function、symbol、循环对象进入数据库。
- `raw_data` 不新增表字段，不由配置 API 写入，不在日志中输出。

### 2.4 稳定错误

T02 冻结 `CollectionError.code` 只含：

- `invalid_input`：非空字符串以外的 Source ID。
- `unsupported_source`：registry 没有对应 Source type。
- `aborted`：调用方取消。
- `collection_failed`：列表/已选 Adapter 失败或数据库提交失败等稳定采集失败；未注册类型固定映射 `unsupported_source`。

公共错误 message 固定且不携带底层 URL、SQL、DB message、正文、摘要、raw_data 或 cause。单条正文的非 abort `AdapterError` 按 §2.3 降级，不把整批转为失败；未知编程错误不得伪装成单条内容失败。

### 2.5 单飞、取消与日志

- single-flight 键为 Source ID；同一 factory 内同 Source 只执行一次正常获取链路，finally 清理 key；不同 Source 不共享 Promise。
- 第二个并发等待者需要取消时可结束自己的等待，但不得破坏另一未取消等待者的结果；首个执行者的取消按 Adapter/D05 契约终止该共享执行。
- 在列表前、每个 `fetchContent` 前和写事务前检查 abort；已提交后不再接受取消回滚。
- logger 只接收集合事件元数据：`sourceId`、stage、安全 reason、count。禁止完整 URL 查询串、正文、摘要、raw_data、Token 或底层异常文本。

## 3. 四卡串行与能力边界

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | Source Item 身份规则、批内去重判据、参数化查询/插入 | 不能采集、single-flight、推进 checkpoint 或返回公共结果 |
| T02 合并后 | registry、错误、single-flight、Adapter 列表/仅新候选内容获取链 | 尚未原子保存、checkpoint 或公共 `collect` |
| T03 合并后 | 短事务保存、事务内 recheck、checkpoint 原子推进、稳定 DB 失败 | 公共 raw_data schema、公共 factory 与最终集成未完成 |
| T04 合并后 | 公共 factory/结果、raw_data v1、独立 fixture、真实 SQLite + D04 RSS Adapter 集成 | 不表示整个 D05 PASS，仍须单元/集成 Gate、远程 CI 与最终验收 |

四卡严格串行，每卡新 Paseo Worker、固定前卡 merge SHA、独立 worktree。Worker 不得 stage/commit/merge/push，只报 `REVIEW`/`BLOCKED`；Lead 复核并冻结 tree，Architect 批准后才创建 candidate。未获批准 tree 不得进入 Git candidate。

## 4. D05-T01 · 身份、Source Item Repository 与批内去重

### 4.1 依赖与允许写集

- 前置：无 D05 代码任务；基线为 D05 Plan 获批后的精确 merge SHA。
- 新增：`src/collection/source-item-identity.ts`。
- 新增：`src/collection/source-item-repository.ts`。
- 新增：`tests/collection/source-item-identity.test.ts`。
- 新增：`tests/collection/source-item-repository.test.ts`。
- `docs/milestones/D05/progress.md` 只由 Lead/Architect 更新，不属于 Worker candidate。
- 依赖/包变更：`NONE`。

### 4.2 实现要求

1. 提供纯身份函数、明显非法条目判断和批内去重；保留输入顺序及首次出现项，不修改 Adapter 输入。
2. `external_id` 非空时完全忽略 URL/published_at 差异；URL+发布时间比较对 non-null 用参数等值，对 null 用明确 `IS NULL`。
3. Repository 查询必须包含 `source_id`，证明同 URL 或同 GUID 在不同 Source 中互不影响。
4. Repository insert 使用参数绑定，写 `content_id=NULL`，保留调用方给出的 `raw_data` TEXT 和 `discovered_at`，返回可观察记录。
5. T01 不调用 `withTransaction` 包裹批次、不更新 `sources.last_collected_at`、不调用 Adapter、不创建公共 contract。Repository insert 只执行同步 prepared statement，不自带事务；仅 T03 的外层事务负责批次原子性。
6. 不用现有非唯一索引冒充唯一约束；不修改 schema。数据库无唯一性时，T03 的事务内 recheck 是最终正常竞态保护。

### 4.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `COL-02` | 同 Source 同 `external_id`、标题/URL/时间变化仍判已采集 |
| `COL-03` | 无 external_id、同 URL + 同 published_at 判重复 |
| `COL-04` | 无 external_id、同 URL + 不同 published_at 是独立身份 |
| `COL-05` | 相同 GUID/URL 在两个 Source 中均不跨源命中 |
| `COL-07` | 同批同身份保留首个；不同身份和顺序不变 |
| `COL-13` | 无 external_id/url/title 的条目跳过；title-only 条目不被伪造身份过滤 |
| `COL-17` | 同 Source 非空 external_id 优先，即使 URL/时间改变 |
| `COL-18` | URL 相同且 published_at 均 null 时识别重复，不使用普通 `=` 导致漏判 |

另测：Repository insert 的字段完整、`content_id=null`、raw_data 原样、SQL 参数化；返回记录与数据库读取一致。

### 4.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/collection/source-item-identity.test.ts tests/collection/source-item-repository.test.ts
npm run verify
git diff --check
```

交回必须列出 base SHA、实际路径、Case 映射、命令结果、已知限制，并只报 `REVIEW`/`BLOCKED`。本卡通过只表示身份/Repository 能力 PASS。

## 5. D05-T02 · Adapter Registry、single-flight 与新候选获取

### 5.1 依赖与允许写集

- 前置：`D05-T01` 已通过、合并并归档。
- 新增：`src/collection/collection-errors.ts`。
- 新增：`src/collection/adapter-registry.ts`。
- 新增：`src/collection/single-flight.ts`。
- 新增：`src/collection/collector.ts`（内部采集/获取链，尚非最终公共入口）。
- 新增：`tests/collection/adapter-registry.test.ts`。
- 新增：`tests/collection/single-flight.test.ts`。
- 新增：`tests/collection/collector-acquisition.test.ts`。
- 不得修改 T01 两个生产文件；若其契约不足，先报 Lead。
- 依赖/包变更：`NONE`。

### 5.2 实现要求

1. `SourceAdapterRegistry` 按精确 `Source.type` 返回 Adapter；未注册类型固定 `unsupported_source`。测试可注入 fake registry。
2. `SingleFlight` 以 Source ID 为 key 复用执行 Promise 并在 finally 清理；不同 key 独立。不得使用模块级 Map。
3. 非空 Source ID 校验后才访问 Repository/Adapter；不存在或 disabled Source 正常返回内部空获取结果，不选择 Adapter、不请求网络、不推进任何状态。
4. 进入实际执行后由 `Clock.now()` 取一次 `startedAt`，经现有 `formatTimestamp()` 形成 `+08:00` ISO 时间；在列表前、每个正文前检查 abort。
5. 调用 `fetchEntries` 时传入 Source checkpoint 和 signal；Collection 不再按 `published_at` 与 checkpoint 比较过滤，保留来源顺序和晚到旧发布时间条目。
6. 列表成功后先做 T01 明显非法过滤、批内去重和库内预筛；只有预筛后新候选调用 `fetchContent`，旧条目调用数必须为 0。
7. 单条 `AdapterError`：`aborted` 立即映射取消并终止；其他固定 reason 构造 raw_data v1 NONE 证据并继续。未知异常不降级、不吞掉。
8. 成功获取返回内部 `AcquisitionResult { startedAt, drafts }`；drafts 含 Source Entry、Adapter `SourceContent` 和按冻结 v1 形状生成的 `raw_data` TEXT，但本卡不写批次事务。
9. 列表失败、未知 adapter 的稳定错误不包含底层 cause；单条降级日志只使用安全元数据。
10. T02 不创建公共 `index.ts`、不修改 DB/checkpoint、不创建 Content、不派发任何任务。

### 5.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `CFG-03` | disabled/不存在 Source 的 adapter、fetchEntries、fetchContent 调用数均 0，无写操作 |
| `COL-02` | 库内已有 GUID 的旧条目不调用 fetchContent |
| `COL-06` | published_at 早于 checkpoint 的新 GUID 仍进入候选并保存链 |
| `COL-08` | 自带全文时只调用 Adapter `fetchContent`，Collection 不另发文章 HTTP |
| `COL-09` | Adapter 返回摘要/正文补抓结果时原样保留，D05 不重复实现抓取 |
| `COL-10` | 单条非 abort AdapterError 降级为合法 NONE，其他候选继续 |
| `COL-14` | 同 Source 并发只执行一条获取链；不同 Source 可并行且互不取消 |
| `COL-15` | D04 安全 transport 回归仍 PASS；D05 无新增网络实现 |

另测：同 Source 等待者取消不破坏未取消等待者；列表前、正文前预取消均零 fetchContent/零提交；列表失败与 unknown adapter 不留下 drafts；安全 logger 不含正文、摘要、URL 查询串或底层 message。

### 5.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/collection/adapter-registry.test.ts tests/collection/single-flight.test.ts tests/collection/collector-acquisition.test.ts
npx vitest run tests/adapters/restricted-http.test.ts tests/adapters/rss-http.test.ts
npm run verify
git diff --check
```

交回与冻结格式同 T01。本卡通过只表示获取/单飞内部能力 PASS。

## 6. D05-T03 · 短事务保存、事务内 recheck 与 checkpoint

### 6.1 依赖与允许写集

- 前置：`D05-T02` 已通过、合并并归档。
- 新增：`src/collection/collection-persistence.ts`。
- 修改：`src/collection/collector.ts`，仅接入获取结果与 persistence，不改变 T02 获取/单飞语义。
- 新增：`tests/collection/collection-persistence.test.ts`。
- 新增：`tests/collection/collector-transaction.test.ts`。
- 不得修改 T01 Repository/identity 或 Schema/configuration API。
- 依赖/包变更：`NONE`。

### 6.2 实现要求

1. 捕获列表成功结果后，在写事务前再次检查 abort；取消则零写入、零 checkpoint。
2. 使用现有同步 `withTransaction(db, operation)`；回调必须同步，不含 `await`、thenable、网络、clock 读取或 Adapter 调用。函数若不接受 `AbortSignal` 时必须拒绝。
3. 事务内按冻结身份规则逐 draft recheck；只插入仍 fresh 的 drafts，保留候选/插入顺序。无可靠身份的 title-only draft不在库内判重，按 V1 接受重复。
4. 每行写 `content_id=NULL`，raw_data 使用 T02 生成 TEXT；ID 由 `SourceItemRepository` 的 `IdGenerator` 生成。返回 ID 只含本次实际插入行。
5. Collection 私有 `updateLastCollectedAt(sourceId, startedAt)` 直接参数绑定更新 `sources.last_collected_at`；必须核验恰好命中一个 Source 行，不能经配置 API 或 `SourceRepository.update`，不得增加新的 enabled 竞态语义。
6. 成功列表即使 fresh drafts 为空，也推进 checkpoint 并返回空 IDs。fresh 非空时，Source Items 与 checkpoint 必须在同一事务 COMMIT。
7. 任一行 insert、read-back 或 checkpoint update 抛错，整个事务回滚；不得部分 Source Items 或仅 checkpoint 落库。底层 DB message 不进入公共错误。
8. checkpoint 使用本次执行开始时间，不取事务开始或结束时间；`discovered_at` 对所有本次 drafts 使用同一 `startedAt`。
9. 事务提交后只返回内部 `{new_source_item_ids: ids}`；本卡不派发、不调用 Processing/LLM、不创建 Content。

### 6.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `COL-01` | 首次两个身份有效条目插入 2 行、checkpoint 更新 1 次、返回 2 IDs |
| `COL-07` | 事务内 recheck 阻止并发/批后重复，正常路径只插一份 |
| `COL-11` | 列表失败、正文编程错误、事务 insert 失败、checkpoint update 失败均不前移 checkpoint；失败后行数不变 |
| `COL-12` | 列表成功但零新条目返回空 IDs，checkpoint 仍前移 |
| `COL-16` | NONE 正文 draft 仍以 content_id null 持久化，不被事务拒绝 |

`COL-01` 原测试描述中的“COMMIT 后派发 2 个 ProcessTask”不属于 D05 实现；D05 只验证 2 个已提交 IDs 与原子 checkpoint，派发由 D15 Runtime 独立实现和验收。

另测：在第一条 insert 后注入 failure，验证已插入行及 checkpoint 全部回滚；在 checkpoint update 后 read-back 注入 failure，验证同事务行回滚；empty fresh 的 checkpoint 只更新一次；返回 IDs 顺序与 `SELECT`/insert 顺序一致；取消发生在写事务前则 0 次事务。

### 6.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/collection/collection-persistence.test.ts tests/collection/collector-transaction.test.ts
npm run verify
git diff --check
```

交回与冻结格式同 T01。本卡通过只表示事务保存/checkpoint 内部能力 PASS。

## 7. D05-T04 · raw_data、公共契约、独立 fixture 与集成

### 7.1 依赖与允许写集

- 前置：`D05-T03` 已通过、合并并归档。
- 新增：`src/collection/raw-data.ts`。
- 新增：`src/collection/contracts.ts`。
- 新增：`src/collection/index.ts`。
- 修改：`src/collection/adapter-registry.ts`，接入仅 RSS 的稳定生产 registry 装配。
- 修改：`src/collection/collector.ts`，接入 raw-data 严格校验和最终 factory 行为，不改变前三卡已冻结语义。
- 新增：`tests/collection/raw-data.test.ts`。
- 新增：`tests/collection/collection-service.test.ts`。
- 新增：`tests/collection/collection-integration.test.ts`。
- 新增：`tests/fixtures/collection.ts`。
- 不得修改 D01 Schema、D03 configuration/API、D04 adapter、server/app/lifecycle、Prompt、CI 或上游文档。
- 依赖/包变更：`NONE`。

### 7.2 实现要求

1. `raw-data.ts` 用 strict Zod schema 固化 §2.3 v1 envelope；先验证 `SourceEntry` 和 content evidence，再 `JSON.stringify`，并验证 stringify/parse round-trip。拒绝未知字段、undefined、function、symbol、循环对象和运行时 DOM/Response/Buffer/Error 形状。
2. `contracts.ts` 只暴露 Spec 的 `CollectResult`、`CollectOptions`、`CollectionService`、factory dependencies、稳定错误与必要接口 type；不能暴露内部 SQL、Map 或 draft mutation。
3. `createCollection` 组合 T01 Repository、T02 registry/single-flight/获取链与 T03 persistence；构造后 `collect` 可重复调用，factory 私有 in-flight 状态在调用间正确清理。
4. Source ID 为空或非字符串时，在 Repository/Adapter/事务前抛 `invalid_input`；不存在/disabled 正常空结果且不推进 checkpoint；unknown type 抛 `unsupported_source`。
5. `createRssAdapterRegistry()` 使用 D04 `createRssAdapter()` 并仅注册 RSS。生产装配约定由调用方注入 `SystemClock`，并以 `CryptoIdGenerator` 构造 `SourceItemRepository`；不得新增模块级单例。测试注入 FakeClock、fake Adapter、fake logger 与确定性 Repository。
6. 独立 fixture 提供合成 Source、Source Item、fake Adapter（按调用队列、计数、可选挂起/失败）、fake logger 和数据库断言 helper；所有 URL 使用 `.example.test`，不读取私有文件。
7. 集成测试使用临时真实 SQLite、`createRssAdapter({ transport: fixtureTransport })` 和公共 `createCollection`，覆盖 feed entries → 仅新条目正文/摘要 → raw_data v1 → 单事务 Source Items + checkpoint；fixture transport 只在内存返回 XML/HTML，不监听公网。
8. 集成返回后查询 `source_items.content_id` 全为 null，`contents` 行数为 0；无 Runtime、LLM、Prompt 或 ProcessTask 引用。`raw_data` 可 JSON round-trip 且保留 entry/content evidence。
9. 配置 API 回归继续拒绝 checkpoint PATCH；本卡不修改其测试。DDL、Prompt、CI 文件 diff 必须为 0。
10. T04 完成后只表示 D05 功能实现完成，不自行签发 PASS；仍需 Lead 独立复核、Architect G4、每卡合并复验、D05 本地集成 Gate、push/远程 CI 和最终验收。

### 7.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `COL-13` | 明显非法条目跳过且日志无正文；title-only/无可靠身份条目按 V1 可保存或重复 |
| `COL-16` | 无正文/摘要 NONE 合法保存，checkpoint 推进，后续仍可处理为无 Content |
| `E2E-13` 采集部分 | 同 GUID 正文变化不新增；新 GUID 同正文新增独立 Source Item；均不创建 Content |

另测：公共结果只有 `new_source_item_ids`，不含 Content、routes、队列；返回值与 DB 本次提交行一致；invalid ID、missing/disabled、unsupported type、abort、DB failure 的错误与零副作用符合 Spec；raw_data schema 版本固定 1、空正文/摘要往返、unknown/undefined/function/symbol/cycle 拒绝；配置 API checkpoint 不可写；`source_items` DDL/索引无 diff。

### 7.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/collection/raw-data.test.ts tests/collection/collection-service.test.ts tests/collection/collection-integration.test.ts
npx vitest run tests/configuration/source-api.test.ts tests/configuration/source-repository.test.ts tests/adapters/rss-http.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error' src/collection tests/collection tests/fixtures/collection.ts || true
git diff --name-only <BASE_SHA> -- src/database/schema.sql config/prompts .github
```

最后一条命令输出必须为空。交回与冻结格式同 T01，并附一条真实 SQLite + D04 RSS Adapter 集成测试名/PASS。

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；任何步骤失败保持原对象，不通过删目录绕过。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 `HEAD`/tree、tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡允许路径；若需额外路径立即 `BLOCKED`，不得先改后请示。Worker 不得 stage/commit/amend/merge/push。
3. **Lead 复核**：Lead 独立检查 diff、行为、Case 映射、错误/隐私、禁止路径、no-op 和所有定向/full verify 命令；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入 Worker 全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化均使证据失效并重新冻结。
5. **Architect 审批**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`。未批准不得创建 candidate。
6. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验其唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 对齐该 candidate，不能有领先或未审提交。
7. **Merge**：Lead 在 D05 分支/主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、每个批准 blob 与 merge 一致，并记录 merge SHA/tree。
8. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；只有全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
9. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致并 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回的 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。失败或存在未交付成果时记 `BLOCKED`，不得清理。

每卡必须在 `progress.md` 记录以下 evidence key：`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。任一项缺失时不得用 `N/A` 冒充已完成门禁；未发生的写 `PENDING`/`NOT_RUN`。

## 9. D05 集成 Gate 与最终验收

四卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/collection tests/configuration/source-api.test.ts tests/configuration/source-repository.test.ts tests/adapters/rss-http.test.ts tests/database/schema-constraints.test.ts
npm run verify
git diff --check
```

并保留：

- `COL-01`～`18` 的 D05 责任逐项映射；D04 子责任引用既有 restricted HTTP/RSS 回归，不重复实现。
- 成功空批次 checkpoint、GUID 优先、URL+null 时间、批内去重、事务内 recheck、同 Source single-flight、跨 Source 独立、取消各阶段零提交、NONE/raw_data 往返、返回 IDs 与 DB 一致证据。
- fresh Source Items 与 checkpoint 同事务；任何失败路径零部分提交、零检查点前移。
- disabled/不存在 Source 零网络；配置 API checkpoint PATCH 仍失败；DDL、Prompt、CI、D04 adapter 生产文件和 Service/Runtime 边界无未批准 diff。
- 临时 DB/HTTP 资源全部关闭；无 SQLite/WAL/SHM、server、socket、timer、unhandled rejection 或真实公网依赖残留。
- Secret 检查只限定本里程碑 tracked diff 和明确合成 fixture，不读取 ignored/untracked 私有 `config/prompt/user-context.md`、数据库或环境文件；文档只记录命中路径/计数，不输出敏感正文。

Lead 签发 `D05_LOCAL_GATE=PASS` 后交 Architect。按负责人持续授权，Architect 可推送已批准 main SHA 并核验远程分支与精确 SHA 对应 CI；本地 Gate、远程 CI 和 Architect 最终验收全部满足前不得签发 `D05_FINAL_PASS`。

最终 PASS 后由 Architect 核验并归档全部 D05 Worker Agent/Workspace，再协调归档 D05 Lead；删除 D05 活动心跳并复查删除结果。归档前必须确认 candidate/merge、branch tip、tracked/untracked 和唯一交付成果无遗漏；任何清理失败明确记录，不得宣称已完全收尾。

## 10. 风险、回滚与停止条件

- SQLite 无 Source Item 唯一约束：只能依赖批内去重与事务内 recheck；不得以 DDL 修改补齐，正常竞态重复若出现即 BLOCKER。
- checkpoint 与 Source Items 必须同事务：insert 后 abort/cancel 不能留下部分提交；事务回调 async/thenable 必须被拒绝。
- RAW DATA 跨 D05/D06：D06 未开始，本轮只锁定 v1 形态与 JSON round-trip，不实现 Processing schema 或清洗。
- Single-flight 与调用方取消存在并发交互：按 §2.5 保持单 Source 执行不重复，并测试取消等待者不破坏另一等待者；禁止引入持久化锁。
- 若 D04 Adapter 与 public Collection 装配不兼容，只能报告最小接口差异交 Architect；不得改 D04 安全行为或降低测试。
- 任何失败按 `BLOCKED`/`FAIL` 记录；同一问题连续两轮修复失败时暂停派发，先区分实现、测试、任务拆分或 Spec 根因，涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 仅将已批准 D05 Intent/Spec 映射为四张串行、文件级可执行任务卡；没有新增需求、公共契约、DDL、依赖或替代任务 ID。
- T01～T04 均有精确允许路径、依赖、Spec/Case 引用、禁止范围、验证命令、冻结/候选/合并/归档证据字段。
- 当前 `plan.md` 状态为 `REVIEW`，`progress.md` 全部任务为 `NOT_STARTED`；未创建 Worker、未编码、未创建开发心跳、未合并或推送。
- 下一步仅交 Architect G3 审核；批准后方可创建 T01 新 Worker。
