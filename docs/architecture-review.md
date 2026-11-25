# SHE 初始架构评审：gateway / agent / sandbox 三分是否合理

> 日期：2026-11-25
> 状态：架构基线提案 v0.1，待项目所有者确认
> 结论：三分方向正确，但不能把 gateway、agent、sandbox 做成三个并列的顶层业务模块。需要一个不依赖任何平台的 **control/core** 作为控制面内核，以及单独的 **protocol** 作为跨项目契约。

## 1. 结论先行

`gateway / agent / sandbox` 是三个必要的**边界平面**：

- gateway：聊天平台与 SHE 之间的通道边界；
- agent：SHE 与具体 agent harness（OpenCode、dsh、Hermes 等）之间的运行时边界；
- sandbox：agent 执行环境与宿主资源之间的资源/生命周期边界。

但如果仓库直接按这三个目录组织，会出现职责泄漏：

1. 没有明确归属的任务状态机、队列、调度、路由、预算与策略，会被迫塞进 gateway 或 agent；
2. gateway 会逐渐掺杂任务业务逻辑；
3. agent 会同时承担“adapter”和“agent 实例/生命周期管理”；
4. sandbox 会把“声明式规格、Docker provider、策略 broker、服务生命周期”混成一个模块；
5. 与 `feishu4dsh` 的兼容会退化为源码耦合，而不是协议兼容。

因此推荐的目标是：

```text
                    ┌──────────────────────┐
                    │  feishu4dsh / CLI    │
                    │  channel adapters    │
                    └──────────┬───────────┘
                               │ gateway protocol v1
                    ┌──────────▼───────────┐
                    │   SHE control/core   │
                    │ tasks / routing /    │
                    │ policy / state       │
                    └───┬───────────┬──────┘
                        │           │
             agent protocol      sandbox protocol
                        │           │
              ┌─────────▼───┐   ┌───▼─────────────┐
              │ agent plane │   │ sandbox plane   │
              │ adapters    │   │ broker/provider │
              └─────────────┘   └─────────────────┘
```

一句话：**一个控制核心 + 三个适配平面 + 一套版本化协议**。

## 2. 为什么不能只有三个并列模块

### 2.1 缺少控制面核心

SHE 的核心价值不是“能把消息发给某个 agent”，而是：

- Topic/Task 生命周期；
- 串行队列、租约、重试、超时、取消；
- 任务路由、幂等与去重；
- sandbox/agent 的注册、发现和选择；
- 角色、调用关系、预算、fanout、最大委派深度；
- 报告、产物、审核、回传与审计；
- session/workspace 映射；
- 控制面 API 与事件流。

这些逻辑既不属于 gateway，也不属于 agent adapter，更不属于 Docker provider。必须放在独立的 `core`/`control` 包中。

### 2.2 gateway 不是业务控制面

gateway 应当只做：

- 接收平台事件/命令/卡片动作/文件；
- 归一化为平台无关的 `InboundEvent`、`CommandInvocation`、`InteractionResponse`；
- 声明平台能力（流式、卡片、表单、文件审批、线程等）；
- 把 SHE 返回的语义化 `RenderIntent` 翻译成平台消息；
- 维护平台侧的连接、去重、限流和重连。

gateway 不应做：

- 任务入队和状态迁移；
- 选择 agent/sandbox；
- 直接调用 broker 或 Docker；
- 维护 SHE 的业务数据库；
- 解析 SHE 的全部子命令语义。

`feishu4dsh` 本身就是飞书 gateway adapter 的天然归属。`she` 仓库只定义 gateway contract、服务端接入点和可选 standalone gateway 骨架，不复制飞书 SDK 逻辑。

### 2.3 agent 不等于 agent 实例管理

需要区分：

- **agent adapter**：对某个 harness 的 API 适配，例如 OpenCode HTTP API、dsh host contract；
- **agent instance/session**：一个具体 agent 逻辑实例及其 session、模型、工作区、健康状态；
- **agent scheduling**：由 control/core 决定何时、在哪个执行环境启动哪个 agent。

推荐：

- `agent-sdk` 定义 adapter 契约；
- `agent-opencode`、未来的 `agent-dsh` 等实现 adapter；
- agent registry、instance 生命周期、session 映射放在 `core/control`。

agent adapter 不得知道 Docker、飞书、SQLite 或任务队列。

### 2.4 sandbox 不是单一模块

