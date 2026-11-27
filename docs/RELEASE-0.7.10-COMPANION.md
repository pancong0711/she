# SHE companion 0.7.10 发布说明

> Release：`v0.7.10-companion.1`
> 日期：2026-11-27
> 状态：已构建，待发布

## 修复

### Pages fallback 与 GitHub Release 使用同一份 bundle

0.7.9 的 Pages workflow 会重新构建 companion bundle，而 manifest 与 GitHub
Release asset 来自另一次本地构建。由于 tar.gz 元数据不同，两次 bundle 的
SHA-256 不同，导致 launcher 从 GitHub Release 下载时校验失败、再回退 Pages。

0.7.10 固定发布流程：

- manifest 与 GitHub Release bundle 只构建一次；
- Pages workflow 不再重新打 companion bundle；
- Pages 只构建 PWA/launcher，并从 GitHub Release 下载**同一个不可变 bundle**
  作为 fallback；
- workflow 对 bundle 和 launcher 都按 committed manifest 的 SHA-256 校验。

因此 GitHub Release 与 Pages fallback 的 checksum 完全一致，不再出现主源下载
成功但校验失败的情况。

### 页面与 bootstrap

- 保留 0.7.9 的 `bundle.url` / `bundle.fallbackUrl` 双源下载；
- `start.sh` / `start.ps1` 继续支持 launcher fallback 和本地 launcher 降级；
- PWA 页面内 companion 更新使用同一 manifest 解析逻辑。

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

- 0.7.9 及更早版本：运行一次最新 `start.sh` / `start.ps1`；
- 已由 launcher/supervisor 启动的版本：Settings 中检查更新。
