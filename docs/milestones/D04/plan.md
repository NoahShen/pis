# D04 Plan · 通用 SourceAdapter 与 RSS 首个实现

> 版本：v0.4
> 状态：REVIEW · 已按 Architect 对 v0.3 的 G3 CHANGES_REQUIRED 修订，提交复核
> 版本轨迹：v0.1 初稿；v0.2、v0.3 为前序 G3 修订稿，均未 APPROVED；v0.4 修复 v0.3 的四项定位阻塞并补齐 Lead 文档交付/Worker 收尾门禁。
> Intent：`docs/milestones/D04/intent.md`（APPROVED）
> Spec：`docs/milestones/D04/spec.md`（APPROVED · Architect G2）
> 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`（D03 最终 PASS）
> 本文不构成 Worker 执行授权；负责人明确批准 Plan 且完成 G3 后才能创建 Worker。

固定运行时前置（所有卡、Gate 与证据命令相同）：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
```

本文命令块省略该 export，不表示可使用宿主默认 Node/npm；若前置版本不符，直接 `BLOCKED`，不得安装替代运行时或继续。

## 1. 目标、边界与冻结结论

D04 交付一个可独立调用、严格类型化、可序列化的 `SourceAdapter` 组件及 RSS 实现。范围只含：

- RSS 2.0 与 Atom 1.0 列表解析、身份/元数据映射、相对 URL 与时间规范化。
- 来源全文优先、摘要保留、网页正文提取、受限文章识别、失败回退。
- 受限 HTTP、DNS/IP 固定、手动重定向、MIME/编码/字节/时间预算、取消与资源回收。
- 组件级测试、真实 linkedom + Readability 互操作测试、本地 HTTP Fixture 集成测试。

明确不做：

- 不注册管理/运行接口，不接入 `server.ts`、`config.ts`、数据库、Schema、Scheduler、Collection、Processing、LLM 或派发。
- 不实现财经 API Adapter、RSS 1.0/RDF、JSON Feed、OPML、分页抓取、登录/验证码/付费墙绕过或站点规则。
- 不修改 `Source.type` 枚举、`Source.type/url` 不可变规则、检查点只读规则、DDL、Prompt 或 D02/D03 行为。
- 不增加 `allowPrivate`、关闭 TLS 校验、任意端口或可配置任意 header 的开关。
- 不使用 jsdom、DOM lib、宽泛 `any` 或 blanket catch；不请求真实互联网。

Plan 不受理任何 Spec 契约变更。若依赖互操作失败，候选不得静默换库、关闭保护或降低测试，必须回报 `BLOCKED` 并由 Architect 审议最小修订。

## 2. 冻结的公共契约与文件布局

### 2.1 公共入口

最终公共入口固定为 `src/adapters/rss-adapter.ts`：

```ts
export interface RssHttpPolicy {
  requestTimeoutMs: number;
  maxRedirects: number;
  feedMaxBytes: number;
  articleMaxBytes: number;
  maxFeedEntries: number;
  articleMinTextChars: number;
}

export interface RssAdapterOptions {
  httpPolicy?: Partial<RssHttpPolicy>;
  transport?: RssTransport;
}

export function createRssAdapter(options?: RssAdapterOptions): SourceAdapter;
```

`src/adapters/rss-adapter.internal.ts` 是本项目内部装配/核心模块，不重导出给外部调用方：

```ts
interface RssRuntimeDependencies {
  restrictedTransportFactory?: (
    signal: AbortSignal,
    policy: RssHttpPolicy,
  ) => RssTransport;
}

export function createRssAdapterWithDependencies(
  options: RssAdapterOptions | undefined,
  dependencies: RssRuntimeDependencies,
): SourceAdapter;
```

`options.ts` 在 T01 即冻结六个参数的默认值、闭区间和运行时校验，后续卡只消费同一结果：`requestTimeoutMs=15000`（100～120000）、`maxRedirects=3`（0～5）、`feedMaxBytes=2097152`（1024～8388608）、`articleMaxBytes=5242880`（1024～16777216）、`maxFeedEntries=1000`（1～10000）、`articleMinTextChars=80`（1～1000）。全部必须是整数；返回完整冻结对象，未知键、NaN、Infinity、小数、字符串 coercion 均拒绝。T01 的 contracts/errors/options/transport 即全部六参数与 feed/article 能力；后续卡不扩写这些冻结接口。

- T01 冻结 `SourceAdapter`、`AdapterSource`、`SourceEntry`、`SourceText`、`SourceContent`、`AdapterReason`、`AdapterCallOptions` 的语义与共享 Zod schema；但只交付可独立测试的列表 reader，不交付默认真实 HTTP。
- T02 的 `createRssAdapter` 要求注入 `transport`，完整提供 `fetchEntries`/`fetchContent`，仍不暴露默认真实 HTTP。`rss-adapter.internal.ts` 承载核心装配与默认 factory 选择；默认 factory 只可按逻辑请求调用，不得缓存首次调用绑定的 transport。T02 尚无生产 restricted factory，不能从该路径回落到公开网络。
- T03 将公共 `transport` 改为可选；`rss-adapter.ts` 私有装配层提供 `(signal, policy) => createRestrictedRssTransport({policy, signal, ...})`。缺省时每个逻辑请求调用该内部 factory 创建独立 transport；显式注入 `transport` 时优先使用，归调用方拥有。最终签名以上述形状为准。T01 的 `transport.ts`/`errors.ts` 从第一次落盘即支持 feed/article、响应标志与最后验证 URL，T02/T03 均不扩写公共 DTO 或错误形状。
- 公共 `transport` 仅作为明确依赖注入 seam，不进入部署配置、环境变量或 HTTP API；`RssRuntimeDependencies` 与 `createRssAdapterWithDependencies` 只在 internal module 导出，不从 `rss-adapter.ts` 重导出。生产调用不传 transport。

`RssTransport` 是共享 feed/article 的窄接口；可序列化请求只接收待校验逻辑 URL、kind、本次逻辑请求的总 timeout 与解压后 byte budget，**不包含 `AbortSignal`、函数或运行时对象**：

```ts
interface RssTransportRequest {
  kind: "feed" | "article";
  url: string;
  timeoutMs: number;
  maxBytes: number;
}

interface RssTransportDocument {
  finalUrl: string;
  body: string; // complete UTF-8/ASCII fatal-decoded text, never raw bytes
  receivedResponse: true;
}

interface RssTransport {
  fetch(request: RssTransportRequest): Promise<RssTransportDocument>;
}
```

