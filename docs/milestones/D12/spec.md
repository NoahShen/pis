# D12 Spec：本地静态 RSS 生成与归档

- 状态：`APPROVED · G2 · Architect`
- 日期：2026-11-21
- 基线：main `3671d47`
- 上游：D12 Intent（G1）；技术设计 §4/§14.3；测试用例设计 `RSS-01`～`RSS-14`、`RSS-17/18/24`

## 1. 模块边界与公共契约

新增独立 `src/rss/`，只依赖 D11 的 Published Item 只读数据及 Node/既有 XML 依赖，不反向修改 publication 业务逻辑。

建议公共类型（精确命名由 Plan 固定）：

- `RssFeedKind = "EVENT_UPDATES" | "CURATED_CONTENT"`；分别映射 `EVENT + EVENT_UPDATE`、`KNOWLEDGE`。
- `RssPublishedItem` 复用/兼容 `PublishedItem` 七列；读取按 `(published_at DESC,id DESC)`。
- `RssArtifact { key, bytes }`；key 是输出根目录内的相对 POSIX 路径，XML bytes 为 UTF-8。
- `RssArtifactStore`：`list(prefix)`、`read(key)`、`write(key,bytes,{onlyIfAbsent?})`；D12 本地实现直接落盘，Fake 实现用于故障/静态 GET 测试。不增加 `publish()` 云端版本语义。
- `RssSyncResult`：主文件、pending 文件、已验证既有归档、新归档、冲突/写入结果等安全元数据；错误不包含正文、完整订阅 URL、secret 或环境变量。
- `RssSyncService.sync(feed)`：读取数据库与现存归档，验证/创建完整归档，最后更新主文件。D12 提供显式调用，不在本里程碑接生产启动/通知。

## 2. RSS XML 契约

1. 输出 RSS 2.0 XML，声明 `content`、`atom`、`fh` 命名空间；UTF-8，固定格式，无当前时钟等不确定字段。
2. channel：
   - Event Updates：`title = PIS Event Updates`，文件名 `event-updates.xml`。
   - Curated Content：`title = PIS Curated Content`，文件名 `curated-content.xml`。
   - `description` 固定；`link`/archive URI 使用显式提供的规范相对引用或部署 base，不伪造来源 URL。
3. item：
   - `<title>`、`<description>` 分别来自 `title`、`summary`，作为 XML text 转义。
   - `<content:encoded>` 来自不可变 `body`，使用合法 CDATA 或等价安全编码；必须保留安全 HTML，不发生二次 HTML 转义/反转义。正文含 `]]>` 时拆分 CDATA。
   - `<guid isPermaLink="false">pis:published:&lt;id&gt;</guid>`；同一 ID 在主/归档一致。
   - `<pubDate>` 将合法 `+08:00` ISO 时点转为 RFC 822 GMT 表示，保持同一 instant；非法时间安全失败，不用当前时间替代。
   - `<link>` 仅从 body 快照“来源”区域的首个 `<a href="...">` 读取并解析 HTML entities，再按 D11 等价规则校验 HTTP(S)、无 userinfo/控制字符；无合法链接则省略，不重新查询 Source/Content。
   - 可选 `<category>` 本期不加入，避免依赖后续 Topic 变化造成主文件不稳定；不改变既有业务关联。
4. XML 中的文本/属性禁止非法 XML 字符；不得直接拼接恶意 key、环境变量或异常正文。使用既有 `fast-xml-parser` 验证输出和解析归档，新增依赖为 `NONE`。

## 3. 主 Feed 与归档算法

- 默认常量：主窗口 `200`，归档批次 `200`；可通过内部 options 注入较小正整数用于单元测试，生产默认不可由 RSS 内容控制。
- 主文件：当前数据库该 Feed 全量按 `(published_at DESC,id DESC)` 取前 200。相同时间以 ID 决定顺序。
- 归档发现：列举该 Feed `archive/<feed>-NNNN.xml`，解析 XML、验证 RSS 类型、GUID、序号及链。重复 GUID、非法序号/空洞、伪造/错误类型均安全失败。
- 归档命名：序号从 `0001` 连续增长，每个文件恰好 200 个唯一 GUID；归档内按该批次的 `(published_at ASC,id ASC)` 固定，文件名不依赖时间或秘密。
- 未封存集合：数据库当前 Published Item 排除所有既有归档 GUID；若归档引用数据库已不存在的 GUID，归档仍作为历史保留并报告安全边界，不要求删除或重写。
- 新批次：未封存集合按 `(published_at ASC,id ASC)` 排序，只在达到 200 时追加下一个序号；剩余不足 200 条写入可重建 pending 文件，不提前封存。迟到旧时间条目进入后续批次或当前 pending，不重切旧批。
- pending 文件固定 `<feed>-pending.xml`，包含全部未封存余量（0～199 条），按 `(published_at ASC,id ASC)` 稳定排序。它可随数据库快照变化而重建，不是不可变归档、业务队列或 Outbox；不得用 `pendingUnsealedCount` 代替实际可达条目。
- 主文件、pending 与所有封存归档按 GUID 去重覆盖数据库当前全集；主文件与 pending/归档允许重叠，封存归档彼此不重叠。归档还可保留数据库已不存在的历史。
- RFC 5005：主文件 `prev-archive` 指向 pending；pending 指向最新封存归档；每个封存归档指向上一封存归档；首归档不指向不存在文件。无 pending 时主文件直接指向最新封存归档。链接均为受控相对 URI，不含 query cursor。
- 写入顺序固定为新封存归档 → pending → 主文件。pending 可替换但必须完整原子更新；任何前序失败不得更新主文件。

