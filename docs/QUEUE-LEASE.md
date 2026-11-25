# Topic 串行队列与任务租约

> 日期：2026-11-25
> 状态：T1.4 已实现
> 代码：
> - `packages/core/src/lease.ts`
> - `packages/core/src/ports.ts`
> - `packages/control/src/topic-queue.ts`
> - `packages/control/tests/topic-queue.spec.ts`

## 1. 为什么不直接并发派发任务

SHE 的 Topic 表示一条稳定工作上下文（一个 agent session、一个 workspace、一个串行任务队列）。同一个 Topic 内并发执行任务会造成：

- 同一工作区争抢写；
- agent session 上下文串扰；
- 报告/产物路径覆盖；
- 用户看到的执行顺序与实际完成顺序不一致。

因此 v1 规则是：

```text
同一 Topic 同时最多一个 active task
active = dispatching | submitted | running
```

不同 Topic 可以并行；同一 Topic 必须串行。

## 2. 任务与租约生命周期

```text
queued
  │ claimNext
  ▼
dispatching + lease
  │ worker 开始执行并 heartbeat
  ▼
submitted / running
  │
  ├─ succeeded / failed / interrupted / cancelled
  └─ lease 到期 → needs_attention
```

租约是一条带所有者和过期时间的授权：

```ts
interface TaskLease {
  id: string
  taskId: string
  topicId: string
  ownerId: string
  acquiredAt: number
  heartbeatAt: number
  expiresAt: number
  ttlMs: number
}
```

规则：

1. 一个 active task 只能有一个有效 lease；
2. 只有 lease owner 可以 heartbeat；
3. lease 过期后不能心跳续命，必须走恢复；
4. 恢复不会自动重新派发，而是把 task 标记为 `needs_attention`；
5. lease 过期任务可能已产生副作用，是否重试需要人工/策略决策；
6. 任务进入 terminal 状态后，Topic 的 `activeTaskId` 清空，可 claim 下一个任务。

## 3. `TopicQueue` API

```ts
const queue = new TopicQueue({
  clock,
  ids,
  topics,
  tasks,
  artifacts,
  events,
  leases,
}, { defaultLeaseTtlMs: 5 * 60_000 })

const claimed = await queue.claimNext({
  topicId: topic.id,
  ownerId: 'worker-a',
  leaseTtlMs: 120_000,
})

if (claimed !== undefined) {
  // claimed.task.status === 'dispatching'
  // claimed.lease 是后续 heartbeat 的凭据
}

const renewed = await queue.heartbeat(claimed.lease.id, 'worker-a')
const recovered = await queue.recoverExpiredLeases()
```

### `claimNext()`

返回 `undefined` 的情况：

- Topic 不存在；
- Topic 不是 `active`；
- 已有 `dispatching/submitted/running` 的任务；
- 队列为空；
- 下一个 queued task 已有未过期 lease。

同一进程内按 `topicId` 加内存互斥，避免重入 claim 竞态。

### `heartbeat()`

- 只接受 lease owner；
- 已过期 lease 返回 `lease_expired`；
- 成功后 `expiresAt = now + lease.ttlMs`。

### `releaseLease()`

任务完成或失败后，owner 释放 lease。非 owner 释放返回 `forbidden`；任务状态必须已由 TaskService 迁移到非 active。

### `recoverExpiredLeases()`

扫描过期 lease：

| 情况 | 行为 |
|---|---|
| task 仍 active | task → `needs_attention`，事件记录 `lease_expired` |
| task 已 terminal | 仅回收 lease |
| task 不存在 | 仅回收 lease，返回诊断记录 |

恢复后 Topic 的 activeTaskId 被清空，下一个 queued 任务可以 claim；但过期任务本身不会被静默重新执行。

## 4. 错误码

| code | 场景 |
|---|---|
| `invalid_request` | topicId/ownerId/ttl 非法 |
| `not_found` | heartbeat 的 lease 不存在 |
| `forbidden` | 非 lease owner 尝试 heartbeat |
| `lease_expired` | 已过期 lease 尝试 heartbeat |
| `invalid_transition` | TaskService 状态迁移非法 |
| `conflict` | 资源/幂等冲突 |

## 5. 事件

claim 时通过 `TaskService.transitionTask()` 写入：

```text
task.status_changed: queued -> dispatching
```

恢复时写入：

```text
task.status_changed: active -> needs_attention
reason: lease_expired
```

事件统一进入 EventStore，后续由 gateway、PWA、CLI 通过 cursor 消费。

## 6. 并发与持久化边界

当前实现：

- 单进程内按 Topic 串行；
- InMemory repository + InMemoryLeaseRepository；
- 测试覆盖并发 claim、重入、心跳、owner 校验、过期恢复、下一个任务 claim。

T1.5 SQLite 实现还需要补充：

- SQLite transaction 内的原子 claim；
- `UNIQUE(task_id)` 或等价约束确保一个 task 只有一个 lease；
- 多进程/重启后的 lease 持久化；
- 乐观并发版本或事务锁；
- crash 后恢复窗口。

在这些完成前，不能宣称跨进程串行和崩溃安全已经实现。

## 7. 部署与诊断（后续 CLI 帮助文本草案）

计划中的 CLI：

```text
she queue status [--topic <id>]
she queue claim --topic <id> --owner <id> [--ttl-ms <n>]
she lease list [--expired]
she lease heartbeat <lease-id> --owner <id>
she lease recover [--at <unix-ms>] [--dry-run]
```

帮助原则：

- 所有写操作先显示目标 task/topic/owner 和影响；
- `recover` 默认打印将变更的任务，需 `--yes` 才执行；
- CLI 与 PWA 使用同一 control-plane API，不绕过队列直接改任务状态。