取消不进入请求 DTO，且属于每个逻辑 fetch 调用：公共方法的 `options.signal` 在入口同步读取并绑定到该请求独占的内部 `AbortController`；一次调用只发一个请求（feed 或 article），不跨调用共享 controller。未注入 transport 时，internal factory 在该逻辑请求通过预取消检查后，以本次 controller signal 新建恰好一个 transport；该实例只服务本次调用并在退出时释放，绝不缓存首次绑定的 closure transport。adapter 实例只能共享不可变 policy 与 factory，不得共享 callSignal、controller 或 transport。显式注入 transport 仍归调用方并由调用方决定复用；adapter 不接收/保存其 signal，caller abort 用本次竞速停止消费，但不调用其 close/destroy。两种路径都在 caller abort 时立即拒绝 `aborted`：默认 transport 取消本请求 reader/socket，注入 transport 的晚到 settle 仍须被消费。T02 用挂起注入 transport 固定注入所有权；T03 用 factory/tracker 分别证明同一 adapter 连续或并行调用的 transport、controller、Agent/socket 均相互隔离。

成功结果只可能在收到响应后产生，故固定 `receivedResponse: true`。注入 transport 的预期失败使用内部 `AcquisitionError`：固定 reason、是否收到响应、最后已验证 URL；不得把底层 message/cause 暴露到公共错误或日志。公共 `AdapterError` 只含固定 reason 和固定安全 message。T02 的注入 transport 若对可预期网络失败私造值而 `receivedResponse=true`，必须同时给出最后验证 URL；schema 会拒绝 `true/null`，保证矩阵可执行。

### 2.2 共享运行时 schema

`src/adapters/contracts.ts` 使用严格 Zod object 定义：

- `SourceEntry` 六个 nullable 字段与 `SourceText` 全部 required；不允许 `undefined`、未知输出字段、NaN/Infinity。
- `SourceContent.schema_version` 严格为 `1`；枚举、nested article、entry 全部运行时校验。
- `SourceText.value` 必须非空白；正文/摘要“可用”统一以清洗后可见文字判断，不以 HTML 标签或输入长度判断。
- `AdapterSource.id`、type、url 在 adapter 边界校验；现有 D03 Source 的额外配置字段在入口显式投影，不进入 Adapter 输出。

输出在返回前再做一次 schema 校验。schema 失败属于编程错误，直接拒绝 Promise，不能被当作文章获取失败或摘要回退。

### 2.3 文件级责任

计划新增/修改：

```text
src/adapters/contracts.ts                 T01 公共类型、Zod schema、输入投影
src/adapters/errors.ts                    T01 AdapterError 固定 reason
src/adapters/options.ts                   T01 严格 policy 默认值与范围校验
src/adapters/transport.ts                 T01 transport DTO/内部 AcquisitionError
src/adapters/rss/feed-parser.ts           T01 RSS/Atom 有序解析与字段映射
src/adapters/rss/url-time.ts              T01 URL/xml:base/时间严格规范化
src/adapters/rss/feed-reader.ts           T01 注入 transport 的列表 reader
src/adapters/dom-boundary.ts              T02 linkedom/Readability 窄 DOM 边界
src/adapters/content-cleaning.ts          T02 HTML/纯文本清洗
src/adapters/article-extractor.ts         T02 Readability/受限信号/正文提取
src/adapters/rss-adapter.internal.ts      T02 核心装配；T03 默认 factory seam
src/adapters/rss-adapter.ts               T02 完整接口；T03 默认真实 transport 装配
src/adapters/http/address-policy.ts       T03 IP 分类与 URL 入口校验
src/adapters/http/encoding.ts             T03 MIME/ASCII/UTF-8 fatal decode
src/adapters/http/restricted-client.ts    T03 生产安全 transport
README.md                                 T03 最终参数、边界、调用示例
package.json / package-lock.json         按卡增加精确依赖
tests/adapters/*.test.ts                  仅对应卡新增
tests/fixtures/rss-*.ts                   T01/T02 本地 XML/HTML Fixture
tests/fixtures/http-fixture.ts            T03 受控本地 HTTP server/连接注入
```

不新增生产 Source type、公共 plugin registry 或持久化 envelope 表。目录名不改变 Spec 字段和 reason 语义。

## 3. 三卡能力边界与串行交接

| 时点 | 已可用能力 | 明确不可用/剩余门禁 |
|---|---|---|
| T01 合并后 | 公共契约/schema；注入 transport 的 RSS/Atom `fetchEntries`；列表解析、URL/time、限额和整批失败语义 PASS | 无 `fetchContent` 完成态，不暴露默认真实 HTTP，不能宣称 D04 Adapter 可用 |
| T02 合并后 | 完整 `SourceAdapter` 行为；全文/摘要/网页提取/受限回退；真实 linkedom+Readability smoke PASS | 只有注入 transport 可验收；生产 SSRF/超时/redirect/byte 安全尚未完成 |
| T03 合并后 | `createRssAdapter()` 默认使用生产受限 HTTP；本地 Fixture 验证 URL/DNS/redirect/byte/cancel/resource 全路径 | 仍不接服务、DB、调度或真实互联网；需 D04 本地集成 Gate 与负责人另行 push 授权 |

三卡严格串行、每卡新 Worker。Worker `REVIEW` 后由 Lead 独立审核并冻结精确 tree；Architect `APPROVED` 后才创建 candidate，再 `--no-ff` merge。未批准 tree 不得 stage、commit、merge 或 push。

## 4. 实施不变量

### 4.1 输入快照与纯度

- `fetchEntries` 和 `fetchContent` 在任意 `await` 前同步快照可变输入：对 source/entry 逐字段投影，对 `full_body`/`summary` 再复制 `{value, format}`；signal 仅保留引用用于控制 adapter/默认 transport，绝不序列化或进入 request DTO。
- 后续逻辑只读快照。即使调用方在首次 await 后修改原对象或嵌套 `SourceText`，本次结果与 transport 参数不变。
- 每个方法都在入口检查预先 aborted；`AbortSignal` 不进入 schema、JSON、错误消息或 transport DTO。
- 返回全新 entry/content；不修改输入，不冻结调用方对象。结果做 `JSON.stringify`/`JSON.parse` 一致性与无 undefined 检查。
- `lastCollectedAt` 不参与过滤；feed 顺序不变；重复 GUID 不合并。

### 4.2 错误与日志

- 公共 `AdapterError.message` 固定为 reason 的安全短语；不设置会携带底层 message/URL 的 `cause`。
- feed 获取/解析失败始终拒绝；文章只有已知 `AcquisitionError` 可进入回退表，编程错误与结果 schema 错误继续抛出。
- 调用方 abort 永远抛 `AdapterError("aborted")`，即使是文章请求，也不回退摘要。
- 不新增 logger；真实/敏感完整 URL、正文、凭据、IP 或 token 不得进入错误对象、错误日志或错误快照。正常 `SourceContent` 的契约 URL 字段、合成 Fixture URL 及对应断言不在此禁令内。

### 4.3 资源所有权