sandbox 平面至少有三层：

1. **SandboxSpec**：期望状态，包括镜像、workspace、mount、资源、网络、角色、inbox/outbox、凭据挂载；
2. **SandboxProvider**：实际执行者，例如 Docker/rootless、本地进程、未来的远端节点；
3. **SandboxBroker**：唯一持有 Docker socket、执行策略校验、维护 registry/audit/mailbox 的受信服务。

broker 是 sandbox 平面中的一个**独立服务/信任边界**，不是一个普通的库函数。不能让 control 或 agent 直接持有 Docker socket。

scheduler 决定“需要什么 sandbox”，broker 决定“这个 sandbox 是否允许被创建/启动/销毁，以及能访问什么”。两者职责不同。

## 3. 推荐的边界职责

| 平面/模块 | 核心职责 | 明确不负责 |
|---|---|---|
| protocol | 跨进程/跨仓库的类型、事件、错误码、版本与 capability 协商 | 业务状态、平台 SDK、运行时依赖 |
| core | 实体、状态机、策略、端口接口、纯领域逻辑 | 文件系统、网络、Docker、Feishu、dsh |
| control | 用例编排、调度、队列、路由、任务执行协调 | 具体 adapter 实现、平台渲染 |
| gateway-sdk / gateway plane | 平台无关的入站事件与出站渲染契约；可选 gateway 服务 | 任务状态机、agent/sandbox 内部细节 |
| agent-sdk / agent plane | agent runtime adapter 契约与各 harness 实现 | 任务队列、Docker、飞书 |
| sandbox-sdk / sandbox plane | `SandboxSpec`、provider 契约、状态与产物接口 | 任务语义、agent 协议、平台 UI |
| broker | Docker socket 所有权、策略执行、registry/audit/mailbox | 模型推理、平台消息、任务调度 |
| store | SQLite/其他持久化实现 | 业务规则 |
| client/cli | 面向 feishu4dsh 或用户的薄客户端与命令入口 | 复制服务端逻辑 |

## 4. 依赖方向

推荐严格单向依赖：

```text
protocol
   ▲
   ├── core
   │     ▲
   │     └── control
   │            ▲
   │            ├── store-sqlite
   │            ├── agent-* adapters
   │            └── sandbox-* adapters
   │
   ├── gateway-sdk
   ├── agent-sdk
   ├── sandbox-sdk
   └── client
```

约束：

- `core` 不 import `feishu4dsh`、`dsh`、Docker SDK、SQLite driver 或具体 gateway adapter；
- `control` 只依赖 core 的端口和 protocol，不直接 import 具体 adapter；
- adapter 实现 core/protocol 定义的端口；
- 组合根（control-plane app / broker app）负责把具体实现注入 control；
- `client` 只依赖 protocol，供 feishu4dsh 与 CLI 使用；
- `feishu4dsh` 只能依赖 `@she/protocol`、`@she/client` 或等价的稳定公开面，不能 import `she` 的内部包。

## 5. 建议的初始包结构

```text
she/
  packages/
    protocol/          # @she/protocol: 公共协议、能力、错误、版本
    core/              # @she/core: 实体/状态机/策略/端口，纯逻辑
    control/           # @she/control: 编排、调度、队列、任务用例
    store-sqlite/      # @she/store-sqlite: repository 的 SQLite 实现
    gateway-sdk/       # @she/gateway-sdk: channel adapter 契约与 helper
    agent-sdk/         # @she/agent-sdk: agent adapter 契约与 helper
    sandbox-sdk/       # @she/sandbox-sdk: sandbox spec/provider 契约
    client/            # @she/client: 控制面 API 客户端
    cli/               # @she/cli: 运维/初始化/诊断命令
    adapters/
      agent-opencode/  # @she/agent-opencode: 第一执行器适配器
      sandbox-docker/  # @she/sandbox-docker: Docker/rootless provider
  apps/
    control-plane/     # @she/control-plane: control daemon / gateway API 接入
    broker/            # @she/broker: 受信 broker daemon
  tests/
    contract/          # 协议 golden tests / capability tests
    integration/       # adapter + store + control 组合测试
  docs/
```

初期不要为了包数量而拆包。先按上述边界建 workspace；如果某个包在首轮没有独立职责，可以合并，但**依赖方向不能反过来**。

## 6. 控制面与三个平面的协作模型

一次典型任务：

