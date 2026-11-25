# 任务执行器与 fake agent 闭环

> 日期：2026-11-25
> 状态：T1.6 已实现，M1 控制面核心首个闭环完成
> 代码：
> - `packages/control/src/task-runner.ts`
> - `packages/control/tests/task-runner.spec.ts`
> - `packages/core/src/ports.ts`（TaskRequestStore）
> - `packages/store-sqlite/src/schema.ts`（task_requests）

## 1. 定位

`TaskRunner` 把以下现有能力串成一条无外部依赖的执行链：

```text
TaskService.submit()
  → TopicQueue.claimNext()
  → TaskRequestStore.get()
  → AgentAdapter.createSession()
  → TaskService: dispatching → submitted
  → TaskService: submitted → running
  → AgentAdapter.prompt() 事件流
  → TaskService: running → succeeded/failed/interrupted
  → TopicQueue.releaseLease()
  → TaskRequestStore.delete()
```

它不是新的状态源；所有任务状态迁移仍由 `TaskService` 完成。

## 2. AgentAdapter 契约

`TaskRunner` 依赖 `@she/agent-sdk` 的 `AgentAdapter`：

- `descriptor`：adapterId/name/version/capabilities；
- `createSession()`：创建或绑定 agent session；
- `prompt()`：返回异步事件流；
- `cancel()` / `status()` / `dispose()`：后续生命周期与诊断。

首期 fake adapter 仅用于测试；M2 的 OpenCode adapter 将实现同一契约。

### 2.1 turn-end 契约

`AgentAdapter.prompt()` 必须以 `turn-end` 事件结束：

```text
turn-end.reason:
  completed  → task succeeded
  cancelled  → task interrupted
  max-tokens → task failed（agent_max_tokens，可重试）
  error      → task failed（agent_turn_error）
```

如果事件流自行结束但没有 `turn-end`，TaskRunner **fail-closed**：

```text
turn_end_missing → task failed
```

不会把“流结束”误判为成功。

## 3. 失败与租约

- `createSession()` / `prompt()` 抛错 → task `failed`；
- agent 发 `error` 事件 → task `failed`；
- 运行期间会按 lease TTL 的一半周期 heartbeat，避免长任务因无事件而过期；
- 无论成功失败，最后都会 `releaseLease()`；
- lease 过期/心跳失败 → task failed 并由 recovery 兜底；
- 原始请求在任务 terminal 后从 request spool 删除。

## 4. TaskRequestStore

Task 表只保存 request hash / 20 字摘要。原文通过独立 `TaskRequestStore` 传递：

```ts
interface TaskRequestStore {
  put(taskId: string, request: string): Promise<void>
  get(taskId: string): Promise<string | undefined>
  delete(taskId: string): Promise<void>
}
```

当前实现：

- `InMemoryTaskRequestStore`：控制面纯测试；
- SQLite `task_requests` 表：迁移 v2，任务 terminal 后删除。

约束：

- 不把原文放进 Task/Topic 表；
- 不把原文写日志；
- 任务完成后删除；
- 后续可替换为 0600 文件 spool / 加密存储，接口不变。

## 5. 测试覆盖

`TaskRunner` 测试覆盖：

- fake agent 成功完成 → `succeeded`；
- task.agentSessionId 持久化；
- agent 事件被收集；
- 成功后 topic activeTaskId 清空；
- 成功后 lease 删除、raw request 删除；
- adapter 抛错 → `failed` + lease 释放 + request 删除；
- agent `error` 事件 → `failed`；
- 缺失 turn-end → fail-closed；
- 空队列 → `undefined`。

当前测试基线：`pnpm test` 36/36。

## 6. 后续 CLI / 诊断帮助草案

```text
she task run-next --topic <id> --owner <id> [--ttl-ms <n>]
she task status <task-id>
she task events <task-id> [--cursor <cursor>]
she task request-check <task-id>      # 只显示是否存在，不打印原文
she task request-purge <task-id>      # 显式清理 spool
```

所有帮助文本遵循：

- 不输出原始请求内容到日志；
- 失败显示结构化 code/message/retryable；
- `run-next` 不自动启动 SHE 服务；
- 默认不清理人工标记为 `needs_attention` 的任务。
