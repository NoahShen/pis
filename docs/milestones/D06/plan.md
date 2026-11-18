# D06 Plan：Processing 内容标准化与路由

> 版本：v0.2
> 状态：`REVIEW · PENDING ARCHITECT G3`
> Intent：`docs/milestones/D06/intent.md`（APPROVED · G1 PASS）
> Spec：`docs/milestones/D06/spec.md`（APPROVED · G2 PASS）
> 实现基线：`24608343f65f3e600fccc60c0798e68731abdf3c`
> 本文只把已批准 Intent/Spec 映射为文件级实施计划；不构成 G3 批准、Worker 创建或开发执行授权。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
```

以下验证命令均隐含该前置。版本不符时直接 `BLOCKED`，不得切换为宿主默认运行时或安装替代版本。

## 1. 目标与不可变更边界

D06 交付一个无 HTTP route 的 Processing 组件：

- `process(sourceItemId)` 从 D05 已提交的 `source_items.raw_data` 解析并清洗内容。
- 按 D04 冻结的 `content_kind` 生成 `FULL` / `PARTIAL` Content，或在无可用内容时正常空结果。
- 新建 Content 与回写 `source_items.content_id` 在同一短事务提交；并发 recheck 与重复执行复用已有 Content。
- 只在 Content 已 COMMIT 后调用一次 D02 `routeProcessing`，返回本次 `{content_id, routes}`。
- `routes` 不落库、不派发队列；下游任务由 D15 Runtime 根据返回值决定。

明确不做：

- Processing 不调用 Adapter、不调用 `fetchContent`、不发起任何原文 HTTP，也不重新抓取/补全正文。
- 不创建 Event、Knowledge、Topic Association 或 Published Item，不提交任何分析任务。
- 不修改 D02 typed calls/校验器、P-01 Prompt、D04 Adapter/清洗基准、D05 Collection、冻结 DDL 或 CI。
- 不新增表、字段、索引、ORM、队列、Outbox、缓存、重试调度、限流、Hash/相似度去重或语言识别。
- 不实现 Runtime、HTTP API、Cron、优雅关闭或提交后进程崩溃漏派补偿。
- 测试不访问真实模型、真实原文 URL、真实 API Key、私有配置或未跟踪私密文件。

若实现需要改变公共契约、`raw_data` 版本、错误码、事务语义、枚举集合、DDL 或 Prompt，停止该卡并交 Architect；Worker 不得现场扩写设计。

## 2. 冻结契约与实现布局

### 2.1 最终公共入口

最终公共入口固定为 `src/processing/index.ts`，由 T04 交付：

```ts
interface ProcessOptions {
  signal?: AbortSignal;
}

interface ProcessResult {
  content_id: string | null;
  routes: Array<"EVENT" | "KNOWLEDGE">;
}

interface ProcessingService {
  process(sourceItemId: string, options?: ProcessOptions): Promise<ProcessResult>;
}

interface ProcessingDependencies {
  database: Database.Database;
  sourceItemRepository: ProcessingSourceItemRepository;
  contentRepository: ContentRepository;
  typedLlmCalls: TypedLlmCalls;
  clock: Clock;
  logger: ProcessingLogger;
}

function createProcessing(
  dependencies: ProcessingDependencies,
): ProcessingService;
```

- `content_id` 是 Spec 冻结的返回字段名；不得改回 Intent 草案中的 `contentId`。
- `contents` 的 ID 由注入的 `ContentRepository` 使用现有 `IdGenerator` 生成；`created_at` 由注入 `Clock` 经 `formatTimestamp()` 生成。
- `createProcessing` 不新增模块级单例，不启动服务、定时器、HTTP 或 LLM 请求。
- D06 不修改 `app.ts`、`server.ts`、`lifecycle.ts`、configuration route 或生产启动装配；Runtime 接线归 D15。

内部实现职责固定为：

| 文件 | 职责 | 首次交付 |
|---|---|---|
| `src/processing/content-normalization.ts` | strict raw_data 解析、确定性清洗、FULL/PARTIAL/NONE 判定 | T01 |
| `src/processing/source-item-repository.ts` | Processing 专用 Source Item 读取与 `content_id` 回写 | T02 |
| `src/processing/content-repository.ts` | Content 参数化读取/插入 | T02 |
| `src/processing/content-persistence.ts` | 同步短事务、事务内 recheck、插入与回写 | T02 |
| `src/processing/processing-errors.ts` | 稳定 Processing 错误 | T03 |
| `src/processing/processing-logger.ts` | 安全元数据 logger 契约 | T03 |
| `src/processing/content-router.ts` | COMMIT 后 P-01 调用、取消、错误与合法枚举去重 | T03 |
| `src/processing/processing.ts` | 最终编排与公共 factory | T04 |
| `src/processing/contracts.ts` | 公共 contract/factory dependency 类型 | T04 |
| `src/processing/index.ts` | 唯一公共导出边界 | T04 |

### 2.2 raw_data、清洗与 Content DTO

T01 必须直接复用 D05：

```ts
parseRawDataSourceItemV1(rawData)
```

不得复制 envelope、放宽 strict schema 或修改 D05 `raw-data.ts`。解析失败视为无可用内容并返回安全 reason；公共错误/日志不暴露 JSON parser、Zod、SQL 或底层 cause。

`raw_data.content.body`、`raw_data.content.summary` 与 `raw_data.entry.title` 已是 D04 清洗后的纯文本：RSS Adapter 对 `SourceText` 使用 `cleanSourceText()` → `cleanHtmlValue()`，Article Extractor 使用 `cleanReadabilityContent()`；进入 raw_data 时标签、script/style 与实体解码已经完成。Processing 不得再次执行 HTML 标签剥离或实体解码。

Processing 只允许复用 D04 `src/adapters/content-cleaning.ts` 的纯文本规范化能力：`normalizeCleanText()` / `cleanTextValue()`，统一换行、折叠空白、去空行。禁止对 raw_data 的 title/body/summary 调用 `cleanHtmlValue()`、`cleanReadabilityContent()`、`parseHtmlDocument()` 或任何 DOM 解析；不得引入格式探测分支或新字段。合法尖括号文字如 `<algorithm>`、`List<T>`、`<Foo/>` 必须逐字保留。

T01 内部返回可判别结果：

```ts
type NormalizationResult =
  | { usable: true; content: NormalizedContentDraft }
  | {
      usable: false;
      reason:
        | "raw_data_invalid"
        | "title_missing"
        | "content_unavailable";
    };
