# D16 · P0 覆盖矩阵

- 范围：**169 项 = 155 个模块 P0 + E2E-01～14**。
- 判定基线：固定 Node/npm 下可重跑的当前测试、smoke，及已审核里程碑 G4/真实证据；不以测试函数数量替代 Case 覆盖。
- 本矩阵中的 `PASS` 指对应确定性 Case 证据通过；真实模型 S0/S1 与 RSS-15/16 P1 另列，不计入本表。
- 统一复验：`npm run verify`；E2E 另可运行 `npm test -- tests/e2e`。D13 外部缺项见 `reader-acceptance.md`。

| # | Case ID | 状态 | 测试/证据路径 | 备注 |
| ---: | --- | --- | --- | --- |
| 1 | CFG-01 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 配置 API、持久化与后续任务边界 |
| 2 | CFG-02 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 配置 API、持久化与后续任务边界 |
| 3 | CFG-03 | PASS | `tests/scheduler/cron-scheduler.test.ts; tests/scheduler/cron-scheduler-sqlite.test.ts` | 禁用 Source 不采集/不推进 |
| 4 | CFG-04 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 配置 API、持久化与后续任务边界 |
| 5 | CFG-05 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 配置 API、持久化与后续任务边界 |
| 6 | CFG-06 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 配置 API、持久化与后续任务边界 |
| 7 | COL-01 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 8 | COL-02 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 9 | COL-03 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 10 | COL-04 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 11 | COL-05 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 12 | COL-06 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 13 | COL-07 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 14 | COL-08 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 15 | COL-09 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 16 | COL-10 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 17 | COL-11 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 18 | COL-12 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 19 | COL-16 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 20 | COL-17 | PASS | `tests/collection/collector-acquisition.test.ts; tests/collection/source-item-identity.test.ts` | 真实临时 SQLite 与 Adapter/Collection 确定性断言 |
| 21 | PRO-01 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 22 | PRO-02 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 23 | PRO-03 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 24 | PRO-04 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 25 | PRO-05 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 26 | PRO-06 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 27 | PRO-07 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 28 | PRO-08 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 29 | PRO-09 | PASS | `tests/processing/content-router.test.ts; tests/processing/processing-integration.test.ts` | Processing 不执行 Collection fetchContent |
| 30 | PRO-10 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 31 | PRO-12 | PASS | `tests/processing/processing-integration.test.ts` | Content-first、路由、事务与重试断言 |
| 32 | EVT-01 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 33 | EVT-02 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 34 | EVT-03 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 35 | EVT-04 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 36 | EVT-05 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 37 | EVT-06 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 38 | EVT-07 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 39 | EVT-08 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 40 | EVT-09 | PASS | `tests/event-analysis/event-decision-persistence.test.ts (correction update)` | 修正声明走 NEW_UPDATE；旧事实不被替换 |
| 41 | EVT-10 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 42 | EVT-11 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 43 | EVT-12 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 44 | EVT-13 | PASS | `tests/event-analysis/event-decision-persistence.test.ts; tests/event-analysis/event-analysis-integration.test.ts` | NO_INCREMENT confirmed alias/证据/FTS，无下游 |
| 45 | EVT-14 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 46 | EVT-15 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 47 | EVT-16 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 48 | EVT-17 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 49 | EVT-18 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 50 | EVT-21 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 51 | EVT-22 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 52 | EVT-23 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 53 | EVT-24 | PASS | `tests/event-analysis/event-analysis-integration.test.ts` | Event Search/Analysis 集成与持久化断言 |
| 54 | KNO-01 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 55 | KNO-02 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 56 | KNO-03 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 57 | KNO-04 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 58 | KNO-05 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 59 | KNO-06 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 60 | KNO-08 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 61 | KNO-11 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 62 | KNO-12 | PASS | `tests/knowledge/knowledge-integration.test.ts` | Knowledge 固定 LLM 与 SQLite 断言 |
| 63 | TOP-01 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 64 | TOP-02 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 65 | TOP-03 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 66 | TOP-04 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 67 | TOP-05 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 68 | TOP-06 | PASS | `tests/topic-matching/topic-matching-service.test.ts` | 已有关联复用且不再调用 LLM |
| 69 | TOP-07 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 70 | TOP-08 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 71 | TOP-09 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 72 | TOP-10 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 73 | TOP-11 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 74 | TOP-12 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 75 | TOP-15 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 76 | TOP-16 | PASS | `tests/topic-matching/topic-matching-integration.test.ts` | Topic 快照、关联与下游断言 |
| 77 | PUB-01 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 78 | PUB-02 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 79 | PUB-03 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 80 | PUB-04 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 81 | PUB-05 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 82 | PUB-06 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 83 | PUB-07 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 84 | PUB-08 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 85 | PUB-09 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 86 | PUB-10 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 87 | PUB-12 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 88 | PUB-13 | PASS | `tests/publication/publication-integration.test.ts; tests/publication/publication-persistence.test.ts` | 发布资格、唯一性与不可变快照 |
| 89 | RSS-01 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 90 | RSS-02 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 91 | RSS-03 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 92 | RSS-04 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 93 | RSS-05 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 94 | RSS-06 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 95 | RSS-07 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 96 | RSS-08 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 97 | RSS-09 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 98 | RSS-10 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 99 | RSS-11 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 100 | RSS-12 | PASS | `scripts/rss-smoke.mjs; tests/rss/static-boundary.test.ts` | 静态 HTTP 正确/错误路径与无 Feed Token |
| 101 | RSS-13 | PASS | `tests/rss/static-boundary.test.ts; tests/auth.test.ts` | 静态路径与 API Bearer 权限独立 |
| 102 | RSS-17 | PASS | `tests/rss/sync-service.test.ts; tests/rss/xml-renderer.test.ts` | 静态 Feed/归档可重跑测试 |
| 103 | RSS-18 | PASS | `tests/rss/local-sync.test.ts; tests/rss/sync-service.test.ts` | 重复同步稳定、sealed 不改写 |
| 104 | RSS-19 | PASS | `tests/rss/publisher/notifier.test.ts; tests/rss/pages/pages-publisher.test.ts` | 同 Feed 串行/合并，最终版本不被旧结果覆盖；D13-T02 G4 |
| 105 | RSS-20 | PASS | `tests/rss/publisher/fake-publisher.test.ts; tests/rss/publisher/staging.test.ts` | 上传失败保留业务快照 |
| 106 | RSS-21 | PASS | `tests/rss/publisher/startup-calibration.test.ts; tests/rss/sync-service.test.ts; tests/application/production-assembly.test.ts` | 确定性启动校准/补齐，不新增业务资产；真实 non-FF 重试仍单列于 D13 |
| 107 | RSS-22 | PASS | `tests/rss/publisher/staging.test.ts; tests/rss/publisher/fake-publisher.test.ts` | 先归档后 head，失败保护 |
| 108 | RSS-23 | PASS | `tests/rss/local-sync.test.ts; tests/rss/pages/pages-publisher.test.ts; scripts/pages-smoke.mjs` | 确定性同目录重建、non-FF、目录迁移和 sealed 不变；真实 sealed 平台迁移未执行，不外推 |
| 109 | RSS-24 | PASS | `tests/rss/local-artifact-store.test.ts; tests/rss/sync-service.test.ts` | 同名 sealed 漂移拒绝 |
| 110 | API-01 | PASS | `tests/configuration/source-api.test.ts` | Source CRUD/检查点不可 PATCH |
| 111 | API-02 | PASS | `tests/configuration/topic-api.test.ts` | Topic CRUD/不回放 |
| 112 | API-03 | PASS | `tests/retrieval/routes.integration.test.ts; tests/retrieval/production.integration.test.ts` | 真实 SQLite/HTTP 查询与来源追溯 |
| 113 | API-04 | PASS | `tests/retrieval/routes.integration.test.ts; tests/retrieval/production.integration.test.ts` | 真实 SQLite/HTTP 查询与来源追溯 |
| 114 | API-05 | PASS | `tests/retrieval/routes.integration.test.ts; tests/retrieval/production.integration.test.ts` | 真实 SQLite/HTTP 查询与来源追溯 |
| 115 | API-06 | PASS | `tests/retrieval/routes.integration.test.ts; tests/retrieval/production.integration.test.ts` | 真实 SQLite/HTTP 查询与来源追溯 |
| 116 | API-07 | PASS | `tests/retrieval/pagination.test.ts; tests/retrieval/routes-pagination.test.ts` | 默认 50、最大 200、稳定 keyset 与连续新增不漏不重 |
| 117 | API-08 | PASS | `tests/retrieval/routes.test.ts; tests/retrieval/security.test.ts` | 404/400 与脱敏错误 |
| 118 | API-09 | PASS | `tests/retrieval/security.test.ts; tests/auth.test.ts` | Bearer 与静态 RSS 路径不可互换 |
| 119 | API-10 | PASS | `tests/retrieval/security.test.ts; tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 非法输入拒绝且无部分配置写入 |
| 120 | API-13 | PASS | `tests/configuration/source-api.test.ts; tests/configuration/topic-api.test.ts` | 未授权 POST/PATCH 在解析/写入前拒绝 |
| 121 | API-14 | PASS | `tests/retrieval/routes.integration.test.ts; tests/retrieval/knowledge-content-repository.test.ts` | 可空 Content/Source 链安全读取 |
| 122 | DB-01 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 123 | DB-02 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 124 | DB-03 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 125 | DB-04 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 126 | DB-05 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 127 | DB-06 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 128 | DB-07 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 129 | DB-08 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 130 | DB-09 | PASS | `tests/collection/collector-transaction.test.ts; tests/processing/content-persistence.test.ts; tests/event-analysis/event-analysis-integration.test.ts; tests/knowledge/knowledge-integration.test.ts; tests/topic-matching/topic-matching-persistence.test.ts; tests/publication/publication-transaction-recheck.test.ts` | 六阶段事务提交/回滚与派发边界 |
| 131 | DB-10 | PASS | `tests/database/time-storage.test.ts; tests/application/production-integration.test.ts` | 各阶段 ISO 时间语义 |
| 132 | DB-11 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 133 | DB-13 | PASS | `tests/publication/publication-persistence.test.ts; tests/publication/publication-integration.test.ts` | 业务层拒绝多态悬空 |
| 134 | DB-14 | PASS | `tests/database/schema-constraints.test.ts; tests/database/transaction.test.ts; tests/database/event-search.test.ts` | SQLite DDL、约束、事务与 FTS |
| 135 | RUN-01 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 136 | RUN-02 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 137 | RUN-03 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 138 | RUN-04 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 139 | RUN-05 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 140 | RUN-06 | PASS | `tests/runtime/task-dispatch.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | 已审核 D15-T03/T05；A 不重复、B 单独重试 |
| 141 | RUN-07 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 142 | RUN-08 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 143 | RUN-09 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 144 | RUN-10 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 145 | RUN-11 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 146 | RUN-12 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 147 | RUN-15 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 148 | RUN-16 | PASS | `tests/runtime/runtime-integration.test.ts; tests/runtime/runtime-retry-dispatch.test.ts` | Runtime 派发、重试与关闭 |
| 149 | PMT-07 | PASS | `tests/prompt/prompt-repository.test.ts; tests/llm/response-validators.test.ts; tests/llm/llm-calls.test.ts` | Prompt/Schema/严格 typed call |
| 150 | PMT-08 | PASS | `tests/prompt/prompt-repository.test.ts` | 每次 load 重新读盘 |
| 151 | PMT-09 | PASS | `tests/prompt/prompt-repository.test.ts; tests/llm/response-validators.test.ts; tests/llm/llm-calls.test.ts` | Prompt/Schema/严格 typed call |
| 152 | PMT-10 | PASS | `tests/prompt/prompt-repository.test.ts; tests/llm/response-validators.test.ts; tests/llm/llm-calls.test.ts` | Prompt/Schema/严格 typed call |
| 153 | PMT-13 | PASS | `tests/llm/llm-calls.test.ts; tests/prompt/prompt-repository.test.ts` | 已审核 D02；重试再次读最新 Prompt |
| 154 | PMT-14 | PASS | `tests/prompt/prompt-repository.test.ts; tests/llm/response-validators.test.ts; tests/llm/llm-calls.test.ts` | Prompt/Schema/严格 typed call |
| 155 | PMT-15 | PASS | `tests/prompt/prompt-repository.test.ts; tests/llm/response-validators.test.ts; tests/llm/llm-calls.test.ts` | Prompt/Schema/严格 typed call |
| 156 | E2E-01 | PASS | `tests/e2e/event-pipeline.test.ts` | NEW_EVENT 主链 |
| 157 | E2E-02 | PASS | `tests/e2e/event-pipeline.test.ts` | NEW_UPDATE 与旧 Item 不变 |
| 158 | E2E-03 | PASS | `tests/e2e/event-pipeline.test.ts` | NO_INCREMENT 新证据 |
| 159 | E2E-04 | PASS | `tests/e2e/knowledge-pipeline.test.ts` | Knowledge/Curated 主链 |
| 160 | E2E-05 | PASS | `tests/e2e/knowledge-pipeline.test.ts` | valuable=false |
| 161 | E2E-06 | PASS | `tests/e2e/cross-path-history.test.ts` | 双路双 Feed |
| 162 | E2E-07 | PASS | `tests/e2e/knowledge-pipeline.test.ts` | 无匹配不发布 |
| 163 | E2E-08 | PASS | `tests/e2e/event-pipeline.test.ts` | 后建 Topic 不回补 |
| 164 | E2E-09 | PASS | `tests/e2e/cross-path-history.test.ts` | 多 Topic 单 GUID |
| 165 | E2E-10 | PASS | `tests/e2e/event-pipeline.test.ts` | 新别名无新 Item |
| 166 | E2E-11 | PASS | `tests/e2e/knowledge-pipeline.test.ts` | PARTIAL 与一次重试 |
| 167 | E2E-12 | PASS | `tests/e2e/cross-path-history.test.ts` | 双 Feed 401 条服务端归档 |
| 168 | E2E-13 | PASS | `tests/e2e/cross-path-history.test.ts` | 同 GUID/新 GUID |
| 169 | E2E-14 | PASS | `tests/e2e/event-pipeline.test.ts` | 同 Scope 不同监管机构 |

## 结论与边界

169 项均有上述确定性测试或已审核证据映射。当前 Worker 最终复验结果见交付摘要；最终 `D16_FINAL_PASS` 仍需 Architect 在合并后的精确 SHA 上复核并完成 Linux CI，本文件不预先签发。

RSS-15/16 的真实阅读器、离线缓存、真实超 200 历史和中国大陆网络仍 PENDING/BLOCKED；E2E-12 是 `server_side_archive_only`，不替代客户端验收。
