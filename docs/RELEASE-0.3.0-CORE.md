# SHE core 0.3.0 发布说明

> Release：`v0.3.0-core.1`
> 日期：2026-11-26

## 新增

- sandbox broker 新增 `sandbox.exec` capability 与：
  ```text
  POST /v1/sandboxes/:name/exec
  ```
- 一次性容器命令执行：
  - 固定通过 `docker exec`；
  - cwd 限定在 `/workspace`、`/home/agent`、`/cache`、`/tmp`、`/outbox`、`/legacy`；
  - 超时 1–300 秒；
  - stdout/stderr 上限与截断标记；
  - 审计记录 argv0、参数数量、cwd、退出码、超时/截断状态。
- 容器固定环境变量：
  ```text
  HOME=/home/agent
  PATH=/home/agent/.local/bin:...
  NPM_CONFIG_PREFIX=/home/agent/.local
  XDG_CONFIG_HOME=/home/agent/.config
  XDG_DATA_HOME=/home/agent/.local/share
  XDG_CACHE_HOME=/cache
  ```
- 因此 agent 可以安装到持久化 writable home，而不是修改只读 rootfs。
- `SandboxProvider`、`SandboxApi` 与 `SandboxBrokerClient` 增加 `exec()`。

## 边界

- broker 仍是唯一 Docker socket 持有者；
- exec 不提供宿主 shell，用户提交的是容器内 argv；
- 当前是一次性 exec，不是完整 PTY；
- 命令不能指定任意 env，broker 只注入固定环境。

## 验证

```text
pnpm typecheck ✓
pnpm test      ✓
pnpm build:core ✓
```
