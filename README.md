# she

`she` 是独立的 agent control plane 项目。

它的职责是管理 agent **怎么跑、在哪里跑、和谁协作、用什么凭据**，而不是实现某个聊天平台。飞书通道继续由 `feishu4dsh` 负责；`she` 通过版本化协议与其薄适配层协作。

## 初始原则

- 独立仓库、独立发布节奏；
- 协议优先：`feishu4dsh` 只依赖 `she` 的公开协议/客户端，`she` 不反向依赖 `feishu4dsh`；
- gateway、agent、sandbox 是三个边界平面，不是三个互不相干的业务模块；
- 任务、队列、路由、策略和状态机统一归控制面核心，避免泄漏到 gateway/agent/sandbox；
- 飞书 SDK、dsh 宿主类型、Docker socket 都不进入核心包；
- 先实现可独立测试的 core/control，再接 adapter 与 broker。

## 仓库结构

```text
packages/
  protocol/       # 公共协议、版本、capability、错误模型
  core/           # 领域实体与任务/Topic 状态机
  gateway-sdk/    # channel adapter 契约
  agent-sdk/      # agent runtime adapter 契约
  sandbox-sdk/    # sandbox provider 契约
  client/         # 供 feishu4dsh/CLI 使用的公开客户端（后续实现）
  control/        # 控制面用例与编排（后续实现）
  store-sqlite/   # SQLite 持久化（后续实现）
  cli/            # CLI（后续实现）
  adapters/
    agent-opencode/
    sandbox-docker/
apps/
  control-plane/  # control daemon（后续实现）
  broker/         # sandbox broker daemon（后续实现）
```

## 开发命令

```sh
pnpm install
pnpm typecheck
pnpm test
```

当前进度：M0 基线完成；M1 完成（core/control、队列与租约、SQLite 持久化、TaskRunner + fake agent 闭环）；T4.0–T4.1 完成（feishu4dsh 对齐、`@she/client`）。

## 文档

- [初始架构评审](docs/architecture-review.md)
- [与 feishu4dsh 的兼容边界](docs/compatibility-feishu4dsh.md)
- [feishu4dsh 接入 SHE：设计与版本依赖说明](docs/feishu4dsh-integration.md)
- [需求基线](docs/REQUIREMENTS.md)
- [任务执行单](docs/TASKS.md)
- [已确认决策](docs/DECISIONS.md)
- [产品愿景与形态](docs/PRODUCT-VISION.md)
- [对 feishu4dsh 评审的回复](docs/20261125-feishu4dsh-review-response.md)
- [Topic 串行队列与任务租约](docs/QUEUE-LEASE.md)
- [SQLite 持久化存储](docs/STORE-SQLITE.md)
- [任务执行器与 fake agent 闭环](docs/TASK-RUNNER.md)
- [公开包打包与发布](docs/PUBLISHING.md)
- [Control-plane gateway.v1 server](docs/CONTROL-PLANE-SERVER.md)
- [OpenCode agent adapter](docs/OPENCODE-ADAPTER.md)
- [部署命名与本地约定](docs/DEPLOYMENT.md)
- [对 feishu4dsh 第二轮反馈的回复](docs/20261125-feishu4dsh-feedback-response.md)

## 状态

M0/M1/M2 完成；T4.1a/T4.1b 完成（公开包、gateway.v1 server、OpenCode adapter）。下一步 M3 sandbox/broker。PWA 与跨平台控制台列入 M6。
