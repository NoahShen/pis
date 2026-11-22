# PIS V1 运维部署手册

> 适用对象：负责安装、启动、升级和巡检 PIS 的运维 Agent/人员。
>
> 交付形态：单 Linux 主机、单 PM2 fork 进程、SQLite、GitHub Pages 静态 RSS。
>
> 本文不包含真实 Token、密钥、私有 User Context 或实际随机 RSS 目录；尖括号内容必须由运维替换。

## 1. 固定版本与部署前提

| 项目 | 固定值/要求 |
|---|---|
| Node.js | `26.13.1` |
| npm | `11.20.0` |
| PM2 | 仓库锁定 `7.1.2`，不要求全局安装 |
| 服务 | 单进程，`127.0.0.1:3000` 默认仅监听本机 |
| 数据库 | SQLite WAL，默认 `./data/pis.sqlite` |
| 进程管理 | `ecosystem.config.cjs`，fork、1 instance、无 watch/cluster |
| 云发布 | 可选 GitHub Pages；缺省不启用 |
| 不支持 | 多实例共享 SQLite、PM2 cluster、任务崩溃后 Exactly-once 恢复 |

准备：

1. 一台可访问 LLM HTTPS endpoint、目标 RSS 和 GitHub SSH 的主机。
2. 精确 Node/npm；不得为绕过 `EBADDEVENGINES` 修改 engines 或使用 `npm --force`。
3. 私有 API Token、LLM endpoint/key/model、实际 Prompt 根目录。
4. 可选：GitHub Pages 仓库的 SSH 写权限和已启用 Pages。
5. 部署、数据库、Pages workdir、私有 env 分目录规划，并限制权限。

建议目录（可按运维规范调整）：

```text
/srv/pis/app                  # Git 工作区
/srv/pis/data                 # SQLite 与 Pages workdir
/srv/pis/prompts              # 实际 Prompt + User Context
/etc/pis/pis.env              # 私有环境，chmod 600
```

## 2. 获取代码与安装校验

```sh
cd /srv/pis
# 首次：git clone git@github.com:NoahShen/pis.git app
# 升级：cd app && git fetch origin && git checkout <经批准的完整SHA>
cd app

node --version                 # 必须 v26.13.1
npm --version                  # 必须 11.20.0
npm run verify:toolchain
npm ci
npm run verify
npm run smoke:pm2
```

`verify` 包含类型检查、全部测试、构建、默认 smoke 和格式检查。任一失败停止部署，不得跳过 smoke 直接上线。`smoke:pm2` 使用隔离临时数据库/PM2_HOME/端口，不读取默认库，不访问真实 Pages；失败目录须人工检查后清理。

## 3. 准备私有环境

仓库提供 `docs/deployment.env.example`，只含字段和合成示例。复制到仓库外并填写真实值：

```sh
install -m 600 docs/deployment.env.example /etc/pis/pis.env
chmod 600 /etc/pis/pis.env
```

应用**不会自动读取 `.env`**。每次启动/重启前在同一 shell 加载：

```sh
set -a
. /etc/pis/pis.env
set +a
```

必填：

- `API_TOKEN`：高强度独立 Bearer Token，不能沿用示例。
- `PIS_LLM_ENDPOINT`：受控 HTTPS Chat Completions URL，无 userinfo/query/fragment。
- `PIS_LLM_API_KEY`、`PIS_LLM_MODEL`。
- `PROMPTS_DIR`：实际 Prompt 根目录，包含五个功能 Markdown 和 `user-context.md`；不得使用合成背景冒充真实配置。
- `DATABASE_PATH`：建议绝对持久路径。
- `RSS_SSRF_PROTECTION=true`：生产必须保持 true。

不要把真实 env、数据库、Prompt/User Context、日志或完整随机订阅 URL 提交到 Git。`PIS_LLM_ENDPOINT`、Token 和 key 不出现在验收报告中。

