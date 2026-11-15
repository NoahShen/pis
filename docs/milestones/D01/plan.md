# D01 Plan · SQLite 与事务基础

> 版本：v0.2 · 2026-11-15
> 状态：**REVIEW · Lead 修订稿；G3 复审待 Architect 完成；用户执行批准 PENDING**
> 起草：Paseo Lead（仅规划）
> 依据：[Intent v0.1](intent.md)（APPROVED）、[Spec v0.1](spec.md)（APPROVED）、[数据库设计 v1.0](../../PIS_数据库设计_v1.0.md) §1.5～§1.8、[任务拆分 v0.1](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) D01、[测试设计 v0.2](../../PIS_V1_测试用例设计_v0.2.md) §4.10。
> 代码基线：`7ab2b4f732e61aed7218376e45a4c1f1e77f78fe`（D01 Intent/Spec 文档提交）；D00 有效基线为 `8f5681081507a738d072fd9c965f037e7facebd0`。

## 1. 执行边界

本 Plan 只落实已批准的 D01-T01～T04，不重定义 Spec，不新增业务表、迁移框架、ORM、公开 API、Runtime、队列或业务服务，不修改 Prompt、权威 DDL 和原有未跟踪 `config/`。

正式派发 Worker 必须同时满足：

1. Architect 完成 G3 并把本文件状态改为 `APPROVED`。
2. 项目负责人已审核本 Plan，并明确回复批准执行。当前 `USER_EXECUTION_APPROVAL=PENDING`。
3. Lead 从已合并 D01 文档基线创建独立任务分支并记录 base SHA。
4. T01 使用现有精确工具链 `/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin`；执行时显式置于 `PATH` 前部。`verify:toolchain` 失败时不得安装依赖、改写 `package-lock.json` 或运行 `npm ci`。
5. 四卡严格串行、每卡由新的 Paseo Worker 领取；Worker 不自行 stage/commit，不宣称 PASS。

分支工作结果只能记为 `REVIEW`。只有 Lead 审核、Architect 轻量复核并合并后，才可凭合并 commit 记录 `PASS`。

## 2. 依赖、工具链与平台证据

### 2.1 精确依赖

T01 仅新增以下直接依赖，不用 `latest`、范围版本或额外 SQLite 包装层：

| 类型 | 包 | 精确版本 | 已核对 metadata |
| --- | --- | --- | --- |
| dependency | `better-sqlite3` | `13.2.0` | `engines.node >=22`；依赖 `node-addon-api ^8.0.0`；registry integrity `sha512-Z8Q/9x/uNyKxA1v4FNodyItRVRw1TeKBrmj32JhxhR0ceNcBY+wMobt/Bv7M7TzwPAXjnZRtNaEsATnUZSKWZQ==` |
| devDependency | `@types/better-sqlite3` | `9.6.0` | 无 engines；依赖 `@types/node *`；registry integrity `sha512-ZEEwBSgMu7GYJOynoagg5X9JbxfL6dTJDsgViJIqh67jV44kyOr9RXfmFjLK5rzC4MWssP06t9hu/JwGDnUbCg==` |

以上为 2026-11-15 registry 只读元数据核对结果；`better-sqlite3@13.2.0` 与 `@types/better-sqlite3@9.6.0` 当时均为 latest。`node >=22` 只表示发布者声明，**不表示 Node 26.13.1、darwin-arm64 或 ubuntu-latest 已兼容**。最终安装版本及 integrity 只以实际生成的 `package-lock.json` 为准。

