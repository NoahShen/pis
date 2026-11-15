# D02 Spec · Prompt 与 LLM 基础

> 版本：v0.2
> 状态：APPROVED · Architect G2 v0.2 隐私范围针对性复核通过，负责人已确认 Provider 协议
> 依据：[Intent v0.2](intent.md)，负责人已通过 G1 并批准 User Context 隐私范围变更。
> 前置：D01 `5bf17f5` 已推送，远程 CI Success。

## 1. 范围与权威依据

遵循技术实现设计 §17、测试设计 §4.12 和 D02 四张任务卡。本规格只提供文件读取、模型输出校验、HTTP 调用和固定测试工具。不读写业务数据库、不执行历史检索、不创建 Runtime、业务 API 或队列。

已读取并核对当前 `config/prompt/` 下五份功能指令；未修改文件，未将实际 User Context 复制进文档。§17.4 和实际 P-02 指令明确输出 `clues[].entity_name`，因此采用此结构；技术设计 §3.2 的单条 `entity` 示例只解释结构含义，不另建第二种响应格式。

## 2. Prompt 文件读取（T01）

- `PromptRepository` 构造时接收明确的根目录，使用固定功能名到五个文件名的映射，不接受外部任意文件路径。模块导入和构造不读取文件、不读取环境变量。
- 每次调用模型前重新读取对应 UTF-8 文件，返回此次请求的文本快照；不缓存内容，不启动 watcher。后续修改不会改变已组装的请求，但影响下一次尝试。
- Knowledge 调用读取 `knowledge-analysis.md` 和 `user-context.md` 后才可发请求；其他四类不读 User Context。本次快照不承诺两个独立文件编辑操作具备文件系统事务原子性。
- 读取失败、缺文件或只有空白的功能指令均作为配置错误，不发送 HTTP，不回退旧文本或空指令。原始文本保持原样，不自动 trim、替换或追加私密数据。
- T01 只把五份功能 Prompt 按原字节对齐至 `config/prompts/`，记录迁移前后摘要，不保留功能 Prompt 重复副本。真实 `config/prompt/user-context.md` 保留原位、仅本地私有，不复制到 worktree、不 stage、不读取正文、不进入公开 Git。旧目录因保留真实文件而不整体删除；合并后只处理五份功能 Prompt 旧源。
- 真实 User Context 的公开结论为 DENIED。`.gitignore` 增加精确 `/config/prompt/user-context.md`，不得忽略 `config/prompts/user-context.md`。公开同名文件由 T01 Worker 新建为明确标注的通用合成测试背景，不从真实文件派生、改写或脱敏生成，也不要求与真实文件摘要相同。
- 固定测试仅使用公开合成背景或临时目录，绝不读取真实 `config/prompt/user-context.md`。运行期由部署显式指定单一 Prompt 根目录；Knowledge 从该根目录读取功能指令和 User Context。本轮不增加双根目录、自动探测或 fallback。
- PromptRepository 测试使用临时 Markdown 与合成背景，验证连续读盘、错误、仅 Knowledge 读取两文件、同次请求快照以及下一次尝试读取修改后的文件。

## 3. 五类响应校验（T02）

所有对象包括嵌套对象均严格禁止未知字段。先解析完整 JSON，再用 Zod 校验；不从 Markdown fence 或解释文本中猜测提取 JSON，不自动修复错误响应。字符串必填字段须至少有一个非空白字符；校验不擅自改写事实文本。

| 功能 | 允许的结构 |
|---|---|
| P-01 | `{routes: Array<"EVENT" | "KNOWLEDGE">}`；允许空数组，按首次出现顺序去重 |
| P-02 | `{clues: Array<{entity_name: string, subject: string, search_terms: string[]}>}`；允许空 clues，词项须非空，不生成 Event ID 或确认别名 |
| P-03 NEW_EVENT | action、title、entity: {name}、subject、scope、description、occurred_at?、confirmed_aliases；禁止 event_id 和新 Update ID |
| P-03 NEW_UPDATE | action、event_id、title、description、occurred_at?、confirmed_aliases；禁止生成 Update ID |
| P-03 NO_INCREMENT | action、event_id、event_update_id（合法旧 Update ID 或 null）、confirmed_aliases；不接受新事实字段 |
| P-04 false | 严格 `{valuable:false}` |
| P-04 true | valuable、title、summary、category?、findings: Array<{title,description}>、value；category 为 Insight/Experience/Method/Resource 或 null，缺省同样表示未分类；findings 可以为空，不凭空要求固定数量 |
| P-05 | `{matched_topic_ids:string[]}`；允许空数组，按首次出现顺序去重 |