```text
gateway
  → command.invoke(task.submit, actor, conversation, attachments)
  → control
      → policy/ACL 校验
      → topic/task 入队
      → 选择 agent adapter 与 sandbox
      → sandbox.provider.create/start（broker 执行）
      → agent.adapter.create/resume + prompt
      → 订阅 agent events
      → 写入 task/event/artifact 状态
  → gateway receives events/render intents
  → platform adapter sends messages/cards/files
```

关键规则：

- gateway 不直接调用 agent adapter 或 broker；
- agent adapter 不直接调用 gateway；
- sandbox provider 不解析任务内容；
- broker 不接受任意 Docker args，只接受固定规格和策略校验后的操作；
- task 状态的唯一写入者是 control/core；
- 事件必须带 `requestId`、`eventId`、`taskId`、`protocolVersion`，支持幂等、重连和事件游标。

## 7. 与 feishu4dsh 的兼容策略

详见 [compatibility-feishu4dsh.md](compatibility-feishu4dsh.md)。核心原则：

1. **单向依赖**：feishu4dsh → `@she/protocol` / `@she/client`；she 永不依赖 feishu4dsh。
2. **版本化协议**：`gateway.v1`、`agent.v1`、`sandbox.v1` 分别演进；major 不兼容，minor 增加可选能力，patch 修复。
3. **capability 协商**：gateway/agent/broker 启动时交换能力集，未支持的能力自动降级。
4. **语义化渲染**：SHE 返回文本、Markdown、表单、审批、文件、状态等语义块；飞书卡片 JSON 留在 feishu4dsh。
5. **扩展字段隔离**：平台特有信息放在 namespaced `extensions`，不污染 core 领域模型。
6. **契约测试**：protocol 包提供 golden fixtures/conformance kit，两个仓库 CI 都跑。

这样 feishu4dsh 新增飞书功能时，只要实现为新的可选 capability 或扩展字段，SHE 不需要跟随发版即可使用通用能力；需要 SHE 理解的新语义则通过 protocol minor 版本演进。

## 8. 现有 SHE 模块的迁移映射

| feishu4dsh 现有模块 | 新归属 |
|---|---|
| `types/store/service/envelope/returns` | `core` + `store-sqlite` + `control` |
| `opencode/permissions` | `agent-opencode` |
| `worktree` | `core` 的 workspace port + 本地 git provider |
| `bootstrap/runtime` 的领域部分 | `control` / `cli` |
| `command` | `control` 的命令用例（解析器可作为 protocol/control 入口） |
| `sandbox` 的 spec/catalog/package | `sandbox-sdk` + `sandbox-docker` / onboarding 包 |
| `broker/client/server` | `broker` app + `@she/client` 的 broker client |
| `need/onboard` | `cli` / sandbox onboarding |
| bridge 中 `/she` UI 格式化 | 留在 feishu4dsh，通过 gateway protocol 调用 SHE |

迁移时不复制 `bridge.ts`，也不让新 core 依赖 feishu4dsh 的 `config.ts`/`util.ts`。

## 9. 首轮里程碑建议

- **M0 架构与协议冻结**：确认包边界、协议 v1、事件/错误码、capability 模型。
- **M1 core/control 可独立跑**：task/topic/queue/store + 纯测试，不启动飞书/Docker。
- **M2 agent adapter**：OpenCode adapter 接入，任务提交/状态/取消/报告闭环。
- **M3 sandbox/broker**：sandbox spec/provider/broker，先只读状态再生命周期操作。
- **M4 feishu4dsh 薄接入**：通过 `@she/client` 调用控制面，保持 `/she` 行为兼容。
- **M5 多 agent/凭据/model proxy**：在协议稳定后扩展。

## 10. 待确认问题

1. `gateway` 是否只做协议与服务端入口，飞书实现继续完全留在 feishu4dsh？（推荐：是）
2. `broker` 是否从一开始就是独立 daemon？（推荐：是，至少进程/包边界独立）
3. 首期执行器是否只做 OpenCode，dsh adapter 后置？
4. 控制面 API 传输是否采用 Unix socket 上的 JSON-RPC/HTTP + SSE？（推荐：是）
5. 旧 feishu4dsh SHE 数据是否提供一次性迁移工具，还是首期只做全新部署？
6. 是否发布 `@she/protocol` 和 `@she/client` 到私有 npm/registry，还是先通过 git submodule/workspace 联合开发？
