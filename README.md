# PIS

PIS 是一个单进程、由 TypeScript 编写的个人 RSS 信息筛选服务。当前仓库包含 D00 的构建、测试、配置校验、日志、Bearer 鉴权、健康检查和进程生命周期基础设施，D01 的 SQLite 连接、冻结 schema、同步事务与 Event FTS 维护基础，D02-T01 的 Prompt 逐次读取基础，以及 D03 的 Source/Topic 配置 API。Prompt、RSS 抓取与调度尚未接入 HTTP 服务启动流程。

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

`npm run verify` 依次执行工具链校验、类型检查、单次测试、生产构建、真实进程 smoke 和格式检查；本地与 CI 共用此入口。可单独运行常用命令：

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npm run database:smoke
npm run format:check
npm run format
```

`npm run smoke` 会先重新构建，然后依次运行真实进程 smoke 和编译产物数据库 smoke。`npm run database:smoke` 要求先执行 `npm run build`，它核对 `src/database/schema.sql` 与 `dist/database/schema.sql` 字节一致，并从编译产物初始化临时数据库。`npm start` 不会隐式安装或编译，执行前必须已有 `dist/server.js`。格式工具只处理白名单内的工程文件；`docs/`、`通用规范/`、`config/`、Prompt、依赖、构建产物和临时文件不会被重写。

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

配置从进程环境变量读取，不自动加载 `.env` 文件。开发时可在当前 shell 中设置本地测试值：

```sh
export HOST=127.0.0.1
export PORT=3000
export API_TOKEN=local-test-token-change-me
export LOG_LEVEL=info
export DATABASE_PATH=./data/pis.sqlite
```

上例 Token 仅用于本地演示，不是生产秘密。

| 变量            | 默认值              | 约束                                                           |
| --------------- | ------------------- | -------------------------------------------------------------- |
| `HOST`          | `127.0.0.1`         | 非空且不能有首尾空白；无法绑定的地址会在启动时失败             |
| `PORT`          | `3000`              | 十进制整数，范围 `0`～`65535`；`0` 表示由操作系统分配端口      |
| `API_TOKEN`     | 无                  | 必填、非空且不能包含空白；没有开发默认 Token                   |
| `LOG_LEVEL`     | `info`              | `fatal`、`error`、`warn`、`info`、`debug`、`trace` 或 `silent` |
| `DATABASE_PATH` | `./data/pis.sqlite` | 非空且不能只有空白；相对路径按进程当前目录解析，父目录自动创建 |

显式空字符串不会使用默认值。配置错误时进程在监听前以非零状态退出，错误信息不包含配置原值。启动成功时日志会记录实际监听地址与端口；使用 `PORT=0` 时请以 ready 日志中的端口为准。

### 配置 API

`GET /api/sources`、`GET /api/topics` 返回 `{"items":[...]}`，包含停用配置并按 ID 升序排列。`GET /api/sources/:id`、`GET /api/topics/:id` 返回完整配置；`POST` 创建并返回 `201`；`PATCH` 更新并返回 `200`。所有配置端点都要求与 `/health` 相同的 `Authorization: Bearer <API_TOKEN>`，且不接受任何查询参数。

Source 创建字段为 `name`、`type`、`url`、`cron`，可选 `enabled`（缺省 `true`）和 `description`（缺省 `null`）；V1 的 `type` 只接受 `RSS`。Source 更新只接受 `name`、`cron`、`enabled`、`description`，至少一项；`type`、`url`、`id`、`last_collected_at` 不可修改，即使 PATCH 提交相同值也返回 `400`。`name` 和 Source 的 URL 不静默改写；`url` 只接受可解析的绝对 HTTP(S) URL，`cron` 只做五或六字段语法校验，不创建调度任务，也不执行抓取。

Topic 创建字段为 `name`、`description`，可选 `enabled`（缺省 `true`）；更新只接受 `name`、`description`、`enabled`，至少一项。名称与 Topic 描述必须包含非空白字符，服务保存原始字符串；Topic 更新及启停只写入 `topics`，不回溯、重算或发布历史关联。API 不提供删除。

非法 body、未知字段、空 PATCH、查询参数均返回 `400 {"error":"invalid_request"}`；不存在返回 `404 {"error":"not_found"}`；超过 1 MiB 返回 `413`，非 JSON 写入返回 `415`；SQLite busy/locked 返回 `503`，其他内部错误返回 `500`。无授权请求不会解析或写入配置。

默认数据库为 `./data/pis.sqlite`；可用 `DATABASE_PATH` 指向其他 SQLite 文件。服务启动时创建父目录并使用冻结 schema 初始化数据库，重启后保留配置。测试与真实进程 smoke 始终使用独立的临时数据库，不读取或污染默认 `data/` 路径。

### Chat Completions 调用配置

`createChatCompletionsClient()` 的 `endpoint`、`apiKey` 和 `model` 由调用方显式提供，不使用环境变量、默认 endpoint、默认密钥或默认模型。endpoint 必须使用 HTTP(S)，生产环境使用 HTTPS；HTTP 仅允许 `localhost`、`127.0.0.1` 或 `[::1]` 测试地址，且所有 endpoint 均禁止 userinfo。

客户端只发送一次非流式请求，不重试。默认总超时为 60 秒、响应上限为 2 MiB；错误和安全日志不包含 endpoint query、apiKey、model、Prompt、响应正文或底层 cause。

### Typed LLM calls

`createTypedLlmCalls()` 提供五个固定 operation 的强类型入口。每次调用在第一个异步等待前深拷贝任务数据和引用集合，只加载一次对应 Prompt、调用一次文本补全并执行一次严格响应校验；不重试、不修复、不缓存，也不访问数据库。

system 消息只包含本次读取的功能指令、固定标签和代码生成的输出 JSON Schema。其他四类 user 消息为 `{"task_data": ...}`，Knowledge Analysis 额外使用独立的 `user_context` 字段；动态任务数据不会成为消息角色、工具或请求配置。调用方可通过可选 `AbortSignal` 传递取消信号。

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

缺失、错误或格式非法的 Bearer 凭据返回 HTTP `401` 和 `{"error":"unauthorized"}`。`/health` 仅表示 HTTP 空服务可用，不表示数据库、队列、LLM 或 RSS 已就绪。未注册路径返回 HTTP `404`。

在运行 `npm start` 的终端按 Ctrl+C（`SIGINT`），或向进程发送 `SIGTERM`，服务会停止接收新请求、关闭监听资源并以成功状态退出。正常关闭最多等待 5 秒；失败或超时会以非零状态退出。

## 当前范围与未决项

D00 范围包括严格 TypeScript/ESM 构建、Vitest、Prettier、Fastify 健康端点、Pino 安全日志、环境配置校验和可测试的启停生命周期。D01 当前提供 better-sqlite3 连接、冻结 schema 初始化、同步事务基础、TEXT 时间存取和 Event FTS 刷新/重建基础。

当前包含 Source/Topic 配置 API，但不包含 RSS 抓取、调度执行、LLM 调用接入、任务队列、历史查询、匹配回填或发布 API。`/feeds/*` 尚未实现。

工程已配置 GitHub Actions，在拉取请求、推送到 `main` 和手动触发时执行与本地一致的门禁。**远程 CI 尚未实际运行，状态为 `NOT_RUN`；本地通过不能替代远程执行证据。**
