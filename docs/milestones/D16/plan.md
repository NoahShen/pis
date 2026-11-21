# D16 Plan：端到端验收与 V1 交付

- 状态：G3_APPROVED · Architect
- Intent：APPROVED · G1；Spec：APPROVED · G2
- 执行基线：包含本文件及 progress 的文档提交；五卡严格串行。
- 固定工具：Node `26.13.1` / npm `11.20.0`；PATH `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`。

## 1. 通用执行协议

1. 每卡使用新 Paseo Lead/Worker、独立 worktree、固定 base；Worker 不 commit/stage/merge/push，不写 progress，不自行 PASS。
2. Worker 先落盘再测试；Architect 独立审查实际 diff/typecheck，不采纳口头验证。冻结仅批准写集，生成 `git diff --binary --full-index`，记录 tree/patch SHA。
3. Architect 从 base 独立重放 patch，执行定向测试、typecheck；每卡 merge 前 candidate/merge-tree preflight，merge 后 `npm run verify`。
4. 测试默认清除 `RSS_PAGES_*`，禁止默认数据库和正式 Pages 目录。真实模型凭证仅从 `~/.config/pis/llm.env` 读取，不回显/提交。
5. 生产缺陷先记录并退回修复，必要时重走 G2/G3；不得放宽断言、删除失败用例或为超时单纯延长预算。
6. 每卡归档 Worker/Workspace；最终 Architect 干净 `git archive` Gate、精确 SHA Linux CI、文档 push、心跳删除。

统一验证：

```sh
export PATH=/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH
unset RSS_PAGES_PUBLIC_DIRECTORY RSS_PAGES_REPOSITORY RSS_PAGES_BRANCH RSS_PAGES_WORK_DIRECTORY RSS_PAGES_PUBLIC_ORIGIN RSS_PAGES_PUBLISH_TIMEOUT_MS RSS_PAGES_POLL_INTERVAL_MS
npm run typecheck
npm test -- <本卡测试文件>
npm run verify
```

## 2. D16-T01 Knowledge E2E

**Base**：D16 文档执行基线。  
**Case**：E2E-04/05/07/11。

精确写集：

- 新增 `tests/e2e/knowledge-pipeline.test.ts`
- 新增 `tests/fixtures/e2e-pipeline.ts`
- 可最小修改 `tests/fixtures/production-integration.ts`（仅复用通用本地 adapter/stub，不改变已有 ASM-05 断言）

交付：

- 完整生产装配与 Runtime，四组独立临时 DB/本地 RSS fixture。
- 可控 P-01/P-04/P-05，PARTIAL+首次路由错误重试，资产/任务/快照/XML/Publisher 文件集断言。
- 本地 RSS store 使用临时目录，Publisher 记录完整版本；无真实网络/GitHub/LLM。
- 验证关闭、默认库不存在、已有 production integration 不回归。

禁止：修改生产代码、DDL、Prompt、package/lock、其他测试；若发现缺陷停止并报告。

## 3. D16-T02 Event E2E

**Base**：T01 closeout 文档提交。  
**Case**：E2E-01/02/03/08/10/14。

精确写集：

- 新增 `tests/e2e/event-pipeline.test.ts`
- 新增 `tests/fixtures/e2e-event.ts`
- 可最小修改 `tests/fixtures/e2e-pipeline.ts`（仅共享 harness）

交付六组主路径：NEW_EVENT、NEW_UPDATE、NO_INCREMENT 证据、后建 Topic、新别名 FTS、同 Scope 不同监管机构；固定 P-01～P-05 响应与候选 Event 数据。断言旧快照不变、无额外发布、来源证据链、Update 独立匹配及 Retrieval API 一致。

禁止：直接调用业务模块代替 Runtime 主链、手写最终 XML、真实模型/网络、生产/Prompt/schema/package 修改。

## 4. D16-T03 双路径与归档历史

**Base**：T02 closeout 文档提交。  
**Case**：E2E-06/09/12/13。

精确写集：

- 新增 `tests/e2e/cross-path-history.test.ts`
- 新增 `tests/fixtures/e2e-history.ts`
- 可最小修改 `tests/fixtures/e2e-pipeline.ts`

