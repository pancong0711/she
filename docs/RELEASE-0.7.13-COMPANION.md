# SHE companion 0.7.13（SHE App Shell）发布说明

> Release：`v0.7.13-companion.1`
> 日期：2026-11-27

## 修复

- Core 更新通道也改为 Pages 同源 manifest：
  `https://pancong0711.github.io/she/core-release-manifest.json`
- core manifest 增加 `bundle.url` / `bundle.fallbackUrl`；App Shell 会先尝试
  Pages bundle，失败后回退 GitHub Release，并继续校验 SHA-256。
- Pages workflow 同时下载当前 core release bundle 到 Pages fallback 目录，
  避免 core manifest 可达但 bundle 主机不可达。
- 统一版本检查 `/api/updates/status` 和 Settings 页面使用新的 core 通道。

## 兼容

- 仍支持自定义 `SHE_CORE_MANIFEST_URL`；
- 旧 core release manifest（只有相对 bundle.file）继续可解析；
- 0.7.12 的 SHE_HOME、本地 launcher、迁移和 legacy Feishu gateway 变更全部保留。
