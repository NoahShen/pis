# D11A Spec：运行整合与环境适配

- 状态：`APPROVED · G2`
- 批准日期：2026-11-21
- 上游：D11A Intent（负责人 G1 批准）；D00～D11、D15 既有公共契约
- 基线：main `b2f99ce3722e1f9a4b30e3544bc9ffdcdde16a74`

## 1. 交付边界

新增生产运行装配层，复用既有服务，不改六阶段任务、重试、队列和数据库契约。保留轻量 `buildApp` 供配置 API/Stub 测试；真实生产入口必须显式装配业务服务，不在请求中延迟创建 Runtime。

## 2. 配置契约

在 `AppConfig` 增加已解析配置：

| 环境变量 | 缺省 | 规则 |
|---|---|---|
| `PIS_LLM_ENDPOINT` | 无 | 必填，合法绝对 http/https URL；不含 userinfo/query/fragment |
| `PIS_LLM_API_KEY` | 无 | 必填非空，日志和错误不得包含值 |
| `PIS_LLM_MODEL` | 无 | 必填非空、无首尾空白 |
| `PROMPTS_DIR` | `config/prompts` | 解析为绝对路径，保持 Prompt 每次读盘 |
| `RSS_SSRF_PROTECTION` | `true` | 只接受 `true` / `false`；仅 false 关闭解析 IP 地址范围防护 |
| `CRON_TIMEZONE` | `Asia/Shanghai` | 非空，启动时由 Scheduler 验证 |

- `loadConfig` 对缺失/非法字段产生稳定 `ConfigError`，不回显 secret。
- 既有轻量测试可通过构造 `AppConfig` 或测试工厂注入依赖；不要求所有 Stub 测试提供真实 LLM。
- 生产 `main` 缺省使用真实装配工厂，不允许无 LLM 时静默退化为空 Runtime。
- 不把模型超时、并发、重试扩展成新配置面；沿用已验收 D02/D15 默认值，真实 smoke 可使用受控依赖注入。

## 3. 生产装配

新增独立生产装配模块，所有权清晰：

1. 解析 DB 路径、打开并初始化一次 SQLite。
2. 创建共享 `Clock` / `IdGenerator` / PromptRepository / LLM client。
3. 创建 Source/Topic、Source Item/Content、Knowledge、Event、Candidate、Association、Published Item Repository。
4. 创建 Restricted RSS Transport/Adapter、Collection persistence/acquirer/collector、Processing、Knowledge、Event Search/Analysis、Topic Matching、Publication。
5. 使用六阶段真实 Service 创建 D15 Runtime 和 Cron Scheduler；一个 Runtime 实例对应一个 Scheduler。
6. 注册既有配置 API；不新增业务触发端点，由既有测试/内部 `scheduler.trigger(sourceId)` 提供手工触发能力。
7. Fastify ready 前启动 Runtime，listen 成功后启动 Scheduler；若 ready/listen 失败，停止 Scheduler 并关闭 Runtime/DB。
8. 关闭顺序：Scheduler stop → Runtime shutdown（排空/超时取消）→ Fastify HTTP/其他 hook → 最后关闭 SQLite；多次关闭幂等。

可提供 `buildProductionApp` / 显式 assembly result，但不得导出秘密或把内部 Repository 变成 HTTP API。依赖注入边界允许测试替换 DNS/fetch/LLM/Clock/Scheduler，不在生产暴露任意 Transport 开关。

## 4. SSRF 调试开关

- `RestrictedHttpClientOptions` 增加 `allowPrivateAddresses?: boolean`，由 `rssSsrfProtection === false` 映射为 true；缺省 false。
- 仅跳过 `address-policy` 中私网/回环/link-local/保留/未指定地址范围拒绝，不改变 DNS 固定和逐跳 DNS/连接校验。
- URL scheme、userinfo、hostname 语法、localhost 名称、端口、redirect、timeout、body limit、MIME/charset/Content-Encoding 等策略保持不变。
- 关闭时通过现有 Logger 的安全扩展或专用 callback 输出 `rss_ssrf_protection_disabled`；不得包含 URL、IP、Header、API key 或正文。不得让业务模块读取该值。
- 默认 D04 全部安全 Case 原样通过；新增 false 路径测试证明 loopback 可用及 scheme/userinfo/port/redirect 等仍受限。

## 5. inner 编码兼容

已确定根因：innei 返回 `Content-Encoding: zstd`，Node 26 `fetch` 自动解压为合法 XML 后保留原 Header；生产白名单只有 identity/gzip/x-gzip/deflate/br，因而误报 `unsupported_encoding`。需要以确定性 Response fixture 验证，而非放宽任意编码。

- 将受支持的单一 `zstd` 纳入与 Node 26 原生解压一致的 Content-Encoding 白名单；使用最终解压 bytes 做 MIME/charset、UTF-8/XML/HTML 和流式上限校验。
- 不支持多值/未知编码；不得把 `compress`、多值编码或真实不支持的字节流当成成功，不得全局吞掉 `unsupported_encoding`。
- 不得通过请求 `Accept-Encoding: identity` 规避真实服务器 zstd 路径，也不做 inner URL 特判。
- 压缩响应仍须经过流式最大 bytes 和取消；不能用一次性 `arrayBuffer()` 绕过限制。原生自动解压路径若无法提供压缩前上限，Spec 要求保持解压后上限并记录平台限制，不宣称已限制网络压缩字节。
- 新 Fixture 必须证明此前失败的 zstd 形状、合法 XML/HTML、非法/多值编码拒绝及既有压缩/超限/取消用例不退化。

## 6. 日志与错误

- 装配、启动失败沿用安全 startup/app/config error；不增加含秘密的结构化对象。
- Runtime/Scheduler/DB 关闭错误被聚合为现有 close outcome，不因一个失败跳过后续清理。
- 不新增稳定业务错误码，不改 API DTO。

## 7. 验收与测试

1. 配置：默认值、布尔严格校验、URL/secret/目录非法输入和 secret 不泄漏。
2. SSRF：默认 Fake-IP/loopback 拒绝，显式 false 仅放行地址范围，其余限制和 redirect 目标策略保留。
3. 编码：原生解压 Fixture、inner 形状回归、未知/多值编码拒绝、大小/取消。
4. 装配：spy 证明六阶段真实服务委托、Prompt 路径、模型参数、Scheduler/Runtime 启停顺序、初始化失败回滚、重复 close。
5. 集成：真实 SQLite + 本地 RSS + Stub LLM 完成至少 Knowledge/Event → Topic → Publication，默认库路径不被测试触碰。
6. 回归：全量 tests/build/format、既有 smoke，新增生产 smoke 在临时 DB 运行。
7. 真实双 RSS + 测试 LLM 在独立临时 DB 复验，不纳入 P0/CI；密钥只从本机环境读取。

## 8. Gate 与交付

- D11A G4 前所有任务 candidate 冻结、独立 merge 复验、全量 Gate。
- Architect 独立干净快照复验通过后 push main。
- 远程 GitHub CI 必须绑定最终精确代码 SHA 且 Success；只改验收文档的后续提交需按既有审计规则记录。
- 完成后删除心跳、归档 Agent/worktree，通知负责人验收；不自动开始 D12。