- 注入 transport 归调用方；adapter 永不关闭、销毁或改变其全局状态，也不在 caller abort 时尝试 cancel 它；是否跨逻辑请求复用由调用方决定。
- 默认 transport 每个逻辑请求按该请求 signal 新建并拥有一个 transport；其每个 hop 的 dispatcher 也由该 transport 拥有，在成功、失败、超限、DNS/redirect/取消所有路径都关闭连接并清理 timer/listener。adapter 只共享不可变 factory/policy，不缓存调用绑定 transport。
- 不安装全局 dispatcher，不保留跨请求连接池。清理路径有有限上限；晚到 DNS/socket promise 的 rejection 必须被消费，不能 unhandled rejection。
- `restricted-client.ts` 内部保留窄 `RestrictedClientDependencies`/tracker seam：只允许测试注入 `dispatcherFactory`（记录 `close`/`destroy`）、resolver、fixture connector 和事件探针，以计数 active timer/listener、`reader.cancel`、晚到 lookup/socket。该类型与 factory 不从 `rss-adapter.ts` 公共入口导出，不接受 `allowPrivate`、租户配置、任意 resolver 或任意 URL；不增加公开 `close()`。

## 5. D04-T01 · 契约与 RSS/Atom 列表解析

### 5.1 允许写集

- `package.json`、`package-lock.json`：仅新增 `fast-xml-parser@5.12.1`。
- `src/adapters/contracts.ts`、`errors.ts`、`options.ts`、`transport.ts`。
- `src/adapters/rss/feed-parser.ts`、`url-time.ts`、`feed-reader.ts`。
- `tests/adapters/contracts.test.ts`、`feed-parser.test.ts`、`feed-reader.test.ts`。
- `tests/fixtures/rss-list.ts`。
- `docs/milestones/D04/progress.md` 只由 Lead/Architect 记录门禁，不属于 Worker candidate。

不得修改 `src/adapters/rss-adapter.ts` 的完整内容逻辑（T02 才创建）、数据库、server/config、D02/D03 代码或 D04 docs/spec。

### 5.2 实现细节

1. 公共契约与 schema 按 §2 冻结；`AdapterReason` 只含 Spec 的 19 个固定值，无 catch-all reason。
2. `options.ts` 严格验证六个整数范围，拒绝 NaN/Infinity/浮点/字符串 coercion；T01 返回完整冻结 policy，解析器消费列表字段，HTTP 字段留给 T03 消费。`SourceContent` schema 虽在 T01 交付，但 `fetchContent` 行为只在 T02 完成；T01 测试其 schema 不构成行为越界。
3. XML 解析前拒绝 DTD/ENTITY 声明；设置 `preserveOrder: true`、关闭 tag/attribute 数值强制转换，保留 CDATA/实体/文档顺序。`maxNestedTags=100`，解析后元素总数上限固定为 100,000（实现内安全上限，不成为业务配置）。
4. 命名空间使用 in-scope `xmlns` 映射后的 URI 解析，不硬编码任意前缀。支持标准 Atom URI、content module URI、Dublin Core、Media RSS；未知扩展忽略。RDF/JSON/未知根报 `unsupported_feed`，缺必要容器/非法 XML 报 `invalid_feed`。
5. 先统计 `rss/channel/item` 或 Atom `feed/entry`；超过 `maxFeedEntries` 整批 `feed_too_many_entries`，不截断。合法空列表返回 `[]`。
6. 映射严格按 Spec §3.2；同字段取文档顺序首个非空可支持值。GUID 原样去首尾空白、不改大小写；无 GUID 且无有效 URL 跳过；有 GUID/URL 但无日期仍保留。
7. RSS guid 仅在明确 `isPermaLink=true`，或属性省略且文本本身是合法 HTTP(S) URL 时作为 URL 后备。GUID 为 `isPermaLink=false` 且无 link 时 URL 为 null。
8. Atom link 选择首个 rel=alternate 或 rel 缺失、type 缺失/HTML/XHTML 的 link；`href` 必需。`content src`、二进制或未知 type 不产生 full_body。Atom feed author 在 entry author 缺失时回退。
9. `<content:encoded>`、Atom HTML/XHTML inline content 映射 HTML `SourceText`；Atom text 类型映射 TEXT。XHTML 使用内部有限 XML subtree serializer 保留标签，不做可执行 HTML 处理。RSS description/media:description 映射 summary，HTML/XHTML summary 保留为 HTML SourceText。
10. URL 先基于 in-scope `xml:base` 链和 transport 最终 feed URL 解析为 WHATWG URL；只接受 http/https、无 userinfo/fragment/控制字符、仅默认端口。单条非法 URL 为 null，不抹掉其他来源身份；最终 feed URL 也不能写回 source。
11. 时间不使用无时区 `Date.parse`：RSS 只接受带数值 offset 或 GMT/UTC 的 RFC822/1123；Atom 只接受 Z/数值 offset 的 RFC3339。先验证时区/语法，再检查有效 Date，并统一调用现有 `formatTimestamp()`；存在但非法时返回 null，不尝试同语义组第二字段。
12. `feed-reader.ts` 实现 `fetchEntries` 的同步快照、source 校验、注入 transport 调用、parser、source_entry[] schema 和整批返回；不调用 `fetchContent`，不关闭注入 transport。`transport.ts` 同时冻结 article 请求、响应元数据和全部 19 个 reason，因此 T02/T03 不修改该 DTO。
13. XML/时间/URL 解析错误统一映射固定 AdapterReason；传输抛出的已知 AcquisitionError 可保留 reason。未知编程错误透传，不 blanket catch。

### 5.3 必测

- `contracts.test.ts`：合法/非法 entry/text/content schema；输出无 undefined、NaN、循环引用；合成非 RSS `SourceAdapter` 消费者可接受，不新增生产 type。
- `feed-parser.test.ts`：RSS/Atom、任意合法 namespace prefix、CDATA、预定义/数值实体、缺字段、多个字段首值、GUID 语义、合法空列表。
- `feed-parser.test.ts`：xml:base/最终 feed URL/相对链接、默认端口、重定向不负责、非法 URL 仅置 null、未知 Atom link/content 跳过。
- `feed-parser.test.ts`：RSS RFC822 数字 offset/GMT/UTC、Atom RFC3339 Z/offset、无时区/非法日期 null、机器 TZ 改值不影响结果。
- `feed-parser.test.ts`：malformed XML、DTD/ENTITY、RSS 1.0、未知根、缺 channel/feed、超过节点/条目上限；非法整批拒绝且无部分数组。
- `feed-reader.test.ts`：source 入口同步快照（挂起 transport 后立即修改 source 字段，请求/输出仍用旧值），不改输入，返回新数组。
- `feed-reader.test.ts`：CHECKPOINT 早于/晚于发布时间均不本地过滤，feed 顺序/重复 GUID 保留；预先 abort 不调用 transport。
- `feed-reader.test.ts`：已知 feed reason 透传、未知异常不伪装、结果 schema 错误拒绝、注入 transport 不被关闭。

