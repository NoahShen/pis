# D13 Plan：GitHub Pages RSS Publisher

> 版本：v1.1
> 状态：`G3_APPROVED`（公开目录增量修订）
> 计划基线：main `9d29beb`（可配置公开目录 Spec 批准提交）
> Intent：`docs/milestones/D13/intent.md`（`APPROVED`）
> Spec：`docs/milestones/D13/spec.md`（`APPROVED · Architect`）

严格串行，执行顺序固定 **T01 → T02 → T04 → T04-R1 → T03**。T01/T02/T04 已按 v1.0 合并；T04-R1 增补可配置公开目录，T03 须在 T04-R1 closeout 后重新完成最终线上验收，**不得以原根目录验收代替**。Worker 不得自行创建 candidate、merge 或 push。

固定平台：GitHub Pages，发布仓库 `git@github.com:NoahShen/pis_publish.git`，分支 `main`，站点根目录部署。SSH 凭据由运行环境提供，PIS 不保存私钥。公共订阅 URL = `RSS_PAGES_PUBLIC_ORIGIN` + 可选 `RSS_PAGES_PUBLIC_DIRECTORY` 前缀 + 固定文件名；缺省公开目录时保持根目录。

## 0. 运行时前置与固定约束

```bash
export PATH="/Users/noahshen/.local/share/pis/toolchains/node-v26.13.1-darwin-arm64/bin:$PATH"
node --version        # v26.13.1
npm --version         # 11.20.0
npm run verify:toolchain
```

- **新增依赖：`NONE`**。Git/Pages 通过受控 `git` 子进程（系统 SSH）与 Node 原生 `fetch`，不引入 npm 依赖。
- **`package-lock.json` 禁止变化**；`package.json` 仅 T04 可加脚本，依赖版本不变。
- **固定写集门禁**：每卡固定 base、精确写集；Lead 以 base 加 Worker 工作树生成冻结 canonical patch/tree/全部 blob；证据放 `/private/tmp/d13-tNN-freeze.*/`，不进 Git。
- 受保护路径（全卡 diff 必须为 0）：`src/database/schema.sql`、`src/publication/**`、`package-lock.json`，以及 D12 `src/rss/` 核心算法与 `tests/rss/` 既有测试（除 `index.ts` 显式再导出）。

## 1. 公共契约与 Case 映射

Publisher 直接接收一个 Feed 的**完整文件集**并返回**已验证版本**，不在 T01 建模冗长 outcome 状态机。

```ts
export interface RssPublicationFile {
  readonly key: string;          // 站点根内规范 POSIX 相对路径
  readonly bytes: Uint8Array;    // UTF-8
}

export interface RssFeedFileSet {
  readonly feed: RssFeedKind;
  readonly files: readonly RssPublicationFile[];   // head + pending + 封存归档 + .nojekyll
}

export interface RssPublishResult {
  readonly feed: RssFeedKind;
  readonly version: string;        // 受保护分支 commit id（Git 版本）
  readonly verified: boolean;      // Pages deployment + origin bytes 匹配
}

export interface RssPublicationPublisher {
  publish(files: RssFeedFileSet): Promise<RssPublishResult>;
}
```

一次 `publish` 是一个 Feed 的一个原子 Git commit/tree：**staging 一个 Feed 一个 commit**，HEAD/pending 不在不同 commit 分批公开。

| 卡片 | 唯一交付职责 | Case |
|---|---|---|
| `D13-T01` Publisher 接口与 Fake | 文件集 staging、单 Feed 单 commit、non-fast-forward 冲突保护、Fake 可注入故障 | `RSS-20/22` |
| `D13-T02` 通知合并与启动校准 | 同 Feed 串行、合并运行中通知、coalesced caller Promise、失败可重试、启动前全量校准 | `RSS-19`～`RSS-23` |
| `D13-T04` Pages 适配器与生产装配 | 受控 git/Pages 适配器、配置字段、生产接线、操作文档 | `RSS-23` |
| `D13-T04-R1` 公开目录增量 | Git/URL 同前缀、迁移清理与保留边界、生产配置传递 | `RSS-23` |
| `D13-T03` Pages 平台验收 | 公开目录下真实匿名 XML、完整链、更新延迟、失败重试、阅读器人工验收 | `RSS-15/16` |

