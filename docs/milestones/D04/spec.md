# D04 Spec · 通用 SourceAdapter 与 RSS 首个实现

> 版本：v0.1
> 状态：APPROVED · Architect G2 通过（2026-11-16）
> Intent 基线：`3d130ce`，负责人已批准全文/摘要判定及财经 API Adapter 延期边界。
> 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`（D03 最终 PASS）。
> 本文批准技术契约；不构成 Plan 审批或 Worker 执行授权。

## 1. 依据、目标与边界

依据 [Intent](intent.md)、[技术设计](../../PIS_技术实现设计_v1.0.md) §2.3/2.4、§10.1/10.2、[实施计划](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) D04，以及 [测试设计](../../PIS_V1_测试用例设计_v0.2.md) COL-01/03/06/08/09/10/15/16 的组件部分。

D04 实现可独立调用的 Adapter 组件，不注册新的 HTTP 管理接口，不修改数据库或已有 Source 配置契约，不启动采集、调度或下游分析。D05 Collection 依赖 SourceAdapter；只有识别为新条目时才调用 fetchContent。D06 Processing 消费序列化结果，不再抓取网页。

RSS 是首个实现。财经资讯网站 API 待全流程走通后按实际协议另立里程碑，不提前实现对应类型、认证、分页或 SDK。通用输出不包含 RSS XML 节点、DOM、Response、Buffer、Date、函数或数据库连接；不得引入插件发现系统或动态执行第三方 Adapter。

## 2. 通用接口与可序列化数据

以下为冻结的语义及字段；模块路径由 Lead Plan 决定。字符串枚举可用字面量联合类型实现。

```ts
interface AdapterSource {
  id: string;
  type: string;
  url: string;
}
interface AdapterCallOptions { signal?: AbortSignal }
interface SourceAdapter {
  fetchEntries(source: AdapterSource, lastCollectedAt: string | null,
    options?: AdapterCallOptions): Promise<SourceEntry[]>;
  fetchContent(entry: SourceEntry,
    options?: AdapterCallOptions): Promise<SourceContent>;
}
interface SourceEntry {
  source_id: string;
  external_id: string | null;
  url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null;
  full_body: SourceText | null;
  summary: SourceText | null;
}
interface SourceText {
  value: string;
  format: "TEXT" | "HTML";
}
interface SourceContent {
  schema_version: 1;
  entry: SourceEntry;
  body: string | null; // 可用纯文本；不是未经处理的 HTML
  summary: string | null; // 来源摘要的纯文本，不生成新摘要
  content_kind: "FULL_BODY" | "SUMMARY" | "FRAGMENT" | "NONE";
  acquired_via: "SOURCE_FULL_FIELD" | "ARTICLE_EXTRACT" | "SOURCE_FALLBACK" | "NONE";
  completeness_basis: "SOURCE_DECLARED" | "ARTICLE_EXTRACTED" | "PARTIAL_ONLY" | "NO_CONTENT";
  article: {
    status: "NOT_REQUESTED" | "SUCCESS" | "FAILED" | "BLOCKED";
    reason: AdapterReason | null;
    final_url: string | null;
  };
}
```

约束：

- 现有配置 Source 可结构化赋给 AdapterSource；现有 Source.type 仍只有 RSS。RSS 实现遇到非 RSS type 拒绝 `unsupported_source`；未来实现可接受自身类型，不要求通用接口枚举所有网站。
- `source_id` 必须非空。`external_id` 是不透明来源标识，trim 后非空；不改变大小写、不从内容计算 Hash、不用 URL 伪造 GUID。
- `url` 为标准化的绝对 HTTP(S) 地址或 null；无 external_id 且无有效 url 的 entry 跳过。无日期但有 URL 仍有效，供 D05 按 URL + null 尽力去重。
- `published_at` 为带时区输入解析后通过既有 formatTimestamp 输出的 `+08:00` 时间，缺失/非法/无明确时区则 null。RSS 接受 RFC 822/1123 的明确偏移、GMT/UTC；Atom 接受带 Z 或数值偏移的 RFC 3339。不用当前时刻填充发布时间，不依赖机器 TZ。保留有效 source_id、GUID 的无日期条目。
- 空白字段统一 null；正文 HTML 的有效性以清洗后可见文字判断，不以标签非空判断。纯图片来源无可见文字本阶段按无正文处理，图片理解不在范围。
- 返回新对象，不修改调用方 entry/source；调用前同步快照输入可变数据，避免 await 后由外部修改影响同一次结果。signal 仅用于控制，不进入 JSON。
- SourceContent 必须通过共享运行时 schema 校验，输出可稳定 JSON round-trip，无 undefined、NaN、循环引用。schema 可供后续 Processing 复用；D04 不写 raw_data，D05 直接序列化此 envelope。
- 不提供通用 `raw: unknown` 储存任意响应；entry 中保留必要来源元数据和已有内容。原始 XML/网页及响应头不进入结果，避免无界载荷和凭据泄漏。
- RSS lastCollectedAt 接口保留但不筛掉旧发布时间条目；保持 feed 顺序，不做数据库去重、不合并同 GUID 条目、不改变来源身份。

## 3. RSS 与 Atom 列表解析

### 3.1 支持范围

支持 RSS 2.0 `rss/channel/item` 和 Atom 1.0 `feed/entry`。RSS 1.0/RDF、JSON Feed、分页抓取和 OPML 不在本阶段；根格式不匹配返回 `unsupported_feed`。合法空 feed 返回空数组，非法 XML 或缺失必要容器返回 `invalid_feed`。

正确处理 namespace URI（而非只认任意前缀）、CDATA、预定义 XML 实体和数值实体；禁止 DTD、实体声明及外部实体解析，不访问 XML 中引用的资源。未知 namespace 扩展忽略，嵌套结构及字符串类型不得被解析器强制转为数字/布尔值。

列表响应完整验证后返回数组，不返回解析到一半的结果。解析失败/列表响应超限必须抛错，避免 D05 将不完整列表视为成功推进检查点。个别条目缺少可用身份可跳过，计数以固定原因汇总，不记录原文。

### 3.2 映射规则

| 字段 | RSS 2.0 | Atom 1.0 |
|---|---|---|
| external_id | guid 的文本，不受 isPermaLink 改变 | id 的文本 |
| url | link；缺失时仅当 guid 明确 isPermaLink=true 或省略且为合法 HTTP(S) URL，才作链接后备 | 首个 rel=alternate 或未给 rel、type 缺失或 HTML/XHTML 的 link.href |
| title | title | title |
| author | author，缺失用 dc:creator | entry author.name，缺失用 feed author.name |
| published_at | pubDate，缺失用 dc:date | published；仅在缺失时用 updated |
| full_body | content:encoded | inline content，type 为 text/html/xhtml 或省略（text） |
| summary | description，缺失用 media:description | summary，按 type text/html/xhtml |

同字段出现多个值使用文档顺序的首个非空可支持值；日期值存在但非法时返回 null，不悄悄改用另一个时间。RSS content namespace 固定为 `http://purl.org/rss/1.0/modules/content/`；Atom 使用标准 namespace。Atom `content src` 不自动抓取；仍可按文章 link 获取正文，二进制/未知 MIME content 不视为全文。

