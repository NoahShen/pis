# PIS

运维安装、PM2 启动、私有环境模板、上线验收、升级回滚和备份迁移见 **[`docs/deployment.md`](docs/deployment.md)**；可复制 `docs/deployment.env.example` 到仓库外作为私有环境模板。试运行问题复核与后续改造边界见 `docs/operations/runtime-improvement-review-2026-11-22.md`；LLM 响应超时与结构化输出复核见 `docs/operations/llm-timeout-structured-output-review-2026-11-22.md`。

PIS 是一个单进程、由 TypeScript 编写的个人 RSS 信息筛选服务。当前仓库包含 D00～D11 的业务基础，以及 D11A 的生产运行整合：真实 SQLite、共享依赖、六阶段 Service、Runtime、Cron Scheduler、配置 API 与进程生命周期由同一条生产装配链持有。D12 已实现本地静态 RSS 的显式同步与完整文件集（head/pending/封存归档），由 `createLocalRssSync` 显式调用；本 README 不把确定性 Stub/本地 Fixture 结果表述为真实 RSS + 真实 LLM 的端到端验收，也不把本地子集冒充 D13 云端与阅读器验收。

## 先决版本

工程固定使用以下精确二元组：

- Node.js `26.13.1`
- npm `11.20.0`

`.nvmrc` 与 `.node-version` 均记录 Node 版本。请在安装依赖前执行：

```sh
node --version
npm --version
npm run verify:toolchain
```

输出必须分别匹配 `v26.13.1` 和 `11.20.0`。`verify:toolchain` 会从当前 Node 安装来源定位 npm，并同时校验工程版本约束和锁文件版本。任一检查失败都必须停止，不得绕过门禁。不得用其他 npm 版本（包括本机可能存在的 npm 12）生成或改写 `package-lock.json`。

## 安装与验证

工具链门禁通过后，按锁文件安装并运行统一验证入口：

```sh
npm ci
npm run verify
```

