# ADR-0004：稳定 Companion Launcher 与跨平台页面更新

> 日期：2026-11-27
> 状态：已采纳
> 关联：ADR-0001、ADR-0003

## 背景

ADR-0003 的 supervisor 已支持页面请求重启和 Linux/macOS 页面更新，但外部
`start.sh` / `start.ps1` 仍同时承担下载、校验、安装、检测旧进程和启动。结果是：

- 每次修复 launcher/update 细节，都要求用户重新下载启动脚本；
- 页面更新在 Windows 不可用；
- companion server 需要调用 `bash install-companion.sh`；
- 登录自启动指向版本化目录中的 supervisor，launcher 边界不清晰。

## 决策

建立稳定 launcher 层：

```text
start.sh / start.ps1（薄 bootstrap，极少变化）
        │ 下载 + SHA-256 校验 she-launcher.mjs
        ▼
$SHE_COMPANION_ROOT/launcher.mjs（稳定，不随 companion 版本切换）
        │ 首次安装 / 启动 / 75 重启 / 回滚
        ▼
$SHE_COMPANION_ROOT/current/apps/companion/server.mjs（可更新）
```

### start 脚本

- 只获取 `companion-release-manifest.json` 中的 `launcher` artifact；
- 校验 SHA-256；
- 原子替换 `$INSTALL_ROOT/launcher.mjs`；
- `exec node launcher.mjs`。

不再下载/解包 companion bundle，不再需要每次发版改动。

### launcher

- 首次安装 companion；
- 读取 `current`，spawn companion；
- 识别退出码 75 并重启；
- 新版本启动 20 秒内失败时恢复 `previousTarget`；
- 检测调试端口上已运行的 companion，避免重复启动；
- **默认在每次 launcher 启动时检查 companion channel manifest**；
  `SHE_LAUNCHER_UPDATE_ON_START=0` 可关闭该检查以支持完全离线启动；
- 检查/下载首先使用 Node fetch，失败时回退系统 `curl`，以兼容 Node 与系统
  curl 在 DNS/代理/TLS 路径上行为不同的主机；
- 停止状态下发现新版本时，由 launcher 直接下载、校验并安装到版本目录，再启动
  新版本；已运行的 companion 仍通过受控 update API 请求切换。

### companion installer

新增 Node 实现的 `companion-installer.mjs`：

- 校验版本、SHA-256；
- 使用 `tar -xzf` 解包到不可变版本目录；
- 切换 `current` symlink/junction；
- 写 `update-pending.json`；
- Linux/macOS/Windows 共用。

页面更新不再依赖 `bash install-companion.sh`。companion server 只写新的版本目录和
`current` 指针，不覆盖正在运行的自己的文件。

### 自启动

自启动命令指向稳定的 `$INSTALL_ROOT/launcher.mjs`，不指向版本化 supervisor。

## 兼容性

- 旧 supervisor 仍能处理 `update-pending.json` 并回滚；
- 已安装的旧版本目录保留；
- 手动 `install-companion.sh` / `.ps1` 会复制 bundle 内的 launcher；
- 从旧版/直接启动模式迁移时可能需要一次启动脚本或页面更新；之后无需重复下载。

## 结果

- `start.sh` / `start.ps1` 不再是频繁变化的更新实现；
- companion 页面更新成为 Linux/macOS/Windows 的默认升级路径；
- launcher、安装器、companion bundle 的职责分离；
- 回滚和 checksum 校验边界保持不变。