相对 URL 按当前节点继承的 xml:base、最终 feed URL 解析；只接受 §6 URL 规则。单个非法文章链接变 null；有 GUID 的条目仍保留。来源最终 URL 作为解析 base，不写回 Source.url。title/author 解码实体并输出纯文本；HTML/XHTML 内容保留为 SourceText，由统一清洗流程处理。

## 4. 全文、摘要与原文提取

### 4.1 判定含义

FULL_BODY 是**按本契约取得的完整正文证据**，不是对出版社真实全文的证明。来源可能在全文字段中放摘要，网页提取也可能遗漏隐藏段落；本阶段没有通用算法能保证识别这些情况。保留 completeness_basis，避免后续把“来源声明”和“网页提取”混为事实保证；不使用 LLM 二次判全文。

明确 RSS content:encoded/Atom inline content 经过清洗后非空，即 `SOURCE_DECLARED`；description/summary 无论多长都不能单凭长度升级。与负责人批准的规则一致，不猜测来源在全文字段中的语义真实性。

### 4.2 fetchContent 决策表

| 条件 | body / content_kind | acquired_via / completeness_basis | 原文状态 |
|---|---|---|---|
| full_body 清洗后非空 | 全文字段文字 / FULL_BODY | SOURCE_FULL_FIELD / SOURCE_DECLARED | NOT_REQUESTED，reason=null |
| 无可用全文，URL 可获取，提取接受 | 提取文字 / FULL_BODY | ARTICLE_EXTRACT / ARTICLE_EXTRACTED | SUCCESS |
| 提取到受限文章片段 | 来源摘要非空优先用摘要，否则用该片段 / SUMMARY 或 FRAGMENT | SOURCE_FALLBACK 或 ARTICLE_EXTRACT / PARTIAL_ONLY | FAILED，restricted_content |
| 无可用全文，请求失败/受阻/提取拒绝，有来源摘要 | 摘要 / SUMMARY | SOURCE_FALLBACK / PARTIAL_ONLY | FAILED/BLOCKED |
| 同上且无任何可用内容 | null / NONE | NONE / NO_CONTENT | FAILED/BLOCKED |
| 无全文且 url=null | 摘要或 null / SUMMARY 或 NONE | SOURCE_FALLBACK 或 NONE | NOT_REQUESTED，no_article_url |

