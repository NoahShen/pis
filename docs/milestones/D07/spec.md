# D07 Spec：Knowledge Analysis 知识价值判断与保存

- 状态：`DRAFT · G2_PENDING_ARCHITECT_REVIEW`
- 版本：v0.1
- Intent：`docs/milestones/D07/intent.md`（G1 已批准）。
- 实现基线：D06 最终 PASS，main `f268f3a`。

## 1. 公共契约

新增 Knowledge 模块：

```ts
interface KnowledgeOptions { signal?: AbortSignal }

interface KnowledgeResult {
  knowledge_id: string | null;
}

interface KnowledgeService {
  analyze(contentId: string, options?: KnowledgeOptions): Promise<KnowledgeResult>;
}

function createKnowledgeAnalysis(dependencies: KnowledgeDependencies): KnowledgeService;
```

- Content ID 必须为非空字符串；非法输入抛稳定领域错误，不读库、不调 LLM。
- Content 不存在：返回 `{knowledge_id: null}`，零副作用。
- 已有 Knowledge：返回该 Knowledge ID，不调用 LLM。
- D07 不新增 HTTP route；供后续 Runtime 调用。

## 2. 依赖装配

`createKnowledgeAnalysis` 显式接收：Database、ContentRepository（读取）、KnowledgeRepository（读取 + 插入）、`TypedLlmCalls`（仅用 `analyzeKnowledge`）、Clock、IdGenerator、logger。

- 不修改冻结 DDL；只使用 `contents` 与 `knowledge`。
- 生产装配使用 SystemClock、CryptoIdGenerator；测试注入 FakeClock、SequenceIdGenerator、stub typed calls、captured logger。
- 不新增模块级单例；factory 私有状态在多次调用间正确清理。

## 3. Content 读取与输入组装

1. 按 ID 读取 `contents` 行；不存在返回空结果。
2. 组装任务数据，字段固定为：`title`、`body`、`summary`、`author`、`published_at`、`completeness`。
3. 不传 `content_id`、raw_data、原始 HTML、Source Item 信息或 Topics。
4. 不加载历史 Knowledge；不做候选检索。
5. 系统指令由 `PromptRepository.load("knowledge-analysis")` 提供，包含 `instructions` 与 `userContext`；`userContext` 为 `null` 时按 D02 既有行为处理。
6. 只有 Knowledge Analysis 读取 User Context；其余 operation 的 `userContext` 恒为 `null`（PMT-09）。

## 4. 调用与响应校验

1. 在事务之外调用一次 `analyzeKnowledge(taskData, { signal })`。
2. 沿用 D02 冻结行为：非流式、60 秒总超时、2 MiB 响应上限、不自动重试、不切换 Provider。
3. D02 的严格 Schema 为唯一校验来源，D07 不复制或放宽：
   - `valuable=false`：只允许该字段；额外字段拒绝。
   - `valuable=true`：必须有非空 `title`、`summary`、`value`；`category` 为 `Insight|Experience|Method|Resource|null` 且可缺省；`findings` 为 `{title, description}` 数组，可为空。
4. 校验失败映射稳定错误，不写库，不透出模型原始输出、Prompt 或底层 cause。
5. 调用方 `signal` 透传；已取消时抛 `aborted`，且不产生写入。

## 5. Knowledge 保存

按 `knowledge` 表字段写入：

| 字段 | 来源 |
|---|---|
| `id` | IdGenerator |
| `content_id` | 本次 Content ID |
| `title` / `summary` / `value` | 模型校验后的值 |
| `category` | 模型值；缺省或 `null` 写 `NULL`，不用空字符串 |
| `findings_json` | `JSON.stringify(findings)`，数组可为空 |

事务语义（使用现有同步 `withTransaction`）：

1. 事务内重新读取 `content_id` 对应 Knowledge；已存在则直接复用返回，不插入。
2. 否则插入一行并读回校验。
3. 回调必须同步，不得返回 thenable，不得调用 Clock、LLM、网络或异步 logger。
4. 任一步失败整体回滚；`UNIQUE(content_id)` 冲突视为并发竞争，回滚后按既有记录复用处理。
5. 不同 Content 即使正文相同也各自独立插入，不做跨文章合并。

## 6. 幂等与重复执行

1. 已存在 Knowledge：不调用 LLM，直接返回既有 ID。
2. 同一 Content 并发进入：事务内 recheck 保证只有一行。
3. 重复执行不得改变既有 Knowledge 内容，也不得新建第二份。

## 7. 错误、日志与隐私

- 稳定错误至少区分 `invalid_input`、`aborted`、`knowledge_failed`、`llm_failed`；不暴露 SQL、JSON、Zod 细节、模型原始输出或 Prompt 内容。
- 日志只记录 `contentId`、`knowledgeId`、stage、安全 reason、`valuable` 布尔；不记录正文、摘要、findings 内容、Prompt 或 Token。
- 不读取真实 `config/prompt/user-context.md`；五份功能 Prompt 只读且哈希不变。
- 测试不访问真实模型、真实 API Key 或公网。

## 8. 验收矩阵

覆盖 KNO-01～KNO-06、KNO-08、KNO-11、KNO-12 的 D07 责任：

- KNO-01 `valuable=true` → 1 条 Knowledge，字段来自校验后值，返回新 ID。
- KNO-02 `valuable=false` → 不保存、不派发，Content 保留。
- KNO-03 3 个 findings → 1 条 Knowledge + 3 个内部 Finding，无独立实体。
- KNO-04 重复执行 → 复用同一 Knowledge，LLM 调用 0 次，行数不变。
- KNO-05 两个 Content 相同正文 → 各自独立 Knowledge。
- KNO-06 输入组装 spy → 只含当前 Content + 两份 Prompt；不含历史 Knowledge、Topics。
- KNO-08 缺字段/非法 findings/非法 category → 校验失败，零写入。
- KNO-11 `category=null`、`findings=[]` → 合法，保存 1 条。
- KNO-12 `valuable=false` 带额外字段 → 拒绝，不部分写入。

另验证：Content 不存在零副作用；非法 ID 在 DB 前失败；pre-abort 零 LLM 零写入；LLM 失败零写入；`knowledge_id` 为 snake_case；DDL/Prompt/CI/Collection/Processing 无 diff。

KNO-07/09/10 属 S0/S1 真实模型语义回归，不在 D07 P0 Gate 内，明确标注不冒充。

## 9. 门禁与交付

Plan 由新 Lead 编写，Architect G3 批准后才创建 Worker。预计四卡串行：输入组装与契约 → 严格校验与错误映射 → Repository 与事务幂等 → 公共 factory 与集成。每卡独立审核、精确 candidate/merge、归档；本地 Gate 后按持续授权 push/CI，最终 PASS 后清理心跳及全部 Lead/Worker workspace。
