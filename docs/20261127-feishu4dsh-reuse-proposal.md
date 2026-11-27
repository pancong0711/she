# feishu4dsh 复用与分工建议

> 日期：2026-11-27
> 状态：建议稿，待 feishu4dsh 维护者确认
> 关联：[feishu4dsh 接入 SHE 设计](feishu4dsh-integration.md)、[M4 薄接入](M4-FEISHU4DSH-THIN-ADAPTER.md)

## 1. 先澄清三个事实

### 1.1 当前 feishu4dsh 没有扫码建应用

feishu4dsh 当前主分支的 `docs/ARCHITECTURE.md` 明确写着：

```text
不做「扫码一键建应用」onboarding
```

其 `docs/FEISHU-SETUP.md` 仍要求用户先在开放平台创建企业自建应用，再手动复制
App ID / App Secret。因此：

- “feishu4dsh 已经支持扫码连接”不是当前事实；
- 以后若要扫码，应使用 Lark SDK 的 `registerApp` 或独立 onboarding 工具；
- 该能力应由 feishu4dsh 或独立安装器负责，而不是塞进 SHE 的 gateway 里。

### 1.2 feishu4dsh 不是可被 SHE 直接 import 的普通 SDK

feishu4dsh 是 dsh/Cordis 插件：

```text
Feishu <-> feishu4dsh <-> dsh agent
```

它虽然导出了 `feishu4dsh/channel` 这组相对中立的 Feishu 通道原语，但完整插件仍依赖
dsh 的会话、审批、工作区与 Cordis 生命周期。SHE 直接安装 feishu4dsh 不等于 SHE 获得
其飞书卡片/审批/文件能力。

### 1.3 当前 SHE 内置 gateway 只是短期 fallback

SHE 内置 `apps/feishu-gateway` 直接使用官方 Lark SDK，已覆盖：

- App ID / Secret 手动配置；
- WebSocket；
- `/she` 子命令；
- 任务接受/完成/失败文本；
- agent text delta 聚合。

它没有完整继承 feishu4dsh 的卡片、审批、文件、表单、线程与节流策略。继续在 SHE
内重写这些能力会形成第二套飞书实现，维护成本高。

## 2. 推荐方向

```text
SHE control plane
      ▲
      │ gateway.v1（版本化协议）
      │
feishu4dsh channel adapter
      │
Feishu / Lark
```

职责划分：

| 责任 | SHE | feishu4dsh |
|---|---|---|
| `/she` 命令语义、任务状态、审批业务含义 | 负责 | 不负责 |
| `gateway.v1` protocol、client、golden fixtures | 负责 | 依赖 |
| 飞书 WebSocket/Webhook、去重、节流 | 不负责 | 负责 |
| 飞书卡片、按钮、表单、文件、线程 | 不负责 | 负责 |
| RenderIntent -> 飞书 JSON | 不负责 | 负责 |
| 卡片动作 -> InteractionResponse | 不负责 | 负责 |
| App ID / Secret 保存与进程边界 | SHE 内置 fallback 短期负责 | feishu4dsh 正式负责 |
| 扫码建应用 onboarding | 不负责 | 建议负责（或独立工具） |

## 3. 需要 feishu4dsh 做的工作

### 3.1 提供正式的 `gateway.v1` adapter

建议新增：

```text
src/integrations/she/
  config.ts
  client.ts
  gateway-adapter.ts
  render.ts
  commands.ts
  events.ts
```

实现 SHE 已定义的 `GatewayAdapter`/`SheGatewayBridge` 契约：

- 入站消息 -> `CommandInvocation`；
- `/she` 原始命令透传；
- `RenderIntent` -> 飞书消息/卡片/文件；
- 卡片动作 -> `InteractionResponse`；
- task/render 事件流订阅；
- `cursor_expired` 后拉 snapshot；
- SHE 不可用时给出明确错误，不影响普通聊天。

### 3.2 发布适配版本矩阵

feishu4dsh 发布时声明：

```text
supported gateway protocol: gateway.v1
@she/client version range: ...
@she/protocol version range: ...
```

SHE 侧提供同一套 golden fixtures，两个仓库 CI 都跑。

### 3.3 把 `feishu4dsh/channel` 的复用边界稳定下来

当前 `channel` export 已包含 capability、ACL、cards、files 等纯 Feishu 原语。
建议明确其 semver 和“不依赖 dsh 宿主状态”的约束，避免 SHE 复制：

```text
card schema builder
approval card
form values
file boundary
thread anchor
```

但 SHE 不应直接依赖整个 `feishu4dsh` 包；二者通过协议通信。只有独立、无 dsh
依赖的纯原语包才可考虑被其他项目复用。

### 3.4 可选：扫码 onboarding 由 feishu4dsh 做

若要做扫码：

```text
用户点击“连接飞书”
  -> feishu4dsh/onboarding 调 Lark SDK registerApp
  -> 显示二维码
  -> 用户扫码授权
  -> 获取 App ID / Secret
  -> 写入 0600 配置
  -> 启动 channel adapter
```

SHE 只显示状态和“启动/停止/重新连接”，不接触 Secret 原值。该流程应作为
feishu4dsh 的独立能力实现，而不是在 SHE 的 web server 中复制。

## 4. SHE 侧本轮保持什么

- 保留内置 gateway 处理最小可用场景；
- 不在 PWA 中自动安装 dsh/feishu4dsh；
- Packages 页面可展示“外部 feishu4dsh”说明和文档链接；
- 不把 feishu4dsh App Secret 传给 core/worker/agent；
- 等待 feishu4dsh 提供 adapter 后，内置 gateway 可标记为 legacy/fallback。

## 5. 需要确认的问题

1. feishu4dsh 是否接受把 `gateway.v1` adapter 作为正式子模块维护？
2. 是否把 `feishu4dsh/channel` 拆成真正独立的无 dsh 依赖包？
3. 扫码 onboarding 是否进入 feishu4dsh 路线图？优先级如何？
4. 适配版本是随 feishu4dsh 主版本发布，还是独立 `@feishu4dsh/she` 包？
5. 联合验收是否使用同一份 `@she/protocol` golden fixtures？

## 6. 结论

短期继续使用 SHE 内置 gateway，保证连接可用；长期应让 feishu4dsh 成为正式
飞书 channel adapter，SHE 只维护控制面与协议。扫码能力延后，并且优先放在
feishu4dsh 侧。这样两边的边界清楚，也不会在 SHE 内再造一套飞书实现。
