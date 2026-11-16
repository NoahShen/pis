# D03 Plan · Source/Topic 配置与管理 API

> 版本：v0.2 · 2026-11-16
> 状态：**REVIEW · 等待 Architect G3 与负责人执行批准**
> 起草：Paseo Lead（仅规划）
> 修订：按 Architect G3 v0.1 `CHANGES_REQUIRED` 校正逐卡合并顺序、远程 CI/最终验收边界及启动失败资源回收证据；不改变已批准 Spec 契约。
> 依据：[Intent v0.1](intent.md)（APPROVED）、[Spec v0.1](spec.md)（APPROVED G2）、[任务拆分 v0.1](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) D03、[测试设计 v0.2](../../PIS_V1_测试用例设计_v0.2.md) CFG/API 配置用例。
> 文档基线：`a8571c76e661f75c6a9ff2318631454ce5f3e1ed`（D03 Intent/Spec 已批准）；生产实现基线：`40d9efeb21e8c94480dbdc644f09be0ac17d7a9f`（已推送且远程 CI Success）。

## 1. 执行边界与门禁

本 Plan 只落实 D03-T01～T03，不重定义已批准的 Intent/Spec，不修改 D01 DDL、Prompt、权威设计或 CI workflow，不实现 DELETE、抓取、调度执行、LLM、Topic Matching、历史查询、回溯或发布。

正式派发 Worker 必须同时满足：

1. Architect G3 APPROVED，且本文件状态改为 `APPROVED`。
2. 项目负责人审阅 Plan 后明确批准执行；当前 `USER_EXECUTION_APPROVAL=PENDING`。
3. Lead 从包含已批准 Plan 的合并 commit 为每卡创建新的独立 worktree/任务分支并记录 base SHA；Worker 进入后先以固定 Node/npm 执行 `npm ci`，再开始实现。
4. 三卡严格串行，每卡使用新的 Paseo Worker 会话。固定顺序为：Worker 自测 `REVIEW` → Lead 独立审核并冻结精确 diff/tree → Architect 对冻结 diff/tree `APPROVED` → Lead 形成精确候选提交 → `git merge --no-ff` 合并 → 在合并 commit 上复跑定向测试和 full verify → 记录 `PASS` → 才创建下一卡。
5. Worker 不自行 stage/commit、不扩大写集、不宣称最终 PASS；工作结果先记 `REVIEW`。
6. 使用 D00 固定工具链；任何工具链失败先停卡取证，不安装替代运行时、不改写锁文件规避。

固定运行时前置：

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
node scripts/verify-toolchain.mjs
```

不得读取、复制或 stage 真实 `config/prompt/user-context.md`；不得使用真实 Token、私有 URL 或生产数据库作为测试输入。五份功能 Prompt 均不得修改。

### 1.1 权威段落与代码对齐

- 技术设计 §5.1 固定 Source/Topic 配置管理路径；§5.2 的历史列表分页属于 D14，不反向扩张 D03；§7.3 只要求在未来执行阶段落实 Cron 方言与时区。
- 数据库设计 §1.2/§1.5/§1.8 固定 `sources.last_collected_at` 的检查点语义、`sources`/`topics` 字段与无名称/URL 唯一约束；D03 不修改冻结 DDL。
- 测试设计 CFG-01～07、API-01/02/10/13 提供既有 Case；其中 `type/url` 原“待定”记录已由负责人决定与 Spec v0.1 覆盖，专项用例统一记为新增 `D03-IMMUTABLE-01`，不冒用旧 Case ID。
- 现有代码可复用 D01 `openDatabase`/`initializeDatabase`/`withTransaction`/`classifySqliteError`、临时文件 DB 与 ID 替身，以及 D00 `createBearerPreHandler`。当前 `startServer` 在 listen rejection 与 `isAddressInfo()` 失败两个分支均未调用 `app.close()`，owned DB 的 `onClose` 因而不会执行；该可定位缺口由 T02 的文件写集与双分支回归测试覆盖。
- 未发现需要重定契约的 Spec 矛盾；本 Plan 只把已批准 Spec 落到文件、Case、命令和证据。若实施中出现 DDL、新依赖、状态码或字段契约冲突，立即 `BLOCKED` 回报 Architect。

### 1.2 每卡 DoD 与合并门禁

每卡按以下顺序完成，前一步未通过不得进入下一步：

1. Worker 在独立 worktree 实现、定向测试与 full verify，只回报 `status: REVIEW` 和可复现证据。
2. Lead 独立核对文件写集、依赖、Case、事务/资源生命周期并复跑必要测试；结论记录为 `LEAD_REVIEW=APPROVED` 或退回修复，同时冻结精确 diff 与 tree。
3. Architect 对 Lead 冻结的精确 diff/tree 复核，记录 `ARCHITECT_REVIEW=APPROVED`；未获批准不得形成候选提交或合并。
4. Lead 仅将 Architect 已批准的内容形成精确候选提交，记录 candidate SHA/tree；candidate tree 必须与 Architect 批准的 tree 完全一致。
5. Lead 在 `main` 上对该 candidate 执行 `git merge --no-ff`，记录 merge SHA，并核对 merge 第一父提交为上一卡已验证基线、第二父提交为 candidate。
6. 在 merge commit 上复跑该卡定向测试与 full verify，并核对工作树 clean。通过后才记录 `<task>=PASS · LOCAL_MERGE_VERIFIED`；失败则不得 PASS、不得开始下一卡，按失败收敛规则处理。

每个后续 Worker 的 base SHA 必须是上一卡已验证的 merge SHA，不能从候选分支或未合并树继续。Plan/G3 审批本身不构成任何任务 PASS。

## 2. 唯一新增依赖

T01 只允许新增一个精确直接依赖：

| 类型 | 包 | 精确版本与已核实元数据 | 用途与边界 |
| --- | --- | --- | --- |
| dependency | `node-cron` | `4.6.0`；`engines.node >=20`；integrity `sha512-Si/bzYiKRHOB8/a99T2+SDGN582ONDMSTlJr5oCkT6GtnqPjZ2s10eoQRYkW9ZHwjVxONL+W8Fb+qR0AHMQsdg==`；自带 TypeScript declarations；零 dependencies | 仅使用 `validate()` 校验五/六字段 Cron；不调用 `schedule`/`createTask`，不启动定时器 |

安装顺序固定为：

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node scripts/verify-toolchain.mjs
npm install --save-exact node-cron@4.6.0
npm ci
```