`summary` 始终只保存来源 summary 清洗结果，即使采用网页正文也不替换成自动摘要。body 选择一种内容，不将摘要和正文盲目拼接、不按谁更长选择。全文优先路径不做 DNS、不创建文章连接，article.final_url=null。实际收到响应时记录最后经过验证的 URL；未建立响应则为 null。URL 保留在结果，不记入日志。

调用方 AbortSignal 取消时整个方法抛 `aborted`，不伪装为正常摘要回退。内部文章超时可回退摘要；feed 超时抛错。所有网络请求均在事务之外；本组件不持有数据库连接。

### 4.3 HTML 清洗与网页提取接受规则

- DOM 仅解析，不执行脚本、不加载图片/样式/iframe/外链、不跟随 meta refresh 或 canonical 链接。移除 script/style/template/noscript、隐藏元素（hidden 或 aria-hidden=true）以及导航/页眉/页脚/表单等非正文区域；不执行 CSS、不模拟浏览器布局。
- 正文使用 Mozilla Readability 的 parse 结果，输入 DOM 文档的 URL 是安全验证过的最终文章 URL，charThreshold 显式设置为 articleMinTextChars，避免库默认阈值与部署配置冲突。只使用提取正文的可见文字；保持段落换行，解码实体，规范连续空白，不生成句子。不把整个 body.textContent 作为提取失败的替代正文。
- parse 返回 null、清洗后空、或低于 `articleMinTextChars`：`extraction_failed`。字符阈值只用于排除无法可靠定位的网页噪声，不用于证明全文，也不适用于来源明确全文或来源摘要。
- 结构化限制信号：HTML 中合法 JSON-LD 对象或 @graph 项声明 `isAccessibleForFree=false`，或 DOM 存在 `[itemprop="isAccessibleForFree"][content="false"]`，视为 restricted_content。不执行 JSON-LD、不跟随 URL；无效 JSON-LD 忽略。若 Readability 有可用非空片段，可按决策表保留为 FRAGMENT；否则回退摘要/无内容。不能把任意“订阅/阅读全文”文字出现一次当作全站付费墙规则。
- 不访问 next-page、不自动展开、不过登录/验证码/付费墙，不抓 iframe。未声明的截断、分页或动态正文可能无法识别，这是已知局限；具体站点规则未来在对应 Adapter 中引入。
- 后续 Processing 的冻结消费约定：FULL_BODY 且 body 非空 → FULL；SUMMARY/FRAGMENT 且 body 非空 → PARTIAL；NONE → 正常空结果。D04 只生产证据及 schema，D06 实现落库与上述映射。网页获取状态 SUCCESS 本身不能独立升级完整性。

## 5. 失败、取消与错误边界

AdapterReason 采用固定值：`unsupported_source`、`invalid_source`、`unsupported_feed`、`invalid_feed`、`blocked_url`、`dns_failed`、`network_error`、`timeout`、`aborted`、`http_status`、`redirect_limit`、`invalid_redirect`、`unsupported_mime`、`unsupported_encoding`、`response_too_large`、`feed_too_many_entries`、`extraction_failed`、`restricted_content`、`no_article_url`。

