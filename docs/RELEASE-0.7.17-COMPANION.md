# SHE companion 0.7.17（SHE App Shell）发布说明

> Release：`v0.7.17-companion.1`
> 日期：2026-11-27

## 变更

- Sandbox 镜像预设新增 **SHE Fallback Node 24（本地构建）**：
  `she-sandbox-node:24.04`。
- 该镜像可以在 Docker Hub 和 registry 代理不可用时，通过
  `pnpm sandbox:fallback-image` 从 Ubuntu base rootfs 本地构建。
- 本地镜像已存在时，使用 `official` 镜像源即可，不会访问 Docker registry。
- 完整测试和构建方法见 `docs/SANDBOX-IMAGE-FALLBACKS.md`。

## 配套

- Core 0.3.5 给 sandbox 注入可配置的
  `NPM_CONFIG_REGISTRY`，默认 `https://registry.npmmirror.com/`；
- 可用 `SHE_NPM_REGISTRY=https://registry.example/` 覆盖。