### 5.4 定向命令与交回

```bash
npm run verify:toolchain
npm install --save-exact fast-xml-parser@5.12.1
git diff -- package.json package-lock.json
npm ci
npm ls --depth=0
npm run typecheck
npx vitest run tests/adapters/contracts.test.ts tests/adapters/feed-parser.test.ts tests/adapters/feed-reader.test.ts
npm run verify
git diff --check
```

Worker 交回最多五行实现说明、Case 映射、命令摘要、依赖 diff、已知限制，仅报 `REVIEW`/`BLOCKED`。T01 通过只表示列表能力 PASS，不表示 D04 Gate。

## 6. D04-T02 · 全文/摘要决策与网页正文提取

### 6.1 允许写集

- `package.json`、`package-lock.json`：仅新增 `@mozilla/readability@0.6.0`、`linkedom@0.18.15`。
- `src/adapters/dom-boundary.ts`、`content-cleaning.ts`、`article-extractor.ts`、`rss-adapter.internal.ts`、`rss-adapter.ts`。
- `tests/adapters/content-cleaning.test.ts`、`article-extractor.test.ts`、`rss-content.test.ts`。
- `tests/fixtures/rss-content.ts`。

T02 对 T01 文件修改数固定为 **NONE**：T01 的 `transport.ts`/`errors.ts` 已从首次实现支持 article 请求、响应标志、最后验证 URL 和文章失败元数据；T02 只消费。任何需要修改 T01 冻结契约的情况都先报 Lead，不得在现场扩写。

### 6.2 DOM/类型边界

`tsconfig` 不增加 DOM lib。`dom-boundary.ts` 是唯一接触 linkedom/Readability 类型的模块：

- 定义最小的 `DomDocumentLike`/`DomElementLike`/`DomNodeLike` 能力接口，并在运行时检查 `documentElement/body/querySelector[All]/textContent/getAttribute/remove` 等所需能力。
- `parseHTML()` 返回值和 Readability document 参数先在 `unknown` 边界做 capability check，再窄断言为库签名接受类型；禁止 `any`、`as any`、把 DOM 对象放到公共结果。
- Readability `content` 重新经同一有界 DOM facade 转纯文本；只取 visible text，不在结果暴露 DOM/HTML。
- 保留现有 `skipLibCheck: true` 只用于第三方声明；本项目不通过额外类型包掩盖互操作。
- T02 必须运行实际 `linkedom parseHTML` + `new Readability(document).parse()` 的非 stub Fixture；仅 typecheck 或 mock 不算通过。

### 6.3 清洗与提取

1. `content-cleaning.ts` 对 TEXT 规范 CRLF、连续空白和首尾空白。HTML 处理顺序固定为：先用 linkedom 解析原始 HTML 并保留未清洗 DOM；随后在该原始 DOM/脚本节点仍存在时完成 restricted 信号检测；最后才移除 script/style/template/noscript、`hidden`、`aria-hidden=true`、nav/header/footer/form 等非正文区域。禁止先删 script 再检查 JSON-LD，否则会丢失 `isAccessibleForFree=false`。全过程不加载资源、不执行脚本、不跟随 meta/canonical。
2. restricted 信号只检查清洗前原始 DOM 中合法 JSON-LD 顶层对象/@graph 项的 `isAccessibleForFree=false`，以及 `[itemprop="isAccessibleForFree"][content="false"]`；无效 JSON-LD 忽略，不执行、不跟随 URL、不用“订阅/付费”文字启发式。
3. restricted 检测完成后才执行清洗与 Readability：可见文本 collector 将块级边界转成换行，实体解码，压缩连续空白；图片无可见文字视为空。清洗后空值时 SourceText 视为不可用。
4. 正文提取只使用 Readability parse 结果；charThreshold 显式设为 policy，URL 使用安全 transport 最终文章 URL。禁止把整页 body.textContent 当提取失败替代正文。
5. Readability null/空/清理后 code point 少于 `articleMinTextChars` 为 `extraction_failed`。阈值不作用于来源明确 full_body/summary。
6. restricted 且 Readability 有非空片段：有来源摘要优先 SUMMARY/SOURCE_FALLBACK；否则 FRAGMENT/ARTICLE_EXTRACT。不得生成 FULL_BODY，状态固定 FAILED/restricted_content。
7. `createRssAdapter(options & { transport: RssTransport })` 只校验 policy 并把注入 transport 交给 `createRssAdapterWithDependencies`；internal module 实现完整 SourceAdapter。transport 请求不含 signal，调用本身负责 byte/MIME/encoding/timeout，文章预期失败以 `AcquisitionError` 提供 reason、最后验证 URL 与收到响应标志。注入 transport 归调用方，adapter 不关闭或 cancel 它；每次方法的 `AdapterCallOptions.signal` 独立绑定到该逻辑请求，caller abort 通过竞速立即拒绝并消费其最终 settlement。
8. `fetchContent` 在入口同步复制 entry 及 nested SourceText，再按 §6.4 矩阵执行；除调用方 `aborted` 外不得抛已知文章获取失败。

   - full_body 清洗非空：直接 FULL_BODY，文章 transport 调用数为 0，final_url null。
   - 无全文且 URL null：SUMMARY/NONE，NOT_REQUESTED/no_article_url。
   - 提取成功：FULL_BODY/ARTICLE_EXTRACT/ARTICLE_EXTRACTED/SUCCESS，记录最终 URL。
   - 提取失败/受限/HTTP/MIME/超限/超时/blocked：只能按 §6.4 固定矩阵映射，不按 message 或响应正文猜测。
   - summary 字段始终仅来源摘要清洗结果；不自动生成摘要，不拼接/按长度择优。
9. `article.final_url` 规则见 §6.4；DNS/connect 前失败为 null。所有 URL 只在结果字段，不进错误 message。
10. 调用方 abort 使用该逻辑请求独占的内部 controller 与竞速立即抛 `AdapterError("aborted")`，不回退；注入 transport 不接收 signal，其晚到 resolve/reject 只允许被消费。先前调用的 signal 或注入 transport 的共享状态不能取消后续调用；内部 request timeout 是普通文章失败 `timeout`，可按矩阵回退。
11. `fetchEntries` 委托 T01 reader；T02 只把 transport 注入，不复制 XML parser，也不重试。

### 6.4 文章结果精确矩阵

