# ADR-0005：SHE App Shell、Launcher 与 Core 三层发布模型

> 日期：2026-11-27
> 状态：已采纳；P0–P2 已实现基础能力，P3/P4 持续收敛
> 关联：ADR-0001、ADR-0003、ADR-0004
> 背景：companion 实际承担了 PWA host、代理、环境安装、更新器和多项业务 API，
> 已不再是一个低频稳定层。需要把“稳定启动器”和“经常变化的 app shell”分开。

## 1. 结论

SHE 应采用三层，而不是把 `companion` 当作稳定层：

```text
Launcher（很少变）
  │ 首次安装、启动、自动检查更新、supervisor、回滚
  ▼
SHE App Shell（中等频率变化）
  │ companion server + bundled PWA
  │ 本机 HTTP、静态 UI、代理、环境检查、安装/更新协调、配置入口
  ▼
SHE Core（高频变化）
  │ control-plane + broker + agent/sandbox adapters
  │ task/session/queue/store、Docker、agent runtime、gateway 业务
```

一句话：

> **稳定的是 launcher；companion 不是稳定层，而是可更新的 app shell；
> core 是更高频的业务运行时。**

旧 ADR-0001 的“stable companion + updatable core”表述应理解为
“stable launcher / updatable app shell / updatable core”。

## 2. 当前代码与真实职责

### 2.1 Launcher

位置：

```text
apps/companion/launcher.mjs
```

职责：

- 首次安装 app；
- 启动 `current/apps/companion/server.mjs`；
- 识别退出码 75 并重启；
- 启动窗口内失败回滚；
- 启动时检查 app manifest；
- 稳定入口不随 app bundle 更新。

这是**低频层**。`start.sh` / `start.bat` / `start.command` / `start.ps1`
只是首次安装与恢复入口；安装后应直接启动本地 launcher，不应每次重新下载。

### 2.2 App Shell（当前命名为 companion）

位置：

```text
apps/companion/
apps/pwa/
```

companion server 当前实际负责：

- 绑定 `127.0.0.1:8787`，serve `apps/pwa/dist`；
- 代理 `/v1/*` 到 control-plane、`/broker/v1/*` 到 broker；
- CORS / PNA / 本地写操作保护；
- 环境 preflight、依赖检查、allowlisted jobs；
- app/core 更新检查与安装协调；
- core 进程启停、supervisor 状态；
- 登录自启动；
- worker/workspace/sandbox preference/gateway/Feishu gateway 等配置 API；
- 本机 agent 发现、迁移计划和迁移 job；
- 内置 Feishu gateway 子进程管理。

这些职责导致 app shell 频繁变化。它是可更新的本地应用外壳，不应承担
业务状态机，也不应被描述成低频稳定组件。

### 2.3 Core

当前 core bundle 包含：

```text
apps/control-plane/     # gateway.v1 server、TaskService、worker
apps/broker/            # 唯一 Docker socket owner、sandbox lifecycle/exec
packages/control, core, store-sqlite, adapters/agent-opencode ...
```

职责：

- task/topic/queue/lease/event；
- agent session/prompt/event；
- sandbox lifecycle；
- 业务数据持久化与迁移；
- control-plane/broker socket。

core 是高频发布层，更新不依赖 app shell 重新安装。

### 2.4 PWA

`apps/pwa` 是 Vue 静态 UI。当前有两个运行形态：

```text
本地 app 模式：由 companion 从 bundle 内 apps/pwa/dist 提供（canonical）
GitHub Pages：独立部署，用于安装引导和连接本地 companion
```

因此 PWA 源码虽然独立，但本地 app 模式下与 companion 同一个 app release。
修改 PWA 需要发布新的 app shell bundle；这是可接受的，但必须明确。

## 3. 当前架构问题

### 3.1 “companion 是稳定层”的口径与实现不一致

companion 有约 2,400 行 server 和 20 多个本地 API，包含 UI、环境、更新、
诊断和业务配置。它必然频繁变化。真正低频的是 launcher。

### 3.2 启动入口仍是网络优先

旧 start 脚本每次执行都会拉 manifest/launcher。用户双击桌面的应用入口时，
不应该依赖网络下载启动器。正确顺序应是：

```text
本地 launcher 存在 → 直接运行 launcher
launcher → 检查远程 manifest / 环境 → 需要时更新
launcher 不存在 → 才走首次安装 bootstrap
```

### 3.3 PWA 有双份版本，但缺少明确的产品归属

`PWA build version` 目前与 companion release version 绑定，但 GitHub Pages
又独立部署同一份 UI。需要明确：

- 本地 app 内 PWA 是产品主 UI；
- Pages 是安装入口/远程控制入口；
- 两者 API 兼容必须走 `companion-api.v1` capability，而不是按版本硬编码。

### 3.4 companion 承担了过多业务层职责

以下能力更适合由 core/broker 或外部 gateway 承担：

- 内置 Feishu gateway 进程；
- workspace 授权策略；
- agent 发现/迁移的最终执行策略；
- sandbox preference 的业务校验；
- worker/openCode 配置解释。

companion 应保留“本机应用外壳”职责：UI host、代理、更新、环境、配置录入、
状态展示；需要业务原子性的操作应通过 core/broker 的公开 API 完成。

### 3.5 路径模型不够“app 文件夹化”

当前已经实现统一 `SHE_HOME`：

```text
Linux/macOS: ${XDG_DATA_HOME:-~/.local/share}/she
Windows:     %LOCALAPPDATA%\SHE
```

旧 `companion` / XDG config/state 路径仍通过兼容检测保留可运行。PWA Settings
提供 `SHE_HOME` 状态与“复制旧目录到 SHE_HOME”按钮，CLI 为：

