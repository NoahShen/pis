# D00 Plan · 工程骨架

> 版本：v0.3 · 2026-11-15
> 状态：**APPROVED · Architect G3 审核通过；用户已确认启动开发（2026-11-15）**
> 起草：Paseo Lead（仅规划，不写生产代码）
> 依据：[Intent v0.1](intent.md)（APPROVED）、[Spec v0.1](spec.md)（APPROVED）、项目开发规范 v0.1、通用开发流程 v1.0，以及 Spec §1 引用的任务拆分与测试基线。

## 1. Plan 边界与执行前提

本 Plan 只把已批准的 D00-T01～D00-T04 转成文件级执行契约，不重定义 Spec，不新增任务 ID，不把任何任务标为 PASS。

正式派发 Worker 前必须同时满足：

1. Architect 完成 G3 并把本文件状态改为 APPROVED。
2. `USER_CONFIRMATION = APPROVED`：用户于 2026-11-15 明确回复“按这份 Plan 启动 D00 开发”；启动授权已满足。
3. 责任方建立正式 Git baseline；当前 `main` 为 0 commits。日常 baseline 选择不另设用户确认门禁。
4. 精确二元组为 Node.js `v26.13.1`、npm `11.20.0`；当前 `v26.7.0 / npm 12.0.2` 不合格，不能生成或复用锁文件。G3 不要求运行尚不存在的工程脚本；用户确认开发后由 Lead 在项目外工具目录准备精确 Node/npm，不修改系统默认，再派发 T01；准备失败则上报并保持 BLOCKED。
5. 每卡由新的 Paseo Worker 串行领取；Worker 不改上游设计、不扩文件范围、不自行 stage/commit、不宣布 PASS。

任务先以未合并任务分支接受 Lead/Architect 审核；审核前不合并。只有已合并 commit 才可记录 `PASS`，branch-only 结果只能是 `REVIEW`。

## 2. 固定工具链与版本证据

### 2.1 只读来源证据

v0.1 数字来自 Lead 的先行检索；其中“Architect 已下载校验”是错误归因，已删除。Architect 在后续复核中以 `curl` 独立核对了 Node archive 与 8 个 npm registry metadata，结果与本 Plan 的数字一致；该复核未下载 Node、未安装依赖，也未验证运行时兼容性：

| 对象 | 官方来源 | 实际字段/结果 |
| --- | --- | --- |
| Node archive | `https://nodejs.org/dist/index.json` | `v26.13.1`, `date=2026-11-10`, `lts=Lithium`, `npm=11.20.0`, `modules=147`, `osx-arm64-tar` present |
| Node release | `https://nodejs.org/en/blog/release/v26.13.1` | HTTP `200`；未据此追加日期主张 |
| Node SHASUMS | `https://nodejs.org/dist/v26.13.1/SHASUMS256.txt` | darwin-arm64 xz：`af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559` |
| npm | `https://registry.npmjs.org/npm/11.20.0`; `/npm/latest` | `11.20.0`, engines `^20.17.0 \|\| >=22.9.0`; latest `12.2.2` |
| dependencies | `https://registry.npmjs.org/<pkg>/<version>` | 7 个 exact version 均 HTTP `200`；见 §2.2 |
| Actions | `https://github.com/actions/checkout.git`; `actions/setup-node.git` | `git ls-remote`：`v7.0.1=3d3c42e…90b1`, `v7.1.0=949feb2…5c1`；GitHub API 当时 `403`，未作为证据 |

上述只是 metadata 查询：**没有下载 Node archive、没有安装依赖、没有生成 lock、没有运行兼容性/构建/测试**。archive SHA 仅指文件名对应文本记录；最终包 integrity 以安装时生成的 lock 为准。

### 2.2 分阶段 exact 依赖

- T01 仅 devDependencies：`typescript@7.0.2`、`@types/node@26.6.6`。
- T02 追加 devDependency：`vitest@5.1.0`。T03 追加 dependencies：`fastify@5.12.8`、`pino@10.4.0`、`zod@4.6.7`。T04 追加 devDependency：`prettier@3.10.1`。
- 每卡只按本卡职责追加直接依赖并更新 `package-lock.json`，随后 `npm ci`；不得提前安装后续卡依赖。最终 integrity 只信 lock。
- 查询到的 registry integrity 摘要：Fastify `sha512-moP8ex…8Qzw==`、Pino `sha512-bk1ZMT…9+vA==`、Zod `sha512-g8W2D2…CGwg==`、TypeScript `sha512-8FYau9…VUNA==`、Vitest `sha512-MzmNFn…HsOA==`、Prettier `sha512-70vp3Z…mmXlg==`、`@types/node` `sha512-MzQj+8…4aog==`；这些未被当作安装通过证据。
- 声明的 Node engines：TypeScript `>=16.20.0`、Vitest `^22.12.0 || ^24.0.0 || >=26.0.0`、Prettier `>=14`；Fastify/Pino/Zod/@types-node 查询时未声明 engines。仅能做元数据范围判断，实际兼容性 `NOT_RUN`。

### 2.3 Node/npm 门禁

- `.nvmrc`、`.node-version`、`engines.node` 均精确为 `26.13.1`；`packageManager` 为 `npm@11.20.0`，devEngines runtime/packageManager 使用 exact + `onFail:error`。
- devEngines 不能阻止错误的 npm 生成锁；G3 是文档审核，不运行尚不存在的 `scripts/verify-toolchain.mjs`。用户确认开发后由 Lead 在项目外工具目录准备精确 Node/npm，不修改系统默认；T01 建立脚本后，正式 Worker 必须先实际断言 `node --version`、`npm --version` 并运行该脚本，通过后才可生成锁或 `npm ci`。
- CI 固定 40 位 Action SHA 并附 tag 注释；不使用浮动 major 或全局升级 npm。