```

`NormalizedContentDraft` 固定包含 `title`、`url`、`author`、`published_at`、`body`、`summary`、`language: null`、`completeness`；不包含 ID、created_at、HTTP/Adapter 或 raw_data 原文。

判定固定为：

1. `content_kind=NONE`：无可用内容。
2. 解析/清洗后标题为空：无可用内容；`contents.title` 不允许空字符串或缺失。
3. `content_kind=FULL_BODY` 且清洗后正文非空：`completeness=FULL`。
4. `content_kind=SUMMARY|FRAGMENT` 且有可用正文或摘要：`completeness=PARTIAL`。
5. 原始正文为空但摘要可用：按 `PARTIAL`，将清洗后的实际可用摘要作为 `body`；不得生成文章未给出的正文。
6. 清洗后正文与摘要都为空：无可用内容。
7. `title/url/author/published_at` 来自 raw_data `entry`；缺失字段保持 `NULL`，不得用 Source Item 行字段、文件名、URL 片段或 LLM 补造。
8. 清洗只做纯文本空白与换行规范化；保留 Unicode、尖括号和全部有效字符，不做标签剥离、实体二次解码，不新增事实。

本卡只读取 strict schema 已保证的字段；不以字符数阈值二次猜测 FULL/PARTIAL，不做语言识别、翻译、摘要生成或跨 Content 去重。

### 2.3 持久化与事务

T02 在 Processing 边界内新增专用 `ProcessingSourceItemRepository`，不修改 D05 `src/collection/**`：

```ts
interface ProcessingSourceItemRepository {
  getById(id: string): SourceItemRecord | null;
  setContentId(id: string, contentId: string): SourceItemRecord;
}

class SqliteProcessingSourceItemRepository
  implements ProcessingSourceItemRepository {}
```

`ProcessingSourceItemRepository` 语义对应 Spec 的 Source Item Repository 读取/回写依赖；在 Processing 目录内实现可避免修改 D05 Collection 所有者模块。`setContentId` 必须参数化更新并以 `changes === 1` 校验恰好命中一条 Source Item，随后读回；不得暴露任意 SQL，也不得复制或改变 D05 的身份/insert 语义。测试可只读复用 D05 `SqliteSourceItemRepository.insert()` 造 Source Item，但不得修改其生产文件或测试预期。

`ContentRepository` 固定提供：

```ts
getById(id: string): ContentRecord | null;
insert(draft: ContentDraft): ContentRecord;
```

`ContentDraft` 只含 `contents` 现有字段；所有值参数绑定。`ContentRecord` 与原表列一致。Repository 不自带事务，只执行同步语句；事务归属 `content-persistence.ts`。

`ContentPersistence.ensureContent(sourceItemId, draft)` 使用现有同步 `withTransaction()`：

1. 事务内重新读取 Source Item。
2. Source Item 已消失：正常返回 `null`，不插入、不更新。
3. 已有 `content_id`：读取并返回该 Content；不得插入第二份。
4. `content_id=null`：插入一份 Content，随后调用 `setContentId` 回写并读回校验。
5. 插入、回写或读回任一步失败：整个事务回滚；不得出现 Content 未关联或关联指向不存在 Content。
6. 事务回调必须同步，不得返回 thenable，不得调用 Clock、LLM、网络或异步 logger。

事务外已读到 `content_id` 时由 T04 直接复用，不进入写入路径。不同 Source Item 即使正文/URL 相同也各自插入独立 Content，不做 Hash/相似度去重。

### 2.4 路由调用边界

T03 `routeCommittedContent(content, typedLlmCalls, logger, signal)` 只在 T02/T04 已确认 Content 可读且事务已结束后调用一次 `typedLlmCalls.routeProcessing(taskData, { signal })`。

`taskData` 只允许规范 Content 快照字段：

```ts
{
  title,
  body,
  summary,
  completeness,
  url,
  author,
  published_at,
}
```

- 不传 `raw_data`、原始 HTML 全量、Source Item 对象、Prompt、Token、私有上下文、SQL 或数据库对象。
- `signal` 必须原样透传到 D02 typed call；调用前已取消立即抛 `aborted`。
- 合法重复值按首次顺序去重；D02 继续负责未知/非法 enum 和额外字段的严格拒绝，D06 不复制或放宽 D02 schema。
- 路由异常不回滚已提交 Content；D06 不自动重试、不重建 Content。
- 路由结果不写数据库；空数组时 Content 仍保留。

### 2.5 错误、日志与隐私

`ProcessingError.code` 固定为：

- `invalid_input`：Source Item ID 不是非空字符串；在 Repository、事务和 LLM 前失败。
- `aborted`：调用前已取消，或路由调用期间取消。
- `processing_failed`：数据库读取/写入、事务提交或不变量失败等稳定处理失败。
- `llm_failed`：P-01 调用、Prompt 加载、模型输出或 D02 输出校验失败；Content 已提交时保留。

错误 message 固定、安全，不携带底层 SQL/JSON/Zod/模型输出/Prompt/cause。日志只允许 `sourceItemId`、`contentId`、stage、安全 reason、route count；禁止正文、摘要、raw_data、原始 URL 查询串、Token 或模型输出。

Source Item 不存在、`raw_data` 缺失、raw_data 无有效内容均不是异常，返回 `{content_id: null, routes: []}` 且零路由调用。路由错误后再次 `process` 应读取同一 `content_id` 并再次路由。

## 3. 四卡串行、能力边界与 PRO 映射

| 时点 | 已可用能力 | 明确不可宣称 |
|---|---|---|
| T01 合并后 | strict raw_data 解析、清洗、FULL/PARTIAL/NONE 判定、规范 DTO | 尚未读写 Content、无事务、无路由、无公共 factory |
| T02 合并后 | Content Repository、Source Item 读取/回写、单事务插入、并发 recheck/幂等 | 尚未调用路由、无公共 contract/factory |
| T03 合并后 | COMMIT 后路由边界、稳定错误、取消透传、合法路由去重 | 无最终编排、无 factory、未完成真实 SQLite 集成 |
| T04 合并后 | 公共 `process`、factory、独立 fixture、真实 SQLite + D05 raw_data 集成 | 只表示功能实现完成；仍须集成 Gate、远程 CI 和最终验收 |

四卡严格串行。每卡使用全新 Paseo Worker、固定前卡 merge SHA 和独立 worktree；Worker 不 stage/commit/merge/push，只交 `REVIEW`/`BLOCKED`。未获 Architect G4 对冻结 tree 的批准，不得创建 candidate。

| Case | 主责任卡 | 交叉验证 |
|---|---|---|
| `PRO-01` | T01 FULL 判定；T02 同事务关联 | T04 真实 SQLite 提交证据 |
| `PRO-02` | T01 PARTIAL 与实际内容 | T02 持久化；T04 路由快照 |
| `PRO-03` | T01 无内容判定 | T04 无 Content、无 LLM、Source Item 保留 |
| `PRO-04` | T02 recheck/复用 | T04 重复 process 与路由重试 |
| `PRO-05` | T02 独立 Content | T04 两 Source Item 相同正文集成 |
| `PRO-06` | T02 回写前异常与回滚 | T04 DB 状态回归 |
| `PRO-07` | T03 路由错误边界 | T04 Content 保留、二次 process 复用 |
| `PRO-08` | T03 四类路由返回 | T04 空路由保留 Content；D15 才派发 |
| `PRO-09` | T04 零原文 HTTP spy | T01-T03 静态依赖和 diff 复核 |
| `PRO-10` | T03 合法去重 | T04 经 D02 严格校验未知 enum/额外字段 |
| `PRO-11` | T01 清洗与 Unicode | T02 真实 SQLite 存储 |
| `PRO-12` | T01 PARTIAL 实际正文 | T03 路由快照不丢标记；T04 集成 |

`PRO-08` 在 D06 只验收返回 `1/1/2/0` 个 routes 与空路由保留 Content，不验收分析队列任务；派发归 D15。

## 4. D06-T01 · raw_data 解析、清洗、可用性与 FULL/PARTIAL

### 4.1 依赖与精确允许写集

- 前置：D06 Plan 获 G3 批准后的精确基线；首个 Worker 固定该批准/执行基线 SHA。
- 新增：`src/processing/content-normalization.ts`。
- 新增：`tests/processing/content-normalization.test.ts`。
- 只读复用：`src/collection/raw-data.ts`、`src/adapters/content-cleaning.ts`、`src/adapters/contracts.ts`。
- 依赖/包变更：`NONE`。
- 其他任何 tracked/untracked 路径：禁止。
- Spec/Case 映射：`spec.md` §3、§4、§7、§8；`PRO-01`、`PRO-02`、`PRO-03`、`PRO-11`、`PRO-12`。
- 禁止范围：不得修改 Collection raw-data/schema、Adapter、Database、LLM、Prompt、package 或任何既有测试；不得读库、调用 Clock、调用 LLM/HTTP、创建公共 factory。

### 4.2 实现要求

1. 调用 D05 `parseRawDataSourceItemV1()` 严格解析，不复制 schema，不修改原始 D05 文件。
2. 解析失败映射安全 `raw_data_invalid`，不抛 parser/Zod 细节。
3. 仅用 D04 `normalizeCleanText()` / `cleanTextValue()` 处理标题、正文、摘要的纯文本空白/换行；禁止调用 `cleanHtmlValue()`、`cleanReadabilityContent()`、`parseHtmlDocument()` 或任何 DOM 解析。
4. 同一纯文本规则适用于标题、正文、摘要；`<algorithm>`、`List<T>`、`<Foo/>` 等合法尖括号内容必须逐字保留，不得引入格式探测分支或新字段。
5. 按 §2.2 固定规则返回 `NormalizedContentDraft` 或安全不可用 reason。
6. `content_kind=NONE` 始终不可用；`SUMMARY`/`FRAGMENT` 不得被猜测为 FULL。
7. 正文为空但摘要可用时，`body` 取实际摘要且 `completeness=PARTIAL`；摘要字段保留规范化后的摘要。
8. 全部元数据来自 raw_data `entry`，缺失保持 `NULL`；没有 ID/created_at 生成。
9. 不访问网络、Adapter、数据库、Clock、LLM、Repository 或 queue；不导出公共 Processing factory。

### 4.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `PRO-01` | `FULL_BODY` + 可用正文 → `FULL`，正文清洗后保留有效文字与顺序 |
| `PRO-02` | `SUMMARY`/`FRAGMENT` → `PARTIAL`；无正文但有摘要时 body 仅含实际摘要 |
| `PRO-03` | `NONE`、坏 JSON/schema、空标题、空正文+空摘要 → 不可用安全 reason，不抛底层细节 |
| `PRO-11` | 纯文本中的 `<algorithm>`、`List<T>`、`<Foo/>`、Unicode、CRLF/空白 → 逐字保留有效文字并仅规范空白/换行；负向对照必须证明误用 HTML 剥标签会丢失这些 sentinel 并使测试失败 |
| `PRO-12` | 仅摘要 → PARTIAL body/summary 可用于后续路由，completeness 不丢失 |

另测：缺失 URL/author/published_at 保持 null；D05 v1 round-trip 样本可直接解析；strict 多余字段仍拒绝；相同输入重复调用输出确定且无共享可变状态。

交回冻结证据必须留出并记录 §8 的 `BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`；尚未发生项写 `PENDING`/`NOT_RUN`。

### 4.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/processing/content-normalization.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error' src/processing tests/processing || true
! rg -n 'cleanHtmlValue|cleanReadabilityContent|parseHtmlDocument' src/processing/content-normalization.ts
git diff --name-only <BASE_SHA> -- src/collection src/adapters src/database/schema.sql config/prompts .github
```

最后一条只枚举指定 tracked path 的 diff，输出必须为空。交回必须列出 base SHA、实际路径、Case 映射、命令结果、已知限制，并只报 `REVIEW`/`BLOCKED`。

## 5. D06-T02 · ContentRepository、单事务插入、回写与幂等 recheck

### 5.1 依赖与精确允许写集

- 前置：`D06-T01` 已通过、合并并按门禁归档；base 固定为 T01 merge SHA。
- 新增：`src/processing/source-item-repository.ts`，只提供 Processing 所需 `getById`/`setContentId`，不修改 Collection。
- 新增：`src/processing/content-repository.ts`。
- 新增：`src/processing/content-persistence.ts`。
- 新增：`tests/processing/source-item-repository.test.ts`。
- 新增：`tests/processing/content-repository.test.ts`。
- 新增：`tests/processing/content-persistence.test.ts`。
- 依赖/包变更：`NONE`。
- 不得修改 T01 两个文件；若 DTO 不足，先报 Lead，不得在 T02 重写判定或清洗。
- Spec/Case 映射：`spec.md` §2、§4、§5、§7、§8；`PRO-01`、`PRO-02`、`PRO-04`、`PRO-05`、`PRO-06`。
- 禁止范围：不得修改 `src/collection/**`、DDL、Adapter、LLM、Prompt、package 或 T01 文件；不得读取 Clock、调用路由/网络、创建公共 contract/factory 或派发任务。

### 5.2 实现要求

1. `ProcessingSourceItemRepository` 只读取固定 Source Item 列并以 `changes === 1` 回写/读回 `content_id`；`ContentRepository` 只使用 `contents` 固定字段，`getById` 参数化读取，`insert` 生成 ID 并完整读回，列顺序/映射稳定。
2. `ContentDraft` 的 `language` 固定 `NULL`，`created_at` 由调用方按 `+08:00` 格式化；Repository 不读取 Clock。
3. `ensureContent` 使用真实 `withTransaction()`；事务内重新读取 Source Item，若已有 `content_id` 则读取并复用。
4. 无 `content_id` 时插入 Content 并回写；`setContentId` 必须恰好命中一行，回读确认 `source_items.content_id === contents.id`。
5. Source Item 事务内消失时正常返回 `null`；关联 Content 不存在属于不变量失败，抛底层错误供最终映射为 `processing_failed`。
6. 插入后、回写前注入异常必须同时回滚 Content 与 Source Item 关联；回写后读回失败也必须回滚。
7. 重复 `ensureContent` 返回同一 Content 且 `contents` 行数不变；两个 Source Item 相同正文/URL 各自插入独立 Content。
8. 本卡不调用 Clock、LLM、网络或 logger，不创建公共 Processing contract/factory，不派发任务。

### 5.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `PRO-01` | Content 字段完整、`source_items.content_id` 指向新行，二者在成功事务内可见 |
| `PRO-02` | `FULL`/`PARTIAL` 与 summary/body 原样写入，无补造字段 |
| `PRO-04` | 已关联和事务内 recheck 均复用同一 Content，不新增第二份 |
| `PRO-05` | 两个 Source Item 相同正文/URL → 两个独立 Content ID 与关联 |
| `PRO-06` | 插 Content 后回写前异常 → `contents` 与 `source_items.content_id` 均回到事务前状态 |

另测：`getById`/`setContentId` 使用绑定参数；不存在 Source Item 返回 null/不回写；不存在 Content 返回 null；`setContentId` 零命中或多命中不静默成功；事务回调 thenable/async 被现有 helper 拒绝且整体回滚。

交回冻结证据必须留出并记录 §8 的 `BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`；尚未发生项写 `PENDING`/`NOT_RUN`。

### 5.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/processing/source-item-repository.test.ts tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts tests/database/transaction.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error' src/processing tests/processing || true
git diff --name-only <BASE_SHA> -- src/collection src/database/schema.sql src/adapters config/prompts .github
```

最后一条输出必须为空。交回与冻结格式同 T01；本卡通过只表示持久化/幂等能力 PASS。

## 6. D06-T03 · COMMIT 后路由调用、stub typed calls、错误/取消与 enum 去重

### 6.1 依赖与精确允许写集

- 前置：`D06-T02` 已通过、合并并按门禁归档；base 固定为 T02 merge SHA。
- 新增：`src/processing/processing-errors.ts`。
- 新增：`src/processing/processing-logger.ts`。
- 新增：`src/processing/content-router.ts`。
- 新增：`tests/processing/content-router.test.ts`。
- 依赖/包变更：`NONE`。
- 不得修改 D02 `src/llm/**`、D05、T01/T02 文件、Prompt 或 Database schema；不得在路由层加入事务。
- Spec/Case 映射：`spec.md` §6、§7、§8；`PRO-07`、`PRO-08`、`PRO-10`、`PRO-12`。
- 禁止范围：不得导入 Database/Repository/Adapter/raw_data，不得调用 Clock/HTTP/其他 LLM operation，不得重试、写库、派发任务或修改 D02 enum/schema。

### 6.2 实现要求

1. `ProcessingError` 只含 §2.5 四码和安全 message；提供 abort 识别和保守稳定映射，不泄露 cause。
2. `ProcessingLogger` 只接收白名单元数据；不得接受任意对象、正文、摘要、raw_data、Token 或底层错误。
3. `routeCommittedContent` 仅接收规范 Content、typed calls、logger、signal；不得接收 DB、raw_data 或 Adapter，从结构上阻止事务内路由。
4. 调用前检查 signal；调用时原样传入 `{ signal }`。检查/调用前后不得读写数据库。
5. 只调用 `routeProcessing` 一次；不自动重试、不调用其他 typed call、不发起 fetch/HTTP。
6. `taskData` 精确为 §2.4 七字段快照；不得夹带 `content_id`、raw_data 或 Prompt 上下文。
7. 对合法返回按首次顺序去重；未知/非法值由 D02 拒绝，T03 不得自行扩展枚举或吞掉 D02 错误。
8. 非取消异常映射 `llm_failed`，取消映射 `aborted`；路由结果不持久化。日志仅记录路由数量和 stage。

### 6.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `PRO-07` | P-01 抛错 → `llm_failed`，typed call 恰好 1 次，无重试、无 DB/写操作 |
| `PRO-08` | 固定 EVENT / KNOWLEDGE / BOTH / 空 → 返回 1/1/2/0 个 routes，空数组合法 |
| `PRO-10` | 合法重复 enum 按首次顺序去重；D02 非法 enum/额外字段错误向上归类为 `llm_failed` |
| `PRO-12` | PARTIAL 快照保留 completeness、body、summary；body 为实际摘要时不补造正文 |

另测：pre-abort 不调用 typed call；路由期间 AbortError/已 abort signal 映射 `aborted` 且 signal 引用原样透传；taskData 不泄漏 sentinel raw_data/Prompt/Token；logger 无正文/摘要；stub typed calls 只实现 `routeProcessing`。

交回冻结证据必须留出并记录 §8 的 `BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`；尚未发生项写 `PENDING`/`NOT_RUN`。

### 6.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/processing/content-router.test.ts tests/llm/response-validators.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error|fetch\(|fetchContent' src/processing tests/processing || true
git diff --name-only <BASE_SHA> -- src/llm src/adapters src/collection src/database/schema.sql config/prompts .github
```

最后一条输出必须为空；`rg` 在新增 Processing 文件中不得出现真实 fetch/fetchContent 依赖。交回与冻结格式同 T01；本卡通过只表示路由边界 PASS。

## 7. D06-T04 · 公共契约、factory、fixture 与真实 SQLite 集成

### 7.1 依赖与精确允许写集

- 前置：`D06-T03` 已通过、合并并按门禁归档；base 固定为 T03 merge SHA。
- 新增：`src/processing/contracts.ts`。
- 新增：`src/processing/processing.ts`。
- 新增：`src/processing/index.ts`。
- 新增：`tests/fixtures/processing.ts`。
- 新增：`tests/processing/processing-service.test.ts`。
- 新增：`tests/processing/processing-integration.test.ts`。
- 不得修改 T01～T03 文件；集成暴露内部契约缺陷时交 Lead 决定重走对应卡，不得在 T04 重写。
- 不得修改 D01 Schema、D02 LLM、D04 Adapter、D05 Collection、app/server/lifecycle、configuration/API、Prompt、CI 或 package/lock。
- 依赖/包变更：`NONE`。
- Spec/Case 映射：`spec.md` §1、§2、§6、§7、§8；`PRO-01`～`PRO-12` 的最终集成证据，其中 `PRO-08` 仅到 routes、`E2E-11` 仅 Processing 部分。
- 禁止范围：不得修改 T01～T03、`src/collection/**`、`src/llm/**`、DDL、Adapter、Prompt、CI、App/Server/Lifecycle、package/lock；不得实现 Runtime/队列/重试调度或 README 之外的新公共入口。

### 7.2 实现要求

1. `contracts.ts` 只暴露 Spec 的 `ProcessOptions`、`ProcessResult`、`ProcessingService`、`ProcessingDependencies`、必要 repository dependency 类型、稳定错误与 logger 类型；不暴露内部 SQL、事务 seam、raw parser、mutator 或测试后门。
2. `index.ts` 只导出 `createProcessing`、`ProcessingError` 及必要公共 type；不得导出 Worker/Runtime/queue 或 App 装配入口。
3. `createProcessing` 按 §2.3/§2.4 组合 T01/T02/T03：invalid input 在 DB 前；missing/raw null/NONE 零副作用；已有 Content 直接复用；新 Content COMMIT 后才路由。
4. 正常返回复制 `{content_id, routes}`；不返回 raw_data、Content 全对象、Logger/DB 或下游任务。路由空数组时 `content_id` 保留。
5. 事务/Repository 异常映射 `processing_failed`；P-01 异常映射 `llm_failed`；取消映射 `aborted`；不得把底层 SQL、JSON、Zod、Prompt 或模型错误放进 message/cause。
6. `tests/fixtures/processing.ts` 提供合成 Source Item/raw_data 写入、D05 `createRawDataSourceItemV1()/serializeRawDataSourceItemV1()` 样本、stub typed calls、stub LLM typed-call pair、captured logger、DB/HTTP spy 与行数断言；所有 URL 使用 `.example.test`，不读取私有文件。
7. 集成测试使用真实临时 SQLite、公共 `createProcessing`、真实 D05 raw_data serializer 和 D02 `createTypedLlmCalls` + `StubLLM` + 合成 Prompt 目录；禁止真实模型、真实 API Key 和公网。
8. 零原文 HTTP 证据必须同时覆盖：fixture `fetchContent` spy 调用数为 0，`globalThis.fetch` spy 调用数为 0；Collection/D05 回归也不得因 Processing 产生新请求。
9. 重复路由失败后手动再次 `process` 是 D06 验证方式；不得实现 Runtime 自动重试或队列派发。`E2E-11` 只验证 Processing 部分。
10. 测试后关闭 SQLite；无 server、socket、timer、unhandled rejection、SQLite/WAL/SHM 或真实网络依赖残留。

### 7.3 测试矩阵

| Case | 必测断言 |
|---|---|
| `PRO-01` | 真实 raw_data → FULL Content、关联回写、返回 content_id 后调用 P-01 |
| `PRO-02` | 摘要/片段 → PARTIAL，DB 与 LLM taskData 只含实际内容 |
| `PRO-03` | NONE/无 raw → `{content_id:null,routes:[]}`、Source Item 保留、Content/LLM/HTTP 均为 0 |
| `PRO-04` | 同 Source Item 重复 process → 同一 Content，可再次路由，contents 行数不增 |
| `PRO-05` | 两 Source Item 相同 body/URL → 独立 Content 与关联 |
| `PRO-06` | 注入回写异常 → 公共错误安全且 DB 无半完成状态 |
| `PRO-07` | 第一次 route 失败 Content 保留；第二次 process 复用同一 Content 并成功路由 |
| `PRO-08` | EVENT / KNOWLEDGE / BOTH / 空 → 1/1/2/0 routes；空 routes 保留 Content；零下游 queue 调用 |
| `PRO-09` | Processing 全程 `fetchContent` spy=0、`globalThis.fetch` spy=0 |
| `PRO-10` | StubLLM 返回重复 enum → D02 去重；未知 enum/额外字段 → `llm_failed`，Content 状态符合提交边界 |
| `PRO-11` | 纯文本尖括号/Unicode/空白经 collect→process 后可存，`<algorithm>`、`List<T>`、`<Foo/>` 不丢失 |
| `PRO-12` | 仅摘要 PARTIAL 进入 P-01，taskData completeness/body 正确，无抓取 HTTP |

另测：invalid ID 在 Repository/LLM 前抛 `invalid_input`；pre-abort 零 DB/LLM；Content COMMIT 后取消/路由失败仍保留 Content；已有 `content_id` 指向不存在 Content 时 `processing_failed`；factory 可重复调用且无模块级状态；返回字段严格为 snake_case `content_id` + routes；logger 不含正文/摘要/raw_data/Token；DDL/Prompt/CI/Collection/App 无 diff。

交回冻结证据必须留出并记录 §8 的 `BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`；尚未发生项写 `PENDING`/`NOT_RUN`。

### 7.4 验证命令与交回

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/processing/content-normalization.test.ts tests/processing/content-repository.test.ts tests/processing/content-persistence.test.ts tests/processing/content-router.test.ts tests/processing/processing-service.test.ts tests/processing/processing-integration.test.ts
npx vitest run tests/collection/raw-data.test.ts tests/collection/collection-integration.test.ts tests/database/transaction.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts
npm run verify
git diff --check
rg -n '\bany\b|@ts-ignore|@ts-expect-error' src/processing tests/processing tests/fixtures/processing.ts || true
git diff --name-only <BASE_SHA> -- src/database/schema.sql src/adapters src/collection src/llm src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

最后一条输出必须为空。测试中只允许合成 Prompt 目录与 StubLLM，不得读取真实 `config/prompts` 内容。交回与冻结格式同 T01，并附真实 SQLite + D05 raw_data + StubLLM 集成测试名/PASS，以及两个 HTTP spy 均为 0 的证据。

## 8. 每卡冻结、Candidate、Merge 与归档门禁

每卡必须使用全新 Paseo Worker，并按下述顺序执行；不得由 Lead 代替 Worker 编码，也不得让 Worker自行创建 candidate。

1. **启动证据**：记录 Worker Agent ID、workspace ID、branch、固定 base SHA、初始 `HEAD`/tree，tracked/staged/untracked 均为 0。
2. **范围审查**：Worker 只改本卡白名单；需额外路径立即 `BLOCKED`，不得先改后请示；不得 stage/commit/amend/merge/push。
3. **Lead 复核**：Lead 独立检查 diff、行为、Spec/Case 映射、错误/隐私、禁止路径、no-op 与全部定向/full verify；失败只退回可定位 BLOCKER。
4. **精确冻结**：Lead 以隔离 index 从固定 base 纳入全部允许变更，生成精确 tree 与 canonical full-index binary patch；记录 tree SHA、patch SHA-256、逐路径 blob、路径数和 `git diff-tree --check`。冻结后任何源文件变化都使证据失效并须重冻结。
5. **Architect G4**：Architect 对精确 base/tree/patch/路径和设计一致性给 `APPROVED`/`CHANGES_REQUIRED`；未批准不得创建 candidate。
6. **Candidate**：批准后由 Lead 以冻结 tree 创建单一 candidate commit；核验唯一 parent 为固定 base、tree 逐字等于冻结 tree、变更路径精确等于白名单。Worker branch tip 必须对齐 candidate，无领先或未审提交。
7. **Merge**：Lead 在 D06 主线以 `--no-ff` 合并 candidate；核验第一 parent 为当前批准文档/前卡基线、第二 parent 为 candidate、批准 blob 与 merge tree 一致，并记录 merge SHA/tree。
8. **合并后复验**：从 merge commit 独立执行本卡定向命令和 full `npm run verify`；全部 PASS 才标 `PASS · LOCAL_MERGE_VERIFIED`。
9. **Worker 归档**：核验 tracked/untracked 无唯一未交付成果、branch tip=candidate、candidate↔merge blob 一致且 clean；使用 Paseo `archive_workspace` 归档准确 Worker workspace，记录返回 workspace/agent IDs、`removedDirectory=true`，复查 active workspace/worktree 已无该项。主工作区永不归档。

每卡必须在 `progress.md` 记录以下 evidence key：

`BASE_SHA`、`WORKER_AGENT`、`WORKER_WORKSPACE`、`WORKER_BRANCH`、`CHANGED_PATHS`、`FROZEN_TREE`、`PATCH_SHA256`、`ARCHITECT_TREE_APPROVAL`、`CANDIDATE_SHA`、`MERGE_SHA`、`MERGE_TREE`、`VERIFICATION`、`ARCHIVE_RESULT`。

任一项缺失时不得用 `N/A` 冒充已完成门禁；未发生写 `PENDING`/`NOT_RUN`。冻结与 candidate 只使用精确 SHA，不以 branch 名或工作目录代替证据。

## 9. D06 集成 Gate 与最终验收

四卡全部 PASS 后，Lead 从最后一个精确 merge commit 的干净快照执行：

```bash
npm run verify:toolchain
npm ci --offline
npm run typecheck
npx vitest run tests/processing tests/collection/raw-data.test.ts tests/collection/collection-integration.test.ts tests/database/transaction.test.ts tests/llm/llm-calls.test.ts tests/llm/response-validators.test.ts
npm run verify
git diff --check
git diff --name-only <APPROVED_BASE_SHA> -- src/database/schema.sql src/adapters src/collection src/llm src/app.ts src/server.ts src/lifecycle.ts config/prompts config/prompt .github package.json package-lock.json
```

Gate 必须保留：

- `PRO-01`～`12` 的 D06 责任逐项映射；`PRO-08` 的 Runtime 派发部分、`E2E-11` 的 Runtime 重试与派发部分明确引用 D15，不冒充 D06 PASS。
- 全文/片段/无内容分支、失败回滚、事务内 recheck、已有 Content 复用、同文独立 Content、COMMIT 后路由、路由失败重试、四种路由与空路由保留。
- StubLLM 重复 enum 经 D02 去重、未知 enum/额外字段被 D02 拒绝、路由不落库、零原文 HTTP spy、无真实模型/API Key/公网。
- 真实临时 SQLite 与真实 D05 raw_data v1 serializer；测试资源全部关闭，无 SQLite/WAL/SHM、server/socket/timer/unhandled rejection 残留。
- DDL、Prompt、CI、Adapter、D05 Collection 生产文件、App/Server/Lifecycle、package/lock 无未批准 diff。
- Secret 检查只限定本里程碑 tracked diff 与明确合成 fixture，不读取 ignored/untracked 私密文件或数据库。

Lead 签发 `D06_LOCAL_GATE=PASS` 后交 Architect。Architect 可依据持续授权推送已批准 main SHA 并核验远程分支与精确 SHA 对应 CI Success；本地 Gate、远程 CI 和 Architect 最终验收全部满足前不得签发 `D06_FINAL_PASS`。

G3 批准且正式开发触发后，由 Architect 创建唯一 D06 推进心跳（默认 `*/10 * * * *`，`Asia/Shanghai`）并在 `progress.md` 记录准确 ID；Lead 不自行创建心跳。最终 PASS 后由 Architect 核验并归档全部 D06 Worker/Workspace 与 D06 Lead，删除准确心跳并复查删除结果；归档前确认 candidate/merge、branch tip、tracked/untracked 与唯一交付成果无遗漏。

## 10. 风险、回滚与停止条件

- raw_data 形态冲突：D05 v1 的 title/body/summary 已是 D04 纯文本；只复用 D05 strict parser 与 `normalizeCleanText()`/`cleanTextValue()`，禁止 DOM/HTML 二次清洗，不新增 envelope/字段或格式探测。若 strict schema 无法支持批准行为，标 `BLOCKED` 并回 Architect，不在 D06 私改版本。
- 标题 NOT NULL：raw_data `entry.title` 缺失或清洗后为空时正常 NONE；不得用 URL/文件名/LLM 补造。
- 并发写入：SQLite 无 Source Item 处理唯一约束，事务内 recheck 是正常竞态保护；不得改 DDL 或假设单线程。
- 提交边界：路由代码从结构上不能持有 DB 事务；COMMIT 后路由失败/取消不回滚；不得扩展 Runtime 自动重试。
- 枚举边界：合法去重留在 D06，未知值由 D02 严格拒绝；不得修改 D02 测试预期或吞掉非法输出。
- 隐私：日志与 LLM taskData 均不得包含 raw_data/摘要全文日志/Token；测试只使用合成 sentinel。
- 任何失败按 `BLOCKED`/`FAIL` 记录。同一问题连续两轮修复仍失败时暂停派发，区分实现、测试、任务拆分或 Spec 根因；涉及上游变更重走受影响 Gate。

## 11. G3 门禁结论

- 本 Plan 只将已批准 D06 Intent/Spec 映射为四张严格串行、文件级可执行任务卡，没有新增业务需求、公共契约、枚举、DDL、依赖或替代任务 ID。
- T01～T04 均列出精确允许写集、依赖、Spec/Case 映射、禁止范围、验证命令及冻结/candidate/merge/archive 证据字段。
- Processing 无原文 HTTP；只有 Content COMMIT 后才调用 `routeProcessing`；NONE 不建 Content/不路由；路由不落库；不改 DDL/Prompt/CI/Collection；测试不接真实模型或私有配置。
- v0.2 按 G3 唯一阻塞完成修订：raw_data title/body/summary 固定为 D04 已清洗纯文本，仅使用 `normalizeCleanText()`/`cleanTextValue()`；禁止 DOM/HTML 二次清洗，并增加尖括号逐字保留、负向对照与静态禁用检查。
- 本版待 Architect G3 审核。G3 通过前不创建心跳、不创建 Worker、不开始正式开发；Lead 不自批 G3。