`package.json` 必须记录 `"node-cron": "4.6.0"`；`package-lock.json` 只允许出现该精确直接依赖及其对应元数据/节点变化，必须与上述 integrity 一致。若 Node 26.13.1 下安装、类型检查或运行不兼容，T01 标 `BLOCKED` 并记录平台/架构、Node/npm、安装阶段和可复现命令；不得临时改用其他 Cron 库或自写解析器。

依赖安装策略：Plan 阶段不联网、不改锁文件。T01 在新 Worker worktree 中先用固定工具链对当前 lock 运行 `npm ci`，再精确安装 `node-cron@4.6.0 --save-exact`；验证后只保留 T01 分支中的 `package.json`/`package-lock.json` 依赖 diff。若 npm 生成的 lockfile 或平台 optional metadata 发生不相关漂移，立即停止并交 Lead；禁止删除或重写整个 lockfile。

## 3. 文件写集与串行依赖

| 任务 | 独占新增/修改路径 |
| --- | --- |
| T01 | `package.json`, `package-lock.json`, `src/configuration/contracts.ts`, `src/configuration/source-repository.ts`, `src/configuration/topic-repository.ts`, `tests/configuration/contracts.test.ts`, `tests/configuration/source-repository.test.ts`, `tests/configuration/topic-repository.test.ts`, `tests/fixtures/configuration.ts` |
| T02 | `src/config.ts`, `src/app.ts`, `src/lifecycle.ts`, `src/configuration/app-assembly.ts`, `src/configuration/http-errors.ts`, `src/configuration/source-routes.ts`, `src/configuration/route-registry.ts`, `tests/config.test.ts`, `tests/app.test.ts`, `tests/lifecycle.test.ts`, `tests/configuration/app-assembly.test.ts`, `tests/configuration/source-api.test.ts`, `tests/fixtures/forced-exit-entry.mjs`, `tests/fixtures/pending-listen-entry.mjs`, `scripts/smoke.mjs`, `scripts/configuration-smoke.mjs`, `scripts/smoke-configuration-sources.mjs`, `.gitignore` |
| T03 | `src/configuration/topic-routes.ts`, `src/configuration/route-registry.ts`（仅追加 Topic 注册）, `tests/configuration/topic-api.test.ts`, `scripts/smoke-configuration-topics.mjs`, `README.md` |

共同规则：

- T02/T03 的唯一代码重叠点是 `route-registry.ts` 的预留装配缝；T02 创建 Source 注册，T03 在其合并后的分支上只追加 Topic 注册。两卡禁止并行或互相 cherry-pick。
- 进程 smoke 由 T02 的 `configuration-smoke.mjs` 自动发现 `smoke-configuration-*.mjs`；T02 只新增 Source 场景，T03 只新增 Topic 场景，不再修改 T02 的 runner。
- 后续卡可只读复用前序公开类型、Repository 与 Fixture，不在本卡复制或重写实现。
- T01 的依赖改动仅限 `package.json` 与 `package-lock.json`；不得夹带其他依赖、安装脚本或 lockfile 漂移。
- 不修改 `src/database/**`、`src/auth.ts`、`src/logger.ts`、Prompt、`tsconfig*.json`、`vitest.config.ts`、格式脚本或 CI。若必须越过，Worker 停止并交 Lead/Architect，不夹带修改。