## 3. 固定模块与文件边界

| 路径 | 长期职责 | 首次建立 | 后续允许修改 |
| --- | --- | --- | --- |
| `package.json` / `package-lock.json` | exact 版本、脚本、锁文件 | T01 基础元数据与 TS | T02/T03/T04 按卡追加依赖/脚本并更新锁 |
| `.nvmrc` / `.node-version` | Node 精确版本 | T01 | 除 T04 明确 format-only 外不改 |
| `tsconfig.json` | strict/NodeNext 公共编译选项 | T01 | 除 T04 明确 format-only 外不改 |
| `tsconfig.build.json` | 只编译 `src` 到 `dist` | T01 | 除 T04 明确 format-only 外不改 |
| `tsconfig.test.json` | 类型检查 `src`、`tests`、Vitest 配置 | T02 | 除 T04 明确 format-only 外不改 |
| `vitest.config.ts` | 单次测试、关闭网络外呼、hooks 清理 | T02 | 除 T04 明确 format-only 外不改 |
| `.gitignore` | 依赖、dist、coverage、日志、DB、秘密环境文件 | T01 | T04 可补格式缓存/临时项 |
| `src/version.ts` | 导出长期使用的 `APP_VERSION = "0.1.0"` | T01 | T03 仅消费 |
| `src/time/clock.ts` | `Clock` 接口及每次返回新 Date 的语义 | T02 | 除 T04 明确 format-only 外不改 |
| `src/time/system-clock.ts` | `SystemClock.now()` | T02 | 除 T04 明确 format-only 外不改 |
| `src/time/format-time.ts` | `formatTimestamp(date): string`，固定 `+08:00` | T02 | 除 T04 明确 format-only 外不改 |
| `src/id/id-generator.ts` | `IdGenerator.next(): string` 接口 | T02 | 除 T04 明确 format-only 外不改 |
| `src/id/crypto-id-generator.ts` | `CryptoIdGenerator`，使用 `randomUUID()` | T02 | 除 T04 明确 format-only 外不改 |
| `tests/fixtures/fake-clock.ts` | 可控 `FakeClock` | T02 | T03 可复用 |
| `tests/fixtures/sequence-id-generator.ts` | 固定序列、耗尽抛错 | T02 | T03 可复用 |
| `tests/fixtures/temp-directory.ts` | `withTempDirectory()` 成功/失败都清理 | T02 | T03 可复用 |
| `src/config.ts` | `AppConfig`、`loadConfig()`、安全 `ConfigError` | T03 | 除 T04 明确 format-only 外不改 |
| `src/logger.ts` | `createLogger()`、最小字段与敏感信息 redact | T03 | 除 T04 明确 format-only 外不改 |
| `src/auth.ts` | `isBearerAuthorized()`，严格单凭据与安全比较 | T03 | 除 T04 明确 format-only 外不改 |
| `src/app.ts` | `buildApp()`，无导入副作用 | T03 | 除 T04 明确 format-only 外不改 |
| `src/lifecycle.ts` | 可测试监听/关闭/SIGINT/SIGTERM/timeout 边界 | T03 | 除 T04 明确 format-only 外不改 |
| `src/server.ts` | 生产组合根，导入无副作用，调用 lifecycle | T03 | 除 T04 明确 format-only 外不改 |
| `scripts/verify-toolchain.mjs` | Node/npm 二元组与工程版本一致性门禁 | T01 初版 | T04 补锁文件校验 |
| `scripts/clean.mjs` | 删除并重建仅 `dist`，无 shell glob | T01 | 除 T04 明确 format-only 外不改 |
| `scripts/smoke.mjs` | 启动编译产物、真实 HTTP、信号、端口释放 | T03 | 除 T04 明确 format-only 外不改 |
| `scripts/format.mjs` | 显式枚举授权工程文件，调用 Prettier | T04 | 除 T04 明确 format-only 外不改 |
| `.editorconfig` | 基础编辑一致性 | T04 | 除 T04 明确 format-only 外不改 |
| `.prettierignore` | 路径函数的二次保护，不承担白名单职责 | T04 | 除 T04 明确 format-only 外不改 |
| `.github/workflows/ci.yml` | CI 门禁，版本先验证后安装 | T04 | 除 T04 明确 format-only 外不改 |
| `README.md` | 环境、命令、配置、HTTP、当前范围 | T04 | 除 T04 明确 format-only 外不改 |

不创建 `LICENSE`：Spec/权威设计未要求，D00 不擅自选择许可证。不预建数据库、队列、LLM、RSS、业务路由、容器或空基类目录。

## 4. 固定命令与脚本语义

T01 先建立：

```text
clean         node scripts/clean.mjs
typecheck     tsc --noEmit -p tsconfig.json
build         npm run clean && tsc -p tsconfig.build.json
```

T02 追加：

```text
test          vitest run
typecheck     tsc --noEmit -p tsconfig.test.json
```

T03 追加：

```text
start         node dist/server.js
smoke:run     node scripts/smoke.mjs
smoke         npm run build && npm run smoke:run
```

T04 追加：

```text
verify:toolchain  node scripts/verify-toolchain.mjs
format            node scripts/format.mjs --write
format:check      node scripts/format.mjs --check
verify            npm run verify:toolchain && npm run typecheck && npm test && npm run build && npm run smoke && npm run format:check
```

