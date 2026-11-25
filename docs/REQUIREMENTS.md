# SHE 项目需求基线

> 日期：2026-11-25
> 状态：v0.1，已确认进入实施
> 项目名：`she`
> 定位：独立 agent control plane

## 1. 产品目标

SHE 管理 agent 的任务、执行器、sandbox、生命周期与协作边界；飞书等频道继续由外部 gateway adapter（首期是 feishu4dsh）负责。

核心链路：

```text
channel adapter / feishu4dsh
        │ gateway protocol
        ▼
SHE control plane
  ├─ core：任务/队列/状态/策略
  ├─ agent adapter：OpenCode（首期）
  └─ sandbox provider/broker：Docker/rootless（后续里程碑）
```

## 2. 必须成立的架构约束

1. 独立仓库、独立发布节奏；包管理器使用 pnpm workspace，语言为 TypeScript ESM。
2. `gateway`、`agent`、`sandbox` 是三个边界平面，不直接承载业务状态机。
3. 任务、队列、路由、调度、策略、状态迁移统一归 `control/core`。
4. `protocol` 是跨项目和跨进程的唯一契约来源。
5. feishu4dsh 只依赖 `@she/protocol`、`@she/client` 等公开包，不依赖 SHE 内部实现。
6. SHE 不依赖 feishu4dsh，不 import 飞书 SDK。
7. core/control 不 import Docker SDK、dsh 宿主类型、SQLite 驱动或飞书 SDK。
8. broker 是唯一持有 Docker socket 的受信服务，独立 daemon 边界。
9. 所有外部调用都有超时、取消、幂等和明确错误码。
10. 核心测试不依赖飞书、Docker、真实凭据或外部网络。

## 3. 功能范围

### 3.1 首期必须实现

- Topic/Task 领域模型与状态机；
- 串行队列、租约、取消、失败/恢复语义；
- 任务提交、查询、列表、取消、报告/产物接口；
- versioned gateway protocol v1；
- capability 协商与错误模型；
- OpenCode agent adapter；
- SQLite 持久化；
- `@she/client` 供 feishu4dsh/CLI 使用；
- SHE control-plane daemon 与 Unix socket API；
- feishu4dsh 只读接入与 `/she` 透传的最小闭环；
- 不依赖外部服务的单元测试与协议契约测试。

### 3.2 后续里程碑

- sandbox spec/provider 与独立 broker daemon；
- sandbox registry、生命周期、inbox/outbox、audit；
- dsh agent adapter；
- model proxy / secret manager；
- 多 agent 角色、委派深度、预算与 fanout 策略；
- 网关 standalone 模式与多 channel adapter。

### 3.3 非目标

- 不在 SHE 中实现飞书卡片/消息 SDK；
- 不复制 feishu4dsh 的 `bridge.ts`；
- 不让 agent 直接访问 Docker socket 或 broker socket；
- 不在首期实现远程公网 API；
- 不在首期实现 Web UI。

## 3.4 PWA 本地控制台与安装体验

产品目标：

- 用户在本机安装 SHE 后，通过 localhost PWA 控制台查看状态、管理 sandbox/agent、配置 workspace 权限、下载软件包并发起安装/更新；
- PWA 是本地 CLI/控制面的 UI，不复制业务逻辑，不成为第二状态源；
- 软件包安装/更新必须经用户显式确认，校验来源与 checksum，显示影响和回滚入口；
- 浏览器不得直接获得 Docker socket、root 权限或系统安装权限；安装动作由本地受限 installer/broker 执行；
- 用户在本地页面可与 sandbox 内 agent 讨论、布置任务、查看报告和产物；
- 可选的 gateway 通过飞书等 channel adapter 提供远程访问，并与本地页面共用同一控制面状态。

验收方向：

- 无云后端时 PWA 可打开和管理本地 SHE；
- 页面展示的数据来自 control plane API，不维护独立任务库；
- 软件包下载/安装/更新有 checksum、权限确认、日志和失败回滚；
- workspace 只允许显式授权的叶子目录；
- gateway 配置不向 agent 暴露飞书 secret；
- PWA 不可用或离线时，CLI/control API 仍可完成核心操作。

## 3.5 操作系统与容器运行时

