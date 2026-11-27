# SHE companion 0.7.9 发布说明

> Release：`v0.7.9-companion.1`
> 日期：2026-11-27
> 状态：已构建，待发布

## 新增

### GitHub Release 不稳定时的完整镜像

0.7.8 已修复 bootstrap 的 launcher 下载降级和页面更新绝对 URL，但当
GitHub Release asset 主机本身不可达时，首次安装仍可能停在 companion bundle
下载阶段。0.7.9 增加 bundle 与 launcher 的 Pages fallback：

- manifest 为 `bundle` / `launcher` 增加 `fallbackUrl`；
- launcher 与 companion server 优先下载 GitHub Release，失败后自动尝试
  Pages 同版本文件；
- 两个来源都做相同的 SHA-256 校验；
- `pnpm build:companion` 将 bundle 和 launcher 同步到 Pages 发布目录；
- Pages workflow 改为构建完整 companion channel，确保 fallback 文件实际上线。

### Bootstrap

- `start.sh` / `start.ps1` 优先使用 manifest 的 `launcher.fallbackUrl`；
- 针对 launcher 下载使用较短超时，GitHub 不可达时更快切到 Pages；
- curl / Invoke-WebRequest 失败后继续尝试第二传输栈；
- 新 launcher 失败时继续使用已安装 launcher。

### 页面内更新

- companion 页面更新与 launcher 共用 `bundle.url` / `bundle.fallbackUrl`
  解析逻辑；
- 修复把 bundle 文件名拼到 Pages manifest 目录、下载到 HTML 404 页面的问题。

## 验证

```text
tsc -b                         ✓
vue-tsc --noEmit               ✓
Vitest                         ✓ 37 files / 124 tests
PWA build + launcher mirror    ✓
companion bundle build         ✓
start.sh mirror fallback test  ✓
```

## 升级

- 0.7.8 及更早版本：运行一次最新 `start.sh` / `start.ps1`；
- 已由 stable launcher/supervisor 启动的版本：Settings 中检查更新。