交付：

- 同 Content 双路、多 Topic 单 GUID、同 GUID 修改/新 GUID 同正文。
- 每类至少 401 条合法 Published Item，正式 source/sync/store/publisher 生成 head/pending/sealed；遍历链、GUID 去重、sealed bytes/复用/漂移、Feed 隔离与另一 Feed/未知文件保留。
- 明确输出 `server_side_archive_only`，不更新 RSS-15。

禁止：向正式 Pages 发布、用 401 条手工 XML 绕过业务生成、修改生产代码或既有 Prompt/schema/package。

## 5. D16-T04 真实模型正式回归

**Base**：T03 closeout 文档提交。  
**Case**：PMT-01～06/11/12、EVT-19/20、KNO-07/09/10。

精确写集：

- 新增 `scripts/semantic-regression.mjs`
- 新增 `scripts/semantic-regression-fixtures.mjs`
- 新增 `docs/milestones/D16/semantic-regression-final.md`
- 新增 `tests/semantic/semantic-regression.test.ts`（只测参数/安全输出/fixture/解析，不调用真实模型）

交付：

- 脚本使用编译后真实 LLM/Prompt 组件；显式 `--env-file`、`--output`（私有路径）、`--self-test`；有界超时/输出，安全错误。
- 固定合成样本、两轮关键回归、程序引用/存储侧断言；报告模型/时间/调用/失败/判读和 Prompt hash。
- 默认 verify 只运行离线 self-test/测试；真实模型由 Architect 单独执行，原始输出不进入 Git。
- 不读取真实 User Context；若真实模型外部故障，记录 BLOCKED，不伪造报告。

禁止：修改 Prompt 以迎合样本、把预评估复制为正式结果、凭证/正文进日志或 Git、package/lock 改动。

## 6. D16-T05 PM2 与最终交付

**Base**：T04 closeout 文档提交。

精确写集：

- 修改 `package.json`、`package-lock.json`（仅 `pm2@7.1.2` 及传递依赖）
- 新增 `ecosystem.config.cjs`
- 新增 `scripts/pm2-smoke.mjs`
- 新增 `tests/deployment/pm2-config.test.ts`
- 修改 `README.md`
- 新增 `docs/deployment.md`
- 新增 `docs/milestones/D16/p0-coverage.md`
- 新增 `docs/milestones/D16/reader-acceptance.md`
- 可修改 `docs/milestones/D13/pages-acceptance.md`（仅迁移最终人工证据状态，不代签缺失项）

交付：

1. PM2 单进程配置、构建/启动/重启/stop/清理/端口释放和秘密负断言；默认 Gate 不启动真实 Pages。
2. 部署/迁移/备份文档，无秘密、无完整随机目录。
3. 169 个 P0 全覆盖矩阵，引用精确测试/证据；缺失项如实标 FAIL/BLOCKED/NOT_RUN。
4. 真实阅读器/离线/超200/大陆网络记录；需要用户设备或网络的操作提供可执行清单，未执行保持 BLOCKED。
5. 全量 `npm run verify`、PM2 smoke、D13 pages acceptance self-test、最终干净快照与 Linux CI。

禁止：把 P1 人工缺项改 PASS、以 PM2 增加任务恢复、默认启动真实云发布、夹带未审核生产代码。

## 7. 最终 Gate 与退出状态

- T01～T03 所有 E2E P0 PASS；T04 正式真实模型报告完成；T05 PM2/部署 PASS；169 P0 全 PASS；全量/干净快照/精确 SHA CI PASS。
- 满足以上签发 `D16_FINAL_PASS`。RSS-15/16 或其他外部 P1 未齐时，状态为 `D16_COMPLETE_WITH_EXTERNAL_ACCEPTANCE_BLOCKED`，并向负责人列出需人工完成项，不宣称 V1 全部验收通过。
- 若 P0、真实模型执行或 PM2 Gate 阻塞，则不签发 D16 最终 PASS，保留心跳直至开发工作结束，并向负责人报告具体阻塞。