`RSS-20/22` 由 T01 确定性覆盖（上传失败保留数据库、先归档后主文件、无半写 XML、非 fast-forward 不覆盖远端）；`RSS-19～23` 的确定性部分由 T02 覆盖；`RSS-23` 实际迁移/上传由 T04；`RSS-15/16` 仅在 T03。

## 2. D13-T01 · Publisher 接口、staging 与 Fake

### 2.1 Base、依赖与精确写集

- Base：`C0`（G3 通过后的 `plan.md`/`progress.md` 精确文档提交）。串行前置：`NONE`。外部依赖/包变更：`NONE`。
- 新增：`src/rss/publisher/contracts.ts`
- 新增：`src/rss/publisher/staging.ts`
- 新增：`src/rss/publisher/fake-publisher.ts`
- 新增：`src/rss/publisher/index.ts`
- 修改：`src/rss/index.ts`
- 修改：`tests/fixtures/rss.ts`
- 新增：`tests/rss/publisher/staging.test.ts`
- 新增：`tests/rss/publisher/fake-publisher.test.ts`
- 只读：D12 `src/rss/**`、`RssFeedKind`、`RssArtifactStore`、`RssSyncResult`。

### 2.2 实现要求

1. `contracts.ts` 固定 §1 公共契约与稳定错误码：`invalid_input`、`artifact_conflict`、`non_fast_forward`、`push_failed`、`pages_unverified`、`timeout`。对外 message 不含正文、完整订阅 URL、私钥、绝对路径或环境变量。
2. `staging.ts` 把完整文件集整理为单个 Feed 提交意图：校验 `feed` 合法、key 为站点根内规范相对路径、无绝对/`..`/反斜杠/query、字节完整；**一个 Feed 只生成一个 commit tree**，不拆分 head/pending。
3. 冲突保护：staging 读取远端受保护分支当前 commit；若远端已越过本版本 base（**non-fast-forward**），返回稳定 `non_fast_forward`，**不 force push、不覆盖远端更新**，交由上层重试。
4. `fake-publisher.ts` 提供 `createFakeRssPublisher(options?)`，确定性返回受控 commit id 与 `verified`；可注入 push 失败、Pages bytes 不匹配、non-fast-forward 三类故障，供 T02 与 T04 单测复用。Fake 不访问网络、不写数据库、不启动进程。
5. 契约不承诺跨 Feed 事务：一次 Feed 的一个 commit 是其原子公开版本。

### 2.3 定向测试与验收出口

- 单 Feed 文件集 staging：head+pending+archive+`.nojekyll` 进入同一 commit；key/字节校验；非法 key 稳定失败。
- `RSS-22` 写序：Fake trace 证明封存归档先于 pending/head 进入版本，无半写 XML。
- `RSS-20`：注入 push 失败/`non_fast_forward`，返回稳定错误，不回滚 Published Item，不覆盖远端。
- 定向：`npm test -- tests/rss/publisher/staging.test.ts tests/rss/publisher/fake-publisher.test.ts`；全量：`npm run verify`。
- 禁止事项：不实现真实 Git/网络、不建模多余 outcome 状态机、不改 D12 算法、不碰 `src/publication/**`/schema/`package-lock.json`。
- 出口：冻结/G4/candidate/merge-tree/merge/merge 后定向+`npm run verify`/Worker 与 Workspace 归档后，方可进入 T02。

## 3. D13-T02 · 通知合并与启动校准

### 3.1 Base、依赖与精确写集

