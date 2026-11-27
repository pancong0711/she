# SHE companion 0.7.11 发布说明

> Release：`v0.7.11-companion.1`
> 日期：2026-11-27
> 状态：已构建，待发布

## 修复

### 稳定 channel 优先使用 GitHub Pages

在部分网络环境中，GitHub Release asset 下载会持续超时，而 Pages manifest 可以
正常访问。之前 manifest 把 GitHub Release 作为首选下载源，导致 bootstrap 虽然
最终能 fallback，但要等待多轮 curl/Node fetch 超时。

0.7.11 调整稳定 channel 的下载顺序：

- `bundle.url` / `launcher.url` 指向 Pages 同源地址；
- `bundle.fallbackUrl` / `launcher.fallbackUrl` 指向 GitHub Release；
- launcher、companion server 和 start 脚本仍对两个来源做 SHA-256 校验；
- Pages workflow 在部署前从 GitHub Release 下载同一份不可变 bundle 作为
  Pages fallback，避免再次构建导致哈希漂移。

这样在普通网络环境下，bootstrap 和页面更新只访问已经可达的 Pages channel；
GitHub Release 保留为可校验的独立备份源。

## 验证

```text
tsc -b                         ✓
vue-tsc --noEmit               ✓
Vitest                         ✓ 37 files / 124 tests
PWA build + launcher mirror    ✓
Pages fallback hash check      ✓
companion bundle build         ✓
```

## 升级

- 0.7.10 及更早版本：运行一次最新 `start.sh` / `start.ps1`；
- 已由 launcher/supervisor 启动的版本：Settings 中检查更新。