依赖图：

```text
G3 APPROVED → USER_EXECUTION_APPROVED
  → T01 exact dependency + shared validation + repositories
  → Worker REVIEW → Lead APPROVED + frozen exact tree
  → Architect APPROVED → exact candidate commit → --no-ff merge → merged verify → T01 PASS
  → T02 Source API + default DB ownership + lifecycle/process smoke
  → Worker REVIEW → Lead APPROVED + frozen exact tree
  → Architect APPROVED → exact candidate commit → --no-ff merge → merged verify → T02 PASS
  → T03 Topic API + sole registry append + Topic process smoke + README
  → Worker REVIEW → Lead APPROVED + frozen exact tree
  → Architect APPROVED → exact candidate commit → --no-ff merge → merged verify → T03 PASS
  → clean-install LOCAL_GATE
  → optional authorized push + exact-SHA REMOTE_CI → FINAL_PASS
```

## 4. 固定公共接口

### 4.1 输入、领域数据与错误

`src/configuration/contracts.ts` 是 API 与 Repository 的唯一字段契约，至少导出：

```ts
export type SourceType = "RSS";
export type ConfigurationInputErrorCode = "invalid_configuration_input";

export class ConfigurationInputError extends Error {
  readonly code: ConfigurationInputErrorCode;
}

export interface Source { /* Spec §2 完整 snake_case 输出字段，enabled 为 boolean */ }
export interface Topic { /* Spec §2 完整输出字段，enabled 为 boolean */ }

export interface SourceCreateInput { /* name/type/url/cron/enabled?/description? */ }
export type SourceUpdateInput = { /* 至少一个 name/cron/enabled/description 允许字段 */ };
export interface TopicCreateInput { /* name/description/enabled? */ }
export type TopicUpdateInput = { /* 至少一个 name/description/enabled 允许字段 */ };

export function parseSourceCreate(value: unknown): SourceCreateInput;
export function parseSourceUpdate(value: unknown): SourceUpdateInput;
export function parseTopicCreate(value: unknown): TopicCreateInput;
export function parseTopicUpdate(value: unknown): TopicUpdateInput;
```

- 四个 parser 使用 Zod strict object；未知字段、非对象、数组、`null`、类型错误、空 PATCH 均抛 `ConfigurationInputError`，原始 message/cause/input 不进入 HTTP 响应或日志。
- `name` 与 Topic `description` 只校验 `value.trim().length > 0`，入库保留原字符串；Source `description` 接受字符串或 `null`，不 trim；`enabled` 严格 boolean。
- Source URL 在解析前检查首尾空白和 C0/DEL 控制字符；用 WHATWG `URL` 验证绝对 `http:`/`https:`、非空 host、无 fragment。authority 中只要出现 `@` 即拒绝，包括空 userinfo；不做 DNS/网络请求，不把合法 URL 规范化后保存。
- Cron 先要求非空并以空白切分为 5 或 6 个字段，再调用固定版本 `node-cron.validate()`；保存原文，不创建任务。
- Spec 未定义额外字段字符上限；Plan 不新增 `MAX_CONFIG_TEXT_LENGTH` 或任何隐藏业务限制。只依赖 Fastify 默认 `1_048_576` byte body limit 与 Spec 的字符串/非空规则，不为 D03 虚增契约。
- 不可变/检查点字段（Source PATCH 的 `id/type/url/last_collected_at`）与 POST 的 `id/last_collected_at` 均因 strict object 在上层整单拒绝；同值提交也不豁免。

`ConfigurationInputError` 只表达安全、可预期的配置输入失败。SQLite 驱动错误与 ID 冲突保持原错误交给 D01 `classifySqliteError()`；不包装成输入错误，不重试 ID。

### 4.2 Repository

```ts
import type Database from "better-sqlite3";
import type { IdGenerator } from "../id/id-generator.js";

export interface SourceRepository {
  create(value: unknown): Source;
  getById(id: string): Source | null;
  list(): Source[];
  listEnabled(): Source[];
  update(id: string, value: unknown): Source | null;
}

export class SqliteSourceRepository implements SourceRepository {
  constructor(db: Database.Database, idGenerator: IdGenerator);
}

export interface TopicRepository { /* 同构 Topic create/getById/list/listEnabled/update */ }
export class SqliteTopicRepository implements TopicRepository {
  constructor(db: Database.Database, idGenerator: IdGenerator);
}
```

