# D13 Intent — GitHub Pages 云端 RSS 发布

- 状态：APPROVED（负责人指定 GitHub Pages 与 `git@github.com:NoahShen/pis_publish.git`）
- 前置：D11/D11A/D12 完成并推送。

## 目标

把 D12 的本地静态 RSS 文件集可靠发布到 GitHub Pages。应用启动校准完整 Published Item 历史，新发布成功后通知对应 Feed；上传失败不删除数据库，可通过重试和下次启动恢复。

## 固定决策

- 平台：GitHub Pages；发布仓库：`git@github.com:NoahShen/pis_publish.git`。
- 目标空仓库已确认；分支 `main`，站点根目录部署。
- Git 推送凭据由运行环境的 SSH agent/key 提供；PIS 不保存或记录私钥。
- 公共订阅 URL 由仓库 Pages origin 加固定文件名构成；随机路径不是访问控制。

## 范围

1. Publisher/staging/原子版本意图与冲突保护。
2. 同 Feed 串行、通知合并、启动全量校准与失败重试。
3. GitHub Git/Pages 适配器、生产装配和配置。
4. 实际匿名 XML、完整链、更新延迟、失败重试与阅读器人工验收。

## 非目标

不实现 Gitee、动态 Feed API、访问鉴权、数据库/secret 上云、新 Runtime 任务、云端可编辑正文或自动改写归档。D14/D16 不提前验收。

## 验收

真实仓库的 Pages URL 可匿名读取两类 head/pending/sealed（存在时），内容和本地完全一致；head 与归档在同一版本公开；故障和 stale remote 可恢复；全量 Gate 和真实阅读路径证据完成。
