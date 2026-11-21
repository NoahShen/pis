# D16 Spec：端到端验收、真实模型回归与 V1 交付

- 状态：APPROVED · G2 · Architect
- Intent：APPROVED · G1（负责人授权完成 Spec/Plan 后直接开发）
- 基线：D14 最终文档 main `908d7af15d35a3cea826092196e87c421b7b3118`；D15 已 FINAL PASS。

## 1. 验收分层与证据

| 层 | 输入/环境 | 判定 | 禁止替代 |
|---|---|---|---|
| 确定性 E2E | `createProductionAssembly`、临时 SQLite、本地 HTTP、可控时钟/ID、固定 LLM JSON、隔离 RSS Store/Publisher | 业务行、关联、快照、任务轨迹、XML/归档字节断言 | 不以单阶段测试或真实模型随机结果替代 |
| 真实云端 | 隔离临时 Pages 仓库/目录，或既有仓库的全新隔离测试目录；不污染正式订阅目录 | Git tree + 匿名 origin bytes + 更新/关闭证据 | push 成功不等于公开成功 |
| 真实模型 | 固定合成语料、真实 `TextCompletionClient`、真实 Prompt、合成 User Context | S0/S1 标签、人工判读、调用/失败记录 | 不纳入 P0 CI，不做全文相等断言 |
| 人工平台 | 真实 RSS 阅读器、实际中国大陆网络、离线缓存与超 200 历史 | 版本、日期、观察结果、限制 | 匿名 GET/本地 fixture 不替代客户端行为 |

原始真实模型响应、正文、凭证、完整私有 URL 和 User Context 只存私有临时目录；Git 仅保存脱敏摘要。测试日志和报告不得含秘密。

## 2. T01 Knowledge 主路径

复用/扩展 `tests/fixtures/production-integration.ts` 与本地 HTTP fixtures。每例创建独立临时库、合成 Prompt、固定 ID/clock、默认 Runtime/Scheduler，通过配置 API 创建 Source/Topic，由 `scheduler.trigger()` 或 Runtime `COLLECT` 启动。

必须覆盖：

- **E2E-04**：`C-METHOD` → 一个 Knowledge、多个 findings、匹配 Topic、一个 Curated Published Item；本地 RSS 和隔离 Publisher 观察到该 Item。
- **E2E-05**：`valuable=false` → Content 保留，Knowledge/Association/Curated Item 为零，不派发 Topic/Publish。
- **E2E-07**：合法 Knowledge 但无启用 Topic/无匹配 → 业务资产保留，无发布；覆盖禁用 Topic 与合法空匹配。
- **E2E-11**：正文抓取失败但摘要有效 → PARTIAL Content 先 COMMIT；P-01 首次技术错误、第二次成功；复用同一 content_id，只产生一次成功下游路由和最终结果，不重复 Content。

Notifier/Publisher 失败不得回滚 Published Item；每例必须 `runtime.drain()`、等待 notifier/publisher settle、关闭 app/HTTP/transport，并证明默认数据库未创建。云端替身必须记录完整文件集，不允许用空 Fake 冒充 XML 验收。

## 3. T02 Event 主路径

真实 Event Search/Analysis、Topic Matching、Publication 与 Runtime；P-01～P-05 按输入固定返回合法 JSON，不用模型语义替代程序断言。

- **E2E-01**：NEW_EVENT 不创建初始 Update；Topic 匹配后恰好一条 EVENT Published Item，Curated 为零。
- **E2E-02**：后续 C-UPDATE → 同 Event 新 Update；旧 Item bytes/字段不变，新 Item 恰好一条。
- **E2E-03**：两来源同一 U-1，第二次 NO_INCREMENT → 两份 Source Item/Content，新证据关联；无新 Update/Published Item。
- **E2E-08**：已有 Event 后创建 Topic；旧目标不回补，新 Update 独立匹配/发布。
- **E2E-10**：NO_INCREMENT 新别名 → Event ID 不变、别名含 Content 证据、FTS 可查，无新 RSS Item。
- **E2E-14**：不同监管机构、同 Scope → NEW_UPDATE 复用 Event；Update 自身匹配，不按监管机构强拆。

每例核对 Source Item → Content → Event/Update → evidence → Association → Published Item 可追溯，查询 API 读取与 DB 一致。

## 4. T03 双路径与历史归档

- **E2E-06**：同一 Content 双路由，Event/Knowledge 各自匹配，两个 Feed 各一条不同 Published Item。
- **E2E-09**：同一新 Update 匹配两个 Topic → 两条 Association、一个 Published Item/GUID。
- **E2E-13**：同 Source 同 GUID 改正文不产生新 Source Item/Content；新 GUID 相同正文可新建；Event/Knowledge 各自处理，不强加 Knowledge 跨文章去重。
- **E2E-12**：每类 Feed 独立构造至少 401 条不可变 Published Item（覆盖 201/451 边界由 D12 既有用例继续承担），同步后 head/pending/sealed 联合去重无漏无重；sealed 每份恰好 200、互不重写、两 Feed 不串档，head/pending 允许窗口重叠。
- 隔离 Publisher 对完整文件集做版本发布；验证另一 Feed/未知文件保留、同名 sealed 同 bytes 复用、漂移拒绝。此结果只证明服务端，不标记 RSS-15 客户端通过。

