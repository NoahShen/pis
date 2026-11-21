# D13-T03 · GitHub Pages 验收记录与人工清单

## 结论与范围

**当前状态：BLOCKED（人工与恢复证据未齐）。** 自动检查通过也只代表该脚本覆盖的自动项通过，不代表 D13-T03 或 D13 五张任务卡最终 PASS。本脚本不能替代真实 RSS 阅读器或中国大陆网络人工验收。随机公开目录不构成访问控制。

不得将实际公开目录值、完整订阅 URL、XML 正文、query、凭据、Token、私钥或其他 secret 写入命令日志或本文。脚本只输出固定逻辑 key、安全计数、SHA-256 摘要和状态；失败原因不含完整来源 URL 或正文。

## 已有真实发布/迁移证据（由 Architect 提供）

以下仅记录已提供事实，不表示本 Worker 重新执行了真实网络或发布操作：

- 四个 XML（两类 Feed 的 head/pending）匿名 HTTP 200，且 bytes/hash 与本地一致。
- 发布远端 `main`：`c1cc6e6576ec431be8fce471a8a3742ac3877397`。
- 公开目录 tree 仅有 5 个允许对象：四份 XML 与目录内 `.nojekyll`。
- Event 9 条、Curated 6 条；当前无 sealed archive。
- 目录迁移后旧根 URL 404。

## 自动检查

在无需真实目录值的本地 fixture 环境验证：

```sh
node scripts/pages-acceptance.mjs --help
node scripts/pages-acceptance.mjs --self-test
```

真实匿名检查由获授权人员提供 origin（可含公开目录前缀，或以 `--directory` 提供固定示例前缀）：

```sh
node scripts/pages-acceptance.mjs --origin <origin>
```

匿名读取两 Feed 的 head/pending 和目录内 `.nojekyll`，以及从 `0001` 起连续的 sealed archive（404 表示链结束）。四份 XML 必须匿名 HTTP 200；`.nojekyll` 接受 200 或 404，200 时必须为零字节，404 时记录 `remote_git_tree_required`，其存在性必须通过 remote Git tree 的零字节对象验收，不能将匿名 404 判为发布失败。校验固定身份、XML 基本良构、head 最多 200、pending 0..199、每份 sealed 恰好 200、单文档 GUID 不重复、sealed 之间 GUID 不重复，以及 head→pending→sealed 连续关系。head/pending/sealed 的 GUID 按 D12 语义允许重叠。禁止重定向，HTTP 状态、响应大小和超时均有界；只使用现有 `fast-xml-parser`，无新增依赖。

自动检查通过**不能证明**远端同名 archive 永不被改写、Git 非 fast-forward 行为或跨时间的历史完整性；这些需要下述版本/恢复证据。

| 自动/线上证据 | 状态 | 安全证据栏（日期、检查人、固定 key、计数、hash；不得填 URL/正文/secret） |
| --- | --- | --- |
| 四 XML 匿名 HTTP 200、目录迁移旧根 404 | 已有上述证据 |  |
| 目录内 `.nojekyll` 为 remote Git tree 中零字节对象（匿名 200/404 均可） | 已有上述 tree 证据 |  |
| 当前公开 head/pending 链与 GUID 合并关系 | 已有上述匿名 XML/hash 证据 |  |
| sealed archive 存在后的内容、200 条批及完整历史链 | PENDING（当前无 sealed） |  |
| 发布后 poll/timeout 内 origin bytes 更新延迟 | PENDING（既有事实未覆盖） |  |
| stale remote / 缺失文件启动校准恢复、失败重试 | PENDING |  |
| sealed archive 跨发布 bytes/hash 不变、拒绝同名覆盖 | PENDING |  |
| 旧 PIS 根资产及根 `.nojekyll` 全部不公开；未知文件和另一 Feed 新目录资产保留 | PENDING（旧根 URL 404 事实不足以覆盖完整保留边界） |  |
| 公开目录再次变更后的匿名复验 | PENDING |  |

## 真实阅读器与网络人工清单（RSS-15/16）

| 项目 | 状态 | 可安全填写的证据栏（阅读器/系统版本、日期、观察结果；不得填正文或完整订阅 URL） |
| --- | --- | --- |
| 真实阅读器通过公开目录订阅 URL 首次订阅两类 Feed | PENDING |  |
| 已缓存内容离线可读，阅读器离线行为符合预期 | PENDING |  |
| 新增超过 200 条后 head/pending/sealed 展示与历史连续性 | PENDING |  |
| 中国大陆网络路径匿名 HTTPS 读取与阅读器订阅 | BLOCKED（尚无证据） |  |
| HTTPS、XML 及云端错误响应人工核对 | PENDING |  |
| 公开仓库文件树/历史与日志无 API Token、SQLite、Prompt、User Context、私钥泄漏 | PENDING |  |

## 出口

只有 Plan §6.3 的真实匿名 XML/完整链、更新延迟、失败重试、迁移保留边界、阅读器与中国大陆网络证据全部齐备并经过审核，才可由相应审核角色考虑最终 PASS。缺失证据保持 `PENDING`/`BLOCKED`，不得以本地 fixture、旧根目录或自动脚本结果替代。
