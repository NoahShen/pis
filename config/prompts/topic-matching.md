# Topic Matching (P-05)

## 任务

对**当前已经形成**的 `EVENT`、`EVENT_UPDATE` 或 `KNOWLEDGE`，根据本次输入中当前启用 Topic 的 `id/name/description`，返回所有实质相关的 Topic ID。允许同时匹配多个，也允许不匹配任何 Topic。

只判断关注范围归属；不重新分析内容价值、事件增量或重要程度。

## 一、Topic 含义

Topic 是用户主动配置的长期关注范围：
- `id`：唯一标识；
- `name`：主题名称；
- `description`：关注范围、重点与边界。

综合理解 `name` 与 `description`，**不能仅通过关键词包含判断**。Description 对宽泛名称尤其重要。

## 二、匹配准则

情报的核心事实、主题、技术、方法、研究对象或实际进展**实质属于**某 Topic 的关注范围时可以匹配。
- 允许同义表达、合理语义关联，不要求标题与 Topic 名字完全一致。
- 偶然提及名称、背景引用或过于间接的关联，不构成匹配。
- 不为提高召回而无限扩大 Topic Description 范围。
- 不凭模型猜测或正文外推断建立关联。
- 对边界无法确认的匹配保持审慎，不机械全部匹配。

## 三、EVENT

根据 Event 的 Title、Entity、Subject、Scope、Description 判断**整个信息主线**是否属于 Topic。
同一公司可能涉及多个 Subject；仅公司名称相同，不意味着事件属于该公司的某个狭义技术 Topic。

## 四、EVENT_UPDATE

以**本次 Update 的新增事实**为主要匹配对象，所属 Event 的基本 Entity、Subject、Scope 等仅用于理解背景。
- 不自动继承父 Event 既有 Topic Association。
- 不要求加载全部历史 Update。
- 如果本次进展确实属于某 Topic 的长期关注范围，则可匹配。

## 五、KNOWLEDGE

利用 Knowledge 的 Title、Summary、Category、Findings、Value 判断核心知识内容的主题。
- 不因 Category=`Method` 而匹配所有方法类 Topic。
- 不重新判断 `valuable` 或评估文章质量。
- 仅依据已形成的 Knowledge 内容判断。

## 六、多 Topic 与无匹配

独立判断每个输入 Topic。符合多个就返回全部 ID，不设置主 Topic、不排名、不互斥、不打分。
没有匹配时返回空 `matched_topic_ids`，这是正常结果。

## 七、边界与输出

- 只使用本次输入的情报对象、父 Event 基本背景（若有）与当前启用 Topic。
- 不使用 User Context，不查询历史 Content / Event / Knowledge，不创建新 Topic。
- 不继承旧关联、不补做历史匹配、不产生优先级或严重度判断。
- 只输出本次 Topic 集合中的合法 ID；不自造 ID，不输出重复 ID。

严格按程序提供的 JSON Schema 输出，唯一业务字段为 `matched_topic_ids: string[]`。不输出理由、评分、置信度或额外字段。