“摘要回退”统一表示为：来源摘要清洗非空时 body 为来源摘要、`content_kind=SUMMARY`、`acquired_via=SOURCE_FALLBACK`、`completeness_basis=PARTIAL_ONLY`；摘要不可用时 body 为 null、`content_kind=NONE`、`acquired_via=NONE`、`completeness_basis=NO_CONTENT`。`article.reason` 始终保留 acquisition reason，摘要回退不改变 `FAILED/BLOCKED` 状态。`restricted_content` 有非空 Readability 片段且无摘要时例外使用 `FRAGMENT/ARTICLE_EXTRACT/PARTIAL_ONLY`；`extraction_failed` 的短文本不得当作 fragment。

| acquisition reason | receivedResponse / final_url | body + kind + via + basis | article.status |
|---|---|---|---|
| `blocked_url` | 初始 URL 被拒：false/null；redirect 目标被拒：true/最后已验证 URL | 摘要回退 | `BLOCKED` |
| `dns_failed` | 初始解析失败：false/null；redirect 目标解析失败：true/最后已验证 URL | 摘要回退 | `FAILED` |
| `network_error` | 响应前失败：false/null；响应流阶段失败：true/最后已验证 URL | 摘要回退 | `FAILED` |
| `timeout` | 响应前超时：false/null；响应流阶段超时：true/最后已验证 URL | 摘要回退 | `FAILED` |
| `http_status` | true/最后已验证 URL | 摘要回退 | `FAILED` |
| `redirect_limit`、`invalid_redirect` | true/产生该错误的最后已验证 URL | 摘要回退 | `FAILED` |
| `unsupported_mime`、`unsupported_encoding`、`response_too_large` | true/最后已验证 URL | 摘要回退 | `FAILED` |
| `extraction_failed`（含文章 204/205） | true/最后已验证 URL | 摘要回退；无摘要时 NONE/NO_CONTENT，不得使用短片段 | `FAILED` |
| `restricted_content` | true/最后已验证 URL | 有摘要时摘要回退；否则有非空片段时 `FRAGMENT/ARTICLE_EXTRACT/PARTIAL_ONLY`；再否则 NONE | `FAILED` |
| `no_article_url` | 未请求：false/null | 有摘要时摘要回退；否则 NONE/NO_CONTENT | `NOT_REQUESTED` |

`aborted` 永不生成 `SourceContent`：预先或进行中 caller abort 均拒绝 `AdapterError("aborted")`，不回退。`unsupported_source`/`invalid_source` 的入口错误同样拒绝。`unsupported_feed`/`invalid_feed`/`feed_too_many_entries` 只属于 feed 拒绝，不进入文章矩阵；feed 的 204/205 固定 `invalid_feed`。Spec 的 19 个 reason 已逐项核对，无遗漏、无额外 catch-all。该矩阵仅为 implementation/test oracle，不改变 Spec。

### 6.5 必测

- `content-cleaning.test.ts`：TEXT/HTML 空白、实体、段落边界、隐藏/导航/script/style/template/noscript 清除；纯图片为空；不加载资源。
- `article-extractor.test.ts`：真实 linkedom+Readability 从有效 Fixture 提取多段落、去导航/脚本、code point 阈值、null/short 失败；同 Fixture 的 Readability+linkedom 互操作证据必须留命令/测试名。
- `article-extractor.test.ts`：JSON-LD 对象、@graph、DOM itemprop 三种 restricted 信号；无效 JSON-LD 忽略；restricted 不产生 FULL_BODY。至少一条含 JSON-LD 的 Fixture 必须经 `rss-content.test.ts` 的完整 `fetchContent → article-extractor → content-cleaning` 调用链证明信号在 script 移除前被识别，孤立信号 helper 单测不能作为唯一证据。
- `rss-content.test.ts`：短/长 full_body 都直接复用、transport 0 次；long description 不升级全文，仍请求文章。
- `rss-content.test.ts`：有效网页提取、摘要保留、ARTICLE_EXTRACTED；无摘要提取失败返回 NONE 有效身份；有摘要浏览器失败回退 PARTIAL_ONLY。
- `rss-content.test.ts`：逐行覆盖上表所有 reason、receivedResponse/final_url 分支与有无摘要/片段分支；feed 204/205、article 204/205、caller abort 一并覆盖；错误不泄漏 URL/底层 message。
- `rss-content.test.ts`：调用后立即修改原 entry/嵌套 SourceText，挂起 transport 的参数与最终结果仍是入口快照；不修改输入；JSON round-trip 保持。
- `rss-content.test.ts`：预先/进行中 abort 均 `AdapterError("aborted")`；前一次调用 abort 后同一 adapter 的下一次调用仍可成功；并发一篇 abort 不取消另一篇；文章内部 timeout 可回退；source abort 不被回退吞掉。
- `rss-content.test.ts`：零 DB、零 LLM、零额外 HTTP；SourceAdapter 合成非 RSS 结果仍可消费。

### 6.6 定向命令与交回

```bash
npm run verify:toolchain
npm install --save-exact @mozilla/readability@0.6.0 linkedom@0.18.15
git diff -- package.json package-lock.json
npm ci
npm ls --depth=0
npm run typecheck
npx vitest run tests/adapters/content-cleaning.test.ts tests/adapters/article-extractor.test.ts tests/adapters/rss-content.test.ts
npm run verify
git diff --check
```

T02 通过只表示不依赖生产 SSRF 客户端的组件行为 PASS；不登记默认真实 HTTP 已可用。

## 7. D04-T03 · 生产受限 HTTP、故障矩阵与集成

### 7.1 允许写集

- `package.json`、`package-lock.json`：仅新增 `undici@8.12.4`、`ipaddr.js@2.5.0`。
- `src/adapters/http/address-policy.ts`、`encoding.ts`、`restricted-client.ts`。
- `src/adapters/rss-adapter.internal.ts`：只增加 restricted factory 选择与每逻辑请求 transport 创建，不缓存调用绑定 transport，不改变 fetch/parse/extraction 语义。
- `src/adapters/rss-adapter.ts`：只将 `RssAdapterOptions.transport` 改为可选，并增加 `httpPolicy` 解析及生产 restricted factory 装配；不改变 fetch/parse/extraction 语义。
- `tests/adapters/restricted-http.test.ts`、`rss-http.test.ts`、`security.test.ts`（如测试分组需要）。
- `tests/fixtures/http-fixture.ts`。
- `README.md`：D04 参数和调用边界；不改 D02/D03 文档。

不得修改 DDL、server/config、lifecycle、Prompt、D04 spec/intent 或 T01/T02 已冻结业务映射；若安全实现迫使接口改动，先回报 Lead，不自行扩写。

### 7.2 生产受限客户端

