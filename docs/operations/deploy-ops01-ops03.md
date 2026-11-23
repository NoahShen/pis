# PIS OPS-01～03 版本部署手册

> 用途：交给运维 Agent 部署本次“错误分类、流式 LLM、Event 输出兼容与展示修正”版本。  
> 通用安装细节见 `docs/deployment.md`；本文只补充本版部署、灰度验收与回滚要求。  
> 不包含真实 Token、模型密钥、私有 User Context、完整随机 RSS 目录或生产正文。

## 1. 部署基线

```text
Git SHA：f70a910cb320e03ee985180c2ac79b1b44db972a
Node：26.13.1
npm：11.20.0
PM2：7.1.2（仓库锁定）
部署形态：单 PM2 fork 进程 + SQLite + 可选 GitHub Pages
```

本版包含：

- LLM 错误摘要、operation 分类、HTTP 状态、attempt/final 日志。
- 流式 SSE、首包/空闲/总超时、独立 operation policy、可取消退避和总重试预算。
- Magpie usage-only `choices: []` 事件兼容。
- Event/Update/Knowledge 标签加粗，Findings 标题与描述分离。
- 既有数据库 schema、六阶段任务、Prompt、Published Item 快照和 sealed 规则未改变。

## 2. 部署前检查与备份

1. 记录当前 Git SHA、PM2 状态、私有环境路径和 `DATABASE_PATH`。
2. 停止接受新的变更，执行一致性 SQLite 备份；WAL 写入期间不要只 `cp` 主文件。
3. 保留当前私有 env、Prompt 根目录和 Pages workdir，不读取或打印秘密。
4. 记录当前未完成业务现场（Source Item、Content、Published Item 数量），用于部署后对照；不要重启清空或手工补写。
5. 保持现有 3 个 Source 启用，其他 Source 维持禁用；不要本次直接启用全部 69 个。

```sh
cd <应用目录>
git fetch origin
git checkout f70a910cb320e03ee985180c2ac79b1b44db972a
node --version                 # v26.13.1
npm --version                  # 11.20.0
npm run verify:toolchain
npm ci
npm run verify
npm run smoke:pm2
```

任一 Gate 失败停止部署，不得跳过测试或使用 `npm --force`。

## 3. 私有环境与 operation 配置

沿用现有 `PIS_LLM_*` 即可，**不要求新增环境变量**。未配置专用项时，五类 operation 继承 endpoint/apiKey/model，默认首包/空闲/单次总超时 60 秒、响应 2 MiB、最多两次、无退避。

生产使用 `group/pis`，仅从现有私有 env 加载，不写入仓库：

```sh
set -a
. /absolute/private/pis.env
set +a
```

如需按 operation 优化，可使用以下前缀分别覆盖：

- `PIS_LLM_PROCESSING_ROUTE`
- `PIS_LLM_EVENT_SEARCH`
- `PIS_LLM_EVENT_ANALYSIS`
- `PIS_LLM_KNOWLEDGE_ANALYSIS`
- `PIS_LLM_TOPIC_MATCHING`

每个前缀支持：`ENDPOINT`、`API_KEY`、`MODEL`、`FIRST_BYTE_TIMEOUT_MS`、`IDLE_TIMEOUT_MS`、`TOTAL_TIMEOUT_MS`、`MAX_RESPONSE_BYTES`、`MAX_ATTEMPTS`、`RETRY_DELAY_MS`、`RETRY_TOTAL_BUDGET_MS`。

**首次部署不要同时大改模型和预算。**先使用现有 `group/pis` 验证流式协议与生产 Prompt，再根据真实首包/Content 耗时调整。`RETRY_TOTAL_BUDGET_MS` 包含首次、退避和第二次；默认 60 秒与单次超时相同，因此本地超时耗尽后不会立即进行第二次。快速格式/网络错误仍可按策略第二次。

不得新增 temperature/top_p/response_format；生产请求只包含 operation model、`stream:true` 和两条 messages。

## 4. 启动与健康检查

```sh
npm run build
npx pm2 start ecosystem.config.cjs --only pis
npx pm2 status
```

PM2 `online` 不等于 Fastify 已监听。执行：

```sh
curl --fail-with-body \
  -H "Authorization: Bearer ${API_TOKEN}" \
  http://127.0.0.1:3000/health
# 期望 {"status":"ok"}

curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/health
# 期望 401
```