- `smoke` 必须显式在子进程启动前 fresh-build；不得使用 presmoke/postbuild 等隐式 lifecycle。`smoke:run` 仅作为受控内部步骤，允许被 smoke 调用。
- `start` 绝不隐式安装或编译；调用前必须已有 `dist/server.js`。
- `verify` 中 `build` 后再次经过 `smoke` 会重复 fresh-build，这是为了保留显式、独立可运行的 `npm run smoke` 契约，不视为冗余错误。
- `verify` 是安装后的唯一聚合入口；本地与 CI 必须直接执行它，避免两份命令序列漂移。`verify:toolchain` 仍需在 `npm ci` 前单独执行，以阻止错误 npm 生成或安装依赖。
- 构建脚本先只清理 `dist`，再由 `tsconfig.build.json` 从 `src` 输出；测试和 Fixture 不进入 `dist`。

## 5. 格式边界

`scripts/format.mjs` 是主边界：它用 Node 路径函数显式枚举 `src/**`、`tests/**`、`scripts/**`、`package.json`、`tsconfig*.json`、`vitest.config.ts`、`README.md` 与 `.github/**`，拒绝越界/符号链接路径，再把确切文件列表传给 Prettier；`package-lock.json` 由 npm 管理且不在白名单。不得用 `prettier .` 或可吞掉无匹配文件的 shell glob 代替白名单。

`.prettierignore` 只做二次保护，至少排除：

```text
docs/
通用规范/
config/
node_modules/
dist/
coverage/
*.log
.DS_Store
*.db
*.db-*
.env
.env.*
```

脚本支持 `--check`、`--write` 与只列目标的 `--list`；空目标或目标不存在必须失败。它不会读取或重写 Prompt、权威设计文档、通用规范、依赖目录及构建/测试产物。

## 6. 任务顺序、依赖与派发

```text
G3 APPROVED → USER_CONFIRMATION → Git baseline → Lead 准备项目外精确 Node/npm
  → D00-T01
  → Lead 审核 → Architect 轻量复核 → 合并/记录
  → D00-T02（新 Worker）
  → Lead 审核 → Architect 轻量复核 → 合并/记录
  → D00-T03（新 Worker）
  → Lead 审核 → Architect 轻量复核 → 合并/记录
  → D00-T04（新 Worker）
  → Lead 审核 → Architect 轻量复核 → 合并/记录
  → D00 Gate 集成验证
```

四张任务全部串行。`package.json` 由四张卡分段修改，禁止并行；文件所有权冲突时以串行顺序为准。

| 卡 | 最小 required_context |
| --- | --- |
| T01 | 本 Plan §1～§5、§7 T01、Spec §2/§6/§7、已批准 baseline SHA |
| T02 | 本 Plan §2～§5、§7 T02、Spec §3、T01 已合并 commit |
| T03 | 本 Plan §3～§5、§7 T03、Spec §4/§5、T02 已合并 commit |
| T04 | 本 Plan §2、§4～§5、§7 T04、Spec §2.2/§7、T03 已合并 commit |

责任：Lead 从已合并 baseline 建任务分支并记录 base SHA；Worker 只在分支工作区改授权文件且不 stage/commit；Lead 审核 diff/证据后负责 commit，Architect 复核未合并分支；Lead 只在复核通过后合并，随后凭合并 commit 记录 `PASS`。

## 7. 任务卡

### D00-T01 · TypeScript strict、Node/npm 与可执行构建

```yaml
id: D00-T01
status: NOT_STARTED
depends_on: [G3_APPROVED, USER_CONFIRMATION, GIT_BASELINE, TOOLCHAIN_READY]
spec_refs: ["spec.md#2", "spec.md#6", "spec.md#7"]
```

**允许修改**

- `package.json`, `package-lock.json`
- `.nvmrc`, `.node-version`, `.gitignore`
- `tsconfig.json`, `tsconfig.build.json`
- `src/version.ts`
- `scripts/clean.mjs`, `scripts/verify-toolchain.mjs`

**实现步骤**

1. Worker 先记录 `git rev-parse HEAD`、`git status --short`，并实际执行 `node --version`、`npm --version`；不是精确 `v26.13.1` / `11.20.0` 时停止并报 BLOCKED。
2. 创建 ESM 工程：`type: module`、仅本卡 TS 相关 devDeps、`APP_VERSION` `0.1.0`、`.nvmrc`/`.node-version`、engines/devEngines/packageManager 与严格版本脚本；此时不得安装 Vitest 或后续运行时依赖。
3. 配置 TypeScript strict、`module`/`moduleResolution: NodeNext`、`target` 与本 Node 运行面一致；生产构建 `rootDir: src`、`outDir: dist`，只 include `src`。
4. `scripts/verify-toolchain.mjs` 用 `process.execPath` 与 Node 前缀中的 npm CLI（或同一安装来源的 `npm_execpath`）核对版本；同时检查 package.json 中 engines/devEngines/packageManager 的精确值。T01 尚无锁文件时允许跳过 lock 断言，但不得跳过 runtime 断言。
5. 仅在精确二元组通过后运行 `npm install --package-lock-only` 生成 T01 锁，再 `npm ci`；锁只含 TS/Node 工具，且无浮动版本。
6. `scripts/clean.mjs` 只递归清理本项目解析后的 `dist`，随后建立空 `dist`；禁止使用带未解析变量的宽泛删除目标。
7. 编译 `src/version.ts`，用 Node 导入 `dist/version.js` 验证 ESM；该模块为长期最小生产模块，T03 ready 元数据可消费它，不保留临时 probe。

**验证命令**

```text
node --version
npm --version
node scripts/verify-toolchain.mjs
npm install --package-lock-only
npm ci
npm run typecheck
npm run build
node --input-type=module -e "import('./dist/version.js').then(m => { if (m.APP_VERSION !== '0.1.0') process.exit(1) })"
git status --short
```

