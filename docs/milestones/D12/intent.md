# D12 Intent：本地静态 RSS 生成与归档

- 状态：`APPROVED · G1 · 按负责人“文档完成后直接开发”授权`
- 日期：2026-11-21
- 上游：既有 D12 任务定义、技术设计 §4、测试用例 `RSS-01`～`RSS-14`、`RSS-17/18/24`
- 依赖：D00～D11、D11A、D15；不依赖 D13 云端平台决策

## 1. 目标

把 SQLite 中不可变的 Published Item 快照转换为完整、可部署的本地静态 RSS 文件集：

- Event Updates 包含 EVENT 与 EVENT_UPDATE；Curated Content 只包含 KNOWLEDGE。
- RSS 2.0 + `content:encoded`，中文、HTML、XML 特殊字符、GUID、来源链接和 RFC 822 发布时间稳定。
- 每类主 Feed 保留最新 200 条；每满 200 条形成一个独立不可变归档；不足一批的未封存余量写入可重建的 pending XML，使用 RFC 5005 `fh:archive` / `atom:link rel="prev-archive"` 串联完整历史。
- 以归档中已有 GUID 集合恢复封存边界；新条目、迟到数据、相同发布时间和时钟回拨不得重写历史归档。
- 本地文件逐份完整生成、校验并原子替换；新归档先于引用它的主文件落盘。
- 同一数据库和文件快照重复生成结果稳定；静态读取不查询数据库、不调用 LLM。

## 2. 已批准设计取舍

1. 不增加 RSS 表、归档表、Outbox 或第七种 Runtime 任务；归档 GUID 集合从既有 XML 恢复。
2. 主 Feed 与最新归档允许 GUID 重叠；各归档互不重叠，主文件、pending 与全部归档按 GUID 去重后覆盖全部 Published Item。
3. 已封存归档同名同内容可复用；同名不同内容必须报告冲突，保留旧字节，并停止该 Feed 本次主文件更新。
4. D11 没有独立来源 URL 列。RSS `<link>` 只从不可变 `published_items.body` 的“来源”快照中提取第一条合法 HTTP(S) 链接；无链接时省略。不得查询后来新增的证据或重新渲染正文。
5. D12 原子性仅指**单个本地文件**临时写入、完整校验、关闭后 rename；不宣称多文件、Git、CDN 或云端原子可见性。
6. D12 交付独立生成器、归档规划器、本地/Fake Artifact Store 和文件集 smoke；生产自动通知、启动同步、Publisher 版本提交与云端重试由 D13 接线。
7. 为满足任意快照的完整历史覆盖，除固定 200 条主窗口与满 200 条不可变归档外，每类 Feed 生成一个 `*-pending.xml` 余量投影。pending 只含不足一批的未封存条目，可随新快照原子重建，不冒充封存归档；静态链为主 Feed → pending → 最新封存归档。

## 3. 范围

- 定义 D12 自己的 Feed、Item、Archive、Artifact 和错误契约，复用 D11 Published Item 只读接口。
- XML Renderer、主 Feed 窗口、完整归档批次、归档发现/解析、冲突检测与静态链接。
- 本地文件 Artifact Store：路径约束、UTF-8 bytes、only-if-absent、原子写入、读取/列举。
- 两类 Feed 的完整本地生成流程与确定性测试；201/400/401/451 条、多批交错、迟到数据与同名冲突。
- 使用 D11A 真实临时数据库做只读重建验收；不修改原测试库，不输出正文或秘密路径。

## 4. 非目标

- 不选择或接入 Gitee Raw / GitHub Pages，不实际上传，不实现 HTTP Feed GET 或 Feed Token。
- 不修改 11 张业务表、Published Item 内容、Topic Association、六阶段业务语义、Runtime 队列/重试。
- 不实现 D13 的多文件发布版本、串行/合并云同步、启动自动校准、上传重试或生产环境配置。
- 不实现 D14 查询 API、D16 模型语义评估；不保证阅读器自动支持 RFC 5005 历史补读。
- 不把随机路径当作真正访问控制，不把私有数据库、Prompt、User Context、Token 或环境变量复制到输出目录。

## 5. 验收原则

- `RSS-01`～`RSS-14`、`RSS-17/18/24` 的 D12 范围全部由确定性 P0/P1 自动化覆盖；`RSS-15/16` 云端/阅读器证据留给 D13。
- 归档 URI、GUID 集合和 bytes 在新增、迟到、回拨、重复同步后不变；冲突安全失败且主文件不引入坏链。
- 主文件、pending 与所有归档联合覆盖完整历史，类型不串档，排序稳定，XML 可由现有 `fast-xml-parser` 验证。
- 本地生成不访问网络/LLM，不写数据库，不触碰默认 `data/pis.sqlite`。
- D12 四卡均完成 G4、合并复验和归档；最终干净快照 Gate 与精确 SHA 远程 CI Success 后，交负责人验收，不自动开始 D13。
