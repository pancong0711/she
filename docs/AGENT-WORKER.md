# Agent Worker 与 PWA Chat

> 日期：2026-11-25
> 状态：首版已实现
> 代码：
> - `apps/control-plane/src/worker.ts`
> - `apps/control-plane/src/main.ts`
> - `apps/pwa/src/App.vue`
> - `packages/control/src/task-runner.ts`

## 1. 定位

PWA Chat 不是独立于控制面的第二套聊天系统。它通过：

```text
PWA Chat
  → /v1/commands { rawCommand: "/she submit ..." }
  → SHE TaskService / TopicQueue / TaskRunner
  → OpenCode agent adapter
  → task.agent_event
  → /v1/events NDJSON
  → PWA 实时显示
```

与 feishu4dsh/CLI 共用同一个 control plane、同一个 conversation/task 状态源。

## 2. 启用 worker

默认关闭：

```text
SHE_WORKER_ENABLED=1
```

OpenCode 配置：

```text
SHE_OPENCODE_URL=http://127.0.0.1:49375
SHE_OPENCODE_USERNAME=opencode
SHE_OPENCODE_PASSWORD_FILE=~/.config/opencode/service.json
SHE_WORKSPACE_PATH=~/.local/share/she/workspaces/default
```

可选模型：

```text
SHE_AGENT_MODEL_PROVIDER=opencode-go
SHE_AGENT_MODEL_ID=deepseek-v4.1-flash
SHE_AGENT_MODEL_VARIANT=high
```

worker 参数：

```text
SHE_WORKER_POLL_MS=1000
SHE_WORKER_LEASE_TTL_MS=300000
```

## 3. 运行方式

```text
while not stopped:
  list active topics
  for each topic:
    claim next queued task
    create/resume OpenCode session
    stream agent events
    transition task to terminal state
    release lease
```

当前是单 worker，多个 Topic 按顺序处理；同一 Topic 始终串行。

## 4. 事件映射

`TaskRunner` 把以下 agent 事件写入 EventStore：

```text
text-delta
reasoning-delta
tool-call
usage
```

gateway.v1 映射：

| agent event | gateway event |
|---|---|
| text-delta | `agent.delta(channel=text)` |
| reasoning-delta | `agent.delta(channel=reasoning)` |
| tool-call | `tool.call` |
| task terminal | `task.completed` / `task.failed` |

PWA Chat 消费 `/v1/events`，按 `eventId` 去重，实时追加 agent 输出。

## 5. PWA Chat

页面：

```text
Chat
```

能力：

- 输入任务并提交 `/she submit <text>`；
- 显示 accepted/taskId；
- 显示 worker 状态；
- 实时显示 agent text delta；
- 显示 tool call 状态；
- 显示任务完成/失败；
- 使用 `pwa:local` 作为稳定 conversation id；
- Ctrl/Cmd + Enter 发送。

## 6. 当前限制

- worker 单进程、顺序处理；多 agent 并发/角色策略后续实现；
- 默认只使用一个配置的 workspace path；
- 尚未在 PWA 中编辑 worker/OpenCode 凭据；当前通过环境/配置启动；
- agent 报告/产物还没有完整下载 UI；
- OpenCode permission rules 不是 OS 沙箱；强隔离仍需 sandbox/broker；
- 如果 worker 未启用，任务会保持 queued，Chat 页面会明确提示；
- 未完成 task artifact 的 PWA 展示和下载。

## 7. 验收

- [x] worker 可在 `SHE_WORKER_ENABLED=1` 时启动；
- [x] OpenCode adapter 能执行 task；
- [x] task.agent_event 持久化；
- [x] gateway event stream 输出 agent.delta；
- [x] PWA Chat 提交任务并实时展示文本；
- [x] worker disabled 时任务仍可排队并显示提示；
- [ ] PWA 内配置 worker/凭据；
- [ ] artifact 下载/报告展示；
- [ ] 多 agent/预算/角色策略。
