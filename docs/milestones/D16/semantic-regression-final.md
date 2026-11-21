# D16-T04 真实模型语义回归 · 正式报告

- 状态：**PENDING / NOT_RUN**
- 执行基线：`38bb2fe`（D16-T04 Worker 固定 base）
- 真实模型执行：未由 Worker 执行；须由 Architect 使用显式私有凭证单独运行
- 首轮执行：36 次调用，29 PASS / 7 ERROR；定位为回归工具与合成 fixture 问题，不作为模型语义结论
- 首轮报告：仅为历史参考，不读取或修改首轮私有报告，不复制为正式结果

## 首轮工具与 Fixture 问题（待二次执行）

| 范围 | 首轮问题 | 修复 | 当前状态 |
|---|---|---|---|
| PMT-04b 存储断言 | 缺少被 Evidence/Alias 外键引用的 Content | 在同一断言事务内插入合法最小 Source、SourceItem、Content；保留真实外键与持久化路径 | 离线测试通过 |
| PMT-04a、EVT-19 原始输出 | typed parser 失败前已获取 raw text，但失败分支未记录 | completion wrapper 在解析前保存 rawText；失败分支写入 rawContent 与安全错误，stdout 不输出正文 | 离线测试通过 |
| PMT-05b、PMT-05c、KNO-09、KNO-10b | 一句式样本没有提供足够机制、权衡、测量和复盘信息 | 改为完整多段合成文本；固定 valuable=true 预期，不按模型输出修改判读 | 离线测试通过 |

上述 7 个 ERROR 均保留为首轮 harness/fixture 问题记录，不宣告真实语义通过。完成修复后的二次真实执行仍须由 Architect 使用显式私有凭证单独进行；本文件不记录或推断二次结果。

## 执行配置

| 项目 | 值 |
|---|---|
| 模型 ID / Endpoint 类别 | PENDING |
| 开始/结束时间 | PENDING |
| 超时 / 调用预算 | 120,000 ms / 64（脚本固定上限） |
| 温度 | 当前 `TextCompletionClient` 不提供温度控制 |
| User Context | 固定合成 fixture；禁止读取真实 User Context |
| 原始响应 | 仅私有输出目录；本报告不记录正文、凭证或完整私有 URL |

## Prompt SHA-256

| 文件 | SHA-256 |
|---|---|
| processing-route.md | PENDING |
| event-search.md | PENDING |
| event-analysis.md | PENDING |
| knowledge-analysis.md | PENDING |
| topic-matching.md | PENDING |
| user-context.md（合成） | PENDING |

## 正式判读

> 以下为脱敏结果模板。所有 Case 和轮次均须根据新执行填写；PENDING 不代表通过。

| Case / 轮次 | 期望 | 实际语义标签 | 判定 | 理由 | 重试 | 格式错误 |
|---|---|---|---|---|---|---|
| PMT-01～06、PMT-11 / 各轮 | 见固定 fixtures 判读表 | PENDING | PENDING | PENDING | PENDING | PENDING |
| PMT-12 关键样本两轮 | 固定语义谓词；允许措辞波动，不要求文本一致 | PENDING | PENDING | PENDING | PENDING | PENDING |
| EVT-19 / 1 | PARTIAL 不虚构结果，未知发生时间为 null | PENDING | PENDING | PENDING | PENDING | PENDING |
| EVT-20 / 1 | 同 Entity+Subject+Scope 不因监管机构强拆 | PENDING | PENDING | PENDING | PENDING | PENDING |
| KNO-07 / 1 | PARTIAL 不虚构，可返回 valuable=false | PENDING | PENDING | PENDING | PENDING | PENDING |
| KNO-09 / 1 | 跨领域深度可有价值 | PENDING | PENDING | PENDING | PENDING | PENDING |
| KNO-10a/b / 各1 | 入门与机制复盘体现认知增量差异 | PENDING | PENDING | PENDING | PENDING | PENDING |

### 程序与存储侧不变量

| 检查 | 结果 |
|---|---|
| P-03 非法 Event/Update 候选引用由真实 typed parser 拒绝 | PENDING |
| P-02 `search_terms` 不进入 `event_entity_aliases` | PENDING |
| P-03 无程序二次语义审核；typed aliases 按 Content 证据直接存储 | PENDING |
| PMT-06b 核心 Go 内容仅偶然出现 school；T-EDU description 明确课后服务，预期不匹配 | PENDING |

## 汇总与波动

- 调用次数：PENDING
- PASS / FAIL / ERROR：PENDING
- 重试与格式错误：PENDING
- 两轮语义波动及不可控因素：PENDING
- 最终结论：**PENDING；不得以离线 self-test 或本模板签发真实模型 PASS。**