- feed 失败拒绝 Promise，使用安全 AdapterError 携带 reason；文章的预期获取失败返回对应降级结果。安全策略阻止地址为 BLOCKED；HTTP 401/403/404/429/5xx 均为 FAILED/http_status，不重试。
- 错误消息固定，不包含 URL、IP、响应体、Token、任意底层异常 message。内部编程错误或结果 schema 失败不能被 blanket catch 当成摘要成功；只能捕获已知获取/解析错误。
- 每个逻辑请求（feed 或一篇文章）只有一次预算，可含有限重定向；不自动重试，无 Runtime attempt 逻辑。下游是否重试由未来 Runtime 决定。
- 预先 aborted 不发请求；监听移除、timer 清理、reader.cancel、dispatcher/连接销毁必须在成功、失败、超限、取消路径执行。取消/清理本身不可无限等待；对晚到 Promise rejection 显式消费，不二次结算。
- RSS XML 与 DOM 为同步解析，响应字节和节点/条目限额限制输入规模；网络 timeout 不声称能够抢占同步 JavaScript。若依赖在限定输入上出现不可接受的长时间 CPU 消耗，阻塞验收并修订设计，不用增加 timeout 掩盖。

## 6. HTTP 与网络访问边界

### 6.1 共享安全传输

feed 和 article 共用一个受限 HTTP 客户端，采用 Node 原生 fetch；用显式 undici Dispatcher 为该请求注入连接控制，不更改全局 dispatcher。不能只在请求前 DNS 校验一次，然后让原生连接再次自由解析。

流程：解析 URL → 校验 scheme/凭据/主机 → 有限预算内解析全部 A/AAAA → 校验全部地址 → 为本 hop 创建固定已校验地址的连接 lookup → 保持原域名的 Host/SNI/证书校验 → fetch manual redirect → 校验响应与流读取 → 清理。本 hop 不接受代理环境变量接管或其他隐式代理；不关闭 TLS 验证。优先选择解析结果中第一个允许地址，不在失败时自动重试其他地址。

只允许 http/https；禁用 userinfo、fragment、控制字符；端口只允许协议默认端口（http 80、https 443）。URL canonicalization 后再检验 IP，覆盖十进制/十六进制/缩写 IPv4 与 IPv4-mapped IPv6。地址为空、DNS 任一返回非公开地址或返回过多地址（上限 32），整次阻止，不挑安全 IP 掩盖混合结果。

拒绝 loopback、私网、link-local、unspecified、multicast、广播、CGNAT、benchmark、documentation、reserved 与非全球单播地址。使用 ipaddr.js 分类（IPv4 必须 unicast 且不在 IANA 特殊用途网段；IPv6 必须全球单播且不在特殊用途网段）。至少显式覆盖 IPv4 `0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.0.0/24,192.0.2/24,192.168/16,198.18/15,198.51.100/24,203.0.113/24,224/4,240/4` 及 ipaddr 的其他特殊分类；IPv6 限 `2000::/3`，另排除 `2001::/23,2001:db8::/32,2002::/16,3fff::/20`，mapped 地址按其 IPv4 规则检查。localhost 及 `.localhost` 名称直接拒绝。对未覆盖但分类为特殊用途的地址默认拒绝；禁止自行用一个“非 RFC1918 即安全”的简化判断。

DNS 结果必须被实际 socket 使用，阻止 rebinding。TLS 仍以原 hostname 验证，不能改 URL 为 IP 并跳过证书。DNS 未完成或连接晚到时也不得在取消后发起额外请求。

### 6.2 重定向与响应

只跟随 301/302/303/307/308，最多 maxRedirects 次，统一 GET；Location 缺失/非法拒绝，按当前 URL 解析相对跳转，每个 hop 重新执行完整网络校验。HTTPS 降级 HTTP 拒绝，HTTP 升 HTTPS 允许；循环以次数限制终止。任何 2xx 之外非重定向状态拒绝；206 Partial Content 以及携带 Content-Range 的响应也拒绝为 http_status，禁止把服务器明确返回的局部内容当成完整响应；204/205 无 body 对 feed 属 invalid_feed，对文章属于 extraction_failed。

不发送 Cookie、Authorization 或 API Token，不转发响应 Cookie，不提供用户任意 header 注入。请求 Accept 与固定 User-Agent 可按 feed/article 设置，禁止透传 Source 描述等输入。财经 API 的认证由未来专门设计。

feed MIME：`application/rss+xml`、`application/atom+xml`、`application/xml`、`text/xml`；article MIME：`text/html`、`application/xhtml+xml`。忽略大小写与参数，缺失或不匹配拒绝；不按正文猜测绕过 MIME。字符编码仅支持 UTF-8（含 BOM）、US-ASCII；charset 或 XML encoding 显式为其他编码时返回 unsupported_encoding。无声明按 UTF-8，采用 fatal 解码；本阶段不做 GBK 自动猜测。

