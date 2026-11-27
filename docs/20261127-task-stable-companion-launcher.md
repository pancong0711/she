# 任务单：稳定 Companion Launcher 与页面内自更新

> 日期：2026-11-27
> 状态：执行中
> 关联：ADR-0001、ADR-0003、assignment-assistant D71 两阶段更新经验

## 1. 问题

当前用户升级 companion 仍需重新下载并运行 `start.sh` / `start.ps1`。原因是
外部启动脚本同时承担了：

- 下载 release manifest；
- 下载 companion bundle；
- 校验 SHA；
- 安装版本目录；
- 检测旧进程；
- 启动 supervisor；
- 页面更新时再调用 shell installer。

只要其中任一步调整，就要用户重新下载外部启动脚本。内部更新逻辑也分散在 shell、
PowerShell 和 companion server 三处，并且 Windows 页面内更新被明确禁用。

## 2. 目标

建立稳定分层：

```text
start.sh / start.ps1 / start.command / start.bat
        │  仅 bootstrap：取最新 she-launcher.mjs，校验，exec
        ▼
$SHE_COMPANION_ROOT/launcher.mjs（稳定 launcher）
        │  首次安装 / 页面更新后重启 / 失败回滚 / supervisor
        ▼
$SHE_COMPANION_ROOT/current/apps/companion/server.mjs（可更新）
        │
        └── PWA：检查更新 → 安装并重启
```

### 必须做到

- [x] `start.sh` / `start.ps1` 变薄，不再下载/解包 companion bundle；
- [x] 新增稳定 `she-launcher.mjs` release asset，由 start 脚本 checksum 校验后安装；
- [x] launcher 负责首次安装、启动、退出码 75 重启、启动失败回滚；
- [x] companion 页面的“安装并重启”跨 Linux/macOS/Windows 可用（Node installer）；
- [x] companion server 不再依赖 `bash install-companion.sh` 才能更新；
- [x] 更新安装使用 Node 实现：校验、解包、版本目录、current 切换；
- [x] 更新流程继续写入 `update-pending.json`，供 launcher/supervisor 回滚；
- [x] 登录自启动指向稳定 `$INSTALL_ROOT/launcher.mjs`，不再指向版本目录；
- [x] PWA 文案明确：`start.sh` 仅首次安装/恢复用，日常升级在页面完成；
- [x] 保留旧安装目录、旧版本和人工恢复能力。

## 3. 更新状态机

```text
PWA 检查更新
  → companion 下载 manifest + bundle
  → SHA-256 校验
  → Node installer 解包到 versions/<version>
  → 切换 current
  → 写 update-pending.json（previousTarget/newVersion）
  → 返回响应并以 75 退出
  → launcher/supervisor 启动新 current
  → 新进程 20 秒内退出：切回 previousTarget 并启动旧版本
  → 新进程存活：清理 pending
```

不在运行中的 companion 进程里覆盖它自己的文件；只写新的版本目录并切 symlink/junction。

## 4. 非目标

- 不自动安装 Node/Docker；
- 不请求 root；
- 不实现无网络自更新；
- 不在本轮改变 Core 更新机制；
- 不把 launcher 做成大型常驻服务；它只在启动/重启期间存在。

## 5. 验收

- [x] `node --check apps/companion/launcher.mjs`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`（107/107，新增安装器测试）；
- [x] `pnpm build:companion` 产出 `she-launcher.mjs` 且 manifest 含校验和；
- [x] 本机模拟首次安装：无 current → launcher 安装 → 启动 companion；
- [x] 本机模拟页面更新：新版本目录 + current 切换 + 75 重启；
- [x] 旧 supervisor/update-pending 回滚契约不被破坏；
- [x] 故意提供启动失败版本，launcher 成功回滚到上一版本；
- [x] start.sh 从本地 release 目录完成 launcher 下载、SHA 校验和首次安装；
- [x] CI / Pages 通过；
- [x] 更新 PWA Help / 文档 / release 说明。
