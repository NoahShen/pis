# D16 · RSS 阅读器与公开平台人工验收

- 状态：**BLOCKED · EXTERNAL_ACCEPTANCE_PENDING**
- 接续：`docs/milestones/D13/pages-acceptance.md`
- 自动工具：`node scripts/pages-acceptance.mjs --self-test`
- 已有 D13 真实公开检查：**automatic_only PASS**，不代表 RSS-15/16 人工验收通过。
- D16 E2E-12 仅证明服务端静态文件与归档，不证明阅读器行为。

## 已迁移的自动/真实发布事实

D13 已审核记录提供：两 Feed 四份 head/pending XML 匿名 200 且 origin/local hash 一致；公开 tree 仅四 XML 和 `.nojekyll`；生产通知新增后约 48.5 秒公开可见；一次真实启动校准约 15.9 秒；目录迁移后旧根 URL 404。公开目录、完整 URL、正文和 secret 不在此复制。

sealed archive 当时不存在；真实超 200 历史、sealed 跨发布 bytes、完整迁移保留边界、non-fast-forward/真实故障重试仍未完成。不得把 E2E-12 或本地 Pages smoke 迁移成这些真实平台 PASS。

## RSS-15/16 人工执行清单

在获授权的真实客户端、真实公开目录和网络路径执行。记录阅读器名、版本、操作系统、日期、观察计数与限制；不记录完整订阅 URL、文章正文、Token、私有 User Context 或私钥。

| 项目 | 当前状态 | 执行/证据要求 |
|---|---|---|
| 两 Feed 首次订阅 | PENDING | 分别新增订阅，确认可发现当前条目并记录客户端/版本/日期 |
| 已缓存内容离线可读 | PENDING | 在线加载后断网重启客户端，观察缓存可读范围及错误 |
| 新增超过 200 条后的历史与归档跟随 | BLOCKED | 准备真实、获授权的 >200 历史；核对 head/pending/sealed、最早条目补读和 GUID 去重；不支持自动归档时记录客户端限制，不宣称数据丢失 |
| 中国大陆网络匿名 HTTPS 与客户端订阅 | BLOCKED | 在真实大陆网络路径分别匿名读取和客户端订阅，记录时间/结果/限制 |
| HTTPS、XML 与云端错误响应人工核对 | PENDING | 记录 TLS/HTTP 状态、缺失资源响应，不复制正文或完整 URL |
| 公开仓库树/历史/日志无 API Token、SQLite、Prompt、User Context、私钥 | PENDING | 检查公开 tree 和历史对象；只报告对象类型/计数与脱敏结果 |

## 退出判定

RSS-15/16 为 P1 外部验收项。缺项保持 PENDING/BLOCKED，真实用户设备和网络证据由获授权人员提供并经审核后才能更新。当前交付不得写 `V1_FINAL_PASS`；若其他 D16 Gate 均完成，只能使用 `D16_COMPLETE_WITH_EXTERNAL_ACCEPTANCE_BLOCKED`，并由负责人决定是否接受这些 P1 遗留。