`npm run verify` 依次执行工具链校验、类型检查、单次测试、生产构建、全部 smoke 和格式检查；`npm run smoke` 包含既有进程/配置 smoke、新增生产装配进程 smoke 与数据库 smoke。本地与 CI 共用此入口，不得通过跳过 smoke 降低门禁。可单独运行常用命令：

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:production
npm run database:smoke
npm run smoke:rss
npm run format:check
npm run format
```

`npm run smoke:production` 会先假定已执行 `npm run build`，再启动编译产物 `dist/server.js` 并显式使用独立的临时数据库、合成 LLM 配置、有效绝对 Prompt 目录、SSRF 防护开启和临时端口。它只验证 ready、Bearer 健康检查、SIGTERM 正常退出、schema、端口释放、临时库清理及敏感输出零命中，不调用真实 LLM，也不访问真实 RSS。`npm run database:smoke` 要求先执行 `npm run build`，它核对 `src/database/schema.sql` 与 `dist/database/schema.sql` 字节一致，并从编译产物初始化临时数据库。`npm start` 不会隐式安装或编译，执行前必须已有 `dist/server.js`。格式工具只处理白名单内的工程文件；`docs/`、`通用规范/`、`config/`、Prompt、依赖、构建产物和临时文件不会被重写。

## 数据库基础

冻结 DDL 的唯一权威来源是数据库设计文档；`src/database/schema.sql` 是可运行副本，并由测试校验其内容与文档唯一 SQL 代码块一致。`npm run build` 在 TypeScript 编译后只复制该 SQL 资源到 `dist/database/schema.sql`，生产模块从自身位置加载它，不依赖当前工作目录或 `docs/`。

`initializeDatabase(db)` 负责一次性建立冻结的 11 张业务表、显式索引和 `event_search` FTS5 表；连接级 WAL、外键与 busy timeout 在 DDL 事务前配置。该函数可对当前冻结结构重复执行并保留已有数据，但**不是迁移器**：它不升级或修复历史 schema。

`event_search` 是可丢弃重存的派生索引，不是业务事实。只能通过 `refreshEventSearch(db, eventId)` 刷新单个 Event，或通过 `rebuildEventSearch(db)` 全量重建；不要直接写入或依赖 SQL 触发器自动同步。后续业务事务修改 Event、Event Update 或确认 Entity alias 时，必须在同一短事务内显式调用刷新函数。D01 不提供自动挂接；索引构建失败时，业务事务与旧索引应一起回滚。

## Prompt 读取

`PromptRepository` 构造时必须收到部署显式指定的单一 Prompt 根目录。它不读取环境变量，不使用当前工作目录回退，也不自动探测其他目录。五类 operation 使用固定文件映射：

| Operation            | 功能指令                | User Context                       |
| -------------------- | ----------------------- | ---------------------------------- |
| `processing-route`   | `processing-route.md`   | 不读取                             |
| `event-search`       | `event-search.md`       | 不读取                             |
| `event-analysis`     | `event-analysis.md`     | 不读取                             |
| `knowledge-analysis` | `knowledge-analysis.md` | 从同一根目录读取 `user-context.md` |
| `topic-matching`     | `topic-matching.md`     | 不读取                             |

每次 `load()` 都重新以 UTF-8 读取本次需要的 Markdown，返回当次请求的原始文本快照；没有内存缓存、watcher 或旧值 fallback。文件修改会影响下一次读取，但不会改变已经返回的快照。Knowledge Analysis 先从同一根目录读取功能指令，再读取 User Context；其他 operation 不构造或读取 User Context 路径。文件缺失、不可读或只有空白内容时失败关闭，不发送空指令。

`config/prompts/user-context.md` 是公开固定测试使用的人工合成背景，不是真实用户配置。部署必须另行提供包含实际运行 Prompt 的单一根目录；D02-T01 不增加公开/私有双根目录、自动探测或 fallback。真实私有 `config/prompt/user-context.md` 由精确忽略规则排除，不进入公开仓库。

## 配置

配置从进程环境变量读取，不自动加载 `.env` 文件。生产启动的所有必填项必须在进程环境中显式提供；下面只演示合成/本地值，不是生产秘密：

```sh
export HOST=127.0.0.1
export PORT=3000
export API_TOKEN=local-test-token-change-me
export LOG_LEVEL=info
export DATABASE_PATH=./data/pis.sqlite
export PIS_LLM_ENDPOINT=https://llm.example.invalid/v1/chat/completions
export PIS_LLM_API_KEY=local-test-llm-key-change-me
export PIS_LLM_MODEL=local-test-model
export PROMPTS_DIR=/absolute/path/to/PIS/config/prompts
export RSS_SSRF_PROTECTION=true
export CRON_TIMEZONE=Asia/Shanghai
```

上例 Token、endpoint、key 和 model 仅用于本地演示，不是生产秘密。部署必须提供真实但受控的 HTTPS LLM endpoint、密钥和模型名，以及包含实际运行 Prompt 的单一目录。

| 变量                  | 默认值              | 约束                                                                             |
| --------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `HOST`                | `127.0.0.1`         | 非空且不能有首尾空白；无法绑定的地址会在启动时失败                               |
| `PORT`                | `3000`              | 十进制整数，范围 `0`～`65535`；`0` 表示由操作系统分配端口                        |
| `API_TOKEN`           | 无                  | 必填、非空且不能包含空白；没有开发默认 Token                                     |
| `LOG_LEVEL`           | `info`              | `fatal`、`error`、`warn`、`info`、`debug`、`trace` 或 `silent`                   |
| `DATABASE_PATH`       | `./data/pis.sqlite` | 非空且不能只有空白；相对路径按进程当前目录解析，父目录自动创建                   |
| `PIS_LLM_ENDPOINT`    | 无                  | 必填绝对 HTTP(S) URL；禁止 userinfo、query 和 fragment；生产环境应使用 HTTPS     |
| `PIS_LLM_API_KEY`     | 无                  | 必填非空；日志、错误和 smoke 输出不得回显                                        |
| `PIS_LLM_MODEL`       | 无                  | 必填；trim 后非空，且原文不能含首尾空白                                          |
| `PROMPTS_DIR`         | `config/prompts`    | resolve 为绝对路径；每个 Prompt operation 仍需在调用时从磁盘读取                 |
| `RSS_SSRF_PROTECTION` | `true`              | 只接受精确 `true` 或 `false`；默认拒绝私网/Fake-IP/loopback，线上必须保持 `true` |
| `CRON_TIMEZONE`       | `Asia/Shanghai`     | 非空；Scheduler 启动时用 `Intl.DateTimeFormat` 校验时区                          |

显式空字符串不会使用可选字段的默认值。`API_TOKEN` 与三项 `PIS_LLM_*` 缺失或非法时，进程在创建 app 前以非零状态退出；错误信息只包含字段路径和安全 reason，不回显 endpoint query、API key、model、Prompt 目录或输入原值。启动成功时日志只记录实际监听地址与端口；使用 `PORT=0` 时请以 ready 日志中的端口为准。

### 配置 API

`GET /api/sources`、`GET /api/topics` 返回 `{"items":[...]}`，包含停用配置并按 ID 升序排列。`GET /api/sources/:id`、`GET /api/topics/:id` 返回完整配置；`POST` 创建并返回 `201`；`PATCH` 更新并返回 `200`。所有配置端点都要求与 `/health` 相同的 `Authorization: Bearer <API_TOKEN>`，且不接受任何查询参数。

Source 创建字段为 `name`、`type`、`url`、`cron`，可选 `enabled`（缺省 `true`）和 `description`（缺省 `null`）；V1 的 `type` 只接受 `RSS`。Source 更新只接受 `name`、`cron`、`enabled`、`description`，至少一项；`type`、`url`、`id`、`last_collected_at` 不可修改，即使 PATCH 提交相同值也返回 `400`。`name` 和 Source 的 URL 不静默改写；`url` 只接受可解析的绝对 HTTP(S) URL，`cron` 只做五或六字段语法校验，不创建调度任务，也不执行抓取。

**采集检查点与去重边界**：`last_collected_at` 会在一次 Collection 成功持久化后写为本次采集开始时间，并在下一次调用 `fetchEntries(source, lastCollectedAt)` 时传给 Adapter，供运维观察和未来的增量协议使用。**当前 RSS Adapter 明确不使用它过滤 Feed 条目**，仍读取并返回 Feed 中的候选条目；最终去重由 Source Item 身份保证：优先 `source_id + external_id`，无 external ID 时使用 `source_id + url + published_at`。因此当前不存在“只抓取检查点之后文章”的时间增量语义，也不能用该字段代替 GUID/URL 去重；文章缺少时间、时间回拨或同 GUID 修改正文时，仍须依靠持久化身份边界。

Topic 创建字段为 `name`、`description`，可选 `enabled`（缺省 `true`）；更新只接受 `name`、`description`、`enabled`，至少一项。名称与 Topic 描述必须包含非空白字符，服务保存原始字符串；Topic 更新及启停只写入 `topics`，不回溯、重算或发布历史关联。API 不提供删除。

非法 body、未知字段、空 PATCH、查询参数均返回 `400 {"error":"invalid_request"}`；不存在返回 `404 {"error":"not_found"}`；超过 1 MiB 返回 `413`，非 JSON 写入返回 `415`；SQLite busy/locked 返回 `503`，其他内部错误返回 `500`。无授权请求不会解析或写入配置。

默认数据库为 `./data/pis.sqlite`；可用 `DATABASE_PATH` 指向其他 SQLite 文件。服务启动时创建父目录并使用冻结 schema 初始化数据库，重启后保留配置。测试与真实进程 smoke 始终使用独立的临时数据库，不读取或污染默认 `data/` 路径。

### 历史查询 API

D14 提供只读历史查询，所有端点都要求 `Authorization: Bearer <API_TOKEN>`，与配置 API 使用同一 Token。RSS 仍是静态文件，不提供 `/feeds/...` 动态查询或凭据赋权。

| 路由                                                         | 用途                                          |
| ------------------------------------------------------------ | --------------------------------------------- |
| `GET /api/topics/:id/items`                                  | Topic 已关联的 Event、Event Update、Knowledge |
| `GET /api/events` / `GET /api/events/:id`                    | Event 列表、详情及全量 Updates 和证据 Content |
| `GET /api/events/:id/updates` / `GET /api/event-updates/:id` | 指定 Event 的 Updates、单个 Update            |
| `GET /api/knowledge` / `GET /api/knowledge/:id`              | Knowledge 列表、详情及 Content                |
| `GET /api/contents/:id`                                      | Content、Source Item 与 Source 来源链（可空） |
| `GET /api/published-items` / `GET /api/published-items/:id`  | 不可变发布快照、来源 target 与 Topics         |

列表统一返回 `{"items":[...],"next_cursor":string|null}`。`limit` 为 1～200 的十进制整数，默认 50；翻页时原样传入 `next_cursor`，且必须保留原过滤条件。Topic items 和 Published Items 支持 `target_type=EVENT|EVENT_UPDATE|KNOWLEDGE`；Published Items 还支持带 `Z` 或明确 offset 的 `published_after`、`published_before` 闭区间时间过滤。其他未定义、重复或非法参数均返回 `400`。

例如：

```sh
curl --fail-with-body \
  --header 'Authorization: Bearer local-test-token-change-me' \
  'http://127.0.0.1:3000/api/events?limit=20'

