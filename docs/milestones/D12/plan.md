# D12 Plan：本地静态 RSS 生成与归档

> 版本：v0.3
> 状态：`APPROVED · G3 · Architect`
> 计划基线：main `d3a86fb8c2ee1571978058d69fe636c13da84796`
> Intent：`docs/milestones/D12/intent.md`（`APPROVED · G1`）
> Spec：`docs/milestones/D12/spec.md`（`APPROVED · G2 · Architect`）

本文只把已批准的 D12 Intent/Spec 映射为四张文件级、严格串行的 Worker 卡。当前只交付 `plan.md` 与 `progress.md`；**不创建 Worker、心跳、candidate、merge 或生产代码，不自行批准 G3**。G3 通过前四卡均保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

下文所有定向测试与全量验证均隐含该前置。版本不符时 Worker 直接报告 `BLOCKED`，不得切换宿主默认运行时。

## 1. 目标、边界与 Case 映射

交付 `Published Item → 完整本地静态 RSS 文件集`：两类 Feed、固定主窗口、0～199 条可重建 pending 投影、完整封存归档、RFC 5005 静态链、不可变归档、任意快照完整历史覆盖、冲突安全失败、本地 Artifact Store、静态读取和确定性 smoke。D12 不接入生产启动通知、Runtime、云端 Publisher、公共 RSS HTTP 路由或 D13 平台。

### 1.1 任务与 Case

| 卡片 | 唯一交付职责 | D12 Case | 后续责任 |
|---|---|---|---|
| `D12-T01` RSS contracts、Feed mapping 与 XML renderer | 两类 Feed 映射、Published Item 快照、来源链接、RSS 2.0/`content:encoded` | `RSS-01`～`RSS-07` | T02 只消费本卡公共契约，不重写 item 渲染 |
| `D12-T02` 归档发现、pending、RFC 5005 与同步编排 | 主窗口 200、封存批次 200、pending 0～199、三层静态链、不可变/迟到/回拨/同名冲突算法 | `RSS-08`～`RSS-10`、`RSS-17`；为 `RSS-11/24` 提供算法实现 | T03 只落本地 Store 与组合调用，不改变算法 |
| `D12-T03` 本地 Artifact Store 与本地同步 | 安全相对 key、目录约束、单文件原子写、archive only-if-absent、head/pending 原子替换、静态 bytes | `RSS-11`、`RSS-24`；Store 原语支撑 `RSS-12/13/14` | T04 用真实 SQLite/本地 HTTP 完成 Case 验收 |
| `D12-T04` 完整文件集集成、smoke、文档与只读验收边界 | head+pending+archive 完整 `.xml` 文件集、静态 HTTP、默认库隔离、D11A 临时库只读重建证据 | `RSS-12`～`RSS-14`、`RSS-18` | 不把本地子集冒充 `RSS-15/16` 或 `RSS-19～23` 云端验收 |

`RSS-20/22` 只在本地子集验证“数据库不回滚、新封存 archive→pending→主文件写序、无半写 XML”；不得宣称上传、云端可见性或重试已验证。pending 是可重建、可替换的 RFC 5005 archive document，包含 `<fh:archive/>`；它不是满 200 条的不可变封存批次，也不是持久业务队列、Outbox 或第七种 Runtime 任务。D12 不创建数据库 schema、Feed Token、`?before` Cursor 或生产 Publisher。

### 1.2 固定公共契约

T01 固定以下公共命名与语义，后续卡不得静默改名或扩展云端语义：

```ts
export const RSS_HEAD_LIMIT = 200;
export const RSS_ARCHIVE_BATCH_SIZE = 200;

export type RssFeedKind = "EVENT_UPDATES" | "CURATED_CONTENT";

export interface RssFeedDefinition {
  readonly kind: RssFeedKind;
  readonly publicationFeed: "EVENT" | "KNOWLEDGE";
  readonly title: "PIS Event Updates" | "PIS Curated Content";
  readonly description: string;
  readonly headKey: "event-updates.xml" | "curated-content.xml";
  readonly pendingKey:
    | "event-updates-pending.xml"
    | "curated-content-pending.xml";
  readonly archiveFilePrefix: "event-updates" | "curated-content";
}

export interface RssPublishedItemReader {
  list(feed: RssFeedKind): Promise<readonly PublishedItem[]>;
}

export interface RssArtifactStore {
  list(prefix: string): Promise<readonly string[]>;
  read(key: string): Promise<Uint8Array | null>;
  write(
    key: string,
    bytes: Uint8Array,
    options?: { readonly onlyIfAbsent?: boolean },
  ): Promise<void>;
}

export interface RssSyncOptions {
  readonly headLimit?: number;
  readonly archiveBatchSize?: number;
}

export interface RssSyncResult {
  readonly feed: RssFeedKind;
  readonly headKey: string;
  readonly pendingKey: string;
  readonly pendingGuidCount: number;
  readonly existingArchiveKeys: readonly string[];
  readonly createdArchiveKeys: readonly string[];
  readonly archivedOnlyGuidCount: number;
}

export interface RssSyncService {
  sync(feed: RssFeedKind): Promise<RssSyncResult>;
}
```

