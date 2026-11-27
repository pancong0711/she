# 需求（feishu4dsh 侧复核）：SHE gateway message 回执与任务目标映射

> 日期：2026-11-27 ｜ 状态：待 feishu4dsh 维护者复核，未实施
> 来源：SHE 侧 `docs/20261127-需求-SHE-gateway直接消息与命令语义.md`
> 关联：feishu4dsh `docs/20261127-交接-feishu4dsh直连SHE-gateway.md`
> 说明：本文件位于 SHE 仓库，供 feishu4dsh 侧复核后迁移/落地；SHE 不直接修改
> feishu4dsh 仓库。

## 1. 背景

SHE 侧已实现 `POST /v1/messages`。普通飞书消息不再需要 `/she` 前缀，SHE 按
`conversation.id` 创建/复用 topic 和 agent session，并返回任务关联 id：

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

普通消息是异步的：`accepted` 后 agent 输出通过 `/v1/events` 的 task/render
事件返回。由于普通消息没有同步命令结果可供 feishu4dsh 记录 `taskId → target`，
当前 runtime 虽然能成功提交消息，但后续 task 事件可能找不到对应飞书会话目标，
导致 agent artifact 输出无法发送。

## 2. 建议改动

### 2.1 类型

将普通消息客户端回执从 `void` 扩展为 `GatewayMessageResult`：

```ts
// src/integrations/she/client.ts
export interface SheMessageClient {
  message(event: GatewayMessageEvent, signal?: AbortSignal): Promise<GatewayMessageResult>
}
```

`GatewayMessageResult` 从 `@she/protocol` 导入，至少包含：

```ts
interface GatewayMessageResult {
  accepted: boolean
  requestId: string
  taskId?: string
  topicId?: string
}
```

这是向后兼容的附加字段：SHE 仍返回 `accepted/requestId`，旧客户端忽略
`taskId/topicId` 也不会破坏响应。

### 2.2 runtime 关联

`SheIntegrationRuntime.dispatchInbound()` 处理 message 分支时，建议复用现有
`renderResult()` 的任务目标记忆逻辑：

```ts
if (event.kind === 'message') {
  if (client.message === undefined) throw ...
  const result = await client.message(event)
  await this.renderResult(target, result)
  return
}
```

这样：

- `result.taskId` 进入 `taskTargets`；
- `result.topicId` 进入 `topicTargets`；
- sink 收到 `task.accepted/progress/completed/failed/artifact.created` 时，
  可以取得原 RenderTarget；
- 现有 `artifact.created → file RenderIntent` 和预览审批逻辑无需重写。

### 2.3 兼容层

`postSheGatewayMessage()` 当前只返回 void。需要解析 SHE 响应体并返回
`GatewayMessageResult`；若未来 `@she/client` 原生提供 `message()`，仍优先使用
原生方法。

错误处理保持当前 `SheError` 语义；不能把解析失败伪装成 accepted。

## 3. 需要新增的测试

建议在 feishu4dsh 侧补：

1. fake UDS 返回带 `taskId/topicId` 的 message result；
2. `runtime.handleFeishuMessage()` 后 `taskTargets`/`topicTargets` 被写入；
3. 后续 `task.artifact.created` 事件会向原 conversation 发送文件或文本降级；
4. 失败/错误 result 不写入目标映射；
5. 旧版 SHE 响应缺省 `taskId/topicId` 时，普通消息仍 accepted，但 artifact
   发送走明确降级提示，不伪造成功。

## 4. 边界

- feishu4dsh 仍不解析普通消息文本，不保存 conversation→agent 业务映射；
- `taskId/topicId` 只用于 transport 关联到已收到的 RenderTarget；
- 不把 SHE token、socket、宿主绝对路径发送到飞书；
- 群聊 artifact 仍必须经过现有审批卡，超时拒绝。

## 5. 复核问题

请 feishu4dsh 侧确认：

1. 是否接受把 `GatewayMessageResult.taskId/topicId` 作为兼容扩展？
2. `dispatchInbound` message 分支是否可直接复用 `renderResult()`？
3. 是否有更合适的 runtime 关联位置，避免重复保存 task/topic target？
4. 若暂不接受该扩展，是否改为由 SHE 在事件流中直接发带 target 的 RenderIntent？
