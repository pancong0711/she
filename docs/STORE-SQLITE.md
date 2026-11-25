# SQLite 持久化存储

> 日期：2026-11-25
> 状态：T1.5 已实现
> 代码：
> - `packages/store-sqlite/src/schema.ts`
> - `packages/store-sqlite/src/sqlite-store.ts`
> - `packages/store-sqlite/tests/sqlite-store.spec.ts`

## 1. 定位

`@she/store-sqlite` 是 SHE core repository/event-store 端口的首个持久化实现，默认使用 Node 内置 `node:sqlite`，不引入第三方 ORM。

```text
control/core
   │ ports
   ▼
@she/store-sqlite
   ├─ TopicRepository
   ├─ TaskRepository
   ├─ ArtifactRepository
   ├─ LeaseRepository
   └─ EventStore
```

control/core 不 import SQLite driver；组合根（未来 `she-control-plane` app）负责打开 store 并注入。

## 2. 打开与迁移

```ts
import { SqliteStore } from '@she/store-sqlite'

const store = SqliteStore.open('/path/to/she.db')
const service = new TaskService({
  clock,
  ids,
  topics: store.topics,
  tasks: store.tasks,
  artifacts: store.artifacts,
  events: store.events,
})
const queue = new TopicQueue({
  clock,
  ids,
  topics: store.topics,
  tasks: store.tasks,
  artifacts: store.artifacts,
  events: store.events,
  leases: store.leases,
})

// 关闭前等待当前任务/控制面停止
store.close()
```

迁移行为：

- 打开时自动执行 `schema_migrations`；
- 迁移幂等；
- 每个迁移在 `BEGIN IMMEDIATE` 事务中执行；
- 失败 rollback 并抛错；
- `schemaVersion()` 可用于 `she doctor` / 健康检查输出。

当前 schema version：`2`。

v2 新增 `task_requests`，作为短生命周期原文 spool；任务 terminal 后由 `TaskRunner` 删除。

## 3. 表结构

| 表 | 用途 |
|---|---|
| `topics` | conversation/workspace/topic 状态与 active task 指针 |
| `tasks` | task 状态、请求 hash/摘要、附件、agent session、错误 |
| `artifacts` | report/output/diff 等产物引用 |
| `leases` | 每 task 唯一租约、owner、expiry |
| `events` | 持久化事件、全局 sequence、cursor、幂等 event_id |
| `task_requests` | 任务原文短生命周期 spool（不进入 Task 表） |
| `schema_migrations` | 迁移版本 |

重要约束：

- `tasks(topic_id, seq)` 唯一；
- `tasks(idempotency_key)` 部分唯一索引；
- `leases(task_id)` 唯一，确保一个任务最多一个 lease；
- `events(event_id)` 唯一，重复 append 不重复落库；
- `events(sequence)` 单调递增，cursor 为 `evt:<sequence>`；
- `task_requests(task_id)` 主键唯一。

## 4. 请求原文与隐私

Task 表不保存用户请求全文，只保存：

- `request_hash`：原文 SHA-256；
- `request_excerpt`：最多 20 个码点；
- attachments 元数据 JSON。

原始任务文本应进入受控 spool/artifact，执行完成后按策略清理，不能默认落在 SQLite 明文里。

## 5. 重启恢复测试覆盖

当前测试验证：

- 首次打开自动迁移；
- 重复打开迁移幂等；
- topic/task/idempotencyKey 跨进程重启可见；
- events 顺序和 cursor 跨重启一致；
- lease 跨重启持久化；
- 重启后过期 lease 可恢复为 `needs_attention`；
- artifact 引用可持久化。

## 6. 备份、WAL 与运维

打开文件数据库时启用：

```text
PRAGMA foreign_keys = ON
PRAGMA busy_timeout = 5000
PRAGMA journal_mode = WAL
```

建议：

- 备份 SQLite 主库时使用官方 backup API 或 `VACUUM INTO`，不要直接 copy 正在写入的 WAL 数据库；
- 升级前先备份 `she.db`、`she.db-wal`、`she.db-shm` 或使用备份 API 生成单文件；
- 不把数据库放在网络文件系统上作为默认方案；
- 日志/审计与主库分开目录；
- 迁移失败必须 fail-closed，不自动重建空库。

未来 CLI 帮助草案：

```text
she store info          # 路径、schema version、journal mode、WAL 状态
she store check         # integrity_check + foreign_key_check
she store backup <out>  # 使用 SQLite backup/VACUUM INTO，生成一致性备份
she store migrate       # 显式迁移；默认启动时自动执行
```

## 7. 多进程与并发边界

当前 `SqliteStore` 使用 Node `DatabaseSync` 单连接，适合：

- 单 control-plane daemon；
- 单进程中的 worker/queue；
- 测试与本地桌面模式。

多进程写同一数据库需要后续专项设计：

- 每进程独立连接与 busy/retry；
- claim 需在 `BEGIN IMMEDIATE` 中完成 topic active 检查 + task 更新 + lease 插入；
- 跨进程崩溃恢复；
- WAL checkpoint、备份与锁超时；
- 多 control-plane 实例的心跳与 leader election。

在这些完成前，不应把同一 DB 挂给多个 control-plane 实例写。

## 8. 后续任务

- T1.6：fake agent adapter 端到端任务闭环；
- T2.x：OpenCode adapter；
- 将 SQLite store 注入 control-plane app 与 PWA API；
- 增加 `she store info/check/backup` CLI 与 doctor 输出。
