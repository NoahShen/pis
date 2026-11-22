# OPS-01 真实模型错误复验

- 状态：**PENDING**
- 任务：OPS-01-T03
- 执行基线：`5d19794261a6f83e09a52dacb9a2eb7558bcf7ac`
- 真实复验：尚未执行；不得将离线自测视为真实模型验收。

## 离线验证

- `scripts/llm-failure-acceptance.mjs --self-test` 使用编译后的真实 Prompt/typed-call、业务 Error 与 Runtime 组件，覆盖五类 operation、16 个失败分支，共 80 个 Runtime 场景及 5 个 typed-call 错误传递场景。
- 测试只验证参数约束、安全字段、私有文件权限和 Runtime 日志；不访问网络，不读取真实凭证。
- 合法真实调用与本地可控格式/协议故障注入分别记录，后者不得标记为真实模型执行。

## 执行要求

先构建，再由获授权的执行者显式指定仓库外私有路径：

```sh
npm run build
node scripts/llm-failure-acceptance.mjs \
  --env-file /absolute/private/llm.env \
  --output /absolute/private/acceptance.json
```

原始响应仅保存在 `/absolute/private/acceptance.json.raw.jsonl`，权限必须为 `0600`。公开报告与日志不得包含凭证、Prompt、正文、完整 endpoint、模型名或原始响应。

## 真实调用结果（PENDING）

| operation | category | reason | httpStatus | attempt | final | count |
|---|---|---|---|---:|---|---:|
| processing-route | PENDING | PENDING | — | — | — | — |
| event-search | PENDING | PENDING | — | — | — | — |
| event-analysis | PENDING | PENDING | — | — | — | — |
| knowledge-analysis | PENDING | PENDING | — | — | — | — |
| topic-matching | PENDING | PENDING | — | — | — | — |

## 本地故障注入与波动（PENDING）

- 待记录可控格式、协议错误的 `operation/category/reason/attempt/final/count`。
- 待记录真实模型自然输出波动及针对性补跑结果；不要求消除所有自然格式波动。
- 真实上游不可用时保持 `BLOCKED`，不得以 Stub 结果替代。
- 本任务未读取 `llm.env`，未执行真实模型，未进行 Git stage/commit/merge/push。