- 构造不打开/关闭/迁移数据库；调用者提供已初始化连接。所有 SQL 参数化。
- create 先走同一 parser，再生成一个 ID、写入并返回数据库中的完整对象；ID 冲突直接抛出存储错误。
- update 先走同一 parser，在 D01 `withTransaction()` 内读取目标、按白名单动态生成参数化 UPDATE、再读取完整对象；不存在返回 `null`。同值合法更新返回当前对象。
- list/listEnabled 返回全部或启用项，均按 `id COLLATE BINARY ASC` 稳定排序。editing 只触及 `sources`/`topics`，绝不更新 `last_collected_at`、Topic Association、Published Item 或任何下游表。
- `last_collected_at` 只读取，不提供 Repository/API 写入口。Source enabled 入库 0/1、输出 boolean；Topic 相同。

### 4.3 App 装配

```ts
export interface ConfigurationRepositories {
  source: SourceRepository;
  topic: TopicRepository;
}

export interface AppDependencies {
  repositories?: ConfigurationRepositories;
}

export function buildApp(
  config: AppConfig,
  logger: Logger,
  dependencies?: AppDependencies,
): FastifyInstance;
```

- `AppConfig` 增加可选 `databasePath` 以兼容既有注入测试；`loadConfig()` 始终返回已解析的非空绝对路径。`DATABASE_PATH` 缺省 `./data/pis.sqlite`，显式空/全空白值触发既有 `ConfigError`。
- 传入 repositories 时由调用者管理 DB；不得在 app close 时关闭其连接。未传入时由 app 自己创建父目录、调用 D01 `openDatabase()` + `initializeDatabase()`、创建两个 Repository，并只注册一次 `onClose` 关闭该连接。
- owned DB 的创建、schema 初始化或路由装配失败时立即关闭已打开连接并保留安全错误；成功后 DB 关闭发生在请求处理结束后。
- 不新增 `databaseFactory`、环境变量、DI 容器或第二套生产构造路径。生产默认严格依次调用 `mkdir`/`openDatabase`/`initializeDatabase`；失败回收测试使用真实临时文件 DB 预置不兼容 schema，并 spy `Database.prototype.close` 证明 owned connection 恰好关闭一次。
- 配置 API 通过 Fastify 插件封装并复用 `createBearerPreHandler()` 作为 scoped `onRequest` 钩子，确保鉴权先于 Content-Type 检查、body 解析、Zod 校验和 Repository 访问。两个插件分别 prefix 为 `/api/sources` 与 `/api/topics`。
- POST/PATCH 仅接受 `application/json`（允许 `charset` 等参数，media type 比较大小写不敏感）；缺失、`text/plain` 或其他 media type 在 scoped `preParsing` 阶段返回 415，且该检查必须排在 `onRequest` 鉴权之后、Fastify body parser 之前。
- `startServer` 必须把 listen rejection 与 bound-address 校验失败统一收敛到一次失败 cleanup：对传入 app 执行一次有界 `app.close()` 以触发 owned DB 的 `onClose`，随后完成一次 `logger.flush()`；cleanup 与 flush 共用同一个 `shutdownTimeoutMs` 总预算，通过 `shutdownDeadline` 计算剩余时间，禁止分别重新授予完整预算。不得用 DB 直接关闭绕过 app hook，也不得重复执行 close hooks。
- 失败 cleanup 完成后只结算一次：`ready` 以安全错误 rejection、`completed={code:1,reason:"listen_error",forced:false}`、解除 SIGINT/SIGTERM listener、`listen_error` 日志各一次。close rejection/挂起与 flush rejection/挂起均为次级 cleanup 失败，必须有界结束并安全记录，但不得覆盖 `listen_error` 主结果或再次 close/flush。若 shutdown 已开始后 listen 才 reject，复用既有竞态路径，只关闭迟到 listening 资源且不重复执行 owned app cleanup。
- 上述 shared-budget cleanup 仅用于“listen 阶段自身失败”的 owned 资源回收。`buildApp` 在 schema 初始化或路由装配阶段失败时，Fastify 尚未进入 `startServer`；owned DB 由装配层自己的同步/有界失败路径关闭一次，不得等待 `app.close()` 或另跑一次 lifecycle cleanup。`appFactory` 抛错时没有成功返回的 app，`main` 只保留既有 `startup/app_error` 安全失败路径。
- 当前 health 与 lifecycle 成功路径保持兼容，不改变 ready/completed 协议；只补齐失败路径的 owned 资源回收。

### 4.4 HTTP 映射

`http-errors.ts` 提供安全的 scoped error handler。映射严格为：

| 来源 | HTTP | 固定 body |
| --- | --- | --- |
| `ConfigurationInputError`、Zod/JSON/query/params 业务解析失败、空 PATCH、不可变字段 | 400 | `{ "error": "invalid_request" }` |
| 合法详情/PATCH 的目标不存在 | 404 | `{ "error": "not_found" }` |
| Fastify body limit | 413 | `{ "error": "payload_too_large" }` |
| 不支持 Content-Type | 415 | `{ "error": "unsupported_media_type" }` |
| `classifySqliteError()` 为 `busy_locked` | 503 | `{ "error": "storage_unavailable" }` |
| 其他 SQLite 约束/驱动异常及未预期错误 | 500 | `{ "error": "internal_error" }` |

