# SHE companion 0.7.3 发布说明

> Release：`v0.7.3-companion.1`
> 日期：2026-11-27

## 重点：启动器与 Companion 更新分层

原先 `start.sh` / `start.ps1` 同时负责下载、安装、更新和启动，导致每次修更新
逻辑都要求用户重新下载启动脚本。0.7.3 改为：

```text
start.sh / start.ps1  （薄 bootstrap，仅首次/恢复）
        │ 下载并校验 she-launcher.mjs
        ▼
$SHE_COMPANION_ROOT/launcher.mjs（稳定 launcher）
        │ 首次安装 / supervisor / 重启 / 回滚
        ▼
companion current（可在页面内更新）
```

### 新增

- 新增稳定 release asset `she-launcher.mjs`，manifest 包含其 SHA-256；
- `start.sh` / `start.ps1` 只下载并校验 launcher，不再下载 companion bundle；
- 新增跨平台 Node companion installer：
  - Linux/macOS/Windows 页面内更新使用同一实现；
  - 不再要求 `bash install-companion.sh`；
  - 使用版本目录 + current symlink/junction + `update-pending.json` 回滚；
- `launcher.mjs` 负责首次安装、启动、退出码 75 重启、启动失败回滚；
- 登录自启动改为指向稳定 `$INSTALL_ROOT/launcher.mjs`；
- 手动 `install-companion.sh` / `.ps1` 也会安装稳定 launcher command；
- PWA Settings 显示 launcher 状态，并明确日常升级在页面完成。

### 升级方式

已安装旧版 companion 的用户：

1. 优先在 Settings 点击“检查 companion 更新 → 安装并重启”；
2. 如果旧版无法页面内更新（例如 Windows 旧版本或非 supervisor 直接启动），运行一次最新的
   `start.sh` / `start.ps1`；
3. 之后不再需要为 companion 升级重新下载启动脚本。

### 验证

```text
pnpm typecheck                 ✓
pnpm test                      ✓ 107/107
pnpm pwa:build                 ✓
pnpm build:core                ✓
pnpm build:companion           ✓
pnpm build:feishu-gateway      ✓
```

本机实测：

- 空 install root 首次安装并启动 companion；
- 页面 API 触发 0.7.2 → 0.7.3 更新，launcher 识别退出码 75 并切到新版本；
- 故意提供启动即崩溃的 0.7.4 bundle，launcher 回滚到 0.7.3；
- `start.sh` 从本地 release 目录完成 launcher 下载、SHA 校验和首次安装。

## 安全边界

- launcher 下载必须通过 manifest SHA-256 校验；
- companion bundle 仍必须通过 manifest SHA-256 校验；
- 更新仍只写用户目录，不请求 root；
- 安装失败或新版本启动失败时保留上一版本目录；
- launcher 不接受任意命令或任意下载 URL。
