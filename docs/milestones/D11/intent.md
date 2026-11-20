# D11 Intent：Published Item 与模板

- 状态：`APPROVED · G1`
- 批准日期：2026-11-21
- 依赖基线：D01 数据库、D09 事件产物、D07 Knowledge、D10 Topic Matching、D15 Runtime 任务契约。
- 前置修复：D16-T04 第一轮语义回归已修复 `NEW_UPDATE.title` 复用父 Event 标题问题（`a59ec7d7…`），D11 渲染 Update 快照的信息量前提已就绪。
- 固定基线：`52dc00b35dde4671ec5f18ced59c871cf732315a`。

## 1. 目标

把已匹配 Topic 的目标（Event / Event Update / Knowledge）渲染为**不可变、可独立阅读**的 Published Item 快照，并在事务内保证唯一性。

**V1 完全不调用 LLM**：只使用模板渲染，保留 `PublicationRenderer` 可替换接口。

## 2. 业务规则

1. 发布门槛：目标存在 **且已有至少一条 Topic Association**。没有匹配绝不发布。
2. 发布时不重新匹配 Topic；关联 Topic 后来被禁用不影响本次发布。
3. `(target_type, target_id)` 全局唯一；多个 Topic 只生成 **一份** Published Item。
4. 重复 PublishTask 返回既有 Published Item ID，不重复渲染、不覆盖快照。
5. 快照创建后，`title/summary/body/published_at/id` **完全不变**；新证据、新 Update、Topic 变更都不改写已发布内容。
6. 来源链接仅来自已存证据（Content / Source Item / Event 证据关联），程序校验、去重、追加；**禁止虚构 URL**。
7. 无可用来源 URL **正常发布**；RSS `<link>` 可省略，不使用占位地址。
8. 事务内**再次核验**目标存在、Topic Association 与唯一性后才插入（不信任事务外预检查）。
9. 渲染产物为空/缺必填项 → 写入前失败；DDL `body` 非空白约束兜底。
10. COMMIT 后按目标类型发出轻量 RSS 同步通知；通知失败不回滚快照、不重渲染、不新增持久化任务。

## 3. 公共契约

```ts
type TargetType = "EVENT" | "EVENT_UPDATE" | "KNOWLEDGE";

interface PublishResult {
  readonly published_item_id: string | null;
  readonly already_published: boolean;
}

interface PublicationService {
  publish(type: TargetType, id: string, options?: { signal?: AbortSignal }): Promise<PublishResult>;
}
```

- 与 D15 `StageServices.publish` 对齐（D15 的 `PublishResult` 只有 `published_item_id`；D11 的 `already_published` 为可选扩展，不破坏结构兼容）。
- 已存在 Published Item → `{published_item_id: 原ID, already_published: true}`。
- 目标缺失/无 Topic Association → `{published_item_id: null, already_published: false}`（正常空结果，不重试）。
- 运行时导出仅 `createPublication`、`PublicationError`。
- 稳定错误：`invalid_input | aborted | publication_failed`。

## 4. 渲染契约

```ts
interface PublicationRenderer {
  render(context: PublicationContext): PublicationDraft;
}
```

- `PublicationDraft = { title, summary, body }`，均纯文本语义。
- `body` 为**安全可读 HTML**：所有内容值转义，只允许程序生成的 `<p>/<h2>/<ul>/<li>/<a href>` 结构。
- 恶意 HTML/JS 片段一律转义为文本，绝不作为可执行内容。
- `<a href>` 仅使用已通过校验的 `http(s)` URL；URL 本身转义。

## 5. 来源链接规则

| 目标类型 | 证据路径 |
|---|---|
| EVENT / EVENT_UPDATE | `event_content_links` → `contents` → `source_items`（`url` 优先，其次 `contents.url`） |
| KNOWLEDGE | `knowledge.content_id` → `source_items`（`url` 优先，其次 `contents.url`） |

- EVENT_UPDATE 只用**该 Update 自身**的证据，不继承父 Event 证据。
- 仅接受 `http:`/`https:`；拒绝 userinfo、控制字符、空白、javascript:/data:/file:。
- 按规范化 URL 去重，保持稳定顺序；数量上限（默认 5）。
- 链接以"来源"小节追加到 `body` 末尾；无链接则不追加该小节。

## 6. 四卡范围

1. `PublicationRenderer` 接口 + 三类模板 + HTML 安全编码（PUB-01/10/13）。
2. 来源链接提取、校验、去重、附加（PUB-06/07/08）。
3. 发布门槛、唯一短事务保存、多 Topic 唯一、重复复用（PUB-02～05、DB-13）。
4. 不可变性、事务内复检、COMMIT 后通知、公开工厂与真实 SQLite 集成（PUB-09/11/12）。

## 7. P0 验收范围

`PUB-01`～`PUB-10`、`PUB-12`、`PUB-13`、`DB-13`。`PUB-11` 为 P1（事务内复检的结构证明 + 注入测试）。

## 8. 不属于 D11 / 不冒充

- 不实现 LLM Renderer 或任何新 Prompt。
- 不实现 RSS XML 生成、归档、云端上传、HTTP API、Runtime 接线。
- 不新增表、不改 DDL、不改已验收的 D01～D10/D15 生产代码。
- 不读取真实私有 `config/prompt/user-context.md`；不调用任何模型。
- 不创建 PublishTask 队列（D15 已提供派发；D11 只提供业务服务）。
