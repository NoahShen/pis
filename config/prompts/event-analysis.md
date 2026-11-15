# Event Analysis (P-03)

## 任务

分析当前 Content 中具有事实依据的事件信息，结合候选 Event 及各自最近的历史进展：
1. 判断属于哪条 Event 信息主线；
2. 判断是否存在实质性新增事实；
3. 必要时新建 Event；
4. 确认本次 Content 能够证实的核心 Entity 别名。

一个 Content 可以涉及多个独立 Event；分别返回判断。只能使用本次提供的数据，不调用外部工具。

## 一、Event 身份

Event 是围绕一个核心 Entity、特定 Subject 和 Scope，能够持续追踪的**信息主线**，而不是一篇新闻、一次公告或必然唯一的单个案件。

判断归属综合考虑：
- `Entity`：谁或什么是核心对象；
- `Subject`：持续追踪的事项主题；
- `Scope`：已有 Event 的业务覆盖范围；
- `History`：描述和提供的近期 Update 是否支持归属。

不能仅因为两个事项提到同一公司就合并；也不能只因为出现新的监管机构、案件或产品版本就强制新建 Event。如果符合已有 Scope，应延续信息主线。

## 二、NEW_EVENT

当当前 Content 提供可识别事件事实，且不能合理归属于任何候选 Event 时，返回 `NEW_EVENT`。

提供：
- `title`：可持续追踪、可读的信息主线标题；
- `entity.name`：核心实体规范名称；
- `subject`：稳定事项主题；
- `scope`：信息主线的覆盖边界；
- `description`：本文支持的初始事实；
- `occurred_at`：能确定则返回时间，否则 `null`；
- `confirmed_aliases`：当前 Content 明确确认的核心实体别名数组。

**不输出新 Event ID**（业务程序生成）。初始事实已经存入 Event，不另建“首条 Update”。

## 三、NEW_UPDATE

当事实能够归属于已有候选 Event，且相对提供的已知历史有**实质性信息增量**时，返回 `NEW_UPDATE`。

实质增量包括：新的客观行动、阶段结果、明确的新披露数据、决定、事实修正，以及提供了新信息或新证据的矛盾声明。

注意：
- 新报道或较晚发布时间，不自动意味着新进展。
- 换一种表述、转载、旧事实回顾或泛泛评论不是新进展。
- 同一主线进入新阶段，通常建立 Update，不重新创建 Event。
- 对有争议或单方表述的内容，保留“某方声明/报道指出”的归属，不将其写成已证实事实。

提供本次合法候选 `event_id`、`title`、突出本次新增事实的 `description`、可确定的 `occurred_at`（否则 `null`）、`confirmed_aliases`。不得生成 Event / Update ID。

## 四、NO_INCREMENT

**只有当前 Content 中的事件事实能够明确归属于一个已有候选 Event，且相对该 Event 的已知历史没有实质新增信息，才能返回 `NO_INCREMENT`。**

此时：
- `event_id` **必须**引用本次输入的合法候选 Event ID。
- `event_update_id` 能明确关联到本次提供且属于该 Event 的已有 Update 时填写；否则为 `null`，不得猜测。
- `confirmed_aliases` 可以包含本次 Content 新确认的核心实体别名；可以为空。

`NO_INCREMENT` 仅用于补充已有 Event/Update 的来源证据和合法别名，不新建进展，也不触发新的 Topic Matching。

如果 Content **没有可识别的事件事实**，返回 `results=[]`，不要为了返回 `NO_INCREMENT` 强行引用某个 Event。
如果候选召回不足，不能捏造历史 Event ID；对确实无法归属候选的信息主线按 `NEW_EVENT` 条件判断。

## 五、矛盾、修正和声明

- 新的事实修正、新披露证据、有实质内容的矛盾声明 → 归属已有主线时用 `NEW_UPDATE`。
- 只重复已存在的争议、没有新增资料 → `NO_INCREMENT`。
- 与旧报道矛盾并非创建独立 Event 的理由。
- 区分客观事实、机构或个人声明、媒体报道主张及预测；保持来源表达的真实性和不确定性。

## 六、confirmed_aliases

对于 `NEW_EVENT`、`NEW_UPDATE`、`NO_INCREMENT` 都可以输出 `confirmed_aliases: string[]`。
仅在**当前 Content 明确支持**不同名称指向同一个**核心 Entity** 时返回，例如确切的中外文名称、官方简称或明确同指的项目名称。不确定时返回空数组。

不得将以下当作别名：公司与产品、母子公司、商业伙伴、不同产品版本、同一事项的不同参与方。
此处由模型直接完成语义确认，**不提供 `alias_candidates`、`source_excerpt` 或二次确认建议**。程序只做结构与去重校验，保存时关联证据 Content。

## 七、多 Event 与结果互斥

- 不同事项可分别返回多项结果。
- 同一 Event 既有历史回顾又有新事实时，合并为一项 `NEW_UPDATE`。
- 同一 Content 对同一 Event 通常只创建一次 Update。
- 不能同时针对同一 Event 返回相互矛盾的 Action，例如 `NEW_UPDATE` 与 `NO_INCREMENT`。
- 不需要为正文提到的每个旧 Update 逐一创建证据关联。
- 没有任何可识别事件事实时 `results=[]`。

## 八、事实和时间约束

- 只依据当前 Content、P-02 检索线索、候选 Event 及提供的最近 Update。
- 候选 Event 很旧并不是排除归属的理由。
- `PARTIAL` Content 不得补全未提供的结论。
- 不能确定 `occurred_at` 时返回 `null`；不要把报道发布时间冒充事实发生时间。
- 不能生成或编造数据库 ID、来源 URL 或新事实。

## 输出要求

严格依照程序传入的结构化 Schema 返回 `results[]`。
每项 `action` 仅允许 `NEW_EVENT`、`NEW_UPDATE`、`NO_INCREMENT`，使用对应分支字段，不添加评分、置信度、额外解释。
