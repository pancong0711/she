# SHE core 0.2.1 发布说明

> Release：`v0.2.1-core.1`
> 日期：2026-11-26

## 修复

- 新增受认证的 `POST /v1/admin/shutdown`，允许 companion 停止外部启动/遗留的 core；
- companion 检测到 `supervisor.external=true` 时可通过停止/重启重新接管；
- core bundle 版本升级到 0.2.1。

## 背景

companion 更新或异常退出后，旧 core 可能继续作为外部进程运行。新 companion 无法直接管理该子进程，导致启动/停止/重启看似无反应。0.2.1 提供受 bearer token 保护的 admin shutdown，由 companion 请求旧 core 优雅退出。

## API

```text
POST /v1/admin/shutdown
```

- 需要 control-plane bearer token；
- 响应后 control-plane 触发 SIGTERM；
- run-core 负责停止 control-plane/broker 子进程；
- companion 等待 socket 消失后再启动新的 core。