`restricted-client.ts` 实现 `RssTransport`，工厂为 internal module export；生产 `createRssAdapter()` 不配置 transport 时创建它，`rss-adapter.ts` 公共入口不重导出该工厂。测试直接导入 internal module 的 `RestrictedClientDependencies`/tracker seam，只接受显式 dispatcherFactory/resolver/fixture connector/事件探针，不接受环境变量或 `allowPrivate`。tracker 必须能断言每 hop **Agent 恰有一个 owner**：成功响应后推迟到 body 完整读取/重定向 `response.body.cancel()` 后才 `close`，其他退出路径在 finally `destroy`；同时观察 `reader.cancel` 次数、active timer/listener 归零、晚到 DNS/socket 不发起连接。测试不得通过公开 options 绕过安全策略。

取消信号保持内部且调用私有：`createRssAdapterWithDependencies` 仅保存不可变 policy/factory，对每个 `fetchEntries`/`fetchContent` 逻辑请求各创建一个内部 controller，并在入口同步绑定该次 `options.signal`；通过预取消检查后，缺省路径用该次 signal 与 policy 调用一次 `dependencies.restrictedTransportFactory(signal, policy)`，返回 transport 仅用于本次请求，请求 settle 后释放，不缓存到 adapter 实例，也不跨 feed/article 调用复用。后续或并行调用不得继承既有 signal/controller/transport/连接。controller 必须由入口选项捕获，`RssTransport.fetch(request)` 的可序列化 DTO 仍无 signal，禁止依赖构造 adapter 时或首次调用时的 signal。公共 `options.transport` 显式注入时由调用方决定对象复用、adapter 不传 signal、不调用 factory、不关闭对象；缺省 transport 则由 adapter 为本次请求创建并拥有。该桥接不扩大公共 API 或配置面。

1. 逻辑请求创建单个总 deadline/AbortController，绑定调用方 signal；剩余预算贯穿 DNS、每个 redirect、headers 和 body，绝不因 hop 重置。
2. URL canonicalization 后校验：http/https、无 userinfo/fragment/控制字符、host 非空、仅默认端口、拒绝 localhost/.localhost；WHATWG URL 规范化后的十进制/十六进制/缩写 IPv4 和 mapped IPv6 再走 IP 校验。
3. 每 hop 用 `dns.promises.lookup({all:true,verbatim:true})` 在剩余 deadline 内解析；最多 32 个结果，任一非公开地址即整次 `blocked_url`，DNS 失败 `dns_failed`。DNS Promise 不支持取消，但 fetch/connector 使用“deadline 已取消”标志，晚到结果只消费、不发起后续连接。
4. `ipaddr.js` 必须解析成功；IPv4 必须 range unicast，IPv6 限 `2000::/3` 且排除 Spec 特殊网段；mapped 转 IPv4 复核。除 Spec 明列网段外，分类为 unspecified/loopback/linkLocal/multicast/reserved/benchmarking/private/CGNAT/broadcast 等默认拒绝。
5. 每 hop 创建 owned undici `Agent`，`connect.lookup` 固定返回本次已校验的第一个地址，保持原 hostname 的 Host/SNI/证书验证；不把 URL 改成 IP。`maxHeaderSize=16384`，connect/headers/body 的 timeout 均不超过剩余总预算；不读代理环境，不关闭 TLS。`Agent` 只取自精确安装的 `undici@8.12.4`。
6. 互操作策略固定为 Node 26 原生 `globalThis.fetch` + 上述 undici `Dispatcher`：定义窄 `NodeFetch`/`RequestInit & { dispatcher: Dispatcher }` 适配类型，不启用 DOM lib、不用 `any`。工厂构造 Agent 后先断言 `instanceof Dispatcher` 且 `dispatch`/`close`/`destroy` 可调用；T03 必测会让它通过 localhost Fixture 完成真实 native-fetch 请求，任何 class/interface 不匹配即 fail，而非仅凭类型通过。先跑最小探针；若 Node 26 明确不接受精确 `undici@8.12.4` 的 dispatcher，候选只能报 `BLOCKED` 供 Architect 修订版本/ seam，不得删除 `undici`、改成全局 dispatcher、改用 `node:http` 或关闭 fixed lookup。`redirect:"manual"`，只接受 301/302/303/307/308；Location 按当前 URL 解析，每 hop 重跑完整校验；HTTPS 降 HTTP 为 invalid_redirect，超过 maxRedirects 为 redirect_limit，重定向 body 立即 cancel。
7. 非 2xx 拒绝；206 或任何含 Content-Range 的响应为 http_status。204/205 对 feed 是 invalid_feed，对 article 是 extraction_failed。非 2xx 文章失败仍携带已收到响应的最后验证 URL；feed 直接抛安全 reason。
8. MIME 仅接受 Spec 集合，其他/缺失 `unsupported_mime`。Content-Length 仅提前拒绝，不代替流计数；用解压后 stream reader 逐块累计，超预算立刻 cancel/终止 `response_too_large`，不返回截断成功。
9. body 统一由原生 fetch decompression 输出后读取。Content-Encoding 校验与计数顺序固定为先读 `response.headers.get("content-encoding")`，只允许空、`identity`、`gzip`、`x-gzip`、`deflate`、`br`（大小写不敏感）；其他编码为 `unsupported_encoding`，再读最终 reader 并按其输出 byte 计数。Content-Length 只作可选提前拒绝。T03 compatibility probe 必须证明 Node 26 原生 fetch 对该精确 undici Agent 的压缩响应是自动解压；若 header 已消费/移除或“最终 reader 为解压后字节”无法通过 gzip 膨胀测试证实，候选 `BLOCKED`，不得按压缩字节计数冒充解压后限额。
10. fatal decode：UTF-8（含 BOM）与 US-ASCII；明确 charset/XML/meta encoding 非支持值 `unsupported_encoding`，无效 UTF-8 同 reason。无声明按 UTF-8；不做 GBK 猜测。
11. 所有成功/失败/超限/取消路径在 finally 中 release reader、清 timer/listener、关闭本 hop Agent、消费晚到 rejection；不保留全局 dispatcher、socket、timer 或 server。
12. 测试只通过显式注入 resolver/connector 将合成公共域名连接受控 127.0.0.1 Fixture；注入代码仅在 tests。安全路径仍执行生产 URL/DNS 校验、redirect、stream、MIME/encoding/Content-Encoding、预算与清理；禁止用整个 transport stub 冒充 COL-15。

### 7.3 必测

