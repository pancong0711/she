# SHE gateway.v1：普通消息、会话路由与直接命令语义

> 日期：2026-11-27 ｜ 状态：SHE 侧第一阶段已实施，待与 feishu4dsh 联合真机验收
> 上游依据：
> - feishu4dsh `docs/20261127-交接-feishu4dsh直连SHE-gateway.md`
> - feishu4dsh `docs/20261127-需求-r72-SHE直连gateway与channel-core复用.md`
> - SHE `docs/20261127-feishu4dsh-r71-compatibility.md`

## 1. 目标与边界

产品形态固定为 feishu4dsh 作为唯一飞书 gateway：

```text
飞书 ⇄ feishu4dsh standalone gateway
      ⇄ gateway.v1
      ⇄ SHE control plane
      ⇄ agents
```

SHE 侧负责：

- 接收普通消息 `POST /v1/messages`；
- 以 `conversation.id` 为稳定会话键路由到 topic/task；
- 按 `idempotencyKey` 幂等去重；
- 接受后立即返回，后续通过事件流输出；
- 解析直接命令（`/help`、`/list`、`/status`、`/submit`、`/cancel`、`/stop`）；
- 保留 `/she ...` 作为兼容别名，但普通消息不要求 `/she` 前缀；
- 不保存飞书 secret，不读取飞书 transport 状态。

feishu4dsh 负责：

- 飞书 WebSocket/Webhook、消息/卡片/文件 transport；
- 入站消息到 `GatewayMessageEvent` / `GatewayCommandInvocation` 的映射；
- RenderIntent 到飞书卡片的渲染；
- 群聊文件审批和落盘边界；
- 事件游标持久化与 `cursor_expired → /v1/snapshot`。

## 2. 已实施

### 2.1 `POST /v1/messages`

请求：

```json
{
  "protocolVersion": "gateway.v1",
  "message": {
    "kind": "message",
    "requestId": "uuid",
    "idempotencyKey": "feishu:message:<message-id>",
    "actor": { "id": "<open_id>", "kind": "user" },
    "conversation": { "id": "<chatId[:threadId]>", "kind": "dm|group|thread" },
    "text": "用户原文",
    "replyTo": { "messageId": "<message-id>" },
    "extensions": { "feishu": { "chatId": "<chatId>" } }
  }
}
```

成功返回（`GatewayMessageResult`）：

```json
{
  "ok": true,
  "value": {
    "accepted": true,
    "requestId": "uuid",
    "taskId": "task-...",
    "topicId": "topic-..."
  }
}
```

`taskId` / `topicId` 是向后兼容的附加字段。它们不是 SHE 业务路由状态的外泄，
而是让 channel adapter 把后续 task 事件关联回原 RenderTarget 所需的关联 id。
feishu4dsh 当前只读取 `accepted/requestId` 也不会破坏协议；但若要显示普通消息的
agent 输出和 artifact，需要在 feishu4dsh 侧补上这两个 id 的关联逻辑。

### 2.2 会话路由第一阶段

- `conversation.id` 作为 `TaskService.submit()` 的 `conversationKey`；
- 每个 conversation 拥有独立 topic；
- TaskRunner 以 topic id 作为 agent session key，因此不同飞书私聊/群聊/thread
  不会共享同一个 agent session；
- 当前只有一个已配置的 OpenCode worker，多 agent 路由策略和 `/agent` 选择尚未实现；
- 相同 `idempotencyKey` 返回同一个 task/topic，不重复入队。

### 2.3 命令语义

直接命令：

```text
/help
/list
/status <task-id>
/submit <request>
/cancel <task-id>
/stop
```

兼容别名：

```text
/she help
/she list
/she status <task-id>
/she submit <request>
/she cancel <task-id>
```

`/stop` 会取消当前 conversation 中最新一个 queued/submitted/running 任务。
`/agent`、`/new` 等多 agent/会话管理命令仍未实现。

### 2.4 客户端

`@she/client` 新增：

```ts
client.message(event: GatewayMessageEvent): Promise<GatewayMessageResult>
```

底层请求为 `POST /v1/messages`，并复用既有 `SheError` 错误模型。

## 3. 代码位置

```text
packages/protocol/src/gateway.ts                  # GatewayMessageRequest/Result
packages/protocol/src/fixtures.ts                 # message golden fixtures
packages/client/src/index.ts                      # client.message()
apps/control-plane/src/server.ts                  # POST /v1/messages
apps/control-plane/src/command-service.ts         # message()、直接命令、/stop
apps/control-plane/tests/server.spec.ts           # endpoint/handler 契约
apps/control-plane/tests/command-service.spec.ts  # 幂等、conversation topic、命令
packages/client/tests/client.spec.ts              # client.message 协议
packages/client/tests/feishu4dsh-compat.spec.ts   # feishu4dsh 兼容面
```

## 4. 验证

```text
pnpm typecheck  ✓
pnpm test       ✓
```

## 5. 尚未完成

- feishu4dsh 尚未把 `GatewayMessageResult.taskId/topicId` 映射为任务 RenderTarget；
  需要 feishu4dsh 侧小改动，见其仓库文档
  `docs/20261127-需求-SHE-gateway-message-result回执与任务目标映射.md`；
- 多 agent / conversation route policy；
- `/agent`、`/new` 命令；
- 入站图片/文件 attachment upload 契约；
- 能力声明按真实实现收紧（当前 control plane 默认仍可能广播完整 capability 列表）；
- 与 feishu4dsh 的真实飞书 App 联合验收；
- SHE 内置 Feishu gateway 的 legacy/退役流程。

## 6. 真机验收顺序

1. 启动 SHE core，确认 `$XDG_RUNTIME_DIR/she/control.sock` 和 token 权限；
2. 启动 feishu4dsh standalone gateway；
3. 私聊普通消息 → 创建 task/topic；
4. 相同飞书 message id 重放 → 不重复入队；
5. 不同 conversation 发送 → task/topic/session 隔离；
6. 斜杠命令 `/help`、`/list`、`/submit`、`/status`、`/cancel`、`/stop`；
7. agent 输出通过 task 事件返回，由 feishu4dsh 关联 RenderTarget 后渲染；
8. artifact 私聊直发、群聊审批；
9. 停掉 SHE 时 gateway 明确不可用，不伪造成功。