- Base：T01 `PASS` 的精确 closeout 文档提交 `C1`。串行前置：`D13-T01`。外部依赖/包变更：`NONE`。
- 新增：`src/rss/publisher/notifier.ts`
- 新增：`src/rss/publisher/startup-calibration.ts`
- 修改：`src/rss/publisher/index.ts`
- 修改：`src/rss/index.ts`
- 修改：`tests/fixtures/rss.ts`
- 新增：`tests/rss/publisher/notifier.test.ts`
- 新增：`tests/rss/publisher/startup-calibration.test.ts`
- 只读：T01 contracts/staging/Fake；D12 `createLocalRssSync`/`RssSyncResult`。

### 3.2 实现要求

1. `RssPublicationNotifier.notify(feed): Promise<void>`。**同 Feed 串行，active 期间最多排队一个 dirty rerun**，运行中的多次调用**合并**；合并后只保留一次真实执行。
2. **coalesced caller Promise 语义**：同一 active 执行代次的调用共享同一 Promise；active 期间后续通知合并为**最多一个 dirty rerun 代次**，这些调用者共享并等待 rerun Promise，不得在 active 结束时提前 resolve。不得为每个 caller 启动独立上传。
3. **失败可重试**：通知失败必须 reject 供 Publication 既有 best-effort 日志记录；失败后该 Feed 的合并状态复位，下一条通知或启动校准可恢复。失败不回滚已持久化的 Published Item，不新增第七种 Runtime 任务。
4. `startup-calibration.ts`：启动时在 **scheduler 启动前**同步校准两类 Feed——读取完整 Published Item 历史，重建本地完整文件集并调用 Publisher；用于补齐云端缺失 head/归档（`RSS-21`）。校准失败**使生产启动失败并清理资源**，避免长期陈旧。
5. 校准不新建业务情报、Topic 关联或额外队列；不调用 LLM。发布成功是持久化之后的 detached 通知。

### 3.3 定向测试与验收出口

- `RSS-19`：同 Feed 连续两次新增，第一次上传慢、第二次先生成；active caller 与 dirty rerun caller 分别等待对应代次，最终版本包含最新两条，旧结果不被新结果后覆盖。
- `RSS-20/22`：注入 Publisher 故障，通知 reject 且可重试；数据库 Published Item 保留；重试后成功。
- `RSS-21`：启动校准补齐缺失 head/部分归档，不新增业务数据；校准失败使启动失败。
- 定向：`npm test -- tests/rss/publisher/notifier.test.ts tests/rss/publisher/startup-calibration.test.ts`；全量：`npm run verify`。
- 出口：冻结/G4/candidate/merge-tree/merge/full verify/归档后进入 T04。禁止本卡实现真实 Git 上传或改 D12 算法。

## 4. D13-T04 · Pages 适配器、生产装配与操作文档

### 4.1 Base、依赖与精确写集

- Base：T02 `PASS` 的精确 closeout 文档提交 `C2`。串行前置：`D13-T02`。外部依赖/包变更：`NONE`。
- 新增：`src/rss/pages/git-client.ts`
- 新增：`src/rss/pages/pages-verifier.ts`
- 新增：`src/rss/pages/pages-publisher.ts`
- 新增：`src/rss/pages/index.ts`
- 新增：`tests/fixtures/rss-pages.ts`
- 新增：`tests/rss/pages/pages-publisher.test.ts`
- 新增：`tests/rss/pages/pages-verifier.test.ts`
- 新增：`scripts/pages-smoke.mjs`
- 修改：`src/config.ts`、`src/production/application.ts`、`src/rss/index.ts`、`package.json`、`README.md`
- 禁止修改：`package-lock.json`、`src/database/schema.sql`、`src/publication/**`、D12 核心。

### 4.2 适配器与配置