- `restricted-http.test.ts`：逐项拒绝 IPv4 `0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.0.0/24,192.0.2/24,192.168/16,198.18/15,198.51.100/24,203.0.113/24,224/4,240/4`；IPv6 `::1,::,fe80::/10,fc00::/7,ff00::/8` 与 `2001::/23,2001:db8::/32,2002::/16,3fff::/20`、IPv4-mapped 对应段；空/多于 32 地址、任一混合 public+private DNS 也全拒绝且目标 connector 未调用。
- `restricted-http.test.ts`：十进制/十六进制/缩写 IPv4、userinfo、fragment、非默认端口、localhost/.localhost；fixed lookup 使用已校验地址，模拟 DNS rebinding 不产生第二次自由解析。
- `restricted-http.test.ts`：真实本地 HTTP Fixture 验证 301/302/303/307/308、相对 Location、循环/limit、缺失/非法 Location、HTTPS 降级拒绝、每个 redirect 重跑内部地址校验；含一条同源 redirect，且固定 lookup 断言原 hostname/Host、SNI/证书校验参数不被 IP 替换。
- `restricted-http.test.ts`：2xx、4xx/5xx、206/Content-Range、204/205、feed/article MIME、缺失 MIME、UTF-8/BOM/ASCII、非支持 charset/XML/meta、非法 UTF-8；204/205 的 feed/article reason 分型各自断言。
- `restricted-http.test.ts`：`limit-1`、`limit`、`limit+1` 精确字节边界（policy 最小 1024，无 0 请求）；Content-Length 低于/等于/高于实际、伪造/错误长度；identity/gzip/deflate/br 解压后边界与膨胀、未知 Content-Encoding、压缩头缺失/保留的互操作分支；无限 stream；每条拒绝路径 `reader.cancel` 可观察且有界请求 byte 计数为最终依据。
- `restricted-http.test.ts`：DNS 悬挂/晚到、慢 redirect/慢 body、总预算不重置、caller abort、预先 abort、late socket/DNS rejection 被消费；`Agent.close/destroy` 恰一次、timer/listener 归零、无 socket/Fixture server 残留；Vitest 记录零 `unhandledRejection` 且 teardown 无 active handle。
- `restricted-http.test.ts`：internal factory 每个逻辑 feed/article 调用恰创建一次 transport；调用方法传入的 signal 绑定该 transport，不绑定首次/先前调用 signal。一次 abort 后同 adapter 后续请求正常，并发请求 aborted 状态互不污染，每次各自清理。
- `restricted-http.test.ts`：Dispatcher compatibility probe；成功 body 全部读完后才 close、redirect body cancel 后 close、错误 path destroy、abort/timeout 单次清理；断言 rss-adapter 不导出工厂/tracker。
- `security.test.ts`：错误 message/错误日志/错误快照不含真实或敏感完整 URL/IP/正文/token；正常 SourceContent 契约 URL 与合成 Fixture 断言保留；测试不访问公网；没有 env allowPrivate 或任意 header 后门。
- `rss-http.test.ts`：`createRssAdapter()` 默认 transport 走真实生产安全客户端代码路径，feed+article 的本地 Fixture 端到端 PASS；清洗后非空 full_body（短/长）仍 0 次文章 socket；文章失败保留摘要/身份；redirect/byte/MIME/timeout 回退逐项符合决策表。
- `rss-http.test.ts`：显式注入 transport 归调用方且不被 adapter 关闭；默认工厂自己的 dispatcher 全部关闭；不接 DB/server。
- `rss-http.test.ts`：同一 adapter 的取消隔离。构造两个顺序挂起请求并分别 abort，证明 factory/transport/controller 各新增一次、A socket 关闭不关闭/污染 B；首次请求 abort 后第二次成功；并行 `A abort + B success` 时仅 A 的 reader/socket 在该时点关闭，B 继续至成功并在结束后关闭自身资源。通过 Fixture 连接 ID/Agent tracker 证明隔离，不仅断言 Promise 竞速结果。
- Fixture 生命周期统一在 `afterEach` 与异常路径 `finally` 关闭，server 只监听 `127.0.0.1:0`；关闭时追踪并销毁残余连接，任一残留令测试失败，不依赖端口固定或测试结束回收。
- 公共出口测试：T01/T02 的 `rss-adapter.ts` 不暴露默认网络路径；T03 仅允许 `createRssAdapter()` 零参走生产 policy，`rss-adapter.ts` 不导出 `createRssAdapterWithDependencies`/restricted factory/tracker，导出对象不得含 allowPrivate、resolver、dispatcher 或环境变量开关。`rss-http.test.ts` 从 internal module 注入只包装 `restricted-client.ts` 的 fixture factory，断言公共入口未直接泄漏该 seam。
- 静态门禁：D04 新增代码不得使用 `any`/`as any`/`@ts-ignore`/`@ts-expect-error`；扫描结果只允许是既有 D00～D03 测试文件（本 Plan 不改），T03 证据必须列出新文件零命中。第三方边界确需窄断言时，使用可检索的内部 capability 类型而非 any。
- `README.md` 检查：六参数默认/范围、无 allowPrivate/TLS 关闭、注入 seam 仅测试、默认工厂与资源所有权、失败/回退和不接服务的边界均明确。

### 7.4 定向命令与交回

```bash
npm run verify:toolchain
npm install --save-exact undici@8.12.4 ipaddr.js@2.5.0
git diff -- package.json package-lock.json
npm ci
npm ls --depth=0
npm run typecheck
npx vitest run tests/adapters/restricted-http.test.ts tests/adapters/rss-http.test.ts tests/adapters/security.test.ts
npm run verify
git diff --check
```

T03 通过才可宣称 RSS 列表+正文获取的生产受限 transport 本地已集成；真实互联网、真实 RSS、D05 持久化与下游派发仍 `NOT_RUN`。

## 8. 依赖锁与兼容性门槛

所有新增包均被 `src/` 运行时引用，因此放入 `dependencies`，不放入 `devDependencies`；均用当前固定 Node/npm 执行 `--save-exact`，只在本卡新增，package-lock 记录 registry `resolved` 与 integrity。计划冻结的 tarball SHA-512 integrity（base64，实施时与 lockfile 核对）：

| 依赖 | 版本 | integrity |
|---|---|---|
| fast-xml-parser | 5.12.1 | `sha512-wR8dO/fx+z8C5exuem1e7BKOWvjsuzvjS/tvA/Xu3Z1zQqJGcXrPzXbcAiaMgp2KjreEROcTkmnnisrcmJ2hYQ==` |
| @mozilla/readability | 0.6.0 | `sha512-juG5VWh4qAivzTAeMzvY9xs9HY5rAcr2E4I7tiSSCokRFi7XIZCAu92ZkSTsIj1OPceCifL3cpfteP3pDT9/QQ==` |
| linkedom | 0.18.15 | `sha512-o0w7eD/SvoCao+pUi6dzocCLuMR11g4Tv/et0W2OUzwWmUcewntSzyl+Ua/K+0yKym0Y/Mav3nFAaI5Av5jvZg==` |
| undici | 8.12.4 | `sha512-8Mx+uNKKER2bA4AdtedkqRbwUCIJFr2nJckXRe5yrDqzePqwLP7VNcctN8/XdmDSbF7mS+jJKIszlL+vbam1VA==` |
| ipaddr.js | 2.5.0 | `sha512-aq+t5NAc+cS6rZQQVWC2x98CPqGtKKTMDd4Gaodv0wShnItdKg/51djkGJ1hqH+Oy0ivDftCbSLCQob8zso01w==` |

