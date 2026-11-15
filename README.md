# PIS

PIS 是一个单进程、由 TypeScript 编写的个人 RSS 信息筛选服务。当前仓库处于 D00「工程骨架」阶段，只提供构建、测试、配置校验、日志、Bearer 鉴权、健康检查和进程生命周期基础设施。

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
npm run format:check
npm run format
```

`npm run smoke` 会先重新构建。`npm start` 不会隐式安装或编译，执行前必须已有 `dist/server.js`。格式工具只处理白名单内的工程文件；`docs/`、`通用规范/`、`config/`、Prompt、依赖、构建产物和临时文件不会被重写。

## 配置

配置从进程环境变量读取，不自动加载 `.env` 文件。开发时可在当前 shell 中设置本地测试值：

```sh
export HOST=127.0.0.1
export PORT=3000
export API_TOKEN=local-test-token-change-me
export LOG_LEVEL=info
```

上例 Token 仅用于本地演示，不是生产秘密。

| 变量        | 默认值      | 约束                                                           |
| ----------- | ----------- | -------------------------------------------------------------- |
| `HOST`      | `127.0.0.1` | 非空且不能有首尾空白；无法绑定的地址会在启动时失败             |
| `PORT`      | `3000`      | 十进制整数，范围 `0`～`65535`；`0` 表示由操作系统分配端口      |
| `API_TOKEN` | 无          | 必填、非空且不能包含空白；没有开发默认 Token                   |
| `LOG_LEVEL` | `info`      | `fatal`、`error`、`warn`、`info`、`debug`、`trace` 或 `silent` |

显式空字符串不会使用默认值。配置错误时进程在监听前以非零状态退出，错误信息不包含配置原值。启动成功时日志会记录实际监听地址与端口；使用 `PORT=0` 时请以 ready 日志中的端口为准。

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

D00 当前范围包括严格 TypeScript/ESM 构建、Vitest、Prettier、Fastify 健康端点、Pino 安全日志、环境配置校验和可测试的启停生命周期。

当前不包含数据库、业务 API、RSS 抓取、LLM 调用、任务队列、Prompt 加载或 PM2 部署配置。`/api/*` 和 `/feeds/*` 尚未实现。

Prompt 目录与权威设计当前存在待对齐项：现有目标路径为 `config/prompts/`，而设计文档使用 `config/prompt/`。该事项由 D02-T01 前处理，D00 不修改 Prompt。

工程已配置 GitHub Actions，在拉取请求、推送到 `main` 和手动触发时执行与本地一致的门禁。**远程 CI 尚未实际运行，状态为 `NOT_RUN`；本地通过不能替代远程执行证据。**
