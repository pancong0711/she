# 回复：feishu4dsh 对 2611she protocol/client 的评审与接入需求

> 日期：2026-11-25
> 状态：已按评审意见完成第一轮对齐
> 评审来源：
> - `20260819-feishu4dsh/docs/20261125-评审-she-protocol-client与接入需求.md`
> - `20260819-feishu4dsh/docs/20261125-需求-feishu4dsh去SHE与飞书能力模块化.md`
> 本仓库对应实现：
> - `packages/protocol/`
> - `packages/client/`
> - `packages/protocol/tests/protocol.spec.ts`
> - `packages/client/tests/client.spec.ts`

## 1. 总体回复

评审方向和实施门槛全部接受，没有架构性异议。

截至本文档更新时：

- `@she/protocol` 已不是空实现：
  - gateway.v1 / agent.v1 / sandbox.v1 类型已落盘；
  - 公共版本、capability、actor、conversation、附件、错误码已落盘；
  - canonical channel capability v1 已锁进常量与单测。
- `@she/client` 已不是空实现：
  - 只依赖 `@she/protocol` 和 Node 标准库；
  - 已实现 health / hello / command / interaction / events；
  - 已有基于 fake Unix-socket HTTP server 的契约测试；
  - 不在 client 内 import `@she/core`、`@she/control`、SHE server、飞书 SDK、Docker 或 SQLite。

正式发布（npm/私有 registry 或 tarball）仍要等 control-plane server 的 endpoint 实现与发布流程完成；但 feishu4dsh 侧现在可以基于本协议和 client 源码开始 F-SHE-2 的薄接入设计，不必再等空壳问题解除。

## 2. 逐项回应

### 2.1 capability 名称唯一

已接受，以 `@she/protocol` 为唯一事实源。

`packages/protocol/src/gateway.ts` 已新增：

```ts
export const CHANNEL_CAPABILITIES_V1 = [
  'text.inbound',
  'text.outbound',
  'markdown.outbound',
  'stream.outbound',
  'card.outbound',
  'form.outbound',
  'selector.outbound',
  'approval.interactive',
  'file.inbound',
  'file.outbound',
  'thread.reply',
  'mention',
  'reaction',
] as const
```

约束：

- 后续只新增名字，不重命名已有名字；
- feishu4dsh 的 `ChannelCapabilitySet` 映射到该集合；
- 单测已冻结 13 个 v1 canonical 名称；
- 之前文档中的 `stream.text` / `render.*` / `interaction.form` / `attachment.image` 等仅为早期草案，已由 canonical 名称替代。

### 2.2 v1 传输编码

已采用评审指定的传输形态：

```text
Unix domain socket + HTTP/JSON
GET  /v1/health
POST /v1/hello
POST /v1/commands
POST /v1/interactions
GET  /v1/events?cursor=<opaque>   # application/x-ndjson
```

约束：

- 不监听 TCP/LAN；
- socket 权限目标为 0600；
- 可选 `Authorization: Bearer <token>`；
- 写请求带 `requestId` 和 `idempotencyKey`；
- 事件带 `eventId` 和 `cursor`；
- 版本不兼容返回结构化 `protocol_mismatch`；
- events 使用 NDJSON，由 `@she/client` 解析为 `GatewayServerEvent`。

`@she/client` 当前的具体 wire 约定：

```text
GET /v1/health        -> GatewayHealth（直接 JSON）
POST /v1/hello        -> GatewayWelcome（直接 JSON）
POST /v1/commands     -> { ok: true, value: GatewayCommandResult } | { ok: false, error }
POST /v1/interactions -> { ok: true, value: GatewayInteractionResult } | { ok: false, error }
GET /v1/events        -> 每行一个 GatewayServerEvent（NDJSON）
```

`POST /v1/commands` body：

```ts
{ protocolVersion: 'gateway.v1', command: GatewayCommandInvocation }
```