Fastify 解析错误固定识别 `FST_ERR_CTP_EMPTY_JSON_BODY`/`FST_ERR_CTP_INVALID_JSON_BODY` 为 400、`FST_ERR_CTP_BODY_TOO_LARGE` 为 413、`FST_ERR_CTP_INVALID_MEDIA_TYPE` 为 415；前两者已在当前 `fastify@5.12.8` 源码核实。实现与测试按 `error.code` 映射，不按 message 猜测。管理路由范围内的任何 query 参数均视为非法请求；两个列表不实现过滤/Cursor。错误 handler 不回显异常 message/cause、请求值、SQL、URL 或数据库路径。未知路径与 DELETE 保持 Fastify 404，不写业务数据。

### 4.5 启动失败 cleanup 的可验证伪代码

实现应保持等价的单一 deadline 结构；辅助函数名称可调整，但预算与结算语义不得变化：

```ts
async function cleanupStartupFailure(
  app: FastifyInstance,
  logger: Logger,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    await withTimeout(() => app.close(), remaining());
  } catch (error) {
    logSecondaryCleanupFailure(logger, error); // close_error | timeout
  }

  if (remaining() === 0) {
    return;
  }

  try {
    await withTimeout(() => logger.flush(), remaining());
  } catch (error) {
    logSecondaryCleanupFailure(logger, error); // flush_error | timeout
  }
}

async function finishListenFailure(primaryReadyError: Error): Promise<void> {
  unsubscribe();
  logError(logger, "listen", "listen_error");
  await cleanupStartupFailure(app, logger, shutdownTimeoutMs);
  rejectReadyIfPending(primaryReadyError);
  finish({ code: 1, reason: "listen_error", forced: false });
}
```

- listen rejection 与 bound-address 失败调用同一 `finishListenFailure`；不得各自复制 cleanup 或分别重新计时。
- close 拒绝后只有 deadline 尚有余量才执行一次 flush；close 挂起耗尽预算时 flush 不启动。flush 不重试。
- cleanup 的任何次级失败只做安全日志；`listen_error` 日志、`ready` rejection、`completed` 结果、listener 解除和 flush 次数按上文固定语义断言。

## 5. 任务卡

### D03-T01 · 配置输入与 Repository

```yaml
id: D03-T01
status: NOT_STARTED
depends_on: [G3_APPROVED, USER_EXECUTION_APPROVED, D03_DOC_BASELINE]
spec_refs: ["D03 Spec §2", "D03 Spec §3", "D03 Spec §6 CFG-01/02/05/06/07", "D03-IMMUTABLE-01"]
```

**实现**

1. 按 §2 安装 `node-cron@4.6.0`，运行 `npm ci`，确认 lockfile 只有一个直接版本来源。
2. 实现 §4.1 共享 parser/类型/安全错误；所有写入口在 Repository 内再次调用同一 parser，不复制字段规则。
3. 实现 §4.2 两个 Repository、`listEnabled`、稳定排序、白名单更新及完整只读映射。
4. `tests/fixtures/configuration.ts` 只复用 D01 临时文件 DB/initialize/ID 替身，提供 schema 行读取、快照或确定性 SQL 故障注入辅助；不得复制生产 parser/SQL。
5. `contracts.test.ts` 覆盖全部字段边界：空/只空白 name、Source description 空串与 null、非 boolean enabled、错误 type、危险/相对/userinfo/fragment/控制字符 URL、非法五/六字段 Cron、未知字段、POST/PATCH 禁止字段、空/数组/null PATCH、合法原文保留。
6. Repository 测试使用真实临时文件 SQLite 和确定性 ID，覆盖 create/get/list/getEnabled/update、重复 name/url、ID 冲突、not-found、稳定排序、同值更新、重开 DB 后 ID/值稳定、Source type/url/checkpoint 不能改，以及 Repository 直接收到非法输入时 0 写入。
7. 多语句 update 的失败路径必须证明事务回滚且原对象完全不变；不得只断言抛错。

**可定位测试名称**

- `source and topic parsers enforce the approved strict field contract`
- `source url and cron validation accept only approved syntax`
- `source repository persists and reopens stable configuration`
- `source repository never mutates immutable or checkpoint fields`
- `topic repository updates enabled state without touching historical rows`
- `repository validation failure performs no write`
- `repository update rolls back completely when its second SQL step fails`