安装顺序固定为：

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node scripts/verify-toolchain.mjs
npm install --save-exact better-sqlite3@13.2.0
npm install --save-dev --save-exact @types/better-sqlite3@9.6.0
npm ci
```

若 native 安装、加载、SQLite 能力或锁文件出现不兼容，T01 标 `BLOCKED`，提交 Node/npm、平台/架构、驱动与实际 SQLite 版本、失败阶段和可复现命令；不得切换 Node、驱动、预编译策略或回退到 `sqlite3`。

### 2.2 运行前置

- 精确工具链已存在：`/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin` 提供 Node `v26.13.1` / npm `11.20.0`。默认 shell 的 Node `v26.7.0` / npm `12.0.2` 不满足门禁，但只需显式 prepend 上述目录，不需要重新准备工具链，也不是 T01 的预设阻塞项。
- Lead 已用该目录运行 `node --version`、`npm --version` 和 `npm run verify:toolchain`，分别得到 `v26.13.1`、`11.20.0` 与退出码 0。T01 Worker 仍须原文记录 `node --version`、`npm --version`、`node --eval "console.log(process.execPath)"` 并重跑门禁；任一失败即停止，版本不符时再记 `BLOCKED`。
- 本地必须记录实际 `process.platform / process.arch` 和 `SELECT sqlite_version()`。验收目标为当前 darwin-arm64 与现有 ubuntu-latest CI；未实际运行平台记 `NOT_RUN`，不外推兼容性。
- 不全局安装或升级 npm，不修改系统默认 Node，不绕过 D00 的 `verify:toolchain`。

## 3. 固定文件边界与依赖图

| 任务 | 独占新增/修改路径 |
| --- | --- |
| T01 | `package.json`, `package-lock.json`, `src/database/open-database.ts`, `tests/database/connection.test.ts`, `tests/database/runtime-capabilities.test.ts`, `tests/fixtures/database.ts` |
| T02 | `package.json`, `package-lock.json`, `src/database/schema.sql`, `src/database/schema.ts`, `scripts/copy-database-assets.mjs`, `scripts/database-smoke.mjs`, `tests/database/schema-consistency.test.ts`, `tests/database/schema-constraints.test.ts`, `tests/fixtures/schema-data.ts`, `README.md` |
| T03 | `src/database/transaction.ts`, `src/database/error-classification.ts`, `tests/database/transaction.test.ts`, `tests/database/transaction-types.test.ts`, `tests/database/error-classification.test.ts`, `tests/database/time-storage.test.ts`, `tests/fixtures/locking-client.mjs` |
| T04 | `src/database/event-search.ts`, `tests/database/event-search.test.ts`, `tests/fixtures/faulty-database.ts`, `README.md`（仅补充 FTS 维护边界） |

共同规则：

- 后续卡可只读复用先前接口/Fixture，不在本卡重写替代实现。
- 不修改 `tsconfig*.json`、`vitest.config.ts`、D00 HTTP/lifecycle 源码、格式脚本、CI workflow、`.gitignore`、`.prettierignore` 或 docs 权威文件。
- 新增 `.sql` 是有意排除在 Prettier 白名单外的冻结资源；`.ts`/`.mjs` 均落在现有格式白名单内。
- 文件所有权冲突或需要越过上表时，Worker 停止并上报 Lead，不夹带修改。

依赖图：

```text
G3 APPROVED → USER_EXECUTION_APPROVED → T01 toolchain/native capability
  → REVIEW/Architect → merge
  → T02 frozen DDL/assets/constraints
  → REVIEW/Architect → merge
  → T03 sync transaction/errors/time
  → REVIEW/Architect → merge
  → T04 Event FTS refresh/rebuild/search
  → REVIEW/Architect → merge
  → D01 integration Gate
```

## 4. 固定公共接口与行为

### 4.1 连接与初始化

```ts
import type Database from "better-sqlite3";

export function openDatabase(databasePath: string): Database.Database;
export function initializeDatabase(db: Database.Database): void;
```

- `openDatabase()` 不解析环境变量，不创建父目录，不缓存连接。成功返回的连接必须满足 `journal_mode=wal`、`foreign_keys=1`、`busy_timeout=5000`。
- 配置失败时关闭刚创建的连接，再抛出原错误；不能返回半配置连接。
- `initializeDatabase()` 每次从模块相邻的 `schema.sql` 读取，不依赖 cwd、不读 docs 路径；在驱动事务中执行冻结 DDL，全部成功才提交。
- 初始化不是迁移器。重复调用只对当前冻结结构幂等，不承诺修复任意旧 schema。

### 4.2 事务与错误

```ts
type SyncResult<T> = T extends unknown
  ? [T] extends [PromiseLike<unknown>]
    ? never
    : T
  : never;

type SyncOperation<F extends () => unknown> = F extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => SyncResult<Result>
  : never;

export function withTransaction<F extends () => unknown>(
  db: Database.Database,
  operation: F & SyncOperation<F>,
): SyncResult<ReturnType<F>>;

export type SqliteErrorCategory =
  | "busy_locked"
  | "constraint"
  | "sqlite"
  | "unknown";

