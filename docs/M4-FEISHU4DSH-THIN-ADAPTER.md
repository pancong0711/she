# M4：feishu4dsh 薄接入设计与 SHE 侧参考实现

> 日期：2026-11-25
> 状态：SHE 侧契约、参考 bridge、测试和文档完成；feishu4dsh 仓库实际接入待外部实施
> 参考代码：
> - `packages/gateway-sdk/src/bridge.ts`
> - `apps/control-plane/tests/gateway-bridge.spec.ts`
> - `docs/20261125-feishu4dsh-feedback-response.md`

## 1. 边界

```text
feishu4dsh
  ├─ 飞书 WebSocket/Webhook
  ├─ 消息/卡片/文件/审批
  ├─ 平台 ACL
  ├─ @she/client 调用
  └─ RenderIntent -> 飞书渲染
          │
          │ gateway.v1
          ▼
SHE control plane
  ├─ /she 命令语义
  ├─ 任务/队列/状态
  ├─ RenderIntent 生成
  ├─ snapshot / cursor
  └─ agent/sandbox
```

feishu4dsh 不 import：

```text
@she/core
@she/control
@she/store-sqlite
@she/broker
SHE server internals
```

## 2. feishu4dsh 侧建议模块

```text
src/integrations/she/
  config.ts          # she.enabled/socket/tokenFile/timeout
  client.ts          # 创建 @she/client
  gateway-adapter.ts # 实现 @she/gateway-sdk 的 GatewayAdapter
  render.ts          # RenderIntent -> 飞书消息/卡片/文件
  commands.ts        # /she 前缀透传
  events.ts          # task event -> 状态面板
```

如果不想引入 `@she/gateway-sdk`，可在 feishu4dsh 内实现等价 bridge；但业务语义仍必须只依赖 protocol/client，不复制 SHE 状态机。

## 3. 配置

```yaml
she:
  enabled: false
  socket: $XDG_RUNTIME_DIR/she/control.sock
  tokenFile: ~/.config/she/token
  timeoutMs: 30000
```

环境变量可选：

```text
SHE_CONTROL_SOCKET
SHE_TOKEN_FILE
```

行为：

- 默认 disabled；
- SHE 不可用时普通飞书聊天不受影响；
- `/she` 返回明确不可用提示；
- 不自动启动 SHE；
- 不自动修改 SHE 配置；
- 不把 token 暴露给 agent。

## 4. 命令透传

feishu4dsh 只识别 `/she` 前缀：

```ts
const command: GatewayCommandInvocation = {
  kind: 'command',
  requestId: generateRequestId(),
  idempotencyKey: optionalIdempotencyKey,
  actor: { id: senderId, kind: 'user' },
  conversation: { id: chatId, kind: isThread ? 'thread' : 'dm', threadId },
  replyTo: { messageId, threadId },
  rawCommand: fullText,
  attachments: controlledAttachmentRefs,
}
```

子命令解析、帮助、参数校验、任务状态全由 SHE 负责。

## 5. 参考 bridge

`@she/gateway-sdk` 提供 `SheGatewayBridge`：

```ts
const client = new SheClient({ socketPath, token })
const adapter = new FeishuGatewayAdapter(...)
const bridge = new SheGatewayBridge({ client, adapter })
await bridge.start()
```

它负责：

- 把 adapter 入站命令转给 `client.command()`；
- 把卡片/表单交互转给 `client.interaction()`；
- 把 `commandResult.renderIntents` 交给 adapter；
- 订阅 `/v1/events`，转发 `render` 和 `task` 事件；
- 出错时生成文本错误 RenderIntent；
- 不持有业务状态。

adapter 负责：

```ts
interface GatewayAdapter {
  start(sink): Promise<void>
  render(target, intent): Promise<RenderReceipt>
  onTaskEvent?(event): Promise<void>
  stop(): Promise<void>
}
```

## 6. RenderIntent 映射

| SHE RenderIntent | feishu4dsh 表现 |
|---|---|
| `text` | 普通文本或 Markdown 消息 |
| `progress` | 过程行/流式状态 |
| `status` | 状态行或状态卡片 |
| `card` | 语义 block/actions 转飞书交互卡片 |
| `form` | 飞书表单卡 |
| `approval` | Allow/Deny 审批卡，超时 fail-closed |
| `file` | 群聊文件审批 + 文件发送 |

`CardRenderIntent` 不是飞书 JSON；feishu4dsh 负责实际的 card schema/button payload。

## 7. 事件与 cursor

feishu4dsh 事件泵：

```text
GET /v1/events?cursor=evt:N
  → 解析 NDJSON
  → render 事件：adapter.render
  → task 事件：adapter.onTaskEvent
  → 记录 cursor
```

遇到：

```text
cursor_expired
```

必须：

1. 调用 `GET /v1/snapshot`；
2. 用 snapshot 重建任务面板；
3. 从 snapshot.cursor 继续订阅；
4. 不静默丢事件。

## 8. 文件与审批

- 入站附件由 feishu4dsh 下载并转换为 `AttachmentRef`；
- 出站文件由 SHE 产生 `file` RenderIntent / `artifact.created` 事件；
- 群聊文件审批始终由 feishu4dsh 执行；
- feishu4dsh 不向 SHE 传宿主绝对路径；
- SHE 不持飞书 secret。

## 9. SHE 侧测试已覆盖

- 命令 → RenderIntent；
- task 事件流 → `onTaskEvent`；
- interaction → RenderIntent；
- approval/file RenderIntent 原样交给 adapter；
- cursor_expired + snapshot service contract；
- 不可达/协议/认证错误结构化。

测试：

```text
apps/control-plane/tests/gateway-bridge.spec.ts
apps/control-plane/tests/server.spec.ts
packages/client/tests/client.spec.ts
```

当前全仓：`pnpm test` **54/54**。

## 10. feishu4dsh 仓库待实施清单

1. 在临时 integration 分支安装 `pnpm pack:public` tarball；
2. 新建 `src/integrations/she/`；
3. 实现 `GatewayAdapter`；
4. 接 `/she` 透传；
5. 接只读 help/list/status；
6. 接 submit/cancel 和 task event 面板；
7. 接 approval/form/file；
8. 双轨验证旧 `secretary`；
9. 通过后再改为正式 semver 依赖；
10. 删除旧 SHE。

## 11. 验收标准

- [ ] feishu4dsh 无 `@she/core` 依赖；
- [ ] `/she` 命令透传；
- [ ] 只读 RenderIntent 正常显示；
- [ ] 写命令返回 taskId，事件流更新状态；
- [ ] cursor_expired 后 snapshot 恢复；
- [ ] 审批/文件仍走飞书群聊审批；
- [ ] SHE 不可用不影响普通聊天；
- [ ] 旧 secretary 路径可回滚；
- [ ] 真机飞书闭环验收。