确认：

- 只有一个 `pis` 进程。
- 数据库路径与备份一致，未误用临时库。
- 未意外启用 Pages 或其他 Source。
- 日志没有 Token、LLM key、Prompt、正文、完整私有 URL 或 User Context。

## 5. 分阶段灰度验收

### 阶段 A：现有 3 个 Source

观察至少一轮正常采集和 LLM 调用：

- 流式状态能完成 request → reasoning/content → upstream_closed → stream_done。
- usage-only 空 choices 不再导致 `LLM_RESPONSE_MALFORMED`。
- 没有大量本地 60 秒 deadline；若发生，日志能区分首包/空闲/总超时、上游 499 和调用方取消。
- HTTP 200 后仍需通过 JSON/Zod/引用校验，代码围栏仍拒绝，不剥离。
- 第二次成功只产生一次业务结果，Event/Knowledge/Association/Published Item 不重复。

### 阶段 B：恢复之前的 6 个试点 Source

先保留备份，逐个或分批启用，不同时启用全部：

- 分别统计 Source Item、Content、Event、Knowledge、Association、Published Item。
- 对未生成 Content 的条目保留现场，不盲目全量重跑；后续失败查询/安全补跑任务使用。
- 按 operation 观察首包、首个 Content、总耗时、attempt 和 final；不要只看网关 HTTP 200。
- 若仍有超时，检查模型 reasoning 和 operation 预算，不优先增加并发或简单把 60 秒调大。

### 阶段 C：RSS 与公开状态

- 新 Event/Update 标签加粗，Curated Findings 标题与详细描述分离。
- head/pending 与匿名 Pages XML bytes 一致；Git push/PM2 online 不算公开成功。
- 不改变历史 Published Item 和 sealed；同名 sealed 漂移必须停止，不得 force push。
- 公开仓库不得出现数据库、WAL/SHM、私有 env、日志、Prompt/User Context 或私钥。

## 6. 运维验收回报

```text
部署 SHA：
Node/npm/PM2 版本：
npm run verify / PM2 smoke：
健康 200 / 无鉴权 401：
数据库备份位置（私有）：
当前 Source 启停状态：
流式完成/usage-only 结果：
按 operation 的首包/Content/总耗时与异常分类：
Source Item → Content → 分析 → Association → Published Item 数量：
重试是否重复业务资产：
RSS 标签/Findings 展示：
Pages 本地/匿名 bytes：
日志敏感信息负断言：
遗留失败目标与下一步建议：
```

真实阅读器、离线缓存、真实超 200 条历史和中国大陆网络仍是独立 P1 人工验收，不在部署 Agent 自动通过清单中代签。

## 7. 回滚

出现以下情况停止扩大 Source，并评估回滚：

- 大量新增本地 deadline 或请求风暴；
- 合法流式完成被系统性误判；
- 业务数据重复、快照漂移或 Pages 历史被修改；
- 秘密进入日志或公开仓库。

回滚步骤：

1. `npx pm2 stop pis`，保留私有日志和数据库现场。
2. 切回部署前精确 SHA，`npm ci && npm run build`。
3. 使用部署前一致性备份到新路径做只读核对；未经确认不要直接覆盖当前数据库。
4. 恢复私有 env 和原 Source 启停状态，启动后执行健康与业务查询。
5. Pages 禁止 force push；sealed 冲突保留远端，先定位再决定后续发布。

PM2 自动重启不恢复 COMMIT 与下游入队之间的窗口，不提供持久化任务恢复或 Exactly-once。

## 8. 部署后建议

根据真实结果决定下一项，而不是预先扩大架构：

- 模型/预算仍不稳定：调整对应 operation 的模型路由或时间预算。
- 失败目标无法恢复：立项失败查询与安全补跑。
- 扩大 Source 任务量失控：立项首轮 Feed 处理预算。
- 业务完成但 Pages 滞后：立项 Pages 自动恢复。
- Source/Cron 修改不生效：立项 Scheduler 热更新。

通用安装、备份和迁移说明：`docs/deployment.md`。本版验收证据：`docs/operations/OPS-01-llm-failure-summary/`、`OPS-02-llm-streaming-policy/`、`OPS-03-event-output-and-presentation/`。
