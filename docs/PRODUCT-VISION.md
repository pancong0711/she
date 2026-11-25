# SHE 产品愿景与形态

> 日期：2026-11-25
> 状态：产品方向确认稿
> 关联：REQUIREMENTS.md、architecture-review.md、feishu4dsh-integration.md

## 1. 一句话产品定义

**SHE 是一个 local-first 的 agent control plane：用户在本机通过 PWA 控制台管理 sandbox、agent、工作区和软件包，在本地与 agent 对话和布置任务；需要远程时，再通过 gateway adapter（首期飞书）接入同一个控制面。**

```text
                本地电脑
┌───────────────────────────────────────────────┐
│  PWA 控制台（浏览器）                          │
│  看状态 / 下软件 / 装更新 / 配权限 / 聊天       │
│              │ loopback HTTP/SSE               │
│              ▼                                 │
│  SHE control plane                            │
│  tasks / sessions / policy / registry          │
│       │                  │                     │
│       │ agent protocol   │ sandbox protocol    │
│       ▼                  ▼                     │
│  main sandbox      sandbox broker             │
│  agent runtime      Docker/rootless 等         │
│       │                                        │
│       └── workspace + 显式只读/读写文件夹       │
│                                                │
│  可选：SHE gateway                             │
│   └── 飞书/钉钉/微信/QQ adapter                 │
└───────────────────────────────────────────────┘
```

## 2. 用户旅程

### 2.1 本地安装与首次使用

1. 用户在自己的电脑上安装 SHE。
2. SHE 启动本地 control-plane 服务与 PWA 控制台。
3. 用户在浏览器打开 localhost 页面，或把 PWA 安装到桌面。
4. 首次运行向导检查：
   - 操作系统与架构；
   - Docker/容器运行时是否可用；
   - 磁盘空间与状态目录；
   - agent 镜像/运行时；
   - 模型访问配置；
   - workspace 根目录。
5. 用户在控制台创建 **main sandbox**：
   - 选择 agent（首期 OpenCode）；
   - 选择镜像和工具包；
   - 选择要挂载给 agent 的宿主文件夹；
   - 为每个文件夹设置只读/读写；
   - 设置网络、CPU/内存/PID 限额。
6. agent 在 main sandbox 内运行，拥有自己的私有 workspace；宿主目录只能是显式授权的叶子挂载。
7. 用户可在本地页面直接与 agent 对话、布置任务、看执行过程、下载产物。

### 2.2 远程使用

1. 用户可选启用 gateway；
2. 首期 gateway 接飞书：使用飞书应用凭据建立出站 WebSocket；
3. 本地不需要暴露公网端口；
4. 用户在飞书里通过 gateway 与同一个 SHE 控制面交互；
5. 后续可增加钉钉、企业微信、微信、QQ 等 channel adapter；
6. gateway 只负责频道协议、ACL、消息/卡片/文件，不实现 SHE 业务状态机。

## 3. PWA 控制台的定位

参考 `2609-assignment-assistant` 的成熟形态：

- **本地 daemon/CLI 是本体，PWA 是 UI**；
- PWA 不复制业务逻辑，只调用本地 control-plane API；
- PWA 有 manifest + service worker，可安装到桌面/主屏；
- 数据保存在本地，默认不引入云后端；
- 实时日志和任务进度走本地 SSE/NDJSON；
- 页面能力必须与 CLI/API 保持 parity，但不把删除、迁移、提权等高危操作做成无确认的一键入口。

参考文档：
- `2609-assignment-assistant/docs/02-pwa-feasibility.md`
- `2609-assignment-assistant/docs/23-D72-pwa-extract-preview.md`
- `2609-assignment-assistant/docs/87-D137-pwa-cli-parity.md`

### 3.1 页面规划

```text
/dashboard       运行状态、健康检查、最近任务
/agents          agent 列表/模型/健康/能力
/sandboxes       main/worker sandbox、资源、挂载、生命周期
/workspaces      宿主文件夹授权、只读/读写、路径校验
/chat            与 agent 对话、任务/报告/产物
/packages        软件包目录、下载、安装、更新、版本与校验
/gateway         飞书等通道配置、连接状态、ACL
/settings        模型、凭据、路径、日志、升级
```

### 3.2 “页面里下载并后台安装/更新”的边界

浏览器/PWA 本身**不能**直接执行系统安装命令、访问 Docker socket 或静默提权。正确形态是：

```text
PWA 按钮
  → 本地 SHE API
  → 安装/更新任务
  → 用户显式确认（权限、版本、来源、影响）
  → broker/installer 在受限权限下执行
  → PWA 显示进度、日志、结果和回滚入口
```

必须遵守：

- 安装包/镜像需要校验 checksum/签名与来源；
- 不自动以 root 执行未经确认的软件包；
- 软件包安装、更新、Docker/运行时的系统级变更需要管理员权限和明确确认；
- 优先使用容器镜像分发 agent 运行时，减少对宿主系统的安装改动；
- PWA UI、control plane、broker/installer 权限分层，页面不能直接持 Docker socket。

