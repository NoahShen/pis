# D13 Spec — GitHub Pages Publisher

## 1. 发布模型

D12 本地 Store 仍是完整文件集 planner/staging；D13 Publisher 在一个 Git commit/tree 中发布本次变化的公开资产。一次 sync：

1. 同 Feed 串行，先读取 DB snapshot，规划并校验本地完整文件集。
2. 先创建 sealed archive，再 pending，最后 head；新 sealed 在本地完成后才推进版本。
3. Publisher 获取远端受保护分支当前 commit，构造完整目标 tree，把所有 changed/new XML 和静态元数据放入一个 commit。
4. 非 fast-forward 不 force push，不覆盖远端更新；报告 conflict，可重试。
5. push 成功只表示 Git 版本接受；Pages deployment 成功且匿名 origin bytes 匹配才算公开完成。

不承诺跨多个 Feed 的事务；一次 Feed 的一个 commit 是其原子公开版本。HEAD/pending 不在不同 commits 分批公开。

## 2. 配置

新增可选配置，缺省不启用云发布，保持本地开发兼容：

- `RSS_PAGES_REPOSITORY`：启用后固定 Git SSH URL，禁止 credential/query/fragment。
- `RSS_PAGES_BRANCH`：默认 `main`，仅安全 ref 名。
- `RSS_PAGES_WORK_DIRECTORY`：默认 `data/rss-pages`，单独 Git worktree/clone。
- `RSS_PAGES_PUBLIC_ORIGIN`：绝对 HTTPS origin，无 credential/query/fragment/path；默认 `https://noahshen.github.io/pis_publish`。
- `RSS_PAGES_PUBLISH_TIMEOUT_MS`：默认 120000，范围 1000～600000。
- `RSS_PAGES_POLL_INTERVAL_MS`：默认 5000，范围 100～60000。

启用时 repository/origin 必须齐全。日志只记录固定公开配置和稳定 reason，不输出环境、私钥、命令 stdin 或正文。

## 3. 通知与启动

`RssPublicationNotifier.notify(feed)` 返回 Promise；同 Feed active+最多一个 dirty rerun，运行中通知合并；失败 reject 供 Publication 既有 best-effort 日志记录，下一条通知或启动可恢复。启动在 scheduler 前同步校准两类 Feed；失败使生产启动失败并清理资源，避免长期陈旧。

发布成功是持久化之后的 detached 通知，不回滚 Published Item；不新增第七种 Runtime 任务。

## 4. GitHub 适配器

通过受控 `git` 子进程使用系统 SSH，不引入 npm 依赖。工作目录独立于业务 DB，固定 env 禁止交互凭据提示；所有路径/分支参数分离，超时/退出有界。公开资产只允许固定 head/pending、严格 archive key 和 `.nojekyll`；不复制数据库、WAL、日志、配置、node_modules 或隐藏文件。

Pages 通过公开 origin 条件轮询/读取校验部署。可使用 GitHub public deployments API 获取状态；无需 token 的公开 endpoint 失败时可由 origin bytes 校验补足。HTTP 响应 bounded、redirect policy 明确、不读取 secret。

## 5. 安全与边界

- 远端已有非公开/未知文件不删除；迁移先审计空仓库，当前已确认空。
- 同名 archive 冲突继续由 D12 planner 拒绝；Git 远端冲突不覆盖。
- 本地 staging 原子性不是跨文件承诺；Git commit 是云端原子版本。
- GitHub Pages 公共 URL 无访问控制；禁止以随机路径保护秘密。
- D13 不重新调用 LLM、不修改业务正文/Prompt/schema。

## 6. Case 映射

T01/T02 覆盖 RSS-19～23 的确定性部分；T03 覆盖 RSS-15/16 人工网络/阅读路径；T04 覆盖实际上传、固定 URL、匿名 XML、完整归档、失败重试、迁移说明及 RSS-23。