1. `git-client.ts`：受控 `git` 子进程使用系统 SSH；固定环境禁止交互式凭据提示（`GIT_TERMINAL_PROMPT=0`、明确 `GIT_SSH_COMMAND`）；**工作目录独立于业务 DB**（`RSS_PAGES_WORK_DIRECTORY`）；所有路径/分支参数分离，超时/退出有界；push 前读取远端受保护分支当前 commit 做 **non-fast-forward** 校验，非 fast-forward 不 force push、报告冲突可重试。
2. `pages-verifier.ts`：push 成功只代表 Git 版本接受；公开完成需 **Pages deployment 成功且匿名 origin bytes 与本地一致**。通过公开 origin 条件轮询/读取校验（固定 `RSS_PAGES_POLL_INTERVAL_MS`、`RSS_PAGES_PUBLISH_TIMEOUT_MS`）；HTTP 响应 bounded、redirect 策略明确、不读取 secret；可使用 GitHub public deployments API，无需 token 的公开 endpoint 失败时由 origin bytes 校验补足。
3. 公开资产只允许固定 head/pending、严格 archive key 与 `.nojekyll`；**不复制数据库、WAL、日志、配置、node_modules 或隐藏文件**。
4. 配置字段（`RSS_PAGES_*`，全部可选、缺省不启用云发布、保持本地开发兼容）：
   - `RSS_PAGES_REPOSITORY`：固定 Git SSH URL，禁止 credential/query/fragment。
   - `RSS_PAGES_BRANCH`：默认 `main`，仅安全 ref 名。
   - `RSS_PAGES_WORK_DIRECTORY`：默认 `data/rss-pages`。
   - `RSS_PAGES_PUBLIC_ORIGIN`：绝对 HTTPS origin，无 credential/query/fragment/path；默认 `https://noahshen.github.io/pis_publish`。
   - `RSS_PAGES_PUBLISH_TIMEOUT_MS`：默认 `120000`，范围 `1000～600000`。
   - `RSS_PAGES_POLL_INTERVAL_MS`：默认 `5000`，范围 `100～60000`。
   - 启用时 repository/origin 必须齐全；校验失败稳定报错。日志只记录固定公开配置与稳定 reason。
5. 生产装配：`createPublication` 注入 `RssPublicationNotifier`；`src/production/application.ts` 在 **scheduler 启动前**执行启动校准，并在 close 流程中做 **Publisher/git worktree 清理**；未启用云发布时装配保持原行为。

### 4.3 定向测试、smoke 与文档

- `pages-publisher.test.ts`：以本地临时 bare git 仓库为远端、本地静态 HTTP server 为 origin，验证单 Feed 单 commit、non-fast-forward 拒绝、Pages bytes 匹配/失配、超时有界、公开资产白名单。不访问真实 GitHub、不记录 secret。
- `pages-verifier.test.ts`：bounded 重定向、错误状态、公开 endpoint 失败回退 origin bytes、无 secret 泄漏。
- `scripts/pages-smoke.mjs`：本地 git 远端 + 本地 origin 完成两类 Feed 完整链发布，校验 head/pending/archive 与 `.nojekyll`、bytes 匹配、`package-lock.json` 不变、默认库未触碰。
- `package.json` 仅新增 `smoke:pages` 并接入现有 `smoke`；`README.md` 更新为事实状态，写明文件名、固定 URL、迁移/重试、公开边界。
- 定向：`npm test -- tests/rss/pages/pages-publisher.test.ts tests/rss/pages/pages-verifier.test.ts`；smoke：`npm run build && npm run smoke:pages`；全量：`npm run verify`。
- 出口：冻结/G4/candidate/merge-tree/merge/full verify/归档后进入 T03；禁止本卡做真实线上验收。

## 5. D13-T04-R1 · 可配置公开目录与根目录迁移

### 5.1 Base、依赖与精确写集

