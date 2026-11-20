# D11A Plan：运行整合与环境适配

> 版本：v0.1  
> 状态：`APPROVED · G3`  
> 批准日期：2026-11-21  
> 计划基线：main `be98bccc68a81a61ebbc2b216c78da8d72aefa7b`  
> Intent：`docs/milestones/D11A/intent.md`（`APPROVED · G1`）  
> Spec：`docs/milestones/D11A/spec.md`（`APPROVED · G2`）

本文只把已批准的 D11A Intent/Spec 映射为四张文件级、严格串行的 Worker 卡。当前只交付 `plan.md` 与 `progress.md`；**不创建 Worker、心跳、candidate、merge 或生产代码**。Plan 获 Architect G3 批准前，四卡均保持 `NOT_STARTED`。

固定运行时前置：

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

下文所有验证命令均隐含该前置。版本不符时 Worker 直接报告 `BLOCKED`，不得切换宿主默认运行时。

## 1. 目标、边界与 D11A Case

交付内容仅包括：生产配置解析、SSRF 显式调试开关、Node 26 原生 zstd 解压回归、真实六阶段应用装配、Runtime/Scheduler/HTTP/DB 启停所有权、可重复本地集成与进程 smoke、真实验证的分层记录。不修改六阶段任务、重试、队列、数据库 schema、Prompt、模板、API DTO 或业务语义。

### 1.1 独立 Case 映射

| D11A Case | 级别 | 验收断言 | 上游覆盖/边界 |
|---|---|---|---|
| `ASM-01_CONFIG` | P0 | 默认值、严格布尔、LLM URL/key/model、Prompt 目录、timezone；缺省/非法启动失败；secret 不回显；轻量 `buildApp` 可注入且不构造 LLM/Runtime | SRS-CONFIG-01（本 Plan 对 Spec §2 的追踪名）；保留既有 CFG 配置行为，并扩展 `CFG-07` 的启动配置失败边界 |
| `ASM-02_SSRF` | P0 | 默认拒绝 Fake-IP/loopback；仅显式 `RSS_SSRF_PROTECTION=false` 跳过解析地址范围判断；localhost 名称、scheme、userinfo、端口、redirect、DNS 固定、大小、超时、取消仍有效 | SRS-SSRF-01；扩展 D04 `COL-15` 与既有 restricted HTTP P0 套件 |
| `ASM-03_ZSTD` | P0 | Node 26 自动解压后保留的单值 `zstd` 可解析 XML/HTML；未知/多值编码拒绝；解压后流式上限与取消有效；不按 URL 特判 | SRS-ENC-01；扩展 D04 的编码/大小/取消测试，不改变 `COL-10` 摘要降级语义 |
| `ASM-04_ASSEMBLY` | P0 | 真实 DB、共享依赖、六阶段真实 Service、Runtime、Scheduler 和配置 API 一次装配；ready 启动 Runtime、listen 成功后启动 Scheduler；关闭顺序和失败回滚精确；多次 close 幂等 | SRS-ASM-01；映射 `RUN-01`、`RUN-09`、`RUN-10`、`RUN-16`、`CFG-03`、`CFG-07` |
| `ASM-05_INTEGRATION` | P0 | 真实 SQLite + 本地 RSS + Stub LLM 至少完成一条 Knowledge/Event → Topic → Publication 链；生产 smoke 使用临时 DB 且默认库不被触碰 | SRS-INT-01；映射 `RUN-01/02/09/10/12/16`，复用 KNO/TOP/PUB 既有确定性 Case，不代替 D16 |
| `ASM-06_PROCESS` | P0 | 编译产物真实进程可启动、鉴权健康检查、正常关闭、临时 DB 初始化；smoke 合成 LLM 配置但不发起真实网络/模型请求 | SRS-PROC-01；映射 `RUN-09/10/11`，保留既有 CFG/API 回归 |
| `ASM-07_DOCS` | P1 | D11A 作为 G1 批准的前置例外同步到项目级/实施/技术设计索引，不改变原 69 卡与业务语义 | SRS-DOC-01；权威索引一致性，不新增业务 Case |
| `ASM-08_REAL_E2E` | 人工 | 双 RSS + 测试 LLM 在独立临时 DB 复验；记录模型版本、脱敏输入别名、调用/产物计数与结果；不纳入 CI/P0 | SRS-REAL-01；与 D16 `E2E-*`、S0/S1 分开，失败不得由 P0 覆盖 |

