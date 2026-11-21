# 部署、PM2、备份与迁移

## 固定运行时

固定 Node.js `26.13.1`、npm `11.20.0`、PM2 `7.1.2`。安装前运行 `node --version`、`npm --version`、`npm run verify:toolchain`；使用 `npm ci`，不要用其他 npm 改写锁文件、不要使用 `npm install --force` 或修改 engines。构建必须先于启动：

```sh
npm ci
npm run build
npm run smoke:pm2
```

`ecosystem.config.cjs` 只有一个 `pis` fork 进程，实际命令等价于 `node dist/server.js`；`instances=1`、`watch=false`、`wait_ready=false`。当前应用没有 `process.send("ready")`，不得开启 ready 等待。应用优雅关闭预算为 5 秒，PM2 `kill_timeout=6000` ms，为其留出 IPC/进程退出余量。

## 私有环境与启动

服务不自动读取 `.env`。由服务管理器或受控 shell 在启动前加载私有 env，不把 Token、LLM key、真实公开随机目录写入 ecosystem、Git 或命令输出：

```sh
set -a
. /absolute/private/pis.env
set +a
npx pm2 start ecosystem.config.cjs --only pis
npx pm2 status
npx pm2 logs pis --lines 100
npx pm2 restart pis --update-env
npx pm2 stop pis
npx pm2 delete pis
```

使用仓库安装版本，不要求全局 PM2。`npm start` 仍是直接运行编译产物。新终端执行 restart 前必须加载同一私有 env 并使用 `--update-env`；不得将旧环境误当作密钥备份。

必填/可选配置见 README。生产保持 `RSS_SSRF_PROTECTION=true`。Pages 七项 `RSS_PAGES_*` 缺省不启用云发布；只有显式提供受控仓库等配置才启用。Pages 内容公开，随机目录不是访问控制。

## PM2 隔离 smoke

`npm run smoke:pm2` 假定已经 build。它只创建私有临时目录、临时 SQLite 和 loopback 端口，清除 Pages env，启动真实 PM2 fork 进程并检查鉴权/无鉴权健康响应、restart、stop、端口释放、日志敏感 sentinel 负断言和临时目录清理。不会读取或创建默认 `data/pis.sqlite`，不会访问真实 Pages。

smoke 使用独立 `PM2_HOME`，命令有界超时；结束时通过该目录的 PID 文件和限定路径的进程清单清理，必要时 SIGKILL，不依赖可能挂起的 `pm2 kill`。失败时保留私有诊断目录并只输出路径；应人工检查后清理。成功时目录删除。PM2 的 `online` 只表示 fork 状态，smoke 另等 Fastify 实际监听。

PM2 fork 通过动态 import 加载入口，`src/server.ts` 因此同时接受精确匹配的 `pm_exec_path`。普通 import 或无关 `pm_exec_path` 不启动服务。

## SQLite 一致性备份

优先在 `pm2 stop pis` 后复制数据库主文件，再启动；这是简单且一致的离线备份。若必须在线备份，使用 SQLite backup API 或 `sqlite3 ".backup ..."`，不要独立复制主文件和 WAL。若采用经过验证的文件系统快照，必须将主文件、`-wal`、`-shm` 纳入同一一致性快照并验证恢复。普通 `cp database.sqlite` 在 WAL 写入期间不构成备份。

恢复前停止服务，保留故障现场；把备份恢复到新的受控路径，运行应用初始化/只读检查及必要业务查询，再切换 `DATABASE_PATH`。不要把数据库、WAL/SHM、私有 env 或日志发布到 Pages。

## 新机器与 Pages 目录迁移

1. 安装精确工具链，`npm ci && npm run build`；准备同一私有 LLM/Prompt 配置及新的私有数据库路径。
2. 从一致性备份恢复 SQLite，保持 Published Item ID、`published_at` 和正文不变。
3. Pages 保持同一 repository、branch、public origin 和 public directory，订阅 URL 才不变。启动校准从现有 Published Item 重建/校验 head、pending 和缺失归档；不补造业务情报或额外任务。
4. 改变 public directory 会改变公开 URL，必须同时更新订阅入口。迁移保留未知文件和另一 Feed 的新目录资产，并清理旧根的 PIS 固定资产；完成真实匿名复验后才视为迁移验收。
5. sealed archive 按 Published Item 快照稳定生成；同名只能同 bytes 复用，内容漂移必须失败，不能覆盖旧档或 force push。

PM2 只管理进程，不提供 COMMIT 与下游入队之间的任务恢复、持久化队列或 Exactly-once。进程异常可能遗漏下游派发，这是 V1 已知窗口；不要把自动重启描述为业务恢复保证。

## 验收边界

`docs/milestones/D16/p0-coverage.md` 是确定性 P0 证据矩阵。`reader-acceptance.md` 保留真实阅读器/网络人工状态。真实模型报告、PM2 smoke、真实 Pages 自动检查和 RSS 阅读器行为是不同证据层，不能互相替代。
