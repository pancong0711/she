# 软件包、运行时与依赖目录

> 状态：T6.4f 首版完成
> 代码：
> - `apps/companion/server.mjs` → `packageCatalog()`
> - `apps/pwa/src/App.vue` → Packages 页面
> - `docs/PACKAGES.md`

## 1. 目标

Packages 页面不只显示版本号，还要回答三个问题：

1. 当前是否已安装/可用？
2. 它用于哪个 SHE 能力？
3. 缺少时用户应该怎么安装或修复？

原则：

- SHE 托管组件可以通过白名单操作安装/更新；
- 基础系统工具只展示安装方法，由用户本人执行；
- 不执行 sudo，不请求 root；
- 不把 Docker 组权限伪装成 rootless；
- 安装命令可复制，但不会被浏览器静默执行。

## 2. 依赖分层

### SHE 托管组件

| ID | 组件 | 作用 | 管理方式 |
|---|---|---|---|
| `she-companion` | SHE Companion | PWA host、本地 API、core 启停 | checksum-verified launcher |
| `she-core` | control-plane + broker | Tasks、Chat、sandbox broker | Core 更新流程 |

### 基础运行时

| ID | 依赖 | requirement | 作用 |
|---|---|---|---|
| `node-runtime` | Node.js `^22.19.0 || >=24.0.0` | required | companion/core/worker |
| `pnpm-runtime` | pnpm `>=11.22.0` | required | 源码构建、依赖安装 |
| `shell-runtime` | bash（POSIX）/ PowerShell（Windows） | required | run-core 与安装脚本 |
| `curl-runtime` | curl | required | launcher 下载 manifest/bundle |
| `tar-runtime` | tar | required | 解压 bundle |
| `checksum-runtime` | sha256sum / shasum / Get-FileHash | required | SHA-256 校验 |
| `git-runtime` | git | recommended | 源码克隆/更新 |
| `node-bootstrap-tools` | npm / corepack | optional | pnpm 用户级安装备选路径 |

### 容器与 agent 运行时

| ID | 依赖 | requirement | 作用 |
|---|---|---|---|
| `docker-runtime` | Docker Engine/Desktop 或 rootless Docker | sandbox | Sandbox、broker 容器、Agent Migration |
| `opencode-runtime` | OpenCode CLI/service | optional | Agent Worker、PWA Chat 实际执行 |

Docker 不是 companion/core/Tasks 的 required 依赖。缺少 Docker 时基础控制面仍可工作，但 Sandboxes、Agent Migration、broker 容器不可用。

## 3. API

```text
GET /api/packages
```

每项返回状态、版本、用途、requirement 和安装说明。示例：

```json
{
  "id": "docker-runtime",
  "name": "Docker / sandbox runtime",
  "state": "missing",
  "requirement": "sandbox",
  "requiredFor": ["Sandbox", "broker 容器", "Agent Migration"],
  "installedVersion": null,
  "management": "instructions-only",
  "note": "Docker 不可用。基础 companion/core/Tasks 不受影响，但 Sandbox 和 Agent Migration 不可用。",
  "install": {
    "mode": "instructions-only",
    "title": "安装 Docker Engine 或 rootless Docker",
    "commands": [
      "# 由你本人按官方文档安装 Docker Engine 或 rootless Docker",
      "# https://docs.docker.com/engine/install/",
      "docker version"
    ],
    "url": "https://docs.docker.com/engine/install/",
    "note": "SHE 不执行 sudo、不安装 Docker、不请求 root。"
  }
}
```

平台相关命令由 companion 根据 `process.platform` 生成。Windows 若使用 Docker Desktop 的 WSL2 backend，还需要用户本人在 Docker Desktop 中启用 WSL2：

- Linux：apt 示例、Docker Engine/rootless 官方文档；
- macOS：Homebrew、Docker Desktop、Xcode Command Line Tools；
- Windows：winget、PowerShell、Docker Desktop / WSL2。

## 4. PWA 行为

Packages 页面现在显示：

- 安装状态和版本；
- `requirement` 与用途；
- 安装/修复说明；
- 可复制的命令块；
- 官方文档链接；
- 已支持的白名单操作（launcher、Core 更新、pnpm bootstrap）。

缺失项使用警示边框；命令块不会自动执行。

## 5. 为什么还有命令而不是全部自动安装

系统级依赖面临发行版差异、管理员权限、Docker Desktop/rootless 前置、虚拟化/WSL2 配置、许可与回滚问题。因此当前策略是：

```text
检测 → 解释用途/影响 → 提供平台化方法 → 用户本人执行 → 重新检测
```

后续可以增加显式确认的系统安装向导，但仍需遵守 ADR-0002：不执行 sudo、不请求 root。

## 6. 验收

- [x] 12 个依赖/组件条目（Windows 的 WSL2 作为 Docker Desktop 前置单独说明）；
- [x] required/recommended/sandbox/optional 分类；
- [x] Docker 缺失时显示安装方法和影响；
- [x] Node/pnpm/git/bash/curl/tar/SHA-256 显示安装/验证命令；
- [x] OpenCode 作为外部 agent runtime 单独列出；
- [x] PWA 命令复制与官方文档链接；
- [ ] Windows/macOS 真机安装向导；
- [ ] 系统包安装审计与自动回滚。