- `RssSyncResult` 只含 key、计数等安全元数据，不含正文、完整订阅 URL、secret、SQL 或底层异常字符串。
- 内部 `headLimit`/`archiveBatchSize` 只允许正整数注入用于确定性测试；生产封装固定默认 200/200，不能由 RSS 内容、数据库文本或网络输入控制。`pendingKey` 始终存在并始终渲染 0～199 条当前余量；`pendingGuidCount` 只作审计计数，不能代替 pending 条目本身。
- 错误契约固定为可判别 `RssError`，至少覆盖 `invalid_input`、`invalid_time`、`invalid_xml_character`、`invalid_archive`、`invalid_pending`、`archive_conflict`、`invalid_artifact_key`、`unsafe_path`、`artifact_exists`、`artifact_write_failed`。对外 message 不含正文、完整来源 URL、绝对路径、SQL、secret 或底层 cause。

### 1.3 固定 XML 与归档规则

1. Feed：`EVENT_UPDATES` 精确映射 D11 `PublicationFeed = EVENT`，但 D11 查询已包含 `EVENT + EVENT_UPDATE`；`CURATED_CONTENT` 只映射 `KNOWLEDGE`。T01 reader 必须保留 D11 Repository 的 `(published_at DESC,id DESC)` 顺序并在边界校验字段。
2. XML：固定 UTF-8、LF、RSS 2.0；namespace URI 固定为 `content="http://purl.org/rss/1.0/modules/content/"`、`atom="http://www.w3.org/2005/Atom"`、`fh="http://purl.org/syndication/history/1.0"`。channel title/description 来自固定 Feed 定义，`<link>` 使用受控相对文件名；不生成当前时间、随机值、Topic category 或部署 secret。
3. Item：`title`/`description` 使用 XML text 转义；`content:encoded` 使用 CDATA，正文中的 `]]>` 必须拆分为安全 CDATA；GUID 固定 `pis:published:<published_item.id>` 且 `isPermaLink="false"`；`pubDate` 用 `published_at` 解析后转 RFC 822 GMT，非法时间失败。
4. 来源链接：只解析不可变 `published_items.body` 末尾 D11 固定“来源”区域的第一个合法 `<a href>`；HTML entity 解码后复用 `normalizeHttpUrl` 等价规则，仅接受 HTTP(S)、无 userinfo/控制字符。无合法链接就省略 item `<link>`，不查询 Source/Content 后续证据，不伪造 URL。
5. 主 Feed 项目按 `(published_at DESC,id DESC)` 取当前 Feed 前 `headLimit`。排除既有归档 GUID 后，未封存集合按 `(published_at ASC,id ASC)` 每满 `archiveBatchSize` 形成新归档，剩余 0～199 条全部进入 pending。主 Feed、pending、归档允许 GUID 重叠；封存归档彼此不得重叠。
6. pending key 固定 `<feed>-pending.xml`，是包含 `<fh:archive/>` 的可重建 RFC 5005 archive document，按 ASC 渲染当前全部 0～199 条余量。pending 可随快照原子替换，但不是满 `archiveBatchSize` 条的不可变封存批次。主 Feed 不含 `<fh:archive/>`，其 `prev-archive` 指向 pending；pending 的 `prev-archive` 指向最新封存归档；每份满 200 条封存 archive 含 `<fh:archive/>` 并指向紧邻上一封存归档，首封存归档不指向不存在文件。链接只使用同一输出根内的规范相对 URI，不请求 `?before`。
7. 已存在归档先读 bytes 再比较：完全相等复用；同名不同 bytes 报 `archive_conflict`，保留旧归档、旧 pending 和旧主文件，后续均不写。损坏、非连续序号、错误 Feed title、重复/越界 GUID、错误 chain 一律安全失败，不修复历史文件。
8. 迟到/回拨只影响未封存集合。若迟到项凑满完整新批次则按 ASC 封存；不足一批的全部余量立即进入 pending，因此主 Feed+pending+归档在任意快照均按 GUID 去重覆盖数据库当前全集。旧归档 URI/GUID/bytes 永不重渲染。
9. 每次 Feed sync 固定写序：新封存归档 → pending → 主文件。pending 和主文件必须完整、原子替换；任何前序失败不得推进后续文件。无前序文件可写时仍生成当前 pending（可为 0 条）并最后生成 head；始终生成 pending 使旧 pending 可被原子替换而无需删除 API，并保持链确定。

### 1.4 串行门禁、冻结与证据模板

四卡严格串行，每卡使用全新 Paseo Worker 与独立 worktree。Worker 不 commit/stage/amend/merge/push，不改 `progress.md`，只返回 `REVIEW` 或 `BLOCKED`。

