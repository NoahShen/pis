# PIS · Agent 项目开发规范

> 版本：v0.1（2026-11-14）  
> 状态：**APPROVED · 项目负责人已批准采用（2026-11-15）**  
> 性质：项目级扩展规范；不替代 PIS 业务/技术设计  
> 通用基础：资料库 `/通用规范/Agent_开发流程规范_v1.0.md`（v1.0，2026-11-14）

## 1. 适用范围与继承关系

本文件仅规定 **PIS（Personal Intelligence System）** 相对于《Agent 协作开发流程规范 v1.0》的特殊约束。三文档门禁、Architect/Lead/Worker 角色、每任务短会话、代码审核、失败升级、Git 与进度恢复、Definition of Done、变更控制等均**继承通用规范**，不在此重复定义。

- 没有显式标注为“覆盖”的内容均为**补充**，不修改通用规范。
- 本版**没有覆盖通用规范的强制条款**。
- 原有 PIS 业务需求、架构、DDL、测试 Case ID 与 Prompt 约束不因本规范制定而发生变更。
- 资料库是设计资料存储位置，并不天然等同于可执行 Git 工作区。真正启动 Coding Agent 前，必须确保 Agent 对照的通用规范 v1.0、PIS 权威文件及本文件可在其工作环境中读取；必要时以只读快照/挂载同步，**不维护另一个可独立修改的规范版本**。

## 2. 权威来源与冲突处理

下列路径相对于资料库 `/PIS/`；在 Git 仓库镜像时可以调整存放目录，但引用必须可解析且版本对应。

| 类型 | 唯一权威来源 | 作用 |
| --- | --- | --- |
| 业务架构与领域语义 | `PIS_总体架构与设计原则_v1.0.md` | 模块边界、对象语义、非目标、流程原则 |
| 数据模型与 DDL | `PIS_数据库设计_v1.0.md` | 11 张业务表、约束、FTS5 与事务 |
| 技术契约 | `PIS_技术实现设计_v1.0.md` | 六阶段、API、LLM、RSS、部署、容错 |
| V1 里程碑与任务 ID | `PIS_V1_开发实施计划与任务拆分_v0.1.md` | D00～D16、Dxx-Tyy、依赖及任务边界 |
| 验收 Case ID | `PIS_V1_测试用例设计_v0.2.md` | 201 项 Case ID，P0/P1/S0/S1 分层 |
| Prompt 原文 | `config/prompts/*.md`（五个功能 Prompt + `user-context.md`） | 模型指令的唯一维护来源 |
| Agent 工作流 | `/通用规范/Agent_开发流程规范_v1.0.md` | 三文档、角色、会话、复核、交接 |
| 项目级 Agent 约束 | `docs/project-development.md`（本文件） | PIS 特例、必要 Git/测试约束 |

优先原则：**通用规范管流程，PIS 权威文件管业务和技术，测试文档管验收，里程碑三文档管当前批准的执行契约**。若有矛盾，停止受影响任务，由 Architect 指出具体冲突及修订目标，按对应 Gate 审核；不能默默选择一个看起来合理的版本。

## 3. 固定技术基线与禁止事项

PIS V1 已确认：

- **TypeScript（`strict`）+ Node.js LTS**，不使用 Bun，不使用 Kotlin/Java 实现 V1 业务。
- **Fastify**（JSON API）；**better-sqlite3 + 直接 SQL**（SQLite WAL、FTS5，非 ORM）；**Zod**；Node.js 原生 `fetch`；Promise/async-await 有界内存队列；**node-cron**、**Pino**、**PM2**。
- **单进程运行、六阶段任务链**；任务仅传业务 ID；HTTP/LLM 操作不得发生在数据库写事务中；提交后由 Runtime 统一派发下游。
- **11 张业务表 + 可重建 FTS5** 是已确认的数据模型边界；初始不增设持久化队列、Outbox、消息代理、微服务、独立审核 Agent 或无必要的架构抽象。
- 五个功能 Prompt 和一份 User Context 都从 `config/prompts/` 的真实 Markdown 读取；**不引入代码内硬编码副本或启动时不可变缓存**。
- Published Item 发布资格由 Topic Matching 决定，V1 发布模板不调用 LLM；RSS 是云端静态文件，使用高随机秘密 URL；PIS 自身的 HTTP API 继续使用 Bearer Token。

尚待实施期验证或决策而非 Agent 可擅自定案的项目：Node.js 精确小版本及原生模块兼容；FTS5 trigram 实测；查询 Cursor/错误码；LLM Provider 配置；Gitee Raw / GitHub Pages 最终平台及真实订阅效果。**不相关的未决项不得阻塞前置里程碑**。各项已落实的精确版本与验收证据见对应里程碑 progress。

Source `type/url` PATCH 策略已由负责人明确决定：**创建后不可修改**。该决策解决技术设计与测试设计中原有的待定项，影响 D03-T01/T02；由 D03 Spec 固定接口拒绝行为及专项测试，再经 Plan 落实。

## 4. 里程碑与三文档映射

