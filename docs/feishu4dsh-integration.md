# feishu4dsh 接入 SHE：设计与版本依赖说明

> 日期：2026-11-25
> 状态：跨项目集成设计 v0.1
> 目标读者：feishu4dsh 维护者、SHE 维护者、部署与发布负责人
> 关联：[SHE 初始架构评审](architecture-review.md)、[兼容边界](compatibility-feishu4dsh.md)

## 1. 一句话结论

**feishu4dsh 会在编译期依赖 SHE 发布的公开客户端包（`@she/client`，并间接依赖 `@she/protocol`），在运行期通过版本化协议连接可选的 SHE control plane。**

但依赖的是**稳定的协议和薄客户端**，不是 SHE 的内部实现：

```text
feishu4dsh  ──依赖──▶  @she/client ──依赖──▶ @she/protocol
     │                                             ▲
     └──────────── gateway protocol v1 ────────────┘
                                                   │
                                          SHE control-plane daemon
```

feishu4dsh 不 import `@she/core`、不 import SHE 的存储/adapter/broker 实现，也不复制 SHE 的任务状态机。

## 2. 为什么 feishu4dsh 依赖 client

协议类型和客户端逻辑如果不由 SHE 提供，feishu4dsh 就必须复制一份：

- 协议类型、错误码、版本常量；
- capability 协商；
- Unix socket/HTTP 请求；
- 事件流重连、游标、幂等；
- 连接健康检查；
- 后续协议 minor 升级的兼容逻辑。

复制会产生两个独立演化的协议实现，最终一定漂移。因此推荐：

- SHE 发布 `@she/protocol`：纯类型、常量、capability、错误码、golden fixtures；
- SHE 发布 `@she/client`：对 control-plane API 的薄客户端；
- feishu4dsh 依赖这两个包；
- feishu4dsh 自己只保留飞书事件/卡片/文件到 gateway 协议的映射。

`@she/client` 必须是小型、无 SHE 服务端依赖、无飞书 SDK、无 Docker/DB 依赖的包。

## 3. 版本依赖与兼容策略

### 3.1 包版本

SHE 初版建议使用 `0.x` 版本，例如：

```json
{
  "dependencies": {
    "@she/client": "~0.1.0"
  }
}
```

理由：

- `@she/client` 和 `@she/protocol` 在 `0.x` 阶段仍可能按 minor 逐步收紧 API；
- `~0.1.0` 只接受 `0.1.x` patch，避免 feishu4dsh 无意间跨 minor 升级；
- 等协议稳定到 `1.0.0` 后，再使用 `^1.0.0`。

如果团队希望两个项目完全锁步，也可以把 `@she/client` 的版本与 gateway protocol 版本一起发布。**关键是不要在 feishu4dsh 里复制协议实现。**

### 3.2 协议版本

包版本和协议版本分开管理：

```text
@she/client 版本         = npm 包发布版本
gateway protocol v1      = 线上通信协议版本
capability set           = 每次连接时协商的可选能力
```

SHE 客户端连接时执行：

```text
ClientHello {
  protocolVersions: ["gateway.v1"],
  clientVersion: "0.1.0",
  capabilities: [...]
}

ServerWelcome {
  protocolVersion: "gateway.v1",
  serverVersion: "0.1.0",
  capabilities: [...]
}
```

版本不兼容时必须**明确失败并输出可操作错误**，不能静默降级到不完整行为。

### 3.3 兼容矩阵

每次 feishu4dsh / SHE 发布时应记录：

| feishu4dsh | @she/client | gateway protocol | SHE control-plane | 说明 |
|---|---|---|---|---|
| x.y.z | ~0.1.0 | v1 | >=0.1.0 | 初始接入 |
| ... | ... | ... | ... | ... |

两个仓库的 CI 都应跑同一套 `@she/protocol` golden fixtures / conformance tests。

## 4. feishu4dsh 侧建议改动

### 4.1 新增一个薄集成模块

建议在 feishu4dsh 中新增类似：