- Base：`9d29beb`。串行前置：`D13-T04` 已合并；本卡不依赖原 T03 完成。外部依赖/包变更：`NONE`。
- 修改：`src/rss/pages/git-client.ts`、`src/rss/pages/pages-verifier.ts`、`src/rss/pages/pages-publisher.ts`、`src/rss/pages/index.ts`。
- 修改：`src/config.ts`、`src/production/application.ts`、`src/rss/index.ts`、`README.md`。
- 修改：`tests/fixtures/rss-pages.ts`、`tests/rss/pages/pages-publisher.test.ts`、`tests/rss/pages/pages-verifier.test.ts`、`scripts/pages-smoke.mjs`。
- 禁止修改：`package-lock.json`、`src/database/schema.sql`、`src/publication/**`、D12 `src/rss/` 核心算法与既有 D12 测试；不得为公开目录改写 D12 文件集。

### 5.2 实现要求

1. 新增可选 `RSS_PAGES_PUBLIC_DIRECTORY`：缺省为空并沿用站点根目录；非空值必须为长度 `1～128` 的单层目录，仅允许 `[A-Za-z0-9_-]`。非法值稳定拒绝，不隐式清洗。
2. 配置目录后，Git 目标路径与 verifier 匿名 URL 使用**同一目录前缀**；origin 语义不变。D12 文件集 key、XML 内容及其 head/pending/archive 相对链接保持不变，不添加目录、不重写正文。
3. 从根目录迁移到公开目录时，同一迁移版本清理根目录旧 PIS 固定 head/pending/archive 与根 `.nojekyll`；保留未知文件，并保留另一 Feed 已写入其公开目录的资产。不得清空仓库或以整个目录替换远端 tree。
4. `src/production/application.ts` 将校验后的公开目录配置传递到实际 Publisher/verifier 装配；缺省配置行为与 v1.0 兼容。
5. 日志、README、测试名称/断言及验收摘要不得写入实际随机目录值；测试使用固定非生产示例值。

### 5.3 定向测试、smoke 与出口

- 配置边界：缺省根目录、合法单层目录、非法字符/多层/空以外的越界长度均按契约处理；Git key 与公开 URL 前缀一致。
- 迁移：根旧 PIS 资产清理，未知文件保留，另一 Feed 目录资产保留；D12 文件集与 XML 相对链接逐字节不变。
- `pages-publisher.test.ts` / `pages-verifier.test.ts` 继续覆盖 non-fast-forward、bytes 校验、超时与安全边界；smoke 覆盖目录发布及迁移。
- 定向：`npm test -- tests/rss/pages/pages-publisher.test.ts tests/rss/pages/pages-verifier.test.ts`；smoke：`npm run build && npm run smoke:pages`；全量：`npm run verify`。
- README 写明公开目录配置、URL/迁移/保留边界及“随机路径不是访问控制”。
- 出口：冻结/G4/candidate/merge-tree/merge/full verify/归档并形成 T04-R1 精确 closeout 文档提交后，方可进入 T03；本卡不做最终真实线上验收。

## 6. D13-T03 · GitHub Pages 平台验收（最终线上）

### 6.1 Base、依赖与精确写集

- Base：T04-R1 `PASS` 的精确 closeout 文档提交 `C3`。**T03 只验收，不写生产代码**；未实现并合并 T04-R1 前不得执行。
- 串行前置：`D13-T04-R1`。外部依赖/包变更：`NONE`。
- 新增：`scripts/pages-acceptance.mjs`
- 新增：`docs/milestones/D13/pages-acceptance.md`（人工阅读器验收清单）
- 修改：`README.md`（可选，仅记录公开验收状态）
- 写集不含 `src/**` 生产代码与 `package-lock.json`。

### 6.2 验收要求