每卡必须：

- 固定 Node 26.13.1/npm 11.20.0。顺序固定为 `npm run verify:toolchain` → 本卡唯一一次显式 `npm install --save-exact <本卡包>`（只由该命令更新 package.json/lockfile）→ 核对 lockfileVersion/本卡 resolved+integrity/无额外包 → `npm ci` → `npm ls --depth=0` 无 extraneous，再开始编码测试。禁止先 `npm ci` 清掉未入 lock 的包，也禁止用 npm 12 改写 lockfile。
- 核验 `undici` engines 与精确 Node 兼容；linkedom 的 canvas peer 保持 optional 且不安装 canvas；Readability 无运行时依赖、无 jsdom 安装。
- T02 实际 linkedom+Readability smoke；T03 实际 native fetch+undici Dispatcher+fixed lookup/local fixture smoke，并显式断言 dispatcher class/callable interface。依赖元数据不等于互操作证据。
- 若 install/typecheck/runtime/fixture 任一失败，候选 `BLOCKED`；不得换库、加 DOM lib、全局 dispatcher、放宽 TS 或跳过测试。

## 9. 集成 Gate 与证据包

### 9.1 每卡门禁

1. 新 Paseo Worker、固定 base、独立 worktree；核对 HEAD/tree/clean。
2. Worker 只改本卡白名单，先报最小实现差异；自测后只报 `REVIEW`/`BLOCKED`，不得 stage/commit/merge/push。
3. Lead 独立复核写集、依赖、安全边界、输入快照与 Case 映射；只按冻结 diff 的 tracked 路径及明确列出的合成 Fixture 做 Secret 检查，不遍历整个 worktree；必要时退回同一 Worker 修复。
4. Lead 冻结隔离 index/tree/patch SHA-256，交 Architect。Architect `APPROVED` 后才可在 Worker 分支以冻结 tree 创建一个 candidate commit；其 parent 必须为固定 base，Worker 自身不得预先产生 commit。
5. candidate 精确 parent/tree/路径，`--no-ff` merge 后重新跑定向与 full verify；记录 `PASS · LOCAL_MERGE_VERIFIED`。
6. 每卡合入并通过合并后复验后执行 Worker 收尾：逐文件核对 candidate 的 blob 与 merge commit 中对应 blob 完全一致；Worker 分支 tip 必须等于该 candidate，不得存在领先 candidate 或未审的提交。检查 Worker worktree 全部 tracked/untracked 状态；任何唯一未提交成果先由 Lead 单独定位/备份或明确判废，旧 `progress.md` 不得覆盖 main/Lead 版本。确认无未合入成果后使 worktree clean，再通过 Paseo 对 Worker 自身 `workspaceId` 调用 `archive_workspace` 并记录 `success`、workspace/branch、candidate/merge SHA 与 blob 对照摘要。主工作区及其 workspace 永不归档；归档失败或仍有未合入内容时保持原 workspace 并记 `BLOCKED`，不得删除目录绕过。

### 9.2 D04 本地集成 Gate

从干净基线/worktree 执行固定 toolchain、`npm ci`、全量 `npm run verify`，并额外保留：

- T01 RSS/Atom 列表、快照、时间/URL/limit 测试证据。
- T02 实际 linkedom+Readability 测试名/输出；来源全文 0 次 article HTTP。
- T03 本地 HTTP Fixture 的生产 restricted-client URL/DNS/redirect/byte/cancel/resource 证据；无真实互联网请求。
- D00～D03 full regression、format check、build/smoke；默认 `data/` 不存在，无 SQLite/WAL/SHM/env/token 污染。
- Prompt 字节和 D02 LLM/D03 lifecycle 无改动。
- Secret 检查只读取本卡冻结 diff/candidate 的 Git tracked 变更路径及明确列出的合成 Fixture 文件；禁止读取 ignored/untracked 的 `config/prompt/user-context.md`、`node_modules`、数据库/DB/WAL/SHM 或其他私有目录，禁止以未限定路径的仓库级扫描代替。扫描证据只报告路径与计数，不输出命中正文；正常合成 Fixture 及测试断言中的保留域名 URL 不视为泄漏。
- 真实/敏感 URL、IP、正文、token 或底层异常信息不得进入公共错误 message、错误日志、快照或文档产物；该要求不要求删除测试中用于 URL 清洗/映射的正常合成 Fixture 断言。

Gate 只记 `D04_LOCAL_GATE=APPROVED`。即使本地 Gate PASS，仍保持 `D04_REMOTE_CI=NOT_RUN`、`D04_FINAL_PASS=NOT_ISSUED`。负责人另行授权 push 后，才能核验精确 SHA 的远程 CI；D03 push 授权不延伸。

### 9.3 最终验收包

每个 candidate 交回：

```text
任务 ID / 所属里程碑：D04-T01|T02|T03 / D04
前置任务及合并 SHA：<精确 SHA>
实际修改路径：<逐文件>
依赖差异：<name@version，或 NONE>
实现说明：<最多 5 行>
Case 映射：<COL-01/03/06/08/09/10/15/16 组件部分及新增契约测试>
执行证据：<typecheck/定向/full verify/diff-check 摘要>
输入快照与纯度：<测试名/PASS>
安全与资源：<SSRF/limit/cancel/cleanup 测试名/PASS>
已知限制：<真实互联网/D05/DB/server 均未接入>
Worker / Lead / Architect：REVIEW|APPROVED|BLOCKED + SHA
Worker 收尾：candidate↔merge blob 对照 PASS；branch/candidate 对齐；旧文档处置；clean；archive_workspace success=<true|false>
```

## 10. Plan 门禁结论

- 本 v0.4 只规划 D04，不新增替代任务 ID，不改变 G2 已批准的字段、决策表、网络规则或依赖版本；v0.1～v0.3 均为未批准修订轨迹，v0.4 修复 v0.3 G3 的四项定位阻塞并补齐交付/收尾门禁。
- 三卡均给出允许写集、能力边界、测试、命令、依赖和合并门禁；`T01/T02` 不会暴露不受保护的默认真实 HTTP。
- T02 不引入 jsdom/DOM lib/any；仅以单一窄 DOM boundary + 受控 capability assertions 处理 linkedom/Readability，且必须执行真实互操作 smoke。
- “调用入口同步快照可变输入”已在 §4.1、T01/T02 必测与最终验收包中形成可定位 PASS 证据。
- 当前下一步仅为计划评审。未获负责人执行批准前不创建 Worker；未获另行 push 授权不推送。