**验证命令**

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
node scripts/verify-toolchain.mjs
npm install --save-exact node-cron@4.6.0
npm ci
npm test -- tests/configuration/contracts.test.ts tests/configuration/source-repository.test.ts tests/configuration/topic-repository.test.ts
npm run verify
```

**审核证据**

- base SHA、改动清单、Node/npm/process.platform/process.arch、`node-cron` 实际版本与 integrity。
- 每条命令退出码；full verify 已覆盖 toolchain/typecheck/全量 test/build/smoke/format，不重复拆跑。
- Parser/Repository 测试名称、SQL 行前后快照、回滚证据、重开 DB 证据。
- 字符边界证据只断言 Spec 约定的 `trim()` 非空与原文保留，不声明未获 Spec 批准的字符上限。
- 无未授权文件、无真实 Prompt/config/数据库/Token。

### D03-T02 · Source API、默认 DB 装配与生命周期

```yaml
id: D03-T02
status: NOT_STARTED
depends_on: [D03-T01]
spec_refs: ["D03 Spec §4 Source 部分", "D03 Spec §5", "D03 Spec §6 API-01/10/13", "D03 Spec §6 服务集成"]
```

**实现**

1. 在 `config.ts` 增加 `DATABASE_PATH` 与 `databasePath`，默认路径只在一个常量定义；空值按 `ConfigError`，成功值绝对化，错误/日志不回显路径。
2. 在 `app-assembly.ts` 实现调用者注入与 owned DB 两条路径；创建缺失父目录，调用 D01 `openDatabase/initializeDatabase`，用真实 ID 生成器创建 T01 repositories。
3. 在 default `buildApp` 中把 repositories 交给唯一 `route-registry.ts`，但本卡只注册 Source plugin。owned app 可在内存/构造期持有 Topic repository，但不得提前暴露 Topic 路由。
4. `source-routes.ts` 实现 GET 列表、GET 详情、POST、PATCH 与 Spec §4 路径/状态码；scoped auth 使用 `onRequest`，query 必须为空；列表返回 `{items}`。
5. `http-errors.ts` 只挂载在管理插件 scope。JSON/Content-Type/过大 body/Repository 错误映射固定，不泄漏 Fastify/Zod/SQLite/US 路径。
6. `buildApp` 成功 owned DB 后注册且仅注册一个 onClose；普通 app.close 关闭一次。初始化或注册失败时由装配层关闭刚打开的 DB 一次，不交给进程退出兜底，也不进入 `startServer` cleanup。注入 repositories 时不关闭调用者连接。
7. 在 `lifecycle.ts` 把 listen rejection 与 `isAddressInfo()` 失败统一到单一 cleanup 函数：以同一 deadline 依次执行一次 `app.close()` 和一次 `logger.flush()`，每步仅使用剩余预算；无论哪步失败或挂起，都恰好一次结算 ready/completed、解除 listeners，并保留 `listen_error` 主结果与既有日志断言。close 失败仍尝试一次有剩余预算的 flush；close 耗尽预算时不再启动 flush；flush 失败/挂起只记录次级 `flush_error`/`timeout`。
8. 更新 `tests/app.test.ts`、`tests/config.test.ts`、`tests/fixtures/forced-exit-entry.mjs`、`tests/fixtures/pending-listen-entry.mjs`：所有未注入 repository 的 buildApp 测试/进程 fixture 必须显式使用临时文件 DB 路径并在退出后清理；既有 health/404/logger/lifecycle 断言保持。
9. `source-api.test.ts` 使用 `buildApp` + 真实临时文件 DB + Fastify inject 覆盖全部成功、401、400、404、413、415、503、500 和 no-side-effect 断言。
10. `app-assembly.test.ts` 覆盖父目录创建、owned DB 重开持久化、关闭一次、注入库不由 app 关闭、schema 初始化失败安全收敛、WAL/SHM 临时目录清理。失败测试先在真实临时文件 DB 中预置与冻结 schema 不兼容的 `events` 表，使 `initializeDatabase()` 确定性抛错；spy `Database.prototype.close` 证明装配层对已打开连接恰好关闭一次，且未调用 lifecycle cleanup 造成第二次关闭。不得新增 factory 测试注入。
11. 重构 `scripts/smoke.mjs` 使每个子进程使用独立临时 `DATABASE_PATH` 并清理目录；同时只用精确 `DATABASE_PATH` 更新两个既有 `.mjs` fixture 的 `main({ env })` 输入，保持 health/lifecycle 场景不变。新增 `scripts/configuration-smoke.mjs` 自动发现 `scripts/smoke-configuration-*.mjs`，由 `scripts/smoke.mjs` 在既有 lifecycle 场景后调用；T02 只提供 `smoke-configuration-sources.mjs`：真实 spawn `dist/server.js`，创建 Source，正常 SIGTERM，重启同一 DB 后读取，再正常关闭。

**Source HTTP 要求**

- POST 只接受 `name/type/url/cron/enabled?/description?` 并返回 201 完整 Source；`last_collected_at` 初值 null。
- PATCH 只接受 `name/cron/enabled/description` 至少一项并返回 200 完整 Source；任何 `id/type/url/last_collected_at`（包括同值）在写入前 400，数据库行字节级不变。
- GET 列表按 ID 升序返回全部（含停用）；GET/PATCH 不存在为 404。POST/PATCH/DELETE 均无下游任务副作用。
- 鉴权在解析前；缺失、错误、重复 Authorization 的有效或畸形写请求均为 401。单值畸形 Authorization 的既有 D01 行为保持不变，不在本卡改鉴权实现；Repository spy/DB 快照证明鉴权失败的 401 请求未查询、未写入。
- 任何 query 参数返回 400；混合合法/非法 PATCH 整单失败且 0 写入。

**可定位测试名称**

- `loadConfig resolves a non-empty database path and rejects blank values`
- `default buildApp creates directories initializes SQLite and closes owned connection once`
- `buildApp does not close caller-owned repositories`
- `source API creates lists reads and patches through a real database`
- `source API rejects immutable fields without changing the row`
- `source API authenticates before parsing malformed or oversized write bodies`
- `source API requires JSON content type after authentication`
- `source API maps storage and parser failures without leaking details or writing`
- `listen rejection closes owned resources once and flushes once within one shared budget`
- `bound address failure closes owned resources once and flushes once within one shared budget`
- `startup cleanup close rejection still attempts one bounded flush and preserves listen_error`
- `startup cleanup close hang skips flush after budget exhaustion and preserves listen_error`
- `startup cleanup flush rejection stays bounded and settles listen_error once`
- `startup cleanup flush hang stays bounded and settles listen_error once`
- `late listen rejection after shutdown does not repeat owned cleanup`
- `owned database initialization failure closes once without lifecycle double cleanup`
- `source process smoke persists configuration across restart`

**验证命令**

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node scripts/verify-toolchain.mjs
npm test -- tests/config.test.ts tests/app.test.ts tests/lifecycle.test.ts tests/configuration/app-assembly.test.ts tests/configuration/source-api.test.ts
npm run verify
```