- **正式工作分解唯一来源**：原 `D00～D16` 共 17 个里程碑、69 个 `Dxx-Tyy` 任务卡。原 M0～M5 粗分组不再作为任务入口。
- **G1 批准的前置例外**：`D11A`（运行整合与环境适配）是负责人 G1 批准、作为 `D12` 前置例外的里程碑，因此当前共 18 个里程碑（`D00～D16` 加 `D11A`）、4 张 `D11A-Txx` 任务卡；原 69 个 Dxx-Tyy 卡 ID/数量与业务语义保持不变。
- 每个里程碑使用 `docs/milestones/<Dxx>/intent.md → spec.md → plan.md`，配套 `progress.md` 保存执行状态。
- 先映射现有批准的项目级设计与任务卡，**不重写**业务方案、不创建第二套 ID、不重复维护 69 项任务描述。`plan.md` 只增补当前里程碑需执行的文件级边界、依赖、验证命令、证据。
- G1：项目负责人审批 Intent；G2：Architect 审核 Spec，重要架构变更由负责人确认；G3：Architect 审核 Lead 的 Plan。未过 Gate 不发正式 Worker 开发任务。
- 每完成一个任务：Worker 自测并提交证据 → Lead 审核 → Architect 轻量复核 → 合并、记录 `PASS` 和 Git commit → 新 Worker 会话领取下一张任务卡。审核失败按通用规范处理。
- `progress.md` 不构成新的设计 Gate；任务状态遵从通用规范（`NOT_STARTED / READY / IN_PROGRESS / REVIEW / PASS / FAIL / BLOCKED`）。**当前状态以实际 Git、测试和审核证据为准**，不能仅因计划已确认就标为 PASS。

## 5. PIS 特有的验证与验收约定

1. **执行命令**：D00-T01 固定 `typecheck` 和 `build`；D00-T02 固定测试运行器；D00-T03 增加启动/关闭 smoke；D00-T04 收敛 `install/typecheck/test/build` 的本地与 CI 统一命令。在相应脚本尚未建立前，不编造“已运行通过”的证据。
2. **确定性代码测试**：P0 为合并硬门槛，按任务引用 Case ID 及对应 Fixture/Stub；涉及数据库的任务覆盖回滚、重复执行及持久化不变量；涉及 API 的任务验证鉴权/分页等；涉及 RSS 的任务验证静态文件与归档稳定性。
3. **模型语义测试**：S0/S1 使用真实模型并记录模型版本、输入、成本与判读；与 P0 的固定 Stub CI 测试分开。P0 通过不等于真实模型语义合格。
4. **任务级最小上下文**：仅加载任务卡、受影响的 `spec` 小节、测试文档相应 Case ID 和必要代码；五个 Prompt 不得在无关任务中整包加载；架构基线引用需精确到相关章节。
5. **独立 Gate**：Knowledge Analysis（D07）、Event Search（D08）、Event Analysis（D09）分别验收；D12 只要求本地静态 RSS 闭环，D13 才需要最终选择云端平台。
6. **显式阻塞而不擅改方案**：如 D01 的 FTS5 trigram 验证不成立，标 `BLOCKED`，提供可复现环境证据并交 Architect；不偷换为 `LIKE` 或其它搜索机制。未决定 Gitee/Pages 不影响 D00～D12。

## 6. 分支、交接与变更记录

- 尽量每个 `Dxx-Tyy` 使用独立 Git 变更集或工作分支；同一代码位置串行更改；未获 Lead 与 Architect 复核前不得合并主干。
- 交接记录至少包括：任务 ID、起始 Git commit、改动文件、验证命令及结果、引用 Case ID、偏离/阻塞、Lead 与 Architect 审核结论；摘要不复制终端长日志和聊天记录。
- 对项目级权威设计文档的改动需显式列出：触发原因、影响范围、受影响任务 ID、复核结论；不允许 Worker 为修补测试直接改设计/修改测试预期。
- 密钥、Bearer Token、完整不可猜测 RSS URL、数据库备份、私密内容不可进入 Git、Agent 任务卡和日志。公开仓库里的随机 URL 路径不构成真正的访问控制。

## 7. 开发推进心跳（负责人持续授权）