## 4. sandbox 与 workspace 模型

- **agent 必须在 sandbox 内运行**（main sandbox 首期，worker/observer/utility 后续）；
- 每个 sandbox 有私有 workspace、home、cache、inbox、outbox；
- 用户可以在页面勾选宿主文件夹并指定只读/读写，但只能挂载具体叶子目录；
- 不挂载父目录、home、Docker socket、SSH key 或未授权的系统路径；
- 权限变更必须经过控制面校验并记录审计；
- agent 不能自行扩大挂载或提权；
- broker 是唯一持有 Docker socket 的受信服务；
- main/worker 之间的文件交换通过受控 inbox/outbox 或 artifact 机制。

## 5. gateway 与通讯软件 adapter

gateway 是可选远程入口，不是核心。

- 首期：SHE gateway + feishu4dsh adapter（飞书）；
- 后续：钉钉、企业微信、微信、QQ 等；
- 所有 adapter 通过同一套 gateway protocol 接入；
- adapter 负责平台连接、ACL、卡片、文件、审批；
- SHE 负责会话路由、任务状态、agent/sandbox 调度；
- 同一用户可通过本地 PWA 或远程 channel 与同一个 agent/session 协作；
- 两个入口共享同一个控制面状态，不维护两套会话数据库。

## 6. Docker、镜像与操作系统

### 6.1 结论

- **SHE 的 agent sandbox 镜像应该是 Linux 镜像**；
- Docker 容器运行的是 Linux 用户态（在 Linux 宿主上直接用内核；在 macOS/Windows 上通过 Linux VM/WSL2）；
- Docker Engine 本身不是跨平台二进制，安装和运行时行为依操作系统不同；
- 因此“镜像跨平台”成立，但“安装与文件权限完全与 OS 无关”不成立。

### 6.2 支持策略

| 宿主 | 首期支持 | 说明 |
|---|---|---|
| Linux + Docker/rootless | 首选/一等公民 | rootless、UID/GID、bind mount 语义最可控 |
| macOS + Docker Desktop/Colima/OrbStack | 后续适配 | Linux VM、文件共享/权限/性能与 Linux 不同 |
| Windows + WSL2/Docker Desktop | 后续适配 | Linux 容器通过 WSL2；Docker socket 是 named pipe；路径翻译不同 |
| Windows 原生容器 | 不支持 | SHE agent 镜像按 Linux 设计 |

需要平台 provider 吸收的差异：

- Docker endpoint：
  - Linux `/var/run/docker.sock` 或 rootless `$XDG_RUNTIME_DIR/docker.sock`；
  - macOS Docker Desktop/Colima/OrbStack 的 socket 路径不同；
  - Windows named pipe/`npipe`。
- 宿主路径映射与权限：Windows 盘符、UNC、WSL 路径、macOS 文件共享权限、Linux UID/GID/ACL；
- 文件时间、inode、symlink、大小写敏感、可执行位差异；
- 资源限制和 cgroup 能力；
- Docker Desktop 的授权/许可与虚拟化要求。

首期实现建议：

1. 先完成当前普通用户可管理的 Docker sandbox provider（已配置的 rootless runtime 优先使用，但不要求 SHE 自行初始化 rootless）；
2. 所有 Docker 操作封装在 `SandboxProvider` 和 broker 内；
3. PWA 通过 provider capability 展示当前系统支持项；
4. macOS/Windows 后续增加平台 adapter，而不是改 core；
5. 在支持矩阵明确“已验证”与“理论可用但未验证”。

## 7. 与 feishu4dsh 的关系

- feishu4dsh 是第一个 channel adapter / 飞书 gateway 实现；
- SHE 不 import feishu4dsh；
- feishu4dsh 依赖 `@she/protocol` / `@she/client`；
- 飞书新增能力通过 capability 和 RenderIntent 暴露；
- SHE 可通过飞书完成远程任务，但本地 PWA 与飞书共享同一个 control plane；
- 详细接入约束见 [feishu4dsh-integration.md](feishu4dsh-integration.md) 和 [20261125-feishu4dsh-review-response.md](20261125-feishu4dsh-review-response.md)。

## 8. 开发优先级

1. M0/M1：protocol、core、control 基础；
2. M2：OpenCode adapter；
3. M3：sandbox/broker（Linux 优先）；
4. M4：feishu4dsh 薄接入；
5. M6：PWA 本地控制台、安装/更新向导、workspace 权限配置、聊天/任务面板；
6. M6+：macOS/Windows provider、其他 channel adapter、model proxy/多 agent 策略。

PWA 不是首期阻塞控制面抽象的模块，但它的数据/API 需求应从 M1 开始进入设计，避免后期为了 UI 重新写业务接口。
