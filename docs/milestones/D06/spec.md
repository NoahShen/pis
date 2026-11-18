# D06 Spec：Processing 内容标准化与路由

- 状态：`APPROVED · G2 PASS`
- 版本：v0.1
- Intent：G1 已批准（`docs/milestones/D06/intent.md`）。
- 实现基线：D05 最终 PASS，main `5111b20`（生产代码等同 `23908b1`）。

## 1. 公共契约

新增 Processing 模块，提供：

```ts
interface ProcessOptions { signal?: AbortSignal }

interface ProcessResult {
  content_id: string | null;
  routes: Array<"EVENT" | "KNOWLEDGE">;
}

interface ProcessingService {
  process(sourceItemId: string, options?: ProcessOptions): Promise<ProcessResult>;
}

function createProcessing(dependencies: ProcessingDependencies): ProcessingService;
```

- Source Item ID 必须为非空字符串；非法输入抛稳定领域错误，不读库、不调用 LLM。
- Source Item 不存在或 `raw_data` 缺失：返回 `{content_id: null, routes: []}`，零副作用。
- 返回的 `content_id` 必为本次复用或新建且已提交的 Content；`routes` 为去重后顺序保持的合法枚举集合。
- D06 不新增 HTTP route；供后续 Runtime 调用。

## 2. 依赖装配

`createProcessing` 显式接收：Database、SourceItemRepository（读取 + 回写关联）、ContentRepository（读取 + 插入）、`TypedLlmCalls`（仅用 `routeProcessing`）、Clock、logger。

- 不修改冻结 DDL；只使用 `contents` 与 `source_items.content_id`。
- 生产装配使用 SystemClock、CryptoIdGenerator 与 D02 已装配的 typed calls；测试注入 FakeClock、stub typed calls、fake logger。
- 不新增模块级单例；factory 私有状态在多次调用间正确清理。

## 3. raw_data 解析与内容判定

1. 读取 `source_items.raw_data`（D05 写入的 v1 JSON TEXT），按 D05 已冻结的 strict schema 解析；解析失败视为无可用内容并记录安全原因，不抛底层解析细节。
2. 取得 `entry` 与 `content` 证据；正文与摘要再经确定性清洗（去脚本/样式/标签、规范空白与换行），保留 Unicode 与有效文字。
3. 判定规则（不做字符数猜测）：

| `content_kind` | 结果 |
|---|---|
| `FULL_BODY` | 创建 Content，`completeness=FULL` |
| `SUMMARY` / `FRAGMENT` | 创建 Content，`completeness=PARTIAL` |
| `NONE`，或清洗后 `body` 为空 | 不创建 Content、不调用路由，返回空结果 |

3a. **`raw_data` 中的 `body`/`summary` 已是 D04 清洗后的纯文本**（D04 已在 Adapter 内完成去标签、去脚本/样式与实体解码）。Processing 只做纯文本规范化（统一换行、折叠空白、去空行），**不得再次执行 HTML 标签剥离**。否则正文中的合法尖括号内容（如 `<algorithm>`、`List<T>`、`<Foo/>`）会被误删，违反 PRO-11“不丢失有效文字”。

3b. 标题同样按纯文本规范化处理，不做标签剥离或实体二次解码。

4. 清洗后正文为空但摘要可用时，按 PARTIAL 处理，`body` 使用可用文本；两者都为空则按 NONE 处理。
5. 不虚构标题、时间、作者；`entry` 缺失字段写入 `NULL`。

## 4. Content 生成

按 `contents` 表字段生成：

| 字段 | 来源 |
|---|---|
| `id` | IdGenerator |
| `title` | `entry.title`，缺失时为空字符串不允许，必须跳过创建 |
| `url` / `author` / `published_at` | `entry` 对应字段，缺失为 `NULL` |
| `created_at` | `clock.now()` 格式化 |
| `body` | 清洗后正文，非空 |
| `summary` | 清洗后摘要，可为 `NULL` |
| `language` | V1 固定 `NULL` |
| `completeness` | `FULL` 或 `PARTIAL` |