curl --fail-with-body \
  --header 'Authorization: Bearer local-test-token-change-me' \
  'http://127.0.0.1:3000/api/published-items?target_type=EVENT&published_after=2026-01-01T00%3A00%3A00Z&limit=20'
```

查询只读取既有 Content、关联和发布快照，不补抓来源、不现场匹配 Topic、不重渲染 Published Item，也不启动 Collection、分析或发布。非法请求返回 `400 {"error":"invalid_request"}`，对象不存在返回 `404 {"error":"not_found"}`，无/错 Bearer 返回 `401 {"error":"unauthorized"}`。错误响应不包含 SQL、堆栈、Token、配置秘密或内部绝对路径；查询可在 `PRAGMA query_only=ON` 的连接上执行，测试仅使用隔离临时数据库或其副本。

### Chat Completions 调用配置

`createChatCompletionsClient()` 的 `endpoint`、`apiKey` 和 `model` 由调用方显式提供，不使用环境变量、默认 endpoint、默认密钥或默认模型。endpoint 必须使用 HTTP(S)，生产环境使用 HTTPS；HTTP 仅允许 `localhost`、`127.0.0.1` 或 `[::1]` 测试地址，且所有 endpoint 均禁止 userinfo。

客户端只发送一次非流式请求，不重试。默认总超时为 60 秒、响应上限为 2 MiB；错误和安全日志不包含 endpoint query、apiKey、model、Prompt、响应正文或底层 cause。

### Typed LLM calls

`createTypedLlmCalls()` 提供五个固定 operation 的强类型入口。每次调用在第一个异步等待前深拷贝任务数据和引用集合，只加载一次对应 Prompt、调用一次文本补全并执行一次严格响应校验；不重试、不修复、不缓存，也不访问数据库。

system 消息只包含本次读取的功能指令、固定标签和代码生成的输出 JSON Schema。其他四类 user 消息为 `{"task_data": ...}`，Knowledge Analysis 额外使用独立的 `user_context` 字段；动态任务数据不会成为消息角色、工具或请求配置。调用方可通过可选 `AbortSignal` 传递取消信号。

### RSS Adapter 的受限 HTTP 策略

`createRssAdapter()` 默认使用受限 transport；需要测试或复用解析层时可注入 `RssTransport`。`httpPolicy` 的六个字段及默认值如下，超出范围会直接拒绝配置：

| 字段                  |    默认值 |          允许范围 |
| --------------------- | --------: | ----------------: |
| `requestTimeoutMs`    |   `15000` | `100`–`120000` ms |
| `maxRedirects`        |       `3` |           `0`–`5` |
| `feedMaxBytes`        | `2097152` |  `1024`–`8388608` |
| `articleMaxBytes`     | `5242880` | `1024`–`16777216` |
| `maxFeedEntries`      |    `1000` |       `1`–`10000` |
| `articleMinTextChars` |      `80` |        `1`–`1000` |

一次 feed 或 article 获取共用一个总超时预算，重定向不会重置预算；相对重定向会重新执行 URL、DNS 和公网地址校验，HTTPS 不得降级到 HTTP。DNS 必须返回全部公网地址，连接固定到已校验的单个地址，不读取代理环境变量，也不修改 Node 全局 dispatcher。响应只接受 RSS/XML 或 article HTML 的受支持字符集和内容编码，并在原生 fetch 解压后的流式字节上限处取消；Content-Length 仅用于在读取前提前拒绝明显超限的响应。

`RSS_SSRF_PROTECTION` 默认且线上必须为 `true`。显式设置 `RSS_SSRF_PROTECTION=false` 只跳过解析地址范围中的私网、loopback、link-local、reserved、unspecified/Fake-IP 拒绝，仍保留 scheme、userinfo、localhost 名称、非默认端口、逐跳 DNS 固定、redirect、HTTPS 降级、超时、大小、MIME/charset/encoding 和取消限制。关闭启动时只记录一次安全 `rss_ssrf_protection_disabled` 警告，不包含 URL、IP、Header 或正文；不得在线上使用该配置。

Content-Encoding 白名单支持单值 `identity`、`gzip`、`x-gzip`、`deflate`、`br` 与 Node 26 原生 `zstd` 解压路径；未知或多值编码仍拒绝。zstd 支持但只保证解压后大小上限，不宣称限制网络上的压缩字节数；不得用 `arrayBuffer()` 绕过上限或取消。

每次逻辑请求单独拥有 undici `Agent`；成功流正常关闭，失败、超限、超时和取消路径会取消 reader、解绑调用方 signal、清除计时器并销毁 dispatcher。调用方取消与内部超时会保持不同的错误原因。受限 HTTP 内部不进入公共 adapter API。

## 启动、健康检查与关闭

先构建并启动：

```sh
npm run build
npm start
```

在另一个终端使用与 `API_TOKEN` 相同的本地测试 Token 请求健康检查：

```sh
curl --fail-with-body \
  --header 'Authorization: Bearer local-test-token-change-me' \
  http://127.0.0.1:3000/health