```text
src/integrations/she/
  client.ts        # 创建 @she/client，连接/重连/健康检查
  gateway.ts       # 飞书事件 -> gateway 协议
  render.ts        # RenderIntent -> 飞书消息/卡片
  commands.ts      # `/she` 前缀识别与透传
  config.ts        # SHE endpoint/socket 配置
```

禁止：

- 新增 `src/secretary/` 的第二份实现；
- import `@she/core`；
- 直接访问 SHE SQLite、broker socket 或 Docker socket；
- 在 feishu4dsh 中重新实现 SHE 的任务状态机。

### 4.2 `/she` 命令保持透传

feishu4dsh 只负责识别 `/she` 并发送：

```text
CommandInvocation {
  requestId,
  actor,
  conversation,
  workspaceHint?,
  rawCommand: "/she ..."
  replyContext?,
  attachments?
}
```

子命令解析、帮助文本、参数校验和业务错误由 SHE 返回。这样 SHE 新增 `/she xxx` 时，feishu4dsh 不需要跟着发版。

`/v1/commands` 结果结构：

```ts
{
  accepted: boolean
  requestId: string
  taskId?: string
  topicId?: string
  commandResult?: { renderIntents: RenderIntent[] }
}
```

只读命令可以同步返回 `renderIntents`；写命令只返回 accepted/taskId，后续状态通过事件流返回。

feishu4dsh 仍可以保留本地命令帮助入口，但应以 SHE handshake 返回的能力/命令清单为准。

### 4.3 RenderIntent 到飞书

SHE 输出平台无关的语义块：

```text
RenderIntent
  - kind: text | progress | status | form | approval | file | card
  - renderId
  - content
  - interaction?
  - extensions?
```

feishu4dsh 负责翻译成已有飞书原语：

- 文本/Markdown → 消息或流式卡片；
- progress/status → 现有过程行或卡片更新；
- form/approval → 现有交互卡片；
- file → 现有出站文件审批与发送；
- extensions.feishu → 可选的飞书增强。

SHE 不生成飞书卡片 JSON。通用 `card` 使用 `CardRenderIntent` 的语义化 block/action 模型，飞书卡片 JSON/按钮 payload 由 feishu4dsh 生成。

### 4.4 卡片回调

feishu4dsh 收到卡片动作后发送：

```text
InteractionResponse {
  interactionId,
  actor,
  values,
  rawAction?,
  extensions?
}
```

SHE 根据 `interactionId` 找到原始请求并继续。feishu4dsh 不直接执行任务操作。

### 4.5 附件与文件

- 入站附件由 feishu4dsh 下载并转换为 `AttachmentRef`；
- SHE 返回文件时使用 `RenderIntent.file`；
- 群聊文件审批仍由 feishu4dsh 的通道策略执行；
- 不允许 SHE 把宿主绝对路径直接传给飞书，只能传受控 artifact 引用或临时文件句柄。

### 4.6 配置

feishu4dsh 侧建议新增独立配置命名空间，例如：

```yaml
she:
  enabled: false
  socket: ~/.local/run/she/control.sock
  timeoutMs: 30000
```

旧 `secretary*` 配置可在一段时间内做兼容读取，但新集成不应继续扩张 `secretary*` 命名空间。

## 5. 运行期行为

### 5.1 SHE 不可用时

- feishu4dsh 普通聊天功能不受影响；
- `/she` 返回明确错误：“SHE control plane unavailable”，并给出 `she doctor` 或服务检查提示；
- 不自动启动 SHE、不自动修改 SHE 配置；
- 不静默降级到旧 `secretary` 实现。

### 5.2 重连与事件游标

- `@she/client` 负责事件流重连；
- 每个事件带 `eventId`；
- 订阅支持 `cursor`，服务端重放窗口内的事件；
- 超出窗口时返回明确的 `cursor_expired` 错误，由 gateway 重新拉取任务快照；
- 渲染事件必须幂等，重复事件不能造成重复发送。

### 5.3 健康检查

feishu4dsh 应能区分：

- SHE 进程不可达；
- 协议版本不兼容；
- 认证失败；
- 服务可达但存储/agent/broker 降级。

