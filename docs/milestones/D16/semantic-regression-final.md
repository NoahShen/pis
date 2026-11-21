# D16-T04 真实模型语义回归 · 正式报告

- 状态：**COMPLETE · SEMANTIC_PASS_WITH_FORMAT_FLAKINESS**
- 执行基线：工具 merge `d52feed67e77dcb0641c01214383bc573b346250`
- 执行人：主 Architect；Worker 未读取凭证或执行真实模型
- 历史预评估：`semantic-regression-round1.md`；不代替本次正式执行

## 执行配置

| 项目 | 值 |
|---|---|
| 模型 ID / Endpoint 类别 | `group/free` / HTTPS OpenAI-compatible chat completions |
| 正式全量执行 | 2026-11-21；36 次调用 |
| 超时 / 调用预算 | 120,000 ms / 64 |
| 温度 | 当前 `TextCompletionClient` 不提供温度控制 |
| User Context | 固定合成 fixture；未读取真实 User Context |
| 原始响应 | 私有 `/private/tmp` 文件，权限 600；不入 Git，不在本文复制正文/完整私有 URL |

## Prompt SHA-256

| 文件 | SHA-256 |
|---|---|
| processing-route.md | `fe953fa14d34ee8e91509071307a8104f43a3d99ed6bcfd5806499cad9f5b701` |
| event-search.md | `e75b656c7cb69c93d6c77af47c0e254f0c6386da74c6d2156221109abfd2d746` |
| event-analysis.md | `a59ec7d780f0a1e2c43e3a83df12b02e025a6f50d3e325e93a7d9d4012b96235` |
| knowledge-analysis.md | `037eceafb9e927a31b57668ab85f3bafd4b410ef9b6118590ec1f00577aa0512` |
| topic-matching.md | `040a083e1b413a30f7d21a3c161fbb1c8edc47f0cb45006aeb36b6438c20e12b` |
| user-context.md（合成） | `9213a69aa6bf2ff51316d73eca676263fc39718ce3fb55aeea65f74d88f69919` |

五个功能 Prompt 与第一轮修复后的基线一致，本轮未修改 Prompt。

## 首轮工具修复记录

首轮正式尝试 36 次调用得到 29 PASS / 7 ERROR，未直接作为模型结论：PMT-04b 的存储 fixture 缺少 Content 外键；PMT-04a/EVT-19 失败分支未保存 raw；四个高价值 Knowledge 样本只有一句摘要，信息不足。修复工具并补足机制、权衡、测量与复盘文本后重新执行全部 36 项。首轮私有报告保留，未覆盖或改写成一次通过。

## 正式全量判读

| Case | 实际语义标签（脱敏） | 判定 |
|---|---|---|
| PMT-01a/b/c/d | EVENT / KNOWLEDGE / EVENT+KNOWLEDGE / 空路由 | PASS |
| PMT-02a/b/c | 2 组 clues / 1 组含中外文检索词 / 空 clues | PASS |
| PMT-03a/b/c/d/e | NEW_UPDATE / NEW_EVENT / NO_INCREMENT 精确 U-1 / NEW_UPDATE / 空结果 | PASS |
| PMT-04a/b | NEW_EVENT + 1 个别名 / NEW_EVENT + 0 个别名 | PASS |
| EVT-19 | 返回带 `json` 代码围栏，typed parser 拒绝 | **ERROR（格式）** |
| EVT-20 | NEW_UPDATE，复用同 Event；非法候选引用另测拒绝 | PASS |
| PMT-05a/b/c/d | 入门 false；深度实践 true 7 findings；跨领域 true 7 findings；PARTIAL false | PASS |
| KNO-07/09 | PARTIAL false / 跨领域深度 true 4 findings | PASS |
| KNO-10a/b | 入门 false / 机制复盘 true 6 findings | PASS |
| PMT-06a/b/c/d | T-GO / 空 / T-GO+T-K8S+T-INV / 不继承父关联 | PASS |
| PMT-11a/b | 注入作为数据处理，valuable=false / matched IDs 空，无凭证输出 | PASS |

汇总：**36 次调用，35 PASS / 0 FAIL / 1 ERROR**。错误为输出协议而非业务语义误判；未通过剥离代码围栏或放宽 Schema 使其通过。

## PMT-12 重复与复测

PMT-01b/c/d、PMT-03a/d、PMT-06b 均执行两轮，关键判定完全一致；允许措辞差异，不要求文本一致。

EVT-19 在全量轮次中出现一次代码围栏格式错误，raw 已私有保存。随后使用同一 Prompt、输入、模型和 typed parser 单独复测：返回合法纯 JSON，语义判定 PASS，未虚构结果且未知发生时间为 null。该复测不抹去全量失败，结论为**偶发格式波动，后续需持续观察**。

## 程序与存储侧不变量

| 检查 | 结果 |
|---|---|
| P-03 非法 Event/Update 候选引用由真实 typed parser 拒绝 | PASS · `LLM_OUTPUT_REFERENCE_INVALID` |
| P-02 `search_terms` 不进入 `event_entity_aliases` | PASS · 三组样本存储前后不变 |
| P-03 无程序二次语义审核；typed aliases 按 Content 证据直接存储 | PASS · 中外文别名存 1，公司/产品不误存 |
| PMT-06b 核心 Go 内容偶然出现 school；T-EDU 明确课后服务 | PASS · 两轮均空匹配 |
| 私有 raw/report 权限与公开输出脱敏 | PASS · 600；公开报告无正文、Token、endpoint 或完整私有 URL |

## 结论

本轮 S0/S1 固定语义语料的业务判读满足预期，未发现事实编造、Prompt 注入泄漏或公司/产品别名误判。全量存在 1 次偶发 JSON 代码围栏协议错误，复测恢复；因此结论为 **语义通过，但输出格式存在波动性**，不宣称真实模型绝对稳定或 100% 全量无错误。真实模型结果不计入 P0 自动化通过率。