- G3 通过后，Architect 将本 Plan/Progress 提交为 `C0`；T01 base 为 `C0`。
- 串行 base 固定为：T01=`C0`、T02=`C1`、T03=`C2`、T04=`C3`；`C1/C2/C3` 分别是前一卡 Lead closeout 的精确文档提交。不得用近似日期、分支头或工作树代替。
- Lead 逐文件核对 diff 与写集；未授权路径和 `src/database/schema.sql`、`src/publication/**`、`package-lock.json` 的 diff 必须为 0。
- Lead 以 base 加 Worker 工作树生成临时 index，冻结 canonical full-index patch、tree SHA、全部新增/修改 blob SHA 和 patch SHA-256；证据放 `/private/tmp/d12-tNN-freeze.*/`，不进入 Git。
- Architect G4 独立复核 frozen tree/patch/blob 与 Spec。通过后由 Lead 从 frozen tree 创建 candidate，执行 `git merge-tree --write-tree <base> <candidate>` 预演；结果不等于 candidate tree 时停止。再由 Architect 授权的既定流程 merge，记录 candidate/merge SHA。
- merge 后由 Lead 运行定向测试、`npm run verify`、`git diff --check`；不得用 Worker 自测替代 merge 后复验。Worker/Workspace 归档成功后，进度才可写 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`，closeout 文档提交成为下一卡 base。
- 任一阻塞问题只能回到对应卡写集修复；后续卡不得越权修改前卡生产代码。Worker/Workspace ID、candidate/merge SHA、merge-tree、frozen tree/patch/blob、full verify、归档结果均逐卡记录。

## 2. D12-T01 · RSS contracts、XML renderer 与 Published Item 映射

### 2.1 Base、依赖与精确写集

- Base：`C0`，即 G3 通过后的 `plan.md`/`progress.md` 精确文档提交。
- 串行前置：`NONE`（D00～D11、D11A、D15 已在前置基线合并）。
- 外部依赖/包变更：`NONE`。
- 新增：`src/rss/contracts.ts`
- 新增：`src/rss/feed.ts`
- 新增：`src/rss/published-item-source.ts`
- 新增：`src/rss/source-link.ts`
- 新增：`src/rss/xml-renderer.ts`
- 新增：`src/rss/index.ts`
- 新增：`tests/fixtures/rss.ts`
- 新增：`tests/rss/feed.test.ts`
- 新增：`tests/rss/source-link.test.ts`
- 新增：`tests/rss/xml-renderer.test.ts`
- 只读：`src/publication/contracts.ts`、`src/publication/published-item-repository.ts`、`src/publication/source-links.ts`、`src/publication/html.ts`、`tests/fixtures/publication.ts`、既有 `fast-xml-parser` 类型/测试写法。
- 只读且禁止修改：`src/database/schema.sql`、`src/publication/**` 全部生产文件、`package.json`、`package-lock.json`、`src/runtime/**`、`src/production/**`、D11A smoke。

### 2.2 实现要求

1. `feed.ts` 提供唯一 `RSS_FEEDS` 定义与 `getRssFeed(kind)`；title、description、head key、pending key、archive prefix、D11 publication feed 映射精确固定，不接受字符串模糊匹配。
2. `published-item-source.ts` 提供 `createPublishedItemSource(repository: PublishedItemRepository): RssPublishedItemReader`。只调用 `listForFeed`，不执行新 SQL；返回不可变快照拷贝并校验七个字段、target type 与 order。若 Repository 返回跨类条目或不稳定顺序，稳定失败，不自行重排掩盖上游缺陷。
3. `source-link.ts` 提供 `extractPublishedItemSourceLink(body: string): string | null`。使用既有 `linkedom` 做结构解析，限定 D11 追加的 `section > h2` 文本“来源”及其同一 section 内 anchor；按文档顺序返回首个通过 `normalizeHttpUrl` 的 href。不得选正文其他链接，不得读取数据库/网络。
4. `xml-renderer.ts` 提供固定的 head/pending/archive 渲染入口，输入已排序 items、Feed 定义、当前文档 href、previous archive href 与文档类型，输出确定性 `Uint8Array`。三类文档使用同一个 item 渲染函数，保证同 GUID 的 title/description/content/GUID/pubDate/link 字节一致。
5. pending 渲染器必须支持 0～199 条：0 条仍输出合法 RSS channel，但不输出 item。head 不得含 `<fh:archive/>`；pending 与满 200 条封存 archive 均必须含 `<fh:archive/>`。三类文档均不生成当前时间，其 `prev-archive` 均只接受本 Feed 的规范相对 href，非法/绝对/跨 Feed href 稳定失败。
6. XML 输出必须可被既有 `fast-xml-parser` 的 `XMLValidator/XMLParser` 完整解析。CDATA 的 `]]>`、文本 XML 字符、URL 属性全部安全处理；任何 XML 1.0 非法控制字符、非法时间或非受控 archive href 稳定失败。
7. 正文只来自 Published Item `body` 快照。renderer 不刷新来源、不改写 HTML、不调用 LLM、不查询 Topic Association，不加入 category、generatedAt 或当前 clock。
8. `index.ts` 只导出本卡公共类型、Feed 定义、reader factory、source-link extractor、renderer 入口与错误；Worker 不得顺便搭建 T02/T03 空实现。

### 2.3 定向测试

- `RSS-01/02`：EVENT、EVENT_UPDATE、KNOWLEDGE 三类输入分别进入两份 Feed；Event 首条和 Update 均出现，Knowledge 不串档。
- `RSS-03`：中文、`& < > "`、HTML、`]]>`、非法 XML 字符、URL 属性转义；XML parse 成功且 `content:encoded` 正文不二次 HTML 转义/反转义。
- `RSS-04`：相同快照重复 render bytes 相等；GUID 只由 Published Item ID 决定；无 clock/DB/LLM 调用。
- `RSS-05`：`2026-11-20T08:00:00.000+08:00` 转为 RFC 822 且解析 instant 相同；非法时间稳定失败。
- `RSS-06/07`：无来源区域或非法链接省略 item `<link>`；来源区首合法链接稳定；后补证据/正文其他链接不改变已发布快照结果。
- RFC 5005 文档标记：head 不含 `<fh:archive/>`；0 条和部分条目的 pending 均含 `<fh:archive/>`；满 200 条封存 archive 含 `<fh:archive/>`。pending item payload 与同 GUID 的 head/sealed archive 一致；非法 previous href 稳定失败。
- 定向命令：`npm test -- tests/rss/feed.test.ts tests/rss/source-link.test.ts tests/rss/xml-renderer.test.ts`
- 全量命令：`npm run verify`

### 2.4 禁止事项与验收出口

- 禁止修改 D11、SQLite schema、HTTP/API、Runtime、生产装配、Prompt、依赖或任何云端概念。
- 禁止用字符串正则把正文任意第一个链接当作来源；禁止在 XML 中拼接未验证 key/异常消息。
- 证据必须包含 Feed 映射矩阵、XML parse 结果、time instant、source-link 负/正断言、重复 render bytes、typecheck/full verify 摘要。
- 逐卡门禁证据：精确 base、受保护路径 diff=0、frozen patch/tree/全部 blob、Architect G4、candidate、merge-tree、merge、merge 后定向+`npm run verify`、Worker/Workspace 归档。
- 完成冻结/G4/candidate/merge-tree/merge/full verify/归档证据后才可进入 T02；T01 本身不宣称归档或文件集完成。

## 3. D12-T02 · 归档发现、规划与 RFC 5005 同步算法

### 3.1 Base、依赖与精确写集

- Base：T01 `PASS` 的精确 closeout 文档提交 `C1`。
- 串行前置：`D12-T01`；外部依赖/包变更：`NONE`。
- 新增：`src/rss/archive.ts`
- 新增：`src/rss/archive-planner.ts`
- 新增：`src/rss/sync-service.ts`
- 修改：`src/rss/index.ts`
- 修改：`tests/fixtures/rss.ts`
- 新增：`tests/rss/archive.test.ts`
- 新增：`tests/rss/archive-planner.test.ts`
- 新增：`tests/rss/sync-service.test.ts`
- 只读：T01 contracts/feed/reader/source-link/xml-renderer；D11 `PublishedItemRepository`；既有 `fast-xml-parser`。
- 只读且禁止修改：`src/publication/**`、`src/database/schema.sql`、T03 将新增的本地 Store 路径、`package.json`、`package-lock.json`、Runtime/Production/D13 配置。

### 3.2 归档解析与规划算法

1. `archive.ts` 固定 archive/pending key parser：满 200 条封存 archive 只接受 `archive/<event-updates|curated-content>-NNNN.xml`，序号正整数且连续；pending 只接受 Feed 定义中的根级 `<feed>-pending.xml`。解析 RSS XML 的 channel title、RFC 5005 文档类型（head 不得含 `fh:archive`；pending 与 sealed archive 必须含 `fh:archive`）、`atom:link rel="prev-archive"`、item GUID 与完整 item payload。XML 解析必须防数组/单对象形状歧义、重复 GUID、错误 Feed、sealed archive 非配置 `batchSize` 条目、pending 非 0～batchSize-1 条目、错误 previous link。
2. `discoverArchives(store, feed, batchSize)`：`store.list("archive/")` 后只取本 Feed；按序号排序并要求 `1..N` 无空洞。每个归档必须指向紧邻前序（首归档无 prev），否则 `invalid_archive`。既有 pending 不参与封存边界恢复，也不阻止重建；写入阶段始终以当前快照生成的 pending 完整替换它。
3. `planAndRenderSync(snapshot, archives, options)`：先用既有归档 GUID 集合建立封存边界，保留数据库中仍缺失的 archived-only GUID 计数；数据库当前条目按快照稳定排序。未封存集合排除所有 archived GUID 后按 ASC 每满 `batchSize` 形成新归档，剩余全部 0～199 条形成 pending。
4. 每个计算封存归档从 `nextSequence` 连续命名；渲染 bytes 必须只由该批 item 快照与 previous archive 元数据决定。不得以新的数据库排序重切既有封存归档，不得用 wall clock 选择批次。pending 按当前余量确定性重建并包含 `fh:archive`，但它是可替换 archive document、不是封存边界，也不得被当作满 200 条不可变封存批次。
5. 生成主 Feed 时取当前 snapshot 的 DESC 最新 `headLimit`。head 的 `prev-archive` 固定指向当前 pending；pending 的 `prev-archive` 指向最新封存归档，若没有归档则无 previous。同 GUID 在 head/pending/archive 的 item payload 必须相同；三者允许重叠。
6. 规划结果必须包含 `pendingKey`、`pendingGuidCount`、既有/新建归档和 archived-only 计数；`pendingGuidCount` 仅用于审计，pending XML 必须实际包含这些全部余量。初始化可选较小正整数 options 仅用于测试；非法 0、负数、非整数或大于默认值（生产默认不可因测试扩大）稳定失败。T02 测试可用内存 Fake Store，但其语义必须与 T01 `RssArtifactStore` 一致。

### 3.3 同步顺序与冲突算法

1. `sync-service.ts` 提供 `createRssSyncService({reader, store, options?})`，实现 `RssSyncService.sync(feed)`；每次 sync 先完整读取数据库快照、列举/解析归档、规划，再开始写入，不使用当前 clock。
2. 新满 200 条封存归档全部按序号写，调用 `store.write(key, bytes, {onlyIfAbsent:true})`，且每次写入前/失败后再 `read(key)` 比较。同名 bytes 相等视为已存在；同名 bytes 不同抛 `archive_conflict`，保留旧封存归档、旧 pending 和旧主文件并停止该 Feed，pending/head 均 0 次写。
3. 所有新归档成功后，按 `store.write(feed.pendingKey, pendingBytes)` 原子替换 pending；仅 pending 成功后才写/替换主 Feed。pending 可替换但不得 only-if-absent；主 Feed 最后写。
4. 写封存归档成功、pending 失败时保留完整新封存归档和旧 pending/head；pending 成功、head 失败时保留新 pending 与旧 head，下一次 sync 可重建。不得清理封存归档或制造半写 XML；下次 sync 可复用完整封存归档并继续。
5. 新归档、pending 与 head 同时需要写时，Fake Store trace 必须严格证明 archive(s) → pending → head。任何前序写入失败都不得继续后续写。
6. 既有满 200 条封存归档损坏、链异常、GUID 重复/越界、同名冲突均安全失败；禁止删除、重命名、回填、重新格式化或“修复”旧封存归档。缺主文件或 pending 可重建；已有 head/pending 不参与封存边界恢复。

### 3.4 定向测试

- `RSS-08`：201 条时 archive 0001 为 1～200，pending 为 201，head 为 2～201；链为 head→pending→archive0001，四者按 GUID 去重覆盖 201 且 pending item 实际存在。
- `RSS-09`：400 条时 archive 0001/0002，pending 为 0 条合法 XML，head 为 201～400，链为 head→pending→archive0002；401 条时 pending 为 401，head 为 202～401；451 条时 pending 为 401～451，head 为 252～451。每个快照按 head+pending+archive 去重恰覆盖当前全集，不依赖 `?before`。
- `RSS-10`：同一 `published_at` 用 ID 稳定 DESC head 排序、ASC pending/archive 排序；重复 sync 同 GUID 在 head/pending/archive payload 一致。
- `RSS-17`：两类 Feed 交错生成，各自 head/pending/archive 只含正确 target type，GUID 不跨类。
- 冲突/写序：同名不同 bytes、损坏 archive、空洞链、重复 GUID、损坏/缺失 pending 可重建、archive 写失败、pending 写失败、head 写失败；trace 证明失败后不推进后续写，冲突时旧 pending/head bytes 保留。
- 迟到/回拨：已封存 archive URI/成员/bytes 不变；任意迟到项立即进入当前 pending（或凑满完整新批次），从其 GUID 可从 pending 静态读取；后续余量转 archive 时 pending 原子更新为 0～199。
- 定向命令：`npm test -- tests/rss/archive.test.ts tests/rss/archive-planner.test.ts tests/rss/sync-service.test.ts`
- 全量命令：`npm run verify`

### 3.5 禁止事项与验收出口

- 禁止实现文件系统 Store、真实 temp directory、HTTP GET、数据库 DDL、云端 publish/list version 或生产通知；T03 负责本地持久化。
- 禁止只按文件名猜内容、只按时间重切历史、静默覆盖同名封存归档或在冲突后更新 pending/head；禁止把 pending 当作满 200 条不可变封存批次或队列。
- 证据需包含 201/400/401/451 两 Feed 的 head/pending/archive GUID 集合、完整链、writer trace、conflict 无后续写、迟到/回拨 bytes、pending 0 与 51 条实例。通过 G4/merge/full verify/归档后才可进入 T03。
- 逐卡门禁证据：精确 base、Fake Store 写序 trace、frozen patch/tree/全部 blob、Architect G4、candidate、merge-tree、merge、merge 后定向+`npm run verify`、Worker/Workspace 归档。

## 4. D12-T03 · 本地 Artifact Store、安全路径与本地同步

### 4.1 Base、依赖与精确写集

- Base：T02 `PASS` 的精确 closeout 文档提交 `C2`。
- 串行前置：`D12-T02`；外部依赖/包变更：`NONE`。
- 新增：`src/rss/local-artifact-store.ts`
- 新增：`src/rss/local-sync.ts`
- 修改：`src/rss/index.ts`
- 修改：`tests/fixtures/rss.ts`
- 新增：`tests/rss/local-artifact-store.test.ts`
- 新增：`tests/rss/local-sync.test.ts`
- 只读：T01/T02 全部 `src/rss/**`、`tests/fixtures/temp-directory.ts`、D11 repository、Node `fs/promises` API。
- 只读且禁止修改：publication、schema、Runtime/Production、package/scripts、README、D13、默认 `data/pis.sqlite`。

### 4.2 本地 Store 契约

1. `createLocalArtifactStore(rootDirectory: string): RssArtifactStore` 由调用方显式给出已 resolve 的输出根。构造不读取数据库，不创建 secret URL；随机路径只作为普通根目录段。
2. Key 校验固定为正斜杠相对 POSIX 路径：非空、无起始 `/`、无反斜杠、无 NUL、无空段、无 `.`/`..`、只允许 `.xml`，且 `path.posix.normalize(key) === key`。禁止 `feed/../`、`archive//`、URL、query/hash、绝对路径和任何非本模块生成形态。
3. 每次 read/list/write 前解析 root realpath，并逐段 `lstat` 防止已有 symlink 或 root 逃逸；最终 `realpath` 必须仍在 root 内。输出根内指向根外的 symlink、最终文件 symlink、前缀目录 symlink均拒绝 `unsafe_path`。
4. `list(prefix)` 只返回 root 内规范相对 key、排序稳定、仅 `.xml`；不存在目录返回空。`read(key)` 只做文件读取，缺文件返回 `null`，不触发 SQLite/Fastify/Runtime/LLM。
5. `write`：在最终目录创建唯一、同目录、`0600` 临时文件；写入全部 UTF-8 bytes 后 `FileHandle.sync()`/关闭；重新读取临时 bytes 并用 XML parser 校验合法 RSS 后再发布到最终名。任何步骤失败删除临时文件，暴露稳定安全错误。
6. 普通 head/pending 写用同目录原子 `rename` 覆盖；pending 是可替换的 RFC 5005 archive document，必须完整原子替换。满 200 条封存 archive 的 `onlyIfAbsent` 禁止“先检查再 rename”的竞态，必须使用同目录独占链接/等价 atomic create，现有最终封存归档绝不覆盖，成功后删除临时 link。成功后尽量 fsync 目录；失败不得留下可见半文件。
7. Store 不跟随 key 中的 symlink、不写输出根外、不复制 DB/`.env`/Prompt/User Context/日志/配置。异常不得回显绝对路径、环境变量、SQL 或正文。

### 4.3 本地同步组合

1. `local-sync.ts` 提供 `createLocalRssSync({reader, outputDirectory, options?})`，内部构造 Local Artifact Store 与 T02 Sync Service；返回 `sync(feed)` 与 `syncAll()`。`syncAll` 顺序执行两 Feed，单个 Feed 失败如实报告且不写数据库；不得并发交错同一 Feed。
2. `sync` 在 `outputDirectory` 下写 `<feedHead>`、`<feed-pending>.xml` 与 `archive/*.xml`；不自行追加任意 secret。调用方可将 output root 设为 `feeds/<随机段>`，模块只处理相对 key。
3. 同步成功后由 Store/Service 返回安全结果；文件 bytes 可用于静态托管，绝不隐式启动 HTTP server、Runtime、Scheduler、Publisher 或生产通知。
4. 真实 Local Store 测试需覆盖正确/错误/缺失路径、secret 目录不被其他模块读取、重复 sync head/pending bytes 稳定、封存 archive 同名同 bytes 复用、同名不同 bytes 保护旧文件、archive/pending 写失败后 head 保留且无临时文件、pending/head 替换原子性，以及 pending 始终是含 `fh:archive` 的合法 archive document。

### 4.4 定向测试

- `RSS-11/24`：持久化 archive 两次 sync 后 URI/bytes/GUID 不变；新 item/迟到/回拨立即反映在当前 pending，旧 archive bytes 不变；预置同名不同 bytes 时旧 archive、旧 pending 与旧 head 原样保留且返回 `archive_conflict`。
- Path matrix：空/绝对/`..`/反斜杠/NUL/重复分隔/非 XML/URL；root 内外符号链接；缺文件 404 等价 `read=null`。
- Atomic matrix：非法 XML/底层写入失败无最终文件、无残留 temp；封存 archive `onlyIfAbsent` 并发/既有文件不覆盖；pending/head 替换后完整可 parse，pending 0 条仍为含 `fh:archive` 的合法 archive document。
- `RSS-12/14` 原语：显式随机 root 可读同一相对 key；错误 key 拒绝；仅规范 archive 相对链接；错误对象不泄漏绝对路径、secret 或环境变量。完整 HTTP Case 留给 T04。
- 定向命令：`npm test -- tests/rss/local-artifact-store.test.ts tests/rss/local-sync.test.ts tests/rss/sync-service.test.ts`
- 全量命令：`npm run verify`

### 4.5 禁止事项与验收出口

- 禁止网络上传、云 Store adapter、`publish()` 版本语义、public RSS 路由、启动自动同步、Runtime 新任务或配置项。
- 禁止使用 `writeFile(final)` 直接写、check-then-rename、覆盖 archive、以 root 字符串前缀冒充 containment。
- 证据需包含 path matrix、symlink 负断言、temp 清理、archive only-if-absent 保护、pending/head atomic replace、pending 0→非 0→0 转换、archive bytes 不变、冲突旧 pending/head 不变、local sync file tree/hash。通过 G4/merge/full verify/归档后进入 T04。
- 逐卡门禁证据：精确 base、path/atomic 矩阵、frozen patch/tree/全部 blob、Architect G4、candidate、merge-tree、merge、merge 后定向+`npm run verify`、Worker/Workspace 归档。

## 5. D12-T04 · 完整文件集集成、静态 smoke、文档与只读验收

### 5.1 Base、依赖与精确写集

- Base：T03 `PASS` 的精确 closeout 文档提交 `C3`。
- 串行前置：`D12-T03`；外部依赖/包变更：`NONE`。项目脚本仅新增 `package.json` 的 `smoke:rss` 并接入现有 `smoke` 链；`package-lock.json` 禁止变化。
- 新增：`scripts/rss-smoke.mjs`
- 新增：`scripts/rss-readonly-acceptance.mjs`
- 新增：`tests/fixtures/rss-database.ts`
- 新增：`tests/rss/local-file-set.test.ts`
- 新增：`tests/rss/static-boundary.test.ts`
- 修改：`package.json`
- 修改：`README.md`
- 只读：T01～T03 `src/rss/**`、D11 repository/contracts、`src/database/open-database.ts`、`src/database/schema.ts`、`src/app.ts`、既有 auth/app 测试、D11A production/DB smoke。
- 只读且禁止修改：`src/database/schema.sql`、`src/publication/**`、`src/runtime/**`、`src/production/**`、`src/app.ts`、D11A smoke 实现、依赖版本、默认 `data/pis.sqlite`、D13/D14/D16。

### 5.2 完整文件集集成

1. `tests/fixtures/rss-database.ts` 只用于临时数据库直接 seed `published_items` 与必要 snapshot 字段；不调用 PublishTask、模板或 LLM，不新增表。正文只使用合成中文/HTML/link/watch sentinel，不读取真实 User Context。
2. `local-file-set.test.ts` 使用真实临时 SQLite + `SqlitePublishedItemRepository` + `createLocalRssSync` + Local Store。至少构造 Event feed 451 条（含 EVENT/EVENT_UPDATE）、Curated feed 451 条，交错 sync；检查两份 head/pending/archive 文件集、`head→pending→archive0002→archive0001` 链、head 无 `fh:archive`、pending/sealed archive 含 `fh:archive`、GUID 去重全集、无跨类，以及 201/400/401/451 边界。
3. 重复两次完整 sync，读取每个 head/pending/archive bytes/hash；archive bytes 不变，head/pending 在相同快照下 bytes 不变。增加迟到项后 pending 必须立即包含该 GUID；余量再次满 200 时旧 archive bytes 不变、pending 原子更新。记录 `database.total_changes`/query trace，证明同步只读、无事务写、无 LLM；默认 `data/pis.sqlite` 在测试前后均不存在或未改变。
4. 文件集只含规定的 `.xml` 与目录；放一个外置 DB/env/prompt/log sentinel，断言输出树中零命中、无绝对输出根泄漏、无异常堆栈和完整 secret URL 日志。
5. 静态 HTTP 测试使用独立临时 HTTP server 将随机 secret 段映射到输出根：正确 key 返回 XML、错误/缺失路径 404、Authorization 头不改变静态路径语义、无 Feed Token。Fastify API 仍只由 Bearer 保护；对 `/feeds/...` 不新增 D12 路由，Bearer 不能替代静态 key。不得断言公开仓库目录不可列举。

### 5.3 Deterministic smoke

1. `scripts/rss-smoke.mjs` 从 `dist/**` 导入编译产物；第一组临时 DB/output seed 201 条 Event 与 201 条 Knowledge，每个 Feed 必须得到 1 个 head、1 个含 1 条的 pending、1 个 0001 archive，总计 6 个 XML；两份链均为 head→pending→archive0001。
2. smoke 另以 200/200 快照验证 pending 0 条 archive document：每 Feed 为 head + 空 pending + 0001 archive。两组均校验临时 DB schema、XML Validator/parser、head/pending/archive GUID 链、head 无 `fh:archive`、pending/封存 archive 含 `fh:archive`、两份 Feed 类型、archive bytes 重复稳定、输出仅 `.xml`、正确静态 key 可读/错误路径 404、DB total changes 不增加、默认库未触碰、结束清理临时目录。
3. `package.json` 新增 `smoke:rss`，并由现有 `smoke` 在 build 后追加调用；`verify` 仍走同一 `smoke`，不得跳过、弱化或引入真实网络/LLM。D11A production/database smoke 保持原样。
4. smoke 只打印安全计数、文件 key/hash 摘要和 PASS；不打印正文、完整 URL、secret、DB 路径绝对值、SQL 或环境。

### 5.4 文档

`README.md` 必须从“D12 未实现”更新为事实状态，并说明：

- 两类本地静态 Feed 的 head/pending/archive 文件名、200/200 主窗口与封存语义；三者 GUID 重叠与 `head→pending→archive…` 静态链遍历。
- head 是普通 RSS document，不含 `<fh:archive/>`；pending 是可重建 0～199 条的 RFC 5005 archive document，包含 `<fh:archive/>`；满 200 条封存 archive 也包含 `<fh:archive/>`。pending 不是满 200 条不可变封存批次、业务队列或 Outbox；pending 可原子替换，满 200 条封存 archive 只创建/校验、不重写，同名封存冲突停止该 Feed pending/head 更新。
- `createLocalRssSync` 的显式调用/部署文件集边界；D12 不启动自动通知、不选择/上传云端、不提供 HTTP Feed GET 或 Feed Token。
- 静态 URL secret 不是访问控制；公开产物不含 DB、env、Prompt、User Context、Token；D13 才处理 Gitee/Pages、上传顺序、重试与缓存。
- D12 P0 通过不等于 RSS-15/16 阅读器/中国大陆网络验证，也不等于 D13/D16。

### 5.5 真实 D11A 临时库只读验收边界

1. `scripts/rss-readonly-acceptance.mjs` 是人工/Lead/Architect 验收工具，不加入必跑 CI 的真实数据链。它接收 `--database <path>`，使用 `better-sqlite3` `readonly:true,fileMustExist:true` 和 `PRAGMA query_only=ON` 打开，输出根只允许独立临时目录。
2. 工具运行前/后分别记录 DB 主文件及现存 `-wal`/`-shm` 旁路文件的路径集合与 SHA-256；生成两 Feed 后再次核对，任一文件集合或 bytes 变化即失败。不得 MODIFY/WAL checkpoint、不得打开默认 `data/pis.sqlite`、不得复制原 DB 到发布目录。
3. 当前 D11A 人工证据库为 `/private/tmp/pis-d11a-real-e2e/pis.sqlite`（及其现存 sidecars）；若文件不存在，T04 的 deterministic 自动测试仍可 PASS，但 D12 最终真实只读验收必须标 `BLOCKED`，不得用合成库替代。
4. 只记录 Feed 条数、head/pending/archive key 与 hash、pending GUID 数、DB pre/post hash、XML parse 与静态读取结果；不记录正文、完整来源 URL、secret、Prompt、User Context、模型输入。输出临时目录在取证后清理。
5. Worker 只交付脚本和合成测试；真实只读证据在 T04 frozen candidate/G4 后由 Lead/Architect 执行，写入进度摘要。若脚本或只读不足导致失败，回到 T04 写集修复；若生产 RSS 逻辑错误，回到对应 T01～T03 卡写集，不得在本卡修核心算法。

### 5.6 定向与全量验证

- `RSS-12`：随机相对 root 正确读取；错误/缺失路径 404；不存在 Feed Token；不宣称目录保密。
- `RSS-13`：静态正确 key 无 Bearer 可读；Bearer 不带正确 key 仍 404；错误/缺失 API Bearer 仍 401，RSS 与 JSON API 权限不互相替代。
- `RSS-14`：恶意 pending/archive href、转义字符、路径穿越、异常 sentinel 不能改变链或逃逸输出根；输出无 SQL/堆栈/env。
- `RSS-18`：相同快照重复显式 sync 后 head/pending 全部 GUID/正文/时间稳定、archive bytes 不变、静态读取不触发 DB/analysis。
- 定向命令：`npm test -- tests/rss/local-file-set.test.ts tests/rss/static-boundary.test.ts tests/rss/local-artifact-store.test.ts tests/rss/local-sync.test.ts`
- smoke 命令：`npm run build && npm run smoke:rss`
- 全量命令：`npm run verify`
- 证据附加：`git diff --check`、`package-lock.json` diff=0、默认 DB sentinel、D11A 只读 pre/post hash 与安全摘要。

### 5.7 禁止事项与验收出口

- 禁止修改上游 RSS 公共契约/算法以“让集成过”；禁止 D13 云平台选择、上传/重试/启动通知、D14 路由、D16 模型评估；禁止依赖真实网络/LLM 或默认数据库。
- 禁止把本地 200/200、静态 404 或 Stub 结果写成 `RSS-15/16`、`RSS-19～23` 云端通过。
- 完成冻结/G4/candidate/merge-tree/merge/full verify/Worker 与 Workspace 归档、D11A 临时库只读摘要后才可进入 D12 Final Gate。
- 逐卡门禁证据：精确 base、frozen patch/tree/全部 blob、Architect G4、candidate、merge-tree、merge、merge 后定向+`npm run verify`、`package-lock.json` diff=0、Worker/Workspace 归档，以及 Lead/Architect 真实 D11A 临时库只读摘要。

## 6. D12 Final Gate、收尾与用户验收

1. 四卡 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` 后，Lead 更新 progress，确认没有未交付 Worker 工作树、candidate 或唯一文件；不自行签发最终 PASS。
2. Architect 在全新 clean snapshot 对最终 code SHA 重跑 `npm run verify`、本地 RSS 完整文件集 smoke 和 D11A 临时库只读验收；不接受只引用 Lead 数字。
3. Architect 按既有持续授权 push 已批准 main SHA，核验远程 SHA 与精确 SHA 的 GitHub CI Success；本地结果不能替代远程证据。
4. Architect 删除 D12 开发心跳并核验成功，归档全部 D12 Worker/Workspace；Lead 在 progress 记录心跳删除、归档 ID、目录移除、最终 SHA/tree/CI/只读验收摘要。
5. 交负责人审核，不自动进入 D13；任务卡开发期间不得由 Lead/Worker 创建/删除心跳，不创建 `create_schedule`，不夹带 D13/云端或新 Runtime 架构。

### 6.1 G3 复核点

- Plan 是否完整映射原 D12-T01～T04 与 Spec Case，同时保持 T02 算法、T03 文件语义、T04 集成边界不交叉。
- pending 是否被限定为每 Feed 根级 `<feed>-pending.xml`、始终渲染当前 0～199 条余量、包含 `<fh:archive/>`、可原子替换、但不是满 200 条不可变封存批次/队列/Outbox；head 不含 `fh:archive`，封存 archive 含；规划、RSS-08/09/17 覆盖、T03 文件写序与 T04 文件集是否一致。
- 是否接受 D11A 临时库只读验收为 T04 frozen/G4 后的人工证据，而不将真实库、正文/URL 或输出文件集加入 Git/CI。
