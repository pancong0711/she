# SHE core 0.3.5 发布说明

> Release：`v0.3.5-core.1`
> 日期：2026-11-27

## 变更

- Sandbox 容器固定环境新增 `NPM_CONFIG_REGISTRY`：
  - 默认：`https://registry.npmmirror.com/`
  - 可通过宿主环境变量 `SHE_NPM_REGISTRY` 覆盖。
- 解决受限网络下 agent recipe 使用 npm 安装时仍访问 npmjs.org 的问题。
- 保留 broker 的只读 rootfs、mount 安全限制和现有 sandbox 行为。

## 实测

- 本地 fallback 镜像 `she-sandbox-node:24.04` 内安装
  `@opencode/cli@2.4.2` 成功，`opencode v2.4.2`；
- 安装使用 npmmirror，耗时约 7 秒；
- 完整路线见 `docs/SANDBOX-IMAGE-FALLBACKS.md`。

## 验证

```text
tsc -b                         ✓
Vitest                         ✓ 40 files / 137 tests
core bundle build              ✓
```
