# OPS-03-T01 Event Prompt 兼容性基线

- 基线：`c85ae27b71f310802d6230343168deda7470385c`
- Worker 交付状态：诊断工具与离线验证已落盘；**生产 Prompt 未修改**。
- 真实对照：**REAL_BASELINE=NOT_RUN**。本卡未读取 `llm.env`，未执行真实模型调用，未读取真实 Source/User Context，未接触 `group/pis` 凭据。

## 1. 工具与安全边界

`scripts/event-prompt-compatibility.mjs` 直接通过生产 `PromptRepository` 加载 `event-search.md` 与 `event-analysis.md`，复用生产 operation policy、流式 Chat Completions Client、typed calls 和 Schema/reference 校验；不实现第二套 DTO 校验，不启用 `response_format`，不剥离代码围栏。

七类自主合成场景均运行 P-02 与 P-03：

| scenario | 合成语义 |
| --- | --- |
| `event-fact` | 明确发生的事件事实、人数和时间 |
| `new-update` | 合法候选下的新阶段结果，进展自身标题 |
| `no-increment` | 合法候选及历史 Update，无实质新增 |
| `cross-language-coreference` | 法文内容中的同指项目与合法 Event 归属 |
| `company-not-product` | 公司与产品保持不同实体，不确认别名 |
| `empty-no-facts` | 纯观点、无事实，空结果且不强行引用候选 |
| `invalid-reference` | 负向指令夹具，要求程序拒绝不存在的 Event ID |

P-03 输入使用生产 `content` / `candidates` / `updates` 形状，引用白名单由同一候选构造。`acceptance_scenario` 仅标识本地合成夹具，没有真实用户内容。

真实模式只接受显式 `--env-file PRIVATE_PATH --output PRIVATE_PATH`；不继承进程 LLM 配置，不自动读取 `.env`。路径必须为仓库外绝对路径。报告和 `<output>.raw.jsonl` 权限均为 600。raw 逐场景、operation、attempt 保存原始 SSE，不能提交或复制到公开材料。

公开结果与 stdout 仅包含场景、operation、attempt、category/reason、输出形态、首包/首 Content 和 attempt 耗时；不包含模型名、endpoint、Prompt、请求/响应正文或秘密。形态严格限定为 `valid` / `fenced` / `prose` / `schema` / `reference` / 无 Content 时的 `null`：Schema/reference 错误按生产错误原因分类，其余按原始 Content 分类。

## 2. 离线验证

构建后执行：

```sh
node scripts/event-prompt-compatibility.mjs --self-test
npx vitest run tests/llm/event-prompt-compatibility.test.ts
```

Self-test 使用本地 SSE 替身、生产 Prompt 和 typed calls，网络请求为零。七场景各运行两个 operation；四个可重试失败后第二次成功，非法引用场景两次均被拒绝，共 **19 attempts**。覆盖：

- P-02：`valid`、`fenced`、`prose`、`schema`；
- P-03：`valid`、`reference`；
- 合法 NEW_UPDATE / NO_INCREMENT / 空结果及跨语言、公司≠产品输入路径；
- 非法候选 Event 引用始终被生产 validator 拒绝；
- 流式请求、`response_format` 负断言、重试、逐 attempt 计时；
- raw/report 600、公开字段 allowlist 和秘密/正文负断言。

测试对实际场景数做交叉断言，不仅检查固定 attempt 总数。Self-test 临时 raw/report 在结束后删除。

## 3. Architect 真实对照结果

- 首次真实执行：28 attempts 全部以 `LLM_RESPONSE_MALFORMED` 结束，outputShape 为 valid JSON；私有 SSE 证明 stop、usage 和 `[DONE]` 均存在，根因不是 Prompt 或代码围栏，而是 Magpie 在 stop 前后发送 `choices: []` 的 usage-only 事件，流式 Client 误将其判为协议错误。
- 修复：允许带对象 `usage` 的空 choices 事件，其他空 choices 仍拒绝；merge `666238634205e710ca345feff7dcdca24aad9e7b`，回归测试 merge `38c94bc7d22af9b538cb61e5113c2a0c7f8583d9`。
- 修复后生产 Prompt 对照：**14 attempts / 14 SUCCESS / 0 FAIL**，outputShape 全部 valid，累计约 56 秒。七类场景的 P-02/P-03 均第一次成功，含合法 NEW_UPDATE、NO_INCREMENT、跨语言、公司≠产品、空结果和非法引用拒绝。
- **生产 `event-search.md` 与 `event-analysis.md` 无需修改**，不新增输出约束，不启用 response_format，不剥离代码围栏。OPS-02 的极简验收指令问题与生产 Prompt 分离。
- 原始 SSE 和报告仅存私有 600 文件，不进入 Git；公开记录不含模型名、endpoint、正文或秘密。

当前没有真实结果支持修改 Prompt，也没有签发 `OPS-03_FINAL_PASS`。
