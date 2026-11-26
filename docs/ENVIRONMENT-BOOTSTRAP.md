# 环境检查与安装边界

> 日期：2026-11-25
> 状态：preflight 硬门禁已实现；系统 runtime 自动安装尚未实现
> 代码：
> - `apps/companion/server.mjs`
> - `apps/pwa/src/App.vue`
> - `docs/PWA.md`

## 1. 结论

**安装执行前必须检查环境。**

当前已实现：

- `doctor` 环境检查；
- `install` 执行前强制 preflight；
- preflight 不通过时立即中止安装，避免半安装状态；
- PWA 实时显示每一项检查结果和失败原因。

但当前自动安装的范围仍有限：

```text
已自动执行：
  pnpm install --frozen-lockfile
  构建 PWA / 全部构建
  运行测试

未自动安装：
  Node.js
  pnpm
  git
  Docker / rootless Docker
```

这些 runtime 的首次安装仍需用户显式操作。若某项安装/配置需要 root（典型如系统 Docker、rootless Docker 初始化、把用户加入 docker 组），SHE 只展示官方方法，不执行、不请求 root 权限。

未来 T6.4c 只自动化**无需 root 的用户级安装**；需要管理员权限的步骤仍由用户自行完成。

## 2. 当前 preflight 检查项

| 检查 | requirement | 失败级别 | 缺失影响 |
|---|---|---|---|
| user 非 root | required | fail | 阻断 |
| Node.js `^22.19.0 || >=24.0.0` | required | fail | 阻断 |
| pnpm `>=11.22.0` | required | fail | 阻断 |
| git | recommended | warn | 源码克隆/更新降级 |
| Docker sandbox runtime | sandbox | warn | Sandbox、Agent Migration、broker 容器不可用 |
| control-plane/broker/PWA build | development | warn | 开发态构建不完整 |
| control/broker socket | runtime | warn | 对应运行时未启动 |

规则：

- `fail` = 阻断基础安装/构建；
- `warn` = 动作可以成功，但对应能力不可用，必须显示 `feature` 和 `remediation`；
- Docker **不是 companion/core/普通 Chat 的 required 项**，但它是 sandbox/broker/Agent Migration 的 sandbox 能力依赖；
- `doctor` 作为只读检查；`install` 自动执行同一 preflight，不能绕过。

`GET /api/preflight` 返回：

```json
{
  "ok": true,
  "sandboxReady": false,
  "summary": { "requiredReady": true, "sandboxReady": false, "warnings": 3, "failures": 0 },
  "checks": [
    {
      "type": "check",
      "status": "warn",
      "label": "Docker sandbox runtime",
      "requirement": "sandbox",
      "feature": "sandbox",
      "detail": "docker 命令不存在或不在 PATH 中；Sandbox、Agent Migration 和 broker 容器能力不可用。",
      "remediation": "由你本人安装 Docker Engine 或 rootless Docker..."
    }
  ]
}
```

`ok=true` 只表示 required toolchain 可用；`sandboxReady=false` 表示容器能力不可用。

## 3. 安装流程

```text
源码开发时用户点击“安装源码依赖”
  → companion POST /api/jobs { kind: install }
  → runPreflight()
  → 若有 fail：
       中止
       事件流显示失败项
       exitCode=1
  → 若通过：
       pnpm install --frozen-lockfile
       实时输出 stdout/stderr
       成功/失败状态
```

PWA 的实时日志会显示：

```text
[ok] Node.js v22.19 ...
[ok] pnpm 11.22.0 ...
[warn] Docker ...
[system] preflight passed
[stdout] ...
```


## 4. 为什么不自动安装 Node/pnpm/git/Docker

纯 PWA/浏览器无法安装系统软件。companion 虽然能执行本地命令，但系统级安装需要：

- 平台判断（Linux/macOS/Windows）；
- 包管理器差异（apt/dnf/brew/winget）；
- 管理员权限；
- 虚拟化/Docker Desktop 或 rootless 前置；
- 明确的用户同意；
- 安装失败回滚。

因此当前策略是：

1. 先检测并解释缺口；
2. 不静默 sudo；
3. 后续提供平台特定 bootstrap/installer；
4. 系统级安装必须显式确认并记录审计。

## 5. 已实现的用户级 bootstrap