标题缺失视为无可用内容（不创建 Content），因为 `contents.title` 为 NOT NULL。

## 5. 事务与幂等

使用现有同步 `withTransaction`：

1. 事务内重新读取 Source Item；若已有 `content_id`，读取该 Content 并直接复用，不插入。
2. 否则插入 Content，随后更新 `source_items.content_id`。
3. 事务回调必须同步、不得返回 thenable、不得调用 LLM 或网络。
4. 任一步失败整体回滚；不允许 Content 已插入但关联未写，或关联指向不存在 Content。
5. 不同 Source Item 即使正文相同也各自创建独立 Content，不做 Hash/相似度去重。
6. 事务外已读取到 `content_id` 时直接复用，不进入事务写入路径。

## 6. 路由调用

1. 仅在 Content 已 COMMIT 后调用 `routeProcessing`；不得在事务内调用。
2. 传入规范 Content 快照（`title`、`body`、`summary`、`completeness`、`url`、`author`、`published_at`），不传原始 HTML 全量、raw_data 原文或私有配置。
3. 返回枚举去重并保持首次顺序；未知值由 D02 校验拒绝，D06 不吞该错误。
4. 路由结果不写数据库；空数组时 Content 仍保留。
5. 路由失败向上抛出稳定错误，不回滚已保存 Content；调用方重试时复用旧 Content 再路由。
6. 单次调用沿用 D02 冻结行为：非流式、总超时 60 秒、响应上限 2 MiB、不自动重试。D06 不新增重试、退避、缓存或并发控制。
7. 调用方 `signal` 透传至 LLM 调用；已取消时抛 `aborted`，且不影响已提交 Content。

## 7. 错误、日志与隐私

- 稳定错误至少区分 `invalid_input`、`aborted`、`processing_failed`、`llm_failed`；不暴露 SQL、底层 cause、模型原始输出或 Prompt 内容。
- 日志只记录 `sourceItemId`、`contentId`、stage、安全 reason、路由数量；不记录正文、摘要、raw_data、Token 或模型输出。
- 不读取真实 `config/prompt/user-context.md`；五份功能 Prompt 只读且哈希不变。
- 测试不访问真实模型、真实 API Key 或公网。

## 8. 验收矩阵

覆盖 PRO-01～12 的 Processing 部分：

- PRO-01 全文 → FULL、回写关联、同事务提交。
- PRO-02 摘要/片段 → PARTIAL，正文仅含实际取得内容。
- PRO-03 无有效内容 → 无 Content、无路由、正常空结果。
- PRO-04 重复处理 → 复用同一 Content，不新增第二份，可再次路由。
- PRO-05 两个相同正文的 Source Item → 各自独立 Content。
- PRO-06 插入后回写前注入异常 → 全部回滚。
- PRO-07 路由失败后重试 → 复用旧 Content 再路由，不重新抓取或插入。
- PRO-08 四种路由结果 → 返回 1/1/2/0 个 routes，空路由保留 Content。
- PRO-09 `fetchContent` spy 调用 0 次。
- PRO-10 重复 enum 去重；未知 enum 拒绝且不产生 Content 之外的副作用。
- PRO-11 标题/正文含 XML/HTML、Unicode、换行空白 → 可存储、不丢有效文字、不新增事实；其中 `raw_data` 已是纯文本，正文含 `<algorithm>`、`List<T>` 等合法尖括号文字时必须原文保留。
- PRO-12 PARTIAL 进入路由时保持标记与实际正文。

另验证：`NONE` 零 LLM 调用；事务内无 LLM；取消时 `aborted`；DDL/Prompt/CI/Collection 无 diff。

## 9. 门禁与交付

Plan 由新 Lead 编写，Architect G3 批准后才创建 Worker。预计四卡串行：内容解析与判定 → Content Repository 与事务幂等 → 路由调用与错误边界 → 公共契约、fixture 与集成。每卡独立审核、精确 candidate/merge、归档；本地 Gate 后按持续授权 push/CI，最终 PASS 后清理心跳及全部 Lead/Worker workspace。