允许在 fixture 中直接批量构造合法历史 Published Item 以提高测试效率，但必须走正式 Published Item source、RSS sync 和 Publisher，不直接手写最终 XML 充当结果。

## 5. T04 真实模型语义回归

提供独立 `scripts/semantic-regression.mjs`，不进入默认 `npm test`/CI；要求显式私有环境文件或环境变量，不在命令行回显凭证。输出安全摘要到指定私有路径，公开报告只写脱敏统计。

- 固定模型 ID、endpoint 类别、时间、超时、调用次数；记录可控参数与不可控项（无温度控制须明示）。
- 使用仓库真实五个 Prompt 和合成 User Context，记录其 SHA-256；以 `semantic-regression-round1.md` 修订后 Prompt 为基线。
- PMT-01～06、PMT-11 使用固定样本与判读标签；PMT-12 至少重复两轮关键样本，记录波动而非要求文本一致。
- PMT-06b 重制为 description 显式覆盖而正文偶然提及的结构；不得通过弱化预期隐藏模型错误。
- EVT-19/20 验证非法候选引用由程序拒绝及合法别名边界；KNO-07/09/10 验证 PARTIAL 不虚构、跨领域价值、入门/深度区别。
- P-02 search_terms 不落别名、P-03 不做程序二次语义审核必须有存储侧断言。
- 原始输出仅存私有临时目录，公开报告记录 Case/期望/实际语义标签/判定/理由/重试/格式错误，不记录正文和秘密。
- 预评估只能作为历史参考；正式报告必须重新运行。真实 User Context 未获单独授权时禁止读取。

## 6. T05 PM2、覆盖矩阵与人工交付

### PM2

新增固定版本 `pm2@7.1.2` 依赖及 lock；新增 `ecosystem.config.cjs`，单进程 fork、`node dist/server.js`、不启用 cluster/watch、不自动修改业务 env、不保存秘密。配置 `kill_timeout` 与应用 5 秒关闭预算协调，`wait_ready=false`（当前服务无 `process.send('ready')`），禁止假装 ready 协议。

提供 `scripts/pm2-smoke.mjs`：隔离临时数据库/端口/env、构建后启动、健康鉴权、重启、SIGINT/SIGTERM 等效 PM2 stop、端口释放、进程清理、日志秘密负断言；默认 Gate 清除 Pages env，避免真实发布。不得对默认库或正式 Feed 操作。

文档说明 Node/npm/pm2 固定版本、install/build/start/stop/restart/logs、私有 env 加载、SQLite 备份（主文件+WAL 一致性）、新机器同 Pages 目录校准、sealed 不改写、随机目录迁移边界。PM2 不承诺任务恢复/Exactly-once。

### 覆盖矩阵

`docs/milestones/D16/p0-coverage.md` 逐项列出 169 个 P0：Case ID、状态、测试/证据路径、备注。只能引用当前 main 可重跑测试或已审核真实证据；D11A 不新增 Case ID。任何 P0 FAIL/BLOCKED/NOT_RUN 阻止 V1 完成；不得用 `N/A` 隐去。

`docs/milestones/D16/reader-acceptance.md` 接续 D13 清单，记录 RSS-15/16：真实客户端首次订阅、离线缓存、超过 200 历史与归档跟随、GUID 去重、大陆网络、公开仓库树/历史无秘密。缺证据必须 PENDING/BLOCKED；服务端 E2E-12 不替代客户端。

### 最终判定

- `D16_FINAL_PASS`：五卡开发/文档交付完成，全部 P0 可重复通过，真实模型报告完成，PM2/部署 Gate 和精确 SHA Linux CI 成功；P1 外部项可单独 BLOCKED 并明确遗留。
- `V1_FINAL_PASS`：除上述外，不得有任何 P0 未通过；对延期 P1 必须明确负责人是否接受遗留。若 RSS-15/16 仍 BLOCKED，交付状态写 `D16_COMPLETE_WITH_EXTERNAL_ACCEPTANCE_BLOCKED`，不宣称全部系统验收通过。

## 7. 非目标与变更控制

不改六类任务、schema/DDL、API DTO、Published Item、RSS 200/pending/sealed 规则、Prompt 业务语义；不新增 Outbox、持久化任务、全文/语义检索、前端、OAuth、多租户或动态 Feed。E2E 暴露生产缺陷时停止相关卡，记录可复现证据，重走受影响设计/任务门禁，不能修改测试预期掩盖。

五卡严格串行 T01→T02→T03→T04→T05；每卡固定 base、精确写集、canonical full-index patch/tree、Architect G4、candidate/merge、merge 后全量复验和归档。新增依赖仅限 T05 PM2；其他卡禁止 package/lock 改动。