P-03 外层严格为 `{results:[上述分支]}`；空结果合法。confirmed_aliases 必填且允许空数组，项为非空字符串，精确字符串去重，不做二次语义确认。occurred_at 可缺省或 null；有值时接受带显式时区的合法 ISO 时间点，业务层后续统一存储格式，本阶段不生成事实发生时间。

校验调用显式接收该次候选 Event ID、Update ID 到所属 Event 的映射及启用 Topic ID 快照；不查询数据库、不跨调用缓存这些集合。未知 Event/Topic ID、错误 Update 归属必须拒绝；同一 Event 返回互相矛盾动作必须拒绝，同一 Event 重复 NEW_UPDATE 也必须拒绝，不能在后续落库时才发现。

允许空数组、false 和 NO_INCREMENT 是正常业务结果，不转成技术错误。完整内容路由、Knowledge 写入、Topic 为空时业务短路等留给对应模块。

测试覆盖五类合法结果、额外字段、错误类型、必要字段缺失、非法 enum、未知引用、Update 归属、矛盾动作与严格 false 分支，保持 PMT-07/14/15 的基础验证边界。

## 4. 调用边界与请求组成（T03/T04）

- 对外提供只执行一次尝试的调用函数：读 Prompt → 组装请求 → HTTP → 提取模型文本 → JSON 与引用校验 → 返回类型明确的结果。
- HTTP 适配器和单次调用函数均不自动重试。既有 RW-02 的最多两次属于业务任务总尝试预算，未来由业务/Runtime 调用方负责，不新增第二个独立预算。
- D02 测试用有界调用方模拟第一次非法 JSON、修改 Prompt、第二次调用，证明每次尝试重新读盘；这不等于实现完整 Runtime 重试或业务结果复用。
- 功能指令与动态数据使用不同请求字段/消息。数据以 JSON 序列化传递，不把其中内容拼进角色或模板指令。Knowledge 的背景与功能指令分开标记；其他功能根本不提供背景字段。
- 输出 Schema 的字段说明由代码产生，不在 Markdown 维护可执行 Schema 副本。供应商原生结构化输出不取代本地校验；是否使用其原生能力按 §5 确认后的协议决定。
- 不允许模型调用执行 SQL、外部工具或应用代码。模型返回是待校验文本，不执行 tool call。

## 5. HTTP 协议与调用边界

### 5.1 已确认：OpenAI-compatible Chat Completions（非流式）

负责人明确确认“先采用 OpenAI-compatible Chat Completions（非流式）”。首个实现只支持该协议，不同时实现 Responses、Anthropic Messages 或多个 Provider 适配层。

- 向配置的完整 endpoint URL 发起 POST，不自动补 `/v1/chat/completions`。请求头为 `Authorization: Bearer <apiKey>` 与 `Content-Type: application/json`。
- 请求体包含 `model`、`stream:false`、`messages`。首条 system 消息为本次读取的功能指令及由代码生成的输出结构要求；user 消息用 JSON 明确包含动态任务数据，Knowledge 另以独立字段携带 User Context，其他四类不带此字段。不从动态数据生成 role 或请求配置。
- 不发送 tools、tool_choice 或流式参数；不默认供应商支持 `response_format: json_schema`。基础模式要求文本 JSON 并严格本地校验，未来原生结构化输出适配另行明确。
- 成功 HTTP 响应须为 JSON 对象，`choices[0].message.content` 必须为非空字符串；拒绝 null、数组、多模态内容、工具调用及明确 refusal。`choices[0].finish_reason` 须为 `stop`，截断或工具调用结果作为响应协议错误，不当作有效业务输出。其他供应商元数据可忽略，不应用业务 Schema 的严格字段规则校验整个 envelope。
- 提取 content 后按 §3 解析完整业务 JSON 并校验。供应商响应正文不进入日志或异常消息。
- endpoint、密钥和具体模型由部署时显式提供；当前固定测试不需要真实供应商或密钥。

