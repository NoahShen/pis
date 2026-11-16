# D04 Intent · RSS Adapter 与正文获取

> 版本：v0.1
> 状态：DRAFT · 待项目负责人 G1 审核
> 起草：Architect
> 实现基线：`09db5ecf11838fa74e8850aaa9d019234f86e682`；D03 最终 PASS，精确提交远程 CI Success。

## 1. 问题与目标

系统已有 Source 配置入口，但还不能读取 RSS 来源或获取文章内容。D04 提供独立 SourceAdapter：读取条目列表、复用条目已有全文、必要时尝试获取文章正文，并在失败时保留实际取得的片段或摘要，为 D05 Collection 提供可序列化输入。

权威依据：

- [项目规范](../../project-development.md) §3～§6。
- [实施计划](../../PIS_V1_开发实施计划与任务拆分_v0.1.md) D04 三张任务卡。
- [技术设计](../../PIS_技术实现设计_v1.0.md) §3 Collection、§10.1 Source Adapter、来源获取安全要求。
- [测试设计](../../PIS_V1_测试用例设计_v0.2.md) COL-01 的适配器部分、COL-08/09/10/15/16 的组件边界。

## 2. 范围

| 任务 | 交付目标 | 验收映射 |
|---|---|---|
| D04-T01 | SourceAdapter 接口、RSS 列表与 entry 解析、来源元数据映射 | 本地 XML/HTTP Fixture；COL-01 适配器部分 |
| D04-T02 | fetchContent：已有可用全文直接复用，否则尽力抓取原文 | COL-08/09 |
| D04-T03 | 抓取失败保留现有内容；超时、重定向、体积、MIME、私网访问防护 | COL-10/15/16 组件部分 |

## 3. 不变量与边界

1. Adapter 返回 SourceEntry/SourceContent；不写 Source Item、Content 或 Source 检查点，不派发任务，不启动调度器。
2. RSS 不依据发布时间与检查点简单过滤条目。新旧条目的持久化判定属于 D05；D05 只对新条目调用 fetchContent。
3. 全文已可用时不再次请求文章网页；需要抓取时，在数据库写事务之外执行。
4. 单篇原文获取失败不应使整个来源批次失败；保留 entry 已有正文、片段或摘要。身份有效但没有可用内容的条目仍可返回，不能补造正文。
5. Adapter 保留实际获取结果及来源信息；最终 Content FULL/PARTIAL 判定属于后续 Processing。
6. RSS 来源和文章请求均有有限资源预算及明确网络访问边界。重定向不能绕过访问策略；本地 HTTP 测试通过受控测试机制运行，不放宽生产默认策略。
7. 不修改 Source type/url 不可变、检查点只读、现有数据库结构与 Prompt 隐私约束。

## 4. 成功标准

- 本地 RSS Fixture 稳定解析身份、链接、标题、时间及已有内容；结果可 JSON 序列化。具体字段与缺失/异常数据规则在 Spec 冻结。
- 已有全文、只有摘要但抓取成功、抓取失败回退摘要、没有任何正文四条路径均有确定性测试，使用请求计数验证全文复用路径没有额外抓取。
- 对超时、重定向、超限响应、异常 MIME 和私网访问有可复现测试及有限终止行为；参数为部署配置，不冒充已经冻结的业务规则。
- 不依赖真实互联网文章可用性或真实模型；现有回归、干净安装和 full verify 通过。
- 三卡逐项通过 Worker 自测、Lead 独立审核、Architect 复核、合并后验证；最终验收另需授权推送后精确提交的远程 CI Success。
- COL 涉及 Source Item 持久化、检查点和 ProcessTask 的断言留在 D05；D04 不宣称这些端到端用例已完整通过。

## 5. 非目标及 Spec 待细化事项

本阶段不实现 Collection 去重与事务、Processing、LLM、Scheduler/Runtime、RSS 输出发布，也不引入浏览器渲染或付费墙绕过。

Spec 需要固定：RSS 支持格式与解析依赖、稳定 external_id 的选择及缺失策略、元数据/内容序列化结构、全文识别与网页正文提取规则、错误与取消行为、HTTP 限额默认值和配置方式、DNS/重定向/私网访问策略。依赖需明确版本、必要性和测试方式；不由 Worker 临时扩展范围。

沿用 Node 26.13.1/npm 11.20.0、TypeScript strict 与原生 fetch 基线。真实 `config/prompt/user-context.md` 不读、不复制、不 stage；五份功能 Prompt 不修改。

## 6. 审核记录

- 用户“好的，继续下一步”授权进入 D04 准备；本 Intent 首次提交 G1 审核，尚未批准。
- G1 通过后由 Architect 编写并审核 Spec；再委派新的 Paseo Lead 编写 Plan，负责人审阅 Plan 后才派发 Worker。
- 当前不创建 Worker、不启动开发心跳、不推送 D04 文档。