**审核证据**

- base SHA、diff、完整命令退出码及定向测试名称。
- 真实 Source row 前后快照、owned/injected close 次数、初始化失败 close 一次、进程重启前后响应、临时 DB 清理。
- lifecycle 两个失败分支（listen rejection、bound-address 失败）均证明：owned app close 一次、正常 close 后 flush 一次、总耗时不超过单一 `shutdownTimeoutMs`、ready/completed 各结算一次、listener 清零且 `listen_error` 结果不变。每个分支都覆盖 close rejection（仍一次 bounded flush）、close hang（预算耗尽后 flush 0 次）、flush rejection（不重试）与 flush hang（有界结束）；所有路径不产生第二次 close/flush，shutdown 已开始后的 late rejection 不重复 owned cleanup，既有 D00 竞态断言继续通过。
- `DATABASE_PATH` 缺省/空白/自定义测试证据；未出现默认 `data/` 污染。
- 本卡不得宣称 Topic 路由已可用；`route-registry.ts` 仅含 Source 注册。

### D03-T03 · Topic API、装配缝与文档

```yaml
id: D03-T03
status: NOT_STARTED
depends_on: [D03-T02]
spec_refs: ["D03 Spec §4 Topic 部分", "D03 Spec §5", "D03 Spec §6 API-02/13", "D03 Spec §6 CFG-03/04/05"]
```

**实现**

1. 基于 T02 合并 commit 建分支；只在 `route-registry.ts` 追加 Topic plugin 注册，不改 Source 行为。
2. `topic-routes.ts` 实现 GET 列表/详情、POST、PATCH，复用 T02 auth/error 契约与 T01 topic repository。列表 `{items}` 按 ID 升序并包含停用 Topic。
3. Topic POST 接受 `name/description/enabled?`；PATCH 接受 `name/description/enabled` 至少一项。未知/POST id/PATCH id/空 PATCH/非法 type 在写入前 400；不存在为 404。
4. Topic 更新与重新启用只写 `topics`；测试在关联/发布/Event/Knowledge 表放置 sentinel 行，并对全部 11 张业务表做前后快照，证明非 `topics` 表不增删改、无下游副作用。真实 Matching 快照仍记 `NOT_RUN`。
5. `topic-api.test.ts` 覆盖 200/201/400/401/404/413/415/503/500、listEnabled、真实临时 DB 重启持久化、鉴权先于解析、0 部分写入和 sentinel 不变。
6. 新增 `smoke-configuration-topics.mjs`，由既有自动发现 runner 执行：真实 spawn 默认 `dist/server.js`，POST 一个 Topic，SIGTERM，重启同一临时 DB，GET 列表/详情并关闭；不得修改 runner。
7. `README.md` 一次性补充 D03 最终文档：`DATABASE_PATH` 默认与显式设置、Source/Topic 端点、Bearer、字段、状态码、不可变 Source type/url、检查点只读、Cron 仅 validate 不 schedule、默认持久化路径及临时 DB 测试说明。

**可定位测试名称**