`/info` 或新的 `/she doctor` 只读输出这些信息，不自动修复。

## 6. 安全边界

- `@she/client` 不包含也不读取飞书 secret；
- feishu4dsh 不持有 Docker socket；
- SHE control-plane 不直接发飞书消息；
- SHE broker 不接受任意 Docker 参数；
- gateway 与 SHE 使用 Unix socket peer credential 或每进程 token 认证；
- 详见 gateway protocol 的 actor 与 capability 约束。

## 7. 测试要求

### 7.1 SHE 仓库

- protocol golden fixtures；
- fake gateway 事件/渲染契约测试；
- client 与服务端协议版本负例；
- 事件重放/游标过期/幂等测试；
- 不依赖 Feishu SDK、Docker、真实凭据。

### 7.2 feishu4dsh 仓库

- `/she` 命令透传测试；
- RenderIntent → 飞书消息/卡片/文件的纯逻辑测试；
- 卡片动作 → InteractionResponse 测试；
- SHE 不可达、版本不兼容、认证失败的错误呈现测试；
- 旧 `secretary` 兼容开关测试（迁移期）。

### 7.3 联合验收

- 两个仓库 CI 使用同一个 protocol fixture 版本；
- 一条最小闭环：飞书私聊 `/she submit` → SHE control plane → OpenCode adapter → RenderIntent → 飞书收到状态与结果；
- 一条附件闭环：飞书附件 → SHE task → artifact → 飞书文件审批；
- 一条版本负例：模拟 protocol major 不一致，双方均报清晰错误。

## 8. 关于“agent adapter 只做 OpenCode，dsh 后置”

这里的 **agent adapter** 指 SHE 控制面用来驱动某种 agent harness 的适配器。

首期：

```text
feishu4dsh (gateway)
  → SHE control plane
  → agent-opencode adapter
  → OpenCode HttpApi
```

`dsh` 后置的意思是：

- 第一阶段不实现“让 SHE 把 dsh 当作一个受控 agent runtime 来驱动”的 adapter；
- 这不影响 feishu4dsh 接入 SHE。feishu4dsh 是 gateway，SHE 通过 client 被调用；
- feishu4dsh 自身普通聊天继续由它现有的 dsh 运行时处理；
- 未来如果有必要，再增加 `@she/agent-dsh`，让 SHE 能像管理 OpenCode 一样管理 dsh agent/session。

一句话：**dsh adapter 是 SHE 的可选执行器扩展，不是 feishu4dsh 调用 SHE 的前提。**

## 9. 分阶段落地

### 阶段 A：客户端与协议先行

- SHE 发布 `@she/protocol`、`@she/client` 的最小版本；
- feishu4dsh 加入依赖和一个不启用的 `integrations/she` 模块；
- 只实现 handshake / health / version 检查。

### 阶段 B：`/she` 透传与只读展示

- `/she sandbox list/info/stats`、`/she status` 等只读命令；
- RenderIntent → 文本/普通卡片；
- 不影响普通飞书聊天。

### 阶段 C：写操作与执行闭环

- submit / cancel / interaction respond / file；
- 事件流和重连；
- 旧 `secretary` 数据迁移或兼容提示。

### 阶段 D：删除 feishu4dsh 内的旧 SHE

- 保留一段时间的迁移提示；
- feishu4dsh 不再带 `src/secretary/` 与 broker/sandbox 脚本；
- 发布兼容矩阵和回滚说明。

## 10. 需要 feishu4dsh 维护者确认的事项

1. 是否接受 `@she/client` 作为公开依赖，并锁定 `~0.x` 版本范围；
2. feishu4dsh 的 CI 是否接入 SHE protocol conformance fixtures；
3. `/she` 帮本文案以 SHE 服务端为单一事实源，feishu4dsh 只保留入口提示；
4. 旧 `secretary*` 配置和状态的迁移周期；
5. `extensions.feishu` 的边界：只允许渲染/通道元数据，不允许业务状态；
6. 首次联合调试使用的 Unix socket 路径、认证方式和 systemd 服务名。