### 5.2 各协议共用行为

- 配置通过参数传入：完整 endpoint、apiKey、model、timeoutMs、maxResponseBytes。默认单次超时 60,000ms、最大响应 2 MiB；数值必须是有限正整数，密钥与模型名不能为空。详细 TS 名称在 Plan 固定。
- endpoint 为明确 HTTP(S) URL，不自动补路径，不从模型响应读取新地址；禁止 URL 中嵌入用户名/密码。生产使用 HTTPS；HTTP 仅允许 loopback 测试地址。不自动跟随重定向，防止鉴权和请求数据被带往其他地址。
- 使用原生 fetch 和 AbortController。超时覆盖连接、响应头与响应体读取；调用方 signal 取消后尽快退出。每次尝试 finally 清理 timer、事件监听与响应 reader，避免留下后台计时器或流。
- 按实际流读取的字节数限制响应，不只信任 Content-Length；超限取消读取，返回响应大小错误。非成功 HTTP 响应同样不能无限读取，也不将响应正文拼入异常。
- 错误至少区分配置/Prompt、取消、超时、网络、HTTP、响应协议、响应过大和输出校验。可附安全 status 和稳定 code，不带 token、完整 endpoint query、Prompt、User Context、正文或供应商错误 body。
- 非法输入、配置错误和取消不重试；暂时网络故障、超时、429、5xx 及非法模型输出可供上层判断是否在剩余任务预算内重试。401/403 不进行盲目重试。
- HTTP 测试使用注入 fetch 替身或本地受控服务器，不连接收费服务。必须覆盖成功、失败 status、无效 envelope、取消、挂起响应体、超限，以及资源清理和敏感字段不泄漏。

## 6. 固定替身与验证（T04）

StubLLM 按固定序列返回文本或错误，耗尽明确失败，不随机兜底。请求捕获器保留隔离的测试快照，供测试断言每类请求中的指令、背景、动态数据和调用次数；生产不持久化这些内容。

每类功能至少覆盖正常输出、正常空结果和非法输出。PMT-13 使用可变临时 Prompt、第一次非法 JSON、第二次有效 JSON，验证两次请求的指令不同且各自稳定。只在合成样例中检查敏感 sentinel，不读取实际 User Context。

`npm run verify` 继续覆盖 D00/D01 回归。生产模块导入无网络副作用，源码测试不依赖未生成 dist。干净 checkout 可使用合成配置运行全部固定测试；部署缺少真实配置应清楚报错。

PMT-11 指令注入防护与 PMT-12 模型稳定性涉及真实语义，未运行时 NOT_RUN；Mock 只证明请求结构、校验和错误处理。后续业务事务与“失败不部分落库”由业务模块验收，D02 不接数据库。

## 7. G2 与下一步

- Intent G1：APPROVED。
- 本 Spec：APPROVED；Architect 核对五个功能 Prompt、技术契约及负责人确认的非流式 Chat Completions 协议，G2 通过。
- 协议批准依据：负责人明确回复“先采用 OpenAI-compatible Chat Completions（非流式）”。实际 endpoint/model/密钥仍为部署配置，不作为固定测试前置。
- v0.1 当时下一步为通过新的 Paseo Lead 会话制定文件级 Plan；该计划已形成并经 G3 审核，历史结论保留。
- Plan v0.2 经负责人批准执行；本 v0.2 Spec 与 Plan v0.3 记录随后的 User Context 隐私范围变更，不再等待旧公开授权。
- 2026-11-15 用户隐私变更：真实 User Context 禁止进入公开 Git，公开文件只允许独立合成测试背景。Architect G2 已做针对性复核并 APPROVED；该变更覆盖 Spec v0.1 中“六文件字节不变迁移”的 User Context 部分，五份功能 Prompt 的原字节要求继续有效。
- Plan v0.3 的执行批准来源为 Plan v0.2 + 本次隐私变更。真实 User Context 公开状态为 `DENIED`，公开 Context 模式为 `SYNTHETIC_TEST_ONLY`；D02 推进心跳 `b59d1a26` 已 active。
