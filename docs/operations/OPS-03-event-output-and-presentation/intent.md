# OPS-03 Intent：Event 输出契约与发布可读性

- 类型：线上运行修复与展示修正（非 D 系列版本功能演进）
- 状态：APPROVED · G1（负责人批准 Intent/Spec/Plan 后直接开发）
- 来源：OPS-02 真实 `group/pis` 流式复验中 Event Search/Analysis 连续代码围栏；负责人提出标签与 Findings 可读性要求。
- 基线：main `cbad85b559a82f8398a2caa254f807d875fc424c`

## 目标

1. 使用**生产真实 Event Search/Analysis Prompt** 与 `group/pis` 复现代码围栏/格式问题，不能仅以 OPS-02 的极简验收指令推断生产 Prompt 也有同样问题。
2. 在证据支持时做最小 Prompt 输出契约修订，保证 Event 事实语义、归并、引用校验和跨语言要求不变；不通过剥离围栏或放宽 Zod 解决。
3. 验证模型/路由兼容性，必要时给出明确的生产配置建议，不擅自更换供应商或启用未验证的 response_format。
4. 改善新发布内容的 HTML 可读性：核心实体、主题、范围、发生时间、所属主线、分类、摘要、价值等标签加粗；Findings 标题与详细描述在 HTML 结构上有明确区分。
5. 自主真实模型复验和全量 Gate 后交负责人审核，生产 6 Source 部署复验由负责人另行执行。

## 固定边界

- 生产 JSON 仍必须是一个完整 JSON 文档，禁止 Markdown/代码围栏/解释文字；非法输出继续按 OPS-01/02 分类并受重试预算约束。
- 不修改 Event/Update ID、Entity/Subject/Scope 语义、Event 归并、confirmed_aliases、数据库 schema、API DTO、Runtime 六阶段或流式协议。
- 不读取真实 Source 正文或真实 User Context；测试只用合成内容，原始响应仅私有 600 文件。
- 不修改历史 Published Item 的不可变字段。模板变化仅影响新发布和由既有快照进行的合法 RSS 投影重建，不重写 sealed 历史。
- 所有文本仍 HTML 转义，禁止模型/正文注入 HTML、脚本或样式；不引入前端/CSS 框架或新依赖。

## 验收

- 对照极简验收指令与生产 Prompt，明确代码围栏发生的配置层；修订前后有真实调用证据，不把 Stub 当真实模型。
- 生产 Prompt 连续调用达到明确的 JSON 输出要求，非法 Event/Topic ID 仍拒绝，数字/时间/否定/归因/证据强度不改变。
- Event/Update/Knowledge 模板断言标签 `<strong>`，Findings 标题 `<strong>` 与描述独立 `<p>`，RSS XML 可读且无危险 HTML。
- 全量 verify、干净快照和精确 SHA Linux CI Success；真实复验遗留明确记录，不伪报完成。