```sh
pnpm home:migrate
node scripts/migrate-she-home.mjs --apply
```

## 4. 目标目录模型

建议：

```text
SHE_HOME/
  launcher.mjs                 # 稳定入口（低频）
  bin/she                      # 用户命令
  app/
    current -> versions/<app-version>
    versions/<app-version>/
      apps/companion/
      apps/pwa/dist/
  core/
    current -> versions/<core-version>
    versions/<core-version>/
      run-core.sh
      control-plane.mjs
      broker.mjs
  config/                      # 0600 凭据/配置
  state/                       # SQLite、日志、cursor
  workspaces/                  # 用户授权 workspace 根
  staging/
  state.json
```

路径解析建议：

```text
Linux/macOS: $SHE_HOME 或 ${XDG_DATA_HOME:-~/.local/share}/she
Windows:     %SHE_HOME% 或 %LOCALAPPDATA%\SHE
```

迁移策略：

1. 先引入 `SHE_HOME` 解析，但保留旧路径只读兼容；
2. 首次启动检测旧布局，展示迁移计划，不在运行中静默搬移；
3. 新安装只使用新布局；
4. 迁移失败保留旧目录并明确回滚。

## 5. 启动与更新职责

### 5.1 start 脚本

- 仅负责：定位安装目录、检查 Node 基础可用性、启动本地 launcher；
- 本地 launcher 不存在或损坏时才下载 bootstrap；
- 不再每次执行都下载 launcher；
- 提供 `SHE_FORCE_LAUNCHER_REFRESH=1` 用于修复 launcher；
- 不直接启动 core，不直接替换 app。

### 5.2 launcher

- 读取 app manifest；
- 比较本地 app 版本；
- 首次安装或更新 app；
- 检查/启动 core；
- 管理 app 进程、退出码 75、启动失败回滚；
- 可把 core 更新委托给 app shell（页面操作）或自身启动前检查。

### 5.3 app shell / companion

- serve bundled PWA；
- 代理 core/broker；
- 提供环境 preflight、依赖安装、配置、日志；
- 在 PWA 页面提供 app/core 更新入口；
- 不直接持有 task/session/queue/sandbox 业务状态；
- 业务操作调用 core/broker 公开 API。

### 5.4 core

- 任务、队列、会话、事件、数据库迁移；
- agent runtime；
- sandbox lifecycle/exec；
- 可选的外部 gateway 进程或独立 gateway adapter；
- 通过稳定 `run-core` 入口被 launcher/app shell 启动。

## 6. 更新频率与渠道

| 层 | 典型变化 | 发布方式 | 更新入口 |
|---|---|---|---|
| start 脚本 | 极少 | Pages 静态文件 | 手动/安装器 |
| launcher | 很少 | app manifest | 启动时自检或强制刷新 |
| app shell + bundled PWA | 中等 | app release bundle | PWA/Settings、launcher |
| core | 高频 | core release bundle | PWA/Settings、可选启动前检查 |
| GitHub Pages PWA | 部署入口/远程 UI | Pages workflow | 浏览器缓存/SW |

不建议把 PWA 单独作为第三个必须同步的本地更新单元；在当前阶段应与 app shell
同版本发布，避免 UI/本地 API skew。未来如果 PWA 需要独立于 app shell 高频更新，
再引入版本化的静态 UI bundle 与 capability 协商。

## 7. 迁移步骤

### P0：修正入口语义（低风险）

- `start.sh/.command/.ps1/.bat` 本地 launcher 优先；
- 只有首次安装/强制修复才走网络 bootstrap；
- 增加回归测试。

### P1：文档与命名

- 把 companion 对外描述为 SHE App Shell；
- 保留代码目录 `apps/companion` 以降低迁移成本；
- 明确 launcher 才是稳定层；
- 更新 ADR-0001 的引用关系。

### P2：路径统一

- 引入 `SHE_HOME`；
- 统一 app/core/config/state/workspaces；
- 提供一次性迁移命令和回滚；
- Windows 与 Linux/macOS 使用同一套解析规则。

### P3：职责收敛（进行中）

- 内置 Feishu gateway 已标记 legacy，新部署应使用 feishu4dsh standalone gateway；
- workspace/broker host mount 的最终安全校验由 broker 执行；
- companion 的 workspace 授权列表保留为 UI 确认与迁移入口；
- 后续把更多业务策略下沉 core/broker，App Shell 只保留 UI host、proxy、环境、
  安装更新和状态展示。

### P4：更新可见性（基础完成）

- launcher 启动时检查 app manifest；
- App Shell 提供 `GET /api/updates/status`，统一检查 App 与 Core manifest；
- PWA Settings 显示 App/Core 当前版本、可用版本和是否需要更新；
- core 的实际安装仍在用户确认后执行，避免启动时无提示替换运行时。

## 8. 不改变的东西

- `gateway.v1` / `agent.v1` / `sandbox.v1` 公开协议；
- broker 是唯一 Docker socket owner；
- app/core 更新都必须 SHA-256 校验；
- 不在运行中覆盖当前版本目录；
- 不请求 root；
- PWA 不直接杀进程或写运行中 app/core 文件。

## 9. 已确认

1. companion 是可更新 **App Shell**，launcher 才是稳定层；
2. `SHE_HOME` 统一承载 app/core/config/state/run/bin/workspaces，旧布局兼容并可复制迁移；
3. 内置 Feishu gateway 已进入 legacy/退役路线，新部署使用 feishu4dsh standalone gateway；
4. App Shell 更新可由 launcher 启动时自动检查，core 更新由页面显式确认后执行。
