# SHE companion 0.4.4 发布说明

> Release：`v0.4.4-companion.1`
> 日期：2026-11-26

## 修复

- Service worker 不再缓存：
  - `/api/*`
  - `/broker/*`
  - `/v1/*`
- 修复停止 companion 后页面仍显示“已连接”：
  - 旧 service worker 会返回缓存的 `/api/health`；
  - 现在实时 API 永不进入 Cache Storage。
- 修复环境能力摘要“重新检查后仍是旧结果”：
  - 同一缓存问题导致 `/api/preflight` 返回旧响应；
  - 现在重新检查、仅刷新结果都读取实时数据。
- Docker Packages 数据现在包含国内镜像 alternatives，安装源下拉可正常出现：
  - Docker 官方源；
  - 阿里云；
  - 清华 TUNA；
  - 中科大 USTC。
- 浏览器 API 请求增加 `cache: no-store`。
- Service worker cache 版本升级到 `she-pwa-v4`。

## 注意

升级后建议强制刷新一次页面或清除旧 service worker，以确保 v4 生效。