- agent sandbox 镜像按 Linux 设计；Linux 宿主为首期一等公民（优先 Docker rootless）；
- macOS/Windows 通过 Docker Desktop/WSL2/Colima/OrbStack 等提供 Linux 容器运行时，但路径、权限、socket、cgroup 行为不同，必须由平台 provider 吸收；
- 不对“所有操作系统开箱即用”作承诺；支持矩阵区分已验证、理论可用和未支持；
- Docker endpoint、宿主路径映射、UID/GID/ACL、symlink/大小写/可执行位等差异不得进入 core；
- broker 是 Docker socket 的唯一持有者，PWA 与 agent 均不得直接访问。

## 4. 质量门禁

每个任务完成必须满足：

- `pnpm typecheck` 通过；
- `pnpm test` 通过；
- 新增/变更的协议有类型与负例测试；
- 不引入禁止的依赖方向；
- 文档与实现同步；
- 破坏性协议变化必须更新兼容矩阵和迁移说明。

## 5. 里程碑与验收

### M0 仓库与协议基线

验收：

- pnpm workspace 可安装、构建、测试；
- `@she/protocol` v1 基础类型、版本和 capability 模型完成；
- `@she/core` 领域实体与基础状态机完成；
- gateway/agent/sandbox SDK 公开契约骨架完成；
- 任务需求单与执行清单可追踪。

### M1 控制面核心

验收：

- Topic/Task 串行队列与状态机可独立测试；
- SQLite repository 可持久化/恢复；
- 任务提交、查询、取消的最小用例闭环；
- 事件存储与 cursor 语义完成；
- fake agent adapter 跑通无外部依赖的任务闭环。

### M2 OpenCode 执行器

验收：

- OpenCode adapter 通过 fake HTTP 测试；
- session create/resume、prompt、status、cancel、报告路径完成；
- 任务失败/中断/超时都可回收；
- 不依赖真实凭据。

### M3 sandbox/broker

验收：

- `SandboxSpec`/provider 契约完成；
- broker 独立 daemon，Unix socket + 0600；
- registry/audit、fixed template、生命周期的只读和写操作测试；
- worker 不持有 Docker/broker socket；
- 路径逃逸、symlink、越权负例通过。

### M4 feishu4dsh 薄接入

验收：

- feishu4dsh 能依赖 `@she/client` 完成 handshake/health；
- `/she` 命令透传；
- RenderIntent → 飞书消息/卡片/文件映射测试；
- SHE 不可达/版本不兼容有明确提示；
- 旧 `secretary` 实现仍可回滚。

### M5 多 agent 与凭据

验收：

- 至少两个 agent adapter 可注册和选择；
- 角色/调用关系/深度/fanout/预算策略有测试；
- model proxy/secret 边界设计完成；
- 升级/回滚与审计文档完成。

### M6 PWA 本地控制台与安装/更新体验

验收：

- localhost PWA 可安装/打开，展示控制面健康状态；
- sandbox/workspace/tasks/agent 只读面板完成；
- 软件包目录、checksum 校验、显式确认安装/更新与日志完成；
- workspace 只读/读写授权页完成，且 broker 强制边界；
- agent 对话/任务/报告/产物页完成；
- gateway 配置页只做受控配置，不向 agent 暴露 secret；
- Linux 支持矩阵明确，macOS/Windows 适配状态明确。

## 5.1 发布兼容矩阵

发布列车：

```text
SHE            0.1.x
@she/protocol  0.1.x
@she/client    0.1.x
wire protocol  gateway.v1
```

| SHE | @she/protocol | @she/client | gateway protocol | feishu4dsh | 状态 |
|---|---|---|---|---|---|
| 0.1.x | 0.1.x | 0.1.x | v1 | 待接入 | 开发中 |

规则：

- protocol/client 同发布列车，wire protocol 独立版本；
- feishu4dsh 首期锁定 `~0.1.x`；
- feishu4dsh 主分支禁止 `file:`/本机绝对路径依赖；
- 联调使用 `pnpm pack` tarball，正式依赖必须 semver；
- 两仓库 CI 引用同一套 protocol golden fixtures；
- major/不兼容变化必须显式拒绝连接并更新矩阵。

## 6. 关键风险

| 风险 | 缓解 |
|---|---|
| feishu4dsh 与 SHE 协议漂移 | 共享 `@she/protocol` + golden fixtures + 兼容矩阵 |
| core 被平台细节污染 | 依赖方向检查、review 清单、包边界 |
| broker 权限过大 | 独立 daemon、固定模板、actor 认证、负例测试 |
| 旧 SHE 数据迁移破坏 | 后续提供一次性迁移工具与备份/回滚说明 |
| 过早拆包导致维护成本 | 先按逻辑边界建包，无独立职责的包可延后拆分 |