**验收标准**

- 仅有 T01 的 exact TS/Node 工具；typecheck 不解析 Vitest API；lockfile 版本与最终 integrity 可定位。
- `typecheck`、`build` 均 0；`dist` 只含生产 JS（及必要 ESM 元数据），不含 tests、Fixture、配置秘密或临时 probe。
- 重新执行 `npm run build` 会先清空旧输出；已删除源码不会残留。
- Worker 证据列出 base commit、改动文件、两条版本命令原文、npm 命令退出码和 `dist` 文件清单；不写 PASS。

**审核节点**

- Lead：审 exact 版本、NodeNext/strict、build include、脚本可移植性、锁文件 diff。
- Architect：确认未提前引入 Vitest/服务依赖或第二套架构，ESM 产物符合 G2。

### D00-T02 · 确定性测试设施、Clock/ID、时间格式与临时目录

```yaml
id: D00-T02
status: NOT_STARTED
depends_on: [D00-T01]
spec_refs: ["spec.md#2", "spec.md#3", "spec.md#6", "spec.md#7"]
```

**允许修改**

- `package.json`, `package-lock.json`（只追加 `vitest@5.1.0`、`test` 脚本并把 `typecheck` 校准到测试配置）
- `tsconfig.test.json`, `vitest.config.ts`（测试/配置类型检查与单次、隔离运行）
- `src/time/clock.ts`, `src/time/system-clock.ts`, `src/time/format-time.ts`
- `src/id/id-generator.ts`, `src/id/crypto-id-generator.ts`
- `tests/fixtures/fake-clock.ts`, `tests/fixtures/sequence-id-generator.ts`, `tests/fixtures/temp-directory.ts`
- `tests/time/clock.test.ts`, `tests/time/format-time.test.ts`
- `tests/id/id-generator.test.ts`, `tests/support/temp-directory.test.ts`
- `tests/version.test.ts`

**实现步骤**

1. 先用精确 npm 二元组安装本卡唯一新增的 `vitest@5.1.0` 并更新 lock，再 `npm ci`；初始化 `tsconfig.test.json`、`vitest.config.ts`，确认 `typecheck` 覆盖测试与配置。
2. `Clock.now(): Date`；SystemClock 每次返回新 Date。FakeClock 支持固定初值、显式推进；返回 Date 被调用者修改后内部时间不变。
3. `IdGenerator.next(): string`；CryptoIdGenerator 使用 `crypto.randomUUID()`；测试序列器按预置值返回，耗尽抛出明确错误且不随机回退。
4. `formatTimestamp()` 输出 `YYYY-MM-DDTHH:mm:ss.SSS+08:00`；无效 Date 抛错；所有转换基于时间点计算，不依赖进程 `TZ`。
5. `withTempDirectory()` 为每个调用创建唯一目录，回调可返回/抛出；`try/finally` 删除本调用目录，失败不触碰共享路径。
6. 加入 `APP_VERSION` 与 `package.json#version` 一致性测试，确保生产构建模块不是伪代码。

**可定位测试名称**

- `SystemClock returns distinct Date instances`
- `FakeClock returns defensive Date copies and advances only explicitly`
- `SequenceIdGenerator returns exact sequence, then throws on exhaustion`
- `CryptoIdGenerator delegates to Node randomUUID`
- `formatTimestamp emits fixed +08:00 at normal, UTC cross-day, month and year boundaries`
- `formatTimestamp rejects invalid Date`
- `withTempDirectory cleans after callback success`
- `withTempDirectory cleans after callback failure and rethrows`
- `APP_VERSION matches package.json version`

**验证命令**

```text
npm run typecheck
TZ=UTC npm test -- tests/time tests/id tests/support/temp-directory.test.ts tests/version.test.ts
TZ=Asia/Shanghai npm test -- tests/time tests/id tests/support/temp-directory.test.ts tests/version.test.ts
npm run build
```

**验收标准**

- 两套 TZ 下同一时间点断言结果完全一致，覆盖 UTC 跨日及跨月/年边界。
- Clock/ID 状态不跨测试共享；测试可重复、可并行，不访问真实外部服务。
- 成功/失败回调后临时目录均不存在；测试不清理项目共享目录。
- `npm test` 单次运行、非 watch、失败非零；`dist` 无测试输出。证据包含 Case 映射、命令退出码和测试数量。

**审核节点**

- Lead：审接口最小性、测试隔离性、两类 TZ 真实执行证据、失败清理。
- Architect：确认接口未越过 D00、时间契约与 Spec §3 一致。

### D00-T03 · Fastify 空服务、配置、Bearer、日志与生命周期

```yaml
id: D00-T03
status: NOT_STARTED
depends_on: [D00-T02]
spec_refs: ["spec.md#3.2", "spec.md#4", "spec.md#5", "spec.md#6", "spec.md#7"]
```

**允许修改**

- `package.json`, `package-lock.json`（只追加本卡运行时依赖与 `start`, `smoke`, `smoke:run`）
- `src/config.ts`, `src/logger.ts`, `src/auth.ts`, `src/app.ts`, `src/lifecycle.ts`, `src/server.ts`
- `tests/config.test.ts`, `tests/auth.test.ts`, `tests/app.test.ts`, `tests/logger.test.ts`, `tests/lifecycle.test.ts`
- `tests/fixtures/fake-signals.ts`, `tests/fixtures/captured-logger.ts`, `tests/fixtures/forced-exit-entry.mjs`
- `scripts/smoke.mjs`
- 可复用 T02 的 FakeClock/SequenceIdGenerator/TempDirectory，不复制替代实现

