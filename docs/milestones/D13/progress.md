# D13 Progress

- 状态：G3_APPROVED · DEVELOPMENT
- Intent/Spec：负责人平台与公开目录决策；Architect 批准
- Plan：v1.1 G3_APPROVED
- 当前 Lead：`2fd93eaf-5c32-4bb5-9273-5dc5869014d2` / `wks_76ff42b149f8bcf1`
- 当前 Worker：NONE（T04-R1 已归档）
- 开发心跳：`bb3265d4`（active，10 分钟，只提醒主 Architect）
- 基线：D12 main 最终文档提交之后
- Candidate/Merge/Push：T01 `42166bc06cd70c206c4759c032229d336894a34d` / `6daac83bca9401d4c939b5c00298b37f075483e9`；T02 `77ea005bd0d21d8066698b381a978e80249a0e11` / `e8846b956df6fa56b23a2cd96a3401b081d665da`；T04 `9806210b0b070cae70de05393c222662cd931416` / `17ec16271786a4414fe80958c56e6b11e808d287`；T04-R1 `18d4f69352f76be68c429260cd638d67ba907819` / `840a5e7e9f79f5e79bb5f4e6b0ffc1146b7a12a2`；尚未 push

| Task | State | 验收 |
|---|---|---|
| D13-T01 Publisher 版本接口/Fake | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | G4 APPROVED；tree `cd3c66ff3906ae0fe8270ce723380303c6dd7087`；定向 2/36；full 123/1344 |
| D13-T02 通知合并/启动校准 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | G4 APPROVED；tree `634da1ca6f222c141121c79ba0040deae0d1a8e5`；定向 2/7；full 125/1351 |
| D13-T03 GitHub Pages 平台验收 | READY | 随机目录下双 Feed 匿名 200/bytes/XML 已验证；验收脚本、失败恢复及阅读器证据待完成 |
| D13-T04 适配器/生产装配/操作文档 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | G4 APPROVED；tree `07406aadccd6a4787de2e6ddf391a33697646229`；定向 2/11；full 127/1362 |
| D13-T04-R1 可配置公开目录/迁移 | `PASS · LOCAL_MERGE_VERIFIED · ARCHIVED` | G4 APPROVED；tree `3458711972fcb1fc811046ecea7eee66a463446a`；定向 2/15；full 127/1366 |

执行顺序 T01 → T02 → T04 → T04-R1 → T03。T03 以本 T04-R1 closeout 提交为 base，只编写验收脚本和证据，不修改生产代码。

T01 前两次 Codex Worker 空转已中止归档，无文件；Pi Worker 完成实际交付。负责人随后批准可配置随机公开目录，原 T03 暂停；T04-R1 与 T03 重验须按修订 Spec/Plan 执行，既有根目录匿名通过只作为迁移前证据。

T04 frozen patch SHA-256：`87418ffd16b249596794bcb74fbbb8448377aed370b7ff31dd4f03eefec205b9`；merge 后 full `127 files / 1362 tests`，build、全部 smoke、330 文件格式检查通过。真实发布仓库 `main` 为 `85ac6dc8f66d8cfa74963da7cea7d62d5ef02fcf`，tree 仅含四个 XML 与 `.nojekyll`。Pages 启用前双 Feed 均按预期 timeout；启用后正式 Publisher 双 Feed verified，约 9.5s/7.7s，匿名 head/pending 均 HTTP 200、XML 合法、bytes 一致，Event 9 条、Curated 6 条，当前无 sealed archive；源数据库 hash 未变。

T04-R1 frozen patch SHA-256：`65890e3b542c67ec2608da96f648741f74787675e4989aac36dace18ae14676f`；merge 后 full `127 files / 1366 tests`，build、全部 smoke、330 文件格式检查通过。实际随机目录仅存本机私有配置，未进入 Git。真实发布仓库 `main` 为 `c1cc6e6576ec431be8fce471a8a3742ac3877397`；目录内四个 XML 匿名 HTTP 200、bytes/hash 与迁移前一致，旧根 Feed 为 404，Git tree 仅含目录内四个 XML 与 `.nojekyll`。GitHub 不直接公开隐藏文件，因此 `.nojekyll` 以 Git tree 存在性和零字节校验，不要求匿名 200。T03 尚未最终 PASS。