`POST /v1/interactions` body：

```ts
{ protocolVersion: 'gateway.v1', interaction: GatewayInteractionResponse }
```

### 2.3 client 包边界

已检查并通过：

- `@she/client` 的 dependencies 仅 `@she/protocol`；
- 使用 Node 标准库 `node:http`，没有引入额外运行时依赖；
- 没有 import `@she/core`、`@she/control`、SHE server、飞书 SDK、Docker、SQLite；
- 已提供：
  - `health()`
  - `hello()`
  - `command()`
  - `interaction()`
  - `events()`
  - `close()`
- 结构化错误：`SheClientError`，区分 transport、protocol、server error 与关闭状态。

### 2.4 事件与渲染幂等

已接受以下门禁：

- `RenderIntent` 必须有稳定 `renderId`；
- 相同 renderId + sequence 的重复事件必须被 gateway 去重；
- 重连使用 cursor；
- cursor 过期必须返回结构化 `cursor_expired`，由 gateway 重新拉取快照，不允许静默丢事件；
- `@she/client` 已支持 `events({ cursor })` 和 AbortSignal 取消；
- 服务端实现和完整重放窗口测试归入 control-plane server 任务（M1/M4）。

### 2.5 文件与路径

已接受：

- 协议只传 `AttachmentRef` / `ArtifactRef`；
- 不接受宿主绝对路径；
- 群聊文件审批继续由 feishu4dsh 执行；
- SHE 不持飞书 secret；
- feishu4dsh 不持 Docker/broker socket。

## 3. 当前可消费状态

| 包 | 当前状态 | 依赖 | 测试 |
|---|---|---|---|
| `@she/protocol` | 真实类型导出 | 无运行时依赖 | capability + 协议常量测试 |
| `@she/client` | 真实 Unix-socket 客户端 | `@she/protocol` + Node stdlib | fake UDS server 契约测试 |
| `@she/control-plane` | daemon 尚未实现 | — | 待 M1/M4 |
| `@she/broker` | daemon 尚未实现 | — | 待 M3 |

当前测试基线：`pnpm typecheck` 通过，`pnpm test` 18/18 通过。

## 4. 建议 feishu4dsh 的推进顺序

1. **现在可做**：按 `@she/protocol` 的 canonical capability 名，整理 `src/channel/capabilities.ts` 和映射测试；
2. **现在可做**：基于 `@she/client` 源码/打包 tarball 写 `src/integrations/she/` 的 fake-server 契约测试，不需要真实 SHE daemon；
3. **等 SHE 发布**：control-plane server 完成 `/v1/*` 后，发布 `@she/protocol` / `@she/client` 并给出兼容矩阵；
4. **只读闭环**：`/she status`、`/she list`、sandbox 只读命令；
5. **写操作与交互**：submit/cancel/approval/file；
6. **双轨验证**：旧 `secretary` 与新 SHE 路径同时存在；
7. **删除旧 SHE**。

## 5. 兼容矩阵（本轮更新）

| she | @she/protocol | @she/client | gateway protocol | 状态 |
|---|---|---|---|---|
| 0.1.x | 0.1.0 | 0.1.0 | gateway.v1 | protocol/client 已实现，待发布与 server 接入 |
| 后续 | semver | `~0.1.x`（feishu4dsh 锁定） | v1 | 按评审门禁演进 |

## 6. 仍需双方确认的点

1. control-plane server 发布前，feishu4dsh 是否需要直接以 workspace/file 依赖方式对接；
2. `/v1/commands` 的 command 结果是否需要返回首批 `RenderIntent`，还是只返回 accepted + taskId，后续走事件流；
3. cursor 重放窗口的具体大小和过期错误细节；
4. socket 路径、token 文件和 systemd service 命名的最终约定；
5. 兼容矩阵中 `@she/protocol` 与 `@she/client` 是否始终同版本发布，还是允许独立版本。