**固定接口**

- `AppConfig`: `{ host: string; port: number; apiToken: string; logLevel: LogLevel }`。
- `loadConfig(env: NodeJS.ProcessEnv): AppConfig`：纯函数，显式 env；缺失/非法抛 `ConfigError`，只含安全 path/reason，不含原值。
- `createLogger(level: LogLevel, destination?): Logger`。
- `isBearerAuthorized(value: string | undefined, expectedToken: string): boolean`。
- `createBearerPreHandler(expectedToken)`：先从 `request.raw.rawHeaders` 断言 Authorization 恰好出现一次，再调用上述纯函数；重复 header 直接 401。
- `buildApp(config: AppConfig, logger: Logger): FastifyInstance`：无导入启动副作用。
- `DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000`。
- `closeWithTimeout(app, logger, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<"closed" | "failed" | "timeout">`。
- `startServer(deps): { ready: Promise<{host;port}>; completed: Promise<LifecycleResult> }`；`LifecycleResult={code:0|1;reason;forced:boolean}`。`ready` 只在 listen 成功后 resolve；`completed` 在正常 serving 期间保持 pending，只在监听失败或共享关闭流程结束后 resolve。
- `main(deps?)`：生产组合根。`ready` resolve 后等待 `completed`；`ready` reject 时必须先消费 `completed` 再按启动失败设非零退出，不能让 `completed` 成为 unhandled rejection。normal 设置 `exitCode=0` 并自然退出，只有 abnormal/超时默认调用 `process.exit(1)`；测试可注入 factory/signal source，但不得新增 HTTP 测试端点。`deps` 的具体 TypeScript 形状由 Worker 在行为边界内定义，不作为 G3 门禁。

**实现步骤**

1. 先按精确二元组安装 `fastify@5.12.8`、`pino@10.4.0`、`zod@4.6.7` 并更新 lock，再 `npm ci`；不得夹带其他直接依赖。
2. 配置：仅未设置的 `HOST/PORT/LOG_LEVEL` 使用默认；显式空字符串无效，未知 env 忽略。`PORT` 只接受十进制整数字符串 `0..65535`；Token 必填、非空且无任何空白。失败不监听，生产组合根安全报错并设非零退出。
3. Auth：Authorization 必须恰好是一个 `Bearer <token>`；按单个 ASCII 空格切分，scheme 仅用确定性的 ASCII `toUpperCase()` 比较，Token 原样、大小写敏感。拒绝空 Token、tab/额外空白/额外字段或重复 raw header；长度不同直接拒绝，长度相同用 `timingSafeEqual`。
4. App：只注册 `GET /health`；有效凭据 200 且精确 JSON `{"status":"ok"}`；所有未授权 401 `{"error":"unauthorized"}` + `WWW-Authenticate: Bearer`；未注册路径 404。响应不含 version/env/token/config。
5. Logger：结构化记录 ready、shutdown、必要错误；请求日志只含 request id、method、无查询参数 path、status、耗时。禁止记录完整 env/config/body/Authorization/Cookie/Prompt/RSS URL；显式 redact header 敏感字段但不替代字段白名单。
6. Lifecycle：`startServer` 在 listen 成功后 resolve `ready`；监听失败 reject `ready`、以 `listen_error/forced:false` resolve `completed`、移除监听。首个 SIGINT/SIGTERM 启动唯一关闭 Promise；`closed` 以 `code:0/forced:false` resolve，`failed|timeout` 以 `code:1/forced:true` resolve。5000ms timer 在成功/失败时清除；正常路径不得 `process.exit()`。
7. Shutdown 从首个信号起共享一个 5000ms 总预算：Fastify close 与 `logger.flush` 都只能消费剩余预算，任何阶段失败或超时都以默认 `forceExit(1)` 结束，不能超时后再无限等待 flush。所有阶段均在预算内正常完成时设置 `process.exitCode=0` 并自然退出，不调用强制退出。`main` 的 `ready` reject 路径同样必须等待已承诺的 `completed`，随后以非零退出且不遗留 unhandled rejection；监听失败不得用公开测试端点制造。
8. `src/server.ts` 是薄入口，module import 不启动；`scripts/smoke.mjs` spawn 编译后的 `dist/server.js`，不通过 `npm start` 隐式 build，也不另造 server 逻辑。

**可定位测试名称**

- `loadConfig applies defaults only for unset optional variables`
- `loadConfig ignores unknown environment variables`
- `loadConfig accepts legal overrides and PORT=0`
- `loadConfig rejects missing, empty, whitespace-containing API_TOKEN without echoing its value`
- `loadConfig rejects empty or whitespace-padded HOST, invalid PORT and invalid LOG_LEVEL without echoing inputs`
- `isBearerAuthorized accepts case-insensitive scheme and exact case-sensitive token`
- `isBearerAuthorized rejects missing, malformed, extra-field and empty-token values`
- `createBearerPreHandler rejects duplicate raw Authorization headers before value parsing`
- `isBearerAuthorized rejects token length difference and other mismatches as 401`
- `GET /health with valid Bearer returns exact ok body`
- `GET /health unauthorized variants return exact 401 body and WWW-Authenticate`
- `unregistered API and feed paths return 404 with no side effects`
- `importing app/server modules has no listen or signal side effects`
- `captured logs include ready/shutdown metadata but exclude token, body, query, cookie, prompt and RSS sentinels`
- `startServer keeps completed pending while serving and resolves ready after listen`
- `listen failure rejects ready, resolves listen_error and emits no ready log`
- `ready rejection also consumes completed without an unhandled rejection`
- `normal shutdown completes close and log flush within the shared budget without force exit`
- `close failure resolves forced code one and production main calls default force exit`
- `shutdown timeout includes log flush in the shared 5000ms budget and resolves forced code one`
- `duplicate SIGINT/SIGTERM callbacks reuse one close operation and unsubscribe`