```

成功响应为：

```json
{ "status": "ok" }
```

缺失、错误或格式非法的 Bearer 凭据返回 HTTP `401` 和 `{"error":"unauthorized"}`。生产启动会先初始化临时或部署数据库，创建单一共享 Clock/ID/Prompt/LLM 依赖、六阶段 Service、Runtime 与 Scheduler；Fastify ready 时启动 Runtime，listen 成功后启动 Scheduler。`/health` 只表示 HTTP 可用，不主动调用 LLM/RSS；未注册路径返回 HTTP `404`。

在运行 `npm start` 的终端按 Ctrl+C（`SIGINT`），或向进程发送 `SIGTERM`，服务会停止接收新请求，并按 Scheduler stop → Runtime 排空/取消 → HTTP 关闭 → SQLite 关闭的顺序释放资源。单个清理失败不会跳过后续资源关闭；最终 close 以稳定错误反映聚合失败，重复 close 保持幂等。正常关闭最多等待 5 秒；失败或超时会以非零状态退出。

## PM2 部署

生产可使用锁文件固定的 PM2 `7.1.2`。`ecosystem.config.cjs` 只启动一个 fork 进程，执行 `node dist/server.js`，不启用 watch/cluster，也不伪造 ready 协议：`wait_ready=false`。`kill_timeout=6000` ms，为应用 5 秒优雅关闭预算预留退出余量。

```sh
npm ci
npm run build
npx pm2 start ecosystem.config.cjs --only pis
npx pm2 restart pis --update-env
npx pm2 logs pis --lines 100
npx pm2 stop pis
npx pm2 delete pis
```

启动前必须由受控 shell/服务管理器提供私有 env；ecosystem 不保存 Token、LLM key 或 Pages 私密配置。restart 使用 `--update-env` 时同样需要加载预期环境。`npm run smoke:pm2` 在 build 后使用临时 DB、端口、env 和独立 `PM2_HOME`，验证健康鉴权、restart/stop、端口释放、日志脱敏及清理，默认清除 Pages env，不接触默认库或正式 Feed。

部署、SQLite 一致性备份、新机器/Pages 目录迁移和 sealed 不改写规则见 [docs/deployment.md](docs/deployment.md)。PM2 自动重启不承诺任务恢复或 Exactly-once。

## 当前范围与未决项

D00～D11 已提供工程、数据库、Prompt/LLM、配置、RSS Adapter、Collection、Processing、Event、Knowledge、Topic Matching 与 Published Item 基础。D11A 已把真实六阶段 Service、共享依赖、Runtime、Scheduler、配置 API、数据库和启停所有权装配到编译后生产入口；确定性 `ASM-05_INTEGRATION` 使用真实临时 SQLite、本地受限 HTTP Fixture 与 Stub LLM 完成 `COLLECT → PROCESS → KNOWLEDGE_ANALYSIS → TOPIC_MATCHING → PUBLISH`。这些证据只覆盖 ASM-01～ASM-07，不等于 D16、S0/S1 或真实双 RSS + 测试 LLM 的 E2E 通过。

D12 已实现**本地静态 RSS 生成与归档**。`createLocalRssSync({ reader, outputDirectory })` 显式把两类 Published Item 快照写成完整静态文件集：`event-updates.xml`（`EVENT` + `EVENT_UPDATE`）与 `curated-content.xml`（`KNOWLEDGE`）。每份 Feed 固定主窗口 `200`、封存批次 `200`，产出根级 `<feed>.xml`（主文件）、`<feed>-pending.xml`（pending）与 `archive/<feed>-NNNN.xml`（封存归档）。

主文件是普通 RSS document，不含 `<fh:archive/>`；pending 是可重建的 RFC 5005 archive document，包含 `<fh:archive/>`，按 `(published_at ASC, id ASC)` 渲染当前全部 `0～199` 条未封存余量，可随快照原子替换，但它**不是**满 200 条的不可变封存批次，也不是业务队列或 Outbox；满 200 条的封存归档同样包含 `<fh:archive/>`，只创建/校验、不重写。静态链固定为 `head → pending → archive(N) → … → archive0001`，链接均为同一输出根内的规范相对 URI，不含 `?before` 游标。主文件、pending 与封存归档按 GUID 去重覆盖数据库当前全集，主文件与 pending/归档允许 GUID 重叠，封存归档彼此不重叠；同名封存冲突会停止该 Feed 的 pending/head 更新并保留旧文件。

D12 当时仅提供显式本地同步，自动通知与云端上传尚未实现；D13 现已实现可选 GitHub Pages 发布适配器及生产通知/启动校准接线。每次 Feed 发布在远端 `main` 当前版本上产生一个完整文件集 commit，保留另一 Feed 的公开文件，不使用 force push；只有公开 origin 字节匹配才返回已验证。缺省仍不启用云发布，也不提供 HTTP Feed GET 路由或 Feed Token。`npm run smoke:rss` 与 `npm run smoke:pages` 使用本地临时远端/origin 验证静态文件、双 Feed、归档和 `.nojekyll`，不替代真实 GitHub Pages/阅读器验收。D14 才提供历史查询 API；真实 RSS/LLM 验证不进入 CI/P0，必须另行执行 `ASM-08_REAL_E2E`。

Pages 通过七项可选环境变量配置：`RSS_PAGES_REPOSITORY`（SSH 仓库，启用必填）、`RSS_PAGES_BRANCH`（默认 `main`）、`RSS_PAGES_WORK_DIRECTORY`（默认 `data/rss-pages`，staging 位于其 `staging/`，独立于业务数据库）、`RSS_PAGES_PUBLIC_ORIGIN`（默认 `https://noahshen.github.io/pis_publish`）、`RSS_PAGES_PUBLIC_DIRECTORY`（默认空，即站点根目录；非空须为 `1～128` 个字母、数字、`_`、`-` 组成的单层目录，非法值拒绝而不清洗）、`RSS_PAGES_PUBLISH_TIMEOUT_MS`（默认 `120000`）及 `RSS_PAGES_POLL_INTERVAL_MS`（默认 `5000`）。订阅 URL 为公开 origin、可选目录前缀及固定文件名，例如配置固定示例目录 `example_feed` 后为 `<origin>/example_feed/event-updates.xml` 与 `<origin>/example_feed/curated-content.xml`；归档位于该目录的 `archive/`。Git 目标路径与匿名验证 URL 使用同一前缀，D12 文件集 key、XML 正文和 head/pending/archive 相对链接均不改写；缺省目录保持原有根目录行为。

从根目录迁入公开目录时，同一 Git 版本清理根目录旧 PIS 的固定 head/pending/archive 及根 `.nojekyll`；未知文件、其他目录以及另一 Feed 已写入新目录的资产保留，不清空仓库或替换整个远端 tree。启动时在 Scheduler 前校准两类 Feed，可从现有 Published Item 补齐缺失/陈旧公开文件；non-fast-forward 或部署超时安全失败，后续通知或重启会重试。Git 推送不接受 non-FF，公开 origin 禁止重定向且响应有界。Pages 内容完全公开，**随机路径不是访问控制**；不得用目录名保护秘密。数据库、WAL、日志、配置、密钥和其他隐藏文件不会进入公开资产。

工程已配置 GitHub Actions，在拉取请求、推送到 `main` 和手动触发时执行与本地一致的门禁。**远程 CI 尚未实际运行，状态为 `NOT_RUN`；本地通过不能替代远程执行证据。**
