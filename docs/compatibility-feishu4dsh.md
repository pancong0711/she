# 与 feishu4dsh 的兼容边界

> 状态：提案 v0.1
> 目标：feishu4dsh 与 she 独立演进，同时让 feishu4dsh 的新通道能力可以被 she 直接使用。

## 1. 总原则

```text
feishu4dsh  ──依赖──▶  @she/protocol / @she/client
                         │
                         ▼
                       SHE
```

- feishu4dsh 不 import SHE 内部模块；
- SHE 不 import feishu4dsh；
- 双方只通过版本化协议通信；
- 平台特有的卡片、文件、线程、审批行为由 feishu4dsh 实现；
- SHE 只表达“要展示什么、要什么交互”，不表达“飞书卡片 JSON 长什么样”。

## 2. 协议分层

建议同时定义三个协议域：

- `gateway.v1`：feishu4dsh/CLI 等 channel adapter ↔ SHE；
- `agent.v1`：SHE ↔ agent adapter（OpenCode/dsh/Hermes）；
- `sandbox.v1`：SHE ↔ sandbox broker/provider。

公共部分包括：

- `ProtocolHello` / `CapabilitySet`；
- `RequestId` / `EventId` / `IdempotencyKey`；
- `ActorRef` / `ConversationRef` / `WorkspaceRef`；
- `AttachmentRef` / `ArtifactRef`；
- `SheError` 错误码与可重试性；
- 事件游标与重连语义。

## 3. gateway 协议的基本消息

### 3.1 入站

```text
InboundEvent
  - eventId
  - kind: message | command | interaction | attachment
  - actor
  - conversation
  - workspaceHint?
  - content: blocks
  - attachments
  - replyContext?
  - extensions?
```

`CommandInvocation` 建议保留原始命令参数，让 `/she` 的解析和帮助语义留在 SHE，而不是每加一个子命令都要改 feishu4dsh。

### 3.2 出站

```text
RenderIntent
  - kind: text | markdown | progress | status | form | approval | file | card
  - target: conversation/thread
  - content: semantic blocks
  - interaction?: InteractionSpec
  - extensions?
```

飞书卡片/按钮/表单由 feishu4dsh 的 renderer 转换成平台 JSON。

### 3.3 事件

```text
TaskAccepted / TaskProgress / AgentDelta / ToolCall /
ApprovalRequested / ArtifactCreated / TaskCompleted / TaskFailed
```

## 4. 能力协商

启动握手：

```text
gateway -> SHE: hello(protocolVersions, channelCapabilities, extensions)
SHE -> gateway: welcome(protocolVersion, requiredCapabilities, serverCapabilities)
```

能力示例：

- `stream.text`
- `render.markdown`
- `render.card`
- `interaction.form`
- `file.inbound`
- `file.outbound`
- `approval.interactive`
- `thread.reply`
- `attachment.image`

SHE 只使用双方都支持的能力；不支持时回退到文本或单次消息。

## 5. 新功能如何“直接可用”

feishu4dsh 的新功能分三类：

1. **纯通道增强**：新的消息类型、流式卡片、线程锚、文件审批。通过 capability + 标准 `RenderIntent` 暴露，SHE 无需改代码即可使用。
2. **新交互语义**：表单、确认、选择器。通过通用 `InteractionSpec` 和 `extensions` 表达，SHE 可选择使用或降级。
3. **新业务语义**：需要 SHE 理解的新任务/审批/沙箱概念。通过 `gateway.v1` minor 版本增加可选字段或事件，双方按 capability 协商。

禁止为了复用 UI 而在 SHE 中复制 feishu4dsh 的 `bridge.ts`。

## 6. 发布与兼容矩阵

- `@she/protocol` 使用 semver；
- 协议 major 变更时，client/server 必须显式拒绝不兼容连接并给出可操作错误；
- 两个仓库 CI 跑同一套协议 golden fixtures；
- feishu4dsh 发布时声明所需 `@she/protocol` 版本范围；
- SHE 发布时声明支持的 gateway/agent/sandbox 协议版本范围；
- 运维侧提供 `she doctor` / capability 检查，打印当前双方版本与能力差异。