**smoke 策略**

`scripts/smoke.mjs` 按有界超时启动真实子进程：

1. `PORT=0`，从结构化 ready 日志读取实际端口和 PID；请求 `/health` 验证 200。
2. 发送 SIGINT，等待退出码 0、捕获 shutdown 日志，再尝试绑定该端口确认释放；证明正常路径自然退出而非 helper 返回值。
3. 新进程发送 SIGTERM，执行同一退出/端口释放断言。
4. 注入 Token、query、body、Cookie 和 RSS 敏感 sentinel，断言捕获输出均不含它们。
5. spawn `tests/fixtures/forced-exit-entry.mjs`，从编译后的 `dist/server.js` 调用 `main`，注入立即信号与真实 Fastify 悬挂 close；断言子进程在绑定上限内以 1 退出。
6. 每个子进程都在 `finally` 中兜底终止与等待；任一子进程未 ready、未在超时内退出或端口未释放时 smoke 非零退出。测试兜底需要强杀时，该用例仍记为失败，不能把强杀后的退出当作成功。

监听失败使用真实占用 loopback 端口；close 拒绝/悬挂使用真实 Fastify hooks。单元测试验证状态映射及 `ready` 拒绝后的 `completed` 消费，compiled-entry fixture 验证 `main` 的真实强制退出，smoke 验证正常 OS 信号、日志、解绑和 `finally` 清理，不以 helper 返回值或强杀代替成功。

**验证命令**

```text
npm run typecheck
npm test -- tests/config.test.ts tests/auth.test.ts tests/app.test.ts tests/logger.test.ts tests/lifecycle.test.ts
npm run build
npm run smoke
```

**验收标准**

- 健康鉴权正常/拒绝矩阵与配置错误矩阵全部自动化通过；未授权不区分缺失和错误 Token。
- 捕获日志中无敏感 sentinel；必要 ready/shutdown 事件可定位。
- 编译产物真实监听，SIGINT/SIGTERM 都以 0 退出且端口释放；监听失败、关闭失败、close+flush 共享 5 秒预算超时均非零且测试有界；失败清理中的强杀不被计为通过。
- `npm start` 只运行已构建产物；`npm run smoke` 日志/证据可证明 fresh build 发生在 server 子进程之前。

**审核节点**

- Lead：审 HTTP 精确响应、重复 header、安全比较、日志捕获、真实 smoke、timeout/cleanup。
- Architect：审配置/应用/组合根边界、生产路径复用、未提前实现业务 API。

### D00-T04 · 统一验证、格式、CI 与 README

```yaml
id: D00-T04
status: NOT_STARTED
depends_on: [D00-T03]
spec_refs: ["spec.md#2.2", "spec.md#5.2", "spec.md#6", "spec.md#7"]
```

**允许修改**

以下 T04 功能性新增/修改优先于 format-only 解释，不允许被“仅格式变化”掩盖：

- `package.json`, `package-lock.json`（只追加 `prettier@3.10.1` 与 `verify:toolchain`, `format`, `format:check`, `verify`）
- `scripts/verify-toolchain.mjs`（补 package-lock name/version/lockfileVersion 与全工程版本断言）
- `scripts/format.mjs`, `tests/support/format-scope.test.ts`
- `.editorconfig`, `.prettierignore`, `.gitignore`（必要时补临时/缓存项）
- `.github/workflows/ci.yml`
- `README.md`

format-only 仅适用于 T01～T03 已存在、且不在上述功能名单中的文件：`src/**/*.ts`、`tests/**/*.{ts,mjs}`、`scripts/**/*.mjs`、`tsconfig*.json` 与 `vitest.config.ts`；其中明确允许格式化 `tests/fixtures/forced-exit-entry.mjs`。只允许 Prettier 产生无语义变更。禁止改 `docs/`、`通用规范/`、`config/`、Prompt 或业务内容。

**实现步骤**

1. `verify-toolchain.mjs` 先断言实际 Node/npm，再核对 package.json engines/devEngines/packageManager、package-lock `name/version/lockfileVersion` 与根包版本。npm 查询必须来自当前 Node 安装来源，不盲信 PATH 中另一 npm。
2. 先添加 exact Prettier 并更新 lock/`npm ci`；随后配置 `.editorconfig` 与二次保护 `.prettierignore`，`scripts/format.mjs` 用固定路径函数枚举 §5 白名单，支持 `--check`/`--write`/`--list`，空目标或越界路径失败。
3. CI 触发条件固定为 `pull_request`，以及 `push: branches: [main]`；另加 `workflow_dispatch` 供首次远程运行。job 在 `ubuntu-latest` 上：checkout `3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` → setup-node `949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`、`node-version-file: .nvmrc`、`cache: npm` → 版本 evidence → `npm run verify:toolchain` → `npm ci` → **直接执行 `npm run verify`**。
4. 不执行 `npm install -g npm`，不跟随 npm latest；setup-node 只负责选择 Node，npm 使用该发行自带 11.20.0。CI 不依赖生产 secrets、数据库、外部网络服务或 LLM。
5. README 记录 Node/npm 精确二元组、安装/验证命令、配置默认/约束、启动/关闭、带 Bearer 的 health 示例、当前 D00 范围和非目标、Prompt 目录待 D02 对齐、远程 CI 未运行事实。
6. 先完成上述功能性修改；随后只对 T01～T03 既有且不在功能名单中的文件应用 format-only。Lead 对功能名单按功能 diff 审核，对 format-only 范围逐 diff 确认为 quote/comma/wrap 等无语义变更，任何越界语义变化即 BLOCKER。随后全量 verify。
7. README 说明工具链不符即停止、不得用本机 npm 12 生成锁；Token 示例不得是真实秘密。

