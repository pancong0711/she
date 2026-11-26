# she

`she` 是独立的 agent control plane 项目。

**在线 PWA**：<https://pancong0711.github.io/she/>（静态安装/引导页，可连接本机 SHE companion）

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

当前进度：M0 基线完成；M1 完成（core/control、队列与租约、SQLite 持久化、TaskRunner + fake agent 闭环）；T4.0–T4.1 完成（feishu4dsh 对齐、`@she/client`）；PWA 已接入 Agent Worker/Chat 与本机 AI agent 容器化迁移工作台。

## PWA 本地控制台

也可以直接在 PWA 中下载：

```text
start.bat       # Windows
start.command   # macOS
start.sh        # macOS/Linux
```

这些 launcher 会下载 checksum-verified companion bundle、安装到用户目录并启动本地页面。

```sh
# 可选：开发态用户级检查/安装 pnpm（不请求 root）
bash scripts/bootstrap-user.sh --check
bash scripts/bootstrap-user.sh --install-pnpm

pnpm pwa:build
pnpm companion
# 或兼容别名：pnpm pwa:serve
# http://127.0.0.1:8787

# core bundle（供 companion 更新使用）
pnpm build:core
bash scripts/install-core-bundle.sh artifacts/core/she-core-0.1.0.tar.gz --core-root ~/.local/share/she/core
```

- 本地同源模式：`http://127.0.0.1:8787`
- GitHub Pages 静态 PWA：`https://pancong0711.github.io/she/`
- Pages 页面连接本地 companion：`http://127.0.0.1:8787`

本地 PWA host 只绑定 loopback，并将 `/v1/*` 代理到 control-plane Unix socket。

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
- [0.1.0 公开包 Release](docs/RELEASE-0.1.0-PACKAGES.md)
- [对 feishu4dsh 下一步建议的回复](docs/20261125-feishu4dsh-next-steps-response.md)
- [SHE core bundle 0.1.0](docs/RELEASE-0.1.0-CORE.md)
- [SHE companion bundle 0.1.0](docs/RELEASE-0.1.0-COMPANION.md)
- [Control-plane gateway.v1 server](docs/CONTROL-PLANE-SERVER.md)
- [OpenCode agent adapter](docs/OPENCODE-ADAPTER.md)
- [Sandbox Broker 与 Docker provider](docs/SANDBOX-BROKER.md)
- [M4 feishu4dsh 薄接入设计](docs/M4-FEISHU4DSH-THIN-ADAPTER.md)
- [从 secretary 迁移](docs/MIGRATION-FROM-SECRETARY.md)
- [PWA 本地控制台](docs/PWA.md)
- [ADR-0001：稳定 companion + 可更新 core](docs/ADR-0001-companion-core-split.md)
- [Companion ↔ Core 契约 v1](docs/COMPANION-CORE-CONTRACT.md)
- [环境检查与安装边界](docs/ENVIRONMENT-BOOTSTRAP.md)
- [Agent Worker 与 PWA Chat](docs/AGENT-WORKER.md)
- [AI Agent 本机发现与容器化迁移](docs/AGENT-MIGRATION.md)
- [软件包、运行时与依赖目录](docs/PACKAGES.md)
- [Docker 安装方法](docs/DOCKER-INSTALL.md)
- [平台能力与支持矩阵](docs/PLATFORM-SUPPORT.md)
- [Workspace 授权与叶子目录策略](docs/WORKSPACES.md)
- [SHE companion 0.2.0 发布说明](docs/RELEASE-0.2.0-COMPANION.md)
- [SHE companion 0.2.1 发布说明](docs/RELEASE-0.2.1-COMPANION.md)
- [ADR-0003：页面请求、supervisor 执行的 companion 更新](docs/ADR-0003-supervised-companion-update.md)
- [Companion 登录自启动](docs/AUTOSTART.md)
- [SHE companion 0.3.0 发布说明](docs/RELEASE-0.3.0-COMPANION.md)
- [SHE companion 0.3.1 发布说明](docs/RELEASE-0.3.1-COMPANION.md)
- [SHE companion 0.3.2 发布说明](docs/RELEASE-0.3.2-COMPANION.md)
- [ADR-0002：不请求、不执行 root](docs/ADR-0002-no-root-privilege-policy.md)
- [部署命名与本地约定](docs/DEPLOYMENT.md)
- [对 feishu4dsh 第二轮反馈的回复](docs/20261125-feishu4dsh-feedback-response.md)

## 状态

> 开发中基线：接口、协议、sandbox/broker 安全边界仍在迭代，暂不建议用于生产环境。

M0–M3 完成；M4 SHE 侧完成；M6 PWA 骨架与只读 Dashboard/Tasks 完成；下一步 T6.3 sandbox/agent 只读面板与 feishu4dsh 实际接入（T4.6）。