脚本：

```text
scripts/bootstrap-user.sh     # Linux/macOS
scripts/bootstrap-user.ps1    # Windows
```

用法：

```sh
bash scripts/bootstrap-user.sh --check
bash scripts/bootstrap-user.sh --install-pnpm
bash scripts/bootstrap-user.sh --install-deps
```

行为：

- 以 UID 0 运行直接拒绝；
- Node.js 缺失/版本过低：只提示用户自行安装，不请求 root；
- pnpm 缺失或版本不匹配：优先 corepack，其次 npm `--prefix "$HOME/.local"` 用户级安装；
- `--install-deps` 只执行 `pnpm install --frozen-lockfile`；
- git/Docker 缺失只告警并给出“由用户自行安装”的提示；
- 不执行 sudo，不安装 Docker/rootless，不建容器。

PWA 中对应 job：

```text
bootstrap
```

按钮：

```text
用户级环境准备（不请求 root）
```

执行后会再次跑 preflight，并实时显示结果。若 Docker 缺失，job 仍可能以 `succeeded (exit 0)` 结束，因为 pnpm bootstrap 本身成功；但界面必须额外显示 `sandboxReady=false` 和 Docker 安装/启动指引。

## 6. 计划中的系统级 bootstrap

### Linux

- 检测发行版/架构；
- 检查 Node/pnpm/git/Docker/rootless；
- 优先使用用户级安装（如 Node 官方二进制、corepack）避免系统污染；
- Docker/rootless 初始化需要 root 的步骤只展示官方方法，不代替用户执行；
- rootless Docker 若已由用户/管理员配置好，SHE 只做检测和使用；
- 安装包 checksum + 版本锁定。

### macOS

- 检测 Homebrew/Docker Desktop/OrbStack/Colima；
- Node/pnpm 可用用户级版本管理器或官方安装包；
- 路径/权限/VM 差异由平台 provider 处理。

### Windows

- 检测 WSL2/Docker Desktop；
- Node/pnpm 用户级安装；
- Docker Desktop 需显式安装/授权；
- 路径、named pipe、权限差异由平台 adapter 处理。

## 7. 一键 launcher

PWA 直接提供 `start.bat` / `start.sh` / `start.command` 下载：

- `start.bat`：Windows 双击后自动下载并运行 PowerShell launcher；
- `start.ps1`：校验 manifest/bundle SHA-256，安装 companion 到 `%LOCALAPPDATA%`，启动并打开浏览器；
- `start.command` / `start.sh`：macOS/Linux 下载并运行 shell launcher；
- companion 安装到用户目录，不请求 root。

浏览器不能静默执行下载的文件，因此仍需用户下载后双击/运行一次；这是浏览器安全边界，而不是 SHE 缺失的功能。

## 8. 首次启动仍需一次本机操作

目前 GitHub Pages PWA 不能自行拉起 companion。首次使用需要：

```sh
git clone https://github.com/pancong0711/she.git
cd she
pnpm install
pnpm pwa:build
pnpm companion
```

后续目标是提供：

- 用户可下载的 `she-companion` installer；
- 双击启动；
- companion 自动下载/更新 core bundle；
- PWA 只负责 UI 和确认流程。

## 9. 发布与安全要求

- installer/checksum 必须可验证；
- 不执行任意用户命令；
- 不允许 ping-through 到系统 shell；
- 不把 token 暴露给网页；
- 不执行 sudo / 不请求 root；
- 系统级安装只提供方法，Docker/rootless 初始化由用户本人完成；
- 当前用户可用的 Docker context 可被 SHE 使用，但 docker 组权限的 root-equivalent 风险必须显示；
- 失败保留旧版本和日志；
- 更新过程不得静默进行。

## 10. 验收

- [x] 安装前 preflight 硬门禁；
- [x] Node/pnpm 版本检查；
- [x] git/Docker 状态检查；
- [x] 构建/产物/socket 检查；
- [x] PWA 实时显示检查结果；
- [x] 用户级 pnpm 安装脚本（corepack/npm user prefix）；
- [x] PWA `bootstrap` job；
- [ ] signed companion installer；
- [ ] Docker/rootless 平台安装向导；
- [ ] signed companion installer；
- [ ] 系统安装审计与回滚。
