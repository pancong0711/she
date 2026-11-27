# SHE core 0.3.3 发布说明

> Release：`v0.3.3-core.1`
> 日期：2026-11-27

## 变更

- core 默认路径对齐 `SHE_HOME`：
  - database：`SHE_HOME/state/she.db`
  - runtime socket：`SHE_HOME/run/control.sock`
  - config/token：`SHE_HOME/config/token`
  - workspace：`SHE_HOME/workspaces/default`
- 仍支持 `SHE_HOME`、`SHE_DB_PATH`、`SHE_TOKEN_FILE`、`SHE_RUNTIME_DIR`、
  `SHE_WORKSPACE_ROOT` 等显式覆盖；
- App Shell 启动 core 时注入同一套路径环境；
- 保留 gateway.v1 直接消息、命令、artifact 等现有能力。

## 验证

```text
tsc -b                         ✓
Vitest                         ✓ 39 files / 132 tests
core bundle build              ✓
```