- 负责人于 2026-11-17 明确要求，并于 2026-11-21 再次确认：每次进入开发阶段后，由 Architect 自动使用 `create_heartbeat` 创建推进心跳，持续监控任务执行，及时发现并处理审核交付、失败或阻塞，确保项目持续推进；开发任务完成后，由 Architect 自行删除对应心跳。此授权适用于后续各里程碑，不必逐次重新询问。
- 触发时点：里程碑 Plan 获执行批准、开始正式开发时；默认每 10 分钟（`*/10 * * * *`），时区 `Asia/Shanghai`。同一里程碑只保留一个活动心跳，恢复会话先核对记录，避免重复创建。
- **必须使用 `create_heartbeat`，不得使用 `create_schedule`**：`create_heartbeat` 向当前主会话 Architect 发送提醒，由主会话 Architect 亲自决策；`create_schedule` 的目标为 `new-agent`，每次新建独立 agent 实例，会自行批准 G3/G4、merge 与归档，形成未经 Architect 审核的隐性审批路径（D11-T01 曾发生）。二者是不同对象类型，不可互换。
- **心跳只提醒、不代审**：心跳不得批准 G3/G4、不得创建 candidate、不得 merge/push、不得修改源码或 progress.md、不得归档 workspace、不得删除自身、不得代替 Lead 创建 Worker。G4、合并、Gate、归档等一切审核与收尾操作均由主会话 Architect 亲自执行。
- 每次根据最新 `progress.md`、Plan、Git 和必要 Paseo 状态恢复，识别实际 Lead/Worker；正常工作不打断，及时组织候选复核及阻塞修复，不越过角色或审批门禁。
- 心跳提醒应依据最新 `progress.md`、Plan、Git 与 Paseo 状态检查任务是否停滞，并提示 Architect 组织下一步审核、修复或派发；只在进度变化或实际阻塞时报告，不反复发送无变化的催办。心跳本身不构成 push 授权。
- 在对应里程碑 `progress.md` 记录心跳 ID。该里程碑开发任务全部完成、不再需要持续推进时，或负责人要求停止时，Architect 必须使用 `delete_heartbeat` 删除准确 ID 并核实成功，不遗留无实际用途的心跳；历史遗留的 `create_schedule` 对象需用 `delete_schedule` 清理（对 `delete_heartbeat` 会报 not found）。推送授权按 §8 持续生效，不因等待 CI 而反复催问。
- D04 已创建活动心跳 `b31a1236`；后续实际状态以 D04 Progress 及 Paseo 为准。

## 8. 里程碑推送、最终收尾与归档（负责人持续授权）

- 负责人于 2026-11-17 明确追加持续授权：每个里程碑完成本地分级验收及集成 Gate 后，Architect 可以直接推送该里程碑的已批准 main 提交并等待远程 CI，无需逐次重新询问 push 授权。
- 推送前核对当前完整 SHA、工作区 clean、批准候选/合并关系、私有文件未跟踪及自 Gate 后仅文档变化；不得夹带未经审核的生产改动。推送后必须核验远程分支 SHA，以及该精确 SHA 对应的 CI Success，不能用旧里程碑或本地测试替代。
- CI 失败时记录真实失败并组织 Lead 定位修复；修复涉及生产代码须重走受影响任务门禁与必要回归，再推送新 SHA。只有本地 Gate 与远程 CI 同时满足才签发最终 PASS。
- 负责人明确要求：每个里程碑最终验收完成后，Architect 组织 Lead 核对并归档该里程碑所有 Worker 及对应工作区，无需另行询问。逐卡已经归档的对象只核验，不重复操作。
- 归档前核对 candidate/merge 与工作文件、分支指针对齐及 tracked/untracked 状态；任何唯一未交付成果必须先定位、保留并处理，不能借归档丢弃。旧进度文档不得覆盖主线最新记录，私有文件不读、不复制、不 stage。
- 使用 Paseo `archive_workspace` 归档 Worker 的独立工作区及其所属 Agent/终端，并核验返回结果与活动列表。若仍有属于该里程碑的活动 Worker Agent，再针对准确 Agent ID 使用 `archive_agent`，确认成功。
- 不归档主工作区、Architect/Lead 所在共享工作区或其他里程碑仍使用的工作区；若共享工作区中存在已完成 Worker，仅归档相应 Worker Agent，不影响其他活动角色。
- 在该里程碑 `progress.md` 记录 Worker/Workspace ID、交付提交、归档及目录移除结果；归档失败或存在未交付成果时明确记录收尾未完成，不宣称已全部清理。
- 最终交付说明同时包含验收结论、推进心跳删除结果及 Worker/工作区归档结果。

## 9. 里程碑 D00 的试行策略

- 第一个试点为 **D00：工程骨架**，包括 `D00-T01` 至 `D00-T04` 四张已确认任务卡。
- 首先提交 `docs/milestones/D00/intent.md` 给项目负责人做 **G1 审核**；通过后才制定/审批 `spec.md`（G2），再生成并审核 `plan.md`（G3），然后从 `D00-T01` 开始编码。
- D00 验收目标是干净环境下可安装、类型检查、测试、构建、启动、关闭；不提前实现数据库表、业务队列、分析流程、LLM 或实际 RSS 发布。
- 规范试运行中发现协作问题，应记录到流程改进建议，不因此擅自修改通用规范 v1.0；通用规范升级由独立版本控制。

## 10. 审核记录

- 项目负责人：用户（当前项目负责人）
- 审核结论：**APPROVED**
- 审核日期：2026-11-15
- 审批依据：负责人明确回复“是的，由你担任 Architect，采用当前这份项目开发规范”。
- 批准基线：本文件 v0.1；本次仅更新审批记录，不变更规范条款。
- 角色分配：当前会话 Agent 担任 Architect；后续由 Architect 通过 Paseo 委派 Lead，由 Lead 通过 Paseo 委派 Worker。
- 阻塞项：本规范采用无阻塞；D00 Intent 仍须独立经过 G1 审核。