**验证命令**

```text
node --version
npm --version
npm run verify:toolchain
npm ci
npm run verify
npm test -- tests/support/format-scope.test.ts
```

**验收标准**

- 本地与 CI 使用同一顺序和同一脚本，CI 版本来源均为 `.nvmrc` + 官方随附 npm。
- CI 明确由 PR、主分支 push 触发，并保留 `workflow_dispatch` 首跑入口。
- 锁文件安装可复现，toolchain 断言在安装前阻止错误二元组。
- Prettier 不触碰 docs、通用规范、config/Prompt、依赖、dist、coverage 或临时产物。
- T04 功能名单按真实功能变更审核；仅 T01～T03 其余既有文件限定无语义格式修改，包括 `tests/fixtures/forced-exit-entry.mjs` 的格式权限。typecheck/test/smoke 全部通过。
- README 命令可由新会话复制执行，健康示例使用本地测试 Token 而非秘密。
- Worker 证据包含 CI 静态 diff、全部本地命令结果；**CI 未实际运行前标 `NOT_RUN`**，不得写“CI 已通过”。

可定位测试名称：`format target list contains only explicit engineering paths`、`format target collection rejects empty and out-of-scope paths`。

**审核节点**

- Lead：审命令顺序、CI SHA/cache、工具链门禁位置、格式边界、README 可复现性。
- Architect：审本地/CI 一致性、交付证据边界、未增加新依赖或非 D00 能力。

## 8. 文件所有权与冲突矩阵

| 路径组 | T01 | T02 | T03 | T04 |
| --- | --- | --- | --- | --- |
| package/lock | TS/Node exact；建锁 | +Vitest/scripts；更新锁 | +Fastify/Pino/Zod/scripts；更新锁 | +Prettier/scripts；更新锁 |
| Node/TS/Vitest 配置 | TS 配置 | 建 test 配置 | 除 T04 明确 format-only 外不改 | 除 T04 明确 format-only 外不改 |
| `src/version.ts` | 建立 | 测试消费 | 生产日志消费 | 除 T04 明确 format-only 外不改 |
| `src/time`, `src/id` | — | 建立 | 复用 | — |
| `tests/fixtures` | — | 建立 | 增补信号/日志/forced-entry fixture | — |
| `src/config/auth/app/logger/lifecycle/server` | — | — | 建立 | — |
| `scripts/clean/verify-toolchain` | 建立 | — | — | 补强 verify-toolchain |
| `scripts/smoke` | — | — | 建立 | — |
| format/CI/README | — | — | — | 建立功能文件；T01～T03 其余既有文件仅 format-only |

同一时刻只允许一个 Worker 修改 `package.json`；四卡全串行，因此不需要并行合并协议。任何越权文件出现均应由 Worker 在 REVIEW 前移除或上报，不得将其夹带进任务。

## 9. G3 记录与 Lead 提交

| 记录 | 状态 | 说明 |
| --- | --- | --- |
| Architect G3 Round 1 · 2026-11-15 | `CHANGES_REQUIRED` | 首轮提出启动用户确认、版本来源、分阶段依赖、格式越权、生命周期语义等缺口。来源问题随后由 Architect 用 `curl` 独立复核 Node archive 与 8 个 registry metadata；未下载、安装或验证兼容性 |
| Lead post-Round-1 correction | `SELF_CHECK_ONLY` | 上一版曾错误把 Lead 自查写成“Architect 第 2 轮复核”。该归因不真实，已撤销；不存在 Architect Round 2 通过结论 |
| v0.3 Lead submission | `REVIEW` | Lead 提交记录；最终审批见下方 Architect 独立结论 |
| Architect v0.3 最终复核 · 2026-11-15 | `APPROVED` | 前述阻塞项已闭合；任务边界、文件权限、依赖、验证和回滚符合已批准 Spec。用户确认仍为 PENDING，禁止派发 Worker |

### Architect 最终审核结论

- 审核者：当前 Architect（项目负责人明确分配的主会话）。
- 批准基线：Plan v0.3，依据 Intent v0.1 / Spec v0.1；当前无 Git 提交，以文档版本定位。
- 审核范围：四张任务卡的串行依赖、文件授权、分阶段依赖安装、测试/构建入口、CI 触发、生命周期失败行为、格式修改边界及提交/合并责任。
- 证据：已独立核对 Node/npm 与依赖官方元数据；本轮 `git ls-remote` 确认 checkout v7.0.1 和 setup-node v7.1.0 的 SHA 与 §2/§7 一致。元数据确认不代表安装或运行兼容性通过。
- 结论：无剩余 G3 BLOCKER，批准进入等待用户确认阶段。内部函数签名由 Worker 在已定行为边界内实现，不增加规划门禁。
- 执行授权更新（2026-11-15）：用户明确回复“按这份 Plan 启动 D00 开发”，`USER_CONFIRMATION=APPROVED`。授权按 §10 建立 Git 基线及工具链，再由 Lead 派发 T01；未改变 Plan 技术范围。
- 所有开发任务仍为 NOT_STARTED，工程验证为 NOT_RUN；G3 APPROVED 仅表示计划通过审核。

### 9.1 Lead 自查记录（非审核）

