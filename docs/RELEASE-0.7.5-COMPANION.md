# SHE companion 0.7.5 发布说明

> Release：`v0.7.5-companion.1`
> 日期：2026-11-27

## 修复：Chat 任务成功但看不到 OpenCode 最终回复

### 已确认的后端行为

本机用真实 OpenCode 2.3.2 + control-plane worker 验证，完整事件链正常：

```text
task.accepted
task.progress(dispatching)
task.progress(submitted)
task.progress(running)
agent.delta(text="worker-ok")
artifact.created(report)
task.completed
```

OpenCode adapter 会轮询 assistant message 并产生 `text-delta`；TaskRunner 会写入
`.she/reports/<task>.md`，同时创建 artifact。

### 页面问题

Chat 之前只依赖实时 `agent.delta`。如果 event stream 在浏览器端断开、被代理/权限
策略拦截，或者完成事件到达时实时文本没有交付，页面就只显示“任务完成”，不会读取
已经持久化的任务报告。

### 修复内容

- 新增 artifact 文本读取；
- Chat 记录每个任务是否收到 `agent.delta` 的 `text` channel；
- 收到 `task.completed` 时：
  - 刷新任务 artifacts；
  - 若未收到实时文本，则从 markdown report artifact 提取最终回复并显示；
  - 若没有 report，显示明确诊断而不是静默无回复；
- snapshot 轮询发现任务已 `succeeded` 时也执行相同回填，避免 event stream 漏掉完成事件；
- 后端仍保留实时 delta 显示；report fallback 不会在已有实时文本时重复输出；
- 新增 report header 清洗测试。

这不会把 worker 迁移到 sandbox；当前 worker 仍直接运行在宿主用户空间并调用 OpenCode。

## 验证

```text
pnpm typecheck       ✓
pnpm test            ✓ 112/112
pnpm pwa:build       ✓
pnpm build:core      ✓
pnpm build:companion ✓
pnpm build:feishu-gateway ✓
```

真实 OpenCode 闭环验证：

```text
COMMAND accepted task-000003
EVENT task.accepted
EVENT task.progress ...
EVENT agent.delta text=worker-ok
EVENT artifact.created
EVENT task.completed
DELTAS worker-ok
```

## 升级

已有 0.7.3/0.7.4 的用户在本地页面：

```text
Settings → 检查 companion 更新 → 安装 0.7.5 并重启
```

然后重新测试 Chat。即使实时事件流再次中断，任务完成后也会自动从 report artifact
回填 OpenCode 的最终回复。
