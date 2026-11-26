# Task Report Artifacts

> 状态：T6.6 首版
> 代码：
> - `packages/control/src/task-runner.ts`
> - `apps/control-plane/src/server.ts`
> - `packages/client/src/index.ts`
> - `apps/pwa/src/App.vue`

## 1. 目标

Agent 任务完成后，用户需要能直接看到并下载报告/产物，而不是只能复制聊天文本。

首版实现：

- 成功任务自动生成 Markdown report artifact；
- report 内容来自任务中的 text-delta；
- report 存储到 worker workspace：
  ```text
  <workspace>/.she/reports/<taskId>.md
  ```
- 写入 `artifacts` repository；
- 写 `artifact.created` 领域事件；
- task 记录 `reportArtifactId`；
- control-plane 提供 artifact list/download API；
- PWA Chat 在任务完成后显示“报告与产物”下载链接。

## 2. 生成规则

- 仅成功任务自动生成；
- 无 text-delta 时不生成；
- 最大写入 1 MiB；
- 文件权限 0600，目录 0700；
- 内容包含 task/topic/generated 时间和 agent 最终文本；
- report 生成失败不会把任务改成失败，只跳过 artifact。

## 3. Control-plane API

```text
GET /v1/artifacts?taskId=<task-id>
GET /v1/artifacts/<artifact-id>/download
```

列表返回：

```json
[
  {
    "id": "artifact-000001",
    "fileName": "task-000001.md",
    "bytes": 1234,
    "sha256": "...",
    "taskId": "task-000001",
    "downloadPath": "/v1/artifacts/artifact-000001/download"
  }
]
```

下载：

- 只允许 artifact record 的 `storageRef`；
- realpath/relative 校验，禁止路径逃逸；
- `content-disposition: attachment`；
- `cache-control: no-store`；
- 不暴露宿主绝对路径。

## 4. PWA Chat

任务流中收到：

```text
artifact.created
```

或任务完成后主动调用 artifact list，会在 Chat 下方显示：

```text
报告与产物
task-xxx.md · 1.2 KiB ↗
```

下载走 control-plane API，浏览器不会接触 worker workspace 绝对路径。

## 5. 当前限制

- 首版只自动生成最终文本 Markdown report；
- 任意的工具输出文件、diff、二进制产物尚未自动索引；
- 没有 artifact retention policy；
- 尚未把 sandbox outbox artifacts 映射到 task artifact；
- event cursor 恢复后需要重新 list artifact，而不是只依赖事件流。

## 6. 验收

- [x] TaskRunner report 写入与 repository；
- [x] artifact.created 事件；
- [x] task.reportArtifactId；
- [x] list/download API；
- [x] PWA Chat 下载入口；
- [x] 路径逃逸负例设计；
- [ ] arbitrary output/diff artifacts；
- [ ] retention/清理策略。
