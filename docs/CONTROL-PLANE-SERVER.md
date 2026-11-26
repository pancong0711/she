# Control-plane gateway.v1 server

> 日期：2026-11-25
> 状态：T4.1b 已实现
> 代码：
> - `apps/control-plane/src/server.ts`
> - `apps/control-plane/src/command-service.ts`
> - `apps/control-plane/src/main.ts`
> - `apps/control-plane/tests/server.spec.ts`
> - `apps/control-plane/tests/command-service.spec.ts`

## 1. 定位

本服务是 feishu4dsh / PWA / CLI 等 gateway 客户端访问 SHE 的唯一 HTTP 入口。

```text
@she/client
   │ Unix socket + HTTP/JSON + NDJSON
   ▼
she-control-plane
   ├─ gateway.v1 transport / auth / cursor / snapshot
   ├─ SheCommandService (help/list/status/submit/cancel)
   ├─ TaskService / TaskRunner / SQLite
   └─ EventStore replay window
```

服务本身不持有飞书 SDK、不持有 Docker socket。

## 2. 启动

```sh
pnpm build
pnpm control-plane
# 等价：
pnpm --filter @she/control-plane start
```

默认路径：

```text
socket: $XDG_RUNTIME_DIR/she/control.sock
        回退 ~/.local/run/she/control.sock
db:     $XDG_STATE_HOME/she/she.db
        回退 ~/.local/state/she/she.db
token:  $XDG_CONFIG_HOME/she/token
        回退 ~/.config/she/token（可选，0600）
```

环境变量覆盖：

```text
SHE_CONTROL_SOCKET
SHE_DB_PATH
SHE_TOKEN_FILE
SHE_VERSION
```

## 3. Endpoints

| Method | Path | 说明 |
|---|---|---|
| GET | `/v1/health` | 健康、版本、capability |
| POST | `/v1/hello` | 协议/capability 握手 |
| POST | `/v1/commands` | 命令请求，返回 `Result<GatewayCommandResult>` |
| POST | `/v1/interactions` | 卡片/表单交互请求，返回 `Result<GatewayInteractionResult>` |
| GET | `/v1/snapshot` | cursor 过期或重连后的只读状态重建 |
| GET | `/v1/agents` | OpenCode health、worker 配置和 workspace 授权只读视图 |
| GET | `/v1/events?cursor=evt:N` | NDJSON 事件流 |

认证：配置 token 时，所有请求都需要：

```text
Authorization: Bearer <token>
```

socket 目录 0700，socket 0600；不监听 TCP/LAN。

## 4. 事件与 cursor

- event cursor 格式：`evt:<sequence>`；
- 事件流返回 `application/x-ndjson`；
- 每条事件是 `GatewayServerEvent`；
- 无事件时按 `heartbeatIntervalMs` 发 `{ "type": "heartbeat", "at": ... }`；
- 事件重放窗口由 EventStore bounds 决定；
- cursor 太旧时返回 409：

```json
{
  "ok": false,
  "error": {
    "code": "cursor_expired",
    "message": "event cursor is older than the replay window",
    "retryable": false,
    "details": { "cursor": "evt:1", "oldestSequence": 3 }
  }
}
```

gateway 收到 `cursor_expired` 后必须调用 `/v1/snapshot` 重建状态，而不是静默丢事件。

## 5. 默认命令语义

`SheCommandService` 首版支持：

```text
/she help
/she list
/she status <task-id>
/she submit <request>
/she cancel <task-id>
```

- 只读命令同步返回 `commandResult.renderIntents`；
- `submit` 返回 accepted/taskId，后续状态通过事件流；
- 未知命令返回 `accepted: false` + 文本帮助；
- 所有渲染均为平台无关 `RenderIntent`，飞书卡片由 feishu4dsh 转换。

## 6. Agent / Workspace 只读状态

`GET /v1/agents` 返回 `Result<AgentRuntimeStatus>`：

- `configured`：worker 是否启用；
- adapter id/display name；
- OpenCode URL、username、凭据文件路径（不返回内容）；
- model provider/id/variant；
- `AgentHealth`：OpenCode `/api/info` 探测结果；
- `WorkspaceAccessView`：配置路径、realpath、目录/存在性、r/w/x、只读状态、是否叶子目录和 warning。

workspace 只读视图不会修改权限。root、home 本身会标记 `leafAuthorized=false`。
`SheClient.agents()` 提供对应客户端方法。

## 7. 测试覆盖

- health/hello/command/interaction/snapshot；
- bearer token 负例；
- NDJSON 事件流；
- cursor 过期 409；
- 默认命令 help/list/status/submit/cancel；
- 环境配置解析。

当前全仓测试：`pnpm test` **45/45**。

## 7. systemd user service 草案

```ini
[Unit]
Description=SHE control plane
After=network.target

[Service]
Type=simple
ExecStart=%h/Projects/2611she/node_modules/.bin/pnpm --filter @she/control-plane start
Environment=SHE_VERSION=0.1.0
Restart=on-failure

[Install]
WantedBy=default.target
```

正式安装器会使用绝对 Node/pnpm 路径，并支持 `--dry-run` / `--check` / `--enable` / `--uninstall`。

## 8. 已知限制

- 当前 command parser 是最小版本，完整 `/she` 语义和卡片交互后续迁移；
- 事件 retention 的自动 prune/job 尚未接入；server 已能基于 store bounds 拒绝过期 cursor；
- token 目前是静态 Bearer；后续补 peer credential；
- 多 control-plane 实例写同一 SQLite 不支持；
- SSE/WebSocket 暂不实现，v1 固定 NDJSON。