五类 LLM operation 可独立覆盖配置，前缀分别为 `PIS_LLM_PROCESSING_ROUTE`、`PIS_LLM_EVENT_SEARCH`、`PIS_LLM_EVENT_ANALYSIS`、`PIS_LLM_KNOWLEDGE_ANALYSIS`、`PIS_LLM_TOPIC_MATCHING`。每类支持 `_ENDPOINT`、`_API_KEY`、`_MODEL`，缺省继承全局三项；也支持 `_FIRST_BYTE_TIMEOUT_MS`、`_IDLE_TIMEOUT_MS`、`_TOTAL_TIMEOUT_MS`、`_MAX_RESPONSE_BYTES`、`_MAX_ATTEMPTS`、`_RETRY_DELAY_MS`、`_RETRY_TOTAL_BUDGET_MS`。完整默认值、范围和合成示例见 [README 的五类流式 LLM operation 配置](../README.md#五类流式-llm-operation-配置)。只配置需要独立调整的 operation，不要在文档或 PM2 日志中复制真实密钥、endpoint 或 model。

生产请求使用流式 SSE。首包预算只计算到首个有效数据包，空闲预算约束有效数据包之间的间隔，单次总预算是绝对上限；重试总预算覆盖首次、退避与第二次，不能靠设置更大的单次超时绕过。重试延迟可取消并计入 drain/shutdown。上线调参先按 operation 观察安全首包/Content/总耗时，逐类调整；不要把五类同时盲目加时，不要提高 Runtime 并发，也不要把 HTTP 200 当作 Schema/引用成功。Client 不会在流式失败后静默改用非流式。

自主验收脚本只支持离线自测或显式真实模式：

```sh
npm run build
node scripts/llm-streaming-acceptance.mjs --self-test
node scripts/llm-streaming-acceptance.mjs \
  --env-file /absolute/private/llm.env \
  --output /absolute/private/ops-02-streaming-report.json
```

真实模式必须由有授权的审核者在独立私有环境执行；本示例不会自动执行，也不读取应用 `.env`。脚本使用自主合成输入，不读取真实 Source 或 User Context。安全报告与同目录 `.raw.sse.jsonl` 均写入仓库外并设为 600，raw 包含原始 SSE，严禁提交、转发或贴入报告。stdout 与公开验收记录只允许 operation、计数、耗时和安全分类，不包含 model、endpoint、Prompt、正文或秘密。生产 6 Source 部署复验是负责人另行执行的独立步骤，不能由离线自测或五类合成真实调用替代。

## 4. 可选 GitHub Pages 配置

不配 `RSS_PAGES_*` 时服务只运行业务与 JSON API，不启用云发布。启用时至少配置 `RSS_PAGES_REPOSITORY`，其余按需覆盖：

```sh
RSS_PAGES_REPOSITORY=git@github.com:<OWNER>/<REPO>.git
RSS_PAGES_BRANCH=main
RSS_PAGES_WORK_DIRECTORY=/srv/pis/data/rss-pages
RSS_PAGES_PUBLIC_ORIGIN=https://<OWNER>.github.io/<REPO>
RSS_PAGES_PUBLIC_DIRECTORY=<单层随机目录>
RSS_PAGES_PUBLISH_TIMEOUT_MS=120000
RSS_PAGES_POLL_INTERVAL_MS=5000
```

约束：

- 使用系统 Git/SSH；PIS 不保存私钥。部署账号必须有仓库写权限，禁止 force push。
- 公开目录为空表示仓库根目录；非空仅一层、1～128 位 `[A-Za-z0-9_-]`。
- 同一公开目录对应固定订阅 URL；修改目录会改变订阅地址并触发旧根 PIS 资产清理，必须另行验收。
- Pages 公开仓库中的文件树/历史可被浏览，随机目录不是访问控制。
- 启动会依次校准 `EVENT_UPDATES → CURATED_CONTENT`，再启动 Scheduler；真实 Pages 下可能需要数十秒或超过两分钟，取决于 `RSS_PAGES_PUBLISH_TIMEOUT_MS`。Fastify 外层不另加 10 秒截断，但 Publisher 自身预算仍有界。
- 启动校准失败会使生产启动失败并清理资源；不要通过关闭校验或伪造匿名 200 绕过。
- `.nojekyll` 匿名 404 可接受，但必须是已提交 Git tree 中的零字节对象；其他 XML 必须匿名 bytes 匹配。

## 5. PM2 启动与日常操作

先构建，再在加载私有 env 的同一 shell 执行：

```sh
cd /srv/pis/app
npm run build
npx pm2 start ecosystem.config.cjs --only pis
npx pm2 status
```

配置语义：单 fork、`node dist/server.js`、`wait_ready=false`、`kill_timeout=6000`、`autorestart=true`。应用自身优雅关闭预算为 5 秒。PM2 的 `online` 不等于 Fastify 已监听，必须执行健康检查。

```sh
# 查看日志；避免将含敏感内容的日志贴入公共报告
npx pm2 logs pis --lines 100

# 重启前重新加载最新私有 env
npx pm2 restart pis --update-env

npx pm2 stop pis
npx pm2 start ecosystem.config.cjs --only pis
npx pm2 delete pis   # 仅从 PM2 删除，不删除数据库
```

新终端不会继承之前 shell 的秘密；重启前必须重新加载 env。`pm2 save`/`pm2 resurrect` 只保存进程定义，不保存私有 env、SQLite 事务或 Runtime 队列。

## 6. 上线验收

假设 `HOST=127.0.0.1`、`PORT=3000`：

```sh
curl --fail-with-body \
  -H "Authorization: Bearer ${API_TOKEN}" \
  http://127.0.0.1:3000/health
# 期望：{"status":"ok"}

curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
# 期望：401
```

继续检查：

1. `npx pm2 status` 只有一个 `pis` 进程，无重复实例。
2. `DATABASE_PATH` 指向预期持久库；未误用仓库默认/临时数据库。
3. 按 README 创建/检查 Source 与 Topic；Source URL 创建后不可修改，Cron 只调度 enabled Source。
4. 查询 `GET /api/events`、`GET /api/knowledge`、`GET /api/published-items` 验证只读 API。

### 采集检查点的当前语义

`sources.last_collected_at` 是成功采集后的检查点，由 Collection 在 Source Item 持久化的同一事务中写入本次采集开始时间；下一次采集会把它传给 `fetchEntries(source, lastCollectedAt)`。**当前 RSS Adapter 不使用该值过滤条目**，不要根据这个字段推断“只下载了增量文章”或用它做采集完整性校验。

当前正确性由数据库中的 Source Item 身份去重保证：优先 `source_id + external_id`，无 external ID 时使用 `source_id + url + published_at`。检查点主要用于运维观察和 Adapter 将来的增量协议扩展；缺发布时间、时钟回拨、同 GUID 修改正文等场景仍必须保留身份去重。

5. 如启用 Pages，检查双 Feed 匿名 XML 与本地文件 bytes；必要时运行：
   `node scripts/pages-acceptance.mjs --origin <公开origin> --directory <公开目录>`，输出只能进入脱敏报告。
6. `npx pm2 restart pis --update-env` 后健康检查恢复；`npx pm2 stop pis` 后端口释放。
7. 检查日志不含 Token、LLM key、正文、完整私有 URL 或 User Context。

真实阅读器、离线缓存、真实超 200 条历史与中国大陆网络是独立 P1 人工验收，不得由 health 200 或 PM2 online 代签。

## 7. 升级与回滚

升级前：

1. 记录当前完整 Git SHA 和数据库一致性备份。
2. `npx pm2 stop pis`。
3. 备份 SQLite（见下节），保留旧代码工作区或精确 SHA。
4. `git fetch origin && git checkout <新完整SHA>`。
5. 执行固定版本检查、`npm ci`、`npm run verify`、构建和 PM2 smoke。
6. 重新加载私有 env，`npx pm2 start ecosystem.config.cjs --only pis`，完成上线验收。

回滚：

1. 停止服务，保留故障日志和数据库现场。
2. 回退到旧精确 SHA，`npm ci && npm run build`。
3. 如新版本未变更 schema，可使用当前库；当前 V1 没有自动迁移器，不得对历史库手工“修复”schema。
4. 如需恢复数据，使用升级前一致性备份到新路径，完成只读检查后切换 `DATABASE_PATH`。
5. 启动并复验；不得 force push Pages 来掩盖回滚或归档冲突。

## 8. SQLite 备份与恢复

优先离线备份：

```sh
npx pm2 stop pis
# 在一致停止点复制 DATABASE_PATH 主文件到受控备份目录
npx pm2 start ecosystem.config.cjs --only pis
```

在线备份必须使用 SQLite backup API 或 `sqlite3 ".backup ..."`；WAL 写入期间普通 `cp` 主文件不构成一致性备份。文件系统快照须将主文件、`-wal`、`-shm` 纳入同一快照并验证恢复。

恢复前停止服务，将备份恢复到新的受控路径，完成初始化/只读查询后再切换配置。数据库、WAL/SHM、备份和私有 env 权限应限制为服务账号，绝不上传 Pages。

## 9. 新机器迁移与 Pages 校准

1. 安装精确工具链，恢复一致性 SQLite 备份，保持 Published Item ID/时间/正文不变。
2. 配置相同 LLM/Prompt、Pages repository/branch/origin/public directory，订阅 URL 才能不变。
3. 启动校准会重建/校验 head、pending 和缺失 archive，不补造业务情报、不新增第七种任务。
4. 同名 sealed 只允许同 bytes 复用；漂移必须停止并排查，禁止覆盖历史。
5. non-fast-forward 必须拒绝，禁止 force push；push 成功不是公开成功，匿名 origin bytes 匹配才是。
6. 改变公开目录需要更新阅读器订阅，并复验旧根清理、未知文件和另一 Feed 保留边界。

PM2 自动重启不恢复 COMMIT 与下游入队之间的窗口，不提供持久化队列、Outbox 或 Exactly-once。

## 10. 常见故障

| 现象 | 处理 |
|---|---|
| `EBADDEVENGINES` | 安装精确 Node/npm；不得 force 或改 engines |
| PM2 online 但健康失败 | 检查实际 Fastify 监听、私有 env、端口与日志；确认代码含精确 `pm_exec_path` 入口支持 |
| 启动长期 Pages 校准 | 查看 Git/SSH、Pages 部署和匿名 XML；受 `RSS_PAGES_PUBLISH_TIMEOUT_MS` 有界控制，不擅改 Fastify 默认值 |
| `.nojekyll` 404 | 检查远端 Git tree 零字节对象；不要把它与 XML 404 混同 |
| Pages non-fast-forward | 保留远端，诊断并发/历史；禁止 force push |
| sealed 同名冲突 | 停止发布，核对 Published Item 快照与旧 bytes；不得重写历史 |
| PM2 stop 后端口未释放 | 检查优雅关闭日志和 5 秒应用/6 秒 PM2 预算，定位残留进程；不要直接杀无关 PM2 daemon |
| LLM/Schema 错误 | 记录安全原因和任务 ID；不要输出 Prompt、正文或密钥；真实模型允许有限格式波动 |

## 11. 运维交付回报模板

```text
部署 SHA：
Node/npm/PM2 版本：
npm run verify：PASS/FAIL
PM2 smoke：PASS/FAIL
健康检查/无鉴权 401：PASS/FAIL
数据库路径确认与备份位置（私有）：PASS/FAIL
Pages 未启用 / 自动验收结果：
重启与停止端口释放：PASS/FAIL
日志敏感信息负断言：PASS/FAIL
遗留问题与人工 RSS 验收：
```

完整技术边界见 `README.md`；P0 证据见 `docs/milestones/D16/p0-coverage.md`；真实阅读器状态见 `docs/milestones/D16/reader-acceptance.md`。
