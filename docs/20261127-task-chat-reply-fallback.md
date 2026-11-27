# 任务单：Chat 最终回复显示与事件流降级

> 日期：2026-11-27
> 状态：执行中

## 问题

OpenCode worker 已成功执行 Chat 任务，但页面只看到任务提交/完成状态，没有看到
OpenCode 的最终文本回复。当前未创建 sandbox，worker 直接使用宿主 OpenCode 服务。

## 已确认

后端链路本身可以工作。本机用真实 OpenCode 2.3.2 + control-plane worker 验证：

```text
task.accepted
task.progress(dispatching/submitted/running)
agent.delta(text="worker-ok")
artifact.created(report)
task.completed
```

因此问题集中在浏览器端的实时事件消费或最终回复降级：

- event stream 可能断开、被代理/CORS 拦截或页面重连期间漏事件；
- Chat 只依赖 `agent.delta` 事件，没有从已持久化的 task report artifact 回填最终文本；
- `task.completed` 只显示“任务完成”，不保证显示最终答案。

## 修复

- [x] PWA 增加 artifact 文本读取 API；
- [x] Chat 记录是否收到该任务的 `agent.delta text`；
- [x] 任务完成时刷新 artifacts；
- [x] 若未收到文本 delta，则从 task report artifact 读取最终回复并显示；
- [x] 即使 event stream 漏掉完成事件，也通过 snapshot 轮询检测终态并执行同样降级；
- [x] 增加 report header 清洗和测试；
- [x] 保留事件流实时显示；report fallback 仅避免“无回复”；
- [x] 更新文档、发布 companion/PWA。

## 验收

- [x] 后端真实 OpenCode 闭环仍产生 `agent.delta` 和 report；
- [x] Chat 正常收到 delta 时不重复显示 report；
- [x] Chat 未收到 delta 时显示 report 最终回复；
- [x] snapshot 发现 succeeded 时也会回填回复；
- [x] 失败任务仍显示明确错误；
- [x] `pnpm typecheck` / `pnpm test`（112/112）/ PWA build / CI / Pages 通过。