export function classifySqliteError(error: unknown): SqliteErrorCategory;
```

- 顶层使用 `BEGIN IMMEDIATE`；已有事务内由 better-sqlite3 的嵌套 transaction 机制使用 SAVEPOINT。成功返回回调值并提交/释放对应层级，异常回滚/回滚保存点并重新抛出原错误。
- 入参用独立函数类型 `F` 精确捕获回调返回类型，再以交叉类型要求该回调满足 `SyncOperation<F>`；async function、直接 PromiseLike，以及普通值 `| PromiseLike` 的联合均在调用点产生类型错误，而不是仅把返回值变成 `never`。类型用例必须用实际生效的 `@ts-expect-error` 证明拒绝，不能使用 `@ts-ignore`、`any` 或沉默断言。
- 运行时仍在调用可识别 async function 前直接失败；普通函数返回 any thenable 时，在驱动 COMMIT 前检查并抛错触发回滚。类型保护不替代运行时保护。
- 分类只依据 SQLite `code`：`SQLITE_BUSY*`/`SQLITE_LOCKED* → busy_locked`，`SQLITE_CONSTRAINT* → constraint`，其他 `SQLITE_* → sqlite`，否则 `unknown`；不按 message 分类、不包装或吞掉原错误。

### 4.3 Event FTS

```ts
export function refreshEventSearch(
  db: Database.Database,
  eventId: string,
): void;

export function rebuildEventSearch(db: Database.Database): void;
```

每个 Event 的 `search_text` 按固定顺序组成：

1. `events.title`、`entity_name`、`subject`、`scope`、`description`；
2. 已确认 aliases：先 `ORDER BY alias COLLATE BINARY ASC`，只取 `alias`；
3. 全部 Event Updates：先 `ORDER BY discovered_at ASC, id ASC`，每项取 `title`、`description`。

各字段/行之间固定使用单个换行符 `\n`，不读取 `content_id` 作为索引文本、不读未确认别名、不使用最近 10 条截断、不做任意字段 `trim`。相同业务数据重复聚合必须字节一致。

- `refreshEventSearch` 在该 Event 的同一事务中先删除全部匹配 `event_id` 的索引行，再插入恰好一条；Event 不存在时只删除残留并返回。
- `rebuildEventSearch` 在一个事务中清空派生表，按 `events.id COLLATE BINARY ASC` 重建所有 Event；失败恢复旧索引，空库成功得到空索引。
- 不新增触发器、不新增 FTS 唯一约束、不使用 contentless delete 命令。

## 5. 任务卡

### D01-T01 · 原生依赖、连接与运行能力

```yaml
id: D01-T01
status: NOT_STARTED
depends_on: [G3_APPROVED, USER_EXECUTION_APPROVED, D01_DOC_BASELINE, EXACT_TOOLCHAIN_READY]
spec_refs: ["D01 Spec §2", "D01 Spec §6 T01"]
```

**实现**

1. 完成 §2 的双版本断言，先 `npm run verify:toolchain`，再按固定顺序安装两个 exact 依赖并 `npm ci`。
2. 在 `open-database.ts` 实现 §4.1；模块导入不打开文件，不创建全局 DB。`journal_mode` 验证大小写不敏感，PRAGMA 数值必须为外键 `1`、busy timeout `5000`。
3. 失败路径 catch 中先调用 `db.close()`（若仍打开）再重新抛错；正常资源始终由调用者 finally 关闭。
4. `tests/fixtures/database.ts` 只提供基于 D00 `withTempDirectory()` 的隔离临时路径/连接清理助手；不得复制 Clock、ID 或临时目录实现。
5. `connection.test.ts` 用真实文件覆盖：WAL、两个独立实际连接各自的 PRAGMA、关闭后文件清理，以及打开内容不是 SQLite 数据库的既有临时文件时配置 PRAGMA 抛错并关闭已创建连接。
6. `runtime-capabilities.test.ts` 在独立临时文件库创建测试用 trigram FTS5，验证至少 3 字符中文命中，并验证 `json_valid()`/`json_type()`；不提前创建冻结业务 DDL。
7. 构建后从 `dist/database/open-database.js` 动态 import 并真实打开/关闭临时库，证明 ESM 编译产物可加载原生模块。

**可定位测试名称**

- `openDatabase enables WAL foreign keys and busy timeout`
- `openDatabase configures every independent connection`
- `openDatabase closes a connection when database configuration fails`
- `runtime exposes trigram FTS5 and JSON array functions`
- `compiled ESM entry can load better-sqlite3`（build 后 compiled probe）

**验证命令**

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
node scripts/verify-toolchain.mjs
npm install --save-exact better-sqlite3@13.2.0
npm install --save-dev --save-exact @types/better-sqlite3@9.6.0
npm ci
npm test -- tests/database/connection.test.ts tests/database/runtime-capabilities.test.ts
npm run verify
node --input-type=module -e "import { mkdtemp, rm } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; const dir = await mkdtemp(path.join(tmpdir(), 'pis-d01-')); try { const m = await import(pathToFileURL(path.resolve('dist/database/open-database.js')).href); const db = m.openDatabase(path.join(dir, 'compiled.db')); db.close(); } finally { await rm(dir, { recursive: true, force: true }); }"
```