读取流逐块计数；Content-Length 是提前拒绝依据但不能代替计数。限制 fetch 暴露的解压后字节，压缩膨胀也受限；响应超限立即终止，不把截断的 feed/HTML 当成功。每 hop 也遵守限额，总请求时间预算不因 redirect 重置；重定向 body 不读取，立即取消。响应头预算固定 16 KiB（dispatcher maxHeaderSize），过大按 network_error 安全终止。

### 6.3 部署参数

通过 `createRssAdapter({ httpPolicy?, signal/transport dependencies... })` 的类型化工厂选项传入；准确构造参数形状由 Plan 转为代码，以下语义不变。D04 不接入 server 环境变量或现有 config.ts；README 登记参数，未来 Composition Root 可传配置。初始化严格验证整数范围，无 NaN/Infinity/字符串 coercion。

| 参数 | 默认值 | 可配置范围 / 作用 |
|---|---|---|
| requestTimeoutMs | 15000 | 100～120000；每逻辑请求含 DNS、所有 hop 与 body 的总预算 |
| maxRedirects | 3 | 0～5 |
| feedMaxBytes | 2097152 | 1024～8388608；解压后字节 |
| articleMaxBytes | 5242880 | 1024～16777216；解压后字节 |
| maxFeedEntries | 1000 | 1～10000；超限整批失败，不能静默截断 |
| articleMinTextChars | 80 | 1～1000；仅网页提取质量下限，按 Unicode code point 计数 |

生产不提供 allowPrivate、关闭证书校验或任意端口开关。测试以显式依赖注入连接/解析器，将合成公共域名连接到受控本地 Fixture；该测试辅助实现仅在 tests 中，不接受环境变量启用。至少测试实际生产安全客户端的 URL/DNS/redirect/byte-budget 流程，不允许整个 HTTP 层全用 Stub 冒充 SSRF 验证。工厂与 transport 的所有权在 Plan 固定：由工厂创建的资源由组件关闭，注入资源归调用方；不能保留不可关闭的全局连接池。

## 7. 依赖与实现限制

精确版本选定如下（编写 Spec 时通过 npm registry 只读核对，尚未安装或修改锁文件）：

| 依赖 | 版本 | 必要用途 |
|---|---|---|
| fast-xml-parser | 5.12.1 | 有界 RSS/Atom XML 解析与校验；禁用 DTD/实体声明 |
| @mozilla/readability | 0.6.0 | 网页主正文提取 |
| linkedom | 0.18.15 | 无脚本执行、无资源加载的 DOM 构建 |
| undici | 8.12.4 | 原生 fetch 的可控 dispatcher、连接/DNS 固定与 header 限制 |
| ipaddr.js | 2.5.0 | IPv4/IPv6 解析及特殊网段分类 |

沿用 Node 26.13.1/npm 11.20.0、TypeScript strict/NodeNext、Zod；不替换原生 fetch、不引入 browser/axios/ORM。依赖精确 pin；仅在相关任务更新 package.json/package-lock.json。Lead Plan 必须把 Readability+linkedom 的运行和类型互操作、native fetch+dispatcher 固定 DNS 的验证列为验收项；若失败不得静默换库或关闭保护，由 Architect 审核最小替代方案。依赖元数据不是兼容性通过证据。

不允许通过宽泛 any 或不受约束的类型断言掩盖类型不兼容；仅允许在原生 RequestInit 与 undici 扩展参数的窄适配边界描述 dispatcher 扩展类型。

## 8. 可测试验收矩阵