1. 对真实 `git@github.com:NoahShen/pis_publish.git` 的 Pages 公共 URL 做**匿名**读取，覆盖两类 Feed 在已配置公开目录下的 head/pending/sealed（存在时），校验内容与本地完全一致，目录内 `.nojekyll` 生效；缺省配置兼容性由 T04-R1 测试覆盖。
2. 完整链：`head → pending → archive…` 均可匿名访问，head 与归档在同一版本公开；GUID 去重覆盖完整历史。
3. 更新延迟与失败重试：发布后在 `RSS_PAGES_POLL_INTERVAL_MS`/timeout 内确认 origin bytes；注入 stale remote/缺失文件后启动校准可恢复，封存归档不被重写。
4. 阅读器人工验收（`RSS-15/16`）：真实阅读器通过公开目录 URL 首次订阅、离线、新增超 200 条；核对 XML、云端错误响应、公开仓库文件树/历史与日志无 API Token/SQLite/Prompt/User Context/私钥泄漏；HTTPS；随机路径不作访问控制。
5. 核验迁移后根目录旧 PIS head/pending/archive 与根 `.nojekyll` 不再公开，未知文件和另一 Feed 的新目录资产保留；公开目录变更后重新完成匿名验证。
6. `scripts/pages-acceptance.mjs` 只记录安全计数、key/hash 摘要与 PASS；不记录正文、完整来源 URL、secret 或实际随机目录值。证据在 T04-R1 合并后由 Lead/Architect 执行并写入 `progress.md`。

### 6.3 验收出口

- 定向：`node scripts/pages-acceptance.mjs --origin <origin>`；全量复验：`npm run verify`。
- 出口：公开目录下真实匿名 XML、完整链、更新延迟、失败重试、迁移保留边界与阅读器人工证据齐全后，五卡方可全部 `PASS`。缺证据即 `BLOCKED`，不得用本地 stub 或原根目录证据替代。

## 7. 串行门禁、冻结与收尾

1. 串行 base 固定为：T01=`C0`、T02=`C1`、T04=`C2`、T04-R1=`9d29beb`、T03=`C3`；`C1/C2/C3` 中 `C3` 特指 T04-R1 Lead closeout 的精确文档提交，不得用分支头或工作树代替。
2. 每卡：Lead 核对 diff 与写集 → 冻结 canonical patch/tree/全部 blob（`/private/tmp/d13-tNN-freeze.*/`）→ Architect G4 → candidate → `git merge-tree --write-tree <base> <candidate>` 预演 → 授权 merge → 记录 candidate/merge SHA → merge 后定向 + `npm run verify` + `git diff --check` → Worker/Workspace 归档。
3. 受保护路径 diff=0：`src/database/schema.sql`、`src/publication/**`、`package-lock.json`，D12 `src/rss/` 核心算法与既有 `tests/rss/`。
4. 任一阻塞回到对应卡写集修复；后续卡不得越权修改前卡生产代码。Worker 不 commit/stage/amend/merge/push，不改 `progress.md`。
5. 五卡全部 `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` 后，Architect 干净快照最终 Gate、push 已批准 main SHA、核验远程 SHA 与精确 SHA 的 CI Success；删除心跳、归档 Worker/Workspace，交负责人验收，不自动进入 D14。

## 8. G3 复核点

- 顺序 `T01→T02→T04→T04-R1→T03` 是否成立，T03 是否严格以 T04-R1 closeout 为 base，无“未实现先验收”。
- Publisher 是否直接接收完整文件集并返回 verified version，未过度建模 outcome 状态机；T02 是否明确 coalesced caller Promise 语义与失败后可重试。
- 是否覆盖 staging 单 Feed 单 commit、non-fast-forward、Pages bytes 确认、启动校准与 close cleanup、全部配置字段。
- T04-R1 是否保证 Git/URL 同前缀、D12 文件集/XML 相对链接不变、根旧 PIS 资产清理且未知文件与另一 Feed 保留，并由生产装配传递配置。
- 新增依赖 `NONE`、`package-lock.json` 不变、精确写集/base/冻结/candidate 门禁是否完整，实际随机目录值是否未进入文档。