## 4. 冲突与恢复

- 计算出的新归档 key 已存在：
  - bytes 完全相等：视为已封存，复用；
  - bytes 不同：返回稳定 `archive_conflict`，保留旧归档和旧主文件，不继续写该 Feed 主文件。
- 既有归档损坏、链不一致、GUID 重复或越界：安全失败，不尝试“修复”旧归档。
- 某 Feed 冲突/失败不得改数据库，也不得让另一类 Feed 被反向覆盖；批量同步可分别报告结果。
- 写新归档后、主文件失败：保留完整新归档和旧主文件；下次同步可复用归档并完成主文件。不得留下半写 XML。
- 缺主文件可重建；缺归档文件时只从仍存归档恢复边界，若序号空洞则冲突并停止，避免静默重切历史。

## 5. 本地 Artifact Store 与安全

- 输出根目录由调用方显式指定；测试使用临时目录。secret 路径段只作为普通相对路径，不生成/保存真实云端 URL。
- key 必须为非空相对 POSIX 路径，拒绝绝对路径、`..`、反斜杠逃逸、NUL、重复分隔和输出根外符号链接逃逸；只允许本模块生成的 `.xml` 文件。
- 写入流程：在目标同目录创建唯一临时文件 → 写完全部 UTF-8 bytes → `fsync`/close → 对最终 XML 再校验 → 原子 rename；失败清理临时文件。`onlyIfAbsent` 使用独占创建/等价保护，不能覆盖既有文件。
- 主文件可替换，归档只创建或只读校验。目录列举与静态读取不打开 SQLite。
- 不复制数据库、`.env`、Prompt、User Context、日志或配置到输出目录；测试以 sentinel 负断言证明。

## 6. 测试与 Case 映射

| Case | 自动化要求 |
|---|---|
| RSS-01/02 | 三类 Item 正确分入两类 Feed，Event/Update 均出现，Knowledge 不串档 |
| RSS-03/04 | 中文、XML 字符、HTML/CDATA、GUID、重复生成 bytes；Fake 静态 GET 不查 DB/LLM |
| RSS-05 | `+08:00` 到 RFC 822 同一 instant；与来源发布时间无关 |
| RSS-06/07 | 无来源省略 link；正文快照首链接稳定，后续证据不改变 |
| RSS-08/09/17 | 201/400/401/451 条、多批、两类交错；主文件/pending/静态归档链覆盖、去重、无跨类 |
| RSS-10 | 相同时间稳定排序；同 GUID 主/归档内容一致 |
| RSS-11/24 | 新 Item、迟到、回拨、重复同步归档 bytes/URI 不变；同名冲突保护旧归档和主文件 |
| RSS-12/13 | 正确/错误/缺失本地路径；静态 key 不授予 API，API Bearer 不替代路径；无 Feed Token |
| RSS-14 | P1 安全：恶意链接/路径穿越/异常字符串不能逃逸或泄漏 |
| RSS-18 | 重复启动式显式同步，主/归档稳定，静态 GET 不触发 SQLite/分析 |

`RSS-15/16` 属于 D13 云端和阅读器人工验证；`RSS-19`～`RSS-23` 的生产/云端同步不在 D12 宣称通过。本地写入失败覆盖 RSS-20/22 的“数据库不回滚、先归档后主文件、无半写 XML”子集，不冒充云端验收。

## 7. Gate

- 四卡 T01～T04 严格串行，固定 base/写集、frozen patch/tree/blob、G4、candidate/merge、merge 后 full verify 和归档。
- 全量 `npm run verify`、定向 RSS 测试、真实 XML parse/静态文件 smoke 均通过。
- 用 D11A 临时真实数据库只读重建两类文件，记录数量与 hash 稳定性，不记录正文、完整来源 URL 或秘密。
- 最终独立干净快照 Gate，push main，最终精确代码 SHA 的 GitHub CI Success；删除心跳、归档 Lead/Worker，通知负责人验收。