- 首轮后已修正分阶段依赖和用户确认门禁；本节为 Lead 提交时的自查记录，最终 G3 结论见上方 Architect 记录。
- CI 已明确 `pull_request`、`push.branches: [main]` 与 `workflow_dispatch`。
- T04 功能性新增/修改优先于 format-only；format-only 只适用于 T01～T03 其余既有文件，并明确允许格式化 `tests/fixtures/forced-exit-entry.mjs`。
- T03 已明确 `ready` 拒绝时消费 `completed`，以及 close 和 flush 共享 5000ms 总预算、超时强制退出、正常路径不强退、子进程 `finally` 清理及强杀不算通过。
- G3 只审文档，不运行尚不存在的工具链脚本。用户确认后由 Lead 在项目外工具目录准备精确 Node/npm，再派发 T01。
- 上一版 Lead 自查曾建议冻结全部依赖注入类型和格式函数完整协议；Architect 未将其认定为 G3 BLOCKER，本版不采纳该项，具体内部签名由 Worker 在明确行为与文件边界内决定。

Spec 验收映射：§2→T01/T04，§3→T02，§4/§5→T03，§7→T04/Gate；27 个历史业务 Case ID 不映射、不冒用后续 PASS。每个 Worker 以 `REVIEW` 回报 base/branch SHA、diff、逐命令退出码、case 映射、NOT_RUN 和 blockers；附 smoke ready/signal/exit/port-release 与格式 diff，不贴长日志/Token。Lead 审 diff 及证据，Architect 独立复核未合并分支；连续两轮失败按规范暂停。不得自批 PASS。

## 10. 集成、D00 Gate 与 Git 基线

### 10.1 正式编码前

- Architect 已完成 G3 审核，用户已确认启动开发；两项门禁均已满足。
- 按下列顺序落实 Git 基线与工具链，再创建并派发 T01 Worker。
- 确认后由 Architect/项目负责人按常规建立 baseline commit，不要求用户再确认日常 baseline 选择；Lead 不自行 stage/commit。
- 当前 G3 只做文档审核，不准备 Node/npm、不运行尚不存在的工程脚本。G3 通过且用户确认后，Lead 再在项目外工具目录准备精确 Node/npm，不修改系统默认；失败上报，不派发 T01。
- 若 baseline 未建立，D00-T01 保持 `BLOCKED`，不得以“无提交但本地有文件”代替可追溯基线。
- 在项目所有者和 Architect 确认迁移方式前，不删除 `.DS_Store` 或现有未跟踪文档；`.gitignore` 只避免未来再次产生噪声。

### 10.2 里程碑 Gate

四卡依次 REVIEW/复核/合并并更新 progress 后，由 Lead 组织、Architect 验收：

1. 从已合入的集成 commit 建立独立干净副本（不得复制 `node_modules`、`dist`、coverage 或临时产物）。
2. 在该副本确认 `.nvmrc`/`.node-version` 为 `26.13.1`，使用自该发行自带的 npm `11.20.0`。
3. 先执行 `node --version`、`npm --version`、`npm run verify:toolchain`。
4. 执行 `npm ci`，随后执行 `npm run verify`；该单一入口内部严格按 `typecheck → test → build → smoke → format:check` 运行，与 Spec 的干净 checkout 序列一致。
5. 保存每条命令退出码、测试摘要、两次真实信号 smoke、端口释放、build 产物清单与最终 `git status --short`。
6. 远程 CI 只有在代码推送后实际运行才可记 PASS；本地结果不能替代。未推送/未运行统一记 `NOT_RUN`。

D00 只有在四张任务的 Lead 审核、Architect 复核及上述集成 Gate 均完成后才可申请里程碑验收；Plan 本身不授予 PASS。

## 11. 风险、回滚与 NOT_RUN

| 风险 | 监控/处理 | 回滚 |
| --- | --- | --- |
| 本机错误 Node/npm 生成锁 | 用户确认后 Lead 准备项目外精确工具链；正式 Worker 前置双版本断言；错误立即 BLOCKED | 丢弃该任务产生的 package-lock，重新用精确二元组生成；不手改 integrity |
| 分阶段 exact 依赖不可安装 | 当前卡在 `npm ci` 前报告具体包/engines/integrity | 停止并交 Architect；不得提前装后续依赖或换浮动/latest |
| 构建残留或测试进入 dist | clean 只处理解析后的 dist；build include 仅 src；检查文件清单 | 回滚该任务构建配置，不复用脏 dist |
| 重复/额外 Authorization 被误接受 | auth 单元测试 + Fastify 集成测试 + smoke 日志 sentinel | 阻断 T03，修严格单 header 解析，不放宽测试 |
| close 挂起或即时 exit 截断 | 共享关闭 Promise、5000ms race、真实信号 smoke | 阻断 T03；保留失败进程/端口证据，不以强杀冒充优雅关闭 |
| 格式工具误改权威文档/Prompt | 路径函数白名单 + `git diff --name-only` 证据 | 回滚该格式变更，修正白名单；不得重写设计内容 |
| CI action/version 漂移 | 固定 40 位 SHA + tag 注释；Node 来自 `.nvmrc`；无 global npm | 回滚 workflow 至最后已核实 SHA |
| 无 Git baseline | 正式编码前显式 Gate | 不派发 T01；保持 BLOCKED |

D00 本轮只完成 Lead 对 Plan/Progress 的文档修订并提交 Architect 审核。**NOT_RUN**：项目外 Node/npm 准备、Node archive 下载、依赖安装、package-lock 生成、兼容性、typecheck、测试、build、smoke、format check、GitHub Actions、干净 checkout Gate、Worker 创建、任何 Git stage/commit。