`ASM-08` 是里程碑人工证据，不是 T04 Worker 的确定性自动化通过条件；其失败必须如实记录，不能用 Stub 结果替代。

### 1.2 不可变更边界

- 不新增持久化队列、Outbox、任务表、第七种 Runtime 任务、业务 HTTP 触发端点或新 API DTO。
- 不修改 `src/database/schema.sql` 的 11 张业务表、FTS、事务边界、Prompt 原文、Publication 模板、Runtime 重试/派发规则。
- 不把 SSRF 关闭暴露为任意 Transport/URL 特判；业务模块不得读取 `rssSsrfProtection`。
- Prompt 每次调用仍由 `PromptRepository` 读盘，不缓存；不得读取或记录真实 User Context。
- 不新增依赖；T04 只可修改 `package.json` 的 smoke 脚本，不得改 `package-lock.json`。
- 不记录 URL、IP、Header、API key、Token、Prompt、正文或底层 cause。

## 2. 串行门禁、审计与收尾

四卡严格串行。开发心跳仅由**主会话 Architect 在 G3 批准后**使用 `create_heartbeat` 创建并登记；Lead/Worker 不创建心跳，不使用 `create_schedule` 代替。

- G3 批准后，Architect 将 `plan.md`/`progress.md` 提交为 `C0`；T01 base 为 `C0`。
- 每卡 Worker 使用全新 Paseo 会话和独立 worktree；不得 commit/stage/amend/merge/push，只返回 `REVIEW` 或 `BLOCKED`。
- T01～T03 的后续 base 必须是前一卡 Lead closeout 的**精确文档提交 SHA**；T04 base 同理。
- Lead 核对 diff 仅含该卡写集，记录受保护路径 diff=0；从 base+工作树生成 canonical full-index patch，冻结 tree、patch SHA-256 与每个改动 blob SHA。
- Architect G4 独立复核冻结证据；通过后由 Lead 从冻结 tree 创建 candidate，先执行 `git merge-tree --write-tree` 预演，再 merge；merge tree 不等则停止并报告，不自行放宽。
- 每卡 merge 后复验定向测试、全量 `npm run verify`、`git diff --check`；Worker/Workspace 归档后才可标记 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED`，并写 closeout 文档提交作为下一卡 base。
- 发现生产缺陷时停止当前卡；需要改源码的修复必须回到对应已合并卡的写集，由 Lead 重新派发新 Worker。后续卡不得越过写集自行修生产代码。

## 3. D11A-T01 · 生产配置契约与 smoke 兼容

### 3.1 依赖与精确写集

- 前置：G3 批准后的 `C0`。
- 允许修改：`src/config.ts`
- 允许修改：`tests/config.test.ts`
- 允许修改：`tests/app.test.ts`
- 允许修改：`tests/lifecycle.test.ts`
- 允许修改：`tests/configuration/app-assembly.test.ts`
- 允许修改：`tests/configuration/source-api.test.ts`
- 允许修改：`tests/configuration/topic-api.test.ts`
- 新增：`tests/fixtures/app-config.ts`
- 允许修改：`tests/fixtures/forced-exit-entry.mjs`
- 允许修改：`tests/fixtures/pending-listen-entry.mjs`
- 允许修改：`scripts/smoke.mjs`
- 允许修改：`scripts/smoke-configuration-sources.mjs`
- 允许修改：`scripts/smoke-configuration-topics.mjs`
- 只读：`src/app.ts`、`src/lifecycle.ts`、全部 smoke/fixture 调用点。
- 依赖/包变更：`NONE`；其他路径禁止。

### 3.2 实现要求

1. `AppConfig` 增加已解析必填字段：`llmEndpoint`、`llmApiKey`、`llmModel`、`promptsDirectory`、`rssSsrfProtection`、`cronTimezone`。`loadConfig` 始终返回完整配置；Lightweight `buildApp` 签名与依赖注入边界保持不变，只使用原有 HTTP/API 字段，不构造 LLM、Runtime 或真实 Prompt 调用。
2. `PIS_LLM_ENDPOINT` 必填，必须是绝对 HTTP(S) URL，禁止 userinfo/query/fragment；`PIS_LLM_API_KEY` 必填非空；`PIS_LLM_MODEL` 必填、trim 后非空且原文无首尾空白；`PROMPTS_DIR` 默认 `config/prompts` 并 resolve 为绝对路径；`RSS_SSRF_PROTECTION` 默认 `true` 且只接受精确 `true`/`false`；`CRON_TIMEZONE` 默认 `Asia/Shanghai`、非空。timezone 的真实合法性由 Scheduler 启动校验。
3. 扩展 `ConfigPath` 和稳定 `ConfigError`；错误只含字段路径与安全 reason，不回显 endpoint query、key、model、目录原值。缺省 LLM 配置必须失败，不能生成空 Runtime。
4. 用 `tests/fixtures/app-config.ts` 提供轻量测试配置 helper；同步修改所有既有 `AppConfig` 字面量/`main` env，使旧测试仍走可注入 `appFactory`，不要求真实网络。
5. 所有真实进程 smoke 显式提供合成 `PIS_LLM_ENDPOINT`、`PIS_LLM_API_KEY`、`PIS_LLM_MODEL`、有效 `PROMPTS_DIR`；不得修改 `verify` 绕过配置门禁，也不得让 smoke 发 LLM 请求。`scripts/smoke.mjs` 把合成 key 加入敏感 sentinel 检查。

### 3.3 测试与 Case

- `ASM-01_CONFIG`：默认值、合法覆盖、缺失/非法 endpoint、空 key、空白 model、空 Prompt 目录、strict boolean、空 timezone、secret 不泄漏；`PORT=0`、数据库路径和既有配置 API 行为不退化。
- `main` 在缺 LLM 配置时不创建 app；注入 `appFactory` 的既有 lifecycle 测试全部更新后仍通过。
- 定向：`npm test -- tests/config.test.ts tests/app.test.ts tests/lifecycle.test.ts tests/configuration`
- 全量：`npm run typecheck && npm test && npm run build && npm run smoke && npm run format:check`
- `git diff --check`；diff 路径等于 §3.1；合成 LLM key 在 smoke 输出负断言为 0 命中。

### 3.4 验收与证据

Worker 提交精确 diff、配置矩阵、secret 负断言和 smoke 日志摘要。Lead 复核 `AppConfig` 必填契约、`buildApp` 未构造业务服务、smoke env 完整性；随后冻结并交 Architect G4。能力边界：本卡后生产 `main` 仍只装配轻量 app，真实生产装配由 T03 交付。

## 4. D11A-T02 · SSRF 显式调试开关与 Native zstd

### 4.1 依赖与精确写集

- 前置：T01 `PASS` 的 closeout 文档提交。
- 允许修改：`src/adapters/http/address-policy.ts`
- 允许修改：`src/adapters/http/encoding.ts`
- 允许修改：`src/adapters/http/restricted-client.ts`
- 允许修改：`src/adapters/rss-adapter.ts`
- 允许修改：`tests/adapters/restricted-http.test.ts`
- 允许修改：`tests/adapters/rss-http.test.ts`
- 新增：`tests/adapters/ssrf-debug.test.ts`
- 只读：`src/logger.ts`、D04 其他安全测试、HTTP fixture、Post office/Production assembly。
- 依赖/包变更：`NONE`；其他路径禁止。

### 4.2 实现要求

1. `RestrictedClientOptions` 增加 `allowPrivateAddresses?: boolean`，默认 false；`createRssAdapter` 增加配置语义明确的 `ssrfProtection?: boolean`，默认 true，仅 false 映射为 `allowPrivateAddresses: true`。不得从 Source URL、RSS 内容、模型输出或请求参数控制。
2. false 仅跳过私网、loopback、link-local、reserved、unspecified/Fake-IP 的**地址范围拒绝**；IP 语法、family、最多 32 个解析结果、取首地址、pinned lookup 与逐跳重新解析仍保留。URL scheme、userinfo、localhost 名称、非默认端口、redirect、HTTPS 降级、超时、body limit、MIME/charset/encoding、取消全部不变。
3. `SUPPORTED_CONTENT_ENCODINGS` 增加单值 `zstd`。Node 26 `fetch` 已自动解压且保留 Header，业务接收最终 bytes；继续用现有流式 `readBody()` 做解压后上限和取消，不改用 `arrayBuffer()`。不得加 inner URL 特判、多值兼容、`compress` 放行或全局吞 `unsupported_encoding`。
4. 安全警告不扩展 Logger 接口；由 T03 生产装配在启动时调用现有 `logger.error({ operation: "rss", reason: "rss_ssrf_protection_disabled" })`。T02 的 adapter/client 不记录 URL、IP 或 header。

### 4.3 测试与 Case

- `ASM-02_SSRF`：默认 Fake-IP/loopback 拒绝；显式 false 在真实 fixture 中允许 loopback 连接；`localhost` 名称、scheme、userinfo、port、mixed/oversized DNS、redirect downgrade/目标重校验、timeout/limit/cancel 仍拒绝。
- 默认 D04 restricted/security/rss-http P0 套件原样通过。
- `ASM-03_ZSTD`：Node 26 真实 HTTP fixture 返回 `Content-Encoding: zstd` 压缩的合法 XML/HTML，fetch 自动解压后成功；压缩长度小于限制、解压长度越界时 `response_too_large` 且 reader cancel/dispatcher 清理一次；未知、`compress`、`zstd, gzip` 等多值拒绝；既有 gzip/x-gzip/deflate/br 边界不退化。
- 定向：`npm test -- tests/adapters/restricted-http.test.ts tests/adapters/ssrf-debug.test.ts tests/adapters/rss-http.test.ts tests/adapters/security.test.ts`
- 全量：`npm run typecheck && npm test && npm run build && npm run smoke && npm run format:check`
- 扫描确认 adapter http 源码无 URL 特判、无 `arrayBuffer()`、无业务模块读取 SSRF flag；`git diff --check`。

### 4.4 验收与证据

证据必须包含真实 zstd fixture 的响应头/解压后长度、越界取消计数、默认与 false 两条 SSRF 路径及仍受限项清单。记录平台限制：仅保证解压后大小上限，不宣称限制网络压缩字节。

## 5. D11A-T03 · 六阶段生产装配与生命周期

### 5.1 依赖与精确写集

- 前置：T02 `PASS` 的 closeout 文档提交。
- 新增：`src/production/application.ts`
- 允许修改：`src/lifecycle.ts`
- 新增：`tests/fixtures/production-assembly.ts`
- 新增：`tests/application/production-assembly.test.ts`
- 新增：`tests/application/production-lifecycle.test.ts`
- 只读：T01 `AppConfig`、`buildApp`、`assembleApp`、全部 Repository/Service factory、Runtime/Scheduler 公共接口。
- 依赖/包变更：`NONE`；其他路径禁止。

### 5.2 实现要求

1. `src/production/application.ts` 提供 `createProductionAssembly(config, logger, dependencies?)` 与轻量 `buildProductionApp()`。生产默认使用真实实现；测试依赖只允许替换 DB/Clock/IdGenerator/TextCompletionClient/SourceAdapter/Runtime/Scheduler，不暴露任意生产 Transport 或 secret。
2. 打开并初始化 SQLite 恰好一次；创建单一共享 Clock/IdGenerator/PromptRepository/LLM client/TypedLlmCalls。复用既有 Repository/Service 创建 Source/Topic、SourceItem/Content、Knowledge、Event、Candidate、Association、PublishedItem、Publication target/link，再创建 Restricted RSS Adapter、Collection、Processing、Event Search/Analysis、Knowledge、Topic Matching、Publication。不得复制业务 SQL/规则。
3. 用上述真实 Service 创建单一 D15 Runtime 与单一 Cron Scheduler。`scheduler.submit` 只调用 `runtime.submit`；构建 `buildApp(config, logger, { repositories: { source, topic } })`，不新增业务 HTTP 触发端点或内部 Repository API。
4. Fastify 生命周期固定：`onReady` → `runtime.start()`；`onListen` → `scheduler.start()`；`preClose` → `scheduler.stop()` 后 `runtime.shutdown()`；HTTP server close 后 `onClose` → DB close。hook 内部捕获每个 cleanup 错误并继续后续步骤，最终 `onClose` 以稳定 close error 反映聚合失败；owner close 幂等。ready/listen 失败必须走同一 cleanup，不跳过 DB。
5. assembly 构造失败关闭已打开 DB；成功结果可返回 `{ app, runtime, scheduler, database }` 供内部测试/smoke，但不作为 HTTP API、不导出秘密或 Repository。一个 Runtime 仅对应一个 Scheduler。
6. 当 `rssSsrfProtection === false`，启动时恰好调用一次 `logger.error({ operation: "rss", reason: "rss_ssrf_protection_disabled" })`，不含 URL/IP/header/key；true 不产生该事件。`src/lifecycle.ts` 的 `main` 默认 appFactory 改为 `buildProductionApp`，保留注入覆盖。

### 5.3 测试与 Case

- `ASM-04_ASSEMBLY`：spy 证明 DB open/init 一次、共享依赖、全部真实 Service 六方法委托、Prompt 目录和 LLM endpoint/key/model 传递、Scheduler timezone/source/submit、无第七任务/无 delay 建 Runtime。
- 启停顺序：正常 `ready/listen/close` 精确为 `runtime.start → scheduler.start → scheduler.stop → runtime.shutdown → http.close → db.close`；重复 close 不重复 stop/shutdown/DB close。
- 失败矩阵：构造失败、ready 失败、listen 失败、scheduler.start 失败、runtime.shutdown 失败、DB close 失败均不跳过后续清理；关闭失败反映为 close error。
- warning true/false 各一次断言，扫描日志无 secret/URL/IP。
- `main` 缺省 appFactory 使用生产装配：独立测试 mock production factory 并断言调用；既有注入 appFactory path 不回退。
- 定向：`npm test -- tests/application tests/lifecycle.test.ts tests/runtime tests/scheduler`
- 全量：`npm run typecheck && npm test && npm run build && npm run smoke && npm run format:check`
- `git diff --check`；扫描 `src/production/application.ts` 无 `process.exit`、无 schema DDL、无 `fetch`、无 LLM 重试配置、无按请求创建 Runtime。

### 5.4 验收与证据

证据需包含装配依赖图、六阶段方法 spy、ready/listen/close 事件序列、失败回滚矩阵、warning 负断言。Lead 重点复核“轻量 buildApp 保留，生产 main 默认真实装配”和 owner 顺序；通过后冻结交 G4。

## 6. D11A-T04 · 集成、进程 smoke、文档与真实验证分离

### 6.1 依赖与精确写集

- 前置：T03 `PASS` 的 closeout 文档提交。
- 新增：`scripts/production-smoke.mjs`
- 允许修改：`package.json`
- 新增：`tests/fixtures/production-integration.ts`
- 新增：`tests/application/production-integration.test.ts`
- 允许修改：`README.md`
- 允许修改：`docs/project-development.md`
- 允许修改：`docs/PIS_V1_开发实施计划与任务拆分_v0.1.md`
- 允许修改：`docs/PIS_技术实现设计_v1.0.md`
- 依赖/包变更：仅 `package.json` smoke script；`package-lock.json` 禁止变化；其他路径禁止。

### 6.2 实现要求

1. `production-integration.test.ts` 使用真实 SQLite + 临时目录 + 本地 RSS HTTP fixture + Stub LLM/TypedLlmCalls，通过 `createProductionAssembly` 的正式 Service/Runtime/Scheduler seam 触发至少一条 Knowledge 或 Event 链到 Topic → Publication。断言 Published Item 持久化、默认 `data/pis.sqlite` 未被创建、临时 DB 关闭清理；不得用临时手工调用各阶段冒充装配。
2. `production-smoke.mjs` spawn 编译后的 `dist/server.js`，设置临时 `DATABASE_PATH`、合成 `PIS_LLM_ENDPOINT/API_KEY/MODEL`、有效 `PROMPTS_DIR`、`RSS_SSRF_PROTECTION=true`、临时 port；验证 ready、鉴权 health、SIGTERM 正常退出、DB schema 初始化、端口释放和敏感值零输出。不得实际调用 LLM；smoke 不访问真实 RSS。
3. `package.json` 新增 `smoke:production` 并由现有 `smoke` 脚本追加调用；`verify` 仍串联同一 `smoke`，不得跳过/另造弱门禁。真实 RSS/LLM 验证不加入脚本链。
4. `README.md` 更新完整生产环境变量、启动/关闭语义、SSRF 默认安全与显式 false 警告、线上必须开启、zstd/解压后上限平台限制、smoke 临时 DB 行为、D11A 范围及 D12 未实现。
5. 文档索引最小同步：`project-development.md` 说明负责人 G1 批准的 D11A 为 D12 前置例外、18 个里程碑含新增 1 个但原 69 卡不变；实施计划总览/依赖说明加入 D11A（D00～D11、D15；D12 前置）；技术设计 §1.2.2 加 D11A 一行（4 任务）。不得改写原 D00～D16 ID、Case 或业务语义。

### 6.3 测试与 Case

- `ASM-05_INTEGRATION`：至少一条真实 SQLite + 本地 RSS + Stub LLM 纵向链；记录任务映射、阶段调用、Published Item 数量与默认 DB 未触碰。
- `ASM-06_PROCESS`：编译产物进程 smoke；同时运行既有 lifecycle/config persistence smoke。
- `ASM-07_DOCS`：检查三份权威索引均出现 D11A 且原 69 卡数量/ID 未变；README 配置与实现一致。
- 定向：`npm test -- tests/application/production-integration.test.ts`
- 全量：`npm run verify`（typecheck/test/build/全部 smoke/database smoke/format）
- `git diff --check`；`package-lock.json` diff=0；扫描测试与 smoke 输出无真实 key/URL/User Context。

### 6.4 真实验证与验收分离

- T04 deterministic evidence 只支持 `ASM-01`～`ASM-07`，不得宣称 D16 或 S0/S1 通过。
- `ASM-08_REAL_E2E` 在 T04 candidate 冻结后，由 Lead/Architect 使用负责人指定双 RSS 与测试 LLM、独立临时 DB 执行；密钥/URL/User Context 只从本机环境读取。记录模型版本、脱敏 source 标签、阶段调用次数、Published Item 数量、成功/失败原因；不记录完整 URL、正文、Prompt 或密钥。
- 真实验证失败时 T04 状态只能为 `BLOCKED` 或 `FAIL`，不得以本地 Stub smoke 替代；若缺陷落在生产源码，回到对应 T03 写集重新修复与 G4。

## 7. G4、最终 Gate 与收尾

- 四卡按 T01→T02→T03→T04 串行，每卡 Worker 自测 → Lead 冻结/审核 → Architect G4 → candidate/merge-tree merge → 定向+full+format → 归档。
- T04 全部 deterministic Case 与人工 `ASM-08` 完成后，Lead 提交 D11A closeout；Architect 在全新 clean snapshot 独立复验，不采纳 Lead 数字。
- 通过后按既有授权 push 精确 main SHA，等待该 SHA 的远程 GitHub CI Success；本地通过不能替代远程证据。只改验收文档的后续提交按审计规则记录。
- 最终 PASS 后删除 D11A 心跳并核验，归档 T01～T04 Worker/Workspace，不自动开始 D12。Lead 不创建/删除心跳，不推送，不自行签发最终 PASS。