| 验收组 | 必须可观察的结果 | 权威映射 |
|---|---|---|
| 列表与身份 | RSS/Atom、namespace 别名、CDATA、实体、缺字段、相对链接、合法空列表；GUID 原样；URL+null 日期可用；缺双身份跳过 | COL-01/03 组件部分 |
| 时间与增量 | 新 GUID 即使发布时间早于检查点仍返回；不同 TZ 输出一致；无偏移日期不猜测 | COL-06 |
| 来源全文 | 全文清洗非空直接返回；short 全文可用；DNS/文章 HTTP 计数为 0；long HTML description 仍走抓取 | COL-08 |
| 网页正文 | 有效 Fixture 提取段落、去掉导航脚本；来源摘要保留；结果为 ARTICLE_EXTRACTED；无副资源请求 | COL-09 组件部分 |
| 降级与空内容 | 404/timeout/MIME/字节超限/提取失败分别回退；无摘要仍可返回有效身份+NONE；另一条目正常 | COL-10/16 组件部分 |
| 受限文章 | 两种结构化付费声明不能生成 FULL_BODY；有摘要优先回退，无摘要可保留实际片段 | 完整性专项 |
| 网络地址 | loopback/私网/IPv6/mapped/特殊 IP/混合 DNS/重绑定/重定向到内部地址均拒绝；连接使用已校验 IP | COL-15 + D04 安全门槛 |
| 限额与终止 | 精确字节边界、错误 Content-Length、压缩膨胀、无限流、DNS 悬挂、慢 redirect 共用预算、取消与晚拒绝 | COL-15 + D04 安全门槛 |
| 解析边界 | malformed XML/DTD/过多条目/未知 feed 拒绝；缺 MIME/非 UTF-8/非法 UTF-8 明确失败 | 解析专项 |
| 通用性与纯度 | 仅通用接口消费者可接收合成非 RSS Adapter 结果；不增加生产 Source.type；JSON round-trip；不修改输入；0 DB/LLM/派发 | Intent 通用接口边界 |
| 资源与隐私 | 无遗留监听/timer/socket/dispatcher；错误日志不含完整 URL、正文、凭据；测试不请求真实互联网 | 安全与生命周期 |

COL-15 在总测试文档标 P1，但其涉及的网络防护属于本 Spec D04 必须通过的交付条件，不能以优先级为由跳过。COL-01/09/16 的持久化、检查点和下游派发断言不在 D04；明确记录部分覆盖，不把组件测试冒充完整 COL PASS。

日期、超时和流故障使用可控时钟/依赖与本地 HTTP Fixture；不能只断言配置数字或检查代码存在。需要证明网络禁止路径没有发起目标 socket、正文复用确实不发请求、超限后的 reader/连接已释放。

## 9. 三卡实施约束与 Gate

沿用 D04-T01/T02/T03，不生成替代任务 ID。T01 冻结通用 schema 与列表解析，T02 冻结内容决策/正文提取，T03 完成生产受限 HTTP、安全故障矩阵与集成。T01/T02 可通过注入测试传输独立验收；在 T03 完成前不得暴露不受保护的默认真实 HTTP 工厂或接入运行服务。Lead Plan 必须列出逐卡可用能力与剩余门禁，不能把临时 Stub 当最终实现。

文件级边界、资源关闭接口、具体构造函数以及测试命令由新 Paseo Lead 在 Plan 中落实，不允许重定义本文字段语义、安全规则和版本。三卡串行、每卡新 Worker；Worker REVIEW → Lead 独立审核冻结候选 → Architect APPROVED → candidate/--no-ff merge → 合并后验证 → PASS。

集成必须在干净快照执行 npm ci 与完整 npm run verify，覆盖本地 HTTP Fixture；保留 D00～D03 回归、Prompt 字节与隐私不变量，不能污染默认 data 路径。不因 D04 安装依赖直接改动 D02 LLM 或 D03 lifecycle。

最终门禁分开记录：D04_LOCAL_GATE=APPROVED 只表示本地通过；负责人另行授权 D04 push 后，核验精确 SHA 远程 CI Success，才记录 D04_REMOTE_CI=PASS 与 D04_FINAL_PASS=ISSUED。D03 push 授权不自动延伸到 D04。负责人审阅 Plan 并批准执行前不创建 Worker。

## 10. G2 审核结论

- 审核者：Architect；日期：2026-11-16；结论：APPROVED。
- 与 G1 一致：RSS 作为首个实现；description 不按长度升级全文；来源声明与网页提取分开；失败保留实际数据；未来财经 API 延期。
- 关键风险已显式处理：全文是约定证据而非真实性证明、网页提取可能漏检截断、仅 UTF-8/ASCII、DNS 固定与手动重定向、取消及字节上限、无数据库写入。
- 无需负责人重新选择业务目标；依赖运行兼容性在每卡确定性测试验证，不能在尚未实现时声称已通过。
- 当前实现/新测试/真实 RSS/远程 CI 全部 NOT_RUN；下一门禁为 Lead Plan，随后负责人审阅执行计划。
