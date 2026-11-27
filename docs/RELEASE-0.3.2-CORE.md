# SHE core 0.3.2 发布说明

> Release：`v0.3.2-core.1`
> 日期：2026-11-27
> 状态：已构建，待发布

## 变更

- gateway.v1 新增 `POST /v1/messages` 普通消息入口；
- `conversation.id` 映射到独立 topic/task 会话；
- `idempotencyKey` 幂等去重；
- 直接命令语义：`/help`、`/list`、`/status`、`/submit`、`/cancel`、`/stop`；
- 保留 `/she ...` 兼容别名；
- `GatewayMessageResult` 返回 `taskId/topicId`，供 feishu4dsh 关联原 RenderTarget；
- artifact.created 事件可用于普通消息后续文件回传。

本版本包含当前 main 上 feishu4dsh 直连 SHE 所需的 control-plane 实现。0.3.1
release bundle 早于该提交，不包含 `/v1/messages`。

## 验证

```text
tsc -b                         ✓
Vitest                         ✓ 37 files / 124 tests
core bundle build              ✓
/v1/messages in bundle         ✓
```

bundle SHA-256 以 `artifacts/core/release-manifest.json` 为准。

## 升级

PWA Settings → Core 更新使用：

```text
https://github.com/pancong0711/she/releases/download/v0.3.2-core.1/release-manifest.json
```
