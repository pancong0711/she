# SHE core 0.2.3 发布说明

> Release：`v0.2.3-core.1`
> 日期：2026-11-26

## 修复

- Worker 状态不再在任务执行期间错误显示 `idle`：
  - 任务 claim 成功后立即进入 `running`；
  - `lastTaskId` 和 `updatedAt` 在 claim 时更新；
  - 没有可 claim 任务时才回到 `idle`。
- `TaskRunner` 增加 `onClaim` 回调，使 worker health 能反映真实执行状态。
- 任务失败时，worker `lastError` 和 task.error 会保留可操作信息。

## 说明

本版本不包含多 agent 并发或 sandbox worker 路由；仍是单 worker、按 Topic 串行。

## 验证

```text
pnpm typecheck ✓
pnpm test      ✓
pnpm build:core ✓
```
