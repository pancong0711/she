# SHE companion 0.7.8 发布说明

> Release：`v0.7.8-companion.1`
> 日期：2026-11-27
> 状态：已构建，待发布

## 修复

### 1. Bootstrap 下载失败时的可用性

`start.sh` / `start.ps1` 现在：

- 优先从 manifest 指定的 GitHub Release 下载 launcher；
- curl 的 TLS EOF/代理错误会再尝试 Node `fetch`（Linux/macOS）；
- GitHub Release 不可达时尝试 Pages channel 同目录的
  `she-launcher.mjs` 镜像；
- 新 launcher 下载或校验失败时，如果本机已有 launcher，则继续使用已安装版本，
  不再因为一次下载失败而直接退出。

`pnpm pwa:build` / `pnpm build:companion` 会生成 Pages launcher 镜像，因此
稳定 channel 不再只有 GitHub Release 一个 bootstrap 下载源。

### 2. 页面内 companion 更新使用 manifest 绝对 URL

页面驱动更新原先错误地把 `bundle.file` 拼到 Pages manifest 同目录，实际会下载到
GitHub Pages 的 HTML 404 页面。现在统一解析：

```text
manifest.bundle.url > manifest 同目录相对地址（旧 manifest fallback）
```

launcher 和 companion server 共用同一解析函数，并保留 SHA-256 校验。

### 3. Launcher 启动检查

- launcher 默认在启动时检查 companion channel；
- `SHE_LAUNCHER_UPDATE_ON_START=0` 可显式关闭；
- 页面更新、launcher 启动更新、手动 `she-companion` 启动都走同一检查/安装路径；
- 新版本启动失败仍由 supervisor 按 pending marker 回滚。

### 4. 同批合入但此前未发布的 companion 改动

- companion 页面/更新检查的 curl fallback；
- Sandbox 镜像源选择及 PWA 展示；
- 其他当前 main 上已测试通过的 companion/PWA 变更。

## 验证

```text
tsc -b                         ✓
vue-tsc --noEmit               ✓
Vitest                         ✓ 37 files / 124 tests
PWA build                      ✓
companion bundle build         ✓
launcher asset build           ✓
start.sh local fallback test   ✓
```

本版本 bundle SHA-256 以 `artifacts/companion/companion-release-manifest.json`
为准。

## 升级

- 0.7.7 及更早版本：运行一次最新 `start.sh` / `start.ps1`；
- 已由 stable launcher/supervisor 启动的版本：Settings 中检查更新并安装；
- 页面提示 companion 仍为旧版时，先确认 supervisor 页面内更新已修复到 0.7.8。