- `topic API creates lists reads patches and persists through restart`
- `topic API authenticates before parsing invalid write requests`
- `topic API requires JSON content type after authentication`
- `topic API rejects empty unknown and malformed updates without partial writes`
- `topic API does not alter historical associations publications or downstream tables`
- `topic listEnabled excludes disabled topics without deleting history`
- `topic process smoke persists configuration across restart`

**验证命令**

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node scripts/verify-toolchain.mjs
npm test -- tests/configuration/topic-api.test.ts tests/configuration/source-api.test.ts tests/app.test.ts
npm run verify
```

**审核证据**

- base SHA、仅允许的重叠文件 diff、完整命令退出码与定向测试名称。
- 真实 Topic row 前后快照、历史 sentinel 不变、进程重启响应、401 无读写、owned DB 关闭。
- Source/D03 文档与最终路径/状态码一致；无调度、匹配、历史重分析或发布声明。

## 6. D03 集成 Gate

三卡均按 §1.2 完成 `Worker REVIEW → Lead APPROVED + frozen exact tree → Architect APPROVED → exact candidate commit → --no-ff merge → 合并后 verify → PASS` 后，Lead 在独立干净 worktree/临时 DB 环境完成本地集成 Gate：

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
node scripts/verify-toolchain.mjs
npm ci
npm run verify
git status --short
```

Gate 证据必须包括：

- 三卡 merge commit SHA、每卡改动路径、Lead/Architect 结论。
- 每卡 candidate SHA/tree、Architect approved tree、`--no-ff` merge SHA、合并后定向测试与 full verify 结果；任一缺失不得记录任务 PASS。
- 干净快照 `npm ci` 与 full verify 的退出码；Source/Topic 两个真实进程 smoke 自动发现并执行；无 `data/`、`.db`、WAL/SHM 或真实 config 残留。
- Fastify inject + 真实临时 SQLite 的 GET/POST/PATCH、列表/详情、启停、404、401、400、413、415、503、500；不可变字段 0 写入；Repository-level 与 API-level 一致。
- DB 重启持久化、owned connection 一次关闭、注入连接不由 app 关闭；health/404/日志/lifecycle/smoke 回归。
- Repro/执行记录包含 Node/npm、darwin-arm64；Ubuntu CI 在未 push/运行前明确 `REMOTE_CI=NOT_RUN`，不得以本地结果代替。
- 真实 RSS、Scheduler 执行、Matching 快照、LLM、历史回溯及发布均为 `NOT_RUN`，不纳入 D03 确定性配置 API 的最终验收声明。

### 6.1 本地 Gate 与里程碑最终验收

状态必须分开记录，不得把本地结果写成远程或最终结论：

```text
D03_CARD_STATUS=T01_PASS|T02_PASS|T03_PASS
D03_LOCAL_GATE=APPROVED|NOT_APPROVED
D03_REMOTE_CI=NOT_RUN|PASS|FAIL
D03_FINAL_PASS=NOT_ISSUED|ISSUED
```

- `D03_LOCAL_GATE=APPROVED`：三卡均已在合并 commit 上验证并 PASS，且 §6 干净快照 `npm ci`、定向测试、full verify、真实进程 smoke、资源清理和证据审核全部通过。
- `D03_REMOTE_CI`：只有项目负责人另行明确授权 push，并实际观察到与待验收提交精确 SHA 对应的 CI Success，才可记 `PASS`；未授权、未 push、未运行或运行失败均不得记 PASS。
- `D03_FINAL_PASS=ISSUED`：仅当 `D03_LOCAL_GATE=APPROVED` 且 `D03_REMOTE_CI=PASS`（同一精确 SHA）后，由 Architect 记录最终验收。当前未获 push 授权，故 `REMOTE_CI=NOT_RUN`、`FINAL_PASS=NOT_ISSUED`。

推送到远程和触发 CI 需要负责人另行授权；本 Plan、G3 审批和本地 Gate 均不授予 push 权限，也不构成 D03 FINAL_PASS。

## 7. 交接模板与失败收敛

每卡 Worker 回报至少包含：

```text
task:
base_sha:
changed_files:
case_ids:
commands_and_exit_codes:
targeted_tests:
full_verify:
db_lifecycle_evidence:
no_side_effect_evidence:
deviations_or_blockers:
status: REVIEW
```

Lead 审核顺序：先核对写集/依赖/API 契约，再读失败路径与事务/资源生命周期，最后复跑聚焦测试和 full verify。不能仅凭 Worker 摘要宣布 PASS。

同一问题连续两轮修复仍失败时停止重试，区分实现、测试、任务或 Spec 根因。若发现 Spec 缺字段、状态码冲突、新依赖、DDL 变化或必须触碰非授权文件，Worker 标 `BLOCKED`；Lead 提交具体证据给 Architect，由 Architect 决定是否修订 Spec。任何人不得在 Plan 之外自行更改契约。