**审核证据**

- base SHA、改动清单、两条版本命令原文、实际 `process.platform/arch`、驱动包版本、`sqlite_version()`。
- install/ci/聚焦测试/full verify/build 后 compiled ESM 的逐命令退出码；full verify 已覆盖 toolchain、typecheck、全量测试、build、smoke 和格式检查，不重复执行这些子命令。
- `package-lock.json` 中两个直接依赖和关键传递依赖均为解析后的精确记录；本地预编译或源码构建事实如实记录。
- 无网络外部服务、无 docs/Prompt/config 改动、无未授权文件。

### D01-T02 · 冻结 DDL、构建资源与数据库约束

```yaml
id: D01-T02
status: NOT_STARTED
depends_on: [D01-T01]
spec_refs: ["D01 Spec §3", "D01 Spec §6 T02"]
```

**实现**

1. 从数据库设计 §1.5 的唯一 ` ```sql ` fenced block 生成 `src/database/schema.sql`；除 CRLF/LF 规范化外不得改写，不保留第二份可独立编辑结构。
2. `schema-consistency.test.ts` 只从数据库文档提取唯一 SQL block，并与 `src/database/schema.sql` 做仅换行规范化后的完全相等断言；该测试不读取、不导入、不要求 `dist` 已存在。
3. `schema.ts` 使用模块相对 URL 读取 `./schema.sql`；`initializeDatabase()` 用 better-sqlite3 的同步 transaction 一次性执行 DDL。T02 固定该实现，不承诺或暗示后续 T03 修改 `schema.ts`。
4. 将 `build` 改为编译后调用 `scripts/copy-database-assets.mjs`；复制器只解析 `src/database/schema.sql → dist/database/schema.sql`，拒绝意外根路径，不复制 docs。
5. `scripts/database-smoke.mjs` 仅在 build 后运行：只导入 `dist/database/*.js`，先把 cwd 切到自身创建的临时目录，再在临时文件库初始化并验证 11 个业务表、`event_search`、JSON/trigram 能力，finally 关闭并删除 DB/WAL/SHM。脚本另以 `src/database/schema.sql` 为构建预期值，断言 `src/dist` schema 字节一致；源码 SQL 仅作构建产物核对，绝不作为 compiled 初始化时的运行时回退。
6. 在 `package.json` 增加 `database:smoke`，并把 fresh-build 的 `smoke` 扩展为 `build → 原 D00 smoke:run → database:smoke`。保留原有进程信号与端口释放验证。
7. 约束测试使用真实隔离 DB 和满足 FK 的最小 seed，不做通用 seed 框架、不 mock SQL 结果。
8. README 只补充 D01 数据库模块范围、构建资源、`database:smoke` 以及“初始化不是迁移器”。

**必须验证**

- 业务表精确为 `sources, contents, events, event_updates, knowledge, topics, published_items, source_items, event_content_links, event_entity_aliases, topic_associations`，另存在 `event_search`；FTS shadow tables/autoindexes 不计作业务表。
- 11 个显式索引名称及 unique/partial 属性来自冻结 DDL；不增加 schema 版本表或 `content_hash`/`entry_key`。
- `UNKNOWN` completeness、非法 category、`enabled=2`、非法 target_type 被 CHECK 拒绝。
- 重复 `knowledge.content_id`、重复 `(published_items.target_type,target_id)`、重复 evidence/alias/topic-association 联合主键均拒绝，原记录不变。
- 非 NULL 重复 `source_items.content_id` 拒绝，多个 NULL 允许；非法普通 FK 拒绝，多态 `target_type,target_id` 的裸 SQL 悬空行按现实允许，不能伪造“数据库已拒绝”断言。
- `findings_json` 非 JSON/object 拒绝，JSON array 可写。
- 空库初始化成功；再次初始化保留 seed；预先存在错误 `events` 表导致后续索引创建失败时，本次新建的其他表全部回滚，原错误表保留。

**可定位测试名称**

- `bundled schema exactly matches the frozen database design SQL block`
- `database smoke verifies copied schema bytes`
- `database smoke initializes compiled database modules`
- `initializeDatabase creates eleven business tables plus event search`
- `initializeDatabase is idempotent for the current schema and preserves data`
- `initializeDatabase rolls back all new structures on DDL failure`
- `schema rejects invalid enums booleans and findings JSON`
- `schema enforces unique constraints without overwriting existing rows`
- `schema enforces ordinary foreign keys and documents polymorphic boundaries`

**验证命令**

```text
npm test -- tests/database/schema-consistency.test.ts tests/database/schema-constraints.test.ts
npm run verify
```

**审核证据**

- DDL 提取 diff、源码单测的 docs/src 一致性证据、full verify 内 build 后 database smoke 的 `src/dist` 字节/hash 证据、数据库表/索引清单。
- check/FK/unique/JSON/重复初始化/失败回滚逐测试结果及最小 SQL 输入。
- `dist/database/schema.sql` 由 full verify 的 build 生成且字节一致，compiled DB smoke 在 docs 路径不可参与运行时仍成功；没有测试在 build 前读取 `dist`。
- 原有 D00 smoke 仍通过；无业务时间语义、事务通用 API 或 FTS 聚合提前混入。

### D01-T03 · 同步事务、错误分类与时间存取

```yaml
id: D01-T03
status: NOT_STARTED
depends_on: [D01-T02]
spec_refs: ["D01 Spec §4", "D01 Spec §6 T03"]
```

**实现**

1. `transaction.ts` 实现 §4.2；使用 `db.transaction(runOperation).immediate()`，在驱动提交前检查 thenable，并对可识别 `AsyncFunction` 在执行前拒绝。
2. `transaction-types.test.ts` 提供正/负编译用例：同步 primitive、record 和普通非函数 `then` 字段可推断；async function、返回 PromiseLike 的普通函数、显式 `T | PromiseLike<T>` 联合及条件表达式产生的混合联合均须被调用点拒绝。每条负数使用能实际消费诊断的 `@ts-expect-error`；若未来签名失效，`npm run typecheck` 必须因未使用的抑制注释失败。禁止 `@ts-ignore`、`any` 逃逸或只在运行期验证类型。
3. 不手工维护 BEGIN/SAVEPOINT 状态机；依赖驱动的嵌套语义，测试外层失败、内层失败、外层捕获内层失败后继续等路径。
4. `error-classification.ts` 只按 `code` 字符串分类，不用 message。锁测试保持生产 `busy_timeout=5000`；需要快速超时的专项测试可只对测试连接显式下降到 `50`，不能修改 `openDatabase()` 默认值。
5. `locking-client.mjs` 是独立 Node 进程探测：直接 `import Database from "better-sqlite3"`（或由父进程传入序列化数据），只接收 DB 路径，不导入 `dist`，不把父连接对象跨进程传递。父连接持有 `BEGIN IMMEDIATE`，子进程连接同一临时文件库并发写入；通过 stdout 完成握手，父连接释放后子进程成功。所有子进程/连接均有界等待和 finally 清理，不靠无限 sleep。
6. `time-storage.test.ts` 用 D00 `formatTimestamp()` 向真实 `contents.created_at` 写入固定时间点，再从 DB 读回完全相同的 `+08:00` TEXT；不调用 `CURRENT_TIMESTAMP`、不新增 DB 时间触发器。
7. 测试覆盖 busy/locked、constraint、其他 SQLite、普通 Error/无 code 输入；分类函数不记录或返回 SQL 参数、路径、正文。

**可定位测试名称**

- `withTransaction commits all synchronous writes on success`
- `withTransaction rolls back all writes and rethrows the original error`
- `withTransaction uses savepoints for nested success and failure`
- `withTransaction rejects recognizable async callbacks before invoking them`
- `withTransaction rolls back a returned thenable without claiming cancellation`
- `withTransaction acquires a top-level immediate write transaction`
- `withTransaction type surface accepts synchronous results and rejects promise-like callbacks`
- `real independent process waits for a held write transaction and then succeeds`
- `classifySqliteError distinguishes busy constraint sqlite and unknown by code`
- `formatTimestamp round-trips unchanged through SQLite TEXT`

**验证命令**

```text
TZ=UTC npm test -- tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/error-classification.test.ts tests/database/time-storage.test.ts
TZ=Asia/Shanghai npm test -- tests/database/transaction.test.ts tests/database/transaction-types.test.ts tests/database/error-classification.test.ts tests/database/time-storage.test.ts
npm run verify
```

**审核证据**

- 成功/失败/嵌套/async 执行次数与 DB 最终行 facts；原始异常 identity 或等价证据。
- typecheck 通过且每个负数 `@ts-expect-error` 均有实际诊断、无“未使用抑制”；同步正例返回值未退化为 `never`。
- 独立进程 PID、start/released/exit 时间和退出码；测试总时长有界，临时 DB/WAL/SHM 已清理。
- 两种 TZ 聚焦测试结果一致；实际运行平台记录。
- DB-12 只记录 busy timeout/错误分类基础，Runtime 有限重试明确 `NOT_RUN`；DB-09 的六业务阶段故障注入仍属后续模块。

### D01-T04 · Event FTS 聚合、刷新与全量重建

```yaml
id: D01-T04
status: NOT_STARTED
depends_on: [D01-T03]
spec_refs: ["D01 Spec §5", "D01 Spec §6 T04"]
```

**实现**

1. `event-search.ts` 实现 §4.3。聚合查询显式列出字段和 `ORDER BY ... COLLATE BINARY`，不依赖 SELECT 默认顺序或本地化 locale。
2. `refreshEventSearch` 通过 T03 `withTransaction()` 原子删除旧行并插入新行；不存在 Event 只删除 orphan。
3. `rebuildEventSearch` 在一个事务中清空并从 Event 主表全量生成；内部每 Event 复用同一聚合函数，不调用 LLM、不读取 docs、不改业务事实。
4. 单 Event 刷新、全量重建均不接受“跳过 transaction”测试参数，不增加公开 fault hook。
5. `faulty-database.ts` 使用仅测试侧 Proxy 精确让指定的 `INSERT INTO event_search` 抛错；其他 SQL/PRAGMA/transaction 仍由真实 better-sqlite3 文件库执行，用来证明 COMMIT 前故障回滚，不替代约束或 FTS 行为断言。
6. 合成数据至少包含 Event A/B、A 的 12 条历史 Update、确认 alias、未确认/不存在 alias 场景；最旧 Update 为第 1 条，验证不被最近 10 条截断。
7. README 补充 FTS 是派生索引、只能经 T04 函数刷新/重建；后续业务事务必须在同一短事务内显式调用刷新函数。D01 不新增 SQL 触发器、不做自动挂接，也不把触发器留作默认后续实现。

**必须验证**

- 同一 Event 连续 refresh 两次逻辑上恰好 1 行，search text 包含固定 Event 字段、确认 alias 和全部 12 条 Update，顺序与约定完全一致。
- 最旧第 1 条 Update 的至少 3 字符合成中文词可通过 `MATCH` 命中；1～2 字符 entity/alias 通过普通 `idx_events_entity_name`/`idx_event_entity_aliases_alias` 精确查询验证。
- refresh A 不改变 B 的 FTS 行，也不删除/修改 Event/Update/Alias 业务事实；人工重复 A 索引后 refresh 收敛为 1 行。
- 不存在 Event 的残留索引可由同一函数清除，不创建 Event。
- 人为注入重复/过时索引后 rebuild 去除重复且与逐 Event refresh 结果一致；空库 rebuild 成功。
- 在 DELETE 后、INSERT 时注入故障，refresh 恢复旧 FTS 行；rebuild 中途故障恢复重建前全部旧索引，业务表始终不变。
- 行数、search_text、MATCH 结果和业务表快照共同断言，不能只检查 FTS 函数未抛错。

**可定位测试名称**

- `refreshEventSearch writes exactly one deterministic row per event`
- `event search includes confirmed aliases and all historical updates`
- `event search finds a clue older than the ten most recent updates`
- `refreshing one event leaves another event and business facts unchanged`
- `refreshEventSearch removes stale rows for an absent event without creating it`
- `rebuildEventSearch converges duplicate and stale derived rows`
- `refresh and rebuild roll back FTS changes on injected insert failure`
- `short entity and alias terms use ordinary indexed exact lookup`

**验证命令**

```text
npm test -- tests/database/event-search.test.ts
npm run verify
```

**审核证据**

- A/B 行数、A 的固定 search text 全文（仅合成文本）、12 条历史与 alias 顺序、MATCH/普通索引结果。
- refresh/rebuild 前后业务表与 FTS 快照 diff；故障注入点和回滚结果。
- compiled DB smoke 和 full verify 退出码；确认没有新增触发器、API、LLM、候选排序或最近 10 条过滤。

## 6. 测试数据与资源生命周期

- 所有真实 DB 测试经 D00 `withTempDirectory()` 使用每次唯一路径；默认不触碰仓库、`config/`、用户目录或私有数据库。
- 每个 `Database` 在 finally 关闭；额外连接、独立进程和回调失败均关闭后才能删目录。
- 不断言临时目录的绝对名、locale、平台路径分隔符或 SQLite 未承诺的 rowid；稳定值只来自显式 ID、排序键和约定 search text。
- 时间固定输入；锁测试通过进程/标准输出握手而不是猜测任意长时间；所有 child process 有界超时并在 finally 终止兜底，兜底强杀不算成功。
- 测试不联网、不访问 LLM、不监听 HTTP（除保留的 D00 smoke），不依赖 CI 时区、运行顺序或未生成的 `dist`。`npm test` 阶段不得读取 `dist`；T03 锁进程直接使用已安装驱动和传入的 DB 路径。
- `dist` 相关检查只在 build 之后运行：T01 compiled ESM probe、T02 compiled database smoke 和既有 D00 smoke 均属于 post-build 步骤，不能反向成为源码单测前置条件。
- 临时 fixture 可以写真实 SQL，但不修改冻结 DDL 来放宽失败用例。

## 7. 统一验证与证据格式

每卡先运行定向测试，再执行一次 `npm run verify`。`verify` 已串行覆盖 `verify:toolchain → typecheck → 全量 test → build → smoke → format:check`，不得在无新故障时重复这些子命令；只有 T01 的 compiled ESM probe 和 T02 database smoke 等明确要求 build 产物的步骤可在该次 verify 后执行一次。

```text
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version
npm --version
<本卡定向测试>
npm run verify
<仅本卡声明的 post-build probe/check>
```

每卡 Worker 回报只包含：

1. Task ID、base/branch、base SHA、改动文件。
2. 逐命令退出码、测试通过/跳过数量和可定位测试名。
3. Case 映射、实际证据边界、`NOT_RUN`、偏离和 blockers。
4. 数据库表/索引、锁进程、资源清理或 FTS facts 的最小证据，不粘贴完整日志、Prompt、Token、正文或私有路径。
5. `git status --short` 与确认未越权修改 docs/Prompt/config/CI。

D01 各卡 Case 映射：

| 卡 | 覆盖 | 仍为后续/NOT_RUN |
| --- | --- | --- |
| T01 | DB-01 运行时驱动/JSON/trigram 部分、DB-02 | 完整 DDL、Linux CI、跨平台 |
| T02 | DB-01、DB-03～DB-08 数据库层、DB-15 | 业务层输入校验、部分业务状态 |
| T03 | DB-09 基础短事务、DB-10 基础时间格式、DB-12 基础 | 六业务阶段、全字段语义、Runtime 重试 |
| T04 | DB-11、DB-14 初始版 | 业务事务显式调用 FTS 的集成、完整候选召回/排序 |

DB-13 在 T02 只能证明 SQLite 多态引用边界；业务服务拒绝悬空目标仍属后续模块，不能标整项 PASS。

## 8. 集成 Gate

四卡合并后，Lead 组织 Architect 验收：

1. 从合并 commit 创建不含 `node_modules/dist/coverage` 的干净副本。
2. 将现有精确工具链目录 prepend 到 `PATH`，确认 Node/npm 精确二元组。
3. 运行 `npm ci`，再运行 `npm run verify`；保存完整退出序列与测试摘要。
4. 从第 3 步 verify 的 build/smoke 证据核对 `dist/database/schema.sql`、src/dist 字节一致和 compiled DB import/database smoke；无新故障不重复运行数据库脚本。
5. 在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 分别运行 D01 聚焦测试。
6. 在 darwin-arm64 保存本地证据；代码推送后确认既有 ubuntu-latest CI 实际运行，未运行则记 `NOT_RUN`。
7. 检查最终 11 业务表 + FTS、原始业务数据未被测试修改、没有 schema 扩展、没有越界 docs/Prompt/config diff。

D01 只有在四卡与上述集成 Gate 全部完成后方可申请里程碑验收。Plan/G3 本身不授予 PASS。

## 9. 风险与回滚

| 风险 | 监控/处理 | 回滚 |
| --- | --- | --- |
| Node 26 / native addon 不兼容 | 精确工具链已存在且门禁通过；T01 安装/加载/SQLite 实测，失败则 BLOCKED 并提交平台与版本 | 丢弃该任务 lock/node_modules，交 Architect；不换驱动或运行面 |
| 错误 npm 改写 lock | 安装前双版本门禁；审查 lock diff | 废弃该分支 lock，以精确工具链重生成 |
| SQL 副本与 docs 分叉 | 测试提取唯一 fenced block 并逐字比较；构建 hash 比较 | 回滚 SQL/复制脚本，修正提取，不改 docs 迎合代码 |
| 初始化失败留半套 schema | DDL 单事务；错误表注入；查询 sqlite_master | 回滚实现，不使用局部建表替代 |
| async 回调在 COMMIT 后泄漏副作用 | 类型拒绝 + 调用前判断 + thenable 提交前检查 | 阻断 T03；不引入异步事务或吞掉 Promise |
| 锁测试 flaky/无限等待 | 独立进程握手、busy timeout、child 有界清理；强杀不算通过 | 修正同步，不放宽为 mock 或增加长时间 sleep |
| FTS 重复/order drift | DELETE+INSERT，固定 `BINARY`/ID 排序，重复 refresh/rebuild | 回滚 T04，不用触发器或 UNIQUE 补丁掩盖 |
| 故障注入变成 SQL mock | Proxy 仅对一个 INSERT 抛错，READ/DDL/事务仍真实 | 移除该注入测试并 BLOCKED，不能改生产测试参数 |
| 格式工具漏掉资源/脚本 | `.ts/.mjs` 自动纳入；SQL 不在白名单；`format:check` + git diff | 回滚越界格式，不修改权威 docs |

**当前已完成/未执行边界**：精确工具链路径、Node `26.13.1`、npm `11.20.0` 与 `verify:toolchain` 退出码 0 已有 Lead 只读复核证据；这不代表 native addon 或 SQLite 能力兼容。D01 依赖安装、native 构建/加载、实际 SQLite/trigram、WAL、DDL、事务、锁竞争、FTS、typecheck、测试、build、database smoke、full verify、darwin-arm64、ubuntu-latest CI、干净 checkout 与任何 Worker 执行均为 `NOT_RUN`。G3 复审和用户执行审批均未完成。

## 10. G3 记录

| 记录 | 状态 | 说明 |
| --- | --- | --- |
| Lead Plan v0.1 提交 · 2026-11-15 | `REVIEW` | 四卡文件边界、exact 版本、SQL 资源、事务/错误/FTS 固定行为、测试与证据已落定 |
| Architect G3 v0.1 · 2026-11-15 | `CHANGES_REQUIRED` | 要求入参类型真正拒绝 PromiseLike/联合、移除测试对未构建 `dist` 的依赖、澄清既有精确工具链、T02/T04 边界与去重验证 |
| Lead Plan v0.2 修订 · 2026-11-15 | `REVISION_SUBMITTED` | 已修订类型签名与类型用例、docs/src 与 post-build src/dist 分工、工具链路径、T02/T04 边界及一卡一次 full verify |
| Architect G3 v0.2 | `PENDING` | 等待复审；通过前不得派发 Worker |
| 项目负责人执行审批 | `PENDING` | Plan 需先交负责人审阅；即使 G3 通过，未获明确批准也不得派发 Worker |
