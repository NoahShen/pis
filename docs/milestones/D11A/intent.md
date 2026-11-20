# D11A Intent：运行整合与环境适配

- 状态：`APPROVED · G1`
- 批准日期：2026-11-21
- 类型：负责人批准新增的 D12 前置运行里程碑；不改变既有 D00～D16 任务编号与业务语义
- 依赖：D00～D11、D15 已验收；真实双 RSS 端到端试验已证明六阶段业务能力，但仍依赖临时脚本与环境适配

- G1 后续授权：完成 Spec/Plan 门禁后直接进入开发；D11A 完成后 push main 并确认精确 SHA 的远程 CI Success，再通知负责人验收

当前 `app/server` 仅装配配置 API，不能直接构造真实六阶段 Runtime。2026-11-21 使用小众软件与 inner RSS、真实模型和 D15 Runtime 验证生成 4 条 Published Item，但运行依赖临时脚本及两项环境适配：

1. 本机代理将 DNS 映射到 `198.18.0.0/15` Fake-IP，D04 SSRF 私网/保留地址检查按设计拒绝采集。
2. inner 响应在 Node 自动解压与 `Content-Encoding` 组合下触发 `unsupported_encoding`，需要以真实证据定位并建立确定性回归。

## 2. 目标

交付可重复启动、可配置、可在调试及部署环境运行的单进程 PIS：

- 从显式配置装配数据库、Source/Topic Repository、RSS Collection、Processing、Knowledge/Event Analysis、Topic Matching、Publication、LLM 与 D15 Runtime。
- 使用既有公共模块和真实 Markdown Prompt/User Context，不复制业务流程，不新增第七种 Runtime 任务。
- 提供受控 RSS SSRF 调试开关：默认开启现有防护，仅显式关闭时允许 Fake-IP/私网等解析地址用于本地调试。
- 定位并修复可确定的响应编码兼容问题，保留安全限制和确定性测试。
- 建立可重复的本地端到端 smoke，验证配置装配、真实 Runtime 派发、优雅关闭和默认数据库不污染。

## 3. SSRF 开关安全契约（负责人已明确方向）

- 配置名建议 `RSS_SSRF_PROTECTION`，只接受精确布尔文本；缺省为 `true`。
- 仅显式 `false` 时关闭**解析 IP 的私网、保留地址和 Fake-IP 地址范围检查**，供本地代理调试。
- 即使关闭，仍保留 URL 语法、http/https、userinfo、非默认端口、localhost 名称、重定向逐跳限制、DNS 固定、响应大小、超时、MIME/字符集及取消语义；不得改成不受限 Transport。
- 开关变化必须由启动配置显式注入，不能由 RSS 内容、Source URL、模型输出或请求参数控制。
- 关闭时只记录不含 URL、IP、正文和凭据的安全警告；部署文档必须要求线上开启。
- 不通过泛化的 `DEBUG`、非生产 NODE_ENV 或缺省配置隐式关闭。
- 默认路径的既有 D04 P0 安全测试不得削弱；关闭路径必须证明其它防护仍有效。

## 4. 初步范围

1. 启动配置：LLM endpoint/API key/model、Prompt 目录、RSS SSRF 开关和必要运行参数的安全读取与校验。
2. 单进程应用装配：复用现有 Repository/Service，创建 Runtime 和 Scheduler，明确启动、手工触发与关闭所有权。
3. RSS 环境适配：SSRF 开关注入受限客户端；inner 编码问题证据、最小修复与回归。
4. 运行入口与文档：本地调试配置示例不含真实密钥；默认安全；可重复 smoke 与操作说明。
5. 真实验收：使用负责人指定 RSS 与测试 LLM 再跑一次端到端，与 P0 Stub/CI 分开记录。

## 5. 非目标

- 不实现 D12 RSS XML/Archive、D13 云端上传或 D14 查询 API。
- 不修改 11 张业务表、六阶段业务语义、Published Item 模板、Prompt JSON Schema 或 Runtime 重试/队列规则。
- 不引入持久化队列、代理服务、微服务、新 DNS 基础设施或生产默认绕过 SSRF。
- 不在 Git、日志或验收报告中保存 API Token、LLM Key、完整私密配置或真实 User Context 内容。
- 不用临时手工调用各阶段冒充应用装配完成，不用真实模型调用代替确定性测试。

## 6. 验收原则

- 默认配置保持 SSRF 防护并拒绝 Fake-IP；显式调试关闭后允许本地代理采集且其余限制仍生效。
- 正常启动能创建真实六阶段 Runtime，Source 触发的任务沿既有映射到 Published Item，关闭时停止 Scheduler/Runtime/DB 的顺序明确。
- inner 编码问题有确定性 Fixture、最小修复和默认/调试两种路径回归。
- P0 使用 Stub/Fake 和临时 SQLite，不访问真实网络或模型；真实 RSS/LLM 结果另记为人工运行证据。
- 完成后 D12 可在稳定运行基线上实现本地静态 RSS，不再依赖临时装配脚本。

## 7. 待 G1 后细化事项

- 任务卡数量、精确文件写集、配置名称与错误协议由 Spec/Plan 固定。
- Scheduler 是否随服务自动启动、手工触发 API 是否新增端点，以现有 D15 接口和最小运行需要为限，不擅自扩展 HTTP API。
- 真实 User Context 的使用由本次负责人对真实端到端运行的授权覆盖；文档和日志仍不得记录其内容。
