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

## 2. PWA 中配置 worker

Install & Doctor → Settings 页面可直接编辑：

- worker enabled；
- OpenCode URL / username；
- OpenCode password 文件路径（只保存路径，不保存密码内容）；
- workspace path；
- model provider/id/variant；
- poll interval / lease TTL。

保存后点击“保存并重启 core”，companion 会把配置写入：

```text
~/.config/she/worker.json（0600）
```

并在启动 `run-core` 时转换为对应的 `SHE_*` 环境变量。PWA 不读取或显示密码文件内容。

## 3. 启用 worker（环境变量方式）

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

### OpenCode `--service` 自动发现

新版 OpenCode 以 `opencode serve --service` 运行时会写入：

```text
$XDG_STATE_HOME/opencode/service.json
回退 ~/.local/state/opencode/service.json
```

其中包含当前实际 `url`、`pid`、`version` 和 `password`。companion 现在会：

- 读取该 state 文件；
- 通过 `GET /api/info` 验证 `opencode:<password>`；
- 在 Settings 显示检测到的 URL、health、版本和凭据文件路径；
- 只显示路径和 health，不返回 password；
- 对仍保存旧默认值 `49375 + ~/.config/opencode/service.json` 的 worker 配置，
  自动跟随检测到的 live service URL。

如果 OpenCode 实际端口是 `49374`，而 SHE 仍使用 `49375`，任务会失败并记录
`OpenCode authentication failed` 或连接错误。此时在 Settings 点击“使用检测到的服务”，
再“保存并重启 core”。

注意：重启 OpenCode `--service` 后 password 会变化，因此应让 worker 凭据文件指向
`~/.local/state/opencode/service.json`，不要手工复制旧 password 到另一个文件。

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

## 4. 运行方式

```text
while not stopped:
  list active topics
  for each topic:
    claim next queued task
    set worker state=running and lastTaskId
    create/resume OpenCode session
    stream agent events
    transition task to terminal state
    release lease
  if no task claimed:
    set worker state=idle
```

`idle` 的含义是“当前没有正在处理的任务”，不是“worker 没启用”。
任务执行期间 `/v1/health.worker.state` 现在会显示 `running`，并在结束后回到 `idle`；
如果执行失败，`worker.lastError` 和 task.error 会保留可操作错误。

当前是单 worker，多个 Topic 按顺序处理；同一 Topic 始终串行。

## 5. 事件映射

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

## 6. PWA Chat

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
- 失败时显示 taskId、错误消息，并提示到 Agents 页面检查 OpenCode health；
- 使用 `pwa:local` 作为稳定 conversation id；
- Ctrl/Cmd + Enter 发送。

## 7. 当前限制

- worker 单进程、顺序处理；多 agent 并发/角色策略后续实现；
- 默认只使用一个配置的 workspace path；
- PWA 可编辑 worker/OpenCode/workspace 配置，但密码内容仍由用户维护在 0600 文件中；
- agent 报告/产物还没有完整下载 UI；
- OpenCode permission rules 不是 OS 沙箱；强隔离仍需 sandbox/broker；
- 如果 worker 未启用，任务会保持 queued，Chat 页面会明确提示；
- worker 已启用但 OpenCode URL/凭据错误时，任务会快速进入 failed，不会静默消失；
- 未完成 task artifact 的 PWA 展示和下载。

## 8. 验收

- [x] worker 可在 `SHE_WORKER_ENABLED=1` 时启动；
- [x] OpenCode adapter 能执行 task；
- [x] task.agent_event 持久化；
- [x] gateway event stream 输出 agent.delta；
- [x] PWA Chat 提交任务并实时展示文本；
- [x] worker disabled 时任务仍可排队并显示提示；
- [x] PWA 内配置 worker/OpenCode/workspace（密码仅路径）；
- [ ] artifact 下载/报告展示；
- [ ] 多 agent/预算/角色策略。


## Agent 健康与 Workspace 只读状态

control-plane 新增 `GET /v1/agents`，返回 `AgentRuntimeStatus`：

- OpenCode adapter 配置与 `/api/info` health；
- worker 是否启用、凭据文件路径（仅路径）；
- model 配置；
- worker workspace 的 realpath、存在性、r/w/x、readOnly、leafAuthorized 和 warning。

PWA 的 Agents 页面只读展示这些信息，不读取凭据内容，也不修改 workspace 权限。目录授权编辑仍归 T6.5。